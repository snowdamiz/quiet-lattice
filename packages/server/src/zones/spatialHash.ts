// A spatial hash over world positions (docs/ARCHITECTURE.md §6): ids bucketed by the cubic cell they fall in, so a radius
// query visits the few cells the sphere touches instead of every entity. Cells are keyed by a 32-bit hash of their integer
// coordinates; two cells that collide only share a bucket, and every query ends with an exact distance check, so a
// collision costs a few extra candidates and never a wrong answer. Queries are cheapest when the radius is about the
// cell size (27 cells); a zone keeps one hash per interest class, each with that class's radius as its cell size.

interface Item {
  key: number;
  x: number;
  y: number;
  z: number;
}

/** The bucket key of cell (ix, iy, iz). Coordinates beyond 32 bits wrap, which only merges far-apart buckets. */
function cellKey(ix: number, iy: number, iz: number): number {
  return Math.imul(ix | 0, 73856093) ^ Math.imul(iy | 0, 19349663) ^ Math.imul(iz | 0, 83492791);
}

export class SpatialHash {
  private readonly cells = new Map<number, Set<number>>();
  private readonly items = new Map<number, Item>();
  private readonly inv: number;

  constructor(readonly cellSize: number) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new RangeError(`bad cell size ${cellSize}`);
    this.inv = 1 / cellSize;
  }

  get size(): number {
    return this.items.size;
  }

  has(id: number): boolean {
    return this.items.has(id);
  }

  /** The position an id was last inserted or moved to. */
  position(id: number): [number, number, number] | undefined {
    const it = this.items.get(id);
    return it && [it.x, it.y, it.z];
  }

  /** Puts `id` at (x, y, z), moving it if it is already in the hash. */
  insert(id: number, x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new RangeError(`non-finite position for ${id}`);
    const key = this.keyOf(x, y, z);
    const it = this.items.get(id);
    if (it) {
      it.x = x;
      it.y = y;
      it.z = z;
      if (it.key === key) return;
      this.unbucket(id, it.key);
      it.key = key;
    } else {
      this.items.set(id, { key, x, y, z });
    }
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = new Set()));
    cell.add(id);
  }

  /** Same as insert: a move of an id the hash does not hold adds it. */
  move(id: number, x: number, y: number, z: number): void {
    this.insert(id, x, y, z);
  }

  /** Takes `id` out; false when it was not there. */
  remove(id: number): boolean {
    const it = this.items.get(id);
    if (!it) return false;
    this.unbucket(id, it.key);
    this.items.delete(id);
    return true;
  }

  /**
   * Calls `fn(id, distanceSquared)` once for every id within `radius` of (x, y, z), the boundary included. Visits only the
   * cells the sphere's bounding box touches, unless there are more of those than ids, when it checks every id instead.
   */
  forEachWithin(x: number, y: number, z: number, radius: number, fn: (id: number, d2: number) => void): void {
    if (!(radius >= 0)) return;
    const r2 = radius * radius;
    const inv = this.inv;
    const x0 = Math.floor((x - radius) * inv);
    const x1 = Math.floor((x + radius) * inv);
    const y0 = Math.floor((y - radius) * inv);
    const y1 = Math.floor((y + radius) * inv);
    const z0 = Math.floor((z - radius) * inv);
    const z1 = Math.floor((z + radius) * inv);
    const span = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (!(span <= this.items.size) || span > 4096) {
      for (const [id, it] of this.items) {
        const dx = it.x - x;
        const dy = it.y - y;
        const dz = it.z - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= r2) fn(id, d2);
      }
      return;
    }
    // Colliding cells share one bucket; visit each bucket once.
    const seen: number[] = [];
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = cellKey(ix, iy, iz);
          const cell = this.cells.get(key);
          if (!cell || seen.includes(key)) continue;
          seen.push(key);
          for (const id of cell) {
            const it = this.items.get(id)!;
            const dx = it.x - x;
            const dy = it.y - y;
            const dz = it.z - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= r2) fn(id, d2);
          }
        }
      }
    }
  }

  /** The ids within `radius` of (x, y, z), the boundary included, in no particular order. */
  query(x: number, y: number, z: number, radius: number): number[] {
    const out: number[] = [];
    this.forEachWithin(x, y, z, radius, (id) => out.push(id));
    return out;
  }

  private keyOf(x: number, y: number, z: number): number {
    return cellKey(Math.floor(x * this.inv), Math.floor(y * this.inv), Math.floor(z * this.inv));
  }

  private unbucket(id: number, key: number): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.delete(id);
    if (cell.size === 0) this.cells.delete(key);
  }
}
