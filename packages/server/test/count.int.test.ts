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
    // the meter starts now: burn tick 50 (midnight) is behind it, the next falls at 04:48
    expect(await shardRow(shard)).toMatchObject({ count: 500, countDay: 9, burnStep: 50 });

    // day 10: three accounts escort convoys, one of them over and over
    expect(first.countAction(a, 'convoy-escorted', 'feed')).toBe(true);
    for (let i = 0; i < 50; i++) expect(first.countAction(a, 'convoy-escorted', 'feed')).toBe(false);
    expect(first.countAction(b, 'convoy-escorted', 'feed')).toBe(true);
    expect(first.countAction(c, 'monolith-touched', 'feed')).toBe(true);

    // day 11, 01:00: day 10's five burns take 500 to 495, then its all-Feed lean drifts it 25 toward 850
    hours(24);
    expect(first.advance()).toEqual({ days: 1, burns: 5 });
    expect(first.state().count).toBe(520);
    await first.flush();
    expect(await shardRow(shard)).toMatchObject({ count: 520, countDay: 10, burnStep: 55 });
    expect(await mirroredCount(shard)).toBe(520);

    // day 11: two Breaks and a Hold (one account typed in capitals), then the server goes down at 04:00
    expect(first.countAction(a, 'convoy-raided', 'break')).toBe(true);
    expect(first.countAction(b, 'convoy-raided', 'break')).toBe(true);
    expect(first.countAction(c.toUpperCase(), 'wall-choice', 'hold')).toBe(true);
    hours(3);
    await first.close();

    // back at 05:00, still day 11: the ledger is as it was, and the 04:48 burn fell while it was down
    wall += HOUR_MS;
    const second = await open();
    expect(second.state().count).toBe(519);
    expect(second.meter()).toMatchObject({ day: 11, votes: 3, lean: 1 / 9 });
    expect(second.countAction(a, 'convoy-raided', 'break')).toBe(false);
    expect(second.countAction(c, 'wall-choice', 'feed')).toBe(false);
    expect(second.countAction(c, 'convoy-escorted', 'feed')).toBe(true);
    // Break 30 + Break 30 + Hold 30 (10 to Feed) + Feed 30: 40 / 120
    expect(second.meter()).toMatchObject({ votes: 4, lean: 1 / 3, target: 383 });

    // day 12, 05:00: four burns to 515, day 11's drift of 25 toward 383 to 490, and the 04:48 burn to 489
    hours(24);
    expect(second.advance()).toEqual({ days: 1, burns: 5 });
    expect(second.state().count).toBe(489);
    await second.flush();
    expect(await shardRow(shard)).toMatchObject({ count: 489, countDay: 11, burnStep: 61 });
    expect(await mirroredCount(shard)).toBe(489);

    const days = await database.db.select().from(countDays).where(eq(countDays.shardId, shard)).orderBy(asc(countDays.day));
    expect(days.map(({ shardId, createdAt, ...d }) => d)).toEqual([
      { day: 10, season: 1, votes: 3, lean: 1, target: 850, countFrom: 495, drift: 25, count: 520 },
      { day: 11, season: 1, votes: 4, lean: 1 / 3, target: 383, countFrom: 515, drift: -25, count: 490 },
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

    // a day is stored once and a vote once: saving them again changes nothing
    const store = pgShardStore(database.db, shard).count!;
    const replay = { day: 11, season: 1, votes: 0, lean: null, target: null, from: 515, drift: 0, count: 515 };
    await store.save({ votes: [{ day: 11, at: 0, accountId: a, action: 'convoy-raided', tag: 'break' }], rolls: [replay] });
    expect(
      (
        await database.db
          .select()
          .from(countDays)
          .where(and(eq(countDays.shardId, shard), eq(countDays.day, 11)))
      )[0],
    ).toMatchObject({ count: 490 });
    expect(
      await database.db
        .select()
        .from(countVotes)
        .where(and(eq(countVotes.shardId, shard), eq(countVotes.day, 11))),
    ).toHaveLength(4);
    expect(await shardRow(shard)).toMatchObject({ count: 489, countDay: 11 });
    await second.close();
  });

  it('plays the burns and days a stopped server missed when it boots again', async () => {
    const shard = uniqueShard();
    let wall = DEFAULT_SHARD_EPOCH_MS + (40 * DAY_S + 12 * 3600) * 1000; // 12:00 on day 40: burn tick 202 is behind
    const wallNow = () => wall;
    const first = await WorldService.open({ store: pgShardStore(database.db, shard, { wallNow }), wallNow });
    first.countAction(randomUUID(), 'warden-killed', 'break');
    await first.close();

    // down for two days, back at 12:00 on day 42: three burns to 497 and day 40's all-Break drift to 472, day 41's five
    // burns to 467, day 42's two to 465
    wall += 2 * DAY_S * 1000;
    const second = await WorldService.open({ store: pgShardStore(database.db, shard, { wallNow }), wallNow });
    expect(second.state().count).toBe(465);
    expect(second.meter()).toMatchObject({ day: 42, votes: 0 });
    await second.close();
    expect(await shardRow(shard)).toMatchObject({ count: 465, countDay: 41, burnStep: 212 });
    const days = await database.db.select().from(countDays).where(eq(countDays.shardId, shard)).orderBy(asc(countDays.day));
    expect(days.map((d) => [d.day, d.countFrom, d.drift, d.count])).toEqual([
      [40, 497, -25, 472],
      [41, 467, 0, 467],
    ]);
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
      // at midnight the day's last burn takes 500 to 499, then the all-Break lean drifts it 25 toward 150
      await waitFor(() => s.received.some((m) => m.t === 'world' && m.count === 474), 15_000, 'the rolled Count');
      expect(server.world.meter()).toMatchObject({ day: day + 1, votes: 0 });
      await server.world.flush();
      expect(await shardRow(shard)).toMatchObject({ count: 474, countDay: day, burnStep: (day + 1) * 5 });
      s.close();
    } finally {
      await server.close();
    }
  });
});
