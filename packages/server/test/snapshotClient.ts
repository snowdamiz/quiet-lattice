// A client's side of zone snapshots, as ARCHITECTURE §5 describes it, for tests: decode each binary frame, apply a delta
// onto the stored state of its `base` tick (or take a full snapshot as the whole state), store the result as its tick,
// and acknowledge it.
import { applyEntityDelta, decodeSnapshot, type EntityState, type Snapshot } from '@astra/shared/protocol';

export type EntityMap = Map<number, EntityState>;

export class SnapshotClient {
  /** applied states by tick */
  readonly states = new Map<number, EntityMap>();
  readonly snapshots: Snapshot[] = [];
  latestTick: number | null = null;

  constructor(private readonly keep = 256) {}

  /** The state after the latest snapshot applied. */
  get latest(): EntityMap {
    return (this.latestTick !== null && this.states.get(this.latestTick)) || new Map();
  }

  /** Decodes and applies a binary frame; throws when it does not decode or its baseline is unknown. */
  receive(frame: Uint8Array): Snapshot {
    const rejected: number[] = [];
    const snap = decodeSnapshot(frame, rejected);
    if (!snap) throw new Error('undecodable snapshot');
    if (rejected.length) throw new Error(`snapshot ${snap.tick} carried invalid entities ${rejected.join(', ')}`);
    this.apply(snap);
    return snap;
  }

  apply(snap: Snapshot): EntityMap {
    let state: EntityMap;
    if (snap.full) {
      if (snap.removed.length) throw new Error('a full snapshot removes nothing');
      state = new Map(snap.entities.map((e) => [e.id, e]));
    } else {
      const base = this.states.get(snap.base!);
      if (!base) throw new Error(`snapshot ${snap.tick} is based on ${snap.base}, which this client does not hold`);
      state = new Map(base);
      for (const id of snap.removed) {
        if (!state.delete(id)) throw new Error(`snapshot ${snap.tick} removes ${id}, which its base does not hold`);
      }
      for (const d of snap.entities) {
        const prev = state.get(d.id);
        if (!prev && d.clear) throw new Error(`snapshot ${snap.tick} clears fields of new entity ${d.id}`);
        state.set(d.id, prev ? applyEntityDelta(prev, d) : d);
      }
    }
    if (this.latestTick !== null && snap.tick <= this.latestTick) throw new Error(`snapshot ${snap.tick} after ${this.latestTick}`);
    this.states.set(snap.tick, state);
    this.latestTick = snap.tick;
    this.snapshots.push(snap);
    for (const t of this.states.keys()) {
      if (this.states.size <= this.keep) break;
      this.states.delete(t);
    }
    return state;
  }
}
