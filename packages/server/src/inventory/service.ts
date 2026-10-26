// The inventory service (P1.E06.T04, ARCHITECTURE §7): the server's copy of every character's inventory, which is the truth.
// A client only requests stack moves (move, split, merge, transfer, compact); the service validates each with the shared
// functions it would predict with, applies it or refuses it, and answers with the authoritative state. Everything else that
// changes an inventory (loot, mining, trade, crafting, the Recall's cargo drop, a new hull) is a server-side call here, and
// listeners (the gateway) push the new state to the character's session.
//
// State lives in memory for the process's lifetime: a character that reconnects resumes its inventory. Persistence arrives
// with P1.E03.T05, which loads a saved value through `open({ saved })` and stores `get()` every 30 s and on logout.
import {
  addItem,
  addUnits,
  applyLayout,
  applyOp,
  dropCargo,
  layoutFor,
  parseInventory,
  parseOp,
  spendUnits,
  startingInventory,
  takeItem,
  type CargoDrop,
  type Inventory,
  type InventoryErrorCode,
  type Result,
  type Where,
} from '@astra/shared/inventory';

/** The ship and skills an inventory's layout follows (cargo pods per hull, Pack Mule). */
export interface Loadout {
  hull: string | null;
  nodes: readonly string[];
}

/** Every character flies the Lark until the ship tasks give it another (DESIGN 10.2: the stake ship). */
export const DEFAULT_LOADOUT: Loadout = { hull: 'lark', nodes: [] };

/** What the client is sent: the state, the last request handled this session (0: none) and why it was refused, if it was. */
export interface InventoryReply {
  seq: number;
  inventory: Inventory;
  error?: InventoryErrorCode;
}

export type InventoryListener = (characterId: string, reply: InventoryReply) => void;

interface Entry {
  inv: Inventory;
  /** The last request seq handled this session; requests must count up from it. */
  seq: number;
}

export class InventoryService {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<InventoryListener>();

  /**
   * Puts a character's inventory in play for a new session: the one already held in memory, else `saved` (a stored value,
   * validated; an invalid one is an error, never silently replaced), else the starting kit for `loadout`. Request numbering
   * starts over. Returns the state to send after `welcome`.
   */
  open(characterId: string, opts: { saved?: unknown; loadout?: Loadout } = {}): InventoryReply {
    let e = this.entries.get(characterId);
    if (!e) {
      let inv: Inventory;
      if (opts.saved !== undefined) {
        const r = parseInventory(opts.saved);
        if (!r.ok) throw new Error(`saved inventory of ${characterId} is invalid: ${r.error.message}`);
        inv = r.inv;
      } else inv = startingInventory(layoutFor(opts.loadout ?? DEFAULT_LOADOUT));
      e = { inv, seq: 0 };
      this.entries.set(characterId, e);
    }
    e.seq = 0;
    return { seq: 0, inventory: e.inv };
  }

  /** The character's inventory, or null when it is not held. */
  get(characterId: string): Inventory | null {
    return this.entries.get(characterId)?.inv ?? null;
  }

  /** Forgets a character's inventory and returns it (for persistence to store first). */
  close(characterId: string): Inventory | null {
    const e = this.entries.get(characterId);
    this.entries.delete(characterId);
    return e?.inv ?? null;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Listens to every server-side change (not to request replies, which go back to the requester). */
  subscribe(fn: InventoryListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * A client's request: `op` is validated as untrusted input, `seq` must be above the last one handled this session (a
   * replayed or reordered request is refused as `stale_seq`). Always answers with the authoritative state; a refused
   * request leaves the inventory as it was and names why.
   */
  request(characterId: string, seq: number, op: unknown): InventoryReply {
    const e = this.entry(characterId);
    if (!Number.isInteger(seq) || seq <= e.seq) return { seq: e.seq, inventory: e.inv, error: 'stale_seq' };
    e.seq = seq;
    const parsed = parseOp(op);
    const r = parsed.ok ? applyOp(e.inv, parsed.op) : parsed;
    if (!r.ok) return { seq, inventory: e.inv, error: r.error.code };
    e.inv = r.inv;
    return { seq, inventory: e.inv };
  }

  /** Adds loot, mining yield or a purchase: the suit first, then the cargo pods ('auto'); the remainder did not fit. */
  grant(characterId: string, item: string, count: number, opts: { to?: Where; partial?: boolean } = {}): Result<{ added: number; remainder: number }> {
    return this.change(characterId, (inv) => addItem(inv, item, count, opts));
  }

  /** Takes exactly `count` (crafting, selling, a refill), the suit first; all or nothing. */
  consume(characterId: string, item: string, count: number, opts: { from?: Where } = {}): Result<{ taken: number }> {
    return this.change(characterId, (inv) => takeItem(inv, item, count, opts));
  }

  earn(characterId: string, units: number): Result {
    return this.change(characterId, (inv) => addUnits(inv, units));
  }

  /** Spends exactly `units`, or refuses with `not_enough`. */
  spend(characterId: string, units: number): Result {
    return this.change(characterId, (inv) => spendUnits(inv, units));
  }

  /** Reshapes to a new hull or skill set (`no_room` when the new layout cannot hold everything; nothing changes then). */
  setLoadout(characterId: string, loadout: Loadout): Result {
    return this.change(characterId, (inv) => applyLayout(inv, layoutFor(loadout)));
  }

  /** The ship died: empties its cargo pods and returns what they held, for the lootable pod (DESIGN 10.1; P1.E06.T03). The
   * suit is untouched. The pods themselves go when the caller sets the loadout to the next hull (or none). */
  dropCargo(characterId: string): CargoDrop {
    let drop: CargoDrop = { stacks: [] };
    this.change(characterId, (inv) => {
      const r = dropCargo(inv);
      drop = r.drop;
      return r;
    });
    return drop;
  }

  private entry(characterId: string): Entry {
    let e = this.entries.get(characterId);
    if (!e) {
      this.open(characterId);
      e = this.entries.get(characterId)!;
    }
    return e;
  }

  private change<T extends object>(characterId: string, fn: (inv: Inventory) => Result<T>): Result<T> {
    const e = this.entry(characterId);
    const r = fn(e.inv);
    if (r.ok && r.inv !== e.inv) {
      e.inv = r.inv;
      const reply = { seq: e.seq, inventory: e.inv };
      for (const l of this.listeners) l(characterId, reply);
    }
    return r;
  }
}
