import { denPads, DENS_DRAWN, drawnGround, hasFauna, planSurface, Random, siteNodeClearance, TerrainSampler, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import type { PlannerWorkerMode } from '../../test/plannerWorkers.ts';
import type { Vec3 } from './cells.ts';
import { densOf, Ground, groundOf, GroundPlanner, LATTICE_M, planDenList, planGround, planPads, planWorld } from './terrain.ts';

const system = describeZoneSystem(0);
const home = system.bodies[system.home]!;
const params = home.params as PlanetParams;

describe('the ground herds walk on', () => {
  it('is the client’s ground: drawnGround, levelled under cities and sites as the client levels them', () => {
    const g = new Ground(params, planPads(params));
    // (the client's Planet plans its own copy of the params)
    const client = drawnGround({ ...params, pads: null }, 0).sampler;
    const rng = new Random(3);
    for (let i = 0; i < 200; i++) {
      const d: Vec3 = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
      const l = Math.hypot(...d);
      expect(g.sample(d)).toBeCloseTo(client.height(d[0] / l, d[1] / l, d[2] / l), 6);
    }
    expect(params.pads ?? null).toBeNull();
  });

  it('reads heights off a per-cell cache within centimetres of the true ground, sampling each lattice point once', () => {
    const g = new Ground(params, planPads(params));
    const rng = new Random(5);
    const key = g.cells.keyOf(0.2, 0.9, 0.3);
    const errors: number[] = [];
    let s = 0.5;
    let t = 0.5;
    for (let i = 0; i < 400; i++) {
      s += rng.float(-0.002, 0.002);
      t += rng.float(-0.002, 0.002);
      const d = g.cells.dirIn(key, s, t);
      errors.push(Math.abs(g.height(d) - g.sample(d)));
    }
    errors.sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length * 0.95)]!).toBeLessThan(0.2);
    // a walk of ~150 m over one cell samples a strip of the lattice, not every point it passes
    const before = g.samples;
    for (let i = 0; i < 400; i++) g.height(g.cells.dirIn(key, 0.5, 0.5));
    expect(g.samples).toBe(before);
    expect(g.cached).toBeLessThan((400 * 4 * (0.002 * g.cells.step * g.radius)) / LATTICE_M + 50);
    g.drop(key);
    expect(g.cached).toBe(0);
  });

  it('is kept per world', () => {
    expect(groundOf(params)).toBe(groundOf(params));
    expect(groundOf(params).radius).toBe(home.radius);
  });

  it('is planned in a worker thread, to the same ground as on this one', async () => {
    // a world no other test plans
    const other = describeZoneSystem(7).bodies.find((b) => b.type !== 'gas' && hasFauna(b.params as PlanetParams))!;
    const p = other.params as PlanetParams;
    const warnings: string[] = [];
    const planner = new GroundPlanner({ log: { warn: (_, msg) => warnings.push(msg) } });
    try {
      expect(planner.ground(p)).toBeNull();
      expect(planner.planning).toBe(1);
      // asked again while it is planned: the same plan
      expect(planner.ground(p)).toBeNull();
      expect(planner.planning).toBe(1);
      const deadline = Date.now() + 20_000;
      while (!planner.ground(p) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      const g = planner.ground(p)!;
      expect(g).not.toBeNull();
      expect(planner.planning).toBe(0);
      // planned by the worker itself, not by falling back to this thread
      expect(planner.mainThread).toBe(false);
      expect(warnings).toEqual([]);
      const here = new Ground(p, planPads(p));
      const rng = new Random(8);
      for (let i = 0; i < 50; i++) {
        const d: Vec3 = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
        expect(g.sample(d)).toBe(here.sample(d));
      }
      // it carries the sites' clearance, so the resource nodes can scatter over it (P1.E13.T01)
      expect(g.nodes).not.toBeNull();
      expect(g.nodes!.nodeClear).toEqual(planGround(p).nodeClear);
      expect(g.nodes!.nodeClear.length).toBeGreaterThan(0);
      // kept: the next ask is answered at once, by any planner
      expect(groundOf(p)).toBe(g);
    } finally {
      await planner.close();
    }
  });
});

