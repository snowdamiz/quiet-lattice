// Cover (DESIGN 10.1): inside an asteroid belt or a planetary ring a ship's signature halves. Pure volume tests on a system's
// description, so the client and the server agree on where cover is.
//
// Nebulae are not cover anywhere yet: the only nebulae the world has are the sky's billboards hundreds of light years beyond
// the cluster (cosmos.ts), not volumes a system or a fight sits in.
import { Quaternion, Vector3 } from 'three';
import { hypot2, hypot3 } from '../math/det.ts';
import type { Frame, FrameObjects, Vec3 } from './kinematics.ts';
import type { BeltSpec, BodySpec, SystemDescription } from './system.ts';

/** Half the thickness of a planetary ring's volume, m. The rings are drawn as a flat sheet in the planet's equatorial plane;
 * a ship this close to that plane, between the ring's inner and outer edge, flies in it. */
export const RING_HALF_THICKNESS = 2000;

/** The belt's field keeps this many radii clear of every planet and moon (Asteroids.densityAt): where one crosses the belt,
 * the space round it is open. */
export const BELT_BODY_CLEARANCE = 2.2;

/** What a point is hidden in. */
export type Cover = 'belt' | 'ring';

/**
 * Whether a point in the system's inertial frame (metres from the star, the system's plane being y = 0) lies in its asteroid
 * belt: within the belt's half-width of its mid radius and its half-thickness of the plane, where the client's asteroid field
 * is dense (Asteroids.densityAt). A described belt lies between two planets' orbits, so its width is positive (P1.E02.T09);
 * a belt given with a negative one is taken as |width| wide.
 */
export function inBelt(belt: BeltSpec, p: Vec3): boolean {
  return beltHas(belt, p[0], p[1], p[2]);
}

function beltHas(belt: BeltSpec, x: number, y: number, z: number): boolean {
  return Math.abs(hypot2(x, z) - belt.radius) < Math.abs(belt.width) && Math.abs(y) < belt.thickness;
}

/** Whether a point in a body's own frame (its local coordinates, which turn with it) lies in its rings: in the equatorial
 * plane (local y = 0) within `RING_HALF_THICKNESS`, between the inner and outer edge. A body without rings has none. */
export function inRings(body: Pick<BodySpec, 'radius' | 'rings'>, local: Vec3): boolean {
  return ringsHave(body, local[0], local[1], local[2]);
}

function ringsHave(body: Pick<BodySpec, 'radius' | 'rings'>, x: number, y: number, z: number): boolean {
  const r = body.rings;
  if (!r || Math.abs(y) > RING_HALF_THICKNESS) return false;
  const d = hypot2(x, z);
  return d >= r.inner * body.radius && d <= r.outer * body.radius;
}

const _p = /* @__PURE__ */ new Vector3();
const _q = /* @__PURE__ */ new Quaternion();
const _v = /* @__PURE__ */ new Vector3();

type CoverSystem = Pick<SystemDescription, 'belt' | 'bodies'>;

// a body's pose, from either form, into _p and _q
function poseOfArrays(bodies: readonly Frame[], i: number): void {
  _p.fromArray(bodies[i].position);
  _q.fromArray(bodies[i].quaternion);
}
function poseOfObjects(bodies: readonly FrameObjects[], i: number): void {
  _p.copy(bodies[i].position);
  _q.copy(bodies[i].quaternion);
}

function coverOf<B>(d: CoverSystem, bodies: readonly B[], pose: (bodies: readonly B[], i: number) => void, x: number, y: number, z: number): Cover | null {
  if (beltHas(d.belt, x, y, z)) {
    let clear = true;
    for (const b of d.bodies) {
      pose(bodies, b.index);
      if (hypot3(x - _p.x, y - _p.y, z - _p.z) < b.radius * BELT_BODY_CLEARANCE) {
        clear = false;
        break;
      }
    }
    if (clear) return 'belt';
  }
  for (const b of d.bodies) {
    if (!b.rings) continue;
    pose(bodies, b.index);
    // the point in the body's frame
    _v.set(x - _p.x, y - _p.y, z - _p.z).applyQuaternion(_q.invert());
    if (ringsHave(b, _v.x, _v.y, _v.z)) return 'ring';
  }
  return null;
}

/**
 * The cover a point in the system's inertial frame is in, or null. `bodies[i]` poses the description's body i at the moment
 * asked about (`systemPoses(d, t).bodies`). The belt counts where its field is: in its volume (`inBelt`) and clear of every
 * body by BELT_BODY_CLEARANCE; then any ring.
 */
export function coverAt(d: CoverSystem, bodies: readonly Frame[], world: Vec3): Cover | null {
  return coverOf(d, bodies, poseOfArrays, world[0], world[1], world[2]);
}

/** coverAt on three's math objects: `bodies` are the client's own (each a FrameObjects, in the description's order), read
 * in place. */
export function coverAtObjects(d: CoverSystem, bodies: readonly FrameObjects[], world: Vector3): Cover | null {
  return coverOf(d, bodies, poseOfObjects, world.x, world.y, world.z);
}
