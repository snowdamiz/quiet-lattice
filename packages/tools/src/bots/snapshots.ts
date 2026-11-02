import { applyEntityDelta, decodeSnapshot, type EntityState, type Snapshot } from '@astra/shared/protocol';

/** A bounded, zone-local delta cache. Never acknowledge a snapshot that could not be applied. */
export class BotSnapshots {
  private readonly states = new Map<number, Map<number, EntityState>>();
  tick: number | undefined;
  latest = new Map<number, EntityState>();

  reset(): void {
    this.states.clear();
    this.tick = undefined;
    this.latest = new Map();
  }

  receive(bytes: Uint8Array): Snapshot {
    const rejected: number[] = [];
    const snapshot = decodeSnapshot(bytes, rejected);
    if (!snapshot || rejected.length) throw new Error('invalid bot snapshot');
    if (this.tick !== undefined && snapshot.tick <= this.tick) throw new Error('bot snapshot tick went backwards');
    let state: Map<number, EntityState>;
    if (snapshot.full) {
      if (snapshot.removed.length) throw new Error('full snapshot removed entities');
      state = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
    } else {
      const base = snapshot.base === undefined ? undefined : this.states.get(snapshot.base);
      if (!base) throw new Error(`missing bot snapshot baseline ${snapshot.base}`);
      state = new Map(base);
      for (const id of snapshot.removed) state.delete(id);
      for (const entity of snapshot.entities) {
        const previous = state.get(entity.id);
        state.set(entity.id, previous ? applyEntityDelta(previous, entity) : entity);
      }
    }
    this.states.set(snapshot.tick, state);
    this.tick = snapshot.tick;
    this.latest = state;
    while (this.states.size > 64) {
      const oldest = this.states.keys().next().value;
      if (oldest !== undefined) this.states.delete(oldest);
    }
    return snapshot;
  }
}
