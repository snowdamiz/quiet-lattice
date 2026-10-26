// The ground herds walk on: a world's terrain from the shared sampler, levelled under its cities and sites exactly as the
// client levels it (planSurface at Tier 0: the client plans no dens until the den art lands, P1.E14.T10), so a creature
// stands where every client draws the ground.
//
// A terrain sample costs a few microseconds, more near cities, and a running herd would take one per animal per tick,
// so heights are cached per cell: each cell keeps the heights it has sampled on a fine lattice (LATTICE_M apart), filled
// as creatures walk over it, and a height is read off the lattice by bilinear interpolation (within centimetres of the
// true ground on open land, a little more at a cliff's edge). A coarse lattice built up front would be cheaper still but
// was found tens of metres off at cliffs and canyon walls. A cell's cache goes when the cell unloads, and every cache not
// under a loaded cell goes whenever cells unload (retain).
//
// Planning a world's surface (its cities and sites, which level the ground) costs 5–100 ms, far more than a tick, and
// every zone ticks on one loop, so the server plans in a worker thread (GroundPlanner, planner.worker.ts): a world's
// ground is asked for when a player enters its frame and is ready a few hundred milliseconds later, long before a ship
// lands. A world's ground (its plan and its caches) is kept per world seed and radius, for the KEEP worlds most recently
// asked for; groundOf and planHere plan on the calling thread, for tests and tools.
import { Worker } from 'node:worker_threads';
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

  /** A world's ground, levelled by `pads` (planPads). */
  constructor(params: PlanetParams, pads: readonly number[]) {
    this.radius = params.radius;
    this.ocean = params.hasOcean;
    this.cells = new CellGrid(params.radius);
    this.lattice = Math.max(1, Math.round((this.cells.step * params.radius) / LATTICE_M));
    this.sampler = new TerrainSampler(params);
    this.sampler.setPads([...pads]);
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

  /** Forgets the cached heights of every cell but those `keep` has (creatures wander a little past their cells). */
  retain(keep: { has(key: number): boolean }): void {
    for (const key of this.caches.keys()) if (!keep.has(key)) this.caches.delete(key);
  }

  /** Heights cached, over every cell. */
  get cached(): number {
    let n = 0;
    for (const c of this.caches.values()) n += c.size;
    return n;
  }

  /** Cells with heights cached. */
  get cachedCells(): number {
    return this.caches.size;
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

/** The ground levelled under a world's cities and sites, as the client's Planet levels it: planSurface on the natural
 * ground at Tier 0 (the client plans no dens until P1.E14.T10). 5–100 ms. */
export function planPads(params: PlanetParams): number[] {
  return planSurface(params, new TerrainSampler(params), { tier: 0 }).pads;
}

/** Where worlds' grounds come from. */
export interface GroundSource {
  /** The world's ground if it is ready; otherwise it starts planning it (once) and returns null. */
  ground(params: PlanetParams): Ground | null;
}

/** Worlds whose ground is kept. */
export const KEEP = 16;
const grounds = new Map<string, Ground>();
const idOf = (params: PlanetParams) => `${params.seed}:${params.radius}`;

/** A kept ground, marked the most recently used. */
function kept(id: string): Ground | undefined {
  const g = grounds.get(id);
  if (g) {
    grounds.delete(id);
    grounds.set(id, g);
  }
  return g;
}

function keep(id: string, g: Ground): Ground {
  grounds.delete(id);
  grounds.set(id, g);
  for (const k of grounds.keys()) {
    if (grounds.size <= KEEP) break;
    grounds.delete(k);
  }
  return g;
}

/** A world's ground, planned on the calling thread if it is not kept: for tests, tools and the dev CLI. */
export function groundOf(params: PlanetParams): Ground {
  const id = idOf(params);
  return kept(id) ?? keep(id, new Ground(params, planPads(params)));
}

/** Plans on the calling thread: always ready. */
export const planHere: GroundSource = { ground: groundOf };

interface PlanReply {
  id: string;
  pads?: number[];
  error?: string;
}

/** Plans in a worker thread, one world at a time; a world asked for again while it is planned waits for the same plan.
 * Should the worker fail to run, it plans on the calling thread instead (and says so once). */
export class GroundPlanner implements GroundSource {
  /** worlds being planned, by id */
  private readonly pending = new Map<string, PlanetParams>();
  private worker: Worker | null = null;
  private failed = false;

  constructor(private readonly log?: { warn(obj: object, msg: string): void }) {}

  ground(params: PlanetParams): Ground | null {
    const id = idOf(params);
    const g = kept(id);
    if (g || this.pending.has(id)) return g ?? null;
    if (this.failed) return groundOf(params);
    this.pending.set(id, params);
    this.start().postMessage({ id, params });
    return null;
  }

  /** Worlds being planned now. */
  get planning(): number {
    return this.pending.size;
  }

  /** Stops the worker (it never keeps the process alive). */
  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this.pending.clear();
    await w?.terminate();
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    // the server runs its TypeScript under tsx; the worker gets tsx's loader too, unless it already inherits it
    const execArgv = process.execArgv.some((a) => a.includes('tsx')) ? process.execArgv : [...process.execArgv, '--import', 'tsx'];
    const w = new Worker(new URL('./planner.worker.ts', import.meta.url), { execArgv });
    w.unref();
    w.on('message', (reply: PlanReply) => {
      const params = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if (!params) return;
      if (reply.pads) keep(reply.id, new Ground(params, reply.pads));
      else (this.log ?? console).warn({ world: reply.id, err: reply.error }, 'ground planning failed; the world keeps no herds');
    });
    w.on('error', (err) => {
      (this.log ?? console).warn({ err: String(err) }, 'ground planner worker failed; planning on the main thread from now on');
      this.failed = true;
      this.worker = null;
      this.pending.clear();
    });
    this.worker = w;
    return w;
  }
}

/** The server's planner, shared by every zone. */
export const groundPlanner = new GroundPlanner();
