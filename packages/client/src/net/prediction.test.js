// Prediction and reconciliation (P1.E04.T03): what the client sent is kept and compared with each snapshot's account of its
// entity, a correction rewinds the mover to the server's pose and replays what it did since, and the drawn mover blends
// the move out or shows it as the jump it is.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Body, FrameState } from '../universe/Body.js';
import { framePoseAt, reframeAt } from '../remote/frames.js';
import { BLEND_S, Blend, HISTORY, MATCH_M, Prediction, SNAP_M, SNAP_S, snapLimit } from './prediction.js';
import { BOOST, Harness, pose as wirePose } from '../../../server/src/sim/movement/testing.ts';
import { describeZoneSystem } from '../../../server/src/zones/system.ts';

const SEED = 7;
const DT = 1 / 60;

/** A planet spinning on its orbit and its Waystation, at a real system's speeds, placed at world time `t` by `place`. */
function world() {
  const star = new Body({ name: 'star', kind: 'star' });
  const planet = new Body({ name: 'planet', parent: star, orbitRadius: 6e6, orbitPeriod: 15548, rotationPeriod: 3080, radius: 1e5, soi: 1.2e6 });
  const station = new Body({ name: 'station', kind: 'station', parent: planet, orbitRadius: 155000, orbitPeriod: 2400, soi: 4500 });
  const ids = new Map([
    [`${SEED}:0`, planet],
    [`${SEED}:station`, station],
  ]);
  const resolve = (id) => (id === null ? null : ids.get(id));
  const place = (t) => {
    for (const b of [star, planet, station]) {
      framePoseAt(b, t, b);
      b.quaternionInv.copy(b.quaternion).invert();
    }
  };
  return { planet, station, resolve, place };
}

const inertial = () => (id) => (id === null ? null : undefined);
const sent = (seq, time, pos, { vel = [0, 0, 0], quat = [0, 0, 0, 1], mode = 'ship', frame = null } = {}) => ({
  seq,
  time,
  mode,
  pose: { frame, pos, quat, vel },
});
const state = (frame, pos, vel = [0, 0, 0], quat = [0, 0, 0, 1]) => {
  const s = new FrameState();
  s.frame = frame;
  s.pos.fromArray(pos);
  s.vel.fromArray(vel);
  s.quat.fromArray(quat);
  return s;
};

describe('Prediction: what was sent', () => {
  it('keeps the last HISTORY inputs by seq', () => {
    const p = new Prediction(inertial());
    for (let seq = 1; seq <= HISTORY + 10; seq++) p.record(sent(seq, seq * 0.05, [seq, 0, 0]));
    expect(p.at(10)).toBeUndefined();
    expect(p.at(11)?.pos.x).toBe(11);
    expect(p.at(HISTORY + 10)?.time).toBeCloseTo((HISTORY + 10) * 0.05);
    expect(p.at(HISTORY + 11)).toBeUndefined();
  });

  it('keeps nothing in a frame not of this system, and nothing of a session before', () => {
    const p = new Prediction(inertial());
    p.record(sent(1, 0, [0, 0, 0], { frame: '99:0' }));
    expect(p.at(1)).toBeUndefined();
    p.record(sent(2, 0, [0, 0, 0]));
    p.reset();
    expect(p.at(2)).toBeUndefined();
  });
});

