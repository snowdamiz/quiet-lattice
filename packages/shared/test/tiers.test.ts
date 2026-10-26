// System tiers (DESIGN 11, P1.E02.T06): the distance bands at their exact edges, the Edge-ward fringe at its boundary
// with the Edge where the demo has it and moved, that a nearer Edge never lowers a tier, and the golden table of all 70
// systems at seed 424242 (written by packages/tools/src/fixtures/tiers-golden.ts) with every tier populated.
import { describe, expect, it } from 'vitest';
import {
  EDGE_FRINGE_X,
  EDGE_WARD_LY,
  EDGE_X,
  GALAXY_SEED,
  Galaxy,
  TIERS,
  TIER_BANDS_LY,
  bandTier,
  edgeLy,
  edgeX,
  galaxyTiers,
  homeLy,
  homeSystems,
  isEdgeWard,
  tierOf,
  tierOfGalaxySystem,
  type Tier,
} from '../src/world/index.ts';
import fixture from './fixtures/tiers-424242.json';

const galaxy = new Galaxy(GALAXY_SEED);
const homeIds = homeSystems().map((h) => h.systemIndex);
/** A point that is no system of the galaxy, `d` ly out from system 0 along +Z: system 0 is the nearest home to every
 * such point from 6 ly out (the other two lie at -Z and -X), and the Edge is as far from it as from system 0. */
const outZ = (d: number) => ({ id: 1000, x: 0, y: 0, z: d });
/** Just short of `ly`. */
const below = (ly: number) => ly - 1e-9;

describe('distance bands (DESIGN 11)', () => {
  it('begin Tier 2, 3, 4 and 5 at 18, 30, 45 and 60 ly', () => {
    expect(TIER_BANDS_LY).toEqual([18, 30, 45, 60]);
  });

  it('take in their lower edge, exactly at 6, 18, 30, 45 and 60 ly', () => {
    const at = (ly: number) => bandTier(ly);
    expect([at(6), at(18), at(30), at(45), at(60)]).toEqual([1, 2, 3, 4, 5]);
    expect([at(below(18)), at(below(30)), at(below(45)), at(below(60))]).toEqual([1, 2, 3, 4]);
    // (Tier 1 ended at 15 ly before; it is Tier 1 there now)
    expect([at(15), at(17.9), at(29), at(44.99), at(59.99), at(66), at(1e6), at(Infinity)]).toEqual([1, 1, 2, 3, 4, 5, 5, 5]);
  });

  it('put a system that is not a home system in Tier 1 even nearer a home than 6 ly', () => {
    expect([bandTier(0), bandTier(1), bandTier(below(6))]).toEqual([1, 1, 1]);
  });

  it('refuse a distance that is not one', () => {
    for (const ly of [-1, -1e-9, NaN]) expect(() => bandTier(ly), String(ly)).toThrow(RangeError);
  });

  it('apply to a system by its distance to the nearest home system', () => {
    for (const d of [6, 18, 30, 45, 60]) {
      expect(homeLy(outZ(d))).toBe(d);
      expect(tierOf(outZ(d)), `${d} ly`).toBe(bandTier(d));
      expect(tierOf(outZ(below(d))), `just under ${d} ly`).toBe(bandTier(below(d)));
    }
    expect([6, 18, 30, 45, 60].map((d) => tierOf(outZ(d)))).toEqual([1, 2, 3, 4, 5]);
    expect([18, 30, 45, 60].map((d) => tierOf(outZ(below(d))))).toEqual([1, 2, 3, 4]);
  });

  it('make the three home systems, and only they, Tier 0', () => {
    expect(homeIds).toEqual([0, 59, 1]);
    for (const id of homeIds) {
      expect(homeLy(galaxy.systems[id])).toBe(0);
      expect(tierOf(galaxy.systems[id])).toBe(0);
    }
    for (const s of galaxy.systems) if (!homeIds.includes(s.id)) expect(tierOf(s), s.name).toBeGreaterThan(0);
  });

  it('measure to the nearest of the three home systems', () => {
    const [a, b, c] = homeIds.map((i) => galaxy.systems[i]);
    for (const s of galaxy.systems) expect(homeLy(s)).toBe(Math.min(galaxy.distance(s, a), galaxy.distance(s, b), galaxy.distance(s, c)));
  });
});

