// Shipped gateway/book, real movement, meters, fauna, codex, Postgres and Redis; no injected ability effects.
import { SYMBIOTIC_NUMBERS as N } from '@astra/shared/abilities';
import { SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import { getSkillNode } from '@astra/shared/data';
import { faunaSpecies, frameId, type Vec3, type FaunaSpecies } from '@astra/shared/world';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters } from '../src/db/schema.ts';
import { tangents } from '../src/fauna/herds.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import { planGround } from '../src/sim/movement/authority.ts';
import type { RunningServer } from '../src/server.ts';
import type { Zone } from '../src/zones/zone.ts';
import { along, dist, openGround } from './faunaWorld.ts';
import { startTestServer, uniqueShard, waitFor } from './helpers.ts';
import { ManualClock, Pilot } from './pilot.ts';

let server: RunningServer;
let database: Database;
const clock = new ManualClock();
const pilots = new Set<Pilot>();
let sequence = 0;

beforeAll(async () => {
  // URLs are supplied before Vitest imports this module; startTestServer migrates process.env, not its config override.
  server = await startTestServer(
    { LOG_LEVEL: 'warn' },
    { shard: uniqueShard(), clock: { monoNow: clock.now, wallNow: () => Date.UTC(2026, 0, 1) + 1_000_000 } },
  );
  server.zones.stop();
  server.ws.casts.stop();
  database = createDatabase(parseConfig(process.env).DATABASE_URL, { max: 2 });
  const [route] = await database.sql`select current_database() as db, current_user as usr, inet_server_port() as port`;
  expect(route?.db).toBe(new URL(server.config.DATABASE_URL).pathname.slice(1));
  expect(route?.usr).toBe('astra');
  expect(route?.port).toBe(5432);
});
afterEach(async () => {
  for (const p of pilots) p.close();
  for (const p of pilots) await p.sock.closed;
  await waitFor(() => [...pilots].every((p) => server.persistence.status(p.characterId)?.inPlay !== true));
  pilots.clear();
});
afterAll(async () => {
  await server?.close();
  await database?.close();
});

