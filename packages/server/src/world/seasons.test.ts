// Seasons in the world service (DESIGN 16.4, P2.E22.T03) against an in-memory shard, the clocks run by hand: a season
// starts at 500, ends on its midnight in the Count's bucket, and the next starts at 500 with the length the month's daily
// actives choose and the map the bucket leaves; the season's end is saved with its winners' awards and chronicle and told
// to listeners once written; a season that ended while the server was down is played on boot.
import {
  darkSystems,
  SEASON_DAY_S,
  SEASON_EDGE_SHIFT_LY,
  SEASON_LENGTH_S,
  SMALL_POPULATION_ACTIVES,
  SMALL_SEASON_LENGTH_S,
  seasonAward,
} from '@astra/shared/seasons';
import { describe, expect, it } from 'vitest';
import { MemoryShard } from '../../test/memoryShard.ts';
import { DAY_S } from '../count/meter.ts';
import { DEFAULT_SHARD_EPOCH_MS } from './clock.ts';
import { WorldService, type SeasonEnded, type WorldChange } from './service.ts';
import { newShardRecord, type ShardRecord } from './shard.ts';

const HOUR_MS = 3_600_000;
const DAY = 300;
/** 06:00 on meter day 300: the first season begins when the shard first boots, and runs to the midnight after week 8. */
const WALL = DEFAULT_SHARD_EPOCH_MS + (DAY * DAY_S + 6 * 3600) * 1000;
const FIRST_END = (DAY + 57) * DAY_S;

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(uuid);

const logs: { level: string; msg: string; obj: object }[] = [];
const log = {
  info: (obj: object, msg: string) => logs.push({ level: 'info', obj, msg }),
  warn: (obj: object, msg: string) => logs.push({ level: 'warn', obj, msg }),
  error: (obj: object, msg: string) => logs.push({ level: 'error', obj, msg }),
};

/** A shard and a server process on it, the clocks run by hand. `record` starts the shard on a season of its own. */
function shard(record?: Partial<ShardRecord>, wallAt = WALL) {
  const store = new MemoryShard('test', wallAt);
  if (record) store.record = { ...newShardRecord('test', DEFAULT_SHARD_EPOCH_MS, wallAt), ...record };
  let mono = 0;
  let wall = wallAt;
  return {
    store,
    open: () => {
      mono = 0;
      return WorldService.open({ store, log, wallNow: () => wall, monoNow: () => mono });
    },
    hours(h: number) {
      mono += h * HOUR_MS;
      wall += h * HOUR_MS;
    },
    downFor(h: number) {
      wall += h * HOUR_MS;
    },
  };
}

