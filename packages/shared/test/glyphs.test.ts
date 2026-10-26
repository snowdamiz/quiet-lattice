import { describe, expect, it } from 'vitest';
import { SIGNS, countDigits, fromCountDigits, nodePosition, strokeEnds, transliterate, type Stroke } from '../src/art/glyphs.ts';

const key = (strokes: readonly Stroke[]) => [...strokes].sort().join(',');

describe('Cartographer glyphs', () => {
  it('has 24 distinct signs: 23 letters and the divider', () => {
    expect(SIGNS).toHaveLength(24);
    expect(new Set(SIGNS.map((s) => s.letter)).size).toBe(24);
    expect(new Set(SIGNS.map((s) => key(s.strokes))).size).toBe(24);
  });

  it('every letter is one connected figure anchored by a spoke', () => {
    for (const s of SIGNS.filter((x) => x.letter !== '·')) {
      expect(
        s.strokes.some((k) => k[0] === 'S'),
        s.letter,
      ).toBe(true);
      const seen = new Set<string>(['C']);
      let grew = true;
      while (grew) {
        grew = false;
        for (const k of s.strokes) {
          const [a, b] = strokeEnds(k).map(String);
          if (seen.has(a) !== seen.has(b)) {
            seen.add(a);
            seen.add(b);
            grew = true;
          }
        }
      }
      for (const k of s.strokes) for (const n of strokeEnds(k)) expect(seen.has(String(n)), `${s.letter} ${k}`).toBe(true);
    }
  });

  it('places N0 at the top and numbers clockwise', () => {
    const [x0, y0] = nodePosition(0);
    const [x1, y1] = nodePosition(1);
    expect(x0).toBeCloseTo(0);
    expect(y0).toBeCloseTo(0.5);
    expect(x1).toBeGreaterThan(0);
    expect(y1).toBeGreaterThan(0);
  });

  it('transliterates names', () => {
    expect(transliterate('Quavel').map((s) => s.letter)).toEqual(['k', 'u', 'a', 'v', 'e', 'l']);
    expect(transliterate('nyx a').map((s) => s.letter)).toEqual(['n', 'y', 'k', 's', '·', 'a']);
  });

  it('writes the Count in base-6 rings, units innermost', () => {
    expect(countDigits(0)).toEqual([0]);
    expect(countDigits(1000)).toEqual([4, 4, 3, 4]);
    for (const n of [1, 5, 6, 35, 500, 999, 1000]) expect(fromCountDigits(countDigits(n))).toBe(n);
    expect(() => countDigits(-1)).toThrow();
  });
});
