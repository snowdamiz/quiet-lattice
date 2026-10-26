// The ground herds walk on: a world's terrain from the shared sampler, levelled under its cities and sites exactly as the
// client levels it (planSurface at Tier 0: the client plans no dens until the den art lands, P1.E14.T10), so a creature
// stands where every client draws the ground.
//
// A terrain sample costs a few microseconds, more near cities, and a running herd would take one per animal per tick,
// so heights are cached per cell: each cell keeps the heights it has sampled on a fine lattice (LATTICE_M apart), filled
// as creatures walk over it, and a height is read off the lattice by bilinear interpolation (within centimetres of the
// true ground on open land, a little more at a cliff's edge). A coarse lattice built up front would be cheaper still but
// was found tens of metres off at cliffs and canyon walls. A cell's cache goes when the cell unloads (drop). A world's
// ground (its plan and its caches) is kept per world seed and radius, for the few worlds most recently walked on.
import { planSurface, TerrainSampler, type PlanetParams } from '@astra/shared/world';
import { CellGrid, facePoint, type FacePoint, type Vec3 } from './cells.ts';

/** Spacing of a cell's height cache, m (about). */
export const LATTICE_M = 1;
/** A cell's cache is cleared when it holds this many heights (a herd's ground is a few thousand). */
const CACHE_MAX = 32_768;

export class Ground {
  readonly radius: number;
  readonly ocean: boolean;
  readonly cells: CellGrid;
  /** lattice points per cell side, less one */
  readonly lattice: number;
  /** terrain samples taken, for metrics and tests */
  samples = 0;
  private readonly sampler: TerrainSampler;
  private readonly caches = new Map<number, Map<number, number>>();
  private readonly fp: FacePoint = { face: 0, a: 0, b: 0 };

  constructor(params: PlanetParams) {
    this.radius = params.radius;
    this.ocean = params.hasOcean;
    this.cells = new CellGrid(params.radius);
    this.lattice = Math.max(1, Math.round((this.cells.step * params.radius) / LATTICE_M));
    this.sampler = new TerrainSampler(params);
    // (planSurface plans on the natural ground; the pads it returns level it as the client's Planet does)
    this.sampler.setPads(planSurface(params, this.sampler, { tier: 0 }).pads);
  }

  /** The true height above sea level (m) at a direction (any length but zero): one terrain sample. */
  sample(dir: Readonly<Vec3>): number {
    this.samples++;
    const l = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    return this.sampler.height(dir[0] / l, dir[1] / l, dir[2] / l);
  }

  /** Forgets a cell's cached heights (the cell unloaded). */
  drop(key: number): void {
    this.caches.delete(key);
  }

  /** Heights cached, over every cell. */
  get cached(): number {
    let n = 0;
    for (const c of this.caches.values()) n += c.size;
    return n;
  }

  /** Height above sea level (m) at a direction (any length but zero), off its cell's height cache. */
  height(dir: Readonly<Vec3>): number {
    const c = this.cells;
    const p = facePoint(dir[0], dir[1], dir[2], this.fp);
    const i = c.index(p.a);
    const j = c.index(p.b);
    const key = c.key(p.face, i, j);
    let cache = this.caches.get(key);
    if (!cache || cache.size >= CACHE_MAX) this.caches.set(key, (cache = new Map()));
    const M = this.lattice;
    const s = Math.min(1, Math.max(0, (p.a - c.start(i)) / c.step)) * M;
    const t = Math.min(1, Math.max(0, (p.b - c.start(j)) / c.step)) * M;
    const s0 = Math.min(M - 1, Math.floor(s));
    const t0 = Math.min(M - 1, Math.floor(t));
    const fs = s - s0;
    const ft = t - t0;
    const h = (ps: number, pt: number) => {
      const k = ps * (M + 1) + pt;
      let v = cache!.get(k);
      if (v === undefined) cache!.set(k, (v = this.sample(c.dirIn(key, ps / M, pt / M))));
      return v;
    };
    return (h(s0, t0) * (1 - ft) + h(s0, t0 + 1) * ft) * (1 - fs) + (h(s0 + 1, t0) * (1 - ft) + h(s0 + 1, t0 + 1) * ft) * fs;
  }

  /** Distance from the world's centre to the ground (or the sea floor) at a direction. */
  surfaceRadius(dir: Readonly<Vec3>): number {
    return this.radius + this.height(dir);
  }
}

const grounds = new Map<string, Ground>();
/** Worlds whose ground is kept (planning one costs 5–100 ms). */
const KEEP = 8;

/** A world's ground, planned on first use and kept for the KEEP worlds most recently asked for. */
export function groundOf(params: PlanetParams): Ground {
  const id = `${params.seed}:${params.radius}`;
  let g = grounds.get(id);
  if (g) grounds.delete(id);
  else g = new Ground(params);
  grounds.set(id, g);
  for (const k of grounds.keys()) {
    if (grounds.size <= KEEP) break;
    grounds.delete(k);
  }
  return g;
}
