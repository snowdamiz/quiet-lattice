// Camera curve sampling: the spline passes through every exported sample at its time, has no corners in its velocity,
// reproduces a steady move exactly, keeps rotations unit length across sign flips, holds at the ends of a shot, and
// picks the shot playing at each time.
import { describe, expect, it } from 'vitest';
import { easeInOutCubic, easeOutCubic, sampleShot, sampleShots, shotAt, smootherstep } from './curve.js';

/** A shot of `n` samples at `fps` from `start`, each from f(i) = {pos, quat, fov}. */
function shot(n, f, { start = 0, fps = 24, name = 's' } = {}) {
  const pos = [];
  const quat = [];
  const fov = [];
  for (let i = 0; i < n; i++) {
    const s = f(i);
    pos.push(...s.pos);
    quat.push(...s.quat);
    fov.push(s.fov);
  }
  return { name, start, end: start + (n - 1) / fps, fps, pos, quat, fov, transition: 'cut' };
}

const yaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const wobbly = shot(30, (i) => ({ pos: [Math.sin(i * 0.3) * 20, i * 0.5, Math.cos(i * 0.21) * 7], quat: yaw(i * 0.05), fov: 30 + Math.sin(i * 0.4) * 4 }));

describe('sampleShot', () => {
  it('passes through every sample at its time', () => {
    for (let i = 0; i < 30; i++) {
      const s = sampleShot(wobbly, i / 24);
      expect(s.pos[0]).toBeCloseTo(wobbly.pos[i * 3], 9);
      expect(s.pos[1]).toBeCloseTo(wobbly.pos[i * 3 + 1], 9);
      expect(s.pos[2]).toBeCloseTo(wobbly.pos[i * 3 + 2], 9);
      expect(s.fov).toBeCloseTo(wobbly.fov[i], 9);
      for (let k = 0; k < 4; k++) expect(s.quat[k]).toBeCloseTo(wobbly.quat[i * 4 + k], 9);
    }
  });

  it('has no corner in its velocity at a sample (a 24 fps source plays smoothly at 60 fps)', () => {
    const h = 1e-5;
    for (const i of [3, 10, 17, 25]) {
      const t = i / 24;
      const a = sampleShot(wobbly, t - h).pos.slice();
      const m = sampleShot(wobbly, t).pos.slice();
      const b = sampleShot(wobbly, t + h).pos.slice();
      for (let k = 0; k < 3; k++) {
        const before = (m[k] - a[k]) / h;
        const after = (b[k] - m[k]) / h;
        expect(Math.abs(after - before)).toBeLessThan(1e-3 * Math.max(1, Math.abs(before)));
      }
    }
  });

  it('reproduces a steady move exactly between samples', () => {
    const line = shot(10, (i) => ({ pos: [i * 2, 5, -i], quat: [0, 0, 0, 1], fov: 40 + i }));
    for (const t of [0.013, 0.1, 0.2, 0.33]) {
      const s = sampleShot(line, t);
      const x = t * 24;
      expect(s.pos[0]).toBeCloseTo(x * 2, 9);
      expect(s.pos[2]).toBeCloseTo(-x, 9);
      expect(s.fov).toBeCloseTo(40 + x, 9);
    }
  });

  it('keeps rotations unit length and on course when neighbouring samples flip sign', () => {
    const flip = shot(8, (i) => ({ pos: [0, 0, 0], quat: yaw(i * 0.1).map((v) => (i % 2 ? -v : v)), fov: 40 }));
    for (let t = 0; t < 7 / 24; t += 0.007) {
      const q = sampleShot(flip, t).quat;
      expect(Math.hypot(...q)).toBeCloseTo(1, 12);
      // the yaw angle the spline gives is the steady turn's, whichever sign each sample carried
      const a = 2 * Math.atan2(Math.abs(q[1]), Math.abs(q[3]));
      expect(a).toBeCloseTo(t * 24 * 0.1, 3);
    }
  });

  it('holds the first and last samples beyond the shot, and plays a one-sample shot as a still', () => {
    const first = sampleShot(wobbly, -1);
    const last = sampleShot(wobbly, 99);
    expect(first.pos).toEqual(wobbly.pos.slice(0, 3));
    expect(last.pos.map((v) => +v.toFixed(9))).toEqual(wobbly.pos.slice(-3).map((v) => +v.toFixed(9)));
    const still = shot(1, () => ({ pos: [1, 2, 3], quat: [0, 0, 0, 1], fov: 50 }));
    expect(sampleShot(still, 0.5)).toEqual({ pos: [1, 2, 3], quat: [0, 0, 0, 1], fov: 50 });
  });
});

describe('shots', () => {
  const a = shot(25, () => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 30 }), { name: 'a' });
  const b = shot(25, () => ({ pos: [9, 9, 9], quat: [0, 0, 0, 1], fov: 60 }), { name: 'b', start: 1 });
  it('picks the shot playing at each time: a cut lands on the next shot', () => {
    expect(shotAt([a, b], -1)).toBe(0);
    expect(shotAt([a, b], 0.999)).toBe(0);
    expect(shotAt([a, b], 1)).toBe(1);
    expect(shotAt([a, b], 50)).toBe(1);
    expect(sampleShots([a, b], 0.5).fov).toBe(30);
    expect(sampleShots([a, b], 1.5).pos).toEqual([9, 9, 9]);
  });
});

describe('easing', () => {
  it('starts at 0, ends at 1, and never goes back', () => {
    for (const f of [smootherstep, easeInOutCubic, easeOutCubic]) {
      expect(f(-1)).toBe(0);
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(f(2)).toBe(1);
      let prev = 0;
      for (let x = 0; x <= 1; x += 0.01) {
        expect(f(x)).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = f(x);
      }
    }
    // a glide leaves and arrives at rest
    expect((smootherstep(0.001) - smootherstep(0)) / 0.001).toBeLessThan(1e-4);
    expect((smootherstep(1) - smootherstep(0.999)) / 0.001).toBeLessThan(1e-4);
  });
});
