// Levels and XP (DESIGN 12.1, 14.9).
import { describe, expect, it } from 'vitest';
import { COMBAT } from '../../src/data/index.ts';
import { assertLevel, atLevel, killXp, levelForXp, totalXpFor, xpToReach } from '../../src/combat/index.ts';

describe('levels', () => {
  it('accepts whole levels 1–50 and rejects everything else', () => {
    expect(assertLevel(1)).toBe(1);
    expect(assertLevel(50)).toBe(50);
    for (const bad of [-1, -50, 0, 51, 1.5, NaN, Infinity]) expect(() => assertLevel(bad)).toThrow(RangeError);
  });

  it('scales health and damage as base × (1 + 0.12 × level) (DESIGN 12.1)', () => {
    expect(COMBAT.perLevel).toBe(0.12);
    expect(atLevel(100, 1)).toBeCloseTo(112, 9);
    expect(atLevel(100, 10)).toBeCloseTo(220, 9);
    expect(atLevel(100, 50)).toBeCloseTo(700, 9);
    expect(atLevel(25, 10)).toBeCloseTo(55, 9);
    expect(atLevel(0, 50)).toBe(0);
  });

  it('rejects negative levels and bad bases', () => {
    expect(() => atLevel(100, -1)).toThrow(RangeError);
    expect(() => atLevel(-1, 10)).toThrow(RangeError);
    expect(() => atLevel(NaN, 10)).toThrow(RangeError);
  });
});

describe('XP (DESIGN 14.9)', () => {
  it('needs 100 × n^1.6 to reach level n: ≈ 4k for 10, ≈ 23k for 30, ≈ 52k for 50', () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(Math.round(100 * 2 ** 1.6));
    expect(xpToReach(10)).toBe(3981);
    expect(xpToReach(30)).toBe(23088);
    expect(xpToReach(50)).toBe(52282);
    expect(Math.round(xpToReach(10) / 1000)).toBe(4);
    expect(Math.round(xpToReach(30) / 1000)).toBe(23);
    expect(Math.round(xpToReach(50) / 1000)).toBe(52);
  });

  it('totals about 1.0M to the cap', () => {
    expect(totalXpFor(1)).toBe(0);
    expect(totalXpFor(2)).toBe(xpToReach(2));
    expect(totalXpFor(50) / 1e6).toBeCloseTo(1.0, 1);
    for (let n = 2; n <= 50; n++) expect(totalXpFor(n)).toBe(totalXpFor(n - 1) + xpToReach(n));
  });

  it('turns total XP back into a level, capped at 50', () => {
    expect(levelForXp(0)).toBe(1);
    for (let n = 1; n <= 50; n++) expect(levelForXp(totalXpFor(n))).toBe(n);
    for (let n = 2; n <= 50; n++) expect(levelForXp(totalXpFor(n) - 1)).toBe(n - 1);
    expect(levelForXp(1e12)).toBe(50);
    expect(() => levelForXp(-1)).toThrow(RangeError);
    expect(() => levelForXp(NaN)).toThrow(RangeError);
  });

  it('gives mob level × 10 for a kill', () => {
    expect(killXp(1)).toBe(10);
    expect(killXp(23)).toBe(230);
    expect(killXp(50)).toBe(500);
    expect(() => killXp(-3)).toThrow(RangeError);
    expect(() => killXp(0)).toThrow(RangeError);
  });
});