async function handled(p: Pilot) {
  const id = ++sequence;
  p.sock.send({ t: 'ping', id, clientTime: 0 });
  for (;;) if ((await p.sock.next('pong')).id === id) return;
}
function advance(seconds: number, meters = false) {
  for (let i = 0; i < Math.round(seconds * 20); i++) {
    clock.advance(50);
    const now = server.world.clock.now();
    server.zones.runTick(now, clock.ms);
    server.ws.casts.step(now);
    if (meters) server.ws.meters.sweep(now);
  }
}
async function own(p: Pilot, nodes: string[]) {
  for (const node of nodes) {
    const u = server.ws.skills.unlock(p.characterId, node, { kind: 'dev' });
    expect(u.ok || u.error.code === 'already_unlocked', node).toBe(true);
    expect(server.ws.skills.buy(p.characterId, node).ok, node).toBe(true);
  }
  for (const node of nodes) {
    const bar = getSkillNode(node).slot;
    if (bar === null) continue;
    const seq = ++sequence;
    p.sock.send({ t: 'skills', seq, op: { op: 'slot', bar, index: server.ws.skills.get(p.characterId)!.slots[bar].indexOf(null), node } });
    for (;;) {
      const m = await p.sock.next('skills');
      if (m.seq !== seq) continue;
      expect(m.error).toBeUndefined();
      break;
    }
  }
}
async function cast(p: Pilot, node: string, extra: { target?: number; aim?: Vec3; time?: number } = {}) {
  const seq = ++sequence;
  const bar = getSkillNode(node).slot!;
  const slot = server.ws.skills.get(p.characterId)!.slots[bar].indexOf(node);
  const zone = server.zones.zone(p.welcome.zone.id)!;
  p.sock.send({ t: 'cast', seq, node, slot, frame: zone.entity(p.entityId)!.fields.frame, time: server.world.clock.now(), aim: [0, 0, -1], ...extra });
  for (;;) {
    const m = await p.sock.next('cast');
    if (m.seq === seq) return m;
  }
}
async function analyze(p: Pilot, target: number) {
  const seq = ++sequence;
  p.sock.send({ t: 'analyze', seq, target, time: server.world.clock.now() });
  for (;;) {
    const m = await p.sock.next('analyze');
    if (m.seq === seq) return m;
  }
}
async function teleport(p: Pilot, zone: Zone, frame: string | null, pos: Vec3, mode: 'foot' | 'ship' = 'foot') {
  const key = frame === null ? 'inertial' : frame.slice(frame.lastIndexOf(':') + 1);
  const moved = await server.admin.run(
    { cmd: 'teleport', character: p.characterId, system: zone.systemIndex, frame: key, pose: pos.join(','), mode },
    { name: 'symbiotic integration', via: 'channel' },
  );
  expect(moved).toMatchObject({ moved: 'zone' });
  p.last = (await p.sock.next('correction')).pose;
  advance(0.1);
  p.send(p.last, mode);
  await handled(p);
  expect(zone.entity(p.entityId)?.unvalidated).toBe(false);
}
async function pilot(nodes: string[] = []) {
  const p = await Pilot.join(server, 'thalune', {
    clock,
    ackEvery: 20,
    before: async (id) => {
      await database.db.update(characters).set({ level: 29 }).where(eq(characters.id, id));
    },
  });
  pilots.add(p);
  await p.sock.next('abilities');
  await own(p, nodes);
  return p;
}
async function world(nodes: string[] = []) {
  const p = await pilot(nodes);
  const zone = server.zones.zone(p.welcome.zone.id)!;
  zone.fauna!.setTier(3);
  const body = zone.system.bodies.find(
    (b) => b.params.type !== 'gas' && faunaSpecies(b.params, 3).some((s) => s.kind !== 'flyer' && s.temperament === 'docile'),
  )!;
  if (!body || body.params.type === 'gas') throw new Error('no fauna world');
  const params = body.params;
  const g = groundOf(params, 3);
  const home = openGround(g);
  const [east, north] = tangents(home);
  const at = (e: number, n = 0): Vec3 => {
    const d = along(home, east, north, e, n, g.radius);
    const r = g.radius + g.sample(d);
    return [d[0] * r, d[1] * r, d[2] * r];
  };
  const frame = frameId(zone.system.seed, body.index);
  expect(await planGround(zone.system, frame)).toBe(true);
  // A real landed ship before disembarking: the saved foot pose must carry its parked ship on reconnect.
  const feet = at(0);
  const pad: Vec3 = [feet[0] + 11, feet[1], feet[2] + 3];
  const radius = Math.hypot(...pad);
  const height = g.surfaceRadius(pad) + SHIP_GEAR_HEIGHT;
  const landed: Vec3 = [(pad[0] / radius) * height, (pad[1] / radius) * height, (pad[2] / radius) * height];
  const placed = await server.admin.run(
    { cmd: 'teleport', character: p.characterId, system: zone.systemIndex, frame: String(body.index), pose: landed.join(','), mode: 'landed' },
    { name: 'symbiotic landed setup', via: 'channel' },
  );
  expect(placed).toMatchObject({ moved: 'zone' });
  p.last = (await p.sock.next('correction')).pose;
  advance(0.1);
  p.send({ frame, pos: feet, quat: [0, 0, 0, 1], vel: [0, 0, 0] }, 'foot');
  await handled(p);
  expect(zone.entity(p.entityId)?.fields.mode).toBe('foot');
  expect(zone.entity(p.entityId)?.unvalidated).toBe(false);
  expect(zone.movement?.parkedOf(p.entityId)?.frame).toBe(frame);
  advance(0.1);
  server.ws.meters.sweep(server.world.clock.now());
  for (const c of zone.fauna!.creatures()) zone.despawn(c.id);
  const species = faunaSpecies(params, 3);
  const spawn = (e: number, sp: FaunaSpecies = species.find((s) => s.temperament === 'docile' && s.kind !== 'flyer')!) =>
    zone.fauna!.spawnHerd({ body: body.index, species: sp.index, at: at(e), count: 1, level: 2 })!.creatures[0]!;
  const health = (id = p.entityId) => zone.combat.playerHealth(id)!;
  const aim = (e: number): Vec3 => {
    const a = at(0);
    const b = at(e);
    const d = dist(a, b);
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d];
  };
  return { p, zone, body, frame, at, species, spawn, health, aim };
}

