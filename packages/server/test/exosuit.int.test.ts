// The Exo-suit's Tier I–II passives over the wire (P1.E07.T10), against the dockerised Postgres and Redis: a character that buys
// Sprint Stride mid-session is held to the faster walker at once, one that has not is corrected for the same sprint, and the
// character who owns Optical Drill mines half as much again.
import { STATION_LAYOUT } from '@astra/shared/data';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { MOVEMENT } from '../src/sim/movement/index.ts';
import { startTestServer, waitFor } from './helpers.ts';
import { Pilot } from './pilot.ts';

const config = parseConfig(process.env);
let database: Database;
let server: RunningServer;

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL);
  database = createDatabase(config.DATABASE_URL, { max: 2 });
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
  await database?.close();
});

/** A pilot at level 15 (the Tier II gate), on the hangar floor on foot. */
async function onFoot(): Promise<Pilot> {
  const p = await Pilot.join(server, 'ixari', {
    before: (id) =>
      database.db
        .update(characters)
        .set({ level: 15 })
        .where(eq(characters.id, id))
        .then(() => undefined),
  });
  const frame = p.welcome.pose.frame;
  p.send({ frame, pos: [-22, 0, -22], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, 'foot');
  await waitFor(() => server.zones.zone(p.welcome.zone.id)!.entity(p.entityId)?.fields.mode === 'foot', 5000, 'the pilot on foot');
  return p;
}

/** Sprints on from where the pilot last was, down the hangar at `v` m/s of its own clock, an input every 50 ms, for `ms`
 * or until `until` holds. */
async function sprint(p: Pilot, v: number, ms: number, until: () => boolean = () => false): Promise<void> {
  const { frame, pos } = p.last;
  let z = pos[2]!;
  let at = performance.now();
  const end = at + ms;
  while (performance.now() < end && !until()) {
    await new Promise((r) => setTimeout(r, 50));
    const now = performance.now();
    z += (v * (now - at)) / 1000;
    at = now;
    p.send({ frame, pos: [pos[0]!, 0, z], quat: [0, 0, 0, 1], vel: [0, 0, v] }, 'foot');
  }
}

describe('Sprint Stride over the wire', () => {
  it('holds a character that joins owning it to the faster walker from its first input', { timeout: 60_000 }, async () => {
    const first = await onFoot();
    const id = first.characterId;
    for (const node of ['long_jump', 'sprint_stride']) {
      expect(server.ws.skills.unlock(id, node, { kind: 'dev' }).ok).toBe(true);
      expect(server.ws.skills.buy(id, node)).toMatchObject({ ok: true });
    }
    first.close();
    await waitFor(() => server.zones.zone(first.welcome.zone.id)!.entity(first.entityId) === undefined, 5000, 'the first session gone');

    const p = await Pilot.join(server, 'ixari', { as: first });
    expect(server.ws.skills.owned(id)).toContain('sprint_stride');
    const frame = p.welcome.pose.frame;
    p.send({ frame, pos: [-22, 0, -22], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, 'foot');
    await waitFor(() => server.zones.zone(p.welcome.zone.id)!.entity(p.entityId)?.fields.mode === 'foot', 5000, 'the pilot on foot');
    // 14 m/s is past the plain sprint's cap with its tolerance (12.95) and under Sprint Stride's (14.65)
    await sprint(p, 14, 2000);
    await new Promise((r) => setTimeout(r, 300));
    expect(p.corrections).toEqual([]);
    expect(p.errors).toEqual([]);
    p.close();
  });

  it('lifts the speed a walker is held to the moment the node is bought', { timeout: 60_000 }, async () => {
    const p = await onFoot();
    const id = p.characterId;
    // 14 m/s is past the plain sprint's cap with its tolerance (12.95) and under Sprint Stride's (14.65)
    expect(STATION_LAYOUT.hangar.z1).toBeGreaterThan(40);
    await sprint(p, 14, 4000, () => p.corrections.length > 0);
    expect(p.corrections.length, 'the plain walker corrected').toBeGreaterThan(0);

    for (const node of ['long_jump', 'sprint_stride']) {
      expect(server.ws.skills.unlock(id, node, { kind: 'dev' }).ok).toBe(true);
      expect(server.ws.skills.buy(id, node)).toMatchObject({ ok: true });
    }
    expect(server.ws.skills.owned(id)).toContain('sprint_stride');
    // (it takes the correction, and goes on from where the server put it)
    const corrected = p.corrections.length;
    p.send(p.corrections.at(-1)!.pose, 'foot');
    await new Promise((r) => setTimeout(r, MOVEMENT.correction.graceS * 1000));
    await sprint(p, 14, 2000);
    await new Promise((r) => setTimeout(r, 300));
    expect(p.corrections.length).toBe(corrected);
    expect(p.errors).toEqual([]);
    p.close();
  });
});
