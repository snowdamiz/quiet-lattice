// What the server holds of resource nodes (DESIGN 16.6 "Resources", ARCHITECTURE §17): nothing for a node nobody has
// touched (the shared scatter says where it is and what it is), and for a touched one its damage, who did it, and when it
// heals or grows back. A node is the scatter's again when it heals (HEAL_S after its last hit, unbroken) or grows back
// (RESPAWN_S after it broke). Nodes are kept by world and cell, so a cell's state is one small set that every player near
// it is sent (service.ts).
//
// Bounds: at most `maxStates` touched nodes over every world. Past that, the node due soonest (to heal or grow back) does
// so early to make room, so the cost of a crowd is nodes returning early, never memory. Each node has at most one entry
// in the time queue (a binary heap), re-queued when it pops before its time.
import type { NodeCell, NodeKind, NodeType, PlanetParams } from '@astra/shared/world';
import { nodeCellCenter } from '@astra/shared/world';

/** How long a broken node takes to grow back, s, by kind (DESIGN 16.6: "minute-scale"): a plant three minutes, a mineral
 * deposit five, a hostile world's formation eight (the rarer and dearer the find, the longer). */
export const RESPAWN_S: Readonly<Record<NodeKind, number>> = { plant: 180, deposit: 300, formation: 480 };
/** A damaged node nobody hits for this long heals, s. */
export const HEAL_S = 60;
/** Touched nodes kept over every world (a few hundred bytes each). */
export const MAX_NODE_STATES = 100_000;
/** Characters whose damage to one node is counted for its yield; later ones still damage it but take no share. */
export const MAX_CONTRIBUTORS = 8;
/** Steps the damage shown to other players is rounded up to (a tenth of a node), so a beam's every hit is not news. */
export const SHOWN_STEPS = 10;

type Vec3 = [number, number, number];

/** A touched node. */
export interface NodeState {
  /** its id on its world (nodeKey) */
  readonly id: string;
  /** its id in its cell: `<type>_<k>` */
  readonly sub: string;
  readonly cell: CellState;
  readonly type: NodeType;
  /** hp left; 0 once broken */
  hp: number;
  /** broken: the world time it grows back; null while it stands */
  respawnAt: number | null;
  /** standing and damaged: the world time it heals unless hit again */
  healAt: number;
  /** damage done to it by each character (at most MAX_CONTRIBUTORS) */
  readonly by: Map<string, number>;
  /** the fraction of it shown to other players (SHOWN_STEPS), 0 when broken */
  shown: number;
  /** when its entry in the time queue is due (NaN: none) */
  queued: number;
}

/** A cell with touched nodes. */
export interface CellState {
  readonly world: WorldNodes;
  /** its number on its world (cellKey) */
  readonly key: number;
  /** `<face>_<i>_<j>` */
  readonly id: string;
  readonly cell: NodeCell;
  /** its centre, a planet-local unit direction */
  readonly center: Readonly<Vec3>;
  /** changes whenever what its players are shown changes; unique over the store, so a cell that goes and comes back is
   * never mistaken for the one sent before */
  version: number;
  readonly nodes: Map<string, NodeState>;
}

/** Touched cells are also kept in buckets of 2^BUCKET_SHIFT cells a side (about 512 m), so the cells round a player are
 * found by looking in a handful of buckets rather than through every touched cell of its world. */
export const BUCKET_SHIFT = 3;

/** One world's touched nodes. */
export class WorldNodes {
  readonly cells = new Map<number, CellState>();
  /** touched cells by bucket (bucketKey) */
  readonly buckets = new Map<number, Set<CellState>>();
  /** the grid level of its buckets */
  readonly bucketLevel: number;
  constructor(
    /** its frame id */
    readonly frame: string,
    readonly params: PlanetParams,
    /** its cell grid's level */
    readonly level: number,
  ) {
    this.bucketLevel = Math.max(0, level - BUCKET_SHIFT);
  }

