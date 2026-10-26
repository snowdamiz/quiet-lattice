// WorldService against an in-memory shard store and a fake Redis: the Phase 1 state, the tier map, subscribe and
// unsubscribe, the mirror, and the clock's epoch and floor from the shard's record.
import { WorldState as WorldMessageSchema } from '@astra/shared/protocol';
import { EDGE_X, galaxyTiers, tierOfGalaxySystem } from '@astra/shared/world';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHARD_EPOCH_MS } from './clock.ts';
import { COUNT_START, worldKey, WorldService, type WorldChange, type WorldMirrorRecord, type WorldServiceOptions } from './service.ts';
import { newShardRecord, SEASON_LENGTH_S, type ShardRecord, type ShardStore } from './shard.ts';

/** A shard's row in memory, created on first load like pgShardStore's. */
class MemoryShardStore implements ShardStore {
  record: ShardRecord | null = null;
  saves: number[] = [];
  constructor(
    readonly id: string,
    private readonly wallMs: number,
    private readonly epochMs = DEFAULT_SHARD_EPOCH_MS,
  ) {}
  async load(): Promise<ShardRecord> {
    this.record ??= newShardRecord(this.id, this.epochMs, this.wallMs);
    return { ...this.record };
  }
  async saveTime(time: number): Promise<void> {
    this.saves.push(time);
    if (this.record) this.record.lastTime = Math.max(this.record.lastTime, time);
  }
}

class FakeRedis {
  readonly values = new Map<string, string>();
  writes = 0;
  fail = false;
  async set(key: string, value: string): Promise<'OK'> {
    if (this.fail) throw new Error('redis is down');
    this.writes++;
    this.values.set(key, value);
    return 'OK';
  }
  record(shard: string): WorldMirrorRecord {
    return JSON.parse(this.values.get(worldKey(shard))!) as WorldMirrorRecord;
  }
}

const logs: { level: string; msg: string; obj: object }[] = [];
const log = {
  info: (obj: object, msg: string) => logs.push({ level: 'info', obj, msg }),
  warn: (obj: object, msg: string) => logs.push({ level: 'warn', obj, msg }),
  error: (obj: object, msg: string) => logs.push({ level: 'error', obj, msg }),
};

const WALL = DEFAULT_SHARD_EPOCH_MS + 300 * 86_400_000; // 300 days into the shard

function setup(opts: Partial<WorldServiceOptions> & { store?: MemoryShardStore } = {}) {
  let mono = 0;
  const store = opts.store ?? new MemoryShardStore('test', WALL);
  const redis = new FakeRedis();
  const open = () => WorldService.open({ store, mirror: redis, log, wallNow: () => WALL, monoNow: () => mono, ...opts });
  return {
    store,
    redis,
    open,
    advance(ms: number) {
      mono += ms;
    },
  };
}

/** An Edge position that flips some systems' tiers (the fringe moves in light year for light year with the Edge). */
const NEARER_EDGE = EDGE_X - 25;

afterEach(() => {
  logs.length = 0;
  vi.useRealTimers();
});

