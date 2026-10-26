// Golden den counts per tier for the home planets of systems 0–9 at seed 424242 (P1.E02.T05; the fixture is written by
// packages/tools/src/fixtures/dens-golden.ts). Every value must come out exactly as it was written: the same random
// draws in the same order and the same float arithmetic.
import { describe, expect, it } from 'vitest';
import { LAND_PER_PREDATOR_DEN, MAX_TIER, denCounts } from '../src/world/index.ts';
import { denEntry, homes } from './dens-fixture.ts';
import fixture from './fixtures/dens-424242.json';
import world from './fixtures/world-424242.json';

describe('dens golden fixture, seed 424242', () => {
  it("covers the world fixture's ten home planets, at every tier 0–5", () => {
    expect(fixture.seed).toBe(world.seed);
    expect(fixture.homes.map(({ system, name, type, radius, seed }) => ({ system, name, type, radius, seed }))).toEqual(homes(world));
    for (const h of fixture.homes) expect(h.tiers.map((t) => t.tier)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('plans the full count for every tier on each of these living worlds (by its land), and none at Tier 0', () => {
    for (const h of fixture.homes) {
      for (const t of h.tiers) {
        const c = denCounts(t.tier, h.land);
        expect(t.byRole, `${h.name} tier ${t.tier}`).toEqual(c);
        expect(t.count).toBe(c.predator + c.ambusher + c.apex);
      }
      expect(h.tiers[0].count).toBe(0);
      expect(h.tiers[1].byRole.predator).toBe(Math.round(h.land / LAND_PER_PREDATOR_DEN));
      expect(h.tiers[MAX_TIER].byRole.predator).toBe(2 * h.tiers[1].byRole.predator);
    }
  });

  describe.each(fixture.homes)('home planet $name', (home) => {
    it('land, dens at every tier and the apex lair', () => {
      expect(denEntry(home)).toEqual(home);
    });
  });
});
