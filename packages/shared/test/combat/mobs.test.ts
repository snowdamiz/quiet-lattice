// A mob at a level: threat stars, scaled health and damage, attacks and resistances (DESIGN 12.1, 12.2, 13).
import { describe, expect, it } from 'vitest';
import {
  BODY_PLANS,
  BOSSES,
  CRYSTAL_RESISTANCES,
  HOLLOW_RESISTANCES,
  MOBS,
  SENTINEL_RESISTANCES,
  TEMPERAMENTS,
  getBodyPlan,
  getBoss,
  getMob,
} from '../../src/data/index.ts';
import { atLevel, mobStats, threatRating } from '../../src/combat/index.ts';

describe('threat ratings', () => {
  it('rates fauna by temperament, for every body plan the temperament takes', () => {
    for (const t of TEMPERAMENTS) {
      const plans = t.bodyPlans === 'all' ? BODY_PLANS.map((p) => p.id) : t.bodyPlans.map((p) => p.plan);
      for (const plan of plans) expect(threatRating({ kind: 'fauna', bodyPlan: plan, temperament: t.id })).toBe(t.threat);
    }
    expect(threatRating({ kind: 'fauna', bodyPlan: 'quad_grazer', temperament: 'docile' })).toBe(1);
    expect(threatRating({ kind: 'fauna', bodyPlan: 'biped', temperament: 'predator' })).toBe(3);
    expect(threatRating({ kind: 'fauna', bodyPlan: 'quad_heavy', temperament: 'apex' })).toBe(5);
  });

  it('refuses a body plan the temperament does not take, and unknown ids', () => {
    expect(() => threatRating({ kind: 'fauna', bodyPlan: 'flyer', temperament: 'territorial' })).toThrow(RangeError);
    expect(() => threatRating({ kind: 'fauna', bodyPlan: 'biped', temperament: 'grumpy' })).toThrow(/temperament/);
    expect(() => threatRating({ kind: 'mob', id: 'nope' })).toThrow(/mob/);
    expect(() => threatRating({ kind: 'boss', id: 'nope' })).toThrow(/boss/);
  });

  it('rates archetypes by their row, bosses at 5 and the Patient not at all', () => {
    for (const m of MOBS) expect(threatRating({ kind: 'mob', id: m.id })).toBe(m.threat);
    for (const b of BOSSES) expect(threatRating({ kind: 'boss', id: b.id })).toBe(b.killable ? 5 : null);
    expect(threatRating({ kind: 'boss', id: 'the_descent' })).toBeNull();
    expect(threatRating({ kind: 'mob', id: 'ring_grazers' })).toBeNull();
  });
});

