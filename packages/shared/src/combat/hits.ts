// Hit shapes (DESIGN 12.1): ground abilities resolve as rays, cones or spheres against mob hit radii. Points are plain
// [x, y, z] arrays in one frame, so the server can pass protocol poses straight in. Every test returns its hits nearest
// first (ties keep the input order) and treats a target whose sphere holds the origin as hit at distance 0. Comparisons
// are written so a NaN position misses instead of hitting.
import { getSkillNode } from '../data/index.ts';

export type V3 = readonly [number, number, number];

/** Something that can be hit: a sphere. The server's own entity types pass through to the hits. */
export interface HitTarget {
  readonly pos: V3;
  /** Hit radius in metres, ≥ 0 (0 is a point). */
  readonly radius: number;
}

export interface Hit<T extends HitTarget> {
  readonly target: T;
  /** Metres from the origin to where the shape first meets the target: along the ray for a ray, to the target's nearest
   * surface for a cone or a sphere; 0 when the target holds the origin. */
  readonly distance: number;
}

export type HitShape =
  | { readonly kind: 'ray'; readonly range: number }
  | { readonly kind: 'cone'; readonly halfAngleDeg: number; readonly range: number }
  | { readonly kind: 'sphere'; readonly radius: number };

/** Where a shape is cast from: the origin (a sphere's centre) and the aim (unused by a sphere). */
export interface Aim {
  readonly origin: V3;
  readonly dir?: V3;
}

function checkPoint(p: V3, name: string): void {
  if (!p.every(Number.isFinite)) throw new RangeError(`${name} must be finite, got [${p.join(', ')}]`);
}

function checkLength(x: number, name: string): void {
  if (!Number.isFinite(x) || x < 0) throw new RangeError(`${name} must be a finite number ≥ 0, got ${x}`);
}

/** The unit vector along a direction; a zero, tiny or non-finite direction throws (the protocol never sends one). */
function unit(dir: V3 | undefined): V3 {
  if (!dir) throw new RangeError('a ray or cone needs an aim direction');
  checkPoint(dir, 'direction');
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 1e-9)) throw new RangeError('direction must be non-zero');
  return [dir[0] / len, dir[1] / len, dir[2] / len];
}

function radiusOf(t: HitTarget): number {
  checkLength(t.radius, 'hit radius');
  return t.radius;
}

function nearestFirst<T extends HitTarget>(hits: Hit<T>[]): Hit<T>[] {
  return hits.sort((a, b) => a.distance - b.distance);
}

/** Targets a ray from `origin` along `dir` meets within `range` metres (inclusive). */
export function rayHits<T extends HitTarget>(origin: V3, dir: V3, range: number, targets: readonly T[]): Hit<T>[] {
  checkPoint(origin, 'origin');
  checkLength(range, 'range');
  const [dx, dy, dz] = unit(dir);
  const hits: Hit<T>[] = [];
  for (const target of targets) {
    const r = radiusOf(target);
    const mx = target.pos[0] - origin[0];
    const my = target.pos[1] - origin[1];
    const mz = target.pos[2] - origin[2];
    const m2 = mx * mx + my * my + mz * mz;
    if (m2 <= r * r) {
      hits.push({ target, distance: 0 });
      continue;
    }
    const along = mx * dx + my * dy + mz * dz;
    if (!(along > 0)) continue; // centre behind the origin, and the origin is outside: the ray moves away
    const miss2 = m2 - along * along; // squared distance from the centre to the ray's line
    if (!(miss2 <= r * r)) continue;
    const entry = along - Math.sqrt(r * r - miss2);
    if (entry <= range) hits.push({ target, distance: entry });
  }
  return nearestFirst(hits);
}

/** Targets a cone from `origin` along `dir` touches: every point within `range` metres whose angle from the aim is at most
 * `halfAngleDeg` (0–180), a spherical sector. A target counts when its sphere overlaps the sector anywhere. */