  /** The bucket a cell of this world is kept in. */
  bucketOf(cell: Pick<NodeCell, 'face' | 'i' | 'j'>): number {
    const shift = this.level - this.bucketLevel;
    return cellKey({ face: cell.face, i: cell.i >> shift, j: cell.j >> shift, level: this.bucketLevel });
  }
}

/** A cell's number on a world of grid level `level` (exact in a double: under 6 × 2^34). */
export function cellKey(cell: Pick<NodeCell, 'face' | 'i' | 'j' | 'level'>): number {
  const n = 2 ** cell.level;
  return (cell.face * n + cell.i) * n + cell.j;
}

interface Due {
  at: number;
  node: NodeState;
}

/** A binary min-heap on `at`. */
class DueHeap {
  private readonly a: Due[] = [];
  get size(): number {
    return this.a.length;
  }
  peek(): Due | undefined {
    return this.a[0];
  }
  push(d: Due): void {
    const a = this.a;
    a.push(d);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.at <= d.at) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = d;
  }
  pop(): Due | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (!a.length || !last) return top;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= a.length) break;
      const r = l + 1;
      const c = r < a.length && a[r]!.at < a[l]!.at ? r : l;
      if (a[c]!.at >= last.at) break;
      a[i] = a[c]!;
      i = c;
    }
    a[i] = last;
    return top;
  }
}

/** Every touched node, by world and cell, and when each heals or grows back. */
export class NodeStore {
  private readonly worlds = new Map<string, WorldNodes>();
  private readonly heap = new DueHeap();
  private states = 0;
  private nextVersion = 1;

  constructor(readonly maxStates = MAX_NODE_STATES) {}

  /** Touched nodes held, over every world. */
  get size(): number {
    return this.states;
  }

  /** Entries in the time queue (one per node, and a few stale ones a hit left behind). */
  get queued(): number {
    return this.heap.size;
  }

  /** Changes whenever any cell's version does (the next version to be given out). */
  get version(): number {
    return this.nextVersion;
  }

  /** The world's touched nodes, if it has any. */
  world(frame: string): WorldNodes | undefined {
    return this.worlds.get(frame);
  }

  /** A touched node, if it is held. */
  get(frame: string, cell: Pick<NodeCell, 'face' | 'i' | 'j' | 'level'>, sub: string): NodeState | undefined {
    return this.worlds.get(frame)?.cells.get(cellKey(cell))?.nodes.get(sub);
  }

  /**
   * The node, held from now on (made whole when it was not held): what a hit damages. A new one may make room by bringing
   * back the node due soonest (its cell goes into `changed`).
   */
  touch(frame: string, params: PlanetParams, cell: NodeCell, type: NodeType, k: number, now: number, changed: Set<CellState>): NodeState {
    const sub = `${type.id}_${k}`;
    const key = cellKey(cell);
    const held = this.worlds.get(frame)?.cells.get(key)?.nodes.get(sub);
    if (held) return held;
    while (this.states >= this.maxStates && this.evictOne(changed));
    let world = this.worlds.get(frame);
    if (!world) this.worlds.set(frame, (world = new WorldNodes(frame, params, cell.level)));
    let c = world.cells.get(key);
    if (!c) {
      const center = nodeCellCenter(cell, [0, 0, 0] as Vec3);
      c = { world, key, id: `${cell.face}_${cell.i}_${cell.j}`, cell, center, version: this.nextVersion++, nodes: new Map() };
      world.cells.set(key, c);
      const b = world.bucketOf(cell);
      let bucket = world.buckets.get(b);
      if (!bucket) world.buckets.set(b, (bucket = new Set()));
      bucket.add(c);
    }
    const n: NodeState = {
      id: `${c.id}_${sub}`,
      sub,
      cell: c,
      type,
      hp: type.hp,
      respawnAt: null,
      healAt: now + HEAL_S,
      by: new Map(),
      shown: 1,
      queued: NaN,
    };
    c.nodes.set(sub, n);
    this.states++;
    this.schedule(n);
    return n;
  }

