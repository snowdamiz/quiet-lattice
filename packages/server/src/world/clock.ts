// The server clock (docs/ARCHITECTURE.md §3): world time in seconds since the shard's epoch. It is read from the wall
// clock once, at boot, and then advanced by the monotonic performance clock, so it never steps backwards while the
// process runs. The epoch, and a floor the clock never starts below (the latest world time the shard saved), come from
// the shard's row in Postgres (WorldService), so the clock carries on from where it was after a restart even when the
// host's wall clock has stepped back.
import { performance } from 'node:perf_hooks';

/** The epoch a new shard is given: 2026-01-01T00:00:00Z. */
export const DEFAULT_SHARD_EPOCH_MS = Date.UTC(2026, 0, 1);

export interface ServerClock {
  /** World time in seconds. */
  now(): number;
}

export interface ServerClockOptions {
  /** World time 0, ms since the Unix epoch (DEFAULT_SHARD_EPOCH_MS). */
  epochMs?: number;
  /** World time (s) the clock never starts below: the latest the shard saved before this boot. */
  floor?: number;
  wallNow?: () => number;
  monoNow?: () => number;
}

export function createServerClock(opts: ServerClockOptions = {}): ServerClock {
  const mono = opts.monoNow ?? (() => performance.now());
  const sinceEpoch = ((opts.wallNow ?? Date.now)() - (opts.epochMs ?? DEFAULT_SHARD_EPOCH_MS)) / 1000;
  const base = Math.max(opts.floor ?? -Infinity, sinceEpoch);
  const start = mono();
  return { now: () => base + (mono() - start) / 1000 };
}