describe('Prediction: each snapshot against what was sent', () => {
  it('finds an accepted input where it was sent, and a correction it did not hear further than MATCH_M off', () => {
    const p = new Prediction(inertial());
    p.record(sent(1, 10, [100, 0, 0]));
    p.record(sent(2, 10.05, [125, 0, 0], { mode: 'pulse' }));
    expect(p.check(1, { frame: null, pos: [100, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' }, 10)).toBeNull();
    expect(p.stats).toMatchObject({ error: 0, compared: 1, unheard: 0 });
    expect(p.check(1, { frame: null, pos: [100 + MATCH_M * 0.9, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' }, 10)).toBeNull();
    const off = p.check(1, { frame: null, pos: [100 + MATCH_M * 1.1, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' }, 10);
    expect(off).toMatchObject({ seq: 1, mode: 'ship', pose: { pos: [100 + MATCH_M * 1.1, 0, 0] } });
    // the pulse drive refused: the server holds it on its engines where it was
    const refused = p.check(2, { frame: null, pos: [125, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' }, 10.1);
    expect(refused).toMatchObject({ seq: 2, mode: 'ship' });
    expect(p.stats).toMatchObject({ compared: 4, unheard: 2 });
    expect(p.stats.maxError).toBeCloseTo(MATCH_M * 1.1);
  });

  it('compares nothing sent before the last correction it took', () => {
    const p = new Prediction(inertial());
    for (let seq = 1; seq <= 6; seq++) p.record(sent(seq, seq * 0.05, [seq * 25, 0, 0]));
    p.corrected(4);
    expect(p.check(4, { frame: null, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' }, 1)).toBeNull();
    expect(p.stats.compared).toBe(0);
    expect(p.check(5, { frame: null, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' }, 1)).not.toBeNull();
  });

  it('compares a correction in another frame at the input time, including one lost at a sphere’s edge', () => {
    const { planet, station, resolve, place } = world();
    const p = new Prediction(resolve);
    const t = 2000;
    p.record(sent(1, t, [0, 0, -4490], { vel: [0, 0, -400], frame: `${SEED}:station` }));
    const s = state(station, [0, 0, -4490], [0, 0, -400]);
    reframeAt(s, station, planet, t);
    const e = { frame: `${SEED}:0`, pos: s.pos.toArray(), quat: s.quat.toArray(), vel: s.vel.toArray(), mode: 'ship' };
    // Repeated snapshots can arrive at any later tick; the input still names the pose's frame time.
    for (const lag of [0.1, 0.15, 0.3]) {
      place(t + lag);
      expect(p.check(1, e)).toBeNull();
    }
    expect(p.stats.compared).toBe(3);
    expect(p.stats.maxError).toBeLessThan(1e-6);
    const corrected = { ...e, pos: [e.pos[0] + 3, e.pos[1], e.pos[2]] };
    expect(p.check(1, corrected)).toMatchObject({ seq: 1, mode: 'ship', pose: { pos: corrected.pos } });
    expect(p.stats.unheard).toBe(1);
  });
});

describe('Prediction: rewinding to a correction and replaying', () => {
  it('re-bases the motion since the corrected input on the server’s pose', () => {
    const p = new Prediction(inertial());
    p.record(sent(5, 10, [500, 0, 0], { vel: [100, 0, 0] }));
    // a round trip later the ship has gone on 25 m and sped up; the server holds input 5 three metres to the side
    const s = state(null, [525, 0, 0], [110, 0, 0]);
    expect(p.take(5, { frame: null, pos: [500, 3, 0], quat: [0, 0, 0, 1], vel: [100, 0, 0] }, 'ship', s, 10.25)).toBe(true);
    expect(s.pos.toArray()).toEqual([525, 3, 0]);
    expect(s.vel.toArray()).toEqual([110, 0, 0]);
  });

  it('carries the server’s pose on at its velocity where it refused the mode the client sent', () => {
    const p = new Prediction(inertial());
    p.record(sent(5, 10, [520, 0, 0], { vel: [400, 0, 0], mode: 'pulse' }));
    // engaged: 0.25 s on the drive since; the server holds the last pose it vouched for, as of input 5, on the engines
    const s = state(null, [700, 0, 0], [900, 0, 0]);
    p.take(5, { frame: null, pos: [500, 0, 0], quat: [0, 0, 0, 1], vel: [400, 0, 0] }, 'ship', s, 10.25);
    expect(s.pos.x).toBeCloseTo(600);
    expect(s.vel.toArray()).toEqual([400, 0, 0]);
  });

  it('replays acceleration after a pulse refusal when another old pulse input is corrected', () => {
    const p = new Prediction(inertial());
    p.record(sent(1, 10, [520, 0, 0], { vel: [400, 0, 0], mode: 'pulse' }));
    p.record(sent(2, 10.1, [570, 0, 0], { vel: [600, 0, 0], mode: 'pulse' }));
    p.record(sent(3, 10.2, [640, 0, 0], { vel: [800, 0, 0], mode: 'pulse' }));
    const s = state(null, [700, 0, 0], [900, 0, 0]);
    const pose = { frame: null, pos: [500, 0, 0], quat: [0, 0, 0, 1], vel: [400, 0, 0] };
    p.take(1, pose, 'ship', s, 10.25);
    p.corrected(3);
    expect(s.pos.x).toBeCloseTo(600);
    // 0.4 s on the engines at 20 m/s² after the first correction was received.
    s.pos.x += 400 * 0.4 + 0.5 * 20 * 0.4 ** 2;
    s.vel.x += 20 * 0.4;
    const expected = s.pos.clone();
    p.take(3, { ...pose, pos: [580, 0, 0] }, 'ship', s, 10.65);
    expect(s.pos.distanceTo(expected)).toBeLessThan(1e-9);
    expect(s.vel.x).toBe(408);
    expect(p.at(3).mode).toBe('pulse');
    expect(p.at(3).pos.x).toBe(640);
  });

  it('replays a ship’s turning since onto the server’s orientation, and leaves a walker’s alone', () => {
    const p = new Prediction(inertial());
    const yaw = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    p.record(sent(1, 0, [0, 0, 0], { quat: yaw(0.2).toArray() }));
    const s = state(null, [0, 0, 0], [0, 0, 0], yaw(0.5).toArray());
    p.take(1, { frame: null, pos: [0, 0, 0], quat: yaw(0.1).toArray(), vel: [0, 0, 0] }, 'ship', s, 0.2);
    expect(s.quat.angleTo(yaw(0.4))).toBeLessThan(1e-6);
    p.record(sent(2, 0.3, [0, 0, 0], { quat: yaw(0.2).toArray(), mode: 'foot' }));
    const w = state(null, [0, 0, 0], [0, 0, 0], yaw(0.5).toArray());
    p.take(2, { frame: null, pos: [1, 0, 0], quat: yaw(1).toArray(), vel: [0, 0, 0] }, 'foot', w, 0.5);
    expect(w.quat.angleTo(yaw(0.5))).toBeLessThan(1e-6);
    expect(w.pos.x).toBe(1);
  });

  it('replays a pitch-then-yaw turn in the ship’s own axes onto the server’s orientation', () => {
    const p = new Prediction(inertial());
    const about = (axis, a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), a);
    const sentQ = about([0, 1, 0], 0.7);
    const serverQ = about([0, 0, 1], 0.5);
    const turn = about([1, 0, 0], 0.4).multiply(about([0, 1, 0], 0.3));
    p.record(sent(1, 0, [0, 0, 0], { quat: sentQ.toArray() }));
    const s = state(null, [0, 0, 0], [0, 0, 0], sentQ.clone().multiply(turn).toArray());
    p.take(1, { frame: null, pos: [0, 0, 0], quat: serverQ.toArray(), vel: [0, 0, 0] }, 'ship', s, 0.2);
    expect(s.quat.angleTo(serverQ.clone().multiply(turn))).toBeLessThan(1e-6);
  });

  it('replays retained motion for an input at or before the fence without applying an offset twice', () => {
    const p = new Prediction(inertial());
    for (let seq = 5; seq <= 11; seq++) p.record(sent(seq, 10 + (seq - 5) * 0.05, [500 + (seq - 5) * 5, 0, 0], { vel: [100, 0, 0] }));
    const s = state(null, [525, 0, 0], [100, 0, 0]);
    const pose = { frame: null, pos: [500, 3, 0], quat: [0, 0, 0, 1], vel: [100, 0, 0] };
    p.take(5, pose, 'ship', s, 10.25);
    p.corrected(10);
    expect(s.pos.toArray()).toEqual([525, 3, 0]);
    p.take(5, pose, 'ship', s, 10.25);
    expect(s.pos.toArray()).toEqual([525, 3, 0]);
    p.take(8, { ...pose, pos: [515, 3, 0] }, 'ship', s, 10.25);
    expect(s.pos.x).toBeCloseTo(515 + 100 * 0.1);
    expect(s.pos.y).toBe(3);
    expect(s.vel.toArray()).toEqual([100, 0, 0]);
    // after the fence it is re-based as ever
    p.record(sent(12, 10.35, [535, 0, 0], { vel: [100, 0, 0] }));
    p.take(12, { ...pose, pos: [535, 1, 0] }, 'ship', s, 10.4);
    expect(s.pos.y).toBe(4);
  });

  it.each([20, 160])('replays %s m/s² acceleration after a second correction at or before the fence', (accel) => {
    const p = new Prediction(inertial());
    const x = (dt) => 500 + 100 * dt + 0.5 * accel * dt * dt;
    const v = (dt) => 100 + accel * dt;
    for (let i = 0; i <= 32; i++) p.record(sent(i + 1, 10 + i * 0.05, [x(i * 0.05), 0, 0], { vel: [v(i * 0.05), 0, 0] }));
    const s = state(null, [x(1.6), 0, 0], [v(1.6), 0, 0]);
    const correction = { frame: null, pos: [500, 3, 0], quat: [0, 0, 0, 1], vel: [100, 0, 0] };
    p.take(1, correction, 'ship', s, 11.6);
    p.corrected(33);
    expect(s.pos.distanceTo(new THREE.Vector3(x(1.6), 3, 0))).toBeLessThan(1e-9);
    // The same correction is idempotent, even while accelerating.
    p.take(1, correction, 'ship', s, 11.6);
    expect(s.pos.distanceTo(new THREE.Vector3(x(1.6), 3, 0))).toBeLessThan(1e-9);
    // An old-trajectory input held beyond the server's 1 s grace answers after another 300 ms.
    s.pos.x = x(1.9);
    s.vel.x = v(1.9);
    p.record(sent(34, 11.9, s.pos.toArray(), { vel: s.vel.toArray() }));
    p.take(7, { ...correction, pos: [x(0.3) - 2, 3, 0], vel: [v(0.3), 0, 0] }, 'ship', s, 11.9);
    expect(s.pos.distanceTo(new THREE.Vector3(x(1.9) - 2, 3, 0))).toBeLessThan(1e-9);
    expect(s.vel.x).toBeCloseTo(v(1.9), 9);
    // Snapshot checks retain exactly what was sent before reconciliation.
    expect(p.at(7).pos.toArray()).toEqual([x(0.3), 0, 0]);
    expect(p.at(34).pos.toArray()).toEqual([x(1.9), 3, 0]);
  });

  it.each([20, 160])('replays %s m/s² after authority’s actual 1 s grace expires on an old input', (accel) => {
    const p = new Prediction(inertial());
    const x = (dt) => 500 + 100 * dt + 0.5 * accel * dt * dt;
    const v = (dt) => 100 + accel * dt;
    const h = new Harness(describeZoneSystem(0), { pose: wirePose(null, [500, 2e9, 0], [100, 0, 0]), mode: 'ship' }, {}, { now: 10 });
    const inputs = [];
    for (let i = 0; i <= 32; i++) {
      const msg = { t: 'input', buttons: 0, ...sent(i + 1, 10 + i * 0.05, [x(i * 0.05), 2e9 + 3000, 0], { vel: [v(i * 0.05), 0, 0] }) };
      inputs.push(msg);
      p.record(msg);
    }
    const first = h.a.check(h.id, inputs[0], 10.8);
    expect(first.ok).toBe(false);
    expect(first.correction).not.toBeNull();
    expect(h.a.check(h.id, inputs[9], 11.25)).toMatchObject({ ok: false, correction: null });
    const late = h.a.check(h.id, inputs[22], 11.9);
    expect(late.ok).toBe(false);
    expect(late.correction.seq).toBe(23);
    const s = state(null, [x(1.6), 2e9 + 3000, 0], [v(1.6), 0, 0]);
    p.take(first.correction.seq, first.correction.pose, 'ship', s, 11.6);
    p.corrected(33);
    // The first correction did not change x or velocity; another 1.1 s of the same acceleration follows.
    s.pos.x = x(2.7);
    s.vel.x = v(2.7);
    expect(late.correction.seq).toBeLessThan(p.fence);
    p.take(late.correction.seq, late.correction.pose, 'ship', s, 12.7);
    const traveled = x(2.7) - x(1.1);
    expect(s.pos.distanceTo(new THREE.Vector3(late.correction.pose.pos[0] + traveled, 2e9, 0))).toBeLessThan(MATCH_M);
    expect(p.at(23).pos.y).toBe(2e9 + 3000);
  });

  it('replays engine-owned acceleration after authority’s pulse correction returns beyond its grace', () => {
    const p = new Prediction(inertial());
    const h = new Harness(describeZoneSystem(0), { pose: wirePose(null, [500, 2e9, 0], [20000, 0, 0]), mode: 'pulse' }, {}, { now: 10 });
    const inputs = [];
    for (let i = 0; i <= 32; i++) {
      const msg = { t: 'input', buttons: BOOST, ...sent(i + 1, 10 + i * 0.05, [500 + 400 * i * 0.05, 2e9 + 3000, 0], { vel: [400, 0, 0] }) };
      inputs.push(msg);
      p.record(msg);
    }
    const first = h.a.check(h.id, inputs[0], 10.8);
    expect(first).toMatchObject({ ok: false, correction: { seq: 1, mode: 'pulse' } });
    expect(h.a.check(h.id, inputs[9], 11.25)).toMatchObject({ ok: false, correction: null });
    const late = h.a.check(h.id, inputs[22], 11.9);
    expect(late).toMatchObject({ ok: false, correction: { seq: 23, mode: 'pulse' } });

    const s = state(null, [1140, 2e9 + 3000, 0], [400, 0, 0]);
    p.take(first.correction.seq, first.correction.pose, first.correction.mode, s, 11.6, true);
    p.corrected(33);
    expect(s.pos.toArray()).toEqual([1140, 2e9, 0]);
    expect(s.vel.toArray()).toEqual([400, 0, 0]);
    // The engines accelerate for 1.1 s after the first correction; seq 23 predates its receipt by 0.5 s.
    s.pos.x += 400 * 1.1 + 0.5 * 160 * 1.1 ** 2;
    s.vel.x += 160 * 1.1;
    const expected = new THREE.Vector3(late.correction.pose.pos[0] + 400 * 1.6 + 0.5 * 160 * 1.1 ** 2, 2e9, 0);
    expect(expected.x).toBeCloseTo(1236.8, 9);
    expect(late.correction.seq).toBeLessThan(p.fence);
    for (let repeat = 0; repeat < 2; repeat++) {
      p.take(late.correction.seq, late.correction.pose, late.correction.mode, s, 12.7, true);
      expect(s.vel.toArray()).toEqual([576, 0, 0]);
      expect(s.pos.distanceTo(expected)).toBeLessThan(MATCH_M);
    }
    expect(p.at(23).mode).toBe('ship');
    expect(p.at(23).pos.toArray()).toEqual(inputs[22].pose.pos);
    expect(p.at(23).vel.toArray()).toEqual([400, 0, 0]);
  });

  it('takes the server’s velocity for an input at or before the fence where the mode it was sent in is refused', () => {
    const p = new Prediction(inertial());
    for (let seq = 5; seq <= 9; seq++) p.record(sent(seq, 10 + (seq - 5) * 0.05, [500 + (seq - 5) * 1000, 0, 0], { vel: [20000, 0, 0], mode: 'pulse' }));
    p.corrected(9);
    const s = state(null, [5500, 0, 0], [20000, 0, 0]);
    p.take(9, { frame: null, pos: [100, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, 'ship', s, 10.2);
    expect(s.vel.toArray()).toEqual([0, 0, 0]);
    expect(s.pos.toArray()).toEqual([100, 0, 0]);
    // (the mover's own velocity where it keeps a mode of its own)
    const own = state(null, [5500, 0, 0], [400, 0, 0]);
    p.take(9, { frame: null, pos: [100, 0, 0], quat: [0, 0, 0, 1], vel: [20000, 0, 0] }, 'pulse', own, 10.2, true);
    expect(own.vel.toArray()).toEqual([400, 0, 0]);
  });

  it('takes the server’s velocity where the correction drops the drive, whatever mode the input was sent in', () => {
    const p = new Prediction(inertial());
    p.record(sent(5, 10, [500, 0, 0], { vel: [100, 0, 0] }));
    const s = state(null, [20000, 0, 0], [20000, 0, 0]);
    p.take(5, { frame: null, pos: [500, 0, 0], quat: [0, 0, 0, 1], vel: [100, 0, 0] }, 'ship', s, 10.25, false, true);
    expect(s.vel.toArray()).toEqual([100, 0, 0]);
    expect(s.pos.x).toBeCloseTo(525);
  });

  it('rewinds a mover now in another frame, with the frames as they stood at the corrected input', () => {
    const { planet, station, resolve, place } = world();
    const p = new Prediction(resolve);
    const t = 3000;
    p.record(sent(1, t, [0, 0, -4400], { vel: [0, 0, -400], frame: `${SEED}:station` }));
    // the server held it 2 m off along the station's x, as of input 1; the mover crossed into the planet's frame since
    place(t + 0.2);
    const s = state(station, [0, 0, -4480], [0, 0, -400]);
    reframeAt(s, station, planet, t + 0.2);
    s.frame = planet;
    const before = s.pos.clone();
    p.take(1, { frame: `${SEED}:station`, pos: [2, 0, -4400], quat: [0, 0, 0, 1], vel: [0, 0, -400] }, 'ship', s, t + 0.2);
    expect(s.frame).toBe(planet);
    // 2 m along the station's x, as its axes stood at the input, in the planet's axes
    const dx = new THREE.Vector3(2, 0, 0);
    reframeAt({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: dx }, station, planet, t);
    expect(s.pos.clone().sub(before).distanceTo(dx)).toBeLessThan(1e-3);
    // Repeating that correction preserves the motion of both frames since the input too.
    const corrected = s.pos.clone();
    p.corrected(1);
    p.take(1, { frame: `${SEED}:station`, pos: [2, 0, -4400], quat: [0, 0, 0, 1], vel: [0, 0, -400] }, 'ship', s, t + 0.2);
    expect(s.pos.distanceTo(corrected)).toBeLessThan(1e-6);
  });

  it('has nothing to rewind from for an input no longer kept or a frame of another system', () => {
    const p = new Prediction(inertial());
    p.record(sent(3, 1, [0, 0, 0]));
    const s = state(null, [10, 0, 0]);
    expect(p.take(2, { frame: null, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, 'ship', s, 1.2)).toBe(false);
    expect(p.take(3, { frame: '99:0', pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, 'ship', s, 1.2)).toBe(false);
    expect(s.pos.x).toBe(10);
  });
});

/** The blend run for `seconds` on a mover at constant velocity: the drawn positions, frame by frame. */
function run(b, s, seconds) {
  const out = new FrameState();
  const drawn = [];
  for (let t = 0; t < seconds; t += DT) {
    s.pos.addScaledVector(s.vel, DT);
    b.step(DT, s.frame);
    drawn.push(b.apply(s, out).pos.clone());
  }
  return drawn;
}

describe('Blend: what a correction moves on screen', () => {
  it('leaves from where and as fast as the mover was drawn, and dies away critically damped', () => {
    const b = new Blend();
    const s = state(null, [0, 3, 0], [400, 0, 0]);
    // drawn 3 m below and 100 m/s faster than where the correction put it
    expect(b.take(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(500, 0, 0), s)).toBe(true);
    const out = b.apply(s, new FrameState());
    expect(out.pos.toArray()).toEqual([0, 0, 0]);
    expect(out.vel.toArray()).toEqual([500, 0, 0]);
    const drawn = [new THREE.Vector3(-500 * DT, 0, 0), new THREE.Vector3(), ...run(b, s, 1)];
    // each frame's drawn step differs from the last by no more than easing off the 100 m/s does: no frame shows the 3 m
    let worst = 0;
    for (let i = 2; i < drawn.length; i++)
      worst = Math.max(
        worst,
        drawn[i]
          .clone()
          .sub(drawn[i - 1])
          .sub(drawn[i - 1].clone().sub(drawn[i - 2]))
          .length(),
      );
    expect(worst).toBeLessThan(0.5);
    expect(b.offset.length()).toBeLessThan(0.05);
    // (mostly gone in four time constants)
    const b2 = new Blend();
    const s2 = state(null, [0, 3, 0]);
    b2.take(new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3(), s2);
    run(b2, s2, 4 * BLEND_S);
    expect(b2.offset.length()).toBeLessThan(0.3);
  });

  it('turns the drawn ship back onto its orientation with the offset', () => {
    const b = new Blend();
    const s = state(null, [0, 1, 0]);
    const was = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
    b.take(new THREE.Vector3(), was, new THREE.Vector3(), s);
    expect(b.apply(s, new FrameState()).quat.angleTo(was)).toBeLessThan(1e-9);
    run(b, s, 1);
    expect(b.apply(s, new FrameState()).quat.angleTo(s.quat)).toBeLessThan(1e-3);
  });

  it('shows a jump larger than the mover’s speed over the round trip could make as the jump it is', () => {
    expect(snapLimit(0)).toBe(SNAP_M);
    expect(snapLimit(1000)).toBe(SNAP_S * 1000);
    const b = new Blend();
    const s = state(null, [0, 0, 0], [100, 0, 0]);
    expect(b.take(new THREE.Vector3(0, snapLimit(100) * 1.01, 0), new THREE.Quaternion(), new THREE.Vector3(100, 0, 0), s)).toBe(false);
    expect(b.apply(s, new FrameState()).pos.toArray()).toEqual([0, 0, 0]);
    expect(b.take(new THREE.Vector3(0, snapLimit(100) * 0.99, 0), new THREE.Quaternion(), new THREE.Vector3(100, 0, 0), s)).toBe(true);
  });

  it('keeps the drawn mover where it was as it crosses into another frame mid-blend', () => {
    const { planet, station, place } = world();
    const t = 5000;
    place(t);
    const b = new Blend();
    const s = state(station, [0, 3, -4490], [0, 0, -400]);
    b.take(new THREE.Vector3(0, 0, -4490), new THREE.Quaternion(), new THREE.Vector3(0, 0, -400), s);
    const drawn = b.apply(s, new FrameState()).worldPosition(new THREE.Vector3());
    reframeAt(s, station, planet, t);
    s.frame = planet;
    expect(b.apply(s, new FrameState()).worldPosition(new THREE.Vector3()).distanceTo(drawn)).toBeLessThan(1e-3);
  });
});
