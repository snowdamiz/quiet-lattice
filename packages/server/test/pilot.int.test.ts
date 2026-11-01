// The Pilot branch's Tier I–II nodes over the wire (P1.E07.T09), against the dockerised Postgres and Redis, with movement
// authority on, on a server whose clock only the pilot steps (test/pilot.ts): a node a character buys in flight changes what the server holds its ship to at once, without a rejoin. A
// client flying faster than its ship may is snapped back; the same flight, after the node is bought over the socket, is not.
// The ship's shield and hull follow the nodes in the zone's combat, a character that joins owning them flies and fights with
// them from its first input, and a respec in a fight takes the plating off at once.
import { STATION_LAYOUT } from '@astra/shared/data';
import type { ServerMessage } from '@astra/shared/protocol';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { MOVEMENT } from '../src/sim/movement/index.ts';
import { startTestServer, uniqueShard, waitFor, type TestSocket } from './helpers.ts';
import { ManualClock, Pilot } from './pilot.ts';

type Vec3 = [number, number, number];
type SkillsState = Extract<ServerMessage, { t: 'skills' }>;

const config = parseConfig(process.env);
let server: RunningServer;
let database: Database;
const clock = new ManualClock();

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL);
  database = createDatabase(config.DATABASE_URL, { max: 2 });
  server = await startTestServer({}, { shard: uniqueShard(), clock: { monoNow: clock.now } });
});

afterAll(async () => {
  await server?.close();
  await database?.close();
});

/** Sends a skills request and returns the server's answer to it. */
async function ask(s: TestSocket, seq: number, op: Record<string, unknown>): Promise<SkillsState> {
  s.send({ t: 'skills', seq, op });
  for (;;) {
    const m = await s.next('skills');
    if (m.seq === seq) return m;
  }
}

async function pilotOfLevel(level: number): Promise<Pilot> {
  return Pilot.join(server, 'thalune', {
    clock,
    before: async (id) => {
      await database.db.update(characters).set({ level }).where(eq(characters.id, id));
    },
  });
}

