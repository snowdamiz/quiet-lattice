import { Random } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { SpatialHash } from './spatialHash.ts';

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

describe('SpatialHash', () => {
  it('inserts, moves and removes', () => {
    const h = new SpatialHash(100);
    h.insert(1, 0, 0, 0);
    h.insert(2, 50, 0, 0);
    h.insert(3, 250, 0, 0);
    expect(h.size).toBe(3);
    expect(sorted(h.query(0, 0, 0, 60))).toEqual([1, 2]);

    h.move(2, 1000, 1000, 1000);
    expect(h.position(2)).toEqual([1000, 1000, 1000]);
    expect(sorted(h.query(0, 0, 0, 60))).toEqual([1]);
    expect(h.query(1000, 1000, 1000, 1)).toEqual([2]);

    // a move within one cell, then a re-insert of a held id, are moves too
    h.move(1, 10, 10, 10);
    h.insert(1, 20, 20, 20);
    expect(h.size).toBe(3);
    expect(h.query(20, 20, 20, 0)).toEqual([1]);

    expect(h.remove(3)).toBe(true);
    expect(h.remove(3)).toBe(false);
    expect(h.has(3)).toBe(false);
    expect(h.query(250, 0, 0, 10)).toEqual([]);
    expect(h.size).toBe(2);
  });

  it('includes the boundary and works across cell edges and negative coordinates', () => {
    const h = new SpatialHash(10);
    h.insert(1, -0.5, 0, 0);
    h.insert(2, 0.5, 0, 0);
    h.insert(3, -10, 0, 0);
    h.insert(4, 0, 0, 10.0001);
    expect(sorted(h.query(0, 0, 0, 10))).toEqual([1, 2, 3]);
    expect(sorted(h.query(-5, 0, 0, 5))).toEqual([1, 3]);
  });

  it('answers radius queries exactly as a brute-force scan does', () => {
    const rng = new Random(7);
    const h = new SpatialHash(1500);
    const pts = new Map<number, [number, number, number]>();
    for (let id = 1; id <= 500; id++) {
      const p: [number, number, number] = [rng.float(-20_000, 20_000), rng.float(-5000, 5000), rng.float(-20_000, 20_000)];
      pts.set(id, p);
      h.insert(id, ...p);
    }
    for (let round = 0; round < 50; round++) {
      // move some, remove some, add some
      for (let k = 0; k < 20; k++) {
        const id = rng.int(1, 600);
        if (rng.next() < 0.2) {
          h.remove(id);
          pts.delete(id);
        } else {
          const p: [number, number, number] = [rng.float(-20_000, 20_000), rng.float(-5000, 5000), rng.float(-20_000, 20_000)];
          pts.set(id, p);
          h.insert(id, ...p);
        }
      }
      const c: [number, number, number] = [rng.float(-20_000, 20_000), rng.float(-5000, 5000), rng.float(-20_000, 20_000)];
      for (const r of [0, 700, 1500, 1575, 4000, 50_000]) {
        const want = [...pts].filter(([, p]) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) <= r).map(([id]) => id);
        expect(sorted(h.query(...c, r))).toEqual(sorted(want));
      }
    }
    expect(h.size).toBe(pts.size);
  });

  it('gives each id once and the right distances, even far out where cell keys wrap', () => {
    const h = new SpatialHash(500);
    const far = 1e15;
    const ids = [1, 2, 3, 4];
    h.insert(1, far, far, far);
    h.insert(2, far + 400, far, far);
    h.insert(3, -far, far, 0);
    h.insert(4, 3e9, -2e9, 1e9);
    const seen: [number, number][] = [];
    h.forEachWithin(far, far, far, 500, (id, d2) => seen.push([id, d2]));
    expect(seen.sort((a, b) => a[0] - b[0])).toEqual([
      [1, 0],
      [2, 400 * 400],
    ]);
    expect(h.query(3e9, -2e9, 1e9, 1)).toEqual([4]);
    expect(sorted(h.query(0, 0, 0, 1e16))).toEqual(ids);
  });

  it('refuses a bad cell size or a non-finite position', () => {
    expect(() => new SpatialHash(0)).toThrow(RangeError);
    const h = new SpatialHash(1);
    expect(() => h.insert(1, NaN, 0, 0)).toThrow(RangeError);
    expect(h.size).toBe(0);
  });
});
