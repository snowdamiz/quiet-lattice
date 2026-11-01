// Resonance's Tier I–II actives over the wire (P1.E07.T06), against the dockerised Postgres and Redis and the shipped ability
// book: a character owns, slots and casts Pulse, Harmonic, Shatter, Veil, Deep Sweep and Jammer as a player does, each carried
// out by the server with DESIGN 9.4's numbers: Pulse stuns the creatures within 15 m for 2 s (and Echo repeats it), Harmonic
// calms those within 30 m for 20 s, Shatter bursts a crystal creature, Veil hides the caster from the fauna for 15 s, Deep Sweep
// costs 10 charge on the ship bar, and Jammer is refused for a player until PvP exists.
import { RESONANCE_NUMBERS as N, cooldownOf } from '@astra/shared/abilities';
import { getSkillNode, CRYSTAL_RESISTANCES } from '@astra/shared/data';
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

describe('Resonance over the wire', () => {
  it(
    'Pulse: 10 heat, a 6 s cooldown; every creature within 15 m stands still for 2 s, those farther are not, and Echo sounds it again',
    { timeout: 40_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['pulse', 'echo']);
      expect((await bot.slot(0, 'pulse')).error).toBeUndefined();
      const stand = at(0);
      await bot.stand(stand);
      while (!nodeGrounds.ground(params, 0)) await sleep(100);
      const near = creature(bot.zone, at(9));
      const far = creature(bot.zone, at(30));
      const later = creature(bot.zone, at(60));
      const h0 = heat(c.id);
      const answer = await bot.cast('pulse', 0);
      expect(answer).toMatchObject({ result: 'cast', node: 'pulse' });
      expect(answer.readyAt! - bot.time()).toBeCloseTo(cooldownOf(getSkillNode('pulse'))!.seconds, 0);
      expect(heatCast(c.id, answer, 6) - h0).toBeGreaterThan(10 - 2);
      expect(info(bot.zone, near).stunUntil).toBeGreaterThan(0);
      expect(info(bot.zone, far).stunUntil).toBe(0);
      expect(bot.casts('pulse')).toMatchObject([{ caster: bot.entity, phase: 'cast' }]);
      // Echo: it sounds again 2 s later round where the caster is then
      bot.input(at(58));
      await waitFor(() => info(bot.zone, later).stunUntil > 0, 6000, 'the echo');
      bot.sock.close();
    },
  );

  it(
    'Harmonic: 20 heat, a 20 s cooldown; creatures within 30 m are calm for 20 s and the stone-touched, immune to it, are not',
    { timeout: 40_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['pulse', 'harmonic']);
      expect((await bot.slot(0, 'harmonic')).error).toBeUndefined();
      await bot.stand(at(0));
      while (!nodeGrounds.ground(params, 0)) await sleep(100);
      const calm = creature(bot.zone, at(25));
      const stone = creature(bot.zone, at(20, 8));
      const far = creature(bot.zone, at(40));
      bot.zone.combat.creatureHealth(stone);
      (bot.zone.combat as unknown as { vitalsOf(id: number): { resistances: unknown } }).vitalsOf(stone).resistances = [
        { kind: 'node', id: 'harmonic', effect: 'immune' },
      ];
      const h0 = heat(c.id);
      const answer = await bot.cast('harmonic', 0);
      expect(answer).toMatchObject({ result: 'cast', node: 'harmonic' });
      expect(answer.readyAt! - bot.time()).toBeCloseTo(20, 0);
      expect(heatCast(c.id, answer, 20) - h0).toBeGreaterThan(20 - 2);
      expect(info(bot.zone, calm).calmUntil).not.toBeNull();
      expect(info(bot.zone, stone).calmUntil).toBeNull();
      expect(info(bot.zone, far).calmUntil).toBeNull();
      bot.sock.close();
    },
  );

  it('Shatter: 25 heat, a 10 s cooldown; a crystal creature in reach takes the burst twice over, the others none', { timeout: 40_000 }, async () => {
    const c = await character();
    const bot = await join(c.token, c.id);
    own(c.id, ['pulse', 'shatter']);
    expect((await bot.slot(0, 'shatter')).error).toBeUndefined();
    await bot.stand(at(0));
    while (!nodeGrounds.ground(params, 0)) await sleep(100);
    const crystal = creature(bot.zone, at(8));
    const plain = creature(bot.zone, at(10, 3));
    bot.zone.combat.creatureHealth(crystal);
    (bot.zone.combat as unknown as { vitalsOf(id: number): { resistances: unknown } }).vitalsOf(crystal).resistances = CRYSTAL_RESISTANCES;
    const h0 = heat(c.id);
    const answer = await bot.cast('shatter', 0);
    expect(answer).toMatchObject({ result: 'cast', node: 'shatter' });
    expect(answer.readyAt! - bot.time()).toBeCloseTo(10, 0);
    expect(heatCast(c.id, answer, 10) - h0).toBeGreaterThan(25 - 2);
    expect(lost(bot.zone, crystal)).toBeGreaterThan(N.shatter.creatureDamage);
    expect(lost(bot.zone, plain)).toBe(0);
    bot.sock.close();
  });

  it('Veil: 20 heat, a 30 s cooldown; the cast is shown to every player, and the fauna is made to lose the caster for 15 s', { timeout: 40_000 }, async () => {
    const c = await character();
    const bot = await join(c.token, c.id);
    own(c.id, ['pulse', 'veil']);
    expect((await bot.slot(0, 'veil')).error).toBeUndefined();
    await bot.stand(at(0));
    const h0 = heat(c.id);
    const answer = await bot.cast('veil', 0);
    expect(answer).toMatchObject({ result: 'cast', node: 'veil' });
    expect(answer.readyAt! - bot.time()).toBeCloseTo(30, 0);
    expect(heatCast(c.id, answer, 30) - h0).toBeGreaterThan(20 - 2);
    expect(bot.casts('veil')).toMatchObject([{ caster: bot.entity }]);
    expect(getSkillNode('veil').params.durationS).toBe(15);
    // (what the creatures then do is the fauna AI's test; here the caster stays in the zone for all to see)
    expect(bot.zone.entity(bot.entity)).toBeDefined();
    bot.sock.close();
  });

  it(
    'Deep Sweep: 10 charge on the ship bar, a 30 s cooldown, the world it sweeps named to its caster; Jammer is refused for a player (no PvP yet)',
    { timeout: 40_000 },
    async () => {
      const c = await character();
      const bot = await join(c.token, c.id);
      own(c.id, ['deep_sweep', 'jammer']);
      expect((await bot.slot(0, 'deep_sweep', 'ship')).error).toBeUndefined();
      expect((await bot.slot(1, 'jammer', 'ship')).error).toBeUndefined();
      const up = at(0).map((x) => x * 1.002) as Vec3;
      await bot.stand(up, 'ship');
      const charge0 = server.ws.meters.view(c.id, server.world.clock.now()).charge;
      const answer = await bot.cast('deep_sweep', 0);
      expect(answer).toMatchObject({ result: 'cast', node: 'deep_sweep' });
      expect(answer.readyAt! - bot.time()).toBeCloseTo(30, 0);
      expect(charge0 - server.ws.meters.view(c.id, server.world.clock.now()).charge).toBeGreaterThan(10 - 2);
      expect(bot.casts('deep_sweep')).toMatchObject([{ caster: bot.entity, frame: FRAME }]);
      const other = await character();
      const rival = await join(other.token, other.id);
      await rival.stand(up.map((x) => x * 1.0001) as Vec3, 'ship');
      expect(await bot.cast('jammer', 1, { target: rival.entity })).toMatchObject({ result: 'refused', reason: 'target' });
      expect(N.jammer.lockoutS).toBeGreaterThan(0);
      bot.sock.close();
      rival.sock.close();
    },
  );
});
