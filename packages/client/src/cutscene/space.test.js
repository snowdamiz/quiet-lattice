// Where a cutscene's camera is: expressed in its authoring frame, it follows that body as it orbits and turns (the
// camera stays put relative to the body, not to the stars); anchored on the player it sits relative to the player's pose
// at the start, whichever frame the player was in; and a glide mixes two poses through world coordinates.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Body, FrameState } from '../universe/Body.js';
import { anchorSpace, mixPoses, placeInSpace, resolveFrame } from './space.js';

function world() {
  const star = new Body({ name: 'Star', kind: 'star', radius: 1e8 });
  const planet = new Body({ name: 'Home', parent: star, radius: 4e5, orbitRadius: 3e10, orbitPeriod: 9000, rotationPeriod: 600, axialTilt: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0.1)) });
  const station = new Body({ name: 'Waystation', kind: 'station', parent: planet, radius: 300, orbitRadius: 4.55e5, orbitPeriod: 2400, rotationPeriod: 2400 });
  const update = (t) => [star, planet, station].forEach((b) => b.update(t));
  return { star, planet, station, update };
}

const near = (a, b, eps = 1e-6) => expect(a.distanceTo(b)).toBeLessThan(eps);

describe('a cutscene camera in its frame', () => {
  it('follows the body as it orbits and turns: fixed in the frame, moving in the world', () => {
    const { station, update } = world();
    const space = anchorSpace(station, 'origin', new FrameState());
    const sample = { pos: [30, 45, 520], quat: [0, Math.sin(0.2), 0, Math.cos(0.2)] };
    const cam = new FrameState();
    const seen = [];
    for (const t of [100, 160, 220]) {
      update(t);
      placeInSpace(space, sample, cam);
      expect(cam.frame).toBe(station);
      expect(cam.pos.toArray()).toEqual([30, 45, 520]);
      const w = cam.worldPosition(new THREE.Vector3());
      near(w, station.localToWorld(new THREE.Vector3(30, 45, 520), new THREE.Vector3()), 1e-3);
      // relative to the station it has not moved
      near(station.worldToLocal(w, new THREE.Vector3()), new THREE.Vector3(30, 45, 520), 1e-3);
      seen.push(w);
    }
    // while the station has carried it a long way round its world
    expect(seen[0].distanceTo(seen[2])).toBeGreaterThan(1e5);
    // and it turns with the station
    update(100);
    const q0 = placeInSpace(space, sample, cam).worldQuaternion(new THREE.Quaternion());
    update(700);
    const q1 = placeInSpace(space, sample, cam).worldQuaternion(new THREE.Quaternion());
    expect(q0.angleTo(q1)).toBeGreaterThan(0.1);
  });

  it('anchored on the player, sits relative to the player’s pose at the start, turned with it', () => {
    const { station, update } = world();
    update(50);
    const ship = new FrameState();
    ship.frame = station;
    ship.pos.set(100, 20, -40);
    // facing -x (a quarter turn about +y)
    ship.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const space = anchorSpace(station, 'player', ship);
    // 10 m behind the ship (its +z) and 2 m up
    const cam = placeInSpace(space, { pos: [0, 2, 10], quat: [0, 0, 0, 1] }, new FrameState());
    near(cam.pos, new THREE.Vector3(110, 22, -40));
    // looking where the ship looks
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quat);
    near(fwd, new THREE.Vector3(-1, 0, 0));
    // the player moving on afterwards does not move the anchor
    ship.pos.set(0, 0, 0);
    near(placeInSpace(space, { pos: [0, 2, 10], quat: [0, 0, 0, 1] }, new FrameState()).pos, new THREE.Vector3(110, 22, -40));
  });

  it('anchors through world coordinates when the player is in another frame', () => {
    const { planet, station, update } = world();
    update(80);
    const ship = new FrameState();
    ship.frame = planet;
    ship.pos.set(0, 4.6e5, 1000);
    ship.quat.setFromEuler(new THREE.Euler(0.2, 1.1, -0.3));
    const space = anchorSpace(station, 'player', ship);
    const cam = placeInSpace(space, { pos: [0, 0, 0], quat: [0, 0, 0, 1] }, new FrameState());
    expect(cam.frame).toBe(station);
    near(cam.worldPosition(new THREE.Vector3()), ship.worldPosition(new THREE.Vector3()), 1e-3);
    expect(cam.worldQuaternion(new THREE.Quaternion()).angleTo(ship.worldQuaternion(new THREE.Quaternion()))).toBeLessThan(1e-6);
    // the inertial frame: world coordinates
    const free = anchorSpace(null, 'player', ship);
    near(placeInSpace(free, { pos: [0, 0, 0], quat: [0, 0, 0, 1] }, new FrameState()).pos, ship.worldPosition(new THREE.Vector3()), 1e-3);
  });

  it('names its frames', () => {
    const { planet, station } = world();
    const player = new FrameState();
    player.frame = planet;
    const system = { homePlanet: planet, planets: [planet] };
    expect(resolveFrame('station', { system, station, player })).toBe(station);
    expect(resolveFrame('home', { system, station, player })).toBe(planet);
    expect(resolveFrame('body:0', { system, station, player })).toBe(planet);
    expect(resolveFrame('player', { system, station, player })).toBe(planet);
    expect(resolveFrame('inertial', { system, station, player })).toBeNull();
    expect(() => resolveFrame('body:7', { system, station, player })).toThrow(/no such body/);
  });
});

describe('mixPoses', () => {
  it('glides between poses in two frames through world coordinates, into the frame asked for', () => {
    const { planet, station, update } = world();
    update(30);
    const a = new FrameState();
    a.frame = station;
    a.pos.set(0, 10, 50);
    const b = new FrameState();
    b.frame = planet;
    b.pos.set(0, 4.6e5, 300);
    b.quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4);
    const out = new FrameState();
    const wa = a.worldPosition(new THREE.Vector3());
    const wb = b.worldPosition(new THREE.Vector3());
    mixPoses(a, b, 0, station, out);
    near(out.pos, a.pos, 1e-3);
    mixPoses(a, b, 1, station, out);
    near(out.worldPosition(new THREE.Vector3()), wb, 1e-3);
    mixPoses(a, b, 0.5, null, out);
    expect(out.frame).toBeNull();
    near(out.pos, wa.clone().lerp(wb, 0.5), 1e-3);
  });
});
