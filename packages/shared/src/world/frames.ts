// Which frame of reference an entity belongs in, and its pose as the wire carries it (ARCHITECTURE §4).
//
// An entity keeps its pose in the frame of the innermost body whose sphere of influence holds it: the Waystation's, else
// a moon's or a planet's (the smallest sphere), else the system's inertial frame. selectFrame is the one rule for picking
// it, with 5% of hysteresis so that an entity at a sphere's edge does not flip between frames every step: the client's
// Game.chooseFrame calls it on its bodies, and the server's zones on their poses at the tick's time, and both change
// frame by setFrame (kinematics.ts). On the wire a frame is its frame id (frameId in system.ts); the helpers at the end
// move poses between the protocol's shape (a frame id and arrays) and the shapes the kinematics work on.
import { localToWorld, setFrame, type BodyPose, type LocalPose, type LocalPoseObjects, type SystemPoses, type Vec3 } from './kinematics.ts';
import { frameId } from './system.ts';

/** An entity stays in its frame until it is this factor beyond the frame's sphere of influence. */
export const FRAME_HYSTERESIS = 1.05;

/** What frame selection needs of a frame of reference: the reach of its sphere of influence, from its centre (a BodySpec,
 * a StationSpec and each of the client's bodies have one). */
export interface FrameSphere {
  readonly soi: number;
}

/** The frames of a star system an entity can be in besides the inertial frame: its planets and moons, and its Waystation. */
export interface FrameSet<F extends FrameSphere> {
  readonly bodies: readonly F[];
  readonly station: F;
}

/** The innermost frame whose sphere of influence holds the entity `distance` measures from: the Waystation's, else the
 * planet's or moon's with the smallest sphere, else null (the inertial frame). */
export function innermostFrame<F extends FrameSphere>(frames: FrameSet<F>, distance: (frame: F) => number): F | null {
  if (distance(frames.station) < frames.station.soi) return frames.station;
  let best: F | null = null;
  for (const b of frames.bodies) if (distance(b) < b.soi && (!best || b.soi < best.soi)) best = b;
  return best;
}

/**
 * The frame an entity belongs in, given the frame it is in (`current`, null for the inertial frame) and `distance`, its
 * distance from a frame's centre. It stays in its frame until it is 5% beyond the frame's sphere of influence, unless a
 * smaller sphere inside it holds the entity (the Waystation's in its world's, a moon's in its planet's); out of its
 * frame, it takes the innermost one that holds it. The client and the server's zones pick frames by this rule alone.
 */
export function selectFrame<F extends FrameSphere>(frames: FrameSet<F>, current: F | null, distance: (frame: F) => number): F | null {
  if (current && distance(current) < current.soi * FRAME_HYSTERESIS) {
    const inner = innermostFrame(frames, distance);
    return inner && inner !== current && inner.soi < current.soi ? inner : current;
  }
  return innermostFrame(frames, distance);
}

/** How far world position `world` is from a frame's centre, worked out as three's Vector3 does it (the client's
 * Body.distanceTo), so that both ends hold the same number against a sphere of influence. */
export function frameDistance(frame: { readonly position: Readonly<Vec3> }, world: Readonly<Vec3>): number {
  const x = world[0] - frame.position[0];
  const y = world[1] - frame.position[1];
  const z = world[2] - frame.position[2];
  return Math.sqrt(x * x + y * y + z * z);
}

/** A frame of a star system by what it is: a planet or moon by its index in the description (its frame id's body index),
 * the Waystation, or null for the inertial frame. */
export type FrameKey = number | 'station' | null;

/** What frame selection reads of a star system: a SystemDescription is one. */
export interface FrameSystem {
  readonly seed: number;
  readonly bodies: readonly FrameSphere[];
  readonly station: FrameSphere;
}

/** The pose of frame `key` at the time `poses` were taken (null for the inertial frame). */
export function framePose(poses: SystemPoses, key: FrameKey): BodyPose | null {
  if (key === null) return null;
  const p = key === 'station' ? poses.station : poses.bodies[key];
  if (!p) throw new RangeError(`no body ${key} in the system`);
  return p;
}

/** The frame an entity at world position `world` belongs in at the time `poses` were taken, given the frame it is in:
 * selectFrame over system d's planets, moons and Waystation. */
