import { faunaSpecies, type PlanetParams, type Tier } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import { HERD_CHANCE_MAX, HERD_CHANCE_PER_SPECIES, HERD_SPREAD_M, planCellHerd, TIER_LEVELS } from './herds.ts';
import { groundOf } from './terrain.ts';

const system = describeZoneSystem(0);
const home = system.bodies[system.home]!;
const params = home.params as PlanetParams;
const ground = groundOf(params);
const keys = Array.from({ length: 600 }, (_, i) => ground.cells.keyOf(Math.cos(i * 0.37), 0.4 + 0.001 * i, Math.sin(i * 0.37)));

describe('a cell’s herd', () => {
  it('is planned from the world seed and the cell alone: the same every time', () => {
    const species = faunaSpecies(params, 0);
    for (const key of keys.slice(0, 100))
      expect(planCellHerd(params.seed, key, species, 0, ground)).toEqual(planCellHerd(params.seed, key, species, 0, ground));
  });

  it('holds a herd in about the planned share of cells, of the herd spawner’s species only', () => {
    for (const tier of [0, 3] as Tier[]) {
      const species = faunaSpecies(params, tier);
      const pool = species.filter((s) => s.spawn === 'herd');
      const plans = keys.map((k) => planCellHerd(params.seed, k, species, tier, ground)).filter((p) => p !== null);
      // fewer than the chance: herds of walkers whose ground is under the sea are left out
      expect(plans.length / keys.length).toBeLessThanOrEqual(Math.min(HERD_CHANCE_MAX, HERD_CHANCE_PER_SPECIES * pool.length) + 0.06);
      expect(plans.length / keys.length).toBeGreaterThan(0.1);
      for (const p of plans) {
        expect(p.species.spawn).toBe('herd');
        expect(p.animals.length).toBeLessThanOrEqual(p.species.herd.max);
        expect(p.level).toBeGreaterThanOrEqual(TIER_LEVELS[tier][0]);
        expect(p.level).toBeLessThanOrEqual(TIER_LEVELS[tier][1]);
        expect(p.animals[0]!.offset).toEqual([0, 0]);
        for (const a of p.animals) for (const o of a.offset) expect(Math.abs(o)).toBeLessThanOrEqual(HERD_SPREAD_M);
        if (p.species.kind !== 'flyer') expect(ground.sample(p.center)).toBeGreaterThanOrEqual(1);
      }
      if (tier === 3) expect(plans.some((p) => p.species.tier > 0)).toBe(true);
    }
  });

  it('is none on a world without fauna', () => {
    const barren = system.bodies.find((b) => b.type === 'barren')!;
    expect(faunaSpecies(barren.params as PlanetParams, 5)).toEqual([]);
  });
});
