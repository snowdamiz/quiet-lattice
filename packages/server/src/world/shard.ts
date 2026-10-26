// A shard's row in Postgres (`shards`, docs/ARCHITECTURE.md §3): its epoch, the latest world time its server saved, its
// season (DESIGN 16.4) and its Count (DESIGN 16.1, §11). The row is created the first time a server boots the shard and
// only read after that, so the epoch and the season survive restarts; the saved time is only ever raised. The Count
// meter's votes and rolls are kept beside it (count/store.ts).
import { eq, sql } from 'drizzle-orm';
import { COUNT_START } from '../count/meter.ts';
import { pgCountStore, type CountStore } from '../count/store.ts';
import type { Db } from '../db/client.ts';
import { shards } from '../db/schema.ts';
import { DEFAULT_SHARD_EPOCH_MS } from './clock.ts';

/** The one shard of Phase 1 (one shard per region comes with P3.E37). */
export const DEFAULT_SHARD_ID = 'main';
/** A season's default length (DESIGN 16.4): eight weeks, in seconds. */
export const SEASON_LENGTH_S = 8 * 7 * 86_400;

export interface ShardRecord {
  id: string;
  /** World time 0, ms since the Unix epoch. */
  epochMs: number;
  /** The latest world time (s) saved. */
  lastTime: number;
  season: number;
  /** World time (s) the season began. */
  seasonStart: number;
  /** The season's length (s). */
  seasonLength: number;
  /** The Count, in whole measures. */
  count: number;
  /** The last meter day rolled into the Count; null until the meter first runs. */
  countDay: number | null;
  /** The last burn tick burned into the Count; null until the meter first runs. */
  burnStep: number | null;
}

/** Where a shard's record lives: Postgres on the server, memory in unit tests. */
export interface ShardStore {
  readonly id: string;
  /** The shard's record, created on first boot: the given epoch, season 1 starting now, SEASON_LENGTH_S long. */
  load(): Promise<ShardRecord>;
  /** Raises the saved world time to `time`; never lowers it. */
  saveTime(time: number): Promise<void>;
  /** Where the Count meter's votes, rolls and position persist. Without one the meter lives in memory only (unit tests). */
  readonly count?: CountStore;
}

/** World time (s) at wall time `wallMs` for a shard whose epoch is `epochMs`, never below 0. */
function worldTimeAt(wallMs: number, epochMs: number): number {
  return Math.max(0, (wallMs - epochMs) / 1000);
}

/** A first boot's record for shard `id`. */
export function newShardRecord(id: string, epochMs: number, wallMs: number): ShardRecord {
  const now = worldTimeAt(wallMs, epochMs);
  return { id, epochMs, lastTime: now, season: 1, seasonStart: now, seasonLength: SEASON_LENGTH_S, count: COUNT_START, countDay: null, burnStep: null };
}

/** Shard `id`'s row in Postgres. `epochMs` and `wallNow` only shape the row a first boot creates. */
export function pgShardStore(db: Db, id: string, opts: { epochMs?: number; wallNow?: () => number } = {}): ShardStore {
  return {
    id,
    async load() {
      const init = newShardRecord(id, opts.epochMs ?? DEFAULT_SHARD_EPOCH_MS, (opts.wallNow ?? Date.now)());
      // Several servers may boot one shard at once (tests do); the first insert wins and everyone reads its row.
      await db
        .insert(shards)
        .values({
          id,
          epoch: new Date(init.epochMs),
          lastTime: init.lastTime,
          season: init.season,
          seasonStart: init.seasonStart,
          seasonLength: init.seasonLength,
        })
        .onConflictDoNothing({ target: shards.id });
      const [row] = await db.select().from(shards).where(eq(shards.id, id));
      if (!row) throw new Error(`shard ${id} has no row after its insert`);
      return {
        id: row.id,
        epochMs: row.epoch.getTime(),
        lastTime: row.lastTime,
        season: row.season,
        seasonStart: row.seasonStart,
        seasonLength: row.seasonLength,
        count: row.count,
        countDay: row.countDay,
        burnStep: row.burnStep,
      };
    },
    async saveTime(time) {
      if (!Number.isFinite(time)) throw new RangeError(`world time must be finite, not ${time}`);
      await db
        .update(shards)
        .set({ lastTime: sql`greatest(${shards.lastTime}, ${time}::double precision)` })
        .where(eq(shards.id, id));
    },
    count: pgCountStore(db, id),
  };
}
