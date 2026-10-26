// The aggro model (DESIGN 12.1): threat to whoever hurt a mob most recently, Veil (−), Harmonic (reset), taunt (+).
import { describe, expect, it } from 'vitest';
import { getSkillNode } from '../../src/data/index.ts';
import { AGGRO, addThreat, currentTarget, decayThreat, dropThreat, emptyThreat, harmonicReset, taunt, threatOf } from '../../src/combat/index.ts';

describe('threat', () => {
  it('starts empty and goes to the attacker with the most threat', () => {
    let t = emptyThreat<string>();
    expect(currentTarget(t, 0)).toBeNull();
    t = addThreat(t, 'a', 10, 0);
    t = addThreat(t, 'b', 5, 0);
    expect(currentTarget(t, 0)).toBe('a');
    t = addThreat(t, 'b', 20, 0);
    expect(threatOf(t, 'b', 0)).toBe(25);
    expect(currentTarget(t, 0)).toBe('b');
  });

  it('halves every half-life, by the clock', () => {
    const t = addThreat(emptyThreat(), 'a', 40, 10);
    expect(threatOf(t, 'a', 10 + AGGRO.halfLifeS)).toBeCloseTo(20, 12);
    expect(threatOf(t, 'a', 10 + 2 * AGGRO.halfLifeS)).toBeCloseTo(10, 12);
    expect(threatOf(t, 'a', 5)).toBe(40); // never grows backwards in time
    expect(threatOf(t, 'nobody', 10)).toBe(0);
  });

  it('passes to whoever is hurting it now once older damage fades', () => {
    let t = addThreat(emptyThreat(), 'a', 30, 0);
    t = addThreat(t, 'b', 10, 2);
    expect(currentTarget(t, 2)).toBe('a'); // one chip hit does not steal it
    t = addThreat(t, 'b', 10, 6);
    expect(currentTarget(t, 6)).toBe('b');
  });

  it('breaks ties toward the most recent attacker', () => {
    let t = addThreat(emptyThreat(), 'a', 8, 0);
    t = addThreat(t, 'b', 4, AGGRO.halfLifeS);
    expect(threatOf(t, 'a', AGGRO.halfLifeS)).toBe(threatOf(t, 'b', AGGRO.halfLifeS));
    expect(currentTarget(t, AGGRO.halfLifeS)).toBe('b');
  });

  it('forgets faded threat, and decayThreat drops it from the table', () => {
    let t = addThreat(emptyThreat(), 'a', 10, 0);
    t = addThreat(t, 'b', 1000, 0);
    const late = 3 * AGGRO.halfLifeS * 5; // 2^-15 of the original
    expect(currentTarget(t, late)).toBeNull();
    const d = decayThreat(t, 6 * AGGRO.halfLifeS);
    expect(d.entries.map((e) => e.id)).toEqual(['b']);
    expect(d.entries[0].threat).toBeCloseTo(1000 / 64, 9);
    expect(d.entries[0].at).toBe(6 * AGGRO.halfLifeS);
    expect(currentTarget(d, 6 * AGGRO.halfLifeS)).toBe('b');
  });

  it('never mutates a table', () => {
    const t0 = addThreat(emptyThreat(), 'a', 10, 0);
    const snapshot = JSON.stringify(t0);
    addThreat(t0, 'a', 5, 1);
    addThreat(t0, 'b', 5, 1);
    decayThreat(t0, 100);
    dropThreat(t0, 'a');
    harmonicReset(t0, 1);
    taunt(t0, 'c', 1);
    expect(JSON.stringify(t0)).toBe(snapshot);
  });

  it('works with numeric entity ids and is deterministic', () => {
    const run = () => {
      let t = emptyThreat<number>();
      for (let i = 0; i < 20; i++) t = addThreat(t, i % 3, (i * 7) % 11, i * 0.5);
      return [currentTarget(t, 10), threatOf(t, 1, 10)];
    };
    expect(run()).toEqual(run());
    expect(typeof run()[0]).toBe('number');
  });

  it('rejects bad amounts and times', () => {
    expect(() => addThreat(emptyThreat(), 'a', -1, 0)).toThrow(RangeError);
    expect(() => addThreat(emptyThreat(), 'a', NaN, 0)).toThrow(RangeError);
    expect(() => addThreat(emptyThreat(), 'a', 1, NaN)).toThrow(RangeError);
    expect(() => currentTarget(emptyThreat(), Infinity)).toThrow(RangeError);
    expect(() => taunt(emptyThreat(), 'a', 0, -1)).toThrow(RangeError);
    expect(() => harmonicReset(emptyThreat(), 0, NaN)).toThrow(RangeError);
  });
});

