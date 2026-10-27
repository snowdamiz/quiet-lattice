// The ground resource nodes are scattered over (P1.E13.T01): fauna's planner plans it once per world in its worker
// thread, and the plan carries the sites' clearance, so every node is placed exactly where the same ground planned on
// this thread places it (and so where every client draws it, ARCHITECTURE §12). A ground planned without the clearance
// serves no nodes. (Fauna's planner tests cover workers that die, hang or fail.)
import { drawnGround, nodeCellLevel, nodeCellsNear, planetNodeLayers, scatterNodes, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { Ground, GroundPlanner, planGround, planPads } from '../fauna/terrain.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { nodeGroundsHere, nodeGroundsOf } from './ground.ts';

/** Rocky worlds of systems no other test plans. */
const worlds = [20, 21, 22].flatMap((s) =>
  describeZoneSystem(s)
    .bodies.filter((b) => b.type !== 'gas')
    .map((b) => b.params as PlanetParams),
);

const until = async (cond: () => boolean, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

describe('node ground', () => {
  it('planned in fauna’s worker, it scatters every node exactly as drawnGround on this thread does', async () => {
    const planner = new GroundPlanner();
    const grounds = nodeGroundsOf(planner);
    const params = worlds[0]!;
    try {
      expect(grounds.ground(params, 0)).toBeNull();
      expect(planner.planning).toBe(1);
      expect(await until(() => grounds.ground(params, 0) !== null)).toBe(true);
      const g = grounds.ground(params, 0)!;
      // the params given were not touched (drawnGround plans on a copy)
      expect(params.pads ?? null).toBeNull();
      const here = drawnGround({ ...params, pads: null }, 0);
      expect(g.nodeClear).toEqual(here.nodeClear);
      expect(g.nodeClear.length).toBe(here.sites.length * 4);
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
      // the same ground (one plan) serves fauna and the nodes
      expect(planner.ground(params, 0)!.nodes!.sampler).toBe(g.sampler);
    } finally {
      await planner.close();
    }
  });

  it('on this thread too; a ground planned without the clearance serves no nodes', () => {
    const params = worlds[1]!;
    const plan = planGround(params, 0);
    expect(plan.pads).toEqual(planPads(params, 0));
    expect(nodeGroundsHere.ground(params, 0)!.nodeClear).toEqual(plan.nodeClear);
    expect(new Ground(params, plan.pads).nodes).toBeNull();
    expect(new Ground(params, plan.pads, plan.nodeClear).nodes!.nodeClear).toEqual(plan.nodeClear);
  });
});