describe('seasons in the world service', () => {
  it('starts at 500, ends on its midnight in the bucket the Count reached, and starts the next at 500 with its length and map', async () => {
    const s = shard();
    const world = await s.open();
    const changes: WorldChange[] = [];
    const ended: SeasonEnded[] = [];
    world.subscribe((c) => changes.push(c));
    world.onSeasonEnded((e) => ended.push(e));
    expect(world.state()).toMatchObject({ season: 1, count: 500, seasonLength: SEASON_LENGTH_S, seasonEnd: FIRST_END, opening: { from: null } });

    // every day of the season: A, B and C escort convoys (Feed), E holds at the wall, D broke once on the first day; all
    // five enter the world
    world.countAction(D, 'convoy-raided', 'break');
    for (let day = DAY; day < DAY + 57; day++) {
      for (const id of [A, B, C, D, E]) world.markActive(id);
      for (const id of [A, B, C]) world.countAction(id, 'convoy-escorted', 'feed');
      world.countAction(E, 'wall-choice', 'hold');
      s.hours(24);
      world.advance();
      // (at 06:00 the Count is back on its target, 733, less the 04:48 burn)
      if (day === DAY + 30) expect(world.state()).toMatchObject({ season: 1, count: 732 });
    }
    // 06:00 the day after the season's end: day 356's drift ended it at 733, Fed (the lean of Feed, Feed, Feed and Hold
    // targets 733); season 2 began at that midnight at 500, and the 04:48 burn took it to 499
    const roll = changes.find((c) => c.season)!;
    expect(roll.season).toMatchObject({ season: 1, start: DAY * DAY_S + 6 * 3600, end: FIRST_END, count: 733, bucket: 'fed', actives: null });
    expect(roll.previous).toMatchObject({ season: 1 });
    expect(roll.state).toMatchObject({
      season: 2,
      count: 500,
      seasonStart: FIRST_END,
      seasonLength: SMALL_SEASON_LENGTH_S,
      seasonEnd: FIRST_END + SMALL_SEASON_LENGTH_S,
    });
    // five accounts a day, far under SMALL_POPULATION_ACTIVES: a four-week season, whose map the Fed season left
    expect(roll.state.opening).toEqual({ from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] });
    expect(world.state()).toMatchObject({ season: 2, count: 499 });
    expect(world.message()).toMatchObject({ season: 2, seasonStart: FIRST_END, seasonEnd: FIRST_END + SMALL_SEASON_LENGTH_S, opening: { from: 'fed' } });
    expect(world.dailyActives(DAY + 56)).toBe(5);

    await world.flush();
    // saved: the shard's row moved on, the chronicle written, the Fed accounts awarded and told; D (who broke) and E (who
    // held: its own lean targets 383, Held) are not
    expect(s.store.record).toMatchObject({
      season: 2,
      seasonStart: FIRST_END,
      seasonLength: SMALL_SEASON_LENGTH_S,
      seasonActives: 5,
      seasonOpening: { from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] },
      count: 499,
    });
    expect(s.store.chronicles).toEqual([expect.objectContaining({ season: 1, bucket: 'fed', count: 733, end: FIRST_END, awarded: 3 })]);
    expect(s.store.awards).toEqual([A, B, C].map((accountId) => ({ accountId, award: seasonAward(1, 'fed') })));
    expect(ended).toHaveLength(1);
    expect(ended[0]!.awarded).toEqual({ season: 1, award: seasonAward(1, 'fed'), accounts: [A, B, C] });
    // the day that ended at the season's end rolled in season 1; the next day is season 2's
    expect(s.store.rolls.filter((r) => r.season === 1).map((r) => r.day)).toEqual(Array.from({ length: 57 }, (_, i) => DAY + i));
    expect(s.store.rolls.filter((r) => r.season === 2)).toEqual([]);
    expect(s.store.actives.filter((a) => a.day === DAY)).toHaveLength(5);
    expect(logs.some((l) => l.msg === 'season ended')).toBe(true);
    await world.close();
  });

  it('chooses eight weeks from a month of many daily actives, and darkens two or three systems after a Broken season', async () => {
    // season 3 began at midnight on day 300 and runs four weeks
    const s = shard({
      season: 3,
      seasonStart: DAY * DAY_S,
      seasonLength: SMALL_SEASON_LENGTH_S,
      seasonActives: 12,
      seasonOpening: { from: 'held', edgeShiftLy: 0, dark: [] },
    });
    const world = await s.open();
    const crowd = Array.from({ length: SMALL_POPULATION_ACTIVES }, (_, i) => uuid(1000 + i));
    for (let day = DAY; day < DAY + 28; day++) {
      for (const id of crowd) world.markActive(id);
      for (const id of crowd.slice(0, 3)) world.countAction(id, 'warden-killed', 'break');
      s.hours(24);
      world.advance();
    }
    // the month before the season's end: 100 a day for its 28 days, none on the two before it, so 93.3 a day, under
    // SMALL_POPULATION_ACTIVES: season 4 runs four weeks, opening on the Broken map
    expect(world.state()).toMatchObject({
      season: 4,
      seasonLength: SMALL_SEASON_LENGTH_S,
      opening: { from: 'broken', edgeShiftLy: -SEASON_EDGE_SHIFT_LY, dark: darkSystems(4) },
    });
    await world.flush();
    expect(s.store.chronicles[0]).toMatchObject({ season: 3, bucket: 'broken', actives: 12, next: { season: 4, actives: (28 * 100) / 30 } });
    expect(s.store.awards.map((a) => a.accountId)).toEqual(crowd.slice(0, 3).sort());
    expect(darkSystems(4).length).toBeGreaterThanOrEqual(2);

    // season 4 runs its four weeks with the crowd: the month before its end is 100 a day, so season 5 runs eight
    for (let day = DAY + 28; day < DAY + 56; day++) {
      for (const id of crowd) world.markActive(id);
      s.hours(24);
      world.advance();
    }
    expect(world.state()).toMatchObject({ season: 5, seasonLength: SEASON_LENGTH_S, opening: { from: 'held', edgeShiftLy: 0, dark: [] } });
    await world.flush();
    expect(s.store.record).toMatchObject({ season: 5, seasonActives: 100, seasonLength: SEASON_LENGTH_S });
    await world.close();
  });

  it("counts a vote by the season it was cast in: the day the season ends is the old season's, the next day the new one's", async () => {
    // season 6 ends at midnight on day 301
    const s = shard({ season: 6, seasonStart: (DAY + 1) * DAY_S - SMALL_SEASON_LENGTH_S, seasonLength: SMALL_SEASON_LENGTH_S });
    const world = await s.open();
    s.hours(17); // 23:00
    world.countAction(A, 'convoy-escorted', 'feed');
    world.countAction(B, 'wall-choice', 'hold');
    s.hours(2); // 01:00 on day 301
    world.countAction(A, 'convoy-raided', 'break');
    expect(world.state()).toMatchObject({ season: 7, count: 500 });
    expect(world.meter()).toMatchObject({ day: DAY + 1, votes: 1, lean: 0 });
    await world.flush();
    // the season ended Held (500, four burns since 06:00, +25 toward the day's 617 → 521): B, whose lean was Hold, earned it;
    // A fed in season 6 (its break came after)
    expect(s.store.chronicles[0]).toMatchObject({ season: 6, count: 521, bucket: 'held', awarded: 1 });
    expect(s.store.awards).toEqual([{ accountId: B, award: seasonAward(6, 'held') }]);
    expect(s.store.rolls).toEqual([expect.objectContaining({ day: DAY, season: 6, count: 521 })]);
    await world.close();
  });

  it("stamps a vote with the time the meter was played to, so a clock that crosses the season's midnight mid-call leaves it in the old season", async () => {
    const end = (DAY + 1) * DAY_S;
    const s = shard({ season: 6, seasonStart: end - SMALL_SEASON_LENGTH_S, seasonLength: SMALL_SEASON_LENGTH_S });
    let mono = 0;
    let step = 0;
    // (each reading of the clock moves it on 2 s once `step` is set: whatever reads it a second time lands after midnight)
    const world = await WorldService.open({ store: s.store, log, wallNow: () => WALL, monoNow: () => ((mono += step), mono - step) });
    mono = (17 * 3600 + 59 * 60 + 59) * 1000; // 23:59:59 on day 300
    step = 2000;
    world.countAction(A, 'convoy-escorted', 'feed');
    step = 0;
    await world.flush();
    expect(s.store.votes).toEqual([expect.objectContaining({ accountId: A, day: DAY, at: end - 1 })]);
    expect(world.state().season).toBe(6);
    await world.close();
  });

  it("plays a season's end that passed while the server was down on boot, from the votes and actives it stored", async () => {
    const s = shard({ season: 2, seasonStart: (DAY + 2) * DAY_S - SMALL_SEASON_LENGTH_S, seasonLength: SMALL_SEASON_LENGTH_S });
    const first = await s.open();
    for (const id of [A, B]) {
      first.markActive(id);
      first.countAction(id, 'anchor-held', 'feed');
    }
    await first.close();

    s.downFor(3 * 24); // back at 06:00 on day 303: the season ended at midnight on day 302
    const second = await s.open();
    expect(second.state()).toMatchObject({ season: 3, seasonStart: (DAY + 2) * DAY_S, seasonLength: SMALL_SEASON_LENGTH_S, opening: { from: 'held' } });
    // season 3 from 500: day 302's five burns, no votes, then the 04:48 burn on day 303
    expect(second.state().count).toBe(494);
    expect(s.store.record).toMatchObject({ season: 3, seasonActives: 2 / 30, count: 494 });
    // day 300 drifted +25 toward 850 (521), day 301 burned to 516: Held, and its two Feed accounts' own lean is Fed
    expect(s.store.chronicles).toEqual([expect.objectContaining({ season: 2, count: 516, bucket: 'held', awarded: 0 })]);
    expect(s.store.awards).toEqual([]);
    // a restart keeps the open day's actives: an account counted before it is not counted again
    expect(second.markActive(A)).toBe(true);
    await second.close();
    const third = await s.open();
    expect(third.markActive(A)).toBe(false);
    expect(third.markActive(B)).toBe(true);
    await third.close();
  });

  it("keeps a season's end through a failed save, and tells its awards once it is written", async () => {
    const s = shard({ season: 4, seasonStart: (DAY + 1) * DAY_S - SMALL_SEASON_LENGTH_S, seasonLength: SMALL_SEASON_LENGTH_S });
    const world = await s.open();
    const ended: SeasonEnded[] = [];
    world.onSeasonEnded((e) => ended.push(e));
    world.countAction(A, 'warden-killed', 'break');
    s.store.fail = true;
    s.hours(20); // 02:00 on day 301: season 4 ended at midnight
    world.advance();
    await world.flush();
    expect(world.state().season).toBe(5);
    expect([s.store.chronicles, ended, s.store.record!.season]).toEqual([[], [], 4]);
    expect(logs.some((l) => l.level === 'warn' && l.msg === 'could not save the Count meter')).toBe(true);

    s.store.fail = false;
    world.save();
    await world.flush();
    expect(s.store.chronicles).toEqual([expect.objectContaining({ season: 4, bucket: 'held', count: 471 })]);
    expect(s.store.record).toMatchObject({ season: 5, count: 500 });
    // 471 is Held; A's own lean is all Break: not a winner of a Held season
    expect(ended).toEqual([{ ended: expect.objectContaining({ season: 4 }), awarded: { season: 4, award: seasonAward(4, 'held'), accounts: [] } }]);
    await world.close();
  });

  it('refuses an account id that is not a uuid', async () => {
    const world = await shard().open();
    expect(() => world.markActive('not-a-uuid')).toThrow(RangeError);
    expect(world.markActive(A.toUpperCase())).toBe(true);
    expect(world.markActive(A)).toBe(false);
    expect(world.dailyActives(DAY)).toBe(1);
    expect(SEASON_DAY_S).toBe(DAY_S);
    await world.close();
  });
});
