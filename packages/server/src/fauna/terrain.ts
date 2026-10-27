// The ground herds walk on: a world's terrain from the shared sampler, levelled under its cities and sites exactly as the
// client levels it (shared drawnGround, ARCHITECTURE §12: the one plan the client's Planet, its flora and the server's
// resource nodes use), so a creature stands where every client draws the ground.
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
//
// The planner must never stop fauna server-wide: a worker that dies (an error, or an exit with none) is restarted once
// and given its plans again, and after a second death the planner plans on the main thread (warning once); a plan that
// hangs past PLAN_TIMEOUT_MS restarts the worker and is sent again, and is given up if it hangs twice; a world whose plan
// fails (throws, or hangs twice) is not tried again for a backoff that starts at RETRY_MS and doubles, warning once each
// time.
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DENS_DRAWN, drawnGround, TerrainSampler, type PlanetParams } from '@astra/shared/world';
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

/** The ground levelled under a world's cities and sites (and its dens, once they are drawn), as every client levels it:
 * shared drawnGround's pads at the system's tier, planned on a copy of the world's params. 5–100 ms. */
export function planPads(params: PlanetParams, tier = 0): number[] {
  return drawnGround({ ...params, pads: null }, tier).pads;
}

/** Where worlds' grounds come from. */
export interface GroundSource {
  /** The world's ground for a system of `tier` if it is ready; otherwise it starts planning it (once) and returns null. */
  ground(params: PlanetParams, tier?: number): Ground | null;
}

/** Worlds whose ground is kept. */
export const KEEP = 16;
const grounds = new Map<string, Ground>();
/** A world's ground is the same at every tier until dens are drawn (they join it by tier). */
const idOf = (params: PlanetParams, tier: number) => `${params.seed}:${params.radius}${DENS_DRAWN ? `:${tier}` : ''}`;

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
export function groundOf(params: PlanetParams, tier = 0): Ground {
  const id = idOf(params, tier);
  return kept(id) ?? keep(id, new Ground(params, planPads(params, tier)));
}

/** Plans on the calling thread: always ready. */
export const planHere: GroundSource = { ground: groundOf };

/** A plan taking longer than this is taken to have hung: the worker is restarted and the plan sent again, ms. */
export const PLAN_TIMEOUT_MS = 10_000;
/** A world whose plan failed is not tried again for this long, doubling with each failure up to RETRY_MAX_MS, ms. */
export const RETRY_MS = 30_000;
export const RETRY_MAX_MS = 30 * 60_000;
/** Times the worker is restarted after dying before the planner plans on the main thread instead. */
export const WORKER_RESTARTS = 1;

export interface PlannerOptions {
  log?: { warn(obj: object, msg: string): void };
  /** PLAN_TIMEOUT_MS and RETRY_MS, for tests */
  timeoutMs?: number;
  retryMs?: number;
  /** the worker's script and its workerData: planner.worker.ts by default; tests stand in workers that misbehave */
  script?: URL;
  workerData?: unknown;
}

interface Pending {
  params: PlanetParams;
  tier: number;
  timer: NodeJS.Timeout;
  /** times it has hung so far */
  hangs: number;
}

interface PlanReply {
  id: string;
  pads?: number[];
  error?: string;
}

/**
 * The planner worker's Node options. The server runs its TypeScript under tsx, so the worker needs tsx's loader too: it
 * inherits it when the process was started by tsx; otherwise (vitest, which compiles on its own) the loader is named by
 * its file URL, since a bare `--import tsx` there leaves Node's own type stripping in charge, which cannot read
 * TypeScript's parameter properties.
 */
