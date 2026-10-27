// The world service (docs/ARCHITECTURE.md §1–§3, §11, DESIGN 16, 17): the shard-wide state every zone and client is
// told, namely the season, the Count, where The Edge stands, each star system's tier, and the server clock.
//
// The Count moves with lean and burn (DESIGN 16.1–16.2): gameplay calls countAction() for every counted action and the
// day's ledger keeps one vote per account per action type. advance(), checked every ROLL_CHECK_MS and before every
// counted action, plays the meter forward on the shard clock: a measure burns every 17,280 s, and at each day's end the
// day's lean drifts the Count toward its target. The votes, the rolls and how far the meter has run are saved in one
// batch per write (retried until it lands), so the Count and the open day's ledger survive a restart, and the burns and
// days that passed while the server was down are played on boot. The Edge stands at EDGE_X and the tiers are
// galaxyTiers(edgeX); update() is the lever the Edge following the Count (P2.E22.T02) and dev tooling pull.
//
// Seasons (DESIGN 16.4, ARCHITECTURE §27) roll on the same clock: the meter is played to the season's end (the first meter
// midnight at or after its start plus its length), the Count's bucket there decides how it ended, and the next season
// starts at that midnight with the Count back at 500, the length the last month's daily actives choose and the map the
// bucket leaves (`opening`: the Edge's shift and the systems dark, data the Edge following the meter, P2.E22.T02, applies;
// subscribers hear the roll as a change carrying the ended season). The season's end is saved with the meter (its
// winners' awards and its chronicle, seasons/store.ts) and, once written, told to onSeasonEnded() listeners, who give its
// title and glyph to the characters in play. markActive() counts each account that enters the world once a meter day,
// for that choice. The Reckoning is P3.E34.T03's.
//
// Zones and the gateway subscribe() and hear every change. The state is mirrored to Redis under worldKey(shard), with a
// clock sync point, for the processes P3.E37 will split off (ARCHITECTURE §1). The clock's epoch and floor come from the
// shard's row (shard.ts), and the latest world time is saved back every SAVE_EVERY_MS and on close.
import type { ServerMessage } from '@astra/shared/protocol';
import { ACTIVES_WINDOW_DAYS, seasonEndOf, type SeasonOpening } from '@astra/shared/seasons';
import { EDGE_X, galaxyTiers, type Tier } from '@astra/shared/world';
import { DayLedger } from '../count/ledger.ts';
import {
  burnStepOf,
  checkVote,
  COUNT_MAX,
  COUNT_MIN,
  COUNT_START,
  dayOf,
  leanOf,
  runMeter,
  targetOf,
  underdogSide,
  type CountedAction,
  type CountSide,
  type CountTag,
  type CountVote,
} from '../count/meter.ts';
import type { StoredRoll, StoredVote } from '../count/store.ts';
import { DailyActives } from '../seasons/actives.ts';
import { endSeason, type SeasonEnd, type SeasonPosition } from '../seasons/rules.ts';
import type { SeasonAwarded, StoredActive } from '../seasons/store.ts';
import { createServerClock, type ServerClock } from './clock.ts';
import type { ShardStore } from './shard.ts';

export { COUNT_MAX, COUNT_START } from '../count/meter.ts';
/** How often the latest world time is saved to the shard's row and the Redis mirror refreshed. */
export const SAVE_EVERY_MS = 60_000;
/** How often the service checks whether the shard clock has reached a burn tick or a day's end. */
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
  /** World time (s) the season ends: seasonEndOf(seasonStart, seasonLength), a meter midnight. */
  readonly seasonEnd: number;
  /** The map the season opened with (DESIGN 16.4): how the season before ended, the Edge's shift, the systems dark. */
  readonly opening: SeasonOpening;
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
  /** The season that ended in this change (the state is the next season's, the Count back at COUNT_START). */
  readonly season?: SeasonEnd;
}

export type WorldListener = (change: WorldChange) => void;

