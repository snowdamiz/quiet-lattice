// The player's inventory: suit stacks and the ship's cargo pods (DESIGN 10.1), held as the shared model from
// `@astra/shared/inventory` so the client predicts with the very functions the server decides with (ARCHITECTURE §7).
// Stack moves go through request(): applied at once for the UI, sent to the server when a net layer is attached
// (P1.E04.T01), and replaced by the server's state when it answers (receive()). The demo's callers keep their flat API:
// items, units, warpCells, add, has, take, sellAll and key.
import { RESOURCE_IDS as RESOURCE_ID_LIST } from '@astra/shared/data';
import {
  addItem,
  applyLayout,
  applyOp,
  countOf,
  layoutFor,
  parseInventory,
  parseOp,
  roomFor,
  startingInventory,
  takeItem,
  totals,
} from '@astra/shared/inventory';

// Each resource's pip in the UI: a shape by where it comes from (dot: plants; diamond: rock, deposits and asteroids;
// hexagon: the crystals and salts of hostile worlds; square: what the Count, the Hollow and the Cartographers leave) and a
// muted hue kept clear of the danger red and the amber accent, which mean something else on the HUD (art bible §4).
export const PIPS = {
  carbon: ['dot', '#93b07e'],
  sodium: ['dot', '#cfd18a'],
  oxygen: ['dot', '#9dc4e6'],
  ferrite: ['diamond', '#b7b2a9'],
  dihydrogen: ['diamond', '#b39cdb'],
  tritium: ['diamond', '#c8e4ec'],
  copper: ['diamond', '#86b39a'],
  cobalt: ['diamond', '#7e9fd4'],
  gold: ['diamond', '#ded0a0'],
  iridium: ['diamond', '#c5cad3'],
  frostglass: ['hex', '#b6e0e8'],
  acidsalt: ['hex', '#b5c77a'],
  cinderglass: ['hex', '#b497a8'],
  stormquartz: ['hex', '#9e9bd0'],
  gamma_crystal: ['hex', '#a9d49a'],
  murkpearl: ['hex', '#8fa9a6'],
  count_residue: ['square', '#d8f6ff'],
  husk_alloy: ['square', '#cfc6b3'],
  glyphstone: ['square', '#7fd8ff'],
};

// Demo sell prices and the HUD's pip colours; the price table goes with station prices (P1.E13.T03).
export const RESOURCES = {
  carbon: { name: 'Carbon', color: PIPS.carbon[1], price: 12 },
  ferrite: { name: 'Ferrite Dust', color: PIPS.ferrite[1], price: 14 },
  sodium: { name: 'Sodium', color: PIPS.sodium[1], price: 41 },
  oxygen: { name: 'Oxygen', color: PIPS.oxygen[1], price: 34 },
  dihydrogen: { name: 'Di-hydrogen', color: PIPS.dihydrogen[1], price: 34 },
  copper: { name: 'Copper', color: PIPS.copper[1], price: 110 },
  cobalt: { name: 'Cobalt', color: PIPS.cobalt[1], price: 198 },
  tritium: { name: 'Tritium', color: PIPS.tritium[1], price: 6 },
  gold: { name: 'Gold', color: PIPS.gold[1], price: 202 },
};

const RESOURCE_IDS = new Set(RESOURCE_ID_LIST);

/** Today's ship, as the client's Ship starts (DESIGN 10.2): the Lark with its Pulse Lasers and its one cargo pod. */
const LARK = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };

/** How long a request may go unanswered before its prediction is dropped: the gateway drops a message over the socket's
 * budget without a word, and the server's state must not stay overlaid with it. */
export const PENDING_MS = 5000;

export class Inventory {
  constructor() {
    // the ship and skills the layout follows: Game passes the ship's own loadout, the ship and skill tasks call setLoadout
    this.ship = LARK;
    this.skills = [];
    this.layout = layoutFor({ ship: this.ship });
    /** The current state: the server's last word with this client's unanswered requests replayed on top. */
    this.state = startingInventory(this.layout);
    /** The server's last word (when online). */
    this.confirmed = this.state;
    /** Requests not yet answered: { seq, op, at }. */
    this.pending = [];
    this.seq = 0;
    /** Set by the net layer: sends a client message. Offline (today) the client's own state stands. */
    this.send = null;
    /** The clock pending requests age by (ms). */
    this.now = () => performance.now();
    /** Bumped on every change, so screens and the HUD can tell when to redraw. */
    this.rev = 0;
  }

  get hull() {
    return this.ship?.hull ?? null;
  }

  set(state) {
    if (state === this.state) return;
    this.state = state;
    this.rev++;
  }

  // ---------- requests (stack moves: the server decides, the client predicts) ----------

  /** Asks for a stack move ({op: 'move' | 'split' | 'merge' | 'transfer' | 'compact', ...}). Returns the predicted result:
   * { ok: true } or { ok: false, error: { code, message } }. An op the server would not even parse is refused here and
   * never sent. */
  request(op) {
    const parsed = parseOp(op);
    if (!parsed.ok) return parsed;
    this.expire();
    const r = applyOp(this.state, parsed.op);
    if (!r.ok) return r;
    this.set(r.inv);
    if (this.send) {
      const seq = ++this.seq;
      this.pending.push({ seq, op: parsed.op, at: this.now() });
      this.send({ t: 'inventory', seq, op: parsed.op });
    } else this.confirmed = this.state;
    return r;
  }

  /** The server's `inventory` message: its state is the truth; requests it has not handled yet are replayed on top. */
  receive(msg) {
    this.confirmed = msg.inventory;
    const now = this.now();
    this.pending = this.pending.filter((p) => p.seq > msg.seq && now - p.at < PENDING_MS);
    this.replay();
    return msg.error ?? null;
  }

  /** The state sent right after `welcome`: a new session, so requests sent on the old socket are gone and numbering starts
   * over. The net layer calls this instead of receive() for it. */
  reset(inventory) {
    this.confirmed = inventory;
    this.pending = [];
    this.seq = 0;
    this.set(inventory);
  }

  /** Drops predictions the server has not answered within PENDING_MS. The net layer may call it each tick; request() calls
   * it too. */
  expire(now = this.now()) {
    const live = this.pending.filter((p) => now - p.at < PENDING_MS);
    if (live.length === this.pending.length) return;
    this.pending = live;
    this.replay();
  }

  replay() {
    let s = this.confirmed;
    for (const p of this.pending) {
      const r = applyOp(s, p.op);
      if (r.ok) s = r.inv;
    }
    this.set(s);
  }

  /** The ship flown (null: none) and the skills owned: one cargo pod per pod aboard the ship, Pack Mule's stack cap. False,
   * and nothing changes, when the new layout cannot hold everything. */
  setLoadout({ ship, skills = [] }) {
    const layout = layoutFor({ ship, skills });
    const r = applyLayout(this.state, layout);
    if (!r.ok) return false;
    this.ship = ship;
    this.skills = [...skills];
    this.layout = layout;
    this.set(r.inv);
    if (!this.send) this.confirmed = this.state;
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