  /** Damage by a character to a standing node at world time `now`; true when it broke (hp 0, not yet marked broken). */
  damage(n: NodeState, character: string, amount: number, now: number, changed: Set<CellState>): boolean {
    if (n.respawnAt !== null || !(amount > 0)) return false;
    const done = Math.min(amount, n.hp);
    n.hp -= done;
    if (n.hp <= n.type.hp * 1e-9) n.hp = 0;
    if (n.by.has(character) || n.by.size < MAX_CONTRIBUTORS) n.by.set(character, (n.by.get(character) ?? 0) + done);
    n.healAt = now + HEAL_S;
    this.schedule(n);
    const shown = n.hp > 0 ? Math.ceil((n.hp / n.type.hp) * SHOWN_STEPS) / SHOWN_STEPS : 0;
    if (shown !== n.shown) {
      n.shown = shown;
      this.bump(n.cell, changed);
    }
    return n.hp === 0;
  }

  /** Marks a broken node to grow back at world time `at`. */
  broke(n: NodeState, at: number, changed: Set<CellState>): void {
    n.hp = 0;
    n.shown = 0;
    n.respawnAt = at;
    n.by.clear();
    this.schedule(n);
    this.bump(n.cell, changed);
  }

  /** Heals and grows back every node due by world time `now`; their cells go into `changed`. */
  advance(now: number, changed: Set<CellState>): void {
    for (let top = this.heap.peek(); top && top.at <= now; top = this.heap.peek()) {
      this.heap.pop();
      const n = top.node;
      if (!this.live(n) || n.queued !== top.at) continue;
      const due = this.dueOf(n);
      if (due > now) {
        n.queued = due;
        this.heap.push({ at: due, node: n });
        continue;
      }
      this.release(n, changed);
    }
  }

  /** Lets every node go (they are the scatter's again), as if each were due. */
  clear(changed: Set<CellState>): void {
    while (this.evictOne(changed));
  }

  /** The cells of a world that have touched nodes. */
  cellsOf(frame: string): ReadonlyMap<number, CellState> | undefined {
    return this.worlds.get(frame)?.cells;
  }

  private live(n: NodeState): boolean {
    return n.cell.nodes.get(n.sub) === n && n.cell.world.cells.get(n.cell.key) === n.cell;
  }

  private dueOf(n: NodeState): number {
    return n.respawnAt ?? n.healAt;
  }

  /** Puts the node in the time queue unless an entry already comes due no later than it does. */
  private schedule(n: NodeState): void {
    const due = this.dueOf(n);
    if (n.queued <= due) return;
    n.queued = due;
    this.heap.push({ at: due, node: n });
  }

  /** Brings back the node due soonest, early; false when none is held. */
  private evictOne(changed: Set<CellState>): boolean {
    for (let top = this.heap.pop(); top; top = this.heap.pop()) {
      if (!this.live(top.node) || top.node.queued !== top.at) continue;
      this.release(top.node, changed);
      return true;
    }
    return false;
  }

  /** The node is the scatter's again: forgotten, and its cell (and world) with it once empty. */
  private release(n: NodeState, changed: Set<CellState>): void {
    const c = n.cell;
    c.nodes.delete(n.sub);
    n.queued = NaN;
    this.states--;
    this.bump(c, changed);
    if (c.nodes.size) return;
    const w = c.world;
    w.cells.delete(c.key);
    const b = w.bucketOf(c.cell);
    const bucket = w.buckets.get(b);
    bucket?.delete(c);
    if (bucket?.size === 0) w.buckets.delete(b);
    if (!w.cells.size) this.worlds.delete(w.frame);
  }

  private bump(c: CellState, changed: Set<CellState>): void {
    c.version = this.nextVersion++;
    changed.add(c);
  }
}