function workerExecArgv(): string[] {
  // (tsx's own loader file, not any path with "tsx" in it: vitest's packages are installed under a tsx@ directory)
  if (process.execArgv.some((a) => /[\\/]tsx[\\/]dist[\\/]loader\.mjs$/.test(a))) return process.execArgv;
  try {
    return [...process.execArgv, '--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href];
  } catch {
    return process.execArgv;
  }
}

/** Plans in a worker thread, one world at a time; a world asked for again while it is planned waits for the same plan
 * (see the header for what it does when the worker or a plan fails). */
export class GroundPlanner implements GroundSource {
  /** worlds being planned, by id */
  private readonly pending = new Map<string, Pending>();
  /** worlds whose plan failed: when they may be tried again, and the backoff that set it */
  private readonly failures = new Map<string, { until: number; backoff: number }>();
  private worker: Worker | null = null;
  private deaths = 0;
  /** the worker could not be kept running: plan on the calling thread */
  private onMainThread = false;
  private readonly log: { warn(obj: object, msg: string): void };
  private readonly timeoutMs: number;
  private readonly retryMs: number;

  constructor(private readonly opts: PlannerOptions = {}) {
    this.log = opts.log ?? console;
    this.timeoutMs = opts.timeoutMs ?? PLAN_TIMEOUT_MS;
    this.retryMs = opts.retryMs ?? RETRY_MS;
  }

  ground(params: PlanetParams, tier = 0): Ground | null {
    const id = idOf(params, tier);
    const g = kept(id);
    if (g) return g;
    if (this.pending.has(id) || performance.now() < (this.failures.get(id)?.until ?? -Infinity)) return null;
    if (this.onMainThread) {
      try {
        return keep(id, new Ground(params, planPads(params, tier)));
      } catch (err) {
        this.failed(id, String(err));
        return null;
      }
    }
    this.send(id, { params, tier, hangs: 0 });
    return null;
  }

  /** Worlds being planned now. */
  get planning(): number {
    return this.pending.size;
  }

  /** Whether it has given up on its worker and plans on the calling thread. */
  get mainThread(): boolean {
    return this.onMainThread;
  }

  /** Stops the worker (it never keeps the process alive) and forgets the plans in hand. */
  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    await w?.terminate();
  }

  private send(id: string, p: Omit<Pending, 'timer'>): void {
    const timer = setTimeout(() => this.hung(id), this.timeoutMs);
    timer.unref();
    this.pending.set(id, { ...p, timer });
    this.start().postMessage({ id, params: p.params, tier: p.tier });
  }

  /** A plan failed (it threw, or hung twice): the world waits out a backoff before it is tried again. */
  private failed(id: string, error: string): void {
    const backoff = Math.min(RETRY_MAX_MS, (this.failures.get(id)?.backoff ?? this.retryMs / 2) * 2);
    this.failures.set(id, { until: performance.now() + backoff, backoff });
    this.log.warn(
      { world: id, err: error, retryInS: Math.round(backoff / 100) / 10 },
      'ground planning failed; the world keeps no herds until it is tried again',
    );
  }

  /** A plan has taken too long: the worker is stuck on it. Restart it; the plan goes again, or is given up if it hung
   * before. */
  private hung(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    p.hangs++;
    this.log.warn({ world: id, timeoutMs: this.timeoutMs, hangs: p.hangs }, 'ground plan timed out; restarting the planner worker');
    if (p.hangs > 1) {
      this.pending.delete(id);
      this.failed(id, 'timed out twice');
    }
    this.restart();
  }

  /** The worker died (an error, or an exit without one): restart it once, then plan on the main thread. */
  private died(w: Worker, why: string): void {
    if (this.worker !== w) return;
    this.worker = null;
    this.deaths++;
    if (this.deaths <= WORKER_RESTARTS) {
      this.log.warn({ err: why, restarts: this.deaths }, 'ground planner worker died; restarting it');
      this.resend();
      return;
    }
    this.log.warn({ err: why }, 'ground planner worker died again; planning on the main thread from now on');
    this.onMainThread = true;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    // (each world asks again on its next tick, and is planned then)
    this.pending.clear();
  }

  /** Stops the worker it has (if any) and sends every plan in hand to a new one. */
  private restart(): void {
    const w = this.worker;
    this.worker = null;
    void w?.terminate();
    this.resend();
  }

  private resend(): void {
    const plans = [...this.pending.entries()];
    for (const [id, p] of plans) {
      clearTimeout(p.timer);
      this.send(id, p);
    }
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.opts.script ?? new URL('./planner.worker.ts', import.meta.url), { execArgv: workerExecArgv(), workerData: this.opts.workerData });
    w.unref();
    w.on('message', (reply: PlanReply) => {
      const p = this.pending.get(reply.id);
      if (!p || this.worker !== w) return;
      clearTimeout(p.timer);
      this.pending.delete(reply.id);
      if (reply.pads) {
        this.failures.delete(reply.id);
        keep(reply.id, new Ground(p.params, reply.pads));
      } else this.failed(reply.id, reply.error ?? 'no pads');
    });
    w.on('error', (err) => this.died(w, String(err)));
    w.on('exit', (code) => this.died(w, `exited with code ${code}`));
    this.worker = w;
    return w;
  }
}

/** The server's planner, shared by every zone. */
export const groundPlanner = new GroundPlanner();
