// Frames of reference at any world time, for remote entities (docs/ARCHITECTURE.md §4, §9 "Remote entities"). The client's
// bodies stand where game.time puts them; a remote entity's buffered poses were taken at the server's tick times, so a
// pose re-expressed from one frame into another must use both frames as they stood when the pose was taken, by the
// shared kinematics' rule (setFrameInto: the same world position and orientation, the velocity turned, never boosted).
import * as THREE from 'three';
import { bodyPoseInto, setFrameInto, stationPoseInto } from '@astra/shared/world';

const pose = () => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() });
// a frame's parents by depth (a moon's planet, then the star; a Waystation's world, then the star)
const PARENTS = [pose(), pose(), pose(), pose()];
const _from = pose();
const _to = pose();

/** Writes into `out` the pose at world time `t` of `frame`, one of the client's bodies (a planet, a moon, the star) or its
 * Waystation, without moving the body itself. */
export function framePoseAt(frame, t, out, depth = 0) {
  const parent = frame.parent ? framePoseAt(frame.parent, t, PARENTS[depth], depth + 1) : null;
  return frame.kind === 'station' ? stationPoseInto(frame, t, parent, out) : bodyPoseInto(frame, t, parent, out);
}

/** Re-expresses `state` ({pos, quat, vel} in three's objects), a pose taken at world time `t` in frame `from`, in frame
 * `to` (null: the system's inertial frame), in place. */
export function reframeAt(state, from, to, t) {
  if (from === to) return state;
  return setFrameInto(state, from ? framePoseAt(from, t, _from) : null, to ? framePoseAt(to, t, _to) : null);
}