describe('one plan', () => {
  it('the dens the server spawns at are the drawn ground’s, and its ground the drawn ground, on several worlds', () => {
    // small worlds with fauna from a few systems, quick to plan
    const worlds = [0, 1, 2, 5]
      .flatMap((s) => describeZoneSystem(s).bodies.filter((b) => b.type !== 'gas' && hasFauna(b.params as PlanetParams) && b.radius < 35_000))
      .slice(0, 5)
      .map((b) => b.params as PlanetParams);
    expect(worlds.length).toBe(5);
    for (const p of worlds) {
      for (const tier of [1, 3]) {
        const dens = planDenList(p, tier);
        const drawn = drawnGround({ ...p, pads: null }, tier);
        // the whole plan, as drawnGround makes it once dens are drawn
        const natural = { ...p, pads: null };
        const full = planSurface(natural, new TerrainSampler(natural), { tier });
        expect(dens).toEqual(full.dens);
        expect(dens.length).toBeGreaterThan(0);
        expect(planPads(p, tier)).toEqual(drawn.pads);
        expect(drawn.cities).toEqual(full.cities);
        expect(drawn.sites).toEqual(full.sites);
        // pads, the nodes' clearance and the dens: one plan (the planner's den reply carries all three)
        const world = planWorld(p, tier);
        const ground = planGround(p, tier);
        expect(world).toEqual({ pads: drawn.pads, nodeClear: drawn.nodeClear, dens });
        expect(ground).toEqual({ pads: drawn.pads, nodeClear: drawn.nodeClear });
        expect(drawn.nodeClear).toEqual(siteNodeClearance(full.sites));
        expect(groundOf(p, tier).nodes!.nodeClear).toEqual(siteNodeClearance(full.sites));
        if (DENS_DRAWN) {
          expect(drawn.dens).toEqual(dens);
          expect(drawn.pads).toEqual(full.pads);
        } else {
          expect(drawn.dens).toEqual([]);
          expect([...drawn.pads, ...denPads(dens)]).toEqual(full.pads);
        }
      }
    }
  });
});

