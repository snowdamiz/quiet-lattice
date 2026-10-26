import { describe, expect, it } from 'vitest';
import { Random, hashInts, hashString, makeName, mulberry32, romanNumeral } from './rng.js';

describe('rng', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(424242);
    const b = mulberry32(424242);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('hashes are stable', () => {
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3));
    expect(hashInts(1, 2, 3)).not.toBe(hashInts(3, 2, 1));
    expect(hashString('Orxa')).toBe(hashString('Orxa'));
  });

  it('Random.int covers its inclusive range', () => {
    const r = new Random(7);
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('names and numerals', () => {
    expect(makeName(new Random(1))).toBe(makeName(new Random(1)));
    expect(romanNumeral(9)).toBe('IX');
    expect(romanNumeral(14)).toBe('XIV');
  });
});
