// Gravitic's Tier I–II actives over the wire (P1.E07.T04), against the dockerised Postgres and Redis and the shipped ability
// book: a character owns, slots and casts Pull, Well, Slam, Tractor Beam and Inertial Brake as a player does, each carried out
// by the server with DESIGN 9.2's numbers: Pull yanks a creature 25 m to the caster's feet (three with Pull Many), Well slows
// everything in its 12 m bubble by 60%, Slam knocks creatures down in a radius that grows with the fall, the ship forms cost
// Charge on the ship bar, and Dense Bones' +20% health is there for a suit bought mid-session.
import { GRAVITIC_NUMBERS as N, cooldownOf, slamRadius } from '@astra/shared/abilities';
import { getSkillNode } from '@astra/shared/data';
import { PROTOCOL_VERSION, type GameEvent, type ServerMessage } from '@astra/shared/protocol';
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
import { along, openGround } from './faunaWorld.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';

type Answer = Extract<ServerMessage, { t: 'cast' }>;
type CastEvent = Extract<GameEvent, { kind: 'cast' }>;

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

/** A level-16 character (Tier II nodes are open to it). */
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
    input(pos: Readonly<Vec3>, opts: { beam?: boolean; look?: Vec3; mode?: 'foot' | 'ship' } = {}) {
      sock.send({
        t: 'input',
        seq: ++inputSeq,
        time: time(),
        mode: opts.mode ?? 'foot',
        pose: { frame: FRAME, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
        buttons: opts.beam ? 1 : 0,
        ...(opts.look ? { aim: lookQuat(opts.look) } : {}),
      });
    },
    async stand(pos: Readonly<Vec3>, mode: 'foot' | 'ship' = 'foot') {
      bot.input(pos, { mode });
      await waitFor(() => {
        const f = zone.entity(welcome.entityId)?.fields;
        return f?.mode === mode && f.frame === FRAME && Math.hypot(f.pos[0] - pos[0], f.pos[1] - pos[1], f.pos[2] - pos[2]) < 1e-6;
      });
    },
    async slot(index: number, node: string, bar: 'ground' | 'ship' = 'ground') {
      const s = ++skillSeq;
      sock.send({ t: 'skills', seq: s, op: { op: 'slot', bar, index, node } });
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
    /** the cast events of `node` */
    casts: (node: string): CastEvent[] => sock.received.flatMap((m) => (m.t === 'event' && m.event.kind === 'cast' && m.event.node === node ? [m.event] : [])),
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
/** The heat the cast left, at the moment it was cast (the answer says when it is ready again): heat cools while the test reads it. */
const heatCast = (id: string, answer: Answer, cooldownS: number) => server.ws.meters.view(id, answer.readyAt! - cooldownS).heat;

const info = (zone: Zone, id: number) => zone.fauna!.creatures().find((c) => c.id === id)!;

/** What the movement authority says of the caster's fall, as a test scripts it: the authority is not on in this server (the bots
 * stand on the world with raw poses), and its own `fall` is tested in sim/movement/gravitic.test.ts. */
function scriptFall(zone: Zone, script: () => { aboveM: number; peakM: number } | null): () => void {
  Object.defineProperty(zone, 'movement', { value: { fall: script, hold: () => true, pulsing: () => false, setPoses: () => {}, remove: () => undefined }, configurable: true });
  return () => Object.defineProperty(zone, 'movement', { value: null, configurable: true });
}

const feetOf = (zone: Zone, id: number) => zone.entity(id)!.fields.pos as Vec3;
const apart = (a: Readonly<Vec3>, b: Readonly<Vec3>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('Gravitic over the wire', () => {
  it(
    'Pull: 15 heat, a 10 s cooldown; a creature 25 m away is yanked to the caster’s feet, and with Pull Many so are the two nearest others',
    { timeout: 40_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['pull', 'pull_many']);
      expect((await bot.slot(0, 'pull')).error).toBeUndefined();
      const stand = at(0);
      await bot.stand(stand);
      while (!nodeGrounds.ground(params, 0)) await sleep(100);
      const named = creature(bot.zone, at(23));
      const second = creature(bot.zone, at(10, 4));
      const third = creature(bot.zone, at(15, -5));
      const left = creature(bot.zone, at(22, 9));
      const player = await character();
      const rival = await join(player.token, player.id);
      await rival.stand(at(8, 8));
      expect(getSkillNode('pull').params.rangeM).toBe(25);
      expect(apart(feetOf(bot.zone, named), stand)).toBeGreaterThan(22);
      const h0 = heat(c.id);
      // (a player is no target until PvP)
      expect(await bot.cast('pull', 0, { target: rival.entity })).toMatchObject({ result: 'refused', reason: 'target' });
      const answer = await bot.cast('pull', 0, { target: named });
      expect(answer).toMatchObject({ result: 'cast', node: 'pull' });
      expect(answer.readyAt! - bot.time()).toBeCloseTo(cooldownOf(getSkillNode('pull'))!.seconds, 0);
      expect(heatCast(c.id, answer, 10) - h0).toBeGreaterThan(15 - 2);
      expect(bot.casts('pull')).toMatchObject([{ caster: bot.entity, target: named, phase: 'cast' }]);
      await waitFor(() => !info(bot.zone, named).pulled && !info(bot.zone, second).pulled && !info(bot.zone, third).pulled, 4000, 'the pull to end');
      const ground = (id: number) => info(bot.zone, id).pos;
      for (const id of [named, second, third]) expect(apart(ground(id), stand), `creature ${id}`).toBeLessThan(N.pull.landM + 6);
      expect(apart(ground(left), stand)).toBeGreaterThan(15);
      bot.sock.close();
      rival.sock.close();
    },
  );

  it('Pull without Pull Many takes the one creature it names', { timeout: 40_000 }, async () => {
    const c = await character();
    const bot = await join(c.token, c.id);
    own(c.id, ['pull']);
    expect((await bot.slot(0, 'pull')).error).toBeUndefined();
    const stand = at(0);
    await bot.stand(stand);
    while (!nodeGrounds.ground(params, 0)) await sleep(100);
    const named = creature(bot.zone, at(20));
    const other = creature(bot.zone, at(10, 4));
    expect(await bot.cast('pull', 0, { target: named })).toMatchObject({ result: 'cast' });
    await waitFor(() => apart(info(bot.zone, named).pos, stand) < N.pull.landM + 6, 4000, 'the creature to arrive');
    expect(apart(info(bot.zone, other).pos, stand)).toBeGreaterThan(8);
    bot.sock.close();
  });

  it(
    'Well: 30 heat, a 20 s cooldown; creatures in the 12 m bubble keep 40% of their speed for 8 s: a fleeing one runs a 0.4 share of the ground one outside does',
    { timeout: 40_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['pull', 'well']);
      expect((await bot.slot(0, 'well')).error).toBeUndefined();
      await bot.stand(at(0));
      while (!nodeGrounds.ground(params, 0)) await sleep(100);
      const inside = creature(bot.zone, at(3));
      const outside = creature(bot.zone, at(0, 16));
      const h0 = heat(c.id);
      const answer = await bot.cast('well', 0);
      expect(answer).toMatchObject({ result: 'cast', node: 'well' });
      expect(answer.readyAt! - bot.time()).toBeCloseTo(20, 0);
      expect(heatCast(c.id, answer, 20) - h0).toBeGreaterThan(30 - 2);
      expect(getSkillNode('well').params).toMatchObject({ radiusM: 12, slowMult: 0.4, durationS: 8 });
      await waitFor(() => info(bot.zone, inside).slow === 0.4, 3000, 'the bubble');
      expect(info(bot.zone, outside).slow).toBe(1);
      bot.zone.fauna!.hurt(inside, bot.entity, 1);
      bot.zone.fauna!.hurt(outside, bot.entity, 1);
      const before = { inside: info(bot.zone, inside).pos, outside: info(bot.zone, outside).pos };
      await sleep(1200);
      const ran = { inside: apart(info(bot.zone, inside).pos, before.inside), outside: apart(info(bot.zone, outside).pos, before.outside) };
      expect(ran.outside).toBeGreaterThan(2);
      expect(ran.inside / ran.outside).toBeLessThan(0.7);
      expect(ran.inside / ran.outside).toBeGreaterThan(0.2);
      bot.sock.close();
    },
  );

  it(
    'Slam: 25 heat, a 14 s cooldown; refused standing, and cast in the air it knocks the creatures in its radius down where the caster lands, the radius grown with the fall',
    { timeout: 40_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['pull', 'slam']);
      expect((await bot.slot(0, 'slam')).error).toBeUndefined();
      await bot.stand(at(0));
      while (!nodeGrounds.ground(params, 0)) await sleep(100);
      const close = creature(bot.zone, at(5));
      const mid = creature(bot.zone, at(12, 4));
      const far = creature(bot.zone, at(40));
      let air: { aboveM: number; peakM: number } = { aboveM: 0, peakM: 0 };
      const restore = scriptFall(bot.zone, () => air);
      try {
        expect(await bot.cast('slam', 0)).toMatchObject({ result: 'refused', reason: 'target' });
        air = { aboveM: 12, peakM: 14 };
        const h0 = heat(c.id);
        const answer = await bot.cast('slam', 0);
        expect(answer).toMatchObject({ result: 'cast', node: 'slam' });
        expect(answer.readyAt! - bot.time()).toBeCloseTo(14, 0);
        expect(heatCast(c.id, answer, 14) - h0).toBeGreaterThan(25 - 2);
        expect(bot.casts('slam')).toMatchObject([{ caster: bot.entity }]);
        await sleep(300);
        expect(info(bot.zone, close).downUntil).toBe(0);
        air = { aboveM: 0, peakM: 0 };
        await waitFor(() => info(bot.zone, close).downUntil > 0, 4000, 'the landing');
        expect(slamRadius(14)).toBeCloseTo(6 + (12 * 11) / 17, 5);
        await waitFor(() => info(bot.zone, close).state === 'down', 2000, 'the creature to lie down');
        expect(info(bot.zone, mid).downUntil).toBeGreaterThan(0);
        expect(info(bot.zone, far).downUntil).toBe(0);
      } finally {
        restore();
      }
      bot.sock.close();
    },
  );

  it('Tractor Beam: 15 charge on the ship bar, a 12 s cooldown, cast at nothing it draws rocks (the client’s), and a player is no ship to hold until PvP', { timeout: 40_000 }, async () => {
    const c = await character();
    const bot = await join(c.token, c.id);
    own(c.id, ['tractor_beam', 'inertial_brake']);
    expect((await bot.slot(0, 'tractor_beam', 'ship')).error).toBeUndefined();
    expect((await bot.slot(1, 'inertial_brake', 'ship')).error).toBeUndefined();
    const up = at(0).map((x) => x * 1.002) as Vec3;
    await bot.stand(up, 'ship');
    const other = await character();
    const rival = await join(other.token, other.id);
    await rival.stand(up.map((x) => x * 1.00002) as Vec3, 'ship');
    expect(getSkillNode('tractor_beam').params).toMatchObject({ holdS: 3, targets: 1 });
    const charge0 = server.ws.meters.view(c.id, server.world.clock.now()).charge;
    expect(await bot.cast('tractor_beam', 0, { target: rival.entity })).toMatchObject({ result: 'refused', reason: 'target' });
    const answer = await bot.cast('tractor_beam', 0);
    expect(answer).toMatchObject({ result: 'cast', node: 'tractor_beam' });
    expect(answer.readyAt! - bot.time()).toBeCloseTo(12, 0);
    expect(charge0 - server.ws.meters.view(c.id, server.world.clock.now()).charge).toBeGreaterThan(15 - 2);
    expect(bot.casts('tractor_beam')).toMatchObject([{ caster: bot.entity, phase: 'cast' }]);
    bot.sock.close();
    rival.sock.close();
  });

  it('Inertial Brake: 20 charge on the ship bar, a 15 s cooldown; the cast is shown to the sessions that see the ship, whose client stops and turns it', { timeout: 40_000 }, async () => {
    const c = await character();
    const bot = await join(c.token, c.id);
    own(c.id, ['tractor_beam', 'inertial_brake']);
    expect((await bot.slot(0, 'inertial_brake', 'ship')).error).toBeUndefined();
    const up = at(0).map((x) => x * 1.002) as Vec3;
    await bot.stand(up, 'ship');
    const charge0 = server.ws.meters.view(c.id, server.world.clock.now()).charge;
    const answer = await bot.cast('inertial_brake', 0);
    expect(answer).toMatchObject({ result: 'cast', node: 'inertial_brake' });
    expect(answer.readyAt! - bot.time()).toBeCloseTo(15, 0);
    expect(charge0 - server.ws.meters.view(c.id, server.world.clock.now()).charge).toBeGreaterThan(20 - 2);
    expect(getSkillNode('inertial_brake').params.durationS).toBe(6);
    expect(bot.casts('inertial_brake')).toMatchObject([{ caster: bot.entity, phase: 'cast' }]);
    bot.sock.close();
  });

  it('Dense Bones: +20% health, there for a suit bought mid-session', { timeout: 40_000 }, async () => {
    const c = await character();
    const bot = await join(c.token, c.id);
    await bot.stand(at(0));
    const suitMax = () => bot.zone.combat.playerHealth(bot.entity)!.suitMax;
    own(c.id, ['pull']);
    const before = suitMax();
    own(c.id, ['dense_bones']);
    await waitFor(() => suitMax() > before, 4000, 'the suit to re-tune');
    expect(suitMax()).toBeCloseTo(before * 1.2, 9);
    bot.sock.close();
  });
});
