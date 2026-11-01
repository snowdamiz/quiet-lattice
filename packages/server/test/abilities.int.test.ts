// Abilities over the wire (P1.E07.T03, ARCHITECTURE §28), against the dockerised Postgres and Redis: a character with the
// test ability slotted on every key casts it from each of slots 1–6 on foot and 1–4 flying a four-slot hull, each cast
// checked, paid, cooled down and run by the server and told to the caster and to a player beside it; and each refusal
// (not owned, not slotted, cooling down, the heat lockout, Charge short, out of range, unseen) reaches the client with its
// reason, changing nothing. Cooldowns are the server's: they are sent on join and survive a reconnect. A toggle the server
// ends (its node unslotted, its caster out of the bar's mode, its connection gone or replaced) reaches the player's bar;
// its effect's timers run while its character is in play and are dropped once its last connection closes.
import { cooldownOf } from '@astra/shared/abilities';
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
import type { Zone, ZoneViewer } from '../src/zones/zone.ts';
import { CAST_PER_S } from '../src/abilities/service.ts';
import { FIXTURE_GROUND, FIXTURE_SHIP, FIXTURE_TIMER_S, FIXTURE_TOGGLE, fixtureBook } from './abilityFixture.ts';
import { along, openGround } from './faunaWorld.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';

type Answer = Extract<ServerMessage, { t: 'cast' }>;
type CastEvent = Extract<GameEvent, { kind: 'cast' }>;

