// The ground resource nodes are scattered over (P1.E13.T01): planned in a worker thread, it places every node exactly
// where the same ground planned on this thread does (and so where every client draws it, ARCHITECTURE §12); a worker that
// dies, hangs or fails is restarted, sent the plan again, or backed off, as fauna's planner is.
import { drawnGround, nodeCellLevel, nodeCellsNear, planetNodeLayers, scatterNodes, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import type { NodePlannerWorkerMode } from '../../test/nodePlannerWorkers.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { NodeGroundPlanner, nodeGroundsHere } from './ground.ts';

/** Rocky worlds of a few systems, one per test (a planned world is kept and answered at once). */
const worlds = [20, 21, 22, 23, 24].flatMap((s) =>
  describeZoneSystem(s)
    .bodies.filter((b) => b.type !== 'gas')
    .map((b) => b.params as PlanetParams),
);
let next = 0;

const until = async (cond: () => boolean, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

describe('node ground', () => {
  it('planned in the worker, it scatters every node exactly as drawnGround on this thread does', async () => {
    const p = new NodeGroundPlanner();
    const params = worlds[next++]!;
    try {
      expect(p.ground(params, 0)).toBeNull();
      expect(p.planning).toBe(1);
      expect(await until(() => p.ground(params, 0) !== null)).toBe(true);
      const g = p.ground(params, 0)!;
      // the params given were not touched (drawnGround plans on a copy)
      expect(params.pads ?? null).toBeNull();
      const here = drawnGround({ ...params, pads: null }, 0);
      expect(g.nodeClear).toEqual(here.nodeClear);
      expect(g.sampler.pads).toEqual(here.pads);
      const layers = planetNodeLayers(params, 0);
      const level = nodeCellLevel(params.radius);
      let nodes = 0;
      for (const site of here.sites.slice(0, 3)) {
        for (const cell of nodeCellsNear(site.dir.x, site.dir.y, site.dir.z, 120, params.radius, level)) {
          const a = scatterNodes(g, layers, cell);
          expect(a).toEqual(scatterNodes(here, layers, cell));
          nodes += a.length;
        }
      }
      expect(nodes).toBeGreaterThan(0);
      expect(nodeGroundsHere().ground(params, 0)!.nodeClear).toEqual(here.nodeClear);
    } finally {
      await p.close();
    }
  });

  describe('a planner whose worker misbehaves', () => {
    const planner = (mode: NodePlannerWorkerMode, opts: { timeoutMs?: number; retryMs?: number } = {}) => {
      const warnings: { msg: string; obj: Record<string, unknown> }[] = [];
      const starts = new Int32Array(new SharedArrayBuffer(4));
      const p = new NodeGroundPlanner({
        log: { warn: (obj, msg) => warnings.push({ msg, obj: obj as Record<string, unknown> }) },
        script: new URL('../../test/nodePlannerWorkers.ts', import.meta.url),
        workerData: { mode, starts },
        ...opts,
      });
      return { p, warnings, starts, world: worlds[next++]! };
    };

    it('restarts a worker that exits, and sends it the plan again', async () => {
      const { p, warnings, starts, world } = planner('exit-first');
      try {
        expect(p.ground(world, 0)).toBeNull();
        expect(await until(() => p.ground(world, 0) !== null)).toBe(true);
        expect(Atomics.load(starts, 0)).toBe(2);
        expect(warnings.map((w) => w.msg)).toEqual(['node ground planner worker died; restarting it']);
      } finally {
        await p.close();
      }
    });

    it('plans on the main thread once its worker has died twice', async () => {
      const { p, warnings, world } = planner('exit');
      try {
        expect(p.ground(world, 0)).toBeNull();
        expect(await until(() => p.mainThread)).toBe(true);
        expect(p.ground(world, 0)).not.toBeNull();
        expect(warnings.map((w) => w.msg)).toEqual([
          'node ground planner worker died; restarting it',
          'node ground planner worker died again; planning on the main thread from now on',
        ]);
      } finally {
        await p.close();
      }
    });

    it('restarts a worker stuck past the timeout, and sends the plan again', async () => {
      const { p, warnings, starts, world } = planner('hang-first', { timeoutMs: 6000 });
      try {
        expect(p.ground(world, 0)).toBeNull();
        expect(await until(() => p.ground(world, 0) !== null)).toBe(true);
        expect(Atomics.load(starts, 0)).toBe(2);
        expect(warnings.map((w) => w.msg)).toEqual(['node ground plan timed out; restarting its worker']);
      } finally {
        await p.close();
      }
    });

    it('backs off a world whose plan fails, doubling the wait', async () => {
      const { p, warnings, world } = planner('throw', { retryMs: 300 });
      try {
        const end = Date.now() + 1500;
        while (Date.now() < end) {
          expect(p.ground(world, 0)).toBeNull();
          await new Promise((r) => setTimeout(r, 20));
        }
        const waits = warnings.map((w) => w.obj.retryInS);
        expect(waits.slice(0, 2)).toEqual([0.3, 0.6]);
        expect(waits.length).toBeLessThanOrEqual(3);
      } finally {
        await p.close();
      }
    });
  });
});
