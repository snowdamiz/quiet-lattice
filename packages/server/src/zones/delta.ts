// Delta snapshots (docs/ARCHITECTURE.md §5). For each session the zone remembers, per tick it sent, the state the client
// holds once it has applied that snapshot: the "sent" state, which is not always the true state, because fields that
// moved by less than the epsilon were not sent and the client still has their old values. A delta is diffed against the
// sent state of the tick the client last acknowledged (`base`), so slow motion under the epsilon still goes out once it
// adds up, and a client applying the delta onto its stored `base` ends up holding exactly the new sent state.
//
// Whenever the client ends up holding exactly an entity's current wire state, the sent state is that wire object itself,
// not a copy. Sessions then share baseline objects, and the zone diffs each entity once per distinct baseline per tick
// rather than once per session.
//
// The history is bounded: a client that has not acknowledged anything for SNAPSHOT_HISTORY ticks (or never has) gets a
// full snapshot, and deltas resume from the first full one it acknowledges.
import { ENTITY_FIELDS, type EntityState } from '@astra/shared/protocol';

/** diffEntity's epsilon: numbers closer than this are the same. */
export const DIFF_EPSILON = 1e-4;
/** Snapshots per session kept for diffing: 3.2 s at 20 Hz. */
export const SNAPSHOT_HISTORY = 64;

/** What one entity's delta is, and the state the client holds after applying it. */
export interface EntityDiff {
  /** null when nothing changed beyond the epsilon */
  delta: EntityState | null;
  sent: EntityState;
}

/**
 * diffEntity(prev, next) (the same fields, the same epsilon, the same `clear`), plus the client's state after applying
 * the delta onto `prev`: next's fields, except those within the epsilon of prev, which keep prev's values. That state is
 * `next` itself when it holds exactly next's values, else `prev` when it holds exactly prev's, else a new object.
 * Values are shared, not copied: states handed in must never be mutated afterwards.
 */
export function diffAgainstSent(prev: EntityState, next: EntityState, eps = DIFF_EPSILON): EntityDiff {
  let delta: Record<string, unknown> | null = null;
  let clear: string[] | undefined;
  // whether the client's state ends up exactly `next`
  let exact = true;
  for (const k of ENTITY_FIELDS) {
    const a = prev[k];
    const b = next[k];
    if (b === undefined) {
      if (a !== undefined) (clear ??= []).push(k);
    } else if (a === b) {
      // the same value, or the same array
    } else if (same(a, b, eps)) {
      if (exact && !identical(a, b)) exact = false;
    } else {
      (delta ??= { id: next.id })[k] = b;
    }
  }
  if (clear) (delta ??= { id: next.id }).clear = clear;
  if (!delta) return { delta: null, sent: exact ? next : prev };
  if (exact) return { delta: delta as EntityState, sent: next };
  const sent: Record<string, unknown> = { id: next.id };
  for (const k of ENTITY_FIELDS) {
    const b = next[k];
    if (b !== undefined) sent[k] = k in delta ? b : prev[k];
  }
  return { delta: delta as EntityState, sent: sent as EntityState };
}

/** shared/protocol's comparison: numbers within eps, arrays element by element, anything else by identity. */
function same(a: unknown, b: unknown, eps: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps || a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i], eps)) return false;
    return true;
  }
  return a === b;
}

/** Exactly equal: the same primitive, or arrays of the same primitives. */
function identical(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The entity states a client holds after applying one tick's snapshot: `states[i]` is entity `ids[i]`'s, ids ascending. */
export interface SentState {
  readonly ids: readonly number[];
  readonly states: readonly EntityState[];
}

/** A SentState as a map from entity id to state (for tests and debugging). */
export function sentMap(s: SentState): Map<number, EntityState> {
  return new Map(s.ids.map((id, i) => [id, s.states[i]!]));
}

/**
 * One session's side of the delta protocol: the sent states of the ticks it may still acknowledge, and the tick it last
 * acknowledged.
 */
export class SnapshotHistory {
  /** sent states by tick, oldest first */
  private readonly sent = new Map<number, SentState>();
  private ackedTick: number | null = null;

  constructor(readonly limit = SNAPSHOT_HISTORY) {}

  /** The last tick the client acknowledged, while the history still holds it. */
  get acked(): number | null {
    return this.ackedTick;
  }

  /** The baseline for the next snapshot: the acknowledged tick and its sent state, or null for a full snapshot. */
  baseline(): { tick: number; state: SentState } | null {
    if (this.ackedTick === null) return null;
    const state = this.sent.get(this.ackedTick);
    return state ? { tick: this.ackedTick, state } : null;
  }

  /** The sent state of `tick`, while it is kept. */
  get(tick: number): SentState | undefined {
    return this.sent.get(tick);
  }

  get size(): number {
    return this.sent.size;
  }

  /** Remembers what the client will hold once it applies the snapshot of `tick`; forgets the oldest past the limit. */
  record(tick: number, state: SentState): void {
    this.sent.set(tick, state);
    while (this.sent.size > this.limit) {
      const oldest = this.sent.keys().next().value!;
      this.sent.delete(oldest);
      if (oldest === this.ackedTick) this.ackedTick = null;
    }
  }

  /**
   * The client has applied the snapshot of `tick`. Acknowledgements only move forward; one for a tick the history does
   * not hold (never sent, or long gone) changes nothing. Ticks before it can never be a baseline again and are dropped.
   * Returns whether it was taken.
   */
  ack(tick: number): boolean {
    if (!this.sent.has(tick) || (this.ackedTick !== null && tick <= this.ackedTick)) return false;
    this.ackedTick = tick;
    for (const t of this.sent.keys()) {
      if (t >= tick) break;
      this.sent.delete(t);
    }
    return true;
  }
}