describe('WorldService', () => {
  it('publishes season 1, the Count at 500, the Edge at EDGE_X and the tier map for that Edge', async () => {
    const { open } = setup();
    const world = await open();
    const s = world.state();
    expect(s).toMatchObject({ revision: 1, season: 1, seasonStart: 300 * 86_400, seasonLength: SEASON_LENGTH_S, count: 500, edgeX: EDGE_X });
    expect(COUNT_START).toBe(500);
    expect(s.tiers).toEqual(galaxyTiers(EDGE_X).map((t) => t.tier));
    expect(s.tiers).toHaveLength(galaxyTiers().length);
    for (let i = 0; i < s.tiers.length; i++) expect(world.tierOf(i)).toBe(tierOfGalaxySystem(i));
    expect(() => world.tierOf(s.tiers.length)).toThrow(RangeError);
    expect(() => world.tierOf(1.5)).toThrow(RangeError);
    expect(Object.isFrozen(s) && Object.isFrozen(s.tiers)).toBe(true);
  });

  it('builds a valid `world` message with the server time', async () => {
    const { open, advance } = setup();
    const world = await open();
    advance(2500);
    const m = world.message();
    expect(WorldMessageSchema.parse(m)).toEqual(m);
    expect(m).toEqual({ t: 'world', season: 1, count: 500, edgeX: EDGE_X, tiers: [...world.state().tiers], serverTime: 300 * 86_400 + 2.5 });
    expect(m.serverTime).toBe(world.clock.now());
  });

  it('tells subscribers of a change, with the systems whose tier flipped, until they unsubscribe', async () => {
    const { open } = setup();
    const world = await open();
    const a: WorldChange[] = [];
    const b: WorldChange[] = [];
    world.subscribe((c) => a.push(c));
    const unsubscribeB = world.subscribe((c) => b.push(c));

    const change = world.update({ edgeX: NEARER_EDGE })!;
    const before = galaxyTiers(EDGE_X);
    const after = galaxyTiers(NEARER_EDGE);
    const expected = after.flatMap((t, i) => (t.tier === before[i]!.tier ? [] : [{ system: i, from: before[i]!.tier, to: t.tier }]));
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.every((f) => f.to === 5)).toBe(true); // an advancing Edge only ever raises tiers to 5
    expect(change.flipped).toEqual(expected);
    expect(change.state).toBe(world.state());
    expect(change.state).toMatchObject({ revision: 2, edgeX: NEARER_EDGE, count: 500 });
    expect(change.state.tiers).toEqual(after.map((t) => t.tier));
    expect(change.previous.tiers).toEqual(before.map((t) => t.tier));
    expect(a).toEqual([change]);
    expect(b).toEqual([change]);
    expect(world.message().tiers).toEqual(after.map((t) => t.tier));

    unsubscribeB();
    unsubscribeB(); // twice is harmless
    const second = world.update({ count: 480 })!;
    expect(second.flipped).toEqual([]);
    expect(second.state).toMatchObject({ revision: 3, count: 480, edgeX: NEARER_EDGE });
    expect(a).toEqual([change, second]);
    expect(b).toEqual([change]);
  });

  it('ignores an update that changes nothing and refuses an impossible one', async () => {
    const { open } = setup();
    const world = await open();
    const heard: WorldChange[] = [];
    world.subscribe((c) => heard.push(c));
    expect(world.update({})).toBeNull();
    expect(world.update({ count: 500, edgeX: EDGE_X })).toBeNull();
    expect(() => world.update({ count: 1001 })).toThrow(RangeError);
    expect(() => world.update({ count: -1 })).toThrow(RangeError);
    expect(() => world.update({ count: Number.NaN })).toThrow(RangeError);
    expect(() => world.update({ edgeX: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(heard).toEqual([]);
    expect(world.state().revision).toBe(1);
  });

  it('keeps telling the other subscribers when one throws', async () => {
    const { open } = setup();
    const world = await open();
    const heard: number[] = [];
    world.subscribe(() => {
      throw new Error('boom');
    });
    world.subscribe((c) => heard.push(c.state.revision));
    world.update({ edgeX: NEARER_EDGE });
    expect(heard).toEqual([2]);
    expect(logs.some((l) => l.level === 'error' && l.msg === 'world listener failed')).toBe(true);
  });

  it('mirrors the state to Redis under the shard key on open and on every change', async () => {
    const { open, redis, advance } = setup();
    const world = await open();
    expect(worldKey('test')).toBe('astra:shard:test:world');
    expect(redis.writes).toBe(1);
    expect(redis.record('test')).toEqual({
      ...world.state(),
      tiers: [...world.state().tiers],
      shard: 'test',
      epochMs: DEFAULT_SHARD_EPOCH_MS,
      time: 300 * 86_400,
      at: WALL,
    });

    advance(1000);
    world.update({ edgeX: NEARER_EDGE });
    await world.flush();
    expect(redis.writes).toBe(2);
    const r = redis.record('test');
    expect(r).toMatchObject({ revision: 2, edgeX: NEARER_EDGE, count: 500, time: 300 * 86_400 + 1 });
    expect(r.tiers).toEqual(world.state().tiers);
  });

  it('logs a failed mirror write and carries on', async () => {
    const { open, redis } = setup();
    redis.fail = true;
    const world = await open();
    expect(logs.some((l) => l.level === 'warn' && l.msg === 'could not mirror world state')).toBe(true);
    redis.fail = false;
    world.update({ count: 450 });
    await world.flush();
    expect(redis.record('test').count).toBe(450);
  });

  it('saves the world time and refreshes the mirror every saveEveryMs, and once more on close', async () => {
    vi.useFakeTimers();
    const { open, store, redis, advance } = setup({ saveEveryMs: 1000 });
    const world = await open();
    world.start();
    advance(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await world.flush();
    expect(store.saves).toEqual([300 * 86_400 + 1]);
    expect(redis.writes).toBe(2);
    expect(redis.record('test').time).toBe(300 * 86_400 + 1);

    advance(500);
    await world.close();
    await world.close(); // twice is harmless
    expect(store.saves).toEqual([300 * 86_400 + 1, 300 * 86_400 + 1.5]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.saves).toHaveLength(2); // the timer stopped
  });

  it('starts its clock from the shard record: its epoch, and never below the time it saved', async () => {
    // A shard created 300 days after 2026-01-01Z keeps that epoch and its season start when the server comes back.
    const store = new MemoryShardStore('test', WALL);
    const first = await setup({ store }).open();
    first.update({ count: 400 }); // not persisted: the Count is constant in Phase 1
    const t1 = first.clock.now();
    await first.close();

    const second = await setup({ store, wallNow: () => WALL + 60_000 }).open();
    expect(second.clock.now()).toBe(t1 + 60);
    expect(second.state()).toMatchObject({ season: 1, seasonStart: 300 * 86_400, count: 500 });
    await second.close();
    expect(store.record!.lastTime).toBe(t1 + 60);

    // the host's wall clock stepped back an hour across the restart: world time still carries on from where it was
    const third = await setup({ store, wallNow: () => WALL - 3_600_000 }).open();
    expect(third.clock.now()).toBe(t1 + 60);

    // a shard whose row says another epoch counts from it
    const other = await setup({ store: new MemoryShardStore('other', WALL, WALL - 1_000_000) }).open();
    expect(other.epochMs).toBe(WALL - 1_000_000);
    expect(other.clock.now()).toBe(1000);
  });
});
