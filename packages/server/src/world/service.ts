// The world service (docs/ARCHITECTURE.md §1–§3, DESIGN 16, 17): the shard-wide state every zone and client is told,
// namely the season, the Count, where The Edge stands, each star system's tier, and the server clock.
//
// Phase 1 runs it as a stub. The Count holds at 500 (where DESIGN 16.4 starts a season), the Edge stands at EDGE_X and
// the tiers are galaxyTiers(edgeX). update() is the lever that lean and burn (P2.E22.T01), the Edge following the Count
// (P2.E22.T02) and dev tooling will pull; nothing pulls it in Phase 1. Seasons rolling over, the Reckoning and dark
// stations come with those tasks too.
//
// Zones and the gateway subscribe() and hear every change. The state is mirrored to Redis under worldKey(shard), with a
// clock sync point, for the processes P3.E37 will split off (ARCHITECTURE §1). The clock's epoch and floor come from the
// shard's row (shard.ts), and the latest world time is saved back every SAVE_EVERY_MS and on close.
import type { ServerMessage } from '@astra/shared/protocol';
import { EDGE_X, galaxyTiers, type Tier } from '@astra/shared/world';
import { createServerClock, type ServerClock } from './clock.ts';
import type { ShardStore } from './shard.ts';

/** The Count at a season's start, and all through Phase 1 (DESIGN 16.4). */
export const COUNT_START = 500;
/** The Count runs 0–1,000 measures (DESIGN 16.1). */
export const COUNT_MAX = 1000;
/** How often the latest world time is saved to the shard's row and the Redis mirror refreshed. */
export const SAVE_EVERY_MS = 60_000;

export type WorldMessage = Extract<ServerMessage, { t: 'world' }>;

/** The world's shared state. Frozen: a change makes a new one. */
export interface WorldState {
  /** Raised by one on every change. */
  readonly revision: number;
  readonly season: number;
  /** World time (s) the season began. */
  readonly seasonStart: number;
  /** The season's length (s). */
  readonly seasonLength: number;
  /** The Count, 0–1,000 measures. */
  readonly count: number;
  /** x (ly) of the Edge's wall on the X axis (EDGE_X by default). */
  readonly edgeX: number;
  /** Tier of each galaxy system, by index: galaxyTiers(edgeX). */
  readonly tiers: readonly Tier[];
}

/** A system whose tier changed. */
export interface TierFlip {
  system: number;
  from: Tier;
  to: Tier;
}

export interface WorldChange {
  readonly state: WorldState;
  readonly previous: WorldState;
  /** Systems whose tier changed, by index. */
  readonly flipped: readonly TierFlip[];
}

export type WorldListener = (change: WorldChange) => void;

/** What zones and the gateway read of the world. */
export interface WorldSource {
  readonly clock: ServerClock;
  state(): WorldState;
  /** The tier of galaxy system `systemIndex` now. */
  tierOf(systemIndex: number): Tier;
  /** The `world` message for a client, its serverTime read now. */
  message(): WorldMessage;
  /** Calls `listener` after every change until the returned function is called. */
  subscribe(listener: WorldListener): () => void;
}

/** Where the state is mirrored: ioredis's `set`, or a stand-in in tests. */
export interface WorldMirror {
  set(key: string, value: string): Promise<unknown>;
}

/** What the mirror holds under worldKey(shard), as JSON. */
export interface WorldMirrorRecord extends WorldState {
  shard: string;
  /** World time 0, ms since the Unix epoch. */
  epochMs: number;
  /** Clock sync point: world time `time` (s) at wall time `at` (ms). A reader's world time is time + (now − at) / 1000. */
  time: number;
  at: number;
}

/** A pino-shaped logger (Fastify's). */
export interface WorldLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface WorldServiceOptions {
  store: ShardStore;
  mirror?: WorldMirror;
  log?: WorldLog;
  /** SAVE_EVERY_MS */
  saveEveryMs?: number;
  /** wall and monotonic clocks, ms; tests drive them by hand */
  wallNow?: () => number;
  monoNow?: () => number;
}

/** The Redis key a shard's world state is mirrored under. */
export function worldKey(shardId: string): string {
  return `astra:shard:${shardId}:world`;
}

/** Each galaxy system's tier with The Edge at `edgeX`, by index. */
export function tierMap(edgeX: number): Tier[] {
  return galaxyTiers(edgeX).map((s) => s.tier);
}

function frozen(state: Omit<WorldState, 'tiers'> & { tiers: Tier[] }): WorldState {
  Object.freeze(state.tiers);
  return Object.freeze(state);
}

export class WorldService implements WorldSource {
  readonly shardId: string;
  readonly clock: ServerClock;
  /** World time 0, ms since the Unix epoch. */
  readonly epochMs: number;

  private current: WorldState;
  /** The `world` message without its serverTime, rebuilt on every change. */
  private body: Omit<WorldMessage, 'serverTime'>;
  private readonly listeners = new Set<WorldListener>();
  private readonly store: ShardStore;
  private readonly mirror?: WorldMirror;
  private readonly log?: WorldLog;
  private readonly wallNow: () => number;
  private readonly saveEveryMs: number;
  /** Mirror writes and saves run one after another, in the order asked for. */
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private closed: Promise<void> | undefined;

