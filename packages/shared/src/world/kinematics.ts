// Where everything in a star system is at time t (ARCHITECTURE §3), and the frames of reference built on it (§4).
//
// Every body's pose (position, orientation, velocity, angular velocity in the system's inertial frame: centred on the
// star, axes fixed) is a pure function of its description and the server's world time t, so the client and the server
// agree on every planet, moon and Waystation without streaming them. Each body is also a frame of reference whose local
// axes turn with it: an entity near it keeps its pose in those local coordinates, and changes frame by the rule here
// (setFrame), on the client and on the server alike.
//
// The arithmetic is the demo's, operation for operation (Body.update and the Waystation's own update), with the
// deterministic sin and cos of ../math/det.ts, so poses come out bit for bit the same on every machine
// (packages/shared/test/fixtures/poses-424242.json pins them). Each function has two
// forms: one on plain arrays that allocates its result (for the server and for JSON), and one that writes into three's
// math objects (`…Into`, for the client's per-frame update, where each body is its own spec and pose).
import { Matrix4, Quaternion, Vector3 } from 'three';
import { cos, setFromAxisAngle, sin } from '../math/det.ts';
import type { Quat } from './system.ts';

/** A vector as [x, y, z]. */
export type Vec3 = [number, number, number];

/** A circular orbit about a parent (OrbitSpec without the parent), its plane's tilt as R: [x, y, z, w] or three's
 * Quaternion. */
export interface Orbit<R = Quat> {
  orbitRadius: number;
  /** seconds per revolution */
  orbitPeriod: number;
  /** angle along the orbit at t = 0 */
  orbitPhase: number;
  orbitTilt: R;
}

/** An orbit and a spin: a BodySpec is one, and so is each of the client's bodies (with R = Quaternion). */
export interface Motion<R = Quat> extends Orbit<R> {
  /** seconds per turn about its own axis (0: it does not turn) */
  rotationPeriod: number;
  /** turn at t = 0 */
  rotationPhase: number;
  /** the spin axis's tilt */
  axialTilt: R;
}

/** A body's pose in the system's inertial frame: metres, a unit rotation, metres per second and radians per second
 * (the axis it turns about, scaled by its rate). */
export interface BodyPose {
  position: Vec3;
  quaternion: Quat;
  velocity: Vec3;
  angularVelocity: Vec3;
}

/** A BodyPose in three's math objects (each of the client's bodies is one). */
export interface BodyPoseObjects {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
}

/** A frame of reference: a body's position and orientation in the system's inertial frame. `null` stands for the
 * inertial frame itself. */
export type Frame = Pick<BodyPose, 'position' | 'quaternion'>;
export type FrameObjects = Pick<BodyPoseObjects, 'position' | 'quaternion'>;

/** An entity's pose in a frame's local coordinates, as it travels on the wire without its frame id (ARCHITECTURE §4).
 * Its velocity is relative to the frame. */
export interface LocalPose {
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
}

/** A LocalPose in three's math objects (the client's FrameState is one). */
export interface LocalPoseObjects {
  pos: Vector3;
  quat: Quaternion;
  vel: Vector3;
}

/** What a star system's motions are made of: a SystemDescription is one. Each body orbits the star (parent null) or a body
 * listed before it, as a planet's moons follow it. */
export interface SystemMotions {
  bodies: (Motion & { parent: number | null })[];
  station: Orbit & { parent: number };
}

/** The poses of everything in a star system at one time: `bodies` in the description's order (so bodies[i] is the frame
 * with id frameId(seed, i)). */
export interface SystemPoses {
  star: BodyPose;
  bodies: BodyPose[];
  station: BodyPose;
}

