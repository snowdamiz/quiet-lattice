import { Random } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { CELL_M, CellGrid, faceDir, facePoint, type FacePoint, type Vec3 } from './cells.ts';

const R = 113_164;
const rng = new Random(11);
const randomDir = (): Vec3 => {
  const v: Vec3 = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const chord = (a: Readonly<Vec3>, b: Readonly<Vec3>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('cells', () => {
  const grid = new CellGrid(R);

  it('map a direction to its face angles and back', () => {
    const fp: FacePoint = { face: 0, a: 0, b: 0 };
    for (let i = 0; i < 500; i++) {
      const d = randomDir();
      const p = facePoint(d[0] * 7, d[1] * 7, d[2] * 7, fp);
      expect(Math.abs(p.a)).toBeLessThanOrEqual(Math.PI / 4 + 1e-12);
      expect(Math.abs(p.b)).toBeLessThanOrEqual(Math.PI / 4 + 1e-12);
      expect(chord(faceDir(p.face, p.a, p.b), d)).toBeLessThan(1e-12);
    }
  });

  it('put every direction in the cell whose bounds hold it, and the cell centre in its own cell', () => {
    for (let i = 0; i < 500; i++) {
      const d = randomDir();
      const key = grid.keyOf(...d);
      const { face, i: ci, j } = grid.parts(key);
      expect(grid.key(face, ci, j)).toBe(key);
      expect(grid.keyOf(...grid.center(key))).toBe(key);
      // the direction lies within half a cell diagonal of its centre
      expect(chord(grid.center(key), d) * R).toBeLessThan(CELL_M * 1.2);
    }
  });

  it('are about CELL_M across everywhere (an equal-angle cube map)', () => {
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < 300; i++) {
      const key = grid.keyOf(...randomDir());
      const side = chord(grid.dirIn(key, 0, 0.5), grid.dirIn(key, 1, 0.5)) * R;
      lo = Math.min(lo, side);
      hi = Math.max(hi, side);
    }
    expect(lo).toBeGreaterThan(CELL_M * 0.7);
    expect(hi).toBeLessThan(CELL_M * 1.3);
  });

  it('list every cell near a point, across cube edges and corners', () => {
    const corner: Vec3 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
    const edge: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0];
    for (const at of [randomDir(), [1, 0, 0] as Vec3, corner, edge]) {
      const found = new Set<number>();
      grid.cellsNear(at, 400, (k) => {
        expect(found.has(k)).toBe(false);
        found.add(k);
      });
      // every point within 400 m falls in a listed cell
      for (let i = 0; i < 300; i++) {
        const d = randomDir();
        const near: Vec3 = [at[0] + (d[0] * rng.float(0, 390)) / R, at[1] + (d[1] * rng.float(0, 390)) / R, at[2] + (d[2] * rng.float(0, 390)) / R];
        expect(found.has(grid.keyOf(...near))).toBe(true);
      }
      // at a corner three faces meet, at a face's centre one
      if (at === corner) expect(new Set([...found].map((k) => grid.parts(k).face)).size).toBe(3);
      if (at === edge) expect(new Set([...found].map((k) => grid.parts(k).face)).size).toBe(2);
      if (at[0] === 1) expect(new Set([...found].map((k) => grid.parts(k).face)).size).toBe(1);
    }
  });

  it('are the same for every world of a radius', () => {
    expect(new CellGrid(R).keyOf(0.3, 0.4, 0.5)).toBe(grid.keyOf(0.3, 0.4, 0.5));
    expect(new CellGrid(R).n).toBe(Math.round(((Math.PI / 2) * R) / CELL_M));
  });
});