const HOME = homeSystemOf('thalune');
const system = describeZoneSystem(HOME);
const docile = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer' && x.spawn === 'herd');
/** A world of the home system with a docile walker at Tier 0. */
const body = system.bodies.find((b) => b.type !== 'gas' && docile(faunaSpecies(b.params as PlanetParams, 0)))!;
const params = body.params as PlanetParams;
const FRAME = frameId(system.seed, body.index)!;
const walker = docile(faunaSpecies(params, 0))!;
const g = groundOf(params, 0);
const spot = openGround(g);
const [t, b] = tangents(spot);
/** The point on the ground `east` and `north` metres from the spot, `up` over it. */
const at = (east: number, north = 0, up = 0): Vec3 => {
  const d = along(spot, t, b, east, north, g.radius);
  const r = g.radius + g.sample(d) + up;
  return [d[0] * r, d[1] * r, d[2] * r];
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const config = parseConfig(process.env);
let database: Database;
let server: RunningServer;
const fixture = fixtureBook();

beforeAll(async () => {
  database = createDatabase(config.DATABASE_URL, { max: 2 });
  // (bots stand on the world with raw poses: a cast reads the mode the zone believes, which here is the client's)
  server = await startTestServer({}, { movement: false, abilities: fixture.book });
});

afterAll(async () => {
  await server?.close();
  await database?.close();
});

/** A level-16 character owning and slotting the test ability on every ground key and on four ship keys of a Wayfarer. */
async function character() {
  const acct = await newAccount(server);
  const id = (await newCharacter(server, acct.token, { people: 'thalune' })).id;
  await database.db
    .update(characters)
    .set({ level: 16, state: { ship: { v: 1, data: { hull: 'wayfarer', modules: {}, cargoPods: 1, livery: 0 } } } })
    .where(eq(characters.id, id));
  return { token: acct.token, id };
}

/** A bot of a character, joined: it stands on the world or flies over it, casts, and hears the answers. */
async function join(token: string, characterId: string) {
  const sock = await TestSocket.open(server.wsUrl);
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  await sock.next('meters');
  const abilities = await sock.next('abilities');
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
    abilities,
    entity: welcome.entityId,
    time,
    /** stands at a point of the world on foot, or flies there, once the server has it there */
    async stand(pos: Readonly<Vec3>, mode: 'foot' | 'ship' = 'foot') {
      sock.send({ t: 'input', seq: ++inputSeq, time: time(), mode, pose: { frame: FRAME, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
      await waitFor(() => {
        const f = zone.entity(welcome.entityId)?.fields;
        return f?.mode === mode && f.frame === FRAME && Math.hypot(f.pos[0] - pos[0], f.pos[1] - pos[1], f.pos[2] - pos[2]) < 1e-6;
      });
    },
    /** slots a node as a player does, or empties the slot */
    async slot(bar: 'ground' | 'ship', index: number, node: string | null) {
      const s = ++skillSeq;
      sock.send({ t: 'skills', seq: s, op: node === null ? { op: 'unslot', bar, index } : { op: 'slot', bar, index, node } });
      for (;;) {
        const m = await sock.next('skills');
        if (m.seq === s) return m;
      }
    },
    /** the toggles on in the last `abilities` state it was sent */
    on: () => sock.received.filter((m): m is Extract<ServerMessage, { t: 'abilities' }> => m.t === 'abilities').at(-1)?.on,
    /** casts `node` from `slot`, within the cast rate; the server's answer (the abilities state is sent before it, when it
     * was carried out) */
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
    events: (): CastEvent[] => sock.received.flatMap((m) => (m.t === 'event' && m.event.kind === 'cast' ? [m.event] : [])),
  };
  return bot;
}

/** Owns every fixture node (and the Tier I nodes they stand on), as trainers and monoliths would unlock them. */
function own(id: string): void {
  for (const node of [
    'pull',
    'pulse',
    'lance',
    'bond',
    'vent',
    'sear',
    'harmonic',
    'regrow',
    'tractor_beam',
    'deep_sweep',
    'repair_drones',
    'inertial_brake',
  ]) {
    expect(server.ws.skills.unlock(id, node, { kind: 'dev' }), node).toMatchObject({ ok: true });
    expect(server.ws.skills.buy(id, node), node).toMatchObject({ ok: true });
  }
}

/** A creature of the walker species on the ground at `feet`. */
function creature(zone: Zone, feet: Readonly<Vec3>): number {
  return zone.fauna!.spawnHerd({ body: body.index, species: walker.index, at: [...feet], count: 1, level: 2 })!.creatures[0]!;
}

/** Whether the session holding entity `viewer` sees entity `id` (its interest set at the last tick). */
function sees(zone: Zone, viewer: number, id: number): boolean {
  const v = [...zone.viewers()].find(([, e]) => e === viewer)?.[0];
  return !!v && zone.sees(v, id);
}

describe('abilities over the wire', () => {
  it(
    'casts the test ability from each of slots 1–6 on foot and 1–4 in flight, refuses with its reason, and keeps the server’s cooldowns',
    { timeout: 60_000 },
    async () => {
      const c = await character();
      let bot = await join(c.token, c.id);
      expect(bot.abilities).toEqual({ t: 'abilities', cooldowns: [], on: [] });
      own(c.id);
      for (const [i, a] of FIXTURE_GROUND.entries()) expect((await bot.slot('ground', i, a.node)).error, a.node).toBeUndefined();
      for (const [i, a] of FIXTURE_SHIP.entries()) expect((await bot.slot('ship', i, a.node)).error, a.node).toBeUndefined();

      // docked, no bar casts
      expect(await bot.cast('pulse', 0)).toMatchObject({ result: 'refused', reason: 'mode' });

      // on foot on the world, a creature 12 m off and a player beside it who sees the casts
      await bot.stand(at(0));
      const other = await character();
      const near = await join(other.token, other.id);
      await near.stand(at(8, 8));
      while (!nodeGrounds.ground(params, 0)) await sleep(100);
      const mob = creature(bot.zone, at(12));
      await waitFor(() => sees(bot.zone, near.entity, bot.entity), 5000, 'the caster in its neighbour’s view');

      // keys 1–6: each slot's node cast, paid in heat, its cooldown the server's, its effect run once
      const heat = () => server.ws.meters.view(c.id, server.world.clock.now()).heat;
      for (const [i, a] of FIXTURE_GROUND.entries()) {
        const node = getSkillNode(a.node);
        // (its turn within the cast rate first, so the heat is read just before it goes)
        await sleep(1000 / CAST_PER_S);
        const before = heat();
        const r = await bot.cast(a.node, i, a.target === 'entity' ? { target: mob } : {});
        expect(r, a.node).toMatchObject({ result: 'cast', node: a.node, slot: i });
        // (less what cooled while the cast was on its way)
        expect(heat() - before, a.node).toBeGreaterThan((node.cost?.heat ?? 0) - 2);
        expect(heat() - before, a.node).toBeLessThanOrEqual(node.cost?.heat ?? 0);
        expect(r.readyAt! - bot.time(), a.node).toBeCloseTo(cooldownOf(node)!.seconds, 0);
      }
      expect(fixture.casts.map((x) => x.node.id)).toEqual(FIXTURE_GROUND.map((a) => a.node));
      expect(fixture.casts.filter((x) => x.target === mob)).toHaveLength(2);
      const state = bot.sock.received.filter((m): m is Extract<ServerMessage, { t: 'abilities' }> => m.t === 'abilities').at(-1)!;
      expect(state.cooldowns.map((x) => x.node).sort()).toEqual(FIXTURE_GROUND.map((a) => a.node).sort());
      // told to the caster and to the player beside it; what the casts at the creature did follows as combat events
      await waitFor(() => near.events().length === 6, 5000, 'the casts in the neighbour’s events');
      expect(bot.events().map((e) => [e.caster, e.node])).toEqual(FIXTURE_GROUND.map((a) => [bot.entity, a.node]));
      expect(near.events().map((e) => e.node)).toEqual(FIXTURE_GROUND.map((a) => a.node));
      expect(near.events()[1]).toMatchObject({ target: mob, frame: FRAME, phase: 'cast' });
      await waitFor(
        () => bot.sock.received.some((m) => m.t === 'event' && m.event.kind === 'combat' && m.event.target === mob && m.event.ability === 'pull'),
        5000,
        'Pull’s hit',
      );

      // refused with the reason, nothing changed: cooling down, not owned, not slotted, out of range, unseen
      const before = fixture.casts.length;
      const cd = await bot.cast('pulse', 0);
      expect(cd).toMatchObject({ result: 'refused', reason: 'cooldown' });
      expect(cd.readyAt).toBe(state.cooldowns.find((x) => x.node === 'pulse')!.readyAt);
      expect(await bot.cast('well', 0)).toMatchObject({ result: 'refused', reason: 'not_owned' });
      expect(await bot.cast('pull', 0)).toMatchObject({ result: 'refused', reason: 'not_slotted' });
      const far = creature(bot.zone, at(60));
      expect(await bot.cast('sear', 3, { target: far })).toMatchObject({ result: 'refused', reason: 'cooldown' });
      // (another character with the same bars, out of its cooldowns)
      const third = await character();
      const fresh = await join(third.token, third.id);
      own(third.id);
      await fresh.slot('ground', 1, 'pull');
      await fresh.slot('ground', 3, 'sear');
      await fresh.stand(at(2));
      expect(await fresh.cast('sear', 3, { target: far })).toMatchObject({ result: 'refused', reason: 'range' });
      const sealed = { id: 9_000_001, characterId: 'phase-owner', sendBinary: () => {} } as ZoneViewer;
      fresh.zone.join(sealed, { kind: 'player', frame: FRAME, pos: at(30, 30), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
      const theirs = fresh.zone.phases.phaseFor(sealed, 'story', { key: 'test:abilities', frame: FRAME, center: at(10), radius: 100 });
      const hidden = fresh.zone.phases.spawn(theirs.id, {
        kind: 'mob',
        frame: FRAME,
        pos: at(10),
        quat: [0, 0, 0, 1],
        vel: [0, 0, 0],
        species: walker.index,
        level: 1,
        hp: 1,
      });
      expect(await fresh.cast('pull', 1, { target: hidden })).toMatchObject({ result: 'refused', reason: 'unseen' });
      // the heat lockout; and flying, Charge short
      server.ws.meters.addHeat(third.id, 100, server.world.clock.now());
      await fresh.slot('ground', 0, 'pulse');
      expect(await fresh.cast('pulse', 0)).toMatchObject({ result: 'refused', reason: 'heat' });
      await fresh.slot('ship', 0, 'tractor_beam');
      await fresh.stand(at(2, 0, 60), 'ship');
      const now = server.world.clock.now();
      expect(server.ws.meters.spendCharge(third.id, server.ws.meters.view(third.id, now).charge - 5, now).ok).toBe(true);
      expect(await fresh.cast('tractor_beam', 0)).toMatchObject({ result: 'refused', reason: 'charge' });
      expect(fixture.casts.length).toBe(before);
      fresh.zone.phases.close(theirs.id);
      fresh.zone.leave(sealed);
      fresh.sock.close();

      // flying the Wayfarer over the world, keys 1–4 cast the ship bar's, paid in Charge
      await bot.stand(at(0, 0, 60), 'ship');
      const charge = () => server.ws.meters.view(c.id, server.world.clock.now()).charge;
      const ready = new Map<string, number>();
      for (const [i, a] of FIXTURE_SHIP.entries()) {
        const cost = getSkillNode(a.node).cost!.charge!;
        // (its turn within the cast rate first, so the Charge is read just before it goes)
        await sleep(1000 / CAST_PER_S);
        const before = charge();
        const r = await bot.cast(a.node, i);
        expect(r, a.node).toMatchObject({ result: 'cast', node: a.node, slot: i });
        ready.set(a.node, r.readyAt!);
        // (less what the sun gave back while the cast was on its way)
        expect(before - charge(), a.node).toBeGreaterThan(cost - 2);
        expect(before - charge(), a.node).toBeLessThanOrEqual(cost);
      }
      expect(fixture.casts.slice(-4).map((x) => [x.node.id, x.bar])).toEqual(FIXTURE_SHIP.map((a) => [a.node, 'ship']));
      // a fifth slot the Wayfarer does not have; the ground bar's nodes are not the ship's
      expect(await bot.cast('pulse', 4)).toMatchObject({ result: 'refused', reason: 'slot' });
      expect(await bot.cast('pulse', 0)).toMatchObject({ result: 'refused', reason: 'not_slotted' });

      // the cooldowns are the server's: they come back with the character on a new connection
      bot.sock.close();
      await waitFor(() => !server.ws.registry.holding(c.id), 5000, 'the old connection gone');
      bot = await join(c.token, c.id);
      for (const [node, readyAt] of ready) expect(bot.abilities.cooldowns, node).toContainEqual({ node, readyAt });
      await bot.stand(at(0, 0, 60), 'ship');
      expect(await bot.cast('tractor_beam', 0)).toMatchObject({ result: 'refused', reason: 'cooldown', readyAt: ready.get('tractor_beam') });
      near.sock.close();
      bot.sock.close();
    },
  );

  it(
    'tells the player’s bar of a toggle the server ended: its node unslotted, out of the bar’s mode, its connection replaced or closed; drops its timers with the last connection',
    { timeout: 30_000 },
    async () => {
      const c = await character();
      let bot = await join(c.token, c.id);
      own(c.id);
      await bot.slot('ground', 0, FIXTURE_TOGGLE.node);
      await bot.stand(at(0, 40));
      const ends = () => fixture.ends.filter((x) => x.characterId === c.id);
      const on = async () => {
        expect(await bot.cast('lance', 0)).toMatchObject({ result: 'cast' });
        expect(bot.on()).toEqual(['lance']);
        return fixture.casts.at(-1)!;
      };

      let lit = await on();
      expect((await bot.slot('ground', 0, null)).error).toBeUndefined();
      expect(bot.on()).toEqual([]);
      expect(ends().at(-1)).toBe(lit);
      await waitFor(() => fixture.timers.includes(lit), 5000, 'the toggle’s timer');

      await bot.slot('ground', 0, FIXTURE_TOGGLE.node);
      lit = await on();
      await bot.stand(at(0, 40, 60), 'ship');
      await waitFor(() => bot.on()?.length === 0, 5000, 'the toggle off in flight');
      expect(ends().at(-1)).toBe(lit);

      // a new connection for the character: the old one's entity has left, its toggle is never sent as on and goes off
      await bot.stand(at(0, 40));
      lit = await on();
      const old = bot;
      bot = await join(c.token, c.id);
      expect(bot.abilities.on).toEqual([]);
      await waitFor(() => ends().at(-1) === lit, 5000, 'the replaced connection’s toggle ended');
      expect(server.ws.casts.state(c.id).on).toEqual([]);
      old.sock.close();

      await bot.stand(at(0, 40));
      lit = await on();
      bot.sock.close();
      await waitFor(() => ends().at(-1) === lit, 5000, 'the closed connection’s toggle ended');
      expect(server.ws.casts.state(c.id).on).toEqual([]);
      await sleep(FIXTURE_TIMER_S * 2000);
      expect(fixture.timers).not.toContain(lit);
    },
  );
});