describe('the Pilot nodes over the wire', () => {
  it('hold the ship to the speed, shield and hull a bought node gives it, from the next input', { timeout: 60_000 }, async () => {
    const p = await pilotOfLevel(16);
    const zone = server.zones.zone(p.welcome.zone.id)!;
    const id = p.characterId;
    expect(zone.combat.playerHealth(p.entityId)).toMatchObject({ shieldMax: 100, hullMax: 100 });

    // off the pad and out of the hangar, then 780 m/s: over the Lark's 710 allowance
    const [x, y, z] = p.welcome.pose.pos;
    const out: Vec3 = [0, 30, STATION_LAYOUT.hangar.z1 + 60];
    await p.fly([[x, y, z], [x, 14, z], [x, 14, 40], out], [10, 40, 60]);
    const run = async (from: Vec3) => p.fly([from, [from[0], from[1], from[2] + 1800]], [780]);
    await run(out);
    await p.settled();
    expect(p.corrections.length).toBeGreaterThan(0);
    const first = p.corrections.length;
    expect(zone.movement!.recent.filter((r) => r.entity === p.entityId).map((r) => r.rule)).toContain('speed');

    // it takes the correction, then buys Throttle Tuning, Photon Thrusters, Shield Capacitor and Hull Plating on the socket
    const back = p.corrections.at(-1)!.pose;
    await p.idle(MOVEMENT.correction.graceS * 1000);
    let seq = 0;
    for (const node of ['throttle_tuning', 'photon_thrusters', 'shield_capacitor', 'hull_plating']) {
      expect(server.ws.skills.unlock(id, node, { kind: 'dev' }).ok, node).toBe(true);
      expect((await ask(p.sock, ++seq, { op: 'buy', node })).error, node).toBeUndefined();
    }
    expect(server.ws.skills.owned(id)).toEqual(['throttle_tuning', 'photon_thrusters', 'shield_capacitor', 'hull_plating']);
    expect(zone.combat.playerHealth(p.entityId)).toMatchObject({ shield: 125, shieldMax: 125, hull: 125, hullMax: 125 });

    // the same flight, from where the correction put it, is honest now (825 allowed, 957 with both)
    p.last = back;
    await run(back.pos as Vec3);
    await p.hold('ship', 300);
    await p.settled();
    expect(p.corrections.length).toBe(first);
    expect(zone.entity(p.entityId)!.unvalidated).toBe(false);
    p.close();
  });

  it(
    'hold a character that joins owning them to the same: accepted at the boosted speed from the first input, with the shield and hull',
    { timeout: 60_000 },
    async () => {
      const first = await pilotOfLevel(16);
      const id = first.characterId;
      const nodes = ['throttle_tuning', 'photon_thrusters', 'shield_capacitor', 'hull_plating'];
      for (const node of nodes) {
        expect(server.ws.skills.unlock(id, node, { kind: 'dev' }).ok, node).toBe(true);
        expect(server.ws.skills.buy(id, node), node).toMatchObject({ ok: true });
      }
      first.close();
      await waitFor(() => server.zones.zone(first.welcome.zone.id)!.entity(first.entityId) === undefined, 5000, 'the first session gone');

      const p = await Pilot.join(server, 'thalune', { clock, as: first });
      expect(server.ws.skills.owned(id)).toEqual(nodes);
      const zone = server.zones.zone(p.welcome.zone.id)!;
      expect(zone.combat.playerHealth(p.entityId)).toMatchObject({ shield: 125, shieldMax: 125, hull: 125, hullMax: 125 });

      const [x, y, z] = p.welcome.pose.pos;
      const out: Vec3 = [0, 30, STATION_LAYOUT.hangar.z1 + 60];
      await p.fly([[x, y, z], [x, 14, z], [x, 14, 40], out], [10, 40, 60]);
      await p.fly([out, [out[0], out[1], out[2] + 1800]], [780]);
      await p.hold('ship', 300);
      await p.settled();
      expect(p.corrections).toEqual([]);
      expect(p.errors).toEqual([]);
      expect(zone.movement!.recent.filter((r) => r.entity === p.entityId)).toEqual([]);
      p.close();
    },
  );

  it('a respec in a fight takes the plating off at once, each pool keeping its fraction', { timeout: 60_000 }, async () => {
    const p = await pilotOfLevel(16);
    const id = p.characterId;
    const zone = server.zones.zone(p.welcome.zone.id)!;
    let seq = 0;
    const nodes = ['throttle_tuning', 'photon_thrusters', 'shield_capacitor', 'hull_plating'];
    for (const node of nodes) {
      expect(server.ws.skills.unlock(id, node, { kind: 'dev' }).ok, node).toBe(true);
      expect((await ask(p.sock, ++seq, { op: 'buy', node })).error, node).toBeUndefined();
    }
    const hit = (base: number) => zone.combat.applyDamage(null, p.entityId, { base, kind: 'attack' });
    hit(150);
    expect(zone.combat.playerHealth(p.entityId)).toMatchObject({ shield: 0, shieldMax: 125, hull: 100, hullMax: 125 });

    const hooks = server.ws.skills.hooks;
    const was = hooks.trainerAtHand;
    hooks.trainerAtHand = () => true;
    try {
      const reply = await ask(p.sock, ++seq, { op: 'respec', nodes });
      expect(reply.error).toBeUndefined();
    } finally {
      hooks.trainerAtHand = was;
    }
    expect(server.ws.skills.owned(id)).toEqual([]);
    const after = zone.combat.playerHealth(p.entityId)!;
    expect(after).toMatchObject({ shield: 0, shieldMax: 100, hullMax: 100, down: null });
    expect(after.hull).toBeCloseTo(80, 9);
    expect(hit(70)).toMatchObject({ killed: false });
    expect(zone.combat.playerHealth(p.entityId)!.hull).toBeCloseTo(10, 9);
    p.close();
  });

  it('give the hull the character flies the shield and hull it joins with', { timeout: 60_000 }, async () => {
    const first = await pilotOfLevel(16);
    const id = first.characterId;
    for (const node of ['throttle_tuning', 'photon_thrusters', 'shield_capacitor', 'hull_plating']) {
      expect(server.ws.skills.unlock(id, node, { kind: 'dev' }).ok, node).toBe(true);
      expect(server.ws.skills.buy(id, node), node).toMatchObject({ ok: true });
    }
    first.close();
    await waitFor(() => server.zones.zone(first.welcome.zone.id)!.entity(first.entityId) === undefined, 5000, 'the first session gone');
    // (saved on leave: it is the stored hull that changes, as a hull swap will)
    const swift = { hull: 'swift', modules: {}, cargoPods: 0, livery: 0 };
    await database.db
      .update(characters)
      .set({ state: sql`jsonb_set(${characters.state}, '{ship,data}', ${JSON.stringify(swift)}::jsonb)` })
      .where(eq(characters.id, id));

    const p = await Pilot.join(server, 'thalune', { clock, as: first });
    const zone = server.zones.zone(p.welcome.zone.id)!;
    expect(zone.combat.playerHealth(p.entityId)).toMatchObject({ shieldMax: 112.5, hullMax: 87.5 });
    p.close();
  });
});
