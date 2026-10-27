// A remote entity's pose buffer (P1.E04.T02): interpolation between snapshot samples (a Hermite where positions and
// velocities agree), extrapolation for at most 250 ms and then a hold, repeats skipped, cuts never crossed, and the
// samples held re-expressed in a new frame keeping their world poses at their own times.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Body } from '../universe/Body.js';
import { EXTRAPOLATE_S, PoseBuffer, TELEPORT_M } from './buffer.js';
import { framePoseAt, reframeAt } from './frames.js';

const Q = [0, 0, 0, 1];
const pose = () => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3() });

/** A buffer fed `fn(t)` → {pos, vel, quat?, mode?} at 20 Hz from t0 for n ticks, in `frame`. */
function fed(fn, { t0 = 100, n = 10, frame = null } = {}) {
  const b = new PoseBuffer();
  for (let k = 0; k < n; k++) {
    const t = t0 + k * 0.05;
    const s = fn(t);
    b.push(t, frame, s.pos, s.quat ?? Q, s.vel, s.mode ?? 'ship');
  }
  return b;
}

// a ship turning hard: 300 m/s round a 400 m circle
const R = 400;
const W = 300 / R;
const circle = (t) => ({
  pos: [R * Math.cos(W * t), 0, R * Math.sin(W * t)],
  vel: [-R * W * Math.sin(W * t), 0, R * W * Math.cos(W * t)],
});

describe('PoseBuffer: between samples', () => {
  it('follows a straight line exactly', () => {
    const b = fed((t) => ({ pos: [10 + 80 * t, 5, -3], vel: [80, 0, 0] }));
    const out = pose();
    expect(b.sample(100.1234, out)).toBe('interpolate');
    expect(out.pos.x).toBeCloseTo(10 + 80 * 100.1234, 6);
    expect(out.vel.x).toBeCloseTo(80, 6);
  });

  it('keeps to a curve: the Hermite on positions and velocities, far closer than straight lines between the samples', () => {
    const b = fed(circle, { n: 20 });
    const out = pose();
    let worst = 0;
    for (let t = 100.2; t < 100.9; t += 0.0071) {
      expect(b.sample(t, out)).toBe('interpolate');
      worst = Math.max(worst, Math.abs(out.pos.length() - R));
    }
    // (a chord of the 15 m a tick covers sags 7 cm below the arc; the cubic stays within a millimetre)
    expect(worst).toBeLessThan(0.002);
    // and its velocity is the motion's
    b.sample(100.4321, out);
    expect(out.vel.distanceTo(new THREE.Vector3(...circle(100.4321).vel))).toBeLessThan(0.05);
  });

  it('draws a straight line where the velocities do not explain the motion', () => {
    // velocities that say it stands still, though it moves 2 m a tick
    const b = fed((t) => ({ pos: [40 * t, 0, 0], vel: [0, 0, 0] }));
    const out = pose();
    b.sample(100.125, out);
    expect(out.pos.x).toBeCloseTo(40 * 100.125, 6);
  });

  it('slerps the orientation', () => {
    const b = new PoseBuffer();
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    b.push(1, null, [0, 0, 0], qa.toArray(), [0, 0, 0]);
    b.push(1.05, null, [0, 0, 0], qb.toArray(), [0, 0, 0]);
    const out = pose();
    b.sample(1.025, out);
    expect(out.quat.angleTo(qa)).toBeCloseTo(0.2, 6);
  });
});