const TAU = 2 * Math.PI;
const Y = /* @__PURE__ */ new Vector3(0, 1, 0);
const _spin = /* @__PURE__ */ new Quaternion();
const _inv = /* @__PURE__ */ new Quaternion();
const _up = /* @__PURE__ */ new Vector3();
const _fwd = /* @__PURE__ */ new Vector3();
const _right = /* @__PURE__ */ new Vector3();
const _basis = /* @__PURE__ */ new Matrix4();
const _wp = /* @__PURE__ */ new Vector3();
const _wq = /* @__PURE__ */ new Quaternion();
const _wv = /* @__PURE__ */ new Vector3();

// scratch objects for the plain-array forms
function poseObjects(): BodyPoseObjects {
  return { position: new Vector3(), quaternion: new Quaternion(), velocity: new Vector3(), angularVelocity: new Vector3() };
}
const _motion: Motion<Quaternion> = /* @__PURE__ */ (() => ({
  orbitRadius: 0,
  orbitPeriod: 1,
  orbitPhase: 0,
  orbitTilt: new Quaternion(),
  rotationPeriod: 0,
  rotationPhase: 0,
  axialTilt: new Quaternion(),
}))();
const _parent = /* @__PURE__ */ poseObjects();
const _out = /* @__PURE__ */ poseObjects();
const _from = /* @__PURE__ */ (() => ({ position: new Vector3(), quaternion: new Quaternion() }))();
const _to = /* @__PURE__ */ (() => ({ position: new Vector3(), quaternion: new Quaternion() }))();
const _local = /* @__PURE__ */ (() => ({ pos: new Vector3(), quat: new Quaternion(), vel: new Vector3() }))();
const _v = /* @__PURE__ */ new Vector3();

/** The angle along an orbit, or about a spin axis, at time t. */
function angle(phase: number, period: number, t: number): number {
  return phase + (TAU * t) / period;
}

// Position and velocity on a circular orbit about `parent`.
function orbitInto(o: Orbit<Quaternion>, t: number, parent: Pick<BodyPoseObjects, 'position' | 'velocity'>, out: BodyPoseObjects) {
  const th = angle(o.orbitPhase, o.orbitPeriod, t);
  if (o.orbitRadius === 0) out.position.set(0, 0, 0);
  else out.position.set(cos(th) * o.orbitRadius, 0, sin(th) * o.orbitRadius).applyQuaternion(o.orbitTilt);
  out.position.add(parent.position);
  const w = TAU / o.orbitPeriod;
  out.velocity
    .set(-sin(th) * o.orbitRadius * w, 0, cos(th) * o.orbitRadius * w)
    .applyQuaternion(o.orbitTilt)
    .add(parent.velocity);
}

/** Writes into `out` the pose at time t of a body moving as `m` about `parent`: its orbit, then its turn about its
 * tilted axis. With no parent it rests at the system's centre (the star). */
export function bodyPoseInto<T extends BodyPoseObjects>(
  m: Motion<Quaternion>,
  t: number,
  parent: Pick<BodyPoseObjects, 'position' | 'velocity'> | null,
  out: T,
): T {
  if (parent) orbitInto(m, t, parent, out);
  else {
    out.position.set(0, 0, 0);
    out.velocity.set(0, 0, 0);
  }
  if (m.rotationPeriod) {
    setFromAxisAngle(_spin, Y, angle(m.rotationPhase, m.rotationPeriod, t));
    out.quaternion.copy(m.axialTilt).multiply(_spin);
    // (it turns about its tilted axis, wherever along its orbit it is)
    out.angularVelocity
      .copy(Y)
      .applyQuaternion(m.axialTilt)
      .multiplyScalar(TAU / m.rotationPeriod);
  } else {
    out.quaternion.copy(m.axialTilt);
    out.angularVelocity.set(0, 0, 0);
  }
  return out;
}

/** Writes into `out` the pose at time t of a Waystation on orbit `o` about `parent`. It keeps its floor (local +Y) facing
 * away from its world and its hangar mouth (local +Z) along its orbit, so it turns once per revolution. (Its velocity is
 * its orbit's plus its world's, as for any body; the demo gave it only its world's, which nothing read.) */
