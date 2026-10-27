// The world service's Count meter (DESIGN 16.1–16.2) against an in-memory shard store, the clocks driven by hand:
// counted actions, the burn every 17,280 s and the day's drift on the shard clock, each published and saved, the ledger
// and the Count across a restart, the burns and days missed while down, batched and retried saves, and the timer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { burnStepOf, DAY_S } from '../count/meter.ts';
import type { CountStore, MeterWrite, StoredRoll, StoredVote } from '../count/store.ts';
import { DEFAULT_SHARD_EPOCH_MS } from './clock.ts';
import { WorldService, type WorldChange, type WorldMirrorRecord } from './service.ts';
import { newShardRecord, type ShardRecord, type ShardStore } from './shard.ts';

/** A shard's row, votes and rolls in memory, with pgCountStore's rules: one vote per key, a day stored once. */
class MemoryShard implements ShardStore {
  record: ShardRecord | null = null;
  votes: StoredVote[] = [];
  rolls: StoredRoll[] = [];
  /** Every meter save, as asked. */
  saves: MeterWrite[] = [];
  /** While true, a meter save fails. */
  fail = false;
  readonly count: CountStore;
  constructor(
    readonly id: string,
    private readonly wallMs: number,
  ) {
    this.count = {
      votesAfter: async (day) => this.votes.filter((v) => v.day > day).sort((a, b) => a.day - b.day || a.at - b.at),
      save: async (write) => {
        if (this.fail) throw new Error('postgres is down');
        this.saves.push(write);
        for (const v of write.votes) {
          if (!this.votes.some((o) => o.day === v.day && o.accountId === v.accountId && o.action === v.action)) this.votes.push({ ...v });
        }
        for (const r of write.rolls) if (!this.rolls.some((o) => o.day === r.day)) this.rolls.push(r);
        if (write.position) Object.assign(this.record!, { count: write.position.count, burnStep: write.position.burnStep, countDay: write.position.day - 1 });
      },
    };
  }
  async load(): Promise<ShardRecord> {
    this.record ??= newShardRecord(this.id, DEFAULT_SHARD_EPOCH_MS, this.wallMs);
    return { ...this.record };
  }
  async saveTime(time: number): Promise<void> {
    if (this.record) this.record.lastTime = Math.max(this.record.lastTime, time);
  }
}

class FakeRedis {
  readonly values = new Map<string, string>();
  async set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return 'OK';
  }
  count(): number {
    return (JSON.parse([...this.values.values()].at(-1)!) as WorldMirrorRecord).count;
  }
}

const logs: { level: string; msg: string; obj: object }[] = [];
const log = {
  info: (obj: object, msg: string) => logs.push({ level: 'info', obj, msg }),
  warn: (obj: object, msg: string) => logs.push({ level: 'warn', obj, msg }),
  error: (obj: object, msg: string) => logs.push({ level: 'error', obj, msg }),
};

const DAY = 300;
/** Wall time at 06:00 on meter day 300 of the shard: burn tick 1501 (04:48) has fallen, the next is 09:36. */
const WALL = DEFAULT_SHARD_EPOCH_MS + (DAY * DAY_S + 6 * 3600) * 1000;
const HOUR_MS = 3_600_000;
const FIRST_STEP = burnStepOf(DAY * DAY_S + 6 * 3600);

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

/** A shard and a server process on it: `open()` boots (or reboots) the world service, `hours()` runs its clock on. */
function shard(store = new MemoryShard('test', WALL)) {
  let mono = 0;
  let wall = WALL;
  const redis = new FakeRedis();
  return {
    store,
    redis,
    open: (opts: { rollCheckMs?: number } = {}) => {
      mono = 0;
      return WorldService.open({ store, mirror: redis, log, wallNow: () => wall, monoNow: () => mono, ...opts });
    },
    /** Runs the process's clock on, and the wall clock with it. */
    hours(h: number) {
      mono += h * HOUR_MS;
      wall += h * HOUR_MS;
    },
    minutes(m: number) {
      mono += m * 60_000;
      wall += m * 60_000;
    },
    /** Moves only the wall clock: time passing while no server runs. */
    downFor(h: number) {
      wall += h * HOUR_MS;
    },
  };
}