describe('PoseBuffer: past the newest sample', () => {
  it(`extrapolates along the newest velocity for ${EXTRAPOLATE_S * 1000} ms, then holds`, () => {
    const b = fed((t) => ({ pos: [80 * t, 0, 0], vel: [80, 0, 0] }), { n: 4 });
    const last = 100.15;
    const out = pose();
    expect(b.sample(last + 0.1, out)).toBe('extrapolate');
    expect(out.pos.x).toBeCloseTo(80 * (last + 0.1), 6);
    expect(b.sample(last + EXTRAPOLATE_S, out)).toBe('extrapolate');
    expect(b.sample(last + 2, out)).toBe('hold');
    expect(out.pos.x).toBeCloseTo(80 * (last + EXTRAPOLATE_S), 6);
  });

  it('holds the oldest sample before it', () => {
    const b = fed((t) => ({ pos: [80 * t, 0, 0], vel: [80, 0, 0] }), { n: 4 });
    const out = pose();
    expect(b.sample(99, out)).toBe('early');
    expect(out.pos.x).toBeCloseTo(8000, 6);
  });

  it('is empty until a sample comes', () => {
    expect(new PoseBuffer().sample(1, pose())).toBe('empty');
  });
});

describe('PoseBuffer: what it keeps', () => {
  it('skips a moving entity sent again where it was (its client had not reported in time for the tick)', () => {
    const b = new PoseBuffer();
    expect(b.push(1, null, [0, 0, 0], Q, [80, 0, 0])).toBe('ok');
    expect(b.push(1.05, null, [0, 0, 0], Q, [80, 0, 0])).toBe('repeat');
    expect(b.push(1.1, null, [8, 0, 0], Q, [80, 0, 0])).toBe('ok');
    expect(b.length).toBe(2);
    // and the two it kept are one smooth segment
    const out = pose();
    b.sample(1.05, out);
    expect(out.pos.x).toBeCloseTo(4, 6);
    // (one standing still is kept)
    expect(b.push(1.15, null, [8, 0, 0], Q, [0, 0, 0])).toBe('ok');
    expect(b.push(1.2, null, [8, 0, 0], Q, [0, 0, 0])).toBe('ok');
  });

  it('refuses a sample no newer than the newest', () => {
    const b = new PoseBuffer();
    b.push(2, null, [0, 0, 0], Q, [0, 0, 0]);
    expect(b.push(2, null, [1, 0, 0], Q, [0, 0, 0])).toBe('stale');
    expect(b.push(1, null, [1, 0, 0], Q, [0, 0, 0])).toBe('stale');
    expect(b.length).toBe(1);
  });

  it('keeps the newest 32, dropping the oldest', () => {
    const b = fed((t) => ({ pos: [t, 0, 0], vel: [1, 0, 0] }), { n: 40 });
    expect(b.length).toBe(32);
    expect(b.at(0).t).toBeCloseTo(100 + 8 * 0.05, 9);
    expect(b.newest.t).toBeCloseTo(100 + 39 * 0.05, 9);
  });
});

describe('PoseBuffer: cuts', () => {
  it(`never interpolates across a jump no velocity explains (more than ${TELEPORT_M} m off)`, () => {
    const b = new PoseBuffer();
    b.push(1, null, [0, 0, 0], Q, [50, 0, 0]);
    b.push(1.05, null, [2.5, 0, 0], Q, [50, 0, 0]);
    expect(b.push(1.1, null, [90000, 0, 0], Q, [0, 0, 0])).toBe('cut');
    const out = pose();
    // until the jump is due the ship carries on as it was going, then it is there
    b.sample(1.08, out);
    expect(out.pos.x).toBeCloseTo(4, 6);
    expect(out.since).toBe(-Infinity);
    b.sample(1.12, out);
    expect(out.pos.x).toBe(90000);
    expect(out.since).toBeCloseTo(1.1, 9);
  });

  it('cuts where a pilot steps out on foot or a walker boards', () => {
    const b = new PoseBuffer();
    b.push(1, null, [0, 0, 0], Q, [0, 0, 0], 'docked');
    expect(b.push(1.05, null, [6, 0, 2], Q, [0, 0, 0], 'foot')).toBe('cut');
    expect(b.push(1.1, null, [6.1, 0, 2], Q, [2, 0, 0], 'foot')).toBe('ok');
    expect(b.push(1.15, null, [0, 0, 0], Q, [0, 0, 0], 'docked')).toBe('cut');
    const out = pose();
    b.sample(1.04, out);
    expect(out.mode).toBe('docked');
    expect(out.pos.x).toBe(0);
    b.sample(1.06, out);
    expect(out.mode).toBe('foot');
  });
});

