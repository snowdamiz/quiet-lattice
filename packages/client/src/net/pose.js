// Between the client's state and the wire (docs/ARCHITECTURE.md §4, §5): frame objects and frame ids, the client's modes
// and the protocol's MoveMode, a walker's heading and a quaternion, the input buttons.
import * as THREE from 'three';
import { Buttons } from '@astra/shared/protocol';
import { frameIdOf, frameKeyOf } from '@astra/shared/world';

const _m = new THREE.Matrix4();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();

/** The frame id of one of the client's frames in its system (`system.planets[i]` is body i, ARCHITECTURE §4): null for
 * the inertial frame, undefined for a frame that is not this system's. */
export function frameIdOfFrame(system, station, frame) {
  if (!frame) return null;
  if (frame === station) return frameIdOf(system.seed, 'station');
  const i = system.planets.indexOf(frame);
  return i < 0 ? undefined : frameIdOf(system.seed, i);
}

/** The client's frame object a frame id names in its system: null for the inertial frame, undefined when the id names
 * none of this system's frames. */
export function frameOfId(system, station, id) {
  const key = frameKeyOf({ seed: system.seed, bodies: system.planets }, id);
  if (key === undefined) return undefined;
  if (key === null) return null;
  return key === 'station' ? station : system.planets[key];
}

/** The protocol's movement mode for what the client is doing: on foot, on the pulse drive, set down (on a Waystation pad,
 * docked), or anything else a ship does (flying, taking off, landing, the docking autopilot). */
export function moveModeOf(gameMode, shipMode, frame) {
  if (gameMode === 'foot') return 'foot';
  if (shipMode === 'pulse') return 'pulse';
  if (shipMode === 'landed') return frame?.kind === 'station' ? 'docked' : 'landed';
  return 'ship';
}

/** A walker's orientation as a quaternion: facing `heading` (−z), standing along `up` (+y). */
export function walkerQuat(up, heading, out = new THREE.Quaternion()) {
  _right.crossVectors(heading, up);
  if (_right.lengthSq() < 1e-12) _right.set(1, 0, 0).addScaledVector(up, -up.x);
  _right.normalize();
  _back.crossVectors(_right, up).normalize();
  _m.makeBasis(_right, up, _back);
  return out.setFromRotationMatrix(_m);
}

/** The heading (along the ground, perpendicular to `up`) a walker with orientation `quat` faces. */
export function headingOf(quat, up, out = new THREE.Vector3()) {
  out.set(0, 0, -1).applyQuaternion(quat).addScaledVector(up, -out.dot(up));
  if (out.lengthSq() < 1e-12) out.set(1, 0, 0).addScaledVector(up, -up.x);
  return out.normalize();
}

/** The input message's button mask from what the player is doing. */
export function buttonsOf(b) {
  let m = 0;
  for (const k of Object.keys(Buttons)) if (b[k]) m |= Buttons[k];
  return m;
}
