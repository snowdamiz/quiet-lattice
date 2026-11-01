// A remote entity's pose buffer (P1.E04.T02): interpolation between snapshot samples (a Hermite where positions and
// velocities agree), extrapolation for at most 250 ms and then a hold, repeats skipped, cuts never crossed, and the
// samples held re-expressed in a new frame keeping their world poses at their own times.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Body } from '../universe/Body.js';
import { EXTRAPOLATE_S, PoseBuffer, SKEW_LEAD_S, SKEW_S, TELEPORT_M } from './buffer.js';
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

/**
 * What a zone sends of a steady flight `path(t)` reported by its client at 20 Hz: each tick (every 50 ms from t0) labels
 * with its own time the last report that had reached it, the reports taken at `phase` past each tick and arriving
 * 5-45 ms later (deterministic jitter), so some ticks see none (and repeat the last) and some two (and send the later).
 * No report is taken while `busy(t)` (the client's page stalled).
 */
function zoneOf(path, { t0 = 100, seconds = 3, phase = 0.03, seed = 1, busy = () => false } = {}) {
  const reports = [];
  for (let i = 0; i * 0.05 < seconds + 0.2; i++) {
    const at = t0 - 0.1 + i * 0.05 + phase;
    if (busy(at)) continue;
    const jitter = 0.005 + 0.04 * (((Math.sin((i + 1) * 12.9898 * seed) * 43758.5453) % 1) + 1) % 1;
    reports.push({ at, arrives: at + jitter, ...path(at) });
  }
  const ticks = [];
  for (let k = 0; k * 0.05 <= seconds; k++) {
    const T = t0 + k * 0.05;
    let last = null;
    for (const r of reports) if (r.arrives <= T && (!last || r.at > last.at)) last = r;
    if (last) ticks.push({ T, ...last });
  }
  return ticks;
}

