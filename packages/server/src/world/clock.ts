// The server clock (docs/ARCHITECTURE.md §3): world time in seconds since the shard's epoch. It is read from the wall
// clock once, at boot, and then advanced by the monotonic performance clock, so it never steps backwards while the
// process runs and carries on from about where it was after a restart. The world service (P1.E03.T06) takes it over
// and persists the epoch in Postgres.
import { performance } from 'node:perf_hooks';

/** Default shard epoch: 2026-01-01T00:00:00Z. */
export const DEFAULT_SHARD_EPOCH_MS = Date.UTC(2026, 0, 1);

export interface ServerClock {
  /** World time in seconds. */
  now(): number;
}

export function createServerClock(opts: { epochMs?: number; wallNow?: () => number; monoNow?: () => number } = {}): ServerClock {
  const mono = opts.monoNow ?? (() => performance.now());
  const base = ((opts.wallNow ?? Date.now)() - (opts.epochMs ?? DEFAULT_SHARD_EPOCH_MS)) / 1000;
  const start = mono();
  return { now: () => base + (mono() - start) / 1000 };
}
