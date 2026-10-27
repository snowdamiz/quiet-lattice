// The entity store zone snapshots are decoded into (docs/ARCHITECTURE.md §5, §9). A full snapshot is every entity in the
// session's interest; a delta names its baseline, the tick of a snapshot this client acknowledged, and carries only what
// changed since then (`clear` for fields that went, `removed` for entities that left). The store keeps the states it was
// sent per tick so a delta can be applied onto the very state the server diffed against, and keeps the latest as
// `entities`, which gameplay reads (remote entities, P1.E04.T02; reconciliation, P1.E04.T03).
import { applyEntityDelta } from '@astra/shared/protocol';

/** Ticks kept: the server diffs against an acknowledged tick it still holds, at most 64 back (about 3 s). */
export const KEEP_TICKS = 64;

/** What an entity must carry the first time it is seen (the server sends a new entity whole). */
const FIRST_SEEN = ['kind', 'frame', 'pos', 'quat', 'vel'];

export class SnapshotStore {
  constructor(keep = KEEP_TICKS) {
    this.keep = keep;
    this.reset();
  }

  /** A new session: nothing is held (the server starts it with a full snapshot). */
  reset() {
    /** tick → Map(id → EntityState) */
    this.ticks = new Map();
    /** the latest applied tick (−1: none), its world time and the last input seq the server had applied */
    this.tick = -1;
    this.time = 0;
    this.ack = 0;
    /** the latest state: Map(id → EntityState) */
    this.entities = new Map();
  }

  /**
   * Applies a decoded snapshot. False when it cannot be applied as sent, and must then be neither stored nor acknowledged:
   * an old or repeated tick, a delta whose baseline is not held, or one that names an entity it never sent whole. The
   * server keeps diffing against the last tick this client acknowledged, so the next delta (or a full snapshot) repairs it.
   */
  apply(snap) {
    if (snap.tick <= this.tick) return false;
    let base;
    if (snap.full) base = new Map();
    else {
      base = this.ticks.get(snap.base);
      if (!base) return false;
    }
    const out = new Map(base);
    for (const e of snap.entities) {
      const prev = out.get(e.id);
      if (prev) out.set(e.id, applyEntityDelta(prev, e));
      else if (FIRST_SEEN.every((k) => k in e)) out.set(e.id, withoutClear(e));
      else return false;
    }
    for (const id of snap.removed) out.delete(id);
    this.ticks.set(snap.tick, out);
    for (const t of this.ticks.keys()) if (t <= snap.tick - this.keep) this.ticks.delete(t);
    this.tick = snap.tick;
    this.time = snap.time;
    this.ack = snap.ack;
    this.entities = out;
    return true;
  }
}

function withoutClear(e) {
  if (!e.clear) return e;
  const { clear, ...rest } = e;
  return rest;
}
