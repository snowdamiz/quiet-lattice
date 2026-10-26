// The world service (docs/ARCHITECTURE.md §1–§3, §11, DESIGN 16, 17): the shard-wide state every zone and client is
// told, namely the season, the Count, where The Edge stands, each star system's tier, and the server clock.
//
// The Count moves with lean and burn (DESIGN 16.2): gameplay calls countAction() for every counted action, the day's
// ledger keeps one vote per account per action type, and when the shard clock crosses into a new meter day (advance(),
// checked every ROLL_CHECK_MS) the ended day's lean drifts the Count toward its target and the burn takes its 5. The
// Count and the ledger persist through the shard store, so both survive a restart, and days that ended while the server
// was down roll when it comes back. The Edge stands at EDGE_X and the tiers are galaxyTiers(edgeX); update() is the lever
// the Edge following the Count (P2.E22.T02) and dev tooling pull. Seasons rolling over, the Reckoning and dark stations
// come with P2.E22.T02–T03.
//
// Zones and the gateway subscribe() and hear every change. The state is mirrored to Redis under worldKey(shard), with a
// clock sync point, for the processes P3.E37 will split off (ARCHITECTURE §1). The clock's epoch and floor come from the
// shard's row (shard.ts), and the latest world time is saved back every SAVE_EVERY_MS and on close.
import type { ServerMessage } from '@astra/shared/protocol';
import { EDGE_X, galaxyTiers, type Tier } from '@astra/shared/world';
import { DayLedger } from '../count/ledger.ts';
import {
  checkVote,
  COUNT_MAX,
  COUNT_MIN,
  dayOf,
  leanOf,
  rollDay,
  targetOf,
  underdogSide,
  type CountedAction,
  type CountSide,
  type CountTag,
  type CountVote,
} from '../count/meter.ts';
import type { StoredRoll, StoredVote } from '../count/store.ts';
import { createServerClock, type ServerClock } from './clock.ts';
import type { ShardStore } from './shard.ts';