export function stationPoseInto<T extends BodyPoseObjects>(o: Orbit<Quaternion>, t: number, parent: Pick<BodyPoseObjects, 'position' | 'velocity'>, out: T): T {
  orbitInto(o, t, parent, out);
  const up = _up.copy(out.position).sub(parent.position).normalize();
  const th = angle(o.orbitPhase, o.orbitPeriod, t);
  const along = _fwd.set(-sin(th), 0, cos(th)).applyQuaternion(o.orbitTilt);
  const fwd = along.addScaledVector(up, -along.dot(up)).normalize();
  const right = _right.crossVectors(up, fwd).normalize();
  _basis.makeBasis(right, up, fwd);
  out.quaternion.setFromRotationMatrix(_basis);
  // (about the orbit's normal: up × along points down the tilted Y axis)
  out.angularVelocity
    .set(0, -1, 0)
    .applyQuaternion(o.orbitTilt)
    .multiplyScalar(TAU / o.orbitPeriod);
  return out;
}

function fromArrays(src: BodyPose, out: BodyPoseObjects): BodyPoseObjects {
  out.position.fromArray(src.position);
  out.quaternion.fromArray(src.quaternion);
  out.velocity.fromArray(src.velocity);
  out.angularVelocity.fromArray(src.angularVelocity);
  return out;
}

function toArrays(src: BodyPoseObjects): BodyPose {
  return {
    position: src.position.toArray(),
    quaternion: src.quaternion.toArray(),
    velocity: src.velocity.toArray(),
    angularVelocity: src.angularVelocity.toArray(),
  };
}

function orbitObjects(o: Orbit, out: Orbit<Quaternion>) {
  out.orbitRadius = o.orbitRadius;
  out.orbitPeriod = o.orbitPeriod;
  out.orbitPhase = o.orbitPhase;
  out.orbitTilt.fromArray(o.orbitTilt);
}

