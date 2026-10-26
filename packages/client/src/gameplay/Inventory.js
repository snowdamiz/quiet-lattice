// The player's inventory: suit stacks and the ship's cargo pods (DESIGN 10.1), held as the shared model from
// `@astra/shared/inventory` so the client predicts with the very functions the server decides with (ARCHITECTURE §7).
// Stack moves go through request(): applied at once for the UI, sent to the server when a net layer is attached
// (P1.E04.T01), and replaced by the server's state when it answers (receive()). The demo's callers keep their flat API:
// items, units, warpCells, add, has, take, sellAll and key.
import { RESOURCE_IDS as RESOURCE_ID_LIST } from '@astra/shared/data';
import { addItem, applyLayout, applyOp, countOf, layoutFor, parseInventory, roomFor, startingInventory, takeItem, totals } from '@astra/shared/inventory';

// Demo sell prices and the HUD's swatch colours; the price table goes with station prices (P1.E13.T03).
export const RESOURCES = {
  carbon: { name: 'Carbon', color: '#e2463f', price: 12 },
  ferrite: { name: 'Ferrite Dust', color: '#b9b4ad', price: 14 },
  sodium: { name: 'Sodium', color: '#ffcc3a', price: 41 },
  oxygen: { name: 'Oxygen', color: '#ff6a55', price: 34 },
  dihydrogen: { name: 'Di-hydrogen', color: '#4fb2ff', price: 34 },
  copper: { name: 'Copper', color: '#ff9a3a', price: 110 },
  cobalt: { name: 'Cobalt', color: '#4f7dff', price: 198 },
  tritium: { name: 'Tritium', color: '#9be8ff', price: 6 },
  gold: { name: 'Gold', color: '#ffd84a', price: 202 },
};

const RESOURCE_IDS = new Set(RESOURCE_ID_LIST);

export class Inventory {
  constructor() {
    // every pilot starts in the Lark (DESIGN 10.2), without skills; the ship and skill tasks call setLoadout
    this.hull = 'lark';
    this.nodes = [];
    this.layout = layoutFor({ hull: this.hull });
    /** The current state: the server's last word with this client's unanswered requests replayed on top. */
    this.state = startingInventory(this.layout);
    /** The server's last word (when online). */
    this.confirmed = this.state;
    /** Requests not yet answered: { seq, op }. */
    this.pending = [];
    this.seq = 0;
    /** Set by the net layer: sends a client message. Offline (today) the client's own state stands. */
    this.send = null;
    /** Bumped on every change, so screens and the HUD can tell when to redraw. */
    this.rev = 0;
  }

  set(state) {
    if (state === this.state) return;
    this.state = state;
    this.rev++;
  }

  // ---------- requests (stack moves: the server decides, the client predicts) ----------

  /** Asks for a stack move ({op: 'move' | 'split' | 'merge' | 'transfer' | 'compact', ...}). Returns the predicted result:
   * { ok: true } or { ok: false, error: { code, message } }. */
  request(op) {
    const r = applyOp(this.state, op);
    if (!r.ok) return r;
    this.set(r.inv);
    if (this.send) {
      const seq = ++this.seq;
      this.pending.push({ seq, op });
      this.send({ t: 'inventory', seq, op });
    } else this.confirmed = this.state;
    return r;
  }

  /** The server's `inventory` message: its state is the truth; requests it has not handled yet are replayed on top. */
  receive(msg) {
    this.confirmed = msg.inventory;
    this.pending = this.pending.filter((p) => p.seq > msg.seq);
    let s = msg.inventory;
    for (const p of this.pending) {
      const r = applyOp(s, p.op);
      if (r.ok) s = r.inv;
    }
    this.set(s);
    return msg.error ?? null;
  }

  /** A new hull (null: no ship) or skill set: cargo pods per hull, Pack Mule. False, and nothing changes, when the new
   * layout cannot hold everything. */
  setLoadout({ hull, nodes = [] }) {
    const layout = layoutFor({ hull, nodes });
    const r = applyLayout(this.state, layout);
    if (!r.ok) return false;
    this.hull = hull;
    this.nodes = [...nodes];
    this.layout = layout;
    this.set(r.inv);
    return true;
  }

  // ---------- the demo's flat API (local until mining, loot and trade move to the server) ----------

  /** Resources held, suit and cargo together: { id: count }. Assigning one (an old save) packs it suit first. */
  get items() {
    const out = {};
    for (const [id, n] of Object.entries(totals(this.state))) if (RESOURCE_IDS.has(id)) out[id] = n;
    return out;
  }

  set items(flat) {
    let s = this.state;
    for (const id of RESOURCE_IDS) {
      const n = countOf(s, id);
      if (n) s = takeItem(s, id, n).inv;
    }
    for (const [id, n] of Object.entries(flat || {})) {
      if (!RESOURCE_IDS.has(id) || !(n > 0)) continue;
      const r = addItem(s, id, Math.floor(n));
      if (r.ok) s = r.inv;
    }
    this.set(s);
  }

  get units() {
    return this.state.units;
  }

  set units(v) {
    const n = Math.max(0, Math.floor(v));
    if (n !== this.state.units) this.set({ ...this.state, units: n });
  }

  get warpCells() {
    return countOf(this.state, 'warp_cell');
  }

  set warpCells(v) {
    const d = Math.max(0, Math.floor(v)) - this.warpCells;
    if (d > 0) this.add('warp_cell', d);
    else if (d < 0) this.take('warp_cell', -d);
  }

  /** Units per stack (Pack Mule raises it). */
  get capacity() {
    return this.state.stackMax;
  }

  /** Adds to the suit, overflowing into the cargo pods (or only to `to`: 'suit' | 'cargo'). Returns how many went in (the
   * rest did not fit). */
  add(id, n, to = 'auto') {
    const r = addItem(this.state, id, Math.floor(n), { to });
    if (!r.ok) return 0;
    this.set(r.inv);
    return r.added;
  }

  /** Room left for `id` in the suit and the cargo together. */
  room(id) {
    return roomFor(this.state, id);
  }

  has(id, n) {
    return countOf(this.state, id) >= n;
  }

  /** Takes from the suit first, then the cargo; all or nothing. */
  take(id, n) {
    const r = takeItem(this.state, id, n);
    if (!r.ok) return false;
    this.set(r.inv);
    return true;
  }

  sellAll(id) {
    const n = countOf(this.state, id);
    if (!n) return 0;
    const earned = n * RESOURCES[id].price;
    this.set({ ...takeItem(this.state, id, n).inv, units: this.state.units + earned });
    return earned;
  }

  key() {
    return `${this.rev}|${this.state.units}`;
  }

  // ---------- the local save (until server-held state, P1.E04.T01) ----------

  /** The whole value, for the save. */
  snapshot() {
    return this.state;
  }

  /** Restores a saved value in this ship's layout. False (and nothing changes) when it is not a valid inventory. */
  restore(saved) {
    const p = parseInventory(saved);
    if (!p.ok) return false;
    const r = applyLayout(p.inv, this.layout);
    this.set(r.ok ? r.inv : p.inv);
    this.confirmed = this.state;
    this.pending = [];
    return true;
  }
}
