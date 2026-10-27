// Where a cutscene's cameras live (docs/ARCHITECTURE.md "Cutscenes"). A cutscene is authored in one frame: the
// Waystation's, a planet or moon's (its rotating surface frame), the system's inertial frame, or whichever the player
// is in. Its camera poses are expressed in that frame, so as the body orbits and turns the camera goes with it. Anchored
// on the frame's origin, the authored coordinates are the frame's own (a place on the station); anchored on the player,
// they are relative to where the player was when it began, and turned with it (the player's ship sits at the origin of
// the Blender scene, nose along +Y, the engine's -Z).
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pa = new THREE.Vector3();
const _qa = new THREE.Quaternion();

/**
 * The frame a definition names, in the game's system: a Body (planet, moon or the Waystation) or null (inertial).
 * `player` is the frame the player is in now.
 */
export function resolveFrame(name, { system, station, player }) {
  if (name === 'station') return station;
  if (name === 'inertial') return null;
  if (name === 'player') return player.frame ?? null;
  if (name === 'home') return system.homePlanet;
  const body = system.planets[Number(name.slice('body:'.length))];
  if (!body) throw new Error(`cutscene frame ${name}: the system has no such body`);
  return body;
}

/**
 * The cutscene's space: its frame, and the origin and turn of the authored coordinates in it. Anchored on the player,
 * that is the player's pose (`player`, a FrameState) expressed in the frame now.
 */
export function anchorSpace(frame, anchor, player) {
  const space = { frame, origin: new THREE.Vector3(), basis: new THREE.Quaternion() };
  if (anchor !== 'player') return space;
  if (player.frame === frame) {
    space.origin.copy(player.pos);
    space.basis.copy(player.quat);
    return space;
  }
  // the player is in another frame: through world coordinates
  player.worldPosition(_v);
  player.worldQuaternion(_q);
  if (frame) {
    frame.worldToLocal(_v, space.origin);
    space.basis.copy(frame.quaternion).invert().multiply(_q);
  } else {
    space.origin.copy(_v);
    space.basis.copy(_q);
  }
  return space;
}

/** A sampled camera ({pos, quat}, authored coordinates) placed in the space, into `out` (a FrameState). */
export function placeInSpace(space, sample, out) {
  out.frame = space.frame;
  out.pos.fromArray(sample.pos).applyQuaternion(space.basis).add(space.origin);
  out.quat.copy(space.basis).multiply(_q.fromArray(sample.quat));
  return out;
}

/**
 * Mixes two camera poses (FrameStates, each in its own frame) by `w` (0: `a`, 1: `b`) through world coordinates, and
 * writes the result into `out` in frame `into`.
 */
export function mixPoses(a, b, w, into, out) {
  const pa = a.worldPosition(_pa);
  const pb = b.worldPosition(_v);
  const qa = a.worldQuaternion(_qa);
  const qb = b.worldQuaternion(_q);
  pa.lerp(pb, w);
  qa.slerp(qb, w);
  out.frame = into;
  if (into) {
    into.worldToLocal(pa, out.pos);
    out.quat.copy(into.quaternion).invert().multiply(qa);
  } else {
    out.pos.copy(pa);
    out.quat.copy(qa);
  }
  return out;
}
