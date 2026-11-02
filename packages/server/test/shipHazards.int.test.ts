// Real sockets, movement authority, the generated worlds, Postgres and Redis: hazard amounts never come from clients.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frameId, type Vec3 } from '@astra/shared/world';
import { SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters } from '../src/db/schema.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import type { RunningServer } from '../src/server.ts';
import { planGround } from '../src/sim/movement/authority.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { startTestServer, uniqueShard, waitFor } from './helpers.ts';
import { ManualClock, Pilot } from './pilot.ts';

let server: RunningServer;
let database: Database;
const clock = new ManualClock();
const pilots = new Set<Pilot>();

beforeAll(async () => {
  server = await startTestServer({}, { shard: uniqueShard(), clock: { monoNow: clock.now } });
  server.zones.stop();
  database = createDatabase(parseConfig(process.env).DATABASE_URL, { max: 2 });
});
afterAll(async () => {
  for (const p of pilots) p.close();
  await server?.close();
  await database?.close();
});

async function pilot(nodes: string[] = []) {
  const p = await Pilot.join(server, 'thalune', {
    clock,
    before: async (id) => {
      await database.db.update(characters).set({ level: 15 }).where(eq(characters.id, id));
    },
  });
  pilots.add(p);
  for (const node of nodes) {
    expect(server.ws.skills.unlock(p.characterId, node, { kind: 'dev' }).ok, node).toBe(true);
    expect(server.ws.skills.buy(p.characterId, node).ok, node).toBe(true);
  }
  return p;
}

async function handled(p: Pilot) {
  p.sock.send({ t: 'ping', id: 900, clientTime: 0 });
  await p.sock.next('pong');
}

function advance(seconds: number) {
  for (let i = 0; i < Math.round(seconds * 20); i++) {
    clock.advance(50);
    server.zones.runTick(server.world.clock.now(), clock.ms);
  }
}

async function place(p: Pilot, systemIndex: number, index: number, height = 40) {
  const system = describeZoneSystem(systemIndex);
  const body = system.bodies[index]!;
  const frame = frameId(system.seed, index);
  expect(await planGround(system, frame)).toBe(true);
  const heightAt = body.params.type === 'gas' ? 0 : groundOf(body.params).sample([0, 1, 0]);
  const surface = body.params.type === 'gas' ? body.radius * 1.004 : body.radius + (body.params.hasOcean ? Math.max(0, heightAt) : heightAt) + SHIP_GEAR_HEIGHT;
  const pos: Vec3 = [0, surface + height, 0];
  const moved = await server.admin.run(
    { cmd: 'teleport', character: p.characterId, system: systemIndex, frame: String(index), pose: pos.join(','), mode: 'ship' },
    { name: 'ship hazard integration', via: 'channel' },
  );
  if ('moved' in moved && moved.moved === 'reconnect') {
    await p.sock.closed;
    p = await Pilot.join(server, 'thalune', { as: p, clock });
    pilots.add(p);
  } else p.last = (await p.sock.next('correction')).pose;
  const zone = server.zones.zone(p.welcome.zone.id)!;
  expect(zone.systemIndex).toBe(systemIndex);
  advance(0.1);
  return { p, zone, body, altitude: body.params.type === 'gas' ? surface + height - body.radius : height };
}

describe('authoritative ship hazards over the wire', () => {
  it.each([
    ['heat', 0, 0, 'thermal_plating'],
    ['storm', 1, 0, 'hazard_coating'],
    ['pressure', 2, 6, 'pressure_hull'],
    ['acid', 2, 9, 'hazard_coating'],
    ['radiation', 3, 3, 'hazard_coating'],
    ['cryo', 3, 13, 'thermal_plating'],
  ] as const)(
    '%s damages the actual hull at the generated rate, and %s plating divides it by three',
    async (kind, system, body, plating) => {
      const plain = await place(await pilot(), system, body);
      const plated = await place(await pilot(['throttle_tuning', plating]), system, body);
      const hz = plain.body.params.hazard!;
      expect(hz.kind).toBe(kind);
      for (const w of [plain, plated]) w.zone.combat.applyDamage(null, w.p.entityId, { base: 100, kind: 'attack' });
      const before = (w: typeof plain) => w.zone.combat.playerHealth(w.p.entityId)!.hull;
      const a = before(plain);
      const b = before(plated);
      advance(1);
      const rate = hz.dps * (1 - plain.altitude / hz.ceiling) ** (hz.curve || 1.3);
      expect(a - before(plain)).toBeCloseTo(rate, 5);
      expect(b - before(plated)).toBeCloseTo(rate / 3, 5);
      await handled(plain.p);
      await waitFor(() => (plain.p.client.latest.get(plain.p.entityId)?.hp ?? 1) < 1, 5000, 'authoritative hull in snapshots');
      expect(plain.p.sock.received.some((m) => m.t === 'event' && m.event.kind === 'combat' && m.event.damageType === 'hazard')).toBe(true);
      plain.p.close();
      plated.p.close();
    },
    60_000,
  );

  it('charges a real descent with zero reported velocity, retains bunched intervals, and stops re-entry when no pose moves', async () => {
    const system = describeZoneSystem(0);
    for (const nodes of [[], ['tempered_core', 'ablative_plating']]) {
      const w = await place(await pilot(nodes), 0, system.home, 3000);
      const p = w.p;
      p.send(p.last, 'ship');
      await handled(p);
      server.zones.runTick(server.world.clock.now(), clock.ms);
      const start = w.zone.combat.playerHealth(p.entityId)!.shield;
      // 20 accepted 50 ms intervals with velocity reported as zero. Inputs arrive before their next tick in pairs.
      for (let i = 0; i < 20; i++) {
        clock.advance(50);
        p.send({ ...p.last, pos: [p.last.pos[0], p.last.pos[1] - 70, p.last.pos[2]], vel: [0, 0, 0] }, 'ship');
        await handled(p);
        if (i % 2 === 1) server.zones.runTick(server.world.clock.now(), clock.ms);
      }
      expect(p.corrections).toEqual([]);
      const after = w.zone.combat.playerHealth(p.entityId)!.shield;
      expect(start - after).toBeCloseTo(nodes.length ? 20 / 3 : 20, 4);
      advance(3);
      expect(w.zone.combat.playerHealth(p.entityId)!.shield).toBeCloseTo(after, 8);
      p.close();
    }
  }, 60_000);

  it('a silent client loses its ship once at zero hull, receives the server death, and is not rebuilt or moved', async () => {
    const w = await place(await pilot(), 0, 0);
    const news: unknown[] = [];
    const off = server.ws.combat.subscribe((n) => {
      if (n.kind === 'downed') news.push(n);
    });
    w.zone.combat.applyDamage(null, w.p.entityId, { base: 195, kind: 'attack' });
    const pos = w.zone.entity(w.p.entityId)!.fields.pos;
    advance(2);
    await handled(w.p);
    expect(w.zone.combat.playerHealth(w.p.entityId)).toMatchObject({ hull: 0, shield: 0, down: 'ship' });
    expect(news).toHaveLength(1);
    expect(news[0]).toMatchObject({ report: { characterId: w.p.characterId, cause: 'ship', source: null } });
    expect(w.zone.entity(w.p.entityId)!.fields.pos).toEqual(pos);
    expect(w.p.sock.received.some((m) => m.t === 'event' && m.event.kind === 'combat' && m.event.killed)).toBe(true);
    off();
    w.p.close();
  }, 60_000);
});
