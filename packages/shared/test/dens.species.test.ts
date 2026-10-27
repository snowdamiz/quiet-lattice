// Who lives in each den (P1.E08.T03): planned from the world's own species, each den names its occupant and a predator den
// is the kind its predator lives in, while the counts and the passes' order stay as P1.E02.T05 planned them; the drawn
// ground (drawnGround) plans the same dens once they are drawn.
import { describe, expect, it } from 'vitest';
import {
  APEX_FOOTPRINT,
  DEN_FOOTPRINT,
  DEN_PASSES,
  DENS_DRAWN,
  FAUNA_MAX_TIER,
  MAX_TIER,
  TerrainSampler,
  createPlanetParams,
  denCounts,
  denKindFor,
  denOccupants,
  denPads,
  denPlans,
  drawnGround,
  faunaSpecies,
  landArea,
  planSurface,
  siteNodeClearance,
  worldSurface,
  type DenSpecies,
  type FaunaSpecies,
  type PlanetParams,
} from '../src/world/index.ts';

/** Small living worlds (quick to plan), with one or two predator species. */
const worlds = [createPlanetParams(31, 'lush', 22000), createPlanetParams(57, 'alien', 20000), createPlanetParams(5, 'frozen', 24000, { isMoon: true })];

function plan(params: PlanetParams, tier: number) {
  const p = { ...params, pads: null };
  return planSurface(p, new TerrainSampler(p), { tier });
}

describe('who lives in each den', () => {
  it('is one predator per predator pass (the first, then the second or the first again), the ambusher and the apex', () => {
    const sp = (index: number, temperament: DenSpecies['temperament'], bodyPlan: DenSpecies['bodyPlan']): DenSpecies => ({ index, temperament, bodyPlan });
    const a = sp(3, 'predator', 'flyer');
    const b = sp(6, 'predator', 'quad_small');
    const amb = sp(4, 'ambusher', 'biped');
    const apex = sp(5, 'apex', 'quad_heavy');
    expect(DEN_PASSES.map((p) => p.role)).toEqual(['predator', 'ambusher', 'apex', 'predator']);
    expect(denOccupants([sp(0, 'docile', 'quad_grazer'), a, amb, apex, b])).toEqual([a, amb, apex, b]);
    expect(denOccupants([a, amb, apex, sp(6, 'territorial', 'quad_heavy')])).toEqual([a, amb, apex, a]);
    expect(denOccupants([sp(0, 'skittish', 'flyer')])).toEqual([null, null, null, null]);
    expect(['quad_small', 'biped', 'flyer', 'quad_heavy'].map((p) => denKindFor(p as FaunaSpecies['bodyPlan']))).toEqual(['burrow', 'nest', 'roost', 'nest']);
  });

  describe.each(worlds.map((params) => ({ params, name: `${params.type} ${params.seed}` })))('on the $name world', ({ params }) => {
    const species = faunaSpecies(params, FAUNA_MAX_TIER);
    const predators = species.filter((s) => s.temperament === 'predator');
    const byTier = Array.from({ length: MAX_TIER + 1 }, (_, tier) => plan(params, tier));
    const land = landArea(params, new TerrainSampler({ ...params, pads: null }));

    it('plans the counts of every tier, and the same cities and sites at every tier', () => {
      expect(predators.length).toBeGreaterThan(0);
      for (const [tier, w] of byTier.entries()) {
        const roles = { predator: 0, ambusher: 0, apex: 0 };
        for (const d of w.dens) roles[d.role]++;
        expect(roles, `tier ${tier}`).toEqual(denCounts(tier, land));
        expect(w.cities).toEqual(byTier[0]!.cities);
        expect(w.sites).toEqual(byTier[0]!.sites);
      }
      expect(byTier[1]!.dens.length).toBeGreaterThan(0);
    });

    it('names each den’s occupant, of its role, and makes a predator den the kind its predator lives in', () => {
      const top = byTier[MAX_TIER]!;
      const first = top.dens.findIndex((d) => d.role !== 'predator');
      top.dens.forEach((d, i) => {
        const sp = species[d.species]!;
        expect(sp.temperament).toBe(d.role);
        expect(d.plans).toEqual(denPlans(d.role, d.kind));
        expect(d.plans).toContain(sp.bodyPlan);
        if (d.role === 'predator') {
          expect(d.kind).toBe(denKindFor(sp.bodyPlan));
          expect(d.footprint).toBe(DEN_FOOTPRINT[d.kind]);
          // the first pass houses the world's first predator, the second pass its second (or its first again)
          expect(sp).toBe(i < first ? predators[0] : (predators[1] ?? predators[0]));
        }
        if (d.role === 'ambusher') expect(d.kind).toBe('burrow');
        if (d.role === 'apex') expect([d.kind, d.footprint]).toEqual(['nest', APEX_FOOTPRINT]);
      });
      // (at a lower tier a den may house a species the world does not carry yet: it stands empty there)
      const tier1 = faunaSpecies(params, 1);
      for (const d of byTier[1]!.dens) expect(d.species >= tier1.length || tier1[d.species]!.temperament === 'predator').toBe(true);
    });

    it('is deterministic, a round trip through JSON, and raising the tier adds dens without moving or rehousing one', () => {
      expect(plan(params, 3).dens).toEqual(byTier[3]!.dens);
      expect(JSON.parse(JSON.stringify(byTier[MAX_TIER]!.dens))).toEqual(byTier[MAX_TIER]!.dens);
      for (let tier = 0; tier < MAX_TIER; tier++) {
        const lower = byTier[tier]!;
        const higher = byTier[tier + 1]!;
        expect(higher.dens.slice(0, lower.dens.length)).toEqual(lower.dens);
        expect(higher.pads.slice(0, lower.pads.length)).toEqual(lower.pads);
      }
    });

    it('is the drawn ground’s plan: its pads are the cities’ and sites’, then (once dens are drawn) these dens’; one plan with the nodes’ clearance', () => {
      for (const tier of [1, 3]) {
        const drawn = drawnGround({ ...params, pads: null }, tier);
        const planned = byTier[tier]!;
        const head = planned.pads.slice(0, planned.pads.length - denPads(planned.dens).length);
        expect(drawn.cities).toEqual(planned.cities);
        expect(drawn.sites).toEqual(planned.sites);
        expect(drawn.dens).toEqual(DENS_DRAWN ? planned.dens : []);
        expect(drawn.pads).toEqual(DENS_DRAWN ? planned.pads : head);
        expect([...head, ...denPads(planned.dens)]).toEqual(planned.pads);
        // the whole surface from one plan: the drawn ground's pads and node clearance to the bit, and these dens
        const whole = worldSurface({ ...params, pads: null }, tier);
        expect(whole.dens).toEqual(planned.dens);
        expect(whole.ground.pads).toEqual(drawn.pads);
        expect(whole.ground.nodeClear).toEqual(drawn.nodeClear);
        expect(whole.ground.nodeClear).toEqual(siteNodeClearance(planned.sites));
        expect(whole.ground.sampler.height(0.3, 0.8, 0.52)).toBe(drawn.sampler.height(0.3, 0.8, 0.52));
      }
    });
  });
});