/** A season's end once it is written: the season, and what it awarded to whom. */
export interface SeasonEnded {
  readonly ended: SeasonEnd;
  readonly awarded: SeasonAwarded;
}

export type SeasonListener = (e: SeasonEnded) => void;

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

/** What one advance() did. */
export interface MeterAdvance {
  /** Days that rolled. */
  readonly days: number;
  /** Burn ticks that fell. */
  readonly burns: number;
  /** Seasons that ended. */
  readonly seasons: number;
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
  /** Calls `listener` after each season's end is written (its winners' awards stored) until the returned function is
   * called. */
  onSeasonEnded(listener: SeasonListener): () => void;
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
  Object.freeze(state.opening.dark);
  Object.freeze(state.opening);
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
  private readonly seasonListeners = new Set<SeasonListener>();
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
  /** The last burn tick in the Count. */
  private burnStep: number;
  /** Stored votes of the days after the last one rolled, by day: only on boot, until advance() reaches them. */
  private readonly unrolled = new Map<number, StoredVote[]>();
  /** What the meter has not saved yet: written in one batch by the next meter save, and kept for the one after if it fails. */
  private unsavedVotes: StoredVote[] = [];
  private unsavedRolls: StoredRoll[] = [];
  private unsavedActives: StoredActive[] = [];
  private unsavedSeasons: SeasonEnd[] = [];
  private positionMoved = false;
  private seasonMoved = false;
  private meterSaveQueued = false;
  /** Each meter day's distinct active accounts, as far back as a season's choice of length reads. */
  private readonly actives: DailyActives;
  /** The mean daily actives the season's length was chosen from; null for the first season. */
  private seasonActives: number | null;

