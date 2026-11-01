// The Pilot branch's Tier I–II nodes over the wire (P1.E07.T09), against the dockerised Postgres and Redis, with movement
// authority on: a node a character buys in flight changes what the server holds its ship to at once, without a rejoin. A
// client flying faster than its ship may is snapped back; the same flight, after the node is bought over the socket, is not.
// The ship's shield and hull follow the nodes in the zone's combat.
import { STATION_LAYOUT } from '@astra/shared/data';
import type { ServerMessage } from '@astra/shared/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { MOVEMENT } from '../src/sim/movement/index.ts';
import { newAccount, newCharacter, startTestServer, waitFor, type TestSocket } from './helpers.ts';
import { Pilot } from './pilot.ts';

type Vec3 = [number, number, number];
type SkillsState = Extract<ServerMessage, { t: 'skills' }>;

const config = parseConfig(process.env);
let server: RunningServer;
let database: Database;

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL);
  database = createDatabase(config.DATABASE_URL, { max: 2 });
  server = await startTestServer();
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
  const acct = await newAccount(server);
  const character = await newCharacter(server, acct.token, { people: 'thalune' });
  await database.db.update(characters).set({ level }).where(eq(characters.id, character.id));
  return Pilot.join(server, 'thalune', { character: { token: acct.token, accountId: acct.accountId, id: character.id } });
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
    await waitFor(() => p.corrections.length > 0, 5000, 'a correction for speeding');
    const first = p.corrections.length;
    expect(zone.movement!.recent.filter((r) => r.entity === p.entityId).map((r) => r.rule)).toContain('speed');

    // it takes the correction, then buys Throttle Tuning, Photon Thrusters, Shield Capacitor and Hull Plating on the socket
    const back = p.corrections.at(-1)!.pose;
    await new Promise((r) => setTimeout(r, MOVEMENT.correction.graceS * 1000));
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
    expect(p.corrections.length).toBe(first);
    expect(zone.entity(p.entityId)!.unvalidated).toBe(false);
    p.close();
  });
});