export function coneHits<T extends HitTarget>(origin: V3, dir: V3, halfAngleDeg: number, range: number, targets: readonly T[]): Hit<T>[] {
  checkPoint(origin, 'origin');
  checkLength(range, 'range');
  if (!(halfAngleDeg >= 0 && halfAngleDeg <= 180)) throw new RangeError(`half-angle must be 0–180°, got ${halfAngleDeg}`);
  const [dx, dy, dz] = unit(dir);
  const half = (halfAngleDeg * Math.PI) / 180;
  const hits: Hit<T>[] = [];
  for (const target of targets) {
    const r = radiusOf(target);
    const mx = target.pos[0] - origin[0];
    const my = target.pos[1] - origin[1];
    const mz = target.pos[2] - origin[2];
    const dist = Math.hypot(mx, my, mz);
    if (dist <= r) {
      hits.push({ target, distance: 0 });
      continue;
    }
    // the angle between the aim and the target's centre, from atan2 (acos loses precision near the axis)
    const along = mx * dx + my * dy + mz * dz;
    const across = Math.hypot(my * dz - mz * dy, mz * dx - mx * dz, mx * dy - my * dx);
    const off = Math.atan2(across, along) - half; // how far outside the cone's side the centre lies, in radians
    // distance from the centre to the nearest point of the sector
    let gap: number;
    if (off <= 0)
      gap = Math.max(0, dist - range); // inside the cone's angle: only the range can keep it out
    else if (off >= Math.PI / 2)
      gap = dist; // behind the cone's side: the apex is nearest
    else if (dist * Math.cos(off) <= range)
      gap = dist * Math.sin(off); // nearest the cone's side
    else gap = Math.sqrt(dist * dist + range * range - 2 * dist * range * Math.cos(off)); // nearest the rim
    if (gap <= r) hits.push({ target, distance: dist - r });
  }
  return nearestFirst(hits);
}

/** Targets whose spheres overlap a sphere of `radius` metres around `center` (touching counts). */
export function sphereHits<T extends HitTarget>(center: V3, radius: number, targets: readonly T[]): Hit<T>[] {
  checkPoint(center, 'centre');
  checkLength(radius, 'radius');
  const hits: Hit<T>[] = [];
  for (const target of targets) {
    const r = radiusOf(target);
    const dist = Math.hypot(target.pos[0] - center[0], target.pos[1] - center[1], target.pos[2] - center[2]);
    if (dist <= radius + r) hits.push({ target, distance: Math.max(0, dist - r) });
  }
  return nearestFirst(hits);
}

/** Resolves any shape. */
export function hitTest<T extends HitTarget>(shape: HitShape, aim: Aim, targets: readonly T[]): Hit<T>[] {
  switch (shape.kind) {
    case 'ray':
      return rayHits(aim.origin, unit(aim.dir), shape.range, targets);
    case 'cone':
      return coneHits(aim.origin, unit(aim.dir), shape.halfAngleDeg, shape.range, targets);
    case 'sphere':
      return sphereHits(aim.origin, shape.radius, targets);
  }
}

/** A ground active's hit shape, read from its data (DESIGN 9):
 * - a cone where it gives an angle: Flare's "60° cone" is 60° across, 30° each side of the aim, 12 m;
 * - a sphere where it gives a radius: Well 12 m, Pulse 15 m, Spore 8 m;
 * - a sphere between a min and max radius: Slam's knockdown grows with fall height from 6 to 18 m. `reach` (0–1, default 0)
 *   is how far through that span this cast is; DESIGN does not map fall heights to it, so the caller does (E07.T04);
 * - a ray where it gives only a range: Lance 30 m, Pull 25 m, Fold 30 m;
 * - otherwise the shape of the node it works through: Crush and Singularity are Well's 12 m sphere.
 * Null for nodes DESIGN gives no shape (Sear, Shatter, Drain, Unmake, Bond, Vent, Corona …) and for anything that is not
 * a ground active. Throws on an unknown node or a reach outside 0–1. */
export function shapeOfNode(nodeId: string, reach = 0): HitShape | null {
  if (!(reach >= 0 && reach <= 1)) throw new RangeError(`reach must be 0–1, got ${reach}`);
  return nodeShape(nodeId, reach, new Set());
}

function nodeShape(nodeId: string, reach: number, seen: Set<string>): HitShape | null {
  seen.add(nodeId);
  const node = getSkillNode(nodeId);
  if (node.type !== 'active' || node.slot !== 'ground') return null;
  const p = node.params;
  if (p.coneDeg !== undefined && p.rangeM !== undefined) return { kind: 'cone', halfAngleDeg: p.coneDeg / 2, range: p.rangeM };
  if (p.radiusM !== undefined) return { kind: 'sphere', radius: p.radiusM };
  if (p.minRadiusM !== undefined && p.maxRadiusM !== undefined) return { kind: 'sphere', radius: p.minRadiusM + (p.maxRadiusM - p.minRadiusM) * reach };
  if (p.rangeM !== undefined) return { kind: 'ray', range: p.rangeM };
  for (const ref of node.refs) {
    const shape = seen.has(ref) ? null : nodeShape(ref, reach, seen);
    if (shape) return shape;
  }
  return null;
}
