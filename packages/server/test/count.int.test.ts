// The Count meter against the dockerised Postgres and Redis (DESIGN 16.2): counted actions over two accelerated meter
// days move the Count, a restart mid-day keeps the day's ledger, each roll is stored with the Count it set, and a running
// server rolls the day on its own shard clock and tells joined clients the new Count. Each test runs a shard of its own.
import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION } from '@astra/shared/protocol';
import { and, asc, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY_S, dayOf } from '../src/count/meter.ts';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { countDays, countVotes, shards } from '../src/db/schema.ts';
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
  return row!;
}

async function mirroredCount(id: string): Promise<number> {
  return (JSON.parse((await redis.get(worldKey(id)))!) as WorldMirrorRecord).count;
}

const HOUR_MS = 3_600_000;

describe('the Count meter', () => {
  it('moves the Count over two accelerated days and keeps the ledger across a restart mid-day', async () => {
    const shard = uniqueShard();
    // the shard's clock, run by hand: it boots at 01:00 on meter day 10
    let wall = DEFAULT_SHARD_EPOCH_MS + (10 * DAY_S + 3600) * 1000;
    let mono = 0;
    const open = () => {
      mono = 0;
      const wallNow = () => wall;
      return WorldService.open({ store: pgShardStore(database.db, shard, { wallNow }), mirror: redis, wallNow, monoNow: () => mono });
    };
    const hours = (h: number) => {
      mono += h * HOUR_MS;
      wall += h * HOUR_MS;
    };
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];

    const first = await open();
    expect(await shardRow(shard)).toMatchObject({ count: 500, countDay: 9 });

    // day 10: three accounts escort convoys, one of them over and over
    expect(first.countAction(a, 'convoy-escorted', 'feed')).toBe(true);
    for (let i = 0; i < 50; i++) expect(first.countAction(a, 'convoy-escorted', 'feed')).toBe(false);
    expect(first.countAction(b, 'convoy-escorted', 'feed')).toBe(true);
    expect(first.countAction(c, 'monolith-touched', 'feed')).toBe(true);

    // day 11, 01:00: day 10 rolls on the shard clock. All Feed: 500 drifts 25 toward 850 and burns 5
    hours(24);
    expect(first.advance()).toBe(1);
    expect(first.state().count).toBe(520);
    await first.flush();
    expect(await shardRow(shard)).toMatchObject({ count: 520, countDay: 10 });
    expect(await mirroredCount(shard)).toBe(520);

    // day 11: two Breaks and a Hold, then the server goes down mid-day
    expect(first.countAction(a, 'convoy-raided', 'break')).toBe(true);
    expect(first.countAction(b, 'convoy-raided', 'break')).toBe(true);
    expect(first.countAction(c, 'wall-choice', 'hold')).toBe(true);
    hours(3);
    await first.close();

    // back an hour later, still day 11: the ledger is as it was
    wall += HOUR_MS;
    const second = await open();
    expect(second.state().count).toBe(520);
    expect(second.meter()).toMatchObject({ day: 11, votes: 3, lean: 1 / 9 });
    expect(second.countAction(a, 'convoy-raided', 'break')).toBe(false);
    expect(second.countAction(c, 'wall-choice', 'feed')).toBe(false);
    expect(second.countAction(c, 'convoy-escorted', 'feed')).toBe(true);
    // Break 30 + Break 30 + Hold 30 (10 to Feed) + Feed 30: 40 / 120
    expect(second.meter()).toMatchObject({ votes: 4, lean: 1 / 3, target: 383 });

    // day 12: day 11 rolls. 520 drifts 25 toward 383 and burns 5
    hours(24);
    expect(second.advance()).toBe(1);
    expect(second.state().count).toBe(490);
    await second.flush();
    expect(await shardRow(shard)).toMatchObject({ count: 490, countDay: 11 });
    expect(await mirroredCount(shard)).toBe(490);

    const days = await database.db.select().from(countDays).where(eq(countDays.shardId, shard)).orderBy(asc(countDays.day));
    expect(days.map(({ shardId, createdAt, ...d }) => d)).toEqual([
      { day: 10, season: 1, votes: 3, lean: 1, target: 850, countFrom: 500, drift: 25, burn: 5, count: 520 },
      { day: 11, season: 1, votes: 4, lean: 1 / 3, target: 383, countFrom: 520, drift: -25, burn: 5, count: 490 },
    ]);
    // one row per account per action: the first vote, nothing of the repeats
    const votes = await database.db
      .select()
      .from(countVotes)
      .where(and(eq(countVotes.shardId, shard), eq(countVotes.day, 11)));
    expect(votes.map((v) => [v.accountId, v.action, v.tag])).toHaveLength(4);
    expect(votes.map((v) => [v.accountId, v.action, v.tag])).toEqual(
      expect.arrayContaining([
        [a, 'convoy-raided', 'break'],
        [b, 'convoy-raided', 'break'],
        [c, 'wall-choice', 'hold'],
        [c, 'convoy-escorted', 'feed'],
      ]),
    );

    // a day is stored and applied once: replaying its roll changes nothing
    await pgShardStore(database.db, shard).count!.saveRoll({
      day: 11,
      season: 1,
      votes: 0,
      lean: null,
      target: null,
      from: 520,
      drift: 0,
      burn: 5,
      count: 515,
    });
    expect(await shardRow(shard)).toMatchObject({ count: 490, countDay: 11 });
    await second.close();
  });

  it('rolls the days a stopped server missed when it boots again', async () => {
    const shard = uniqueShard();
    let wall = DEFAULT_SHARD_EPOCH_MS + (40 * DAY_S + 12 * 3600) * 1000;
    const wallNow = () => wall;
    const first = await WorldService.open({ store: pgShardStore(database.db, shard, { wallNow }), wallNow });
    first.countAction(randomUUID(), 'warden-killed', 'break');
    await first.close();

    wall += 2 * DAY_S * 1000; // down for two days: day 40 (all Break) and day 41 (nothing) roll on boot
    const second = await WorldService.open({ store: pgShardStore(database.db, shard, { wallNow }), wallNow });
    expect(second.state().count).toBe(465); // 500 − 25 − 5, then − 5
    expect(second.meter()).toMatchObject({ day: 42, votes: 0 });
    await second.close();
    expect(await shardRow(shard)).toMatchObject({ count: 465, countDay: 41 });
  });

  it('rolls the day on a running server and tells joined clients the new Count', async () => {
    const shard = uniqueShard();
    // a shard whose saved world time is 5 s before a meter day ends, ahead of the wall clock, so the server's clock
    // starts there: the day ends 5 s after the server boots
    const day = dayOf((Date.now() - DEFAULT_SHARD_EPOCH_MS) / 1000) + 30;
    await database.db.insert(shards).values({
      id: shard,
      epoch: new Date(DEFAULT_SHARD_EPOCH_MS),
      lastTime: (day + 1) * DAY_S - 5,
      season: 1,
      seasonStart: 0,
      seasonLength: SEASON_LENGTH_S,
    });
    const server = await startTestServer({}, { shard });
    try {
      expect(server.world.countAction(randomUUID(), 'warden-killed', 'break')).toBe(true);
      expect(server.world.meter()).toMatchObject({ day, votes: 1, lean: 0, target: 150 });

      const acct = await newAccount(server);
      const character = await newCharacter(server, acct.token);
      const s = await TestSocket.open(server.wsUrl);
      s.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
      s.send({ t: 'join', characterId: character.id });
      // all Break: 500 drifts 25 toward 150 and burns 5
      await waitFor(() => s.received.some((m) => m.t === 'world' && m.count === 470), 15_000, 'the rolled Count');
      expect(server.world.meter()).toMatchObject({ day: day + 1, votes: 0 });
      await server.world.flush();
      expect(await shardRow(shard)).toMatchObject({ count: 470, countDay: day });
      s.close();
    } finally {
      await server.close();
    }
  });
});