describe('Symbiotic nodes through the production gateway', () => {
  it('Bond requires a real analysis, follows accepted movement, replicates its owner and deals credited strikes', async () => {
    const w = await world(['bond']);
    const id = w.spawn(5);
    expect(await cast(w.p, 'bond', { target: id })).toMatchObject({ result: 'refused', reason: 'target' });
    expect(await analyze(w.p, id)).toMatchObject({ result: 'new' });
    expect(await cast(w.p, 'bond', { target: id })).toMatchObject({ result: 'cast' });
    const before: Vec3 = [...w.zone.fauna!.creature(id)!.pos];
    await teleport(w.p, w.zone, w.frame, w.at(25));
    advance(5);
    expect(dist(w.zone.fauna!.creature(id)!.pos, w.at(25))).toBeLessThan(dist(before, w.at(25)));
    await handled(w.p);
    expect(w.p.client.latest.get(id)?.owner).toBe(w.p.entityId);
    const target = w.spawn(
      26,
      w.species.find((s) => s.temperament === 'territorial')!,
    );
    const hp = w.zone.combat.creatureHealth(target)!.hp;
    advance(5);
    expect(
      w.zone.combat.creatureHealth(target)!.hp,
      JSON.stringify({
        companion: w.zone.fauna!.creatures().find((c) => c.id === id),
        enemy: w.zone.fauna!.creatures().find((c) => c.id === target),
        owner: w.zone.entity(w.p.entityId),
      }),
    ).toBeLessThan(hp);
    expect(server.ws.combat.inCombat(w.p.characterId)).toBe(true);
    await handled(w.p);
    expect(
      w.p.sock.received.some((m) => m.t === 'event' && m.event.kind === 'combat' && m.event.source === id && m.event.target === target && m.event.amount > 0),
    ).toBe(true);
    w.zone.combat.applyDamage(null, target, { base: w.zone.combat.creatureHealth(target)!.hp - 1, kind: 'hazard' });
    advance(2);
    await handled(w.p);
    expect(w.zone.fauna!.creature(target)).toBeNull();
    await waitFor(() => w.p.sock.received.some((m) => m.t === 'event' && m.event.kind === 'xp' && m.event.from === target && m.event.amount > 0));
    expect(w.p.errors).toEqual([]);
  });
  it('Second Lung lowers actual authoritative life-support depletion by 30%', async () => {
    const w = await world();
    const before = server.ws.meters.view(w.p.characterId, server.world.clock.now()).lifeSupport;
    advance(10, true);
    const plain = server.ws.meters.view(w.p.characterId, server.world.clock.now()).lifeSupport;
    await own(w.p, ['second_lung']);
    const start = server.ws.meters.view(w.p.characterId, server.world.clock.now()).lifeSupport;
    advance(10, true);
    const after = server.ws.meters.view(w.p.characterId, server.world.clock.now()).lifeSupport;
    expect(start - after).toBeCloseTo((before - plain) * 0.7, 5);
  });
  it('Repair Drones spends Charge, repairs actual hull at 1/s in accepted flight and ends after 20s', async () => {
    const w = await world(['repair_drones']);
    await teleport(w.p, w.zone, null, [1e9, 0, 0], 'ship');
    const h = w.health();
    w.zone.combat.applyDamage(null, w.p.entityId, { base: h.shield + 40, kind: 'hazard' });
    const charge = server.ws.meters.view(w.p.characterId, server.world.clock.now()).charge;
    expect(await cast(w.p, 'repair_drones')).toMatchObject({ result: 'cast' });
    expect(server.ws.meters.view(w.p.characterId, server.world.clock.now()).charge).toBe(charge - 15);
    expect(await cast(w.p, 'repair_drones')).toMatchObject({ result: 'refused', reason: 'cooldown' });
    advance(22);
    expect(w.health().hull).toBeCloseTo(h.hull - 20, 5);
  });
  it('Regrow heals self 40 over six seconds above the existing suit recovery', async () => {
    const w = await world(['bond', 'regrow']);
    w.zone.combat.applyDamage(null, w.p.entityId, { base: 70, kind: 'hazard' });
    expect(await cast(w.p, 'regrow')).toMatchObject({ result: 'cast' });
    advance(3, true);
    expect(w.health().suit).toBeCloseTo(30 + 20 + 4.5, 5);
    advance(3.1, true);
    expect(w.health().suit).toBeCloseTo(30 + 40 + 6.1 * 1.5, 5);
  });
  it('Spore poisons nearby fauna, heals the caster and stops at ten seconds', async () => {
    const w = await world(['bond', 'spore']);
    const target = w.spawn(3);
    w.zone.fauna!.stun(target, 15);
    const hp = w.zone.combat.creatureHealth(target)!.hp;
    w.zone.combat.applyDamage(null, w.p.entityId, { base: 70, kind: 'hazard' });
    expect(await cast(w.p, 'spore')).toMatchObject({ result: 'cast' });
    advance(10.1, true);
    expect(w.zone.combat.creatureHealth(target)!.hp).toBeCloseTo(hp - 40, 5);
    expect(w.health().suit).toBeCloseTo(30 + 40 + 10.1 * 1.5, 5);
    const ended = w.zone.combat.creatureHealth(target)!.hp;
    advance(2);
    expect(w.zone.combat.creatureHealth(target)!.hp).toBe(ended);
  });
  it('Call moves a local herd through the aimed point and causes real contact health loss', async () => {
    const w = await world(['bond', 'call']);
    const herd = w.spawn(5);
    const target = w.spawn(26);
    w.zone.fauna!.stun(target, 10);
    const hp = w.zone.combat.creatureHealth(target)!.hp;
    expect(await cast(w.p, 'call', { aim: w.aim(30) })).toMatchObject({ result: 'cast' });
    let nearest = Infinity;
    for (let i = 0; i < 120; i++) {
      advance(0.05);
      nearest = Math.min(nearest, dist(w.zone.fauna!.creature(herd)!.pos, w.at(30)));
    }
    expect(nearest).toBeLessThan(5);
    expect(w.zone.combat.creatureHealth(target)!.hp).toBeCloseTo(hp - N.call.contactDamage, 5);
  });
  it('Thick Hide lowers actual hazard drain by 30% on a generated frozen world', async () => {
    const w = await world(['bond']);
    const body = w.zone.system.bodies.find((b) => b.type === 'frozen')!;
    const frame = frameId(w.zone.system.seed, body.index);
    if (body.params.type === 'gas') throw new Error('frozen world is gas');
    const g = groundOf(body.params);
    const pos: Vec3 = [0, g.surfaceRadius([0, 1, 0]), 0];
    expect(await planGround(w.zone.system, frame)).toBe(true);
    await teleport(w.p, w.zone, frame, pos);
    const before = server.ws.meters.view(w.p.characterId, server.world.clock.now()).hazard;
    advance(10, true);
    const plain = server.ws.meters.view(w.p.characterId, server.world.clock.now()).hazard;
    await own(w.p, ['thick_hide']);
    const start = server.ws.meters.view(w.p.characterId, server.world.clock.now()).hazard;
    advance(10, true);
    const after = server.ws.meters.view(w.p.characterId, server.world.clock.now()).hazard;
    expect(before - plain).toBeGreaterThan(0);
    expect(start - after).toBeCloseTo((before - plain) * 0.7, 5);
  });
  it('Symbiont Hull retunes max by 25%, restores 7.5 shield/s after six unhit seconds, and restarts on a hit', async () => {
    const w = await world(['bond']);
    await teleport(w.p, w.zone, null, [1e9, 0, 0], 'ship');
    const base = w.health();
    await own(w.p, ['symbiont_hull']);
    expect(w.health().shieldMax).toBe(base.shieldMax * 1.25);
    w.zone.combat.applyDamage(null, w.p.entityId, { base: 50, kind: 'hazard' });
    const hurt = w.health().shield;
    advance(6);
    expect(w.health().shield).toBeCloseTo(hurt, 5);
    advance(2);
    expect(w.health().shield).toBeCloseTo(hurt + 15, 5);
    w.zone.combat.applyDamage(null, w.p.entityId, { base: 10, kind: 'attack' });
    const hit = w.health().shield;
    advance(6);
    expect(w.health().shield).toBeCloseTo(hit, 5);
    advance(20);
    expect(w.health().shield).toBe(w.health().shieldMax);
  });
  it.each(['quad_heavy', 'flyer'] as const)('Big Game authorizes Bond to an actually analysed %s', async (plan) => {
    const w = await world(['bond']);
    const sp = w.species.find((s) => s.bodyPlan === plan)!;
    const target = w.spawn(5, sp);
    expect(await analyze(w.p, target)).toMatchObject({ result: 'new' });
    expect(await cast(w.p, 'bond', { target })).toMatchObject({ result: 'refused', reason: 'target' });
    await own(w.p, ['big_game']);
    const bonded = await cast(w.p, 'bond', { target });
    expect(bonded, JSON.stringify(bonded)).toMatchObject({ result: 'cast' });
    expect(w.zone.entity(target)?.fields.owner).toBe(w.p.entityId);
  });
});