  /** Loads (or on first boot creates) the shard's row, starts the clock from it and mirrors the state. */
  static async open(opts: WorldServiceOptions): Promise<WorldService> {
    const record = await opts.store.load();
    const clock = createServerClock({ epochMs: record.epochMs, floor: record.lastTime, wallNow: opts.wallNow, monoNow: opts.monoNow });
    const world = new WorldService(opts, clock, record.epochMs, {
      revision: 1,
      season: record.season,
      seasonStart: record.seasonStart,
      seasonLength: record.seasonLength,
      count: COUNT_START,
      edgeX: EDGE_X,
      tiers: tierMap(EDGE_X),
    });
    world.mirrorNow();
    await world.flush();
    opts.log?.info({ shard: world.shardId, season: record.season, count: COUNT_START, edgeX: EDGE_X, worldTime: clock.now() }, 'world service ready');
    return world;
  }

  private constructor(opts: WorldServiceOptions, clock: ServerClock, epochMs: number, initial: Omit<WorldState, 'tiers'> & { tiers: Tier[] }) {
    this.shardId = opts.store.id;
    this.store = opts.store;
    this.mirror = opts.mirror;
    this.log = opts.log;
    this.wallNow = opts.wallNow ?? Date.now;
    this.saveEveryMs = opts.saveEveryMs ?? SAVE_EVERY_MS;
    this.clock = clock;
    this.epochMs = epochMs;
    this.current = frozen(initial);
    this.body = toBody(this.current);
  }

  state(): WorldState {
    return this.current;
  }

  tierOf(systemIndex: number): Tier {
    const tier = Number.isInteger(systemIndex) ? this.current.tiers[systemIndex] : undefined;
    if (tier === undefined) throw new RangeError(`the galaxy has no system ${systemIndex}`);
    return tier;
  }

  message(): WorldMessage {
    return { ...this.body, serverTime: this.clock.now() };
  }

  subscribe(listener: WorldListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Moves the Count and/or The Edge; the tiers follow the Edge. Every subscriber hears the change and the mirror is
   * rewritten. Returns the change, or null when nothing changed. Throws RangeError for a Count outside 0–1,000 or an
   * Edge that is not a finite x.
   */
  update(patch: { count?: number; edgeX?: number }): WorldChange | null {
    const previous = this.current;
    const count = patch.count ?? previous.count;
    const edgeX = patch.edgeX ?? previous.edgeX;
    if (!(count >= 0 && count <= COUNT_MAX)) throw new RangeError(`the Count runs 0–${COUNT_MAX} measures, not ${count}`);
    if (!Number.isFinite(edgeX)) throw new RangeError(`the Edge must stand at a finite x (ly), not ${edgeX}`);
    if (count === previous.count && edgeX === previous.edgeX) return null;

    const tiers = edgeX === previous.edgeX ? [...previous.tiers] : tierMap(edgeX);
    const flipped: TierFlip[] = [];
    tiers.forEach((to, system) => {
      const from = previous.tiers[system]!;
      if (to !== from) flipped.push({ system, from, to });
    });
    this.current = frozen({ ...previous, revision: previous.revision + 1, count, edgeX, tiers });
    this.body = toBody(this.current);
    const change: WorldChange = { state: this.current, previous, flipped };
    this.log?.info({ shard: this.shardId, revision: this.current.revision, count, edgeX, flipped: flipped.length }, 'world changed');
    this.mirrorNow();
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (err) {
        this.log?.error({ err }, 'world listener failed');
      }
    }
    return change;
  }

  /** What the mirror holds now. */
  mirrorRecord(): WorldMirrorRecord {
    return { ...this.current, shard: this.shardId, epochMs: this.epochMs, time: this.clock.now(), at: this.wallNow() };
  }

  /** Starts saving the world time and refreshing the mirror every saveEveryMs. */
  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.save(), this.saveEveryMs);
    this.timer.unref();
  }

  /** Saves the latest world time to the shard's row and refreshes the mirror (queued; failures are logged). */
  save(): void {
    this.enqueue('save world time', () => this.store.saveTime(this.clock.now()));
    this.mirrorNow();
  }

  /** Resolves once every save and mirror write asked for so far has been tried. */
  flush(): Promise<void> {
    return this.queue;
  }

  /** Stops the timer and saves the world time one last time. Safe to call twice. */
  close(): Promise<void> {
    return (this.closed ??= (async () => {
      clearInterval(this.timer);
      this.timer = undefined;
      this.save();
      await this.flush();
    })());
  }

  private mirrorNow(): void {
    const mirror = this.mirror;
    if (!mirror) return;
    // The record is read when the write runs, so a queued write always carries the latest state.
    this.enqueue('mirror world state', () => mirror.set(worldKey(this.shardId), JSON.stringify(this.mirrorRecord())));
  }

  private enqueue(what: string, job: () => Promise<unknown>): void {
    this.queue = this.queue.then(job).then(
      () => undefined,
      (err: unknown) => this.log?.warn({ shard: this.shardId, err: err instanceof Error ? err.message : String(err) }, `could not ${what}`),
    );
  }
}

function toBody(s: WorldState): Omit<WorldMessage, 'serverTime'> {
  return { t: 'world', season: s.season, count: s.count, edgeX: s.edgeX, tiers: [...s.tiers] };
}
