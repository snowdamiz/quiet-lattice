// The cells herds live in (P1.E08.T01): a world's surface cut into cells of about CELL_M a side, the same cells every
// time for a world of that radius, so a cell's herd can be planned from the world's seed and the cell alone. Each of the
// six cube faces (the terrain's own, planetgen FACES) is split into n × n cells equal in angle (an equi-angular cube
// map: a direction's two face coordinates are angles, atan(u) and atan(v)), which keeps every cell within about 1.4× of
// the others' area instead of the plain cube map's 5×. Server-only arithmetic: nothing here is compared with a client.
import { FACES } from '@astra/shared/world';

export type Vec3 = [number, number, number];

/** A cell's side, metres (about: a cell's size varies a little over a face). */
export const CELL_M = 250;

const QUARTER = Math.PI / 4;

/** Where a direction falls on the cube: its face and its two angles across it (each −π/4 to π/4). */
export interface FacePoint {
  face: number;
  a: number;
  b: number;
}

/** The face and angles of a direction (any length but zero). Writes into `out`. */
export function facePoint(x: number, y: number, z: number, out: FacePoint): FacePoint {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  const face = ax >= ay && ax >= az ? (x > 0 ? 0 : 1) : ay >= az ? (y > 0 ? 2 : 3) : z > 0 ? 4 : 5;
  const F = FACES[face]!;
  const dn = x * F.n[0] + y * F.n[1] + z * F.n[2];
  out.face = face;
  out.a = Math.atan((x * F.a[0] + y * F.a[1] + z * F.a[2]) / dn);
  out.b = Math.atan((x * F.b[0] + y * F.b[1] + z * F.b[2]) / dn);
  return out;
}

/** The unit direction at angles (a, b) on a face. */
export function faceDir(face: number, a: number, b: number): Vec3 {
  const F = FACES[face]!;
  const u = Math.tan(a);
  const v = Math.tan(b);
  const x = F.n[0] + F.a[0] * u + F.b[0] * v;
  const y = F.n[1] + F.a[1] * u + F.b[1] * v;
  const z = F.n[2] + F.a[2] * u + F.b[2] * v;
  const l = Math.sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
}

/** A world's cells. Keys are integers: (face × n + i) × n + j. */
export class CellGrid {
  /** cells along a face's edge */
  readonly n: number;
  /** angle a cell spans along each axis */
  readonly step: number;
  private readonly fp: FacePoint = { face: 0, a: 0, b: 0 };

  constructor(readonly radius: number) {
    this.n = Math.max(1, Math.round((Math.PI / 2) * (radius / CELL_M)));
    this.step = Math.PI / 2 / this.n;
  }

  /** The cell a direction (any length but zero) falls in. */
  keyOf(x: number, y: number, z: number): number {
    const p = facePoint(x, y, z, this.fp);
    return this.key(p.face, this.index(p.a), this.index(p.b));
  }

  key(face: number, i: number, j: number): number {
    return (face * this.n + i) * this.n + j;
  }

  /** The face and indices of a key. */
  parts(key: number): { face: number; i: number; j: number } {
    const j = key % this.n;
    const rest = (key - j) / this.n;
    const i = rest % this.n;
    return { face: (rest - i) / this.n, i, j };
  }

  /** The angle at the start of cell index `i` along a face. */
  start(i: number): number {
    return -QUARTER + i * this.step;
  }

  /** A cell's index along a face for an angle (clamped onto the face). */
  index(angle: number): number {
    return Math.min(this.n - 1, Math.max(0, Math.floor((angle + QUARTER) / this.step)));
  }

  /** The unit direction at fractions (s, t) across a cell (0.5, 0.5 is its centre). */
  dirIn(key: number, s: number, t: number): Vec3 {
    const { face, i, j } = this.parts(key);
    return faceDir(face, this.start(i) + s * this.step, this.start(j) + t * this.step);
  }

  center(key: number): Vec3 {
    return this.dirIn(key, 0.5, 0.5);
  }

  /** Every cell that comes within `radius` metres (along the surface, about) of a surface direction, and a few beyond:
   * samples a lattice of points half a cell apart over the disc grown by a cell, which no cell (at least 0.7 cells across)
   * slips between. Calls `visit` once per cell; callers keep those whose centres are near enough. */
  cellsNear(dir: Readonly<Vec3>, radius: number, visit: (key: number) => void): void {
    const [ux, uy, uz] = dir;
    // two tangents
    let tx: number, ty: number, tz: number;
    if (Math.abs(uy) < 0.9) [tx, ty, tz] = [uz, 0, -ux];
    else [tx, ty, tz] = [0, -uz, uy];
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = uy * tz - uz * ty;
    const by = uz * tx - ux * tz;
    const bz = ux * ty - uy * tx;
    const seen = new Set<number>();
    const stepM = (this.step * this.radius) / 2;
    const reach = radius + 2 * stepM;
    const k = Math.ceil(reach / stepM);
    for (let p = -k; p <= k; p++) {
      for (let q = -k; q <= k; q++) {
        const s = p * stepM;
        const t = q * stepM;
        if (s * s + t * t > reach * reach) continue;
        const ang = 1 / this.radius;
        const key = this.keyOf(ux + (tx * s + bx * t) * ang, uy + (ty * s + by * t) * ang, uz + (tz * s + bz * t) * ang);
        if (seen.has(key)) continue;
        seen.add(key);
        visit(key);
      }
    }
  }
}