describe('Symbiotic gateway lifecycle and ally boundaries', () => {
  it('Bond prevents another player from stunning its companion with Pulse', async () => {
    const w = await world(['bond']);
    const id = w.spawn(5);
    expect(await analyze(w.p, id)).toMatchObject({ result: 'new' });
    expect(await cast(w.p, 'bond', { target: id })).toMatchObject({ result: 'cast' });
    const other = await pilot(['pulse']);
    await teleport(other, w.zone, w.frame, w.at(2));
    expect(await cast(other, 'pulse')).toMatchObject({ result: 'cast' });
    expect(w.zone.fauna!.creatures().find((c) => c.id === id)?.stunUntil).toBe(0);
  });
  it('Regrow heals an invited party ally and refuses a stranger without spending', async () => {
    const w = await world(['bond', 'regrow']);
    const ally = await pilot();
    await teleport(ally, w.zone, w.frame, w.at(2));
    w.zone.combat.applyDamage(null, ally.entityId, { base: 70, kind: 'hazard' });
    expect(await cast(w.p, 'regrow', { target: ally.entityId })).toMatchObject({ result: 'refused', reason: 'target' });
    w.p.sock.send({ t: 'party', op: { op: 'invite', name: w.zone.entity(ally.entityId)!.fields.name! } });
    await handled(w.p);
    ally.sock.send({ t: 'party', op: { op: 'accept', name: w.zone.entity(w.p.entityId)!.fields.name! } });
    await handled(ally);
    expect(w.zone.entity(ally.entityId)!.party).not.toBeNull();
    expect(w.zone.entity(ally.entityId)!.party).toBe(w.zone.entity(w.p.entityId)!.party);
    expect(await cast(w.p, 'regrow', { target: ally.entityId })).toMatchObject({ result: 'cast' });
    advance(6.1, true);
    expect(w.health(ally.entityId).suit).toBeCloseTo(70 + 6.1 * 1.5, 5);
  });
  it('Spore heals an actual party ally, never damages a player, and does not reach a hidden phase target', async () => {
    const w = await world(['bond', 'spore']);
    const friend = await pilot();
    await teleport(friend, w.zone, w.frame, w.at(2));
    w.p.sock.send({ t: 'party', op: { op: 'invite', name: w.zone.entity(friend.entityId)!.fields.name! } });
    await handled(w.p);
    friend.sock.send({ t: 'party', op: { op: 'accept', name: w.zone.entity(w.p.entityId)!.fields.name! } });
    await handled(friend);
    w.zone.combat.applyDamage(null, friend.entityId, { base: 70, kind: 'hazard' });
    const hidden = w.spawn(4);
    w.zone.fauna!.stun(hidden, 15);
    const session = server.ws.registry.holding(friend.characterId)!;
    const phase = w.zone.phases.phaseFor(session, 'event', { key: 'hidden-spore', frame: w.frame, center: w.at(2), radius: 100 });
    w.zone.phases.adopt(phase.id, hidden);
    const hp = w.zone.combat.creatureHealth(hidden)!.hp;
    expect(await cast(w.p, 'spore')).toMatchObject({ result: 'cast' });
    advance(2, true);
    expect(w.zone.combat.creatureHealth(hidden)!.hp).toBe(hp);
    expect(w.health(friend.entityId).suit).toBeCloseTo(33, 5);
    w.zone.phases.leave(session);
    advance(2, true);
    expect(w.health(friend.entityId).suit).toBeCloseTo(44, 5);
  });
  it('a rejected replacement keeps the companion; a valid replacement removes exactly the old one', async () => {
    const w = await world(['bond']);
    const old = w.spawn(5);
    expect(await analyze(w.p, old)).toMatchObject({ result: 'new' });
    expect(await cast(w.p, 'bond', { target: old })).toMatchObject({ result: 'cast' });
    advance(60.1);
    const stale = w.spawn(5);
    w.zone.despawn(stale);
    expect(await cast(w.p, 'bond', { target: stale })).toMatchObject({ result: 'refused', reason: 'unseen' });
    expect(w.zone.entity(old)?.fields.owner).toBe(w.p.entityId);
    const next = w.spawn(5);
    expect(await cast(w.p, 'bond', { target: next })).toMatchObject({ result: 'cast' });
    expect(w.zone.entity(old)).toBeUndefined();
    expect(w.zone.entity(next)?.fields.owner).toBe(w.p.entityId);
  });
  it.each(['death', 'suit_recovery', 'world_return', 'phase_return'] as const)(
    'Bond and delayed healing end on %s at the real service boundary',
    async (event) => {
      const w = await world(['bond', 'regrow']);
      const id = w.spawn(5);
      expect(await analyze(w.p, id)).toMatchObject({ result: 'new' });
      expect(await cast(w.p, 'bond', { target: id })).toMatchObject({ result: 'cast' });
      w.zone.combat.applyDamage(null, w.p.entityId, { base: 50, kind: 'hazard' });
      expect(await cast(w.p, 'regrow')).toMatchObject({ result: 'cast' });
      if (event === 'death') w.zone.combat.applyDamage(null, w.p.entityId, { base: 1000, kind: 'hazard' });
      if (event === 'suit_recovery') w.zone.combat.suitHealth(w.p.entityId, -1000);
      if (event === 'world_return') {
        w.zone.patch(w.p.entityId, { frame: null });
        w.zone.patch(w.p.entityId, { frame: w.frame });
      }
      if (event === 'phase_return') {
        const session = server.ws.registry.holding(w.p.characterId)!;
        w.zone.phases.phaseFor(session, 'event', { key: 'depart-return', frame: w.frame, center: w.at(0), radius: 100 });
        w.zone.phases.leave(session);
      }
      expect(w.zone.entity(id)).toBeUndefined();
      const hp = w.health().suit;
      advance(7);
      expect(w.health().suit).toBe(hp);
    },
  );
  it('disconnect dismisses the companion; reconnect keeps codex and cooldown but revives no old actions', async () => {
    const w = await world(['bond', 'regrow']);
    const id = w.spawn(5);
    expect(await analyze(w.p, id)).toMatchObject({ result: 'new' });
    expect(await cast(w.p, 'bond', { target: id })).toMatchObject({ result: 'cast' });
    expect(await cast(w.p, 'regrow')).toMatchObject({ result: 'cast' });
    w.p.close();
    await w.p.sock.closed;
    await waitFor(() => server.persistence.status(w.p.characterId)?.inPlay !== true);
    expect(w.zone.entity(id)).toBeUndefined();
    const back = await Pilot.join(server, 'thalune', { as: w.p, clock, ackEvery: 20 });
    pilots.add(back);
    await back.sock.next('abilities');
    const other = w.spawn(5);
    expect(await cast(back, 'bond', { target: other })).toMatchObject({ result: 'refused', reason: 'cooldown' });
    w.zone.combat.applyDamage(null, back.entityId, { base: 50, kind: 'hazard' });
    const hp = w.zone.combat.playerHealth(back.entityId)!.suit;
    advance(7);
    expect(w.zone.combat.playerHealth(back.entityId)!.suit).toBe(hp);
    expect(server.ws.codex.canBond(back.characterId, w.frame, w.zone.fauna!.creature(other)!.species.index)).toBe(true);
  });
  it('companion death removes its actor and no subsequent tick attacks through the stale entity', async () => {
    const w = await world(['bond']);
    const id = w.spawn(5);
    expect(await analyze(w.p, id)).toMatchObject({ result: 'new' });
    expect(await cast(w.p, 'bond', { target: id })).toMatchObject({ result: 'cast' });
    w.zone.combat.applyDamage(null, id, { base: 10000, kind: 'hazard' });
    expect(w.zone.fauna!.creature(id)).toBeNull();
    const enemy = w.spawn(
      5,
      w.species.find((s) => s.temperament === 'territorial')!,
    );
    const hp = w.zone.combat.creatureHealth(enemy)!.hp;
    advance(4);
    expect(w.zone.entity(id)).toBeUndefined();
    expect(w.zone.combat.creatureHealth(enemy)!.hp).toBe(hp);
  });
  it('zone departure through the live admin handoff dismisses the old companion', async () => {
    const w = await world(['bond']);
    const id = w.spawn(5);
    expect(await analyze(w.p, id)).toMatchObject({ result: 'new' });
    expect(await cast(w.p, 'bond', { target: id })).toMatchObject({ result: 'cast' });
    const result = await server.admin.run(
      { cmd: 'teleport', character: w.p.characterId, system: 1, frame: 'station', pose: 'docked' },
      { name: 'symbiotic transfer', via: 'channel' },
    );
    expect(result).toMatchObject({ moved: 'reconnect' });
    await w.p.sock.closed;
    expect(w.zone.entity(id)).toBeUndefined();
    advance(1);
    expect(w.zone.fauna!.creature(id)).toBeNull();
  });
});