describe('PoseBuffer: reports bunched into ticks', () => {
  // two pilots side by side, 100 m apart, on the pulse drive (280 km/s) and at a cruise (120 m/s), their clients'
  // reports reaching the ticks on different beats
  for (const speed of [280000, 120]) {
    it(`draws pilots side by side at ${speed} m/s at their own steady pace, never cut, never apart`, () => {
      const pilots = [0, 100].map((y, i) => {
        const b = new PoseBuffer();
        const results = zoneOf((t) => ({ pos: [speed * (t - 100), y, 0], vel: [speed, 0, 0] }), { phase: 0.012 + 0.025 * i, seed: i + 1 }).map((s) =>
          b.push(s.T, null, s.pos, Q, s.vel, 'pulse'),
        );
        return { b, results };
      });
      // (labelled as they are, some steps would be a tick's travel off: 14 km at the pulse drive)
      for (const p of pilots) expect(p.results).not.toContain('cut');
      const out = pose();
      const xs = [[], []];
      // (over the last 1.4 s of the 1.6 s held)
      for (let t = 101.5; t < 102.9; t += 1 / 60) pilots.forEach((p, i) => (p.b.sample(t, out), xs[i].push(out.pos.x)));
      const step = speed / 60;
      for (const x of xs) {
        const steps = x.slice(1).map((v, k) => v - x[k]);
        // each frame's step within 10% of the flight's own
        expect(Math.min(...steps)).toBeGreaterThan(step * 0.9);
        expect(Math.max(...steps)).toBeLessThan(step * 1.1);
      }
      // and side by side as they fly, to within a tick of travel (their clients report 25 ms apart, which the ticks'
      // labels cannot tell)
      for (let k = 0; k < xs[0].length; k++) expect(Math.abs(xs[0][k] - xs[1][k])).toBeLessThan(speed * 0.05);
    });
  }

  // a client whose frames run long (its steps clamped) moves less in a second than its velocity says: by its motion its
  // poses would be taken ever earlier, and it would be drawn ahead of where it was
  for (const rate of [0.8, 1, 1.2]) {
    it(`draws a flight that covers ${rate} times what its velocity says no earlier than it was there, at a steady pace`, () => {
      const b = new PoseBuffer();
      const path = (t) => ({ pos: [120 * rate * (t - 100), 0, 0], vel: [120, 0, 0] });
      for (const s of zoneOf(path, { seconds: 8, phase: 0.02, seed: 3 })) b.push(s.T, null, s.pos, Q, s.vel, 'ship');
      const out = pose();
      const behind = [];
      const xs = [];
      for (let t = 106.5; t < 107.9; t += 1 / 60) {
        b.sample(t, out);
        xs.push(out.pos.x);
        // when its client had it where it is drawn
        behind.push(t - (100 + out.pos.x / (120 * rate)));
      }
      expect(Math.min(...behind)).toBeGreaterThan(-0.02);
      expect(Math.max(...behind)).toBeLessThan(0.2);
      const steps = xs.slice(1).map((v, k) => v - xs[k]);
      expect(Math.min(...steps)).toBeGreaterThan((120 * rate) / 60 * 0.85);
      expect(Math.max(...steps)).toBeLessThan((120 * rate) / 60 * 1.15);
    });
  }

  it(`draws a client that stalls (its page busy, then its step clamped) no more than ${SKEW_LEAD_S * 1000} ms ahead of where it was`, () => {
    // busy for 0.3 s of every second, in which it neither reports nor moves (it then takes up where it was)
    const busy = (t) => (t - 100) % 1 > 0.6 && (t - 100) % 1 < 0.9;
    const stalled = (t) => Math.floor(t - 100) * 0.3 + Math.max(0, Math.min(0.3, ((t - 100) % 1) - 0.6));
    const at = (x) => {
      // when it was at x (the first time)
      let lo = 100;
      let hi = 110;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (120 * (mid - 100 - stalled(mid)) < x) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const b = new PoseBuffer();
    for (const s of zoneOf((t) => ({ pos: [120 * (t - 100 - stalled(t)), 0, 0], vel: [120, 0, 0] }), { seconds: 8, seed: 5, busy })) b.push(s.T, null, s.pos, Q, s.vel, 'ship');
    const out = pose();
    let ahead = 0;
    for (let t = 106.5; t < 107.9; t += 1 / 120) {
      if (b.sample(t, out) !== 'interpolate') continue;
      ahead = Math.max(ahead, at(out.pos.x) - t);
    }
    expect(ahead).toBeLessThan(SKEW_LEAD_S);
  });

  it('lets an estimate fall back to the tick’s time once the reports are on the beat again', () => {
    const b = new PoseBuffer();
    // on the beat, then one report taken 50 ms later than its tick says, then on the beat again (each a tick apart)
    const late = (t) => (t >= 100.5 - 1e-9 ? 0.05 : 0);
    const skew = [];
    for (let k = 0; k <= 70; k++) {
      const t = 100 + k * 0.05;
      b.push(t, null, [200 * (t - 100 + late(t)), 0, 0], Q, [200, 0, 0]);
      skew.push(b.newest.skew);
    }
    // the late one taken to be about as late as it was, then each after it less so (the reports after it are on the
    // beat): a third of it within a second, under a tenth of it within three
    expect(skew[10]).toBeGreaterThan(0.04);
    expect(skew[30]).toBeLessThan(skew[10] / 3);
    expect(Math.abs(skew[70])).toBeLessThan(skew[10] / 4);
  });

  it('keeps the ticks’ times for a steady flight reported on the beat', () => {
    const b = new PoseBuffer();
    for (const s of zoneOf((t) => ({ pos: [80 * (t - 100), 0, 0], vel: [80, 0, 0] }), { phase: 0.0 })) b.push(s.T, null, s.pos, Q, s.vel);
    for (let i = 1; i < b.length; i++) expect(Math.abs(b.at(i).t - b.at(i).label)).toBeLessThan(SKEW_S);
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
  // A ship crossing from the Waystation's frame into its world's at `miss` metres from where its motion puts it.
  function crossing(miss) {
    const { planet, station } = frames();
    const b = new PoseBuffer();
    const scratch = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() };
    const world = [];
    for (let k = 0; k < 5; k++) {
      const t = 300 + k * 0.05;
      const pos = [0, 0, 4600 + 6 * k];
      b.push(t, station, pos, Q, [0, 0, 120]);
      const s = framePoseAt(station, t, scratch);
      world.push(new THREE.Vector3(...pos).applyQuaternion(s.quaternion).add(s.position));
    }
    const t = 300.25;
    const s = framePoseAt(station, t, scratch);
    const there = new THREE.Vector3(0, 0, 4630 + miss).applyQuaternion(s.quaternion).add(s.position);
    const p = framePoseAt(planet, t, scratch);
    const inPlanet = there.clone().sub(p.position).applyQuaternion(p.quaternion.clone().invert());
    const result = b.push(t, planet, inPlanet.toArray(), Q, [0, 0, 120]);
    const moved = [0, 1, 2, 3, 4].map((k) => {
      const pp = framePoseAt(planet, b.at(k).t, scratch);
      return b.at(k).pos.clone().applyQuaternion(pp.quaternion).add(pp.position).distanceTo(world[k]);
    });
    return { b, result, moved };
  }

  it('moves the samples held to meet a new one its client placed in the new frame on its own clock', () => {
    // (300 m: a clock a quarter of a second off, the frames 1,200 m/s apart)
    const { b, result, moved } = crossing(300);
    expect(result).toBe('reframed');
    for (const d of moved) expect(d).toBeCloseTo(300, 0);
    expect(b.newest.cut).toBe(false);
  });

  it(`cuts at a teleport into another frame (further than ${TELEPORT_M} m or the frames' drift off), moving nothing`, () => {
    const { b, result, moved } = crossing(30_000);
    expect(result).toBe('cut');
    expect(b.newest.cut).toBe(true);
    // the samples held stay where they were in the world, and the pose holds the last of them until the cut is due
    for (const d of moved) expect(d).toBeLessThan(0.01);
    const out = pose();
    b.sample(300.24, out);
    expect(out.pos.distanceTo(b.at(4).pos)).toBeLessThan(5);
    expect(b.sample(300.26, out)).toBe('extrapolate');
    expect(out.since).toBeCloseTo(300.25, 6);
  });
});
