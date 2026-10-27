import { faunaSpecies, type PlanetParams, type Tier } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import { FAUNA_SPAWNING } from '@astra/shared/data';
import { HERD_CHANCE_MAX, HERD_CHANCE_PER_SPECIES, HERD_SPREAD_M, planCellHerd, planNightHerd, predatorHerdChance, TIER_LEVELS } from './herds.ts';
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

describe('a cell’s night herd', () => {
  const many = Array.from({ length: 12_000 }, (_, i) => ground.cells.keyOf(Math.cos(i * 0.37), Math.sin(i * 0.011) * 0.9, Math.sin(i * 0.37)));
  const species = faunaSpecies(params, 3);

  it('is planned from the world seed and the cell alone, always one of the herd spawner’s predators', () => {
    expect(species.some((s) => s.spawn === 'herd' && s.temperament === 'predator')).toBe(true);
    let n = 0;
    for (const key of many.slice(0, 600)) {
      const p = planNightHerd(params.seed, key, species, 3, ground);
      expect(p).toEqual(planNightHerd(params.seed, key, species, 3, ground));
      if (!p) continue;
      n++;
      expect(p.species.temperament).toBe('predator');
      expect(p.species.spawn).toBe('herd');
      expect(p.animals.length).toBeLessThanOrEqual(p.species.herd.max);
      expect(p.level).toBeGreaterThanOrEqual(TIER_LEVELS[3][0]);
      expect(p.level).toBeLessThanOrEqual(TIER_LEVELS[3][1]);
    }
    expect(n).toBeGreaterThan(0);
  });

  it('holds as many predators as the cells’ own herds do, on average, so night doubles them', () => {
    expect(FAUNA_SPAWNING.nightPredatorSpawnMult).toBe(2);
    const day = many.filter((k) => planCellHerd(params.seed, k, species, 3, ground)?.species.temperament === 'predator').length;
    const night = many.filter((k) => planNightHerd(params.seed, k, species, 3, ground) !== null).length;
    // (this world's predator flies, so no herd of it is left out for the sea)
    expect(day / many.length).toBeCloseTo(predatorHerdChance(species), 1);
    expect(day).toBeGreaterThan(100);
    expect(night / day).toBeGreaterThan(0.85);
    expect(night / day).toBeLessThan(1.15);
  });

  it('is none where the herd spawner has no predators', () => {
    const tier0 = faunaSpecies(params, 0);
    expect(predatorHerdChance(tier0)).toBe(0);
    for (const key of keys.slice(0, 100)) expect(planNightHerd(params.seed, key, tier0, 0, ground)).toBeNull();
  });
});