describe('mob stats', () => {
  it('scales fauna from the body plan at levels 1, 10 and 50', () => {
    const base = getBodyPlan('quad_heavy').baseHealth;
    for (const [level, mult] of [
      [1, 1.12],
      [10, 2.2],
      [50, 7],
    ]) {
      const s = mobStats({ kind: 'fauna', bodyPlan: 'quad_heavy', temperament: 'territorial' }, level);
      expect(s.level).toBe(level);
      expect(s.health).toBeCloseTo(base * mult, 9);
      expect(s.attacks.map((a) => a.id)).toEqual(['charge', 'stomp']);
      expect(s.attacks[0].damage).toBeCloseTo(25 * mult, 9); // DESIGN 12.2: charge, 25 dmg
      expect(s.damage).toBeCloseTo(25 * mult, 9);
      expect(s.threat).toBe(2);
      expect(s.resistances).toEqual([]);
      expect(s.hollow).toBe(false);
    }
  });

  it('gives each plan its heaviest attack as its damage', () => {
    const s = mobStats({ kind: 'fauna', bodyPlan: 'biped', temperament: 'predator' }, 10);
    expect(s.damage).toBeCloseTo(atLevel(18, 10), 9); // leap 18 over claw 6
    expect(s.attacks.find((a) => a.id === 'claw_combo')?.damage).toBeCloseTo(atLevel(6, 10), 9);
  });

  it('makes the apex the Pack Alpha: boss health and damage, threat 5', () => {
    const alpha = getBoss('pack_alpha');
    const s = mobStats({ kind: 'fauna', bodyPlan: 'quad_heavy', temperament: 'apex' }, 20);
    expect(s.health).toBeCloseTo(atLevel(alpha.baseHealth ?? NaN, 20), 9);
    expect(s.damage).toBeCloseTo(atLevel(alpha.baseDamage ?? NaN, 20), 9);
    expect(s.threat).toBe(5);
    expect(s.attacks.map((a) => a.id)).toEqual(['charge', 'stomp']);
    expect(s).toEqual(mobStats({ kind: 'boss', id: 'pack_alpha' }, 20));
  });

  it('reads archetypes from their rows, falling back to the body plan', () => {
    const shambler = getMob('shambler');
    const s = mobStats({ kind: 'mob', id: 'shambler' }, 10);
    expect(s.health).toBeCloseTo(atLevel(shambler.baseHealth ?? NaN, 10), 9);
    expect(s.damage).toBeCloseTo(atLevel(shambler.baseDamage ?? NaN, 10), 9);
    expect(s.attacks.map((a) => a.id)).toEqual(['charge', 'stomp']);
    expect(s.resistances).toEqual(CRYSTAL_RESISTANCES);
    expect(s.hollow).toBe(false);

    const sentinel = mobStats({ kind: 'mob', id: 'monolith_sentinel' }, 30);
    expect(sentinel.health).toBeCloseTo(400 * (1 + 0.12 * 30), 9);
    expect(sentinel.attacks).toEqual([]);
    expect(sentinel.resistances).toEqual(SENTINEL_RESISTANCES);
  });

  it('leaves hull-borne health and skill-web damage to their own systems', () => {
    const husk = mobStats({ kind: 'mob', id: 'hollow_husk' }, 40);
    expect(husk.health).toBeNull();
    expect(husk.damage).toBeNull();
    expect(husk.hollow).toBe(true);
    expect(husk.threat).toBe(4);
    const pirates = mobStats({ kind: 'mob', id: 'pirate_crew' }, 12);
    expect(pirates.health).toBeCloseTo(atLevel(100, 12), 9);
    expect(pirates.damage).toBeNull();
    expect(pirates.resistances).toEqual([]);
  });

  it('scales bosses and marks the Hollow ones', () => {
    const wardens = mobStats({ kind: 'boss', id: 'wardens' }, 45);
    expect(wardens.health).toBeCloseTo(25000 * (1 + 0.12 * 45), 6);
    expect(wardens.threat).toBe(5);
    expect(wardens.resistances).toEqual(SENTINEL_RESISTANCES);
    expect(wardens.hollow).toBe(false);
    for (const id of ['dreadnought', 'hive_heart', 'husk_admiral']) {
      const s = mobStats({ kind: 'boss', id }, 50);
      expect(s.hollow).toBe(true);
      expect(s.resistances).toEqual(HOLLOW_RESISTANCES);
    }
    const patient = mobStats({ kind: 'boss', id: 'the_descent' }, 45);
    expect(patient.health).toBeNull();
    expect(patient.threat).toBeNull();
  });

  it('rejects bad levels for every kind, even with nothing to scale', () => {
    expect(() => mobStats({ kind: 'fauna', bodyPlan: 'flyer', temperament: 'docile' }, -1)).toThrow(RangeError);
    expect(() => mobStats({ kind: 'mob', id: 'hollow_tide' }, -1)).toThrow(RangeError);
    expect(() => mobStats({ kind: 'boss', id: 'the_descent' }, 0)).toThrow(RangeError);
    expect(() => mobStats({ kind: 'boss', id: 'wardens' }, 51)).toThrow(RangeError);
  });
});