export function chooseFrame(d: Omit<FrameSystem, 'seed'>, poses: SystemPoses, world: Readonly<Vec3>, current: FrameKey): FrameKey {
  interface Keyed extends FrameSphere {
    key: number | 'station';
    position: Vec3;
  }
  const bodies: Keyed[] = d.bodies.map((b, i) => ({ key: i, soi: b.soi, position: framePose(poses, i)!.position }));
  const station: Keyed = { key: 'station', soi: d.station.soi, position: poses.station.position };
  const cur = current === null ? null : current === 'station' ? station : bodies[current];
  if (cur === undefined) throw new RangeError(`no body ${current} in the system`);
  return selectFrame({ bodies, station }, cur, (f) => frameDistance(f, world))?.key ?? null;
}

// ---------- poses on the wire ----------

/** A pose as the wire carries it (the protocol's Pose): the id of its frame (null for the inertial frame) and the
 * entity's LocalPose in that frame. */
export interface FramedPose extends LocalPose {
  frame: string | null;
}

/** The frame id of frame `key` of the system generated from `seed` (null for the inertial frame). */
export function frameIdOf(seed: number, key: FrameKey): string | null {
  return key === null ? null : frameId(seed, key);
}

/** The frame that frame id `id` names in system d (null for the inertial frame), or undefined when it names none of
 * d's frames: another system's, a body d does not have, or no frame at all. */
export function frameKeyOf(d: Pick<FrameSystem, 'seed' | 'bodies'>, id: string | null): FrameKey | undefined {
  if (id === null) return null;
  const m = /^(\d{1,10}):(\d{1,3}|station)$/.exec(id);
  if (!m || Number(m[1]) !== d.seed) return undefined;
  const key = m[2] === 'station' ? 'station' : Number(m[2]);
  if (key !== 'station' && key >= d.bodies.length) return undefined;
  // (the one spelling of the id: no leading zeros)
  return frameIdOf(d.seed, key) === id ? key : undefined;
}

/** Writes a wire pose's position, orientation and velocity into three's objects, as the client's FrameState keeps
 * them (its frame id is the caller's to resolve, with frameKeyOf). */
export function localPoseInto<T extends LocalPoseObjects>(p: LocalPose, out: T): T {
  out.pos.fromArray(p.pos);
  out.quat.fromArray(p.quat);
  out.vel.fromArray(p.vel);
  return out;
}

/** A state kept in three's objects (the client's FrameState) as a wire pose in the frame with id `frame`. */
export function framedPose(frame: string | null, state: LocalPoseObjects): FramedPose {
  return { frame, pos: state.pos.toArray(), quat: state.quat.toArray(), vel: state.vel.toArray() };
}

function keyOf(d: Pick<FrameSystem, 'seed' | 'bodies'>, id: string | null): FrameKey {
  const key = frameKeyOf(d, id);
  if (key === undefined) throw new RangeError(`frame ${id} is not in system ${d.seed}`);
  return key;
}

/** Wire pose `p`, in one of system d's frames, re-expressed in frame `to` at the time `poses` were taken: setFrame's
 * rule (the same world position and orientation, its velocity turned and never boosted) under `to`'s frame id. With `to`
 * null it is the entity's pose in the inertial frame. Throws for a frame d does not have. */
export function reframe(d: Pick<FrameSystem, 'seed' | 'bodies'>, poses: SystemPoses, p: FramedPose, to: FrameKey): FramedPose {
  const from = keyOf(d, p.frame);
  return { frame: frameIdOf(d.seed, to), ...setFrame(p, framePose(poses, from), framePose(poses, to)) };
}

/** Wire pose `p` in the frame it belongs in at the time `poses` were taken (chooseFrame, then reframe), as a zone keeps
 * its entities; `p` itself when it stays in its frame. Throws for a frame system d does not have. */
export function settleFrame(d: FrameSystem, poses: SystemPoses, p: FramedPose): FramedPose {
  const from = keyOf(d, p.frame);
  const to = chooseFrame(d, poses, localToWorld(framePose(poses, from), p.pos), from);
  return to === from ? p : reframe(d, poses, p, to);
}