// a planet spinning on its orbit round the star, and a Waystation round it
function frames() {
  const star = new Body({ name: 'star', kind: 'star' });
  const planet = new Body({ name: 'planet', parent: star, orbitRadius: 6e6, orbitPeriod: 15548, rotationPeriod: 3080, radius: 1e5, soi: 1.2e6 });
  const station = new Body({ name: 'station', kind: 'station', parent: planet, orbitRadius: 155000, orbitPeriod: 2400, soi: 4500 });
  return { star, planet, station };
}

describe('frames at any time', () => {
  it("are the bodies' own poses at that time, without moving them", () => {
    const { planet, station } = frames();
    const t = 1234.5;
    const p = framePoseAt(planet, t, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() });
    const s = framePoseAt(station, t, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() });
    expect(planet.position.length()).toBe(0);
    planet.parent.update(t);
    planet.update(t);
    expect(p.position.distanceTo(planet.position)).toBeLessThan(1e-6);
    expect(p.quaternion.angleTo(planet.quaternion)).toBeLessThan(1e-9);
    // (the Waystation turns once an orbit, floor to its world)
    expect(s.position.distanceTo(planet.position)).toBeCloseTo(155000, 3);
  });

  it('re-express a pose keeping its world position and orientation at its time', () => {
    const { planet, station } = frames();
    const t = 500;
    const st = { pos: new THREE.Vector3(100, 20, 4400), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1), vel: new THREE.Vector3(0, 0, 120) };
    const s = framePoseAt(station, t, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() });
    const world = st.pos.clone().applyQuaternion(s.quaternion).add(s.position);
    const worldQ = s.quaternion.clone().multiply(st.quat);
    reframeAt(st, station, planet, t);
    const p = framePoseAt(planet, t, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() });
    expect(st.pos.clone().applyQuaternion(p.quaternion).add(p.position).distanceTo(world)).toBeLessThan(0.01);
    expect(p.quaternion.clone().multiply(st.quat).angleTo(worldQ)).toBeLessThan(1e-9);
    // (turned, never boosted)
    expect(st.vel.length()).toBeCloseTo(120, 9);
  });
});

describe('PoseBuffer: a sample in another frame', () => {
  it('re-expresses the samples held, each at its own time, so they stay where they were in the world', () => {
    const { planet, station } = frames();
    const b = new PoseBuffer();
    const world = [];
    const scratch = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() };
    for (let k = 0; k < 5; k++) {
      const t = 300 + k * 0.05;
      const pos = [0, 0, 4600 + 6 * k];
      b.push(t, station, pos, Q, [0, 0, 120]);
      const s = framePoseAt(station, t, scratch);
      world.push(new THREE.Vector3(...pos).applyQuaternion(s.quaternion).add(s.position));
    }
    const t = 300.25;
    const s = framePoseAt(station, t, scratch);
    const there = new THREE.Vector3(0, 0, 4630).applyQuaternion(s.quaternion).add(s.position);
    const p = framePoseAt(planet, t, scratch);
    const inPlanet = there.clone().sub(p.position).applyQuaternion(p.quaternion.clone().invert());
    expect(b.push(t, planet, inPlanet.toArray(), Q, [0, 0, 120])).toBe('reframed');
    expect(b.frame).toBe(planet);
    for (let k = 0; k < 5; k++) {
      const pp = framePoseAt(planet, b.at(k).t, scratch);
      expect(b.at(k).pos.clone().applyQuaternion(pp.quaternion).add(pp.position).distanceTo(world[k])).toBeLessThan(0.01);
      expect(b.at(k).conv).toBe(true);
    }
    // the converted samples' velocities are not their positions' rate in the planet's frame: straight lines between them
    expect(b.at(4).smooth).toBe(false);
    expect(b.newest.cut).toBe(false);
  });
});