describe('a world’s dens', () => {
  it('are planned in the worker at a tier, as on this thread, each naming who lives there, and kept per tier', async () => {
    // a small world no other test plans
    const small = describeZoneSystem(8)
      .bodies.filter((b) => b.type !== 'gas' && hasFauna(b.params as PlanetParams))
      .sort((a, b) => a.radius - b.radius)[0]!;
    const p = small.params as PlanetParams;
    const warnings: string[] = [];
    const planner = new GroundPlanner({ log: { warn: (_, msg) => warnings.push(msg) } });
    try {
      // none below Tier 1, with nothing to plan
      expect(planner.dens(p, 0)).toEqual([]);
      expect(planner.planning).toBe(0);
      expect(planner.dens(p, 3)).toBeNull();
      expect(planner.dens(p, 3)).toBeNull();
      expect(planner.planning).toBe(1);
      const deadline = Date.now() + 30_000;
      while (!planner.dens(p, 3) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      const dens = planner.dens(p, 3)!;
      expect(planner.mainThread).toBe(false);
      expect(warnings).toEqual([]);
      expect(dens).toEqual(planDenList(p, 3));
      expect(dens.length).toBeGreaterThan(0);
      expect(dens.every((d) => d.species >= 0)).toBe(true);
      // kept for any planner; another tier is a plan of its own
      expect(densOf(p, 3)).toBe(dens);
      // the reply carried the world's ground from the same plan, kept with the sites' clearance the nodes need
      const g = planner.ground(p, 3)!;
      expect(g).not.toBeNull();
      expect(planner.planning).toBe(0);
      expect(g.nodes!.nodeClear).toEqual(planGround(p, 3).nodeClear);
      const here = new Ground(p, planPads(p, 3));
      const rng = new Random(9);
      for (let i = 0; i < 30; i++) {
        const d: Vec3 = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
        expect(g.sample(d)).toBe(here.sample(d));
      }
      expect(planner.dens(p, 2)).toBeNull();
      // the world's params are left as they were
      expect(p.pads ?? null).toBeNull();
    } finally {
      await planner.close();
    }
  });
});

describe('the ground planner, when things go wrong', () => {
  /** Worlds no other test plans, one per test (a planned world is kept, and would be answered at once). */
  const fresh = [12, 13, 14, 15, 16, 17].flatMap((s) =>
    describeZoneSystem(s)
      .bodies.filter((b) => b.type !== 'gas' && hasFauna(b.params as PlanetParams))
      .map((b) => b.params as PlanetParams),
  );
  let next = 0;
  /** A planner whose workers misbehave as `mode` says (test/plannerWorkers.ts), and what it warned. */
  const planner = (mode: PlannerWorkerMode, opts: { timeoutMs?: number; retryMs?: number } = {}) => {
    const warnings: { msg: string; obj: Record<string, unknown>; at: number }[] = [];
    const starts = new Int32Array(new SharedArrayBuffer(4));
    const p = new GroundPlanner({
      log: { warn: (obj, msg) => warnings.push({ msg, obj: obj as Record<string, unknown>, at: performance.now() }) },
      script: new URL('../../test/plannerWorkers.ts', import.meta.url),
      workerData: { mode, starts },
      ...opts,
    });
    return { p, warnings, starts, world: fresh[next++]! };
  };
  const until = async (cond: () => boolean, ms = 20_000) => {
    const deadline = Date.now() + ms;
    while (!cond() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    return cond();
  };

  it('restarts a worker that exits without an error, and sends it the plan again', async () => {
    const { p, warnings, starts, world } = planner('exit-first');
    try {
      expect(p.ground(world)).toBeNull();
      expect(await until(() => p.ground(world) !== null)).toBe(true);
      expect(Atomics.load(starts, 0)).toBe(2);
      expect(p.mainThread).toBe(false);
      expect(warnings.map((w) => w.msg)).toEqual(['ground planner worker died; restarting it']);
    } finally {
      await p.close();
    }
  });

  it('plans on the main thread once its worker has died twice, saying so once', async () => {
    const { p, warnings, starts, world } = planner('exit');
    try {
      expect(p.ground(world)).toBeNull();
      expect(await until(() => p.mainThread)).toBe(true);
      expect(Atomics.load(starts, 0)).toBe(2);
      expect(p.planning).toBe(0);
      // the world asks again (each tick it waits) and is planned there and then
      const g = p.ground(world);
      expect(g).not.toBeNull();
      expect(p.ground(fresh[next++]!)).not.toBeNull();
      expect(warnings.map((w) => w.msg)).toEqual([
        'ground planner worker died; restarting it',
        'ground planner worker died again; planning on the main thread from now on',
      ]);
    } finally {
      await p.close();
    }
  });

  it('restarts a worker stuck on a plan past the timeout, and sends the plan again', async () => {
    // (the timeout covers the new worker's start too, which takes seconds when the whole suite runs at once)
    const { p, warnings, starts, world } = planner('hang-first', { timeoutMs: 6000 });
    try {
      expect(p.ground(world)).toBeNull();
      expect(await until(() => p.ground(world) !== null)).toBe(true);
      expect(Atomics.load(starts, 0)).toBe(2);
      expect(p.mainThread).toBe(false);
      expect(warnings.map((w) => w.msg)).toEqual(['ground plan timed out; restarting the planner worker']);
    } finally {
      await p.close();
    }
  });

  it('gives up a plan that hangs twice, waits out a backoff, and never moves to the main thread for it', async () => {
    const { p, warnings, world } = planner('hang', { timeoutMs: 1500, retryMs: 60_000 });
    try {
      expect(p.ground(world)).toBeNull();
      expect(await until(() => p.planning === 0)).toBe(true);
      expect(p.mainThread).toBe(false);
      expect(warnings.map((w) => w.msg)).toEqual([
        'ground plan timed out; restarting the planner worker',
        'ground plan timed out; restarting the planner worker',
        'ground planning failed; the world keeps no herds until it is tried again',
      ]);
      // asked again within the backoff: nothing is sent
      for (let i = 0; i < 10; i++) expect(p.ground(world)).toBeNull();
      expect(p.planning).toBe(0);
    } finally {
      await p.close();
    }
  });

  it('backs off a world whose plan throws, doubling the wait, and warns once each time', async () => {
    const { p, warnings, world } = planner('throw', { retryMs: 300 });
    try {
      // asked every 20 ms, as a waiting world asks every tick, until three plans have failed: the worker thread's own
      // time stretches under load, so this waits for the warnings rather than a fixed span, and checks each retry came
      // no sooner than the wait the warning before it announced (the backoff starts when that warning is logged)
      const deadline = Date.now() + 30_000;
      while (warnings.length < 3 && Date.now() < deadline) {
        expect(p.ground(world)).toBeNull();
        await new Promise((r) => setTimeout(r, 20));
      }
      const waits = warnings.map((w) => Number(w.obj.retryInS));
      expect(waits.slice(0, 3)).toEqual([0.3, 0.6, 1.2]);
      for (let i = 1; i < 3; i++) expect(warnings[i]!.at - warnings[i - 1]!.at).toBeGreaterThanOrEqual(waits[i - 1]! * 1000);
      expect(warnings.every((w) => w.msg === 'ground planning failed; the world keeps no herds until it is tried again')).toBe(true);
    } finally {
      await p.close();
    }
  });
});