/** The star's pose: at rest at the system's centre, unturned. */
export function starPose(): BodyPose {
  return { position: [0, 0, 0], quaternion: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
}

/** The pose at time t of a body moving as `m` (a BodySpec) about the body whose pose is `parent`. Without one it orbits the
 * star, so a body whose spec names a parent body (a moon) must be given that body's pose. */
export function bodyPose(m: Motion & { parent?: number | null }, t: number, parent?: BodyPose): BodyPose {
  if (!parent && m.parent != null) throw new RangeError(`a body orbiting body ${m.parent} needs that body's pose`);
  parent ??= starPose();
  orbitObjects(m, _motion);
  _motion.rotationPeriod = m.rotationPeriod;
  _motion.rotationPhase = m.rotationPhase;
  _motion.axialTilt.fromArray(m.axialTilt);
  return toArrays(bodyPoseInto(_motion, t, fromArrays(parent, _parent), _out));
}

/** The pose at time t of a Waystation on orbit `o` (a StationSpec) about the body whose pose is `parent`. */
export function stationPose(o: Orbit, t: number, parent: BodyPose): BodyPose {
  orbitObjects(o, _motion);
  return toArrays(stationPoseInto(_motion, t, fromArrays(parent, _parent), _out));
}

/** The poses of a system's star, planets and moons, and Waystation at time t. */
export function systemPoses(d: SystemMotions, t: number): SystemPoses {
  const star = starPose();
  const bodies: BodyPose[] = [];
  for (const b of d.bodies) {
    const parent = b.parent === null ? star : bodies[b.parent];
    if (!parent) throw new RangeError(`body ${bodies.length} orbits body ${b.parent}, which does not come before it`);
    bodies.push(bodyPose(b, t, parent));
  }
  const parent = bodies[d.station.parent];
  if (!parent) throw new RangeError(`the station orbits body ${d.station.parent}, which is not in the system`);
  return { star, bodies, station: stationPose(d.station, t, parent) };
}

// Frames of reference. A null frame is the system's inertial frame, where local and world coordinates are the same.

/** Writes into `out` the world position of `local`, a position in `frame`'s local coordinates. */
export function localToWorldInto(frame: FrameObjects | null, local: Vector3, out: Vector3): Vector3 {
  return frame ? out.copy(local).applyQuaternion(frame.quaternion).add(frame.position) : out.copy(local);
}

/** Writes into `out` the position in `frame`'s local coordinates of `world`, a world position. */
export function worldToLocalInto(frame: FrameObjects | null, world: Vector3, out: Vector3): Vector3 {
  return frame ? out.copy(world).sub(frame.position).applyQuaternion(_inv.copy(frame.quaternion).invert()) : out.copy(world);
}

/** Writes into `out` the world direction of `local`, a direction (or velocity) in `frame`'s local axes. */
export function dirToWorldInto(frame: FrameObjects | null, local: Vector3, out: Vector3): Vector3 {
  return frame ? out.copy(local).applyQuaternion(frame.quaternion) : out.copy(local);
}

/** Writes into `out` the direction in `frame`'s local axes of `world`, a world direction (or velocity). */
export function dirToLocalInto(frame: FrameObjects | null, world: Vector3, out: Vector3): Vector3 {
  return frame ? out.copy(world).applyQuaternion(_inv.copy(frame.quaternion).invert()) : out.copy(world);
}

/** Re-expresses `state`, kept in frame `from`, in frame `to`, in place: the same world position and orientation. Its
 * velocity is taken as relative to the frame it is in (the arcade flight model): it is turned into the new frame's axes,
 * never boosted by either frame's own motion. */
export function setFrameInto<T extends LocalPoseObjects>(state: T, from: FrameObjects | null, to: FrameObjects | null): T {
  const wp = localToWorldInto(from, state.pos, _wp);
  const wq = from ? _wq.copy(from.quaternion).multiply(state.quat) : _wq.copy(state.quat);
  const wv = dirToWorldInto(from, state.vel, _wv);
  worldToLocalInto(to, wp, state.pos);
  if (to) state.quat.copy(_inv.copy(to.quaternion).invert()).multiply(wq);
  else state.quat.copy(wq);
  dirToLocalInto(to, wv, state.vel);
  return state;
}

function frameObjects(frame: Frame | null, out: FrameObjects): FrameObjects | null {
  if (!frame) return null;
  out.position.fromArray(frame.position);
  out.quaternion.fromArray(frame.quaternion);
  return out;
}

/** The world position of `local`, a position in `frame`'s local coordinates. */
export function localToWorld(frame: Frame | null, local: Vec3): Vec3 {
  return localToWorldInto(frameObjects(frame, _from), _v.fromArray(local), _v).toArray();
}

/** The position in `frame`'s local coordinates of `world`, a world position. */
export function worldToLocal(frame: Frame | null, world: Vec3): Vec3 {
  return worldToLocalInto(frameObjects(frame, _from), _v.fromArray(world), _v).toArray();
}

/** The world direction of `local`, a direction (or velocity) in `frame`'s local axes. */
export function dirToWorld(frame: Frame | null, local: Vec3): Vec3 {
  return dirToWorldInto(frameObjects(frame, _from), _v.fromArray(local), _v).toArray();
}

/** The direction in `frame`'s local axes of `world`, a world direction (or velocity). */
export function dirToLocal(frame: Frame | null, world: Vec3): Vec3 {
  return dirToLocalInto(frameObjects(frame, _from), _v.fromArray(world), _v).toArray();
}

/** `state`, kept in frame `from`, re-expressed in frame `to` (setFrameInto's rule: the same world position and
 * orientation, the velocity turned and never boosted). */
export function setFrame(state: LocalPose, from: Frame | null, to: Frame | null): LocalPose {
  _local.pos.fromArray(state.pos);
  _local.quat.fromArray(state.quat);
  _local.vel.fromArray(state.vel);
  setFrameInto(_local, frameObjects(from, _from), frameObjects(to, _to));
  return { pos: _local.pos.toArray(), quat: _local.quat.toArray(), vel: _local.vel.toArray() };
}
