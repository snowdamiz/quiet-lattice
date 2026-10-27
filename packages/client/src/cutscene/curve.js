// Cutscene camera curves (docs/ARCHITECTURE.md "Cutscenes"). A shot is the camera Blender evaluated at every frame of
// its range (packages/tools/blender/export_cutscene.py): positions, rotations and the vertical field of view, sampled
// at the source's frame rate. Samples are evenly spaced in time, so playback runs a Catmull-Rom spline through them in
// time (central-difference tangents): it passes through every sample at its time and its velocity has no corners, so
// a 24 fps source plays at 60 fps without stepping. Rotations take the same spline on the quaternion's components
// (each neighbour turned into the first's hemisphere) and are normalised; the samples are close enough together that
// this cannot be told from a true spherical spline.

/** Hermite basis on [0, 1] with the tangents scaled to the segment. */
function hermite(p0, p1, p2, p3, u, n0, n3) {
  // tangents: central differences, one-sided at the ends of the shot (p0 = p1 or p3 = p2 there)
  const m1 = (p2 - p0) / n0;
  const m2 = (p3 - p1) / n3;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}

/** Number of samples in a shot. */
export function sampleCount(shot) {
  return shot.fov.length;
}

/** The shot playing at cutscene time `t`: the last one starting at or before it (the first before any). */
export function shotAt(shots, t) {
  let i = 0;
  while (i + 1 < shots.length && shots[i + 1].start <= t) i++;
  return i;
}

/**
 * The shot's camera at cutscene time `t` (clamped to the shot), into `out` ({pos: [3], quat: [4], fov}) in the
 * cutscene's authoring space.
 */
export function sampleShot(shot, t, out = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 50 }) {
  const n = sampleCount(shot);
  const x = Math.min(Math.max((t - shot.start) * shot.fps, 0), n - 1);
  const i1 = Math.min(Math.floor(x), Math.max(0, n - 2));
  const i2 = Math.min(i1 + 1, n - 1);
  const u = n === 1 ? 0 : x - i1;
  const i0 = Math.max(i1 - 1, 0);
  const i3 = Math.min(i2 + 1, n - 1);
  // the tangent's span in samples: two for a central difference, one at either end
  const n0 = i2 - i0 || 1;
  const n3 = i3 - i1 || 1;
  const P = shot.pos;
  for (let k = 0; k < 3; k++) out.pos[k] = hermite(P[i0 * 3 + k], P[i1 * 3 + k], P[i2 * 3 + k], P[i3 * 3 + k], u, n0, n3);
  const F = shot.fov;
  out.fov = hermite(F[i0], F[i1], F[i2], F[i3], u, n0, n3);
  // the four rotations, each turned to the same side as q1 (q and -q are one rotation)
  const Q = shot.quat;
  const sign = (i) => (Q[i * 4] * Q[i1 * 4] + Q[i * 4 + 1] * Q[i1 * 4 + 1] + Q[i * 4 + 2] * Q[i1 * 4 + 2] + Q[i * 4 + 3] * Q[i1 * 4 + 3] < 0 ? -1 : 1);
  const s0 = sign(i0);
  const s2 = sign(i2);
  const s3 = sign(i3);
  let len = 0;
  for (let k = 0; k < 4; k++) {
    const v = hermite(s0 * Q[i0 * 4 + k], Q[i1 * 4 + k], s2 * Q[i2 * 4 + k], s3 * Q[i3 * 4 + k], u, n0, n3);
    out.quat[k] = v;
    len += v * v;
  }
  len = Math.sqrt(len) || 1;
  for (let k = 0; k < 4; k++) out.quat[k] /= len;
  return out;
}

/** The camera at cutscene time `t`: the shot playing then, sampled. */
export function sampleShots(shots, t, out) {
  return sampleShot(shots[shotAt(shots, t)], t, out);
}

// ---------- easing ----------

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Eases in and out with no jolt at either end (zero speed and acceleration): camera glides. */
export const smootherstep = (x) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Cubic ease in and out: the letterbox and the dialogue bar. */
export const easeInOutCubic = (x) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
/** Eases out (fast start, soft landing): a line of dialogue rising into place. */
export const easeOutCubic = (x) => 1 - (1 - clamp01(x)) ** 3;
