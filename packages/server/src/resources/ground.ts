// The ground resource nodes are scattered over (ARCHITECTURE §12, §16): a world's drawn ground, `drawnGround(params, tier)`
// planned exactly as every client plans it, as the shared spec's NodeGround (the sampler with its pads levelled, and the
// sites' clearance). The server scatters a cell's nodes over it only when a player mines there or stands near a touched
// cell, so it never streams or stores the nodes themselves.
//
// Planning a world's surface costs 5–100 ms, far more than a tick, and it must not run on the zones' loop, so it runs in a
// worker thread (planner.worker.ts), as fauna's ground does (fauna/terrain.ts): a world is asked for as a player enters its
// frame, and a mining hit on a world not yet planned is refused `busy` until it is ready. Fauna's planner hands back only
// the pads, which level the ground but do not say where the sites' clearance lies, so the nodes plan the world in a
// worker of their own (once per world, off the main thread; DECISIONS P1.E13.T01). The same robustness rules hold: a
// worker that dies is restarted once and then planning moves to the main thread (one warning); a plan that hangs is sent
// again once and then given up; a world whose plan fails waits out a doubling backoff. The KEEP worlds most recently
// asked for keep their ground.
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DENS_DRAWN, drawnGround, TerrainSampler, type NodeGround, type PlanetParams } from '@astra/shared/world';

/** What the worker sends back: the pads that level the ground and the sites' clearance. */
export interface PlannedGround {
  pads: number[];
  nodeClear: number[];
}

/** Plans a world's drawn ground at `tier` (on a copy of its params, as drawnGround asks): 5–100 ms. */
export function planNodeGround(params: PlanetParams, tier: number): PlannedGround {
  const g = drawnGround({ ...params, pads: null }, tier);
  return { pads: g.pads, nodeClear: g.nodeClear };
}

/** The node ground over a plan: a sampler on the world's params with its pads levelled. */
export function nodeGroundFrom(params: PlanetParams, plan: PlannedGround): NodeGround {
  return { sampler: new TerrainSampler({ ...params, pads: plan.pads }), nodeClear: plan.nodeClear };
}

/** Where worlds' node grounds come from. */
export interface NodeGroundSource {
  /** The world's ground for a system of `tier` if it is ready; otherwise it starts planning it (once) and returns null. */
  ground(params: PlanetParams, tier: number): NodeGround | null;
}

/** Worlds whose ground is kept. */
export const KEEP = 16;
/** A plan taking longer than this is taken to have hung, ms. */
export const PLAN_TIMEOUT_MS = 10_000;
/** A world whose plan failed waits this long before it is tried again, doubling up to RETRY_MAX_MS, ms. */
export const RETRY_MS = 30_000;
export const RETRY_MAX_MS = 30 * 60_000;

/** A world's ground is the same at every tier until dens are drawn (they join it by tier). */
const idOf = (params: PlanetParams, tier: number) => `${params.seed}:${params.radius}${DENS_DRAWN ? `:${tier}` : ''}`;

/** The KEEP grounds most recently used, by world. */
class Kept {
  private readonly map = new Map<string, NodeGround>();
  get(id: string): NodeGround | undefined {
    const g = this.map.get(id);
    if (g) {
      this.map.delete(id);
      this.map.set(id, g);
    }
    return g;
  }
  set(id: string, g: NodeGround): NodeGround {
    this.map.delete(id);
    this.map.set(id, g);
    for (const k of this.map.keys()) {
      if (this.map.size <= KEEP) break;
      this.map.delete(k);
    }
    return g;
  }
  get size(): number {
    return this.map.size;
  }
}

/** Plans on the calling thread: always ready (tests and tools). */
export function nodeGroundsHere(): NodeGroundSource {
  const kept = new Kept();
  return {
    ground(params, tier) {
      const id = idOf(params, tier);
      return kept.get(id) ?? kept.set(id, nodeGroundFrom(params, planNodeGround(params, tier)));
    },
  };
}

export interface NodePlannerOptions {
  log?: { warn(obj: object, msg: string): void };
  timeoutMs?: number;
  retryMs?: number;
  /** the worker's script: planner.worker.ts by default (tests stand in workers that misbehave) */
  script?: URL;
}