afterEach(() => {
  logs.length = 0;
  vi.useRealTimers();
});

describe('the Count meter in the world service', () => {
  it('starts on its first run at 500, with no day ended and no burn fallen yet', async () => {
    const s = shard();
    const world = await s.open();
    expect(FIRST_STEP).toBe(DAY * 5 + 1);
    expect(world.state().count).toBe(500);
    expect(world.meter()).toEqual({ day: DAY, votes: 0, lean: null, target: null, underdog: null });
    await world.flush();
    expect(s.store.record).toMatchObject({ count: 500, countDay: DAY - 1, burnStep: FIRST_STEP });
  });

  it('counts one vote per account per action type per day and saves a burst of votes as one batch', async () => {
    const s = shard();
    const world = await s.open();
    const before = s.store.saves.length;
    expect(world.countAction(A, 'convoy-escorted', 'feed')).toBe(true);
    expect(world.countAction(A, 'convoy-escorted', 'feed')).toBe(false);
    expect(world.countAction(B, 'convoy-raided', 'break')).toBe(true);
    expect(world.countAction(B, 'wall-choice', 'hold')).toBe(true);
    expect(world.countAction(B, 'wall-choice', 'feed')).toBe(false);
    // the same account in capitals is the same account
    expect(world.countAction(A.toUpperCase(), 'convoy-escorted', 'feed')).toBe(false);
    expect(world.countAction(C.toUpperCase(), 'warden-killed', 'break')).toBe(true);
    // Feed 30 + Break 30 + Hold 30 (10 to Feed) + Break 30: 40 / 120
    expect(world.meter()).toEqual({ day: DAY, votes: 4, lean: 1 / 3, target: 383, underdog: null });
    // a Reckoning-sized burst
    for (let i = 0; i < 3000; i++) world.countAction(`00000000-0000-4000-9000-${i.toString().padStart(12, '0')}`, 'wall-choice', 'break');
    await world.flush();
    expect(s.store.saves.length - before).toBe(1);
    expect(s.store.votes).toHaveLength(3004);
    expect(s.store.votes.slice(0, 4).map((v) => [v.day, v.accountId, v.action, v.tag])).toEqual([
      [DAY, A, 'convoy-escorted', 'feed'],
      [DAY, B, 'convoy-raided', 'break'],
      [DAY, B, 'wall-choice', 'hold'],
      [DAY, C, 'warden-killed', 'break'],
    ]);
    expect(s.store.votes[0]!.at).toBe(DAY * DAY_S + 6 * 3600);

    expect(() => world.countAction('not-a-uuid', 'warden-killed', 'break')).toThrow(RangeError);
    expect(() => world.countAction(C, 'warden-killed', 'feed')).toThrow(RangeError);
    expect(() => world.countAction(C, 'nap' as 'warden-killed', 'break')).toThrow(RangeError);
    expect(world.meter().votes).toBe(3004);
  });

  it('burns a measure every 4.8 hours and drifts at the day’s end, publishing and saving each change', async () => {
    const s = shard();
    const world = await s.open();
    const heard: WorldChange[] = [];
    world.subscribe((c) => heard.push(c));
    for (const id of [A, B, C]) world.countAction(id, 'convoy-escorted', 'feed');

    // hour by hour to 23:59: burns at 09:36, 14:24 and 19:12
    for (let h = 7; h <= 23; h++) {
      s.hours(1);
      world.advance();
    }
    s.minutes(59);
    expect(world.advance()).toEqual({ days: 0, burns: 0 });
    expect(heard.map((c) => c.state.count)).toEqual([499, 498, 497]);
    await world.flush();
    expect(s.store.record).toMatchObject({ count: 497, burnStep: FIRST_STEP + 3, countDay: DAY - 1 });
    expect(s.redis.count()).toBe(497);

    // midnight: the day's last burn, then the drift: all Feed, 496 drifts 25 toward 850
    s.minutes(1);
    expect(world.advance()).toEqual({ days: 1, burns: 1 });
    expect(world.advance()).toEqual({ days: 0, burns: 0 });
    expect(world.state().count).toBe(521);
    expect(world.message().count).toBe(521);
    expect(heard.map((c) => c.state.count)).toEqual([499, 498, 497, 521]);
    expect(world.meter()).toEqual({ day: DAY + 1, votes: 0, lean: null, target: null, underdog: null });
    await world.flush();
    expect(s.store.rolls).toEqual([{ day: DAY, season: 1, votes: 3, lean: 1, target: 850, from: 496, drift: 25, count: 521 }]);
    expect(s.store.record).toMatchObject({ count: 521, countDay: DAY, burnStep: FIRST_STEP + 4 });
    expect(s.redis.count()).toBe(521);
    expect(logs.filter((l) => l.msg === 'count meter ran').at(-1)!.obj).toMatchObject({ from: 497, count: 521, burns: 1, days: 1, lastRoll: { day: DAY } });

    // a new day: everyone votes again
    expect(world.countAction(A, 'convoy-escorted', 'feed')).toBe(true);
  });

  it('plays the meter forward before counting an action, even before the timer runs', async () => {
    const s = shard();
    const world = await s.open();
    world.countAction(A, 'warden-killed', 'break');
    s.hours(19); // 01:00 on day 301
    expect(world.countAction(A, 'warden-killed', 'break')).toBe(true); // a new day's vote
    expect(world.state().count).toBe(471); // four burns to 496, then all Break: −25 toward 150
    expect(world.meter()).toMatchObject({ day: DAY + 1, votes: 1, lean: 0 });
    await world.flush();
    expect(s.store.votes.map((v) => v.day)).toEqual([DAY, DAY + 1]);
  });

  it('keeps the day’s ledger and the Count across a restart mid-day', async () => {
    const s = shard();
    const first = await s.open();
    first.countAction(A, 'convoy-escorted', 'feed');
    s.hours(20); // 02:00 on day 301: four burns and day 300's drift
    first.countAction(A, 'convoy-raided', 'break');
    first.countAction(B, 'wall-choice', 'hold');
    expect(first.state().count).toBe(521);
    await first.close();

    s.downFor(1);
    const second = await s.open();
    expect(second.state().count).toBe(521); // 03:00: no burn since midnight
    expect(second.meter()).toEqual({ day: DAY + 1, votes: 2, lean: 1 / 6, target: 267, underdog: null });
    expect(second.countAction(A, 'convoy-raided', 'break')).toBe(false); // already voted today, before the restart
    expect(second.countAction(B, 'wall-choice', 'break')).toBe(false);
    expect(second.countAction(C, 'convoy-raided', 'break')).toBe(true);

    s.hours(22); // 01:00 on day 302: five burns, then day 301's drift
    expect(second.advance()).toEqual({ days: 1, burns: 5 });
    await second.flush();
    // Break 30 + Hold 30 (10 to Feed) + Break 30: lean 1/9, target 228; 516 drifts −25
    expect(s.store.rolls.at(-1)).toEqual({ day: DAY + 1, season: 1, votes: 3, lean: 1 / 9, target: 228, from: 516, drift: -25, count: 491 });
    expect(second.state().count).toBe(491);
    await second.close();
  });

  it('plays the burns and days that passed while the server was down, in one save and one log line', async () => {
    const s = shard();
    const first = await s.open();
    for (const id of [A, B]) first.countAction(id, 'anchor-held', 'feed');
    await first.close();
    const saves = s.store.saves.length;
    logs.length = 0;

    s.downFor(3 * 24); // back at 06:00 on day 303
    const second = await s.open();
    // 15 burns in time order with 3 drifts between: day 300's last 4 burns to 496, +25 → 521; days 301 and 302, 5 burns
    // each to 511; day 303's 04:48 burn → 510
    expect(second.state().count).toBe(510);
    expect(second.meter().day).toBe(DAY + 3);
    expect(s.store.saves.length - saves).toBe(1);
    expect(logs.filter((l) => l.msg === 'count meter ran').map((l) => l.obj)).toEqual([
      expect.objectContaining({ from: 500, count: 510, burns: 15, days: 3, lastRoll: expect.objectContaining({ day: DAY + 2 }) }),
    ]);
    expect(logs.filter((l) => l.msg === 'world changed')).toHaveLength(1);
    expect(logs.find((l) => l.msg === 'world service ready')!.obj).toMatchObject({ days: 3, burns: 15, count: 510, day: DAY + 3 });
    expect(s.store.rolls.map((r) => [r.day, r.votes, r.from, r.drift, r.count])).toEqual([
      [DAY, 2, 496, 25, 521],
      [DAY + 1, 0, 516, 0, 516],
      [DAY + 2, 0, 511, 0, 511],
    ]);
    expect(s.store.record).toMatchObject({ count: 510, countDay: DAY + 2, burnStep: FIRST_STEP + 15 });
    await second.close();
  });

  it('keeps a save that failed and writes it with the next one', async () => {
    const s = shard();
    const world = await s.open();
    s.store.fail = true;
    world.countAction(A, 'convoy-escorted', 'feed');
    s.hours(4); // the 09:36 burn
    world.countAction(B, 'convoy-escorted', 'feed');
    await world.flush();
    expect(logs.some((l) => l.level === 'warn' && l.msg === 'could not save the Count meter')).toBe(true);
    expect(s.store.votes).toEqual([]);

    s.store.fail = false;
    world.save(); // the periodic save retries it
    await world.flush();
    expect(s.store.votes.map((v) => v.accountId)).toEqual([A, B]);
    expect(s.store.record).toMatchObject({ count: 499, burnStep: FIRST_STEP + 1 });
  });

  it('never starts the clock below a vote it recorded', async () => {
    const s = shard();
    const first = await s.open();
    s.hours(17.5); // 23:30 on day 300
    first.countAction(A, 'convoy-escorted', 'feed');
    await first.flush(); // the vote and the burns are saved, but not the world time (the server dies before its next save)

    // the host's wall clock stepped back a day across the restart
    s.downFor(-24);
    const second = await s.open();
    expect(second.clock.now()).toBe(DAY * DAY_S + 23.5 * 3600);
    expect(second.meter()).toMatchObject({ day: DAY, votes: 1 });
    expect(second.state().count).toBe(497);
  });

  it('drops a stored vote that no longer validates, with a warning', async () => {
    const s = shard();
    const first = await s.open();
    first.countAction(A, 'convoy-escorted', 'feed');
    await first.close();
    s.store.votes.push({ day: DAY, at: DAY * DAY_S + 7 * 3600, accountId: B, action: 'renamed-action' as 'warden-killed', tag: 'break' });

    const second = await s.open();
    expect(second.meter().votes).toBe(1);
    expect(logs.some((l) => l.level === 'warn' && l.msg === 'dropped a stored vote')).toBe(true);
  });

  it('saves a Count set by update() and refuses one that is not a whole number of measures', async () => {
    const s = shard();
    const world = await s.open();
    world.update({ count: 720 });
    expect(world.meter().underdog).toBe('break');
    expect(() => world.update({ count: 500.5 })).toThrow(RangeError);
    await world.close();
    expect(s.store.record!.count).toBe(720);
    expect((await s.open()).state().count).toBe(720);
  });

  it('runs the meter on its own once started', async () => {
    vi.useFakeTimers();
    const s = shard();
    const world = await s.open({ rollCheckMs: 1000 });
    world.start();
    const heard: number[] = [];
    world.subscribe((c) => heard.push(c.state.count));
    world.countAction(A, 'hive-heart-shattered', 'break');
    s.hours(4); // 10:00: the 09:36 burn
    await vi.advanceTimersByTimeAsync(1000);
    expect(heard).toEqual([499]);
    s.hours(14); // midnight: two more burns, the last, and the drift −25
    await vi.advanceTimersByTimeAsync(1000);
    expect(heard).toEqual([499, 471]);
    await world.close();
    s.hours(24);
    await vi.advanceTimersByTimeAsync(5000);
    expect(heard).toEqual([499, 471]); // the timer stopped
  });
});
