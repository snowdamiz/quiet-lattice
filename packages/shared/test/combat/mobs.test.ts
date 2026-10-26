// A mob at a level: threat stars, scaled health and damage, attacks and resistances (DESIGN 12.1, 12.2, 12.3, 13).
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
import type { BodyPlanId } from '../../src/data/index.ts';
import { atLevel, mobStats, resistanceTo, threatRating } from '../../src/combat/index.ts';
import type { MobRef } from '../../src/combat/index.ts';

/** Every valid fauna pairing of temperament and body plan. */
const FAUNA: { bodyPlan: BodyPlanId; temperament: string }[] = TEMPERAMENTS.flatMap((t) =>
  (t.bodyPlans === 'all' ? BODY_PLANS.map((p) => p.id) : t.bodyPlans.map((p) => p.plan)).map((bodyPlan) => ({ bodyPlan, temperament: t.id })),
);
const STANDALONE = MOBS.filter((m) => m.group !== 'stone_touched');
const num = (x: number | null) => x ?? NaN;

describe('threat ratings', () => {
  it('rates fauna by temperament, for every body plan the temperament takes', () => {
    for (const f of FAUNA) expect(threatRating({ kind: 'fauna', ...f })).toBe(TEMPERAMENTS.find((t) => t.id === f.temperament)?.threat);
    expect(threatRating({ kind: 'fauna', bodyPlan: 'quad_grazer', temperament: 'docile' })).toBe(1);
    expect(threatRating({ kind: 'fauna', bodyPlan: 'biped', temperament: 'predator' })).toBe(3);
    expect(threatRating({ kind: 'fauna', bodyPlan: 'quad_heavy', temperament: 'apex' })).toBe(5);
  });

  it('rates a stone-touched herd at least as the stone-touched row does', () => {
    const touched = num(getMob('stone_touched').threat);
    expect(threatRating({ kind: 'fauna', bodyPlan: 'quad_grazer', temperament: 'docile', stoneTouched: true })).toBe(touched);
    expect(threatRating({ kind: 'fauna', bodyPlan: 'quad_heavy', temperament: 'apex', stoneTouched: true })).toBe(5);
  });

  it('refuses a body plan the temperament does not take, unknown ids, and the stone-touched overlay on its own', () => {
    expect(() => threatRating({ kind: 'fauna', bodyPlan: 'flyer', temperament: 'territorial' })).toThrow(RangeError);
    expect(() => threatRating({ kind: 'fauna', bodyPlan: 'biped', temperament: 'grumpy' })).toThrow(/temperament/);
    expect(() => threatRating({ kind: 'mob', id: 'nope' })).toThrow(/mob/);
    expect(() => threatRating({ kind: 'boss', id: 'nope' })).toThrow(/boss/);
    expect(() => threatRating({ kind: 'mob', id: 'stone_touched' })).toThrow(/overlay/);
    expect(() => mobStats({ kind: 'mob', id: 'stone_touched' }, 30)).toThrow(/overlay/);
  });

  it('rates archetypes by their row, bosses at 5 and the Patient not at all', () => {
    for (const m of STANDALONE) expect(threatRating({ kind: 'mob', id: m.id })).toBe(m.threat);
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

  it("keeps a row's damage and its attacks' damage consistent: damage is always the heaviest attack", () => {
    const refs: MobRef[] = [
      ...FAUNA.flatMap((f) => [
        { kind: 'fauna' as const, ...f },
        { kind: 'fauna' as const, ...f, stoneTouched: true },
      ]),
      ...STANDALONE.map((m) => ({ kind: 'mob' as const, id: m.id })),
      ...BOSSES.map((b) => ({ kind: 'boss' as const, id: b.id })),
    ];
    for (const ref of refs) {
      for (const level of [1, 17, 50]) {
        const s = mobStats(ref, level);
        if (s.attacks.length > 0) expect(s.damage).toBe(Math.max(...s.attacks.map((a) => a.damage)));
      }
    }
  });

  it('gives fauna their body plan attacks as DESIGN 12.2 lists them', () => {
    const s = mobStats({ kind: 'fauna', bodyPlan: 'biped', temperament: 'predator' }, 10);
    expect(s.damage).toBeCloseTo(atLevel(18, 10), 9); // leap 18 over claw 6
    expect(s.attacks.find((a) => a.id === 'claw_combo')?.damage).toBeCloseTo(atLevel(6, 10), 9);
  });

  it('makes the apex the Pack Alpha: boss health, attacks rescaled to its damage, threat 5', () => {
    const alpha = getBoss('pack_alpha');
    const s = mobStats({ kind: 'fauna', bodyPlan: 'quad_heavy', temperament: 'apex' }, 20);
    expect(s.health).toBeCloseTo(atLevel(num(alpha.baseHealth), 20), 9);
    expect(s.damage).toBeCloseTo(atLevel(num(alpha.baseDamage), 20), 9);
    expect(s.threat).toBe(5);
    // charge 25 and stomp 15 become 35 and 21: the heaviest matches the boss's 35, the rest keep their proportion
    expect(s.attacks.map((a) => [a.id, a.damage])).toEqual([
      ['charge', atLevel(35, 20)],
      ['stomp', atLevel(21, 20)],
    ]);
    expect(s).toEqual(mobStats({ kind: 'boss', id: 'pack_alpha' }, 20));
  });

  it('reads archetypes from their rows, falling back to the body plan', () => {
    const shambler = getMob('shambler');
    const s = mobStats({ kind: 'mob', id: 'shambler' }, 10);
    expect(s.health).toBeCloseTo(atLevel(num(shambler.baseHealth), 10), 9);
    expect(s.damage).toBeCloseTo(atLevel(num(shambler.baseDamage), 10), 9);
    expect(s.attacks.map((a) => [a.id, a.damage])).toEqual([
      ['charge', atLevel(30, 10)],
      ['stomp', atLevel(18, 10)],
    ]);
    expect(s.resistances).toEqual(CRYSTAL_RESISTANCES);
    expect(s.hollow).toBe(false);

    const sentinelRow = getMob('monolith_sentinel');
    const sentinel = mobStats({ kind: 'mob', id: 'monolith_sentinel' }, 30);
    expect(sentinel.health).toBeCloseTo(atLevel(num(sentinelRow.baseHealth), 30), 9);
    expect(sentinel.damage).toBeCloseTo(atLevel(num(sentinelRow.baseDamage), 30), 9);
    expect(sentinel.attacks).toEqual([]);
    expect(sentinel.resistances).toEqual(SENTINEL_RESISTANCES);
  });

  it('leaves hull-borne health and skill-web damage to their own systems', () => {
    const husk = mobStats({ kind: 'mob', id: 'hollow_husk' }, 40);
    expect(husk.health).toBeNull();
    expect(husk.damage).toBeNull();
    expect(husk.hollow).toBe(true);
    expect(husk.threat).toBe(getMob('hollow_husk').threat);
    const pirates = mobStats({ kind: 'mob', id: 'pirate_crew' }, 12);
    expect(pirates.health).toBeCloseTo(atLevel(num(getMob('pirate_crew').baseHealth), 12), 9);
    expect(pirates.damage).toBeNull();
    expect(pirates.resistances).toEqual([]);
  });

  it('turns a herd stone-touched: same body, health and attacks, plus the overlay resistances', () => {
    const ref = { kind: 'fauna', bodyPlan: 'quad_grazer', temperament: 'docile' } as const;
    const plain = mobStats(ref, 33);
    const touched = mobStats({ ...ref, stoneTouched: true }, 33);
    expect(touched.health).toBe(plain.health);
    expect(touched.attacks).toEqual(plain.attacks);
    expect(touched.damage).toBe(plain.damage);
    expect(touched.threat).toBe(getMob('stone_touched').threat);
    expect(touched.resistances).toEqual(getMob('stone_touched').resistances);
    expect(touched.hollow).toBe(false);
    expect(resistanceTo(touched.resistances, { node: 'harmonic' }).immune).toBe(true);
    expect(resistanceTo(touched.resistances, { node: 'nullsong' }).reactions).toEqual(['flee']);
    const alpha = mobStats({ kind: 'fauna', bodyPlan: 'quad_heavy', temperament: 'apex', stoneTouched: true }, 33);
    expect(alpha.health).toBe(mobStats({ kind: 'boss', id: 'pack_alpha' }, 33).health);
    expect(alpha.resistances).toEqual([...getBoss('pack_alpha').resistances, ...getMob('stone_touched').resistances]);
  });

  it('scales bosses and marks the Hollow ones', () => {
    const wardens = mobStats({ kind: 'boss', id: 'wardens' }, 45);
    expect(wardens.health).toBeCloseTo(atLevel(num(getBoss('wardens').baseHealth), 45), 6);
    expect(wardens.health).toBeCloseTo(num(getBoss('wardens').baseHealth) * (1 + 0.12 * 45), 6);
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
