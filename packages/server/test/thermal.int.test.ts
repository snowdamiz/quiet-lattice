// Thermal's Tier I–II actives over the wire (P1.E07.T05), against the dockerised Postgres and Redis and the shipped ability
// book: a character owns, slots and casts Lance, Flare, Sear and Vent as a player does, each carried out by the server with
// DESIGN 9.3's numbers: Lance's damage is the beam time the meters judged (and Chain arcs it), Flare's cone bursts and ignites,
// Sear's mark burns, Vent's shockwave is the heat it dumped. What each did reaches the client as combat events.
import { THERMAL_NUMBERS as N, cooldownOf } from '@astra/shared/abilities';
import { getSkillNode } from '@astra/shared/data';
import { Buttons, PROTOCOL_VERSION, type GameEvent, type ServerMessage } from '@astra/shared/protocol';
import { creatureSphere } from '@astra/shared/combat';
import { faunaSpecies, frameId, type FaunaSpecies, type PlanetParams } from '@astra/shared/world';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters } from '../src/db/schema.ts';
import type { Vec3 } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import { nodeGrounds } from '../src/resources/ground.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import type { Zone } from '../src/zones/zone.ts';
import { CAST_PER_S } from '../src/abilities/service.ts';
import { clearSight } from '../src/combat/sight.ts';
import { along, openGround } from './faunaWorld.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';

type Answer = Extract<ServerMessage, { t: 'cast' }>;
type CombatEvent = Extract<GameEvent, { kind: 'combat' }>;

const HOME = homeSystemOf('thalune');
const system = describeZoneSystem(HOME);
const docile = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer' && x.spawn === 'herd');
const body = system.bodies.find((b) => b.type !== 'gas' && docile(faunaSpecies(b.params as PlanetParams, 0)))!;
const params = body.params as PlanetParams;
const FRAME = frameId(system.seed, body.index)!;
const walker = docile(faunaSpecies(params, 0))!;
const g = groundOf(params, 0);
const spot = openGround(g);
const [t, b] = tangents(spot);
/** The point on the ground `east` and `north` metres from the spot. */
const at = (east: number, north = 0): Vec3 => {
  const d = along(spot, t, b, east, north, g.radius);
  const r = g.radius + g.sample(d);
  return [d[0] * r, d[1] * r, d[2] * r];
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const unit = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};
/** The shortest turn taking −z to `dir`, as the client's eye quaternion. */
function lookQuat(dir: Vec3): [number, number, number, number] {
  // (−z) × dir = (0·dz − (−1)·dy, (−1)·dx − 0·dz, 0) = (dy, −dx, 0); w = 1 + (−z)·dir = 1 − dz
  const q = [dir[1], -dir[0], 0, 1 - dir[2]];
  const l = Math.hypot(...q) || 1;
  return [q[0]! / l, q[1]! / l, q[2]! / l, q[3]! / l];
}

const config = parseConfig(process.env);
let database: Database;
let server: RunningServer;

beforeAll(async () => {
  database = createDatabase(config.DATABASE_URL, { max: 2 });
  // (the shipped ability book; bots stand on the world with raw poses, a cast reads the mode the zone believes)
  server = await startTestServer({}, { movement: false });
});

afterAll(async () => {
  await server?.close();
  await database?.close();
});

/** A level-16 character owning Thermal's Tier I–II and the first four on the ground bar (Chain owned, not slotted). */
async function character() {
  const acct = await newAccount(server);
  const id = (await newCharacter(server, acct.token, { people: 'thalune' })).id;
  await database.db.update(characters).set({ level: 16 }).where(eq(characters.id, id));
  return { token: acct.token, id };
}

function own(id: string, nodes: string[]): void {
  for (const node of nodes) {
    expect(server.ws.skills.unlock(id, node, { kind: 'dev' }), node).toMatchObject({ ok: true });
    expect(server.ws.skills.buy(id, node), node).toMatchObject({ ok: true });
  }
}

