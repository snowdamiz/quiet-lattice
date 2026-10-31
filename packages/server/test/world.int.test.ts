// The world service against the dockerised Postgres and Redis: the shard's row is created on first boot and its clock
// carries on across restarts; the state is mirrored to Redis; a client that joins is sent `world` right after
// `welcome`, and again when the world changes. Each test runs a shard of its own, so changing it touches nothing else.
import { PROTOCOL_VERSION, WorldState as WorldMessageSchema } from '@astra/shared/protocol';
import { EDGE_X, galaxyTiers } from '@astra/shared/world';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { shards } from '../src/db/schema.ts';
import { DEFAULT_SHARD_EPOCH_MS } from '../src/world/clock.ts';
import { worldKey, WorldService, type WorldMirrorRecord } from '../src/world/service.ts';
import { pgShardStore, SEASON_LENGTH_S } from '../src/world/shard.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';

const config = parseConfig(process.env);
let database: Database;
let redis: Redis;

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL);
  database = createDatabase(config.DATABASE_URL, { max: 2 });
  redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
});

afterAll(async () => {
  await database?.close();
  redis?.disconnect();
});

async function shardRow(id: string) {
  const [row] = await database.db.select().from(shards).where(eq(shards.id, id));
  return row;
}

describe('world service', () => {
  it('creates the shard row on first boot and carries the clock on from it across a restart', async () => {
    const shard = uniqueShard();
    expect(await shardRow(shard)).toBeUndefined();
    const bootedAt = Date.now();
    const first = await startTestServer({}, { shard });
    const created = (await shardRow(shard))!;
    expect(created.epoch.getTime()).toBe(DEFAULT_SHARD_EPOCH_MS);
    expect(created).toMatchObject({ season: 1, seasonLength: SEASON_LENGTH_S });
    expect(Math.abs(created.seasonStart - (bootedAt - DEFAULT_SHARD_EPOCH_MS) / 1000)).toBeLessThan(5);
    expect(first.world.state()).toMatchObject({ season: 1, seasonStart: created.seasonStart, count: 500, edgeX: EDGE_X });
    expect(first.world.epochMs).toBe(DEFAULT_SHARD_EPOCH_MS);

    const before = first.world.clock.now();
    await first.close();
    const saved = (await shardRow(shard))!.lastTime;
    expect(saved).toBeGreaterThanOrEqual(before);

    // the restart: a new server process reads the same row
    const second = await startTestServer({}, { shard });
    expect(second.world.clock.now()).toBeGreaterThanOrEqual(saved);
    expect(second.world.state()).toMatchObject({ season: 1, seasonStart: created.seasonStart, seasonLength: SEASON_LENGTH_S });
    expect((await shardRow(shard))!.createdAt).toEqual(created.createdAt);
    await second.close();
  });

  it('never starts the clock below the time the shard saved, even when the wall clock stepped back', async () => {
    const shard = uniqueShard();
    const first = await WorldService.open({ store: pgShardStore(database.db, shard) });
    await first.close();
    const saved = (await shardRow(shard))!.lastTime;

    const store = pgShardStore(database.db, shard);
    const backwards = await WorldService.open({ store, wallNow: () => Date.now() - 3_600_000 });
    const t = backwards.clock.now();
    expect(t).toBeGreaterThanOrEqual(saved);
    expect(t - saved).toBeLessThan(5);
    // saving never lowers the saved time
    await store.saveTime(saved - 100);
    expect((await shardRow(shard))!.lastTime).toBe(saved);
    await backwards.close();
  });

  it("counts world time from the epoch in the shard's row", async () => {
    const shard = uniqueShard();
    const epoch = new Date(Date.now() - 1_000_000);
    await database.db.insert(shards).values({ id: shard, epoch, lastTime: 0, season: 3, seasonStart: 10, seasonLength: 4 * 7 * 86_400 });
    const world = await WorldService.open({ store: pgShardStore(database.db, shard) });
    expect(world.epochMs).toBe(epoch.getTime());
    expect(Math.abs(world.clock.now() - 1000)).toBeLessThan(5);
    expect(world.state()).toMatchObject({ season: 3, seasonStart: 10, seasonLength: 4 * 7 * 86_400 });
    expect(world.message().season).toBe(3);
    await world.close();
  });

  it('mirrors the world state to Redis under its shard key and keeps it current', async () => {
    const shard = uniqueShard();
    const server = await startTestServer({}, { shard });
    try {
      const read = async () => JSON.parse((await redis.get(worldKey(shard)))!) as WorldMirrorRecord;
      const mirrored = await read();
      expect(mirrored).toMatchObject({ shard, revision: 1, season: 1, count: 500, edgeX: EDGE_X, epochMs: DEFAULT_SHARD_EPOCH_MS });
      expect(mirrored.tiers).toEqual(galaxyTiers(EDGE_X).map((t) => t.tier));
      // the sync point gives other processes the server's world time
      const estimate = mirrored.time + (Date.now() - mirrored.at) / 1000;
      expect(Math.abs(estimate - server.world.clock.now())).toBeLessThan(1);

      server.world.update({ edgeX: EDGE_X - 25 });
      await server.world.flush();
      const moved = await read();
      expect(moved).toMatchObject({ revision: 2, edgeX: EDGE_X - 25 });
      expect(moved.tiers).toEqual(galaxyTiers(EDGE_X - 25).map((t) => t.tier));
    } finally {
      await server.close();
    }
  });

  it('sends a joining client `world` right after `welcome`, and again whenever the world changes', async () => {
    const server = await startTestServer({}, { shard: uniqueShard() });
    try {
      const acct = await newAccount(server);
      const character = await newCharacter(server, acct.token, { people: 'ixari' });
      const s = await TestSocket.open(server.wsUrl);
      s.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
      s.send({ t: 'join', characterId: character.id });
      await waitFor(() => s.received.some((m) => m.t === 'quests'), 5000, 'quests');
      // `world` comes right after `welcome`; the character's `inventory` (P1.E06.T04), `skills` (P1.E07.T01), `meters`
      // (P1.E07.T02), `recipes` (P1.E13.T05), `reputation` (P2.E18.T01), `party` (P1.E15.T01) and quest state (P1.E09.T01)
      // follow, the last after the news that a new character is given First Jobs
      expect(s.received.map((m) => m.t)).toEqual([
        'welcome',
        'world',
        'inventory',
        'skills',
        'meters',
        'recipes',
        'reputation',
        'party',
        'event',
        'event',
        'quests',
      ]);
      const [welcome, world] = s.received.splice(0) as [
        Extract<(typeof s.received)[number], { t: 'welcome' }>,
        Extract<(typeof s.received)[number], { t: 'world' }>,
      ];
      expect(WorldMessageSchema.parse(world)).toEqual(world);
      expect(world).toMatchObject({ season: 1, count: 500, edgeX: EDGE_X, tiers: galaxyTiers(EDGE_X).map((t) => t.tier) });
      expect(world.serverTime).toBeGreaterThanOrEqual(welcome.serverTime);

      // a socket that has signed in but joined no character is not told
      const other = await newAccount(server);
      const waiting = await TestSocket.open(server.wsUrl);
      waiting.send({ t: 'hello', version: PROTOCOL_VERSION, token: other.token });
      await waitFor(() => server.ws.registry.openForAccount(other.accountId).length === 1, 5000, 'hello');

      server.world.update({ edgeX: EDGE_X - 25 });
      const changed = await s.next('world');
      expect(changed.tiers).toEqual(galaxyTiers(EDGE_X - 25).map((t) => t.tier));
      expect(changed.edgeX).toBe(EDGE_X - 25);
      expect(changed.serverTime).toBeGreaterThanOrEqual(world.serverTime);
      expect(server.zones.tier(welcome.zone.id)).toBe(0); // a home system stays Tier 0
      expect(waiting.received).toEqual([]);
      s.close();
      waiting.close();
    } finally {
      await server.close();
    }
  });
});
