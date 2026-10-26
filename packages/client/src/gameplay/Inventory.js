// The player's inventory: suit stacks and the ship's cargo pods (DESIGN 10.1), held as the shared model from
// `@astra/shared/inventory` so the client predicts with the very functions the server decides with (ARCHITECTURE §7).
// Stack moves go through request(): applied at once for the UI, sent to the server (Game.enterWorld sets `send`), and
// replaced by the server's state when it answers (receive()). In the world the inventory is the server's: the state after
// welcome replaces everything (reset()), and nothing of it is kept on the client. The demo's callers keep their flat
// API (items, units, warpCells, add, has, take, sellAll and key), which changes only the client's copy until mining, loot
// and trade move to the server: the next state the server sends replaces those changes.
import { SIGNS, nodePosition, strokeEnds } from '@astra/shared/art';
import { RESOURCE_IDS as RESOURCE_ID_LIST, RESOURCES as RESOURCE_TABLE } from '@astra/shared/data';
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

// Each resource's icon (P1.E13.T02): its family's shape with a mark of its own cut out of it, drawn in the pip's hue.
// Plants: a twig, a bulb, petals. Rock, deposits and asteroids: a fracture, the H–H of di-hydrogen, tritium's nucleus,
// a ring, a triangle, a spark, a dense core. Hostile worlds: a snowflake, a drop, a shard, a bolt, the radiation
// trefoil, a pearl. The Count, the Hollow and the Cartographers: a Count numeral, plating with a panel gone, a glyph.
// Marks are SVG on a 16-unit square: `s` stroked, `f` filled (both cut out), `k` kept (drawn back in).
const FRAMES = {
  dot: '<circle cx="8" cy="8" r="7.2"/>',
  diamond: '<path d="M8 .5 15.5 8 8 15.5 .5 8z"/>',
  hex: '<path d="M4.2 1.5h7.6L15.6 8l-3.8 6.5H4.2L.4 8z"/>',
  square: '<rect x="1.3" y="1.3" width="13.4" height="13.4" rx=".8"/>',
};
const MARKS = {
  carbon: '<path class="s" d="M8 12.8V6M8 9.6 5.5 7.2M8 7.8l2.5-2.4"/>',
  sodium: '<circle class="f" cx="8" cy="6.6" r="2.4"/><path class="s" d="M8 9v3.9"/>',
  oxygen: '<circle class="f" cx="8" cy="4.8" r="1.5"/><circle class="f" cx="11.2" cy="8" r="1.5"/><circle class="f" cx="8" cy="11.2" r="1.5"/><circle class="f" cx="4.8" cy="8" r="1.5"/>',
  ferrite: '<path class="s" d="M4.3 9 6.5 6.6l2 2.6 2.1-2.3 1.1 1.2"/>',
  dihydrogen: '<path class="s" d="M6 8h4"/><circle class="f" cx="5.2" cy="8" r="1.7"/><circle class="f" cx="10.8" cy="8" r="1.7"/>',
  tritium: '<circle class="f" cx="8" cy="6.3" r="1.5"/><circle class="f" cx="6.5" cy="9" r="1.5"/><circle class="f" cx="9.5" cy="9" r="1.5"/>',
  copper: '<circle class="s" cx="8" cy="8" r="2.7"/>',
  cobalt: '<path class="s" d="M8 5.1 10.8 10H5.2z"/>',
  gold: '<path class="f" d="M8 3.6 9.1 6.9 12.4 8 9.1 9.1 8 12.4 6.9 9.1 3.6 8 6.9 6.9z"/>',
  iridium: '<path class="s" d="M8 4.5 11.5 8 8 11.5 4.5 8z"/>',
  frostglass: '<path class="s" d="M8 3.5v9M4.1 5.75l7.8 4.5M4.1 10.25l7.8-4.5"/>',
  acidsalt: '<path class="f" d="M8 3.3c1.9 2.6 3.2 4.3 3.2 6a3.2 3.2 0 0 1-6.4 0c0-1.7 1.3-3.4 3.2-6z"/>',
  cinderglass: '<path class="f" d="M6 12.6 9 3.3l1.4 8z"/>',
  stormquartz: '<path class="f" d="M9.4 2.9 5.3 8.8h2.6L6.6 13.1l4.2-6.2H8.2z"/>',
  gamma_crystal:
    '<circle class="f" cx="8" cy="8" r="1.1"/><path class="f" d="M8.95 6.36 10.3 4.02H5.7l1.35 2.34zM6.1 8H3.4l2.3 3.98 1.35-2.34zM8.95 9.65l1.35 2.33L12.6 8H9.9z"/>',
  murkpearl: '<circle class="f" cx="8" cy="8.2" r="3.4"/><circle class="k" cx="6.8" cy="7" r="1"/>',
  // a Count numeral (art bible 3.3): the ring's first four edges lit
  count_residue: '<path class="s" d="M8 3.6 11.8 5.8v4.4L8 12.4 4.2 10.2"/><circle class="f" cx="8" cy="8" r="1.2"/>',
  // plating along its seams, one panel gone (art bible 6)
  husk_alloy: '<path class="s" d="M8 1.3v13.4M1.3 8h13.4" style="stroke-width:1.1"/><path class="f" d="M8.6 .6h7v7h-7z"/>',
  // the Cartographers' sign g (art bible 3.2)
  glyphstone: glyphMark('g'),
};

