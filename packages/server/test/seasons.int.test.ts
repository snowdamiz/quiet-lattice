// Seasons against the dockerised Postgres and Redis (DESIGN 16.4, P2.E22.T03), on an accelerated shard clock: a whole
// season played day by day from 500, its counted actions moving the meter, its end in the Count's bucket, the title and
// glyph to the winning philosophy's accounts only, its chronicle written, and the next season starting at 500 with the
// stored map and the length its month of daily actives chose; a season that ends while the server is down, played on
// boot; and on a running server, a season ending under joined clients, who are told the new season and, the winners,
// their award, which their characters keep, with the chronicle served over HTTP. Each test runs a shard of its own.
import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import {
  darkSystems,
  SEASON_EDGE_SHIFT_LY,
  SEASON_LENGTH_S,
  SMALL_SEASON_LENGTH_S,
  seasonAward,
  seasonChronicleSchema,
  type SeasonChronicle,
} from '@astra/shared/seasons';
import { and, asc, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { DAY_S, dayOf } from '../src/count/meter.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { characters, countDays, dailyActives, seasonAwards, seasonChronicles, shards } from '../src/db/schema.ts';
import { readChronicle } from '../src/seasons/store.ts';
import { DEFAULT_SHARD_EPOCH_MS } from '../src/world/clock.ts';
import { worldKey, WorldService, type SeasonEnded, type WorldMirrorRecord } from '../src/world/service.ts';
import { pgShardStore } from '../src/world/shard.ts';
import { api, newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';

const config = parseConfig(process.env);
let database: Database;
let redis: Redis;

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL);
  database = createDatabase(config.DATABASE_URL, { max: 4 });
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

async function chronicleRows(shard: string) {
  return database.db.select().from(seasonChronicles).where(eq(seasonChronicles.shardId, shard)).orderBy(asc(seasonChronicles.season));
}

async function awardedAccounts(shard: string, season: number): Promise<string[]> {
  const rows = await database.db
    .select({ accountId: seasonAwards.accountId })
    .from(seasonAwards)
    .where(and(eq(seasonAwards.shardId, shard), eq(seasonAwards.season, season)));
  return rows.map((r) => r.accountId).sort();
}

const HOUR_MS = 3_600_000;

describe('seasons', () => {
  it('plays whole seasons on an accelerated clock: from 500 to a bucket, the winners awarded, the chronicle written, the next at 500', async () => {
    const shard = uniqueShard();
    // the shard's clock, run by hand: it first boots at 01:00 on meter day 10, which starts season 1 (eight weeks, the
    // first season's default, to the midnight after: day 67)
    const D = 10;
    let wall = DEFAULT_SHARD_EPOCH_MS + (D * DAY_S + 3600) * 1000;
    let mono = 0;
    const open = () => {
      mono = 0;
      const wallNow = () => wall;
      return WorldService.open({ store: pgShardStore(database.db, shard, { wallNow }), mirror: redis, wallNow, monoNow: () => mono });
    };
    const days = (n: number) => {
      mono += n * 24 * HOUR_MS;
      wall += n * 24 * HOUR_MS;
    };
    const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    let world = await open();
    const told: SeasonEnded[] = [];
    world.onSeasonEnded((e) => told.push(e));
    expect(world.state()).toMatchObject({ season: 1, count: 500, seasonLength: SEASON_LENGTH_S, seasonEnd: (D + 57) * DAY_S });

    // season 1: a, b and c escort convoys every day (Feed); d raids one on the first day (Break); all four play daily
    world.countAction(d, 'convoy-raided', 'break');
    for (let day = D; day < D + 57; day++) {
      for (const id of [a, b, c, d]) world.markActive(id);
      for (const id of [a, b, c]) world.countAction(id, 'convoy-escorted', 'feed');
      days(1);
      world.advance();
      await world.flush();
      if (day === D) expect(world.state().count).toBe(520); // five burns to 495, then +25 toward 675 (Feed 90 of 120)
    }
    // 01:00 on day 67: season 1 ended at midnight on the Count the all-Feed lean held it at, 850: Fed. Season 2 began
    // then at 500 (no burn since), four weeks long (four accounts a day is a small population), on the Fed map
    expect(world.state()).toMatchObject({
      season: 2,
      count: 500,
      seasonStart: (D + 57) * DAY_S,
      seasonLength: SMALL_SEASON_LENGTH_S,
      seasonEnd: (D + 85) * DAY_S,
      opening: { from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] },
    });
    expect(await shardRow(shard)).toMatchObject({
      season: 2,
      seasonStart: (D + 57) * DAY_S,
      seasonLength: SMALL_SEASON_LENGTH_S,
      seasonActives: 4,
      seasonOpening: { from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] },
      count: 500,
    });
    expect((JSON.parse((await redis.get(worldKey(shard)))!) as WorldMirrorRecord).season).toBe(2);
    // the title and glyph went to the Feed accounts only, and they were told once the chronicle was written
    expect(await awardedAccounts(shard, 1)).toEqual([a, b, c].sort());
    expect(told.map((t) => [t.ended.season, t.ended.bucket, [...t.awarded.accounts].sort()])).toEqual([[1, 'fed', [a, b, c].sort()]]);
    expect(told[0]!.awarded.award).toEqual(seasonAward(1, 'fed'));
    // the chronicle: when it ran, its meter's path (each of its 57 days' rolls), the Count at its end, the next map
    const first = (await readChronicle(database.db, shard, 1))!;
    expect(seasonChronicleSchema.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      season: 1,
      start: D * DAY_S + 3600,
      end: (D + 57) * DAY_S,
      length: SEASON_LENGTH_S,
      actives: null,
      opening: { from: null, edgeShiftLy: 0, dark: [] },
      count: 850,
      bucket: 'fed',
      philosophy: 'feed',
      title: 'Seedbearer',
      glyph: 'season_1_fed',
      awarded: 3,
      next: { from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] },
      finds: [],
    });
    expect(first.path.map((p) => p.day)).toEqual(Array.from({ length: 57 }, (_, i) => D + i));
    expect(first.path[0]).toEqual({ day: D, count: 520, drift: 25, lean: 0.75, votes: 4 });
    expect(first.path.at(-1)).toMatchObject({ day: D + 56, count: 850 });
    expect(await readChronicle(database.db, shard, 2)).toBeNull();

    // a restart: season 2 carries on from the shard's row, its map and its length as stored
    await world.close();
    world = await open();
    expect(world.state()).toMatchObject({
      season: 2,
      count: 500,
      seasonLength: SMALL_SEASON_LENGTH_S,
      opening: { from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY },
    });

    // season 2: the server fills (110 accounts a day), and three of them kill Wardens daily (Break); the server goes down
    // at 01:00 on day 94, after the crowd has come in
    const crowd = Array.from({ length: 110 }, () => randomUUID());
    const breakers = crowd.slice(0, 3);
    for (let day = D + 57; day < D + 84; day++) {
      for (const id of crowd) world.markActive(id);
      for (const id of breakers) world.countAction(id, 'warden-killed', 'break');
      days(1);
      world.advance();
      await world.flush();
    }
    for (const id of crowd) world.markActive(id);
    // thirty burns and drifts down from 500, then on its all-Break target, 150
    expect(world.state()).toMatchObject({ season: 2, count: 150 });
    await world.close();
    expect(
      await database.db
        .select()
        .from(dailyActives)
        .where(and(eq(dailyActives.shardId, shard), eq(dailyActives.day, D + 84))),
    ).toHaveLength(110);

    // down until 01:00 on day 105: season 2 ended at midnight on day 95 while nobody ran the shard, at 145 (day 94's five
    // burns, no votes): Broken
    days(11);
    world = await open();
    // the month before day 95: 110 a day for days 67–94 (28 days) and 4 on days 65–66, 102.9 a day, so season 3 runs
    // eight weeks; Broken, so the Edge advances and two or three systems start dark
    expect(world.state()).toMatchObject({
      season: 3,
      seasonStart: (D + 85) * DAY_S,
      seasonLength: SEASON_LENGTH_S,
      opening: { from: 'broken', edgeShiftLy: -SEASON_EDGE_SHIFT_LY, dark: darkSystems(3) },
    });
    // season 3 from 500: ten days of five burns, no votes
    expect(world.state().count).toBe(500 - 5 * 10);
    const row = await shardRow(shard);
    expect(row).toMatchObject({ season: 3, seasonLength: SEASON_LENGTH_S, seasonOpening: { from: 'broken', dark: darkSystems(3) } });
    expect(row.seasonActives).toBeCloseTo((28 * 110 + 2 * 4) / 30, 10);
    const second = (await readChronicle(database.db, shard, 2))!;
    expect(second).toMatchObject({ season: 2, count: 145, bucket: 'broken', philosophy: 'break', title: 'Anchorbreaker', awarded: 3, actives: 4 });
    expect(second.next).toEqual({ from: 'broken', edgeShiftLy: -SEASON_EDGE_SHIFT_LY, dark: darkSystems(3) });
    expect(second.path.map((p) => p.day)).toEqual(Array.from({ length: 28 }, (_, i) => D + 57 + i));
    expect(await awardedAccounts(shard, 2)).toEqual([...breakers].sort());
    expect((await chronicleRows(shard)).map((r) => [r.season, r.bucket])).toEqual([
      [1, 'fed'],
      [2, 'broken'],
    ]);
    // every day after season 2's end rolled in season 3
    const after = await database.db
      .select()
      .from(countDays)
      .where(and(eq(countDays.shardId, shard), eq(countDays.season, 3)));
    expect(after.map((r) => r.day).sort((x, y) => x - y)).toEqual(Array.from({ length: 10 }, (_, i) => D + 85 + i));
    await world.close();
  }, 120_000);

  it('ends a season under joined clients: the new season, the award to the winner only, kept by its character, and the chronicle over HTTP', async () => {
    const shard = uniqueShard();
    // a season that ends at a midnight 15 s after the server boots: the shard's saved time is just before it, ahead of the
    // wall clock, so the server's clock starts there
    const end = (dayOf((Date.now() - DEFAULT_SHARD_EPOCH_MS) / 1000) + 30) * DAY_S;
    await database.db.insert(shards).values({
      id: shard,
      epoch: new Date(DEFAULT_SHARD_EPOCH_MS),
      lastTime: end - 15,
      season: 1,
      seasonStart: end - SMALL_SEASON_LENGTH_S,
      seasonLength: SMALL_SEASON_LENGTH_S,
    });
    const server = await startTestServer({}, { shard });
    try {
      const keeper = await newAccount(server);
      const breaker = await newAccount(server);
      // the keeper holds at the wall, the breaker raids: the day's lean is 1/6 Feed, so at midnight the Count burns to 499
      // and drifts 25 toward 267, to 474: Held. The keeper's own lean (Hold) is Held's; the breaker's is Broken's
      expect(server.world.countAction(keeper.accountId, 'wall-choice', 'hold')).toBe(true);
      expect(server.world.countAction(breaker.accountId, 'convoy-raided', 'break')).toBe(true);
      const sockets: TestSocket[] = [];
      for (const acct of [keeper, breaker]) {
        const character = await newCharacter(server, acct.token);
        const s = await TestSocket.open(server.wsUrl);
        s.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
        s.send({ t: 'join', characterId: character.id });
        await waitFor(() => s.received.some((m) => m.t === 'quests'), 5000, 'the join');
        // a character with no award is sent none, after its reputation
        const types = s.received.map((m) => m.t);
        expect(types.indexOf('awards')).toBe(types.indexOf('reputation') + 1);
        expect(s.received.find((m) => m.t === 'awards')).toEqual({ t: 'awards', awards: [] });
        sockets.push(s);
      }
      const [keeperSocket, breakerSocket] = sockets as [TestSocket, TestSocket];
      // both entered the world today: counted active once each
      const day = dayOf(server.world.clock.now());
      expect(server.world.dailyActives(day)).toBe(2);
      await server.world.flush();
      expect(await database.db.select().from(dailyActives).where(eq(dailyActives.shardId, shard))).toHaveLength(2);

      expect(server.world.state().season).toBe(1);

      const isSeason2 = (m: ServerMessage) => m.t === 'world' && m.season === 2;
      await waitFor(() => sockets.every((s) => s.received.some(isSeason2)), 30_000, 'season 2');
      for (const s of sockets) {
        expect(s.received.find(isSeason2)).toMatchObject({
          season: 2,
          count: 500,
          seasonStart: end,
          seasonEnd: end + SMALL_SEASON_LENGTH_S,
          opening: { from: 'held', edgeShiftLy: 0, dark: [] },
        });
      }
      const award = seasonAward(1, 'held');
      await waitFor(() => keeperSocket.received.some((m) => m.t === 'awards' && m.awards.length === 1), 10_000, "the keeper's award");
      expect(keeperSocket.received.filter((m) => m.t === 'awards').at(-1)).toEqual({ t: 'awards', awards: [award] });
      expect(award).toEqual({ season: 1, bucket: 'held', title: 'Keeper of the Middle', glyph: 'season_1_held' });
      await new Promise((r) => setTimeout(r, 300));
      expect(breakerSocket.received.filter((m) => m.t === 'awards')).toEqual([{ t: 'awards', awards: [] }]);
      expect(await awardedAccounts(shard, 1)).toEqual([keeper.accountId.toLowerCase()]);
      // the title is also the keeper's in the reputation, told with a title event; the breaker earned none
      const titlesOf = (s: TestSocket) => s.received.flatMap((m) => (m.t === 'reputation' ? m.reputation.titles : []));
      expect(keeperSocket.received).toContainEqual({ t: 'event', event: { kind: 'title', title: { title: award.title } } });
      expect(titlesOf(keeperSocket)).toEqual([{ title: award.title }]);
      expect(titlesOf(breakerSocket)).toEqual([]);

      // the chronicle, to a signed-in player: season 1's, Held at 474 over its one rolled day; season 2 has none yet
      const res = await api<SeasonChronicle>(server, 'GET', '/seasons/1/chronicle', { token: breaker.token });
      expect(res.status).toBe(200);
      expect(seasonChronicleSchema.parse(res.body)).toEqual(res.body);
      expect(res.body).toMatchObject({
        season: 1,
        start: end - SMALL_SEASON_LENGTH_S,
        end,
        count: 474,
        bucket: 'held',
        philosophy: 'hold',
        awarded: 1,
        glyph: 'season_1_held',
      });
      expect(res.body.path).toEqual([{ day: dayOf(end) - 1, count: 474, drift: -25, lean: 1 / 6, votes: 2 }]);
      expect((await api(server, 'GET', '/seasons/2/chronicle', { token: breaker.token })).body).toMatchObject({ error: 'no_chronicle' });
      expect((await api(server, 'GET', '/seasons/2/chronicle', { token: breaker.token })).status).toBe(404);
      expect((await api(server, 'GET', '/seasons/1/chronicle')).status).toBe(401);
      expect((await api(server, 'GET', '/seasons/0/chronicle', { token: breaker.token })).status).toBe(400);
      expect((await api(server, 'GET', '/seasons/1e3/chronicle', { token: breaker.token })).status).toBe(400);

      // the keeper's character keeps it: saved with the character as it leaves, and sent again when it comes back
      const characterId = [...server.ws.registry.sessions].find((x) => x.accountId === keeper.accountId && x.state === 'joined')!.characterId!;
      keeperSocket.close();
      await waitFor(() => server.persistence.status(characterId) === null, 10_000, 'the save on leaving');
      const [saved] = await database.db.select().from(characters).where(eq(characters.id, characterId));
      expect(saved!.state.seasonAwards).toEqual({ v: 1, data: { awards: [award] } });
      const back = await TestSocket.open(server.wsUrl);
      back.send({ t: 'hello', version: PROTOCOL_VERSION, token: keeper.token });
      back.send({ t: 'join', characterId });
      expect(await back.next('awards')).toEqual({ t: 'awards', awards: [award] });
      // a character the account makes after the season carries the account's award too, from the season's record
      const alt = await newCharacter(server, keeper.token);
      back.close();
      const altSocket = await TestSocket.open(server.wsUrl);
      altSocket.send({ t: 'hello', version: PROTOCOL_VERSION, token: keeper.token });
      altSocket.send({ t: 'join', characterId: alt.id });
      expect(await altSocket.next('awards')).toEqual({ t: 'awards', awards: [award] });
      altSocket.close();
      breakerSocket.close();
    } finally {
      await server.close();
    }
  }, 90_000);

  it("gives a character that joins as its season's awards are written the award, though its join read the account's awards before them", async () => {
    const shard = uniqueShard();
    const end = (dayOf((Date.now() - DEFAULT_SHARD_EPOCH_MS) / 1000) + 30) * DAY_S;
    await database.db.insert(shards).values({
      id: shard,
      epoch: new Date(DEFAULT_SHARD_EPOCH_MS),
      lastTime: end - 8,
      season: 1,
      seasonStart: end - SMALL_SEASON_LENGTH_S,
      seasonLength: SMALL_SEASON_LENGTH_S,
    });
    const server = await startTestServer({}, { shard });
    try {
      const keeper = await newAccount(server);
      const character = await newCharacter(server, keeper.token);
      expect(server.world.countAction(keeper.accountId, 'wall-choice', 'hold')).toBe(true);
      // the join's read of the account's awards is held until the season's end has been written and told: it comes back
      // without the award, as a read made just before the write would
      const read = server.seasons.awardsOf.bind(server.seasons);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      server.seasons.awardsOf = async (accountId) => {
        const before = await read(accountId);
        await held;
        return before;
      };
      // (the test's listener is registered after the gateway's, so it hears the end once the gateway has)
      const told = new Promise<void>((resolve) => server.world.onSeasonEnded(() => resolve()));
      const socket = await TestSocket.open(server.wsUrl);
      socket.send({ t: 'hello', version: PROTOCOL_VERSION, token: keeper.token });
      socket.send({ t: 'join', characterId: character.id });
      await told;
      release();
      const award = seasonAward(1, 'held');
      await waitFor(() => socket.received.some((m) => m.t === 'quests'), 5000, 'the join');
      expect(socket.received.filter((m) => m.t === 'awards')).toEqual([{ t: 'awards', awards: [award] }]);
      socket.close();
    } finally {
      await server.close();
    }
  }, 60_000);
});
