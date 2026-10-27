// The species generator (DESIGN 12.2, 12.8): temperaments and body plans as the data tables have them, hostile species by
// tier, lists that only grow with the tier, and plain, deterministic data.
import { describe, expect, it } from 'vitest';
import { DENSITY, PACK_RULES, TEMPERAMENTS, getBodyPlan } from '../src/data/index.ts';
import {
  FAUNA_HERD,
  FAUNA_MAX_TIER,
  GALAXY_SEED,
  Galaxy,
  describeGalaxySystem,
  faunaSpecies,
  hasFauna,
  type FaunaSpecies,
  type PlanetParams,
} from '../src/world/index.ts';

const galaxy = new Galaxy(GALAXY_SEED);
/** Every rocky world of the first 30 systems. */
const worlds: PlanetParams[] = galaxy.systems.slice(0, 30).flatMap((info) =>
  describeGalaxySystem(info)
    .bodies.filter((b) => b.type !== 'gas')
    .map((b) => b.params as PlanetParams),
);
const living = worlds.filter(hasFauna);

describe('faunaSpecies', () => {
  it('populates the worlds with fauna, and no others', () => {
    expect(living.length).toBeGreaterThan(40);
    for (const p of worlds) expect(faunaSpecies(p, 5).length > 0).toBe(hasFauna(p));
  });

  it('is deterministic, and a fresh copy every call', () => {
    for (const p of living.slice(0, 10)) {
      const a = faunaSpecies(p, 3);
      const b = faunaSpecies(p, 3);
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    }
  });

  it('only grows with the tier, so an index names the same species at every tier', () => {
    for (const p of living) {
      let prev: FaunaSpecies[] = [];
      for (let tier = 0; tier <= 5; tier++) {
        const list = faunaSpecies(p, tier);
        expect(list.slice(0, prev.length)).toEqual(prev);
        list.forEach((s, i) => expect(s.index).toBe(i));
        for (const s of list) expect(s.tier).toBeLessThanOrEqual(Math.min(tier, FAUNA_MAX_TIER));
        prev = list;
      }
      expect(faunaSpecies(p, 5)).toEqual(faunaSpecies(p, FAUNA_MAX_TIER));
    }
  });

  it('rolls at Tier 0 only docile and skittish species, and at least the hostile species DESIGN 12.8 asks for above', () => {
    for (const p of living) {
      expect(faunaSpecies(p, 0).every((s) => (s.temperament === 'docile' || s.temperament === 'skittish') && s.tier === 0)).toBe(true);
      for (const d of DENSITY) {
        const hostile = faunaSpecies(p, d.tier).filter((s) => s.temperament !== 'docile' && s.temperament !== 'skittish');
        expect(hostile.length).toBeGreaterThanOrEqual(d.living.hostileSpeciesMin);
      }
      const t1 = faunaSpecies(p, 1).filter((s) => s.tier === 1);
      expect(t1).toHaveLength(1);
      expect(['territorial', 'predator']).toContain(t1[0]!.temperament);
      // Tier 2: a predator, ambushers and the apex (DESIGN 12.8)
      const t2 = faunaSpecies(p, 2);
      expect(t2.some((s) => s.temperament === 'predator')).toBe(true);
      expect(t2.filter((s) => s.temperament === 'ambusher')).toHaveLength(1);
      expect(t2.filter((s) => s.temperament === 'apex')).toHaveLength(1);
      expect(faunaSpecies(p, 3).filter((s) => s.tier === 3)).toHaveLength(1);
    }
  });

  it('gives each temperament only the body plans, roles and tiers the temperament table allows', () => {
    for (const p of living) {
      for (const s of faunaSpecies(p, 5)) {
        const t = TEMPERAMENTS.find((x) => x.id === s.temperament)!;
        expect(t).toBeDefined();
        expect(s.tier).toBeGreaterThanOrEqual(t.minTier);
        expect(getBodyPlan(s.bodyPlan).id).toBe(s.bodyPlan);
        if (t.bodyPlans !== 'all') {
          const allowed = t.bodyPlans.find((b) => b.plan === s.bodyPlan);
          expect(allowed, `${s.temperament} ${s.bodyPlan}`).toBeDefined();
          if (s.temperament === 'predator') expect(s.role).toBe(allowed!.role);
        }
        if (s.temperament !== 'predator') expect(s.role).toBeNull();
        expect(s.kind).toBe(s.bodyPlan === 'biped' ? 'biped' : s.bodyPlan === 'flyer' ? 'flyer' : 'quad');
        expect(s.spawn).toBe(s.temperament === 'ambusher' || s.temperament === 'apex' ? 'den' : 'herd');
      }
    }
  });

  it('keeps sizes, herds and speeds that suit each body plan', () => {
    for (const p of living) {
      for (const s of faunaSpecies(p, 5)) {
        if (s.bodyPlan === 'quad_heavy') expect(s.size).toBeGreaterThanOrEqual(2.2);
        if (s.bodyPlan === 'quad_small') expect(s.size).toBeLessThanOrEqual(0.9);
        expect(s.size).toBeGreaterThan(0.4);
        expect(s.size).toBeLessThan(5.6);
        expect(s.herd.min).toBeGreaterThanOrEqual(1);
        expect(s.herd.max).toBeGreaterThanOrEqual(s.herd.min);
        expect(s.run).toBeGreaterThan(s.walk);
        if (s.kind === 'flyer') expect(s.walk).toBe(9 + 2 * s.size);
        else expect(s.walk).toBe((s.kind === 'biped' ? 2.2 : 1.6) * Math.sqrt(s.size));
        if (s.temperament === 'predator') expect(s.herd).toEqual({ min: PACK_RULES.size.min, max: PACK_RULES.size.max });
        for (const c of [s.colors.base, s.colors.belly, s.colors.legs, s.colors.accent, s.colors.horn]) {
          expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff).toBe(true);
        }
        expect(s.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+$/);
        expect(Number.isInteger(s.shape) && s.shape >= 0 && s.shape <= 0xffffffff).toBe(true);
      }
    }
    expect(FAUNA_HERD.pack).toEqual({ min: PACK_RULES.size.min, max: PACK_RULES.size.max });
  });

  it('refuses a tier that is not a whole number from 0', () => {
    expect(() => faunaSpecies(living[0]!, -1)).toThrow(RangeError);
    expect(() => faunaSpecies(living[0]!, 1.5)).toThrow(RangeError);
  });
});