interface Pending {
  params: PlanetParams;
  tier: number;
  timer: NodeJS.Timeout;
  hangs: number;
}

/**
 * The worker's Node options: the server runs under tsx, whose loader a worker inherits; under vitest (which compiles on
 * its own) tsx's loader is named by its file URL. (As fauna's planner does.)
 */
function workerExecArgv(): string[] {
  if (process.execArgv.some((a) => /[\\/]tsx[\\/]dist[\\/]loader\.mjs$/.test(a))) return process.execArgv;
  try {
    return [...process.execArgv, '--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href];
  } catch {
    return process.execArgv;
  }
}

/** Plans worlds' node grounds in a worker thread, one at a time (see the header for when the worker or a plan fails). */
export class NodeGroundPlanner implements NodeGroundSource {
  private readonly kept = new Kept();
  private readonly pending = new Map<string, Pending>();
  private readonly failures = new Map<string, { until: number; backoff: number }>();
  private worker: Worker | null = null;
  private deaths = 0;
  private onMainThread = false;
  private readonly log: { warn(obj: object, msg: string): void };
  private readonly timeoutMs: number;
  private readonly retryMs: number;

  constructor(private readonly opts: NodePlannerOptions = {}) {
    this.log = opts.log ?? console;
    this.timeoutMs = opts.timeoutMs ?? PLAN_TIMEOUT_MS;
    this.retryMs = opts.retryMs ?? RETRY_MS;
  }

  ground(params: PlanetParams, tier: number): NodeGround | null {
    const id = idOf(params, tier);
    const g = this.kept.get(id);
    if (g) return g;
    if (this.pending.has(id) || performance.now() < (this.failures.get(id)?.until ?? -Infinity)) return null;
    if (this.onMainThread) {
      try {
        return this.kept.set(id, nodeGroundFrom(params, planNodeGround(params, tier)));
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

  /** Worlds whose ground is kept. */
  get keeping(): number {
    return this.kept.size;
  }

  get mainThread(): boolean {
    return this.onMainThread;
  }

  /** Stops the worker and forgets the plans in hand. */
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

  private failed(id: string, error: string): void {
    const backoff = Math.min(RETRY_MAX_MS, (this.failures.get(id)?.backoff ?? this.retryMs / 2) * 2);
    this.failures.set(id, { until: performance.now() + backoff, backoff });
    this.log.warn({ world: id, err: error, retryInS: Math.round(backoff / 100) / 10 }, 'node ground planning failed; mining waits until it is tried again');
  }

  private hung(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    p.hangs++;
    this.log.warn({ world: id, timeoutMs: this.timeoutMs, hangs: p.hangs }, 'node ground plan timed out; restarting its worker');
    if (p.hangs > 1) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      this.failed(id, 'timed out twice');
    }
    const w = this.worker;
    this.worker = null;
    void w?.terminate();
    this.resend();
  }

  private died(w: Worker, why: string): void {
    if (this.worker !== w) return;
    this.worker = null;
    this.deaths++;
    if (this.deaths <= 1) {
      this.log.warn({ err: why }, 'node ground planner worker died; restarting it');
      this.resend();
      return;
    }
    this.log.warn({ err: why }, 'node ground planner worker died again; planning on the main thread from now on');
    this.onMainThread = true;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  private resend(): void {
    for (const [id, p] of [...this.pending.entries()]) {
      clearTimeout(p.timer);
      this.send(id, p);
    }
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.opts.script ?? new URL('./planner.worker.ts', import.meta.url), { execArgv: workerExecArgv() });
    w.unref();
    w.on('message', (reply: { id: string; plan?: PlannedGround; error?: string }) => {
      const p = this.pending.get(reply.id);
      if (!p || this.worker !== w) return;
      clearTimeout(p.timer);
      this.pending.delete(reply.id);
      if (reply.plan) {
        this.failures.delete(reply.id);
        this.kept.set(reply.id, nodeGroundFrom(p.params, reply.plan));
      } else this.failed(reply.id, reply.error ?? 'no plan');
    });
    w.on('error', (err) => this.died(w, String(err)));
    w.on('exit', (code) => this.died(w, `exited with code ${code}`));
    this.worker = w;
    return w;
  }
}