/** A Cartographer sign as a cut mark: its strokes on the seven-node lattice, 9.6 units across, and its anchor dot. */
function glyphMark(letter) {
  const sign = SIGNS.find((s) => s.letter === letter);
  const at = (n) => nodePosition(n).map((c, i) => (i ? 8 - c * 9.6 : 8 + c * 9.6).toFixed(2)).join(' ');
  const d = sign.strokes.map((s) => strokeEnds(s).map(at)).map(([a, b]) => `M${a} ${b}`);
  return `<path class="s" d="${d.join('')}"/><circle class="f" cx="8" cy="8" r="1.3"/>`;
}

const ICON_STYLE = '.s{fill:none;stroke:#000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.f{fill:#000}.k{fill:#fff}';
const ICON_URLS = Object.fromEntries(
  Object.entries(PIPS).map(([id, [shape]]) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><style>${ICON_STYLE}</style><mask id="m"><g fill="#fff">${FRAMES[shape]}</g>${MARKS[id]}</mask><rect width="16" height="16" mask="url(#m)"/></svg>`;
    return [id, `url('data:image/svg+xml,${encodeURIComponent(svg)}')`];
  }),
);

/** A resource's icon as HTML: an `<i class="res-ico">` masked to its shape and mark, in its pip's hue (style.css). Empty
 * for anything that is not a resource. */
export function resourceIcon(id, cls = '') {
  const pip = PIPS[id];
  return pip ? `<i class="res-ico${cls ? ` ${cls}` : ''}" style="--c:${pip[1]};--m:${ICON_URLS[id]}"></i>` : '';
}

// Every resource's name, its pip's hue and its sell price (DESIGN 15.3's base price); the price table goes with station
// prices (P1.E13.T03).
export const RESOURCES = Object.fromEntries(RESOURCE_TABLE.map((r) => [r.id, { name: r.name, color: PIPS[r.id][1], price: r.basePrice }]));

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
    /** Set by the net layer: sends a client message. Without one (the title, the dev sandbox) the client's own state stands. */
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

  // ---------- dev tooling ----------

  /** Sets a whole inventory value in this ship's layout (the UI captures lay out their scenes with it, in the sandbox).
   * False (and nothing changes) when it is not a valid inventory. */
  restore(value) {
    const p = parseInventory(value);
    if (!p.ok) return false;
    const r = applyLayout(p.inv, this.layout);
    this.set(r.ok ? r.inv : p.inv);
    this.confirmed = this.state;
    this.pending = [];
    return true;
  }
}
