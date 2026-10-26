// The world service's Count meter (DESIGN 16.2) against an in-memory shard store, the clocks driven by hand: counted
// actions, the day roll on the shard clock, the Count published and saved, the ledger and the Count across a restart,
// days missed while down, and the roll timer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_S } from '../count/meter.ts';
import type { CountStore, StoredRoll, StoredVote } from '../count/store.ts';
import { DEFAULT_SHARD_EPOCH_MS } from './clock.ts';
import { WorldService, type WorldChange, type WorldMirrorRecord } from './service.ts';
import { newShardRecord, type ShardRecord, type ShardStore } from './shard.ts';

/** A shard's row, votes and rolls in memory, with pgShardStore's rules: one vote per key, a day rolls once. */
class MemoryShard implements ShardStore {
  record: ShardRecord | null = null;
  votes: StoredVote[] = [];
  rolls: StoredRoll[] = [];
  readonly count: CountStore;
  constructor(
    readonly id: string,
    private readonly wallMs: number,
  ) {
    this.count = {
      votesAfter: async (day) => this.votes.filter((v) => v.day > day).sort((a, b) => a.day - b.day || a.at - b.at),
      addVote: async (v) => {
        if (!this.votes.some((o) => o.day === v.day && o.accountId === v.accountId && o.action === v.action)) this.votes.push({ ...v });
      },
      saveRoll: async (r) => {
        if (this.rolls.some((o) => o.day === r.day)) return;
        this.rolls.push(r);
        this.record!.count = r.count;
        this.record!.countDay = r.day;
      },
      saveCount: async (count, day) => {
        this.record!.count = count;
        if (day !== undefined) this.record!.countDay = day;
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
/** Wall time at 06:00 on meter day 300 of the shard. */
const WALL = DEFAULT_SHARD_EPOCH_MS + (DAY * DAY_S + 6 * 3600) * 1000;
const HOUR_MS = 3_600_000;

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
  it('starts on its first run at 500 with the day before as the last one rolled', async () => {
    const s = shard();
    const world = await s.open();
    expect(world.state().count).toBe(500);
    expect(world.meter()).toEqual({ day: DAY, votes: 0, lean: null, target: null, underdog: null });
    await world.flush();
    expect(s.store.record).toMatchObject({ count: 500, countDay: DAY - 1 });
  });

  it('counts one vote per account per action type per day and saves each one', async () => {
    const s = shard();
    const world = await s.open();
    expect(world.countAction(A, 'convoy-escorted', 'feed')).toBe(true);
    expect(world.countAction(A, 'convoy-escorted', 'feed')).toBe(false);
    expect(world.countAction(B, 'convoy-raided', 'break')).toBe(true);
    expect(world.countAction(B, 'wall-choice', 'hold')).toBe(true);
    expect(world.countAction(B, 'wall-choice', 'feed')).toBe(false);
    // Feed 30 + Break 30 + Hold 30 (10 to Feed): 40 / 90
    expect(world.meter()).toEqual({ day: DAY, votes: 3, lean: 4 / 9, target: 461, underdog: null });
    await world.flush();
    expect(s.store.votes.map((v) => [v.day, v.accountId, v.action, v.tag])).toEqual([
      [DAY, A, 'convoy-escorted', 'feed'],
      [DAY, B, 'convoy-raided', 'break'],
      [DAY, B, 'wall-choice', 'hold'],
    ]);
    expect(s.store.votes[0]!.at).toBe(DAY * DAY_S + 6 * 3600);

    expect(() => world.countAction('not-a-uuid', 'warden-killed', 'break')).toThrow(RangeError);
    expect(() => world.countAction(C, 'warden-killed', 'feed')).toThrow(RangeError);
    expect(() => world.countAction(C, 'nap' as 'warden-killed', 'break')).toThrow(RangeError);
    expect(world.meter().votes).toBe(3);
  });

  it("rolls the day at the shard clock's day boundary, publishes the new Count and saves the roll", async () => {
    const s = shard();
    const world = await s.open();
    const heard: WorldChange[] = [];
    world.subscribe((c) => heard.push(c));
    for (const id of [A, B, C]) world.countAction(id, 'convoy-escorted', 'feed');

    s.hours(17);
    s.minutes(59); // 23:59, still day 300
    expect(world.advance()).toBe(0);
    expect(heard).toEqual([]);
    s.minutes(1);
    expect(world.advance()).toBe(1);
    expect(world.advance()).toBe(0);

    // all Feed: the target is 850, the Count drifts 25 toward it and burns 5
    expect(world.state().count).toBe(520);
    expect(world.message().count).toBe(520);
    expect(heard.map((c) => [c.previous.count, c.state.count])).toEqual([[500, 520]]);
    expect(world.meter()).toEqual({ day: DAY + 1, votes: 0, lean: null, target: null, underdog: null });
    await world.flush();
    expect(s.store.rolls).toEqual([{ day: DAY, season: 1, votes: 3, lean: 1, target: 850, from: 500, drift: 25, burn: 5, count: 520 }]);
    expect(s.store.record).toMatchObject({ count: 520, countDay: DAY });
    expect(s.redis.count()).toBe(520);
    expect(logs.some((l) => l.msg === 'count day rolled')).toBe(true);

    // a new day: everyone votes again
    expect(world.countAction(A, 'convoy-escorted', 'feed')).toBe(true);
  });

  it('rolls the ended day before counting an action cast after the boundary, even before the timer runs', async () => {
    const s = shard();
    const world = await s.open();
    world.countAction(A, 'warden-killed', 'break');
    s.hours(19);
    expect(world.countAction(A, 'warden-killed', 'break')).toBe(true); // a new day's vote
    expect(world.state().count).toBe(470); // all Break: drift −25 toward 150, burn 5
    expect(world.meter()).toMatchObject({ day: DAY + 1, votes: 1, lean: 0 });
    await world.flush();
    expect(s.store.votes.map((v) => v.day)).toEqual([DAY, DAY + 1]);
  });

  it('keeps the day’s ledger and the Count across a restart mid-day', async () => {
    const s = shard();
    const first = await s.open();
    first.countAction(A, 'convoy-escorted', 'feed');
    s.hours(20); // day 301, 02:00: day 300 rolls
    first.countAction(A, 'convoy-raided', 'break');
    first.countAction(B, 'wall-choice', 'hold');
    expect(first.state().count).toBe(520);
    await first.close();

    s.downFor(1);
    const second = await s.open();
    expect(second.state().count).toBe(520);
    expect(second.meter()).toEqual({ day: DAY + 1, votes: 2, lean: 1 / 6, target: 267, underdog: null });
    expect(second.countAction(A, 'convoy-raided', 'break')).toBe(false); // already voted today, before the restart
    expect(second.countAction(B, 'wall-choice', 'break')).toBe(false);
    expect(second.countAction(C, 'convoy-raided', 'break')).toBe(true);

    s.hours(22); // day 302: day 301 rolls with all three of its votes
    expect(second.advance()).toBe(1);
    await second.flush();
    // Break 30 + Hold 30 (10 to Feed) + Break 30: lean 1/9, target 228; 520 drifts −25 and burns 5
    expect(s.store.rolls.at(-1)).toEqual({ day: DAY + 1, season: 1, votes: 3, lean: 1 / 9, target: 228, from: 520, drift: -25, burn: 5, count: 490 });
    expect(second.state().count).toBe(490);
    await second.close();
  });

  it('rolls the days that ended while the server was down when it comes back', async () => {
    const s = shard();
    const first = await s.open();
    for (const id of [A, B]) first.countAction(id, 'anchor-held', 'feed');
    await first.close();

    s.downFor(3 * 24); // back on day 303: days 300 (two Feeds), 301 and 302 (no votes) roll
    const second = await s.open();
    expect(second.state().count).toBe(510); // 500 + 25 − 5, then − 5, − 5
    expect(second.meter().day).toBe(DAY + 3);
    expect(logs.find((l) => l.msg === 'world service ready')!.obj).toMatchObject({ daysRolled: 0 });
    expect(logs.filter((l) => l.msg === 'world service ready').at(-1)!.obj).toMatchObject({ daysRolled: 3, count: 510, day: DAY + 3 });
    await second.flush();
    expect(s.store.rolls.map((r) => [r.day, r.votes, r.drift, r.count])).toEqual([
      [DAY, 2, 25, 520],
      [DAY + 1, 0, 0, 515],
      [DAY + 2, 0, 0, 510],
    ]);
    expect(s.store.record).toMatchObject({ count: 510, countDay: DAY + 2 });
    await second.close();
  });

  it('never starts the clock below a vote it recorded', async () => {
    const s = shard();
    const first = await s.open();
    s.hours(17.5); // 23:30 on day 300
    first.countAction(A, 'convoy-escorted', 'feed');
    await first.flush(); // the vote is saved, but the world time is not (the server dies before its next save)

    // the host's wall clock stepped back a day across the restart
    s.downFor(-24);
    const second = await s.open();
    expect(second.clock.now()).toBe(DAY * DAY_S + 23.5 * 3600);
    expect(second.meter()).toMatchObject({ day: DAY, votes: 1 });
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

  it('rolls the day on its own once started', async () => {
    vi.useFakeTimers();
    const s = shard();
    const world = await s.open({ rollCheckMs: 1000 });
    world.start();
    const heard: number[] = [];
    world.subscribe((c) => heard.push(c.state.count));
    world.countAction(A, 'hive-heart-shattered', 'break');
    s.hours(18);
    await vi.advanceTimersByTimeAsync(1000);
    expect(heard).toEqual([470]);
    await world.close();
    s.hours(24);
    await vi.advanceTimersByTimeAsync(5000);
    expect(heard).toEqual([470]); // the timer stopped
  });
});