async function join(token: string, characterId: string) {
  const sock = await TestSocket.open(server.wsUrl);
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  await sock.next('meters');
  await sock.next('abilities');
  const zone = server.zones.zone(welcome.zone.id)!;
  const sentAt = Date.now();
  const time = () => welcome.serverTime + (Date.now() - sentAt) / 1000;
  let inputSeq = 0;
  let castSeq = 0;
  let skillSeq = 0;
  let lastCast = 0;
  const bot = {
    sock,
    zone,
    entity: welcome.entityId,
    time,
    /** an input at `pos`, on foot, the beam held or not and the eye looking along `look` */
    input(pos: Readonly<Vec3>, opts: { beam?: boolean; look?: Vec3 } = {}) {
      sock.send({
        t: 'input',
        seq: ++inputSeq,
        time: time(),
        mode: 'foot',
        pose: { frame: FRAME, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
        buttons: opts.beam ? Buttons.beam : 0,
        ...(opts.look ? { aim: lookQuat(opts.look) } : {}),
      });
    },
    async stand(pos: Readonly<Vec3>) {
      bot.input(pos);
      await waitFor(() => {
        const f = zone.entity(welcome.entityId)?.fields;
        return f?.mode === 'foot' && f.frame === FRAME && Math.hypot(f.pos[0] - pos[0], f.pos[1] - pos[1], f.pos[2] - pos[2]) < 1e-6;
      });
    },
    async slot(index: number, node: string) {
      const s = ++skillSeq;
      sock.send({ t: 'skills', seq: s, op: { op: 'slot', bar: 'ground', index, node } });
      for (;;) {
        const m = await sock.next('skills');
        if (m.seq === s) return m;
      }
    },
    on: () => sock.received.filter((m): m is Extract<ServerMessage, { t: 'abilities' }> => m.t === 'abilities').at(-1)?.on,
    async cast(node: string, slot: number, extra: { target?: number; aim?: Vec3 } = {}): Promise<Answer> {
      await sleep(lastCast + 1000 / CAST_PER_S - Date.now());
      lastCast = Date.now();
      const s = ++castSeq;
      sock.send({
        t: 'cast',
        seq: s,
        time: time(),
        node,
        slot,
        frame: FRAME,
        aim: extra.aim ?? [0, 0, -1],
        ...(extra.target === undefined ? {} : { target: extra.target }),
      });
      for (;;) {
        const m = await sock.next('cast');
        if (m.seq === s) return m;
      }
    },
    /** the combat events about `target` by `ability` */
    hits: (target: number, ability: string): CombatEvent[] =>
      sock.received.flatMap((m) => (m.t === 'event' && m.event.kind === 'combat' && m.event.target === target && m.event.ability === ability ? [m.event] : [])),
  };
  return bot;
}

/** A creature of the walker species on the ground at `feet`. */
function creature(zone: Zone, feet: Readonly<Vec3>): number {
  return zone.fauna!.spawnHerd({ body: body.index, species: walker.index, at: [...feet], count: 1, level: 2 })!.creatures[0]!;
}
const health = (zone: Zone, id: number) => zone.combat.creatureHealth(id)!;
const lost = (zone: Zone, id: number) => health(zone, id).max - health(zone, id).hp;
const heat = (id: string) => server.ws.meters.view(id, server.world.clock.now()).heat;
const centre = (zone: Zone, id: number): Vec3 => {
  const p = zone.entity(id)!.fields.pos as Vec3;
  const l = Math.hypot(...p);
  return [p[0] + (p[0] / l) * 0.5, p[1] + (p[1] / l) * 0.5, p[2] + (p[2] / l) * 0.5];
};
const eye = (pos: Vec3): Vec3 => {
  const l = Math.hypot(...pos);
  return [pos[0] + (pos[0] / l) * 1.6, pos[1] + (pos[1] / l) * 1.6, pos[2] + (pos[2] / l) * 1.6];
};

describe('Thermal over the wire', () => {
  it(
    'Lance: toggled on, the beam hurts what the eye follows by the beam time the meters judged, with Chain arcing half to a second',
    { timeout: 40_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['lance', 'chain']);
      expect((await bot.slot(0, 'lance')).error).toBeUndefined();
      const stand = at(0);
      await bot.stand(stand);
      while (!nodeGrounds.ground(params, 0)) await sleep(100);
      const first = creature(bot.zone, at(12));
      const second = creature(bot.zone, at(12, 5));
      const far = creature(bot.zone, at(12, -40));
      const node = getSkillNode('lance');
      expect(node.cost).toEqual({ heatPerS: 32 });

      const answer = await bot.cast('lance', 0);
      expect(answer).toMatchObject({ result: 'cast', node: 'lance' });
      expect(answer.readyAt).toBeUndefined();
      expect(bot.on()).toEqual(['lance']);
      const beam0 = server.ws.meters.beamTime(c.id, server.world.clock.now());
      // the beam held for 1.4 s, the eye following the first creature
      for (let i = 0; i < 28; i++) {
        bot.input(stand, { beam: true, look: unit(centre(bot.zone, first).map((x, k) => x - eye(stand)[k]!)) });
        await sleep(50);
      }
      bot.input(stand, { look: [0, 0, -1] });
      // Sample the heating at the acknowledged beam boundary, before the idle cooldown below.
      bot.sock.send({ t: 'ping', id: 1, clientTime: 0 });
      await bot.sock.next('pong');
      expect(heat(c.id)).toBeGreaterThan(20);
      await sleep(600);
      const beamS = server.ws.meters.beamTime(c.id, server.world.clock.now()) - beam0;
      expect(beamS).toBeGreaterThan(1.2);
      const dealt = lost(bot.zone, first);
      expect(dealt).toBeGreaterThan(N.lance.dps * 0.5);
      expect(dealt).toBeLessThanOrEqual(N.lance.dps * beamS + 1e-6);
      expect(bot.hits(first, 'lance').length).toBeGreaterThan(0);
      expect(lost(bot.zone, far)).toBe(0);
      // Chain: a share of what the first took, never more than half of it
      expect(lost(bot.zone, second)).toBeGreaterThan(0);
      expect(lost(bot.zone, second)).toBeLessThanOrEqual(dealt * N.lance.chainShare + 1e-6);
      // the next cast turns it off, free
      expect(await bot.cast('lance', 0)).toMatchObject({ result: 'ended' });
      expect(bot.on()).toEqual([]);
      const after = lost(bot.zone, first);
      bot.input(stand, { beam: true, look: [0, 0, -1] });
      await sleep(600);
      expect(lost(bot.zone, first)).toBe(after);
      bot.sock.close();
    },
  );

  it(
    'Lance: hurts nothing behind a hill, the first creature on the look within 30 m though it is, and the same creature in the clear',
    { timeout: 60_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['lance']);
      expect((await bot.slot(0, 'lance')).error).toBeUndefined();
      let ground = nodeGrounds.ground(params, 0);
      while (!ground) {
        await sleep(100);
        ground = nodeGrounds.ground(params, 0);
      }
      const lift = (p: Vec3, by: number): Vec3 => {
        const l = Math.hypot(...p);
        return [p[0] + (p[0] / l) * by, p[1] + (p[1] / l) * by, p[2] + (p[2] / l) * by];
      };
      // a creature spot with a stand 14–26 m from it behind a rise, whichever way the creature drifts (its hit sphere up to 2 m up
      // still hidden), and another in the open: the world's real ground, searched from a spread of directions
      const onGround = (d: Vec3, east: number, north: number): Vec3 => {
        const [tt, bb] = tangents(d);
        const p = along(d, tt, bb, east, north, g.radius);
        const r = g.radius + g.sample(p);
        return [p[0] * r, p[1] * r, p[2] * r];
      };
      const dry = (p: Vec3): boolean => g.sample(unit(p)) > 3;
      const around: [number, number][] = [-2, 0, 2].flatMap((x) => [-2, 0, 2].map((y): [number, number] => [x, y]));
      let found: { feet: Vec3; hidden: Vec3; open: Vec3 } | null = null;
      const N_DIRS = 4000;
      for (let i = 0; i < N_DIRS && !found; i++) {
        const y = 1 - (2 * (i + 0.5)) / N_DIRS;
        const ang = i * 2.399963229728653;
        const rr = Math.sqrt(1 - y * y);
        const d: Vec3 = [Math.cos(ang) * rr, y, Math.sin(ang) * rr];
        const feet = onGround(d, 0, 0);
        if (!dry(feet)) continue;
        let hidden: Vec3 | null = null;
        let open: Vec3 | null = null;
        for (let k = 0; k < 8 && !(hidden && open); k++) {
          for (const dist of [14, 18, 22, 26]) {
            const stand = onGround(d, dist * Math.cos((k / 8) * Math.PI * 2), dist * Math.sin((k / 8) * Math.PI * 2));
            if (!dry(stand) || Math.hypot(stand[0] - feet[0], stand[1] - feet[1], stand[2] - feet[2]) > 26) continue;
            const from = lift(stand, 1.6);
            if (!clearSight(ground.sampler, from, lift(feet, 2))) {
              if (around.every(([x, z]) => !clearSight(ground.sampler, from, lift(onGround(d, x, z), 2)))) hidden ??= stand;
            } else if (clearSight(ground.sampler, from, lift(feet, 0.5))) open ??= stand;
          }
        }
        if (hidden && open) found = { feet, hidden, open };
      }
      expect(found, 'a spot of this world with a rise between two points 14–26 m apart').not.toBeNull();
      const { feet, hidden, open } = found!;
      const id = creature(bot.zone, feet);
      const sphere = () => creatureSphere(bot.zone.fauna!.creature(id)!).pos as Vec3;
      const aimFrom = (stand: Vec3) => unit(sphere().map((x, k) => x - eye(stand)[k]!));
      const hold = async (stand: Vec3, seconds: number) => {
        for (let i = 0; i < seconds * 20; i++) {
          bot.input(stand, { beam: true, look: aimFrom(stand) });
          await sleep(50);
        }
        bot.input(stand, { look: aimFrom(stand) });
        await sleep(400);
      };
      await bot.stand(hidden);
      expect(clearSight(ground.sampler, eye(hidden), sphere()), 'the rise is in the way').toBe(false);
      expect(await bot.cast('lance', 0)).toMatchObject({ result: 'cast' });
      await hold(hidden, 1.4);
      expect(lost(bot.zone, id)).toBe(0);
      // the same creature from the open stand: the beam finds it
      await bot.stand(open);
      await hold(open, 1.4);
      expect(lost(bot.zone, id)).toBeGreaterThan(N.lance.dps * 0.5);
      bot.sock.close();
    },
  );

  it(
    'Flare: bursts the 60° cone for 18 and ignites for 4 s, 24 more in ticks; the creature behind and the one past 12 m are spared',
    { timeout: 40_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['lance', 'flare']);
      expect((await bot.slot(1, 'flare')).error).toBeUndefined();
      const stand = at(0);
      await bot.stand(stand);
      while (!nodeGrounds.ground(params, 0)) await sleep(100);
      const inCone = creature(bot.zone, at(8));
      const behind = creature(bot.zone, at(-8));
      const beyond = creature(bot.zone, at(30));
      const aim = unit(centre(bot.zone, inCone).map((x, k) => x - eye(stand)[k]!));
      const h0 = heat(c.id);
      const answer = await bot.cast('flare', 1, { aim });
      expect(answer).toMatchObject({ result: 'cast', node: 'flare' });
      expect(answer.readyAt! - bot.time()).toBeCloseTo(cooldownOf(getSkillNode('flare'))!.seconds, 0);
      expect(heat(c.id) - h0).toBeGreaterThan(30 - 2);
      await waitFor(() => bot.hits(inCone, 'flare').length > 0, 5000, 'the burst');
      expect(health(bot.zone, inCone).max - health(bot.zone, inCone).hp).toBeGreaterThanOrEqual(N.flare.burst - 1e-6);
      await sleep(5000);
      expect(lost(bot.zone, inCone)).toBeCloseTo(N.flare.burst + N.flare.burnDps * 4, 6);
      expect(bot.hits(inCone, 'flare').length).toBeGreaterThan(2);
      expect(lost(bot.zone, behind)).toBe(0);
      expect(lost(bot.zone, beyond)).toBe(0);
      bot.sock.close();
    },
  );

  it('Sear: marks one creature in reach to burn 8 s for 5 a second, with no blow of its own', { timeout: 40_000 }, async () => {
    const c = await character();
    const bot = await join(c.token, c.id);
    own(c.id, ['lance', 'sear']);
    expect((await bot.slot(2, 'sear')).error).toBeUndefined();
    const stand = at(0);
    await bot.stand(stand);
    while (!nodeGrounds.ground(params, 0)) await sleep(100);
    const marked = creature(bot.zone, at(25));
    const other = creature(bot.zone, at(20, 6));
    const h0 = heat(c.id);
    const answer = await bot.cast('sear', 2, { target: marked });
    expect(answer).toMatchObject({ result: 'cast', node: 'sear' });
    expect(answer.readyAt! - bot.time()).toBeCloseTo(cooldownOf(getSkillNode('sear'))!.seconds, 0);
    expect(heat(c.id) - h0).toBeGreaterThan(20 - 2);
    expect(lost(bot.zone, marked)).toBe(0);
    await sleep(9000);
    expect(lost(bot.zone, marked)).toBeCloseTo(N.sear.burnDps * 8, 6);
    expect(lost(bot.zone, other)).toBe(0);
    // out of reach: refused, and the cooldown not started over
    const far = creature(bot.zone, at(60));
    expect(await bot.cast('sear', 2, { target: far })).toMatchObject({ result: 'refused' });
    bot.sock.close();
  });

  it('Vent: dumps all the heat and hurts those within 10 m by 0.6 for each point of it', { timeout: 40_000 }, async () => {
    const c = await character();
    const bot = await join(c.token, c.id);
    own(c.id, ['lance', 'vent']);
    expect((await bot.slot(3, 'vent')).error).toBeUndefined();
    const stand = at(0);
    await bot.stand(stand);
    while (!nodeGrounds.ground(params, 0)) await sleep(100);
    const near = creature(bot.zone, at(6));
    const out = creature(bot.zone, at(16));
    const now = server.world.clock.now();
    expect(server.ws.meters.addHeat(c.id, 70, now).ok).toBe(true);
    const before = heat(c.id);
    const answer = await bot.cast('vent', 3);
    expect(answer).toMatchObject({ result: 'cast', node: 'vent' });
    expect(answer.readyAt! - bot.time()).toBeCloseTo(cooldownOf(getSkillNode('vent'))!.seconds, 0);
    await waitFor(() => bot.hits(near, 'vent').length > 0, 5000, 'the shockwave');
    expect(heat(c.id)).toBeLessThan(2);
    // (the heat that went is what the meter held when it was cast: 70 less what cooled on the way)
    expect(lost(bot.zone, near)).toBeGreaterThan((before - 8) * N.vent.damagePerHeat);
    expect(lost(bot.zone, near)).toBeLessThanOrEqual(70 * N.vent.damagePerHeat + 1e-6);
    expect(lost(bot.zone, out)).toBe(0);
    bot.sock.close();
  });
});