  /**
   * Loads (or on first boot creates) the shard's row, starts the clock from it, reloads the meter's votes and the daily
   * actives, plays the burns, days and season ends that passed while the shard was down and mirrors the state.
   */
  static async open(opts: WorldServiceOptions): Promise<WorldService> {
    const record = await opts.store.load();
    const count = opts.store.count;
    const votes = record.countDay !== null && count ? await count.votesAfter(record.countDay) : [];
    // The clock never starts below a vote it recorded, as it never starts below the time it saved.
    const floor = votes.reduce((t, v) => Math.max(t, v.at), record.lastTime);
    const clock = createServerClock({ epochMs: record.epochMs, floor, wallNow: opts.wallNow, monoNow: opts.monoNow });
    // On the meter's first run, it starts now: no day has ended and no burn has fallen yet.
    const firstRun = record.countDay === null || record.burnStep === null;
    const rolledThrough = record.countDay ?? dayOf(clock.now()) - 1;
    const burnStep = record.burnStep ?? burnStepOf(clock.now());
    const seasonEnd = seasonEndOf(record.seasonStart, record.seasonLength);
    // the daily actives as far back as the month before this season's end (a season that ended while the shard was down
    // reads it as it ends on boot)
    const today = dayOf(clock.now());
    const read = count ? await count.actives(Math.min(dayOf(seasonEnd), today) - ACTIVES_WINDOW_DAYS, today) : { counts: [], today: [] };
    const actives = new DailyActives(today, read);
    const initial = {
      revision: 1,
      season: record.season,
      seasonStart: record.seasonStart,
      seasonLength: record.seasonLength,
      seasonEnd,
      opening: structuredClone(record.seasonOpening),
      count: record.count,
      edgeX: EDGE_X,
      tiers: tierMap(EDGE_X),
    };
    const world = new WorldService(opts, clock, record.epochMs, initial, rolledThrough, burnStep, votes, actives, record.seasonActives);
    if (firstRun) {
      world.positionMoved = true;
      world.saveMeterSoon();
    }
    const caughtUp = world.advance();
    world.mirrorNow();
    await world.flush();
    const s = world.current;
    opts.log?.info(
      {
        shard: world.shardId,
        season: s.season,
        seasonEnd: s.seasonEnd,
        count: s.count,
        day: world.ledger.day,
        ...caughtUp,
        edgeX: s.edgeX,
        worldTime: clock.now(),
      },
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
    burnStep: number,
    votes: readonly StoredVote[],
    actives: DailyActives,
    seasonActives: number | null,
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
    this.burnStep = burnStep;
    this.actives = actives;
    this.seasonActives = seasonActives;
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

  onSeasonEnded(listener: SeasonListener): () => void {
    this.seasonListeners.add(listener);
    return () => {
      this.seasonListeners.delete(listener);
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
    const change = this.commit({ count, edgeX });
    if (change && change.state.count !== change.previous.count) {
      this.positionMoved = true;
      this.saveMeterSoon();
    }
    return change;
  }

  /**
   * Counts a Feed, Hold or Break action by `accountId` toward today's lean (DESIGN 16.2). Only an account's first vote on
   * an action type each meter day counts: returns true when this one did, false when the account had already voted on
   * that action today. The vote is saved to the shard with the next meter save. Throws RangeError for an account id that
   * is not a uuid, an action that is not counted, or a tag the action cannot carry.
   */
  countAction(accountId: string, action: CountedAction, tag: CountTag): boolean {
    if (!UUID.test(accountId)) throw new RangeError(`an account id is a uuid, not "${accountId}"`);
    checkVote(action, tag);
    this.advance();
    // Postgres hands uuids back lower-case: the ledger's key must match a vote reloaded after a restart.
    const vote: CountVote = { accountId: accountId.toLowerCase(), action, tag };
    if (!this.ledger.vote(vote)) return false;
    if (this.store.count) {
      this.unsavedVotes.push({ ...vote, day: this.ledger.day, at: this.clock.now() });
      this.saveMeterSoon();
    }
    return true;
  }

  /**
   * Counts `accountId` active on today's meter day (an account that entered the world), for the next season's choice of
   * length (DESIGN 16.4): true the first time today, false after. Saved with the next meter save. Throws RangeError for an
   * account id that is not a uuid.
   */
  markActive(accountId: string): boolean {
    if (!UUID.test(accountId)) throw new RangeError(`an account id is a uuid, not "${accountId}"`);
    const id = accountId.toLowerCase();
    const day = dayOf(this.clock.now());
    if (!this.actives.mark(id, day)) return false;
    if (this.store.count) {
      this.unsavedActives.push({ day, accountId: id });
      this.saveMeterSoon();
    }
    return true;
  }

  /** Distinct accounts active on meter day `day`, as far as the tally keeps it (the open day and the month before it). */
  dailyActives(day: number): number {
    return this.actives.on(day);
  }

  /** The meter's open day: its votes, lean and target so far, and the underdog side at the Count now. */
  meter(): MeterState {
    const tally = this.ledger.tally();
    const lean = leanOf(tally);
    return { day: this.ledger.day, votes: tally.votes, lean, target: lean === null ? null : targetOf(lean), underdog: underdogSide(this.current.count) };
  }

  /**
   * Plays the meter forward to the shard clock's now (DESIGN 16.1–16.2, 16.4): every burn tick (a measure every 17,280 s)
   * and every day's end (the day's lean drifts the Count toward its target) that has passed, in time order, and every
   * season's end: the meter is played to it, the season ends in the Count's bucket there (endSeason) and the next starts
   * with the Count at COUNT_START. Subscribers hear each season's roll as a change carrying the season that ended, and the
   * Count the meter reached after it as one more; it is all saved in the next meter save, and logged. Runs every
   * rollCheckMs once started, and before every counted action.
   */
  advance(): MeterAdvance {
    const now = this.clock.now();
    const from = this.current.count;
    let count = from;
    let days = 0;
    let burns = 0;
    let seasons = 0;
    let last: StoredRoll | undefined;
    for (;;) {
      const end = this.current.seasonEnd;
      const position = { count, burnStep: this.burnStep, day: this.ledger.day };
      const run = runMeter(position, Math.min(now, end), (day) => (day === this.ledger.day ? this.ledger : this.openDay(day)).tally());
      if (run.burns > 0 || run.rolls.length > 0) {
        this.burnStep = run.position.burnStep;
        if (run.position.day !== this.ledger.day) this.ledger = this.openDay(run.position.day);
        const season = this.current.season;
        for (const roll of run.rolls) this.unsavedRolls.push((last = { ...roll, season }));
        count = run.position.count;
        days += run.rolls.length;
        burns += run.burns;
        this.positionMoved = true;
      }
      if (now < end) break;
      this.endSeason(count);
      count = this.current.count;
      seasons++;
    }
    if (days === 0 && burns === 0 && seasons === 0) return { days, burns, seasons };
    this.saveMeterSoon();
    this.log?.info({ shard: this.shardId, from, count, burns, days, seasons, ...(last ? { lastRoll: last } : {}) }, 'count meter ran');
    this.commit({ count });
    return { days, burns, seasons };
  }

  /** What the mirror holds now. */
  mirrorRecord(): WorldMirrorRecord {
    return { ...this.current, shard: this.shardId, epochMs: this.epochMs, time: this.clock.now(), at: this.wallNow() };
  }

  /** Starts saving the world time and refreshing the mirror every saveEveryMs, and running the meter as time passes. */
  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.save(), this.saveEveryMs);
    this.timer.unref();
    this.rollTimer = setInterval(() => {
      try {
        this.advance();
      } catch (err) {
        this.log?.error({ shard: this.shardId, err }, 'count meter failed to run');
      }
    }, this.rollCheckMs);
    this.rollTimer.unref();
  }

  /**
   * Saves the latest world time to the shard's row, retries any meter save that failed, and refreshes the mirror (queued;
   * failures are logged).
   */
  save(): void {
    this.enqueue('save world time', () => this.store.saveTime(this.clock.now()));
    this.saveMeterSoon();
    this.mirrorNow();
  }

  /** Resolves once every save and mirror write asked for so far has been tried. */
  flush(): Promise<void> {
    return this.queue;
  }

  /** Stops the timers and saves the world time and the meter one last time. Safe to call twice. */
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

  /**
   * Ends the season at its end with the Count at `count` (DESIGN 16.4): its bucket, and the next season from that
   * midnight, the Count back at COUNT_START, its length chosen from the month's daily actives and its map from the bucket.
   * Subscribers hear it as one change carrying the ended season; it is saved with the next meter save.
   */
  private endSeason(count: number): void {
    const s = this.current;
    const ended = endSeason(this.seasonPosition(), count, this.actives.meanBefore(dayOf(s.seasonEnd)));
    const { next } = ended;
    this.seasonActives = next.actives;
    this.unsavedSeasons.push(ended);
    this.seasonMoved = true;
    this.positionMoved = true;
    this.log?.info(
      {
        shard: this.shardId,
        season: ended.season,
        end: ended.end,
        count,
        bucket: ended.bucket,
        next: next.season,
        length: next.length,
        actives: next.actives,
        opening: next.opening,
      },
      'season ended',
    );
    this.commit({ count: COUNT_START, season: next.season, seasonStart: next.start, seasonLength: next.length, opening: next.opening }, ended);
  }

  /** The season the shard is in, as the shard's row stores it. */
  private seasonPosition(): SeasonPosition {
    const s = this.current;
    return { season: s.season, start: s.seasonStart, length: s.seasonLength, actives: this.seasonActives, opening: s.opening };
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

  /**
   * Queues one meter save, unless one is already waiting: it takes every vote, roll, daily active and season's end
   * gathered by the time it runs, so a burst of votes is one batch and the mirror and time saves queued behind it wait
   * for one transaction. Once it is written, each season's end is told to the season listeners.
   */
  private saveMeterSoon(): void {
    const store = this.store.count;
    if (!store || this.meterSaveQueued) return;
    const nothing = this.unsavedVotes.length === 0 && this.unsavedRolls.length === 0 && this.unsavedActives.length === 0 && this.unsavedSeasons.length === 0;
    if (nothing && !this.positionMoved && !this.seasonMoved) return;
    this.meterSaveQueued = true;
    this.enqueue('save the Count meter', async () => {
      this.meterSaveQueued = false;
      const votes = this.unsavedVotes;
      const rolls = this.unsavedRolls;
      const actives = this.unsavedActives;
      const seasons = this.unsavedSeasons;
      const moved = this.positionMoved;
      const seasonMoved = this.seasonMoved;
      this.unsavedVotes = [];
      this.unsavedRolls = [];
      this.unsavedActives = [];
      this.unsavedSeasons = [];
      this.positionMoved = false;
      this.seasonMoved = false;
      const position = moved ? { count: this.current.count, burnStep: this.burnStep, day: this.ledger.day } : undefined;
      const season = seasonMoved ? this.seasonPosition() : undefined;
      let saved;
      try {
        saved = await store.save({ votes, rolls, actives, seasons, position, season });
      } catch (err) {
        // Kept for the next save (the next vote, burn or roll, the periodic save, or close), which writes them again.
        this.unsavedVotes = votes.concat(this.unsavedVotes);
        this.unsavedRolls = rolls.concat(this.unsavedRolls);
        this.unsavedActives = actives.concat(this.unsavedActives);
        this.unsavedSeasons = seasons.concat(this.unsavedSeasons);
        this.positionMoved ||= moved;
        this.seasonMoved ||= seasonMoved;
        throw err;
      }
      for (const awarded of saved.awarded) {
        const ended = seasons.find((e) => e.season === awarded.season);
        if (!ended) continue;
        this.log?.info({ shard: this.shardId, season: ended.season, bucket: ended.bucket, awarded: awarded.accounts.length }, 'season chronicle written');
        for (const listener of [...this.seasonListeners]) {
          try {
            listener({ ended, awarded });
          } catch (err) {
            this.log?.error({ err }, 'season listener failed');
          }
        }
      }
    });
  }

  /**
   * Applies a change of the Count, the Edge or the season: the tiers follow the Edge, subscribers hear the change and the
   * mirror is rewritten. `ended` is the season that ended in it, for subscribers.
   */
  private commit(
    patch: Partial<Pick<WorldState, 'count' | 'edgeX' | 'season' | 'seasonStart' | 'seasonLength' | 'opening'>>,
    ended?: SeasonEnd,
  ): WorldChange | null {
    const previous = this.current;
    const next = { ...previous, ...patch };
    const { count, edgeX } = next;
    if (!ended && count === previous.count && edgeX === previous.edgeX) return null;

    const tiers = edgeX === previous.edgeX ? [...previous.tiers] : tierMap(edgeX);
    const flipped: TierFlip[] = [];
    tiers.forEach((to, system) => {
      const from = previous.tiers[system]!;
      if (to !== from) flipped.push({ system, from, to });
    });
    const opening = next.opening === previous.opening ? previous.opening : structuredClone(next.opening);
    this.current = frozen({ ...next, revision: previous.revision + 1, seasonEnd: seasonEndOf(next.seasonStart, next.seasonLength), opening, tiers });
    this.body = toBody(this.current);
    const change: WorldChange = { state: this.current, previous, flipped, ...(ended ? { season: ended } : {}) };
    this.log?.info(
      { shard: this.shardId, revision: this.current.revision, season: this.current.season, count, edgeX, flipped: flipped.length },
      'world changed',
    );
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
  return {
    t: 'world',
    season: s.season,
    seasonStart: s.seasonStart,
    seasonEnd: s.seasonEnd,
    opening: { from: s.opening.from, edgeShiftLy: s.opening.edgeShiftLy, dark: [...s.opening.dark] },
    count: s.count,
    edgeX: s.edgeX,
    tiers: [...s.tiers],
  };
}
