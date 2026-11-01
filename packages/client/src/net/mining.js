// The client's side of mining (docs/ARCHITECTURE.md §18): the beam's hits are requests, and what a node is, whole, hurt or
// waiting to grow back, is the server's. The nodes are drawn from the shared scatter (the flora does that); this holds what
// the server says players did to them (`nodes` state, a cell at a time, for the cells round the player) and sends the
// beam's `mine` hits. A node the server says is gone is hidden and cannot be mined; one the beam breaks goes when the
// server's answer says so, never before. The common flora (trees, rocks: each client's own scatter) has no shared state:
// what the client hides is the plants the server answered it broke, as many as the server remembers (one list across all
// worlds: a plant's ref carries its world's frame, so the server's list cannot take one world's plant for another's).

/** The beam's hits go to the server about this often while it stays on a target, s. The server pays a hit the beam time it
 * measured itself (at most 0.5 s), so a slower client loses time and a faster one gains none. */
export const HIT_INTERVAL_S = 0.25;
/** How many broken plants the client keeps hidden, across all worlds: the server refuses a plant it saw broken only among
 * its last 256 for the character. */
export const FLORA_REMEMBERED = 256;
/** The steps the server shows a node's damage to other players in (its SHOWN_STEPS): the exact hp of an answer is rounded
 * the same way, so the node's size does not jump between the two. */
const SHOWN_STEPS = 10;
/** A hit unanswered this long is forgotten (the gateway drops an over-budget message without a reply), ms. */
const PENDING_MS = 10_000;

export class Mining {
  constructor(net) {
    this.net = net;
    /** frame id → cell id → { gone: Set of `<type>_<k>`, hurt: Map of `<type>_<k>` → fraction left } */
    this.frames = new Map();
    /** the refs of the plants of the client's own flora the server answered it broke, on any world, oldest first */
    this.broken = new Set();
    this.seq = 0;
    /** Bumped whenever what is hidden or hurt changes, so the flora knows to redraw. */
    this.rev = 0;
    /** hits sent and not yet answered: seq → { ctx, at } (`ctx` whatever the caller wants back with the answer) */
    this.pending = new Map();
    /** the beam's time on its target since the last hit sent, s */
    this.clock = 0;
    /** refusals by reason (a client bug if any but `rate`, after a stall, and `harvested`, in a race with another miner) */
    this.refused = {};
    this.listeners = new Set();
    net.on('nodes', (m) => this.nodes(m));
    net.on('mine', (m) => this.answered(m));
    net.on('welcome', () => {
      this.seq = 0;
      this.clock = 0;
      this.frames.clear();
      this.broken.clear();
      this.pending.clear();
      this.rev++;
    });
  }

  /** Hears every answer to a hit and every share of a node another player broke: `{ ...mine state, ctx? }`. Returns the
   * unsubscribe. */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- what the server says ----------

  /** The touched nodes round the player on world `m.frame` (the whole state of each cell it names). */
  nodes(m) {
    let cells = this.frames.get(m.frame);
    if (!cells || m.reset) this.frames.set(m.frame, (cells = new Map()));
    for (const c of m.cells) {
      if (c.gone.length || c.hurt.length) cells.set(c.cell, { gone: new Set(c.gone), hurt: new Map(c.hurt) });
      else cells.delete(c.cell);
    }
    this.rev++;
  }

  /** The touched state of a cell of world `frame` (`<face>_<i>_<j>`), or undefined while it is as the scatter places it. */
  cell(frame, cell) {
    return this.frames.get(frame)?.get(cell);
  }

  /** Whether the server says node `<type>_<k>` of `cell` is waiting to grow back. */
  gone(frame, cell, sub) {
    return this.cell(frame, cell)?.gone.has(sub) ?? false;
  }

  /** The fraction of node `<type>_<k>` the server says is left (1: whole). */
  left(frame, cell, sub) {
    return this.cell(frame, cell)?.hurt.get(sub) ?? 1;
  }

  /** Whether the plant of the client's own flora with this ref (its world's frame in it) is hidden. */
  floraGone(ref) {
    return this.broken.has(ref);
  }

  /** Splits a node id (`<face>_<i>_<j>_<type>_<k>`) into its cell and the node within it. */
  static split(id) {
    const at = id.indexOf('_', id.indexOf('_', id.indexOf('_') + 1) + 1);
    return [id.slice(0, at), id.slice(at + 1)];
  }

  touch(frame, cell) {
    let cells = this.frames.get(frame);
    if (!cells) this.frames.set(frame, (cells = new Map()));
    let c = cells.get(cell);
    if (!c) cells.set(cell, (c = { gone: new Set(), hurt: new Map() }));
    return c;
  }

  breakNode(frame, id) {
    const [cell, sub] = Mining.split(id);
    const c = this.touch(frame, cell);
    c.gone.add(sub);
    c.hurt.delete(sub);
  }

  breakFlora(ref) {
    this.broken.delete(ref);
    this.broken.add(ref);
    if (this.broken.size > FLORA_REMEMBERED) this.broken.delete(this.broken.values().next().value);
  }

  /** The server's answer to a hit, or its word that another miner's share of a node is ours (`seq` 0). */
  answered(m) {
    const p = this.pending.get(m.seq);
    this.pending.delete(m.seq);
    const reason = m.reason;
    if (m.result === 'refused') this.refused[reason] = (this.refused[reason] ?? 0) + 1;
    if (m.node !== undefined) {
      const [cell, sub] = Mining.split(m.node);
      if (m.result === 'depleted' || (m.result === 'refused' && reason === 'harvested')) this.breakNode(m.frame, m.node);
      else if (m.result === 'hit') this.touch(m.frame, cell).hurt.set(sub, Math.ceil(m.hp * SHOWN_STEPS) / SHOWN_STEPS);
    } else if (m.result === 'depleted' || (m.result === 'refused' && reason === 'harvested')) this.breakFlora(m.flora);
    this.rev++;
    for (const fn of [...this.listeners]) fn({ ...m, ctx: p?.ctx });
  }

  // ---------- what the beam asks ----------

  /**
   * The beam stayed `dt` seconds on `target` (a node of world `frame` by its id, or a plant of the flora: `{ kind, ref, at
   * }`): sends a hit once every HIT_INTERVAL_S of it, with `ctx` given back with the answer. Returns whether one went. A
   * node the server says is gone is never asked for. `time` is the game's world time.
   */
  beam(dt, frame, target, ctx, time) {
    if (!this.net.joined) return false;
    if (target.node !== undefined) {
      const [cell, sub] = Mining.split(target.node);
      if (this.gone(frame, cell, sub)) return false;
    } else if (this.floraGone(target.flora.ref)) return false;
    this.clock += dt;
    if (this.clock < HIT_INTERVAL_S) return false;
    // (what a frame went over is kept, so the rate holds; a stall's backlog is not sent as a burst)
    this.clock -= HIT_INTERVAL_S;
    if (this.clock >= HIT_INTERVAL_S) this.clock = 0;
    const seq = this.seq + 1;
    if (!this.net.send({ t: 'mine', seq, frame, ...target, tool: 'multitool', time })) return false;
    this.seq = seq;
    const now = this.net.now();
    this.pending.set(seq, { ctx, at: now });
    for (const [s, p] of this.pending) {
      if (now - p.at <= PENDING_MS) break;
      this.pending.delete(s);
    }
    return true;
  }

  /** The beam left its target (or went off): the next hit waits a full interval. */
  idle() {
    this.clock = 0;
  }
}