export { COUNT_MAX, COUNT_START } from '../count/meter.ts';
/** How often the latest world time is saved to the shard's row and the Redis mirror refreshed. */
export const SAVE_EVERY_MS = 60_000;
/** How often the service checks whether the shard clock has crossed into a new meter day. */
export const ROLL_CHECK_MS = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** The Count meter's open day. */
export interface MeterState {
  /** The meter day votes are counted for: world time ÷ 86,400 s, floored. */
  readonly day: number;
  /** Votes counted today. */
  readonly votes: number;
  /** Today's lean so far, 0–1; null before the first vote. */
  readonly lean: number | null;
  /** The Count that lean would pull toward; null with no lean. */
  readonly target: number | null;
  /** The side earning the underdog's bonus rep at the Count now, or null. */
  readonly underdog: CountSide | null;
}

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
  /** ROLL_CHECK_MS */
  rollCheckMs?: number;
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
  private readonly rollCheckMs: number;
  /** Mirror writes and saves run one after another, in the order asked for. */
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private rollTimer: NodeJS.Timeout | undefined;
  private closed: Promise<void> | undefined;
  /** The open meter day's votes. */
  private ledger: DayLedger;
  /** Stored votes of the days after the last one rolled, by day: only on boot, until advance() reaches them. */
  private readonly unrolled = new Map<number, StoredVote[]>();

  /**
   * Loads (or on first boot creates) the shard's row, starts the clock from it, reloads the meter's votes, rolls every
   * meter day that ended while the shard was down and mirrors the state.
   */
  static async open(opts: WorldServiceOptions): Promise<WorldService> {
    const record = await opts.store.load();
    const count = opts.store.count;
    const votes = record.countDay !== null && count ? await count.votesAfter(record.countDay) : [];
    // The clock never starts below a vote it recorded, as it never starts below the time it saved.
    const floor = votes.reduce((t, v) => Math.max(t, v.at), record.lastTime);
    const clock = createServerClock({ epochMs: record.epochMs, floor, wallNow: opts.wallNow, monoNow: opts.monoNow });
    const rolledThrough = record.countDay ?? dayOf(clock.now()) - 1;
    const initial = {
      revision: 1,
      season: record.season,
      seasonStart: record.seasonStart,
      seasonLength: record.seasonLength,
      count: record.count,
      edgeX: EDGE_X,
      tiers: tierMap(EDGE_X),
    };
    const world = new WorldService(opts, clock, record.epochMs, initial, rolledThrough, votes);
    if (record.countDay === null && count) world.enqueue('start the Count meter', () => count.saveCount(record.count, rolledThrough));
    const daysRolled = world.advance();
    world.mirrorNow();
    await world.flush();
    const s = world.current;
    opts.log?.info(
      { shard: world.shardId, season: s.season, count: s.count, day: world.ledger.day, daysRolled, edgeX: s.edgeX, worldTime: clock.now() },
      'world service ready',
    );
    return world;
  }

  private constructor(
    opts: WorldServiceOptions,
    clock: ServerClock,
    epochMs: number,
    initial: Omit<WorldState, 'tiers'> & { tiers: Tier[] },
    rolledThrough: number,
    votes: readonly StoredVote[],
  ) {
    this.shardId = opts.store.id;
    this.store = opts.store;
    this.mirror = opts.mirror;
    this.log = opts.log;
    this.wallNow = opts.wallNow ?? Date.now;
    this.saveEveryMs = opts.saveEveryMs ?? SAVE_EVERY_MS;
    this.rollCheckMs = opts.rollCheckMs ?? ROLL_CHECK_MS;
    this.clock = clock;
    this.epochMs = epochMs;
    this.current = frozen(initial);
    this.body = toBody(this.current);
    for (const v of votes) {
      const day = this.unrolled.get(v.day);
      if (day) day.push(v);
      else this.unrolled.set(v.day, [v]);
    }
    this.ledger = this.openDay(rolledThrough + 1);
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
   * Moves the Count and/or The Edge; the tiers follow the Edge. Every subscriber hears the change, the mirror is
   * rewritten and a new Count is saved to the shard. Returns the change, or null when nothing changed. Throws RangeError
   * for a Count that is not a whole number of measures in 0–1,000 or an Edge that is not a finite x.
   */
  update(patch: { count?: number; edgeX?: number }): WorldChange | null {
    const count = patch.count ?? this.current.count;
    const edgeX = patch.edgeX ?? this.current.edgeX;
    if (!(Number.isInteger(count) && count >= COUNT_MIN && count <= COUNT_MAX)) {
      throw new RangeError(`the Count is a whole number of measures in ${COUNT_MIN}–${COUNT_MAX}, not ${count}`);
    }
    if (!Number.isFinite(edgeX)) throw new RangeError(`the Edge must stand at a finite x (ly), not ${edgeX}`);
    const change = this.commit(count, edgeX);
    const store = this.store.count;
    if (change && store && change.state.count !== change.previous.count) this.enqueue('save the Count', () => store.saveCount(count));
    return change;
  }

  /**
   * Counts a Feed, Hold or Break action by `accountId` toward today's lean (DESIGN 16.2). Only an account's first vote on
   * an action type each meter day counts: returns true when this one did, false when the account had already voted on
   * that action today. The vote is saved to the shard. Throws RangeError for an account id that is not a uuid, an action
   * that is not counted, or a tag the action cannot carry.
   */
  countAction(accountId: string, action: CountedAction, tag: CountTag): boolean {
    if (!UUID.test(accountId)) throw new RangeError(`an account id is a uuid, not "${accountId}"`);
    checkVote(action, tag);
    this.advance();
    const vote: CountVote = { accountId, action, tag };
    if (!this.ledger.vote(vote)) return false;
    const store = this.store.count;
    if (store) {
      const stored: StoredVote = { ...vote, day: this.ledger.day, at: this.clock.now() };
      this.enqueue('save a counted action', () => store.addVote(stored));
    }
    return true;
  }

  /** The meter's open day: its votes, lean and target so far, and the underdog side at the Count now. */
  meter(): MeterState {
    const tally = this.ledger.tally();
    const lean = leanOf(tally);
    return { day: this.ledger.day, votes: tally.votes, lean, target: lean === null ? null : targetOf(lean), underdog: underdogSide(this.current.count) };
  }

  /**
   * Rolls every meter day that has ended by the shard clock into the Count, oldest first (DESIGN 16.2): each day's lean
   * drifts the Count toward its target and the burn takes its 5. Each roll is saved with the new Count and subscribers
   * hear each change. Returns how many days rolled. Runs every rollCheckMs once started, and before every counted action.
   */
  advance(): number {
    const today = dayOf(this.clock.now());
    let rolled = 0;
    while (this.ledger.day < today) {
      const day = this.ledger.day;
      const roll: StoredRoll = { day, season: this.current.season, ...rollDay(this.current.count, this.ledger.tally()) };
      this.ledger = this.openDay(day + 1);
      const store = this.store.count;
      if (store) this.enqueue('save the day roll', () => store.saveRoll(roll));
      this.log?.info({ shard: this.shardId, ...roll }, 'count day rolled');
      this.commit(roll.count, this.current.edgeX);
      rolled++;
    }
    return rolled;
  }

  /** What the mirror holds now. */
  mirrorRecord(): WorldMirrorRecord {
    return { ...this.current, shard: this.shardId, epochMs: this.epochMs, time: this.clock.now(), at: this.wallNow() };
  }

  /** Starts saving the world time and refreshing the mirror every saveEveryMs, and rolling meter days as they end. */
  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.save(), this.saveEveryMs);
    this.timer.unref();
    this.rollTimer = setInterval(() => {
      try {
        this.advance();
      } catch (err) {
        this.log?.error({ shard: this.shardId, err }, 'count day roll failed');
      }
    }, this.rollCheckMs);
    this.rollTimer.unref();
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

  /** Stops the timers and saves the world time one last time. Safe to call twice. */
  close(): Promise<void> {
    return (this.closed ??= (async () => {
      clearInterval(this.timer);
      clearInterval(this.rollTimer);
      this.timer = undefined;
      this.rollTimer = undefined;
      this.save();
      await this.flush();
    })());
  }

  /** The ledger of meter day `day`, holding the votes stored for it (a stored vote that no longer validates is dropped). */
  private openDay(day: number): DayLedger {
    const ledger = new DayLedger(day);
    for (const v of this.unrolled.get(day) ?? []) {
      try {
        ledger.vote(v);
      } catch (err) {
        this.log?.warn({ shard: this.shardId, vote: v, err: err instanceof Error ? err.message : String(err) }, 'dropped a stored vote');
      }
    }
    this.unrolled.delete(day);
    return ledger;
  }

  /** Applies a new Count and Edge: the tiers follow the Edge, subscribers hear the change and the mirror is rewritten. */
  private commit(count: number, edgeX: number): WorldChange | null {
    const previous = this.current;
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