describe('the Edge-ward fringe', () => {
  it('stands EDGE_FRINGE_X out along +X with the Edge at its default, where the demo has it', () => {
    expect(EDGE_FRINGE_X).toBe(45);
    expect(EDGE_WARD_LY).toBe(EDGE_X - 45);
    expect(edgeLy({ x: 45, y: 0, z: 0 })).toBe(EDGE_WARD_LY);
    expect(isEdgeWard({ x: 45, y: 0, z: 0 })).toBe(true);
    expect(isEdgeWard({ x: 44.999999, y: 0, z: 0 })).toBe(false);
  });

  it('makes a system Tier 5 exactly at its boundary, and leaves one just short of it to its band', () => {
    const at = (x: number, edge?: number) => tierOf({ id: 1000, x, y: 0, z: 0 }, edge);
    // at the default Edge the fringe is where Tier 4 begins, so it lifts Tier 4 to 5
    expect([at(45), at(44.999999)]).toEqual([5, 3]);
    expect(tierOf({ id: 1000, x: 45, y: 0, z: 0 })).toBe(tierOf({ id: 1000, x: 45, y: 0, z: 0 }, EDGE_X));
    // the Edge advanced 27 ly: the fringe comes in to 18 ly, a Tier 2 point there is Tier 5, one short of it Tier 1
    expect([at(18), at(18, EDGE_X - 27), at(17.5, EDGE_X - 27)]).toEqual([2, 5, 1]);
    // the Edge receded: the fringe goes out with it, past a point 50 ly out once the Edge is more than 5 ly back
    expect([at(50), at(50, EDGE_X + 5), at(50, EDGE_X + 5.5), at(50, EDGE_X + 20)]).toEqual([5, 5, 4, 4]);
  });

  it('follows the curve of the wall, which bows back towards the galaxy away from the +X axis', () => {
    const p = { x: 10, y: 3000, z: -4000 };
    expect(edgeLy(p)).toBe(edgeX(3000, -4000) - 10);
    expect(edgeLy(p, EDGE_X - 25)).toBe(edgeX(3000, -4000) - 25 - 10);
    expect(edgeLy(p)).toBeLessThan(edgeLy({ x: 10, y: 0, z: 0 }));
  });

  it('refuses an Edge that stands nowhere', () => {
    for (const edge of [NaN, Infinity, -Infinity]) {
      expect(() => tierOf(galaxy.systems[5], edge)).toThrow(RangeError);
      expect(() => edgeLy(galaxy.systems[5], edge)).toThrow(RangeError);
    }
  });

  it('never lowers a tier as the Edge comes nearer, never moves a home system, and swallows the cluster in the end', () => {
    let last = galaxy.systems.map((s) => tierOf(s, EDGE_X + 1000));
    // far out, the Edge-ward fringe is empty and every system is in its band
    expect(last).toEqual(galaxy.systems.map((s) => (homeIds.includes(s.id) ? 0 : bandTier(homeLy(s)))));
    const lowered: string[] = [];
    const seen = new Set<string>();
    for (let edge = EDGE_X + 120; edge >= EDGE_X - 200; edge -= 0.5) {
      const now = galaxy.systems.map((s) => tierOf(s, edge));
      for (const s of galaxy.systems) if (now[s.id] < last[s.id]) lowered.push(`${s.name} with the Edge at ${edge}`);
      seen.add(now.join());
      last = now;
    }
    expect(lowered).toEqual([]);
    // (the tiers did change on the way in, a system or a few at a time)
    expect(seen.size).toBeGreaterThan(20);
    expect(last).toEqual(galaxy.systems.map((s) => (homeIds.includes(s.id) ? 0 : 5)));
  });
});

describe('tierOf, as the client and server will call it', () => {
  it('refuses a home system that is not where it is', () => {
    expect(() => tierOf({ id: 0, x: 1, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => tierOf({ ...galaxy.systems[60], id: 59 })).toThrow(RangeError);
  });

  it('gives a galaxy system by id the tier tierOf gives it', () => {
    for (const s of galaxy.systems) {
      expect(tierOfGalaxySystem(s.id)).toBe(tierOf(s));
      expect(tierOfGalaxySystem(s.id, EDGE_X - 30)).toBe(tierOf(s, EDGE_X - 30));
    }
    for (const id of [-1, 70, 1.5, NaN]) expect(() => tierOfGalaxySystem(id), String(id)).toThrow(RangeError);
  });

  it('works in another galaxy, from its own home systems', () => {
    const other = new Galaxy(7);
    const homes = homeSystems(7).map((h) => h.systemIndex);
    for (const s of other.systems) expect(tierOf(s)).toBe(homes.includes(s.id) ? 0 : isEdgeWard(s) ? 5 : bandTier(homeLy(s, 7)));
  });
});

describe('tier table, seed 424242 (golden)', () => {
  const rows = galaxyTiers();
  const count = (tiers: readonly Tier[]) => TIERS.map((t) => tiers.filter((x) => x === t).length);

  it('lists all 70 systems with their distances and the tiers tierOf gives them, at the default Edge', () => {
    expect(fixture.galaxy).toBe(GALAXY_SEED);
    expect(fixture.edge).toBe(EDGE_X);
    expect(fixture.bandsLy).toEqual(TIER_BANDS_LY);
    expect(fixture.edgeWardLy).toBe(EDGE_WARD_LY);
    expect(fixture.systems.map((s) => [s.id, s.name])).toEqual(galaxy.systems.map((s) => [s.id, s.name]));
    expect(fixture.systems).toEqual(rows);
    expect(fixture.systems.map((s) => s.tier)).toEqual(galaxy.systems.map((s) => tierOf(s)));
  });

  it('populates every tier 0–5', () => {
    const counts = count(fixture.systems.map((s) => s.tier as Tier));
    expect(fixture.counts).toEqual(counts);
    expect(counts).toEqual([3, 9, 11, 22, 19, 6]);
    // Act I opens in Tier 1: the systems within 18 ly of a home
    const one = fixture.systems.filter((s) => s.tier === 1).sort((a, b) => a.homeLy - b.homeLy);
    expect(one.map((s) => s.name)).toEqual(['Corzenzen', 'Phasolmir', 'Nyxsol', 'Xasar', 'Ulqua', 'Calzu', 'Zuix', 'Eoerarhe', 'Ariphabel']);
    for (const t of TIERS) expect(counts[t], `tier ${t}`).toBeGreaterThan(0);
  });

  it('owes its Tier 5 to the 60 ly band and to the fringe', () => {
    const five = fixture.systems.filter((s) => s.tier === 5);
    expect(five.filter((s) => s.homeLy >= 60).map((s) => s.name)).toEqual(['Oralcal']);
    expect(five.every((s) => s.homeLy >= 60 || s.edgeWard)).toBe(true);
    // at the default Edge the fringe lifts only Tier 4 systems
    expect(five.filter((s) => s.edgeWard).every((s) => s.homeLy >= 45)).toBe(true);
  });
});