describe('Veil (−)', () => {
  it("drops the caster's threat", () => {
    let t = addThreat(emptyThreat(), 'a', 50, 0);
    t = addThreat(t, 'b', 5, 0);
    t = dropThreat(t, 'a');
    expect(threatOf(t, 'a', 0)).toBe(0);
    expect(currentTarget(t, 0)).toBe('b');
  });

  it('hides veiled attackers from target selection while it lasts', () => {
    let t = addThreat(emptyThreat<string>(), 'a', 50, 0);
    t = addThreat(t, 'b', 5, 0);
    const veiled = new Set(['a']);
    expect(currentTarget(t, 1, (id) => veiled.has(id))).toBe('b');
    veiled.add('b');
    expect(currentTarget(t, 1, (id) => veiled.has(id))).toBeNull();
    expect(currentTarget(t, 1)).toBe('a');
  });
});

describe('Harmonic (reset)', () => {
  it("clears all threat and calms the mob for Harmonic's duration from the data", () => {
    const duration = getSkillNode('harmonic').params.durationS ?? NaN;
    expect(duration).toBe(20);
    let t = addThreat(emptyThreat(), 'a', 50, 0);
    t = taunt(t, 'pet', 0);
    t = harmonicReset(t, 1);
    expect(t.entries).toEqual([]);
    expect(t.taunt).toBeNull();
    expect(t.calmUntil).toBe(1 + duration);
    t = addThreat(t, 'a', 0, 2); // noticing someone is not being hurt
    expect(currentTarget(t, 1 + duration - 0.01)).toBeNull();
    expect(currentTarget(t, 1 + duration)).toBeNull(); // nothing to chase after the calm either
    expect(decayThreat(t, 1 + duration).calmUntil).toBeNull();
  });

  it('breaks when the mob is hurt', () => {
    let t = harmonicReset(addThreat(emptyThreat(), 'a', 50, 0), 1);
    t = addThreat(t, 'b', 3, 5);
    expect(t.calmUntil).toBeNull();
    expect(currentTarget(t, 5)).toBe('b');
  });
});

describe('taunt (+)', () => {
  it("holds the mob on a Bond companion for the taunt's duration, then threat decides again", () => {
    let t = addThreat(emptyThreat(), 'player', 50, 0);
    t = taunt(t, 'pet', 0);
    expect(currentTarget(t, 0)).toBe('pet');
    t = addThreat(t, 'player', 500, 1);
    expect(currentTarget(t, AGGRO.tauntS - 0.01)).toBe('pet');
    expect(currentTarget(t, AGGRO.tauntS)).toBe('player');
    expect(decayThreat(t, AGGRO.tauntS).taunt).toBeNull();
  });

  it('wakes a calmed mob, yields to a hidden taunter, and ends when the taunter is dropped', () => {
    let t = harmonicReset(addThreat(emptyThreat(), 'player', 50, 0), 0);
    t = taunt(t, 'pet', 1, 10);
    expect(currentTarget(t, 2)).toBe('pet');
    t = addThreat(t, 'player', 5, 2);
    expect(currentTarget(t, 3, (id) => id === 'pet')).toBe('player');
    t = dropThreat(t, 'pet');
    expect(t.taunt).toBeNull();
    expect(currentTarget(t, 3)).toBe('player');
  });
});
