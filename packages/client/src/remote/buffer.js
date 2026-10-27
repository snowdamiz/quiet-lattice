// One remote entity's recent poses, as zone snapshots carried them (docs/ARCHITECTURE.md §9, "Remote entities"): a ring of
// samples stamped with their ticks' world times, all in one frame of reference, read at the render time some way behind
// the newest. Between two samples the pose is interpolated (a cubic Hermite on positions and velocities where the two
// agree, else a straight line; orientations slerped); past the newest it is extrapolated along the newest velocity for at
// most EXTRAPOLATE_S, then held. When a sample arrives in another frame (the entity crossed a sphere of influence) the
// samples already held are re-expressed in it, each with both frames as they stood at its own time, so the buffer is
// always in its newest sample's frame (and moved, all together, to meet the new sample, so the step into it is the motion
// riding with the old frame would have made). A sample that changes what the entity is (a pilot stepping out on foot, a walker
// boarding) or that no velocity explains (a teleport, a respawn) is a cut: nothing is interpolated across it.
import * as THREE from 'three';
import { reframeAt } from './frames.js';

/** Samples kept: 1.6 s at the zone's 20 Hz, well past the interpolation delay and the extrapolation window. */
export const BUFFER_SIZE = 32;
/** How far past its newest sample an entity is extrapolated (ARCHITECTURE §9); after that it holds. */
export const EXTRAPOLATE_S = 0.25;
/** A sample further than this from where the one before it and their velocities put it is a jump, not motion... */
export const TELEPORT_M = 1000;
/** ...or than this many seconds of its speed: a snapshot labels the last pose its client reported with the tick's time,
 * so when two reports land in one tick the spacing is off by a tick's travel (14 km at the pulse drive's 280 km/s). */
export const TELEPORT_S = 0.3;

/** How far off its motion an entity moving at `speed` (m/s) may be before it is a jump: TELEPORT_M, or TELEPORT_S of its
 * speed. */
export const jumpLimit = (speed) => Math.max(TELEPORT_M, speed * TELEPORT_S);
/** How far (s) past its tick's time a pose's own time may be taken to be: its client's reports reach the ticks a tick or
 * so apart. */
export const SKEW_S = 0.15;
/** ...and how far before it: two ticks, the spread of a client's reports' lags behind their ticks (the estimates sit
 * about their mean). Never more: a pose was taken before the tick that carried it, but not by much (its client reports
 * at the ticks' rate), and a client that stalls (its page busy, its frames running long and their steps clamped) moves
 * less than its velocity says, so by its motion its next pose would be taken further back still, and drawn ahead of
 * where it was. */
export const SKEW_LEAD_S = 0.1;
/** Below this speed (m/s) a pose's time is not estimated from its motion: the motion says too little. */
const SKEW_SPEED = 5;
/** How much of the estimated skew each sample keeps (the rest falls back to the tick's time over a second or so, so
 * errors never pile up). */
const SKEW_KEEP = 0.95;
/** How much of its pace (PoseBuffer.moved, .labelled) an entity's buffer keeps each sample: it is taken over the last
 * ten seconds or so... */
const PACE_KEEP = 0.995;
/** ...and over its first seconds counts only as a share of this many (s) of them, so the few at the start, which say
 * little, move it little. */
const PACE_RAMP_S = 3;

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3() };

class Sample {
  constructor() {
    /** the pose's own time as estimated (interpolation runs on it), its tick's time, and the difference */
    this.t = 0;
    this.label = 0;
    this.skew = 0;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.mode = null;
    /** nothing is interpolated across into this sample */
    this.cut = false;
    /** the segment from the sample before is a Hermite: their positions and velocities agree */
    this.smooth = false;
    /** re-expressed from another frame: its velocity was turned, not boosted, so it is not its position's rate here */
    this.conv = false;
  }
}

const onFoot = (mode) => mode === 'foot';
const same = (v, a) => v.x === a[0] && v.y === a[1] && v.z === a[2];
const sameQuat = (q, a) => q.x === a[0] && q.y === a[1] && q.z === a[2] && q.w === a[3];
const still = (a) => a[0] === 0 && a[1] === 0 && a[2] === 0;

export class PoseBuffer {
  constructor(size = BUFFER_SIZE) {
    this.size = size;
    this.ring = Array.from({ length: size }, () => new Sample());
    this.clear();
  }

  clear() {
    this.start = 0;
    this.length = 0;
    /** the frame every sample is in (a client body, the Waystation, or null for the inertial frame) */
    this.frame = null;
    // The entity's pace: the seconds its steps take at their velocities (`moved`) against the seconds of the labels
    // between them (`labelled`), each summed over the last few seconds. A client whose frames run long (their steps
    // clamped) moves less in a second than its velocity says; by its velocity alone its poses would be taken ever
    // earlier (or, moving more, ever later), drawn ahead of where it was, or further behind.
    this.moved = 0;
    this.labelled = 0;
  }

  /** The i-th sample held, oldest first. */
  at(i) {
    return this.ring[(this.start + i) % this.size];
  }

  get newest() {
    return this.length ? this.at(this.length - 1) : null;
  }

  /**
   * Adds the pose a snapshot carried at world time `t`: `frame` resolved to the client's frame object, `pos`, `quat`, `vel`
   * as the wire's arrays, `mode` the protocol's movement mode. Returns 'stale' (not newer than the newest), 'repeat' (a
   * moving entity's pose sent again: its client's next report had not reached the tick), 'cut', 'reframed' (the samples
   * held were re-expressed in `frame`) or 'ok'.
   */
  push(label, frame, pos, quat, vel, mode = null) {
    const prev = this.newest;
    if (prev && label <= prev.label) return 'stale';
    // The server sends the last pose the entity's client reported; a tick that saw no new report repeats it. A moving
    // entity is never in the same place twice, so the repeat says nothing about where it was at this tick.
    if (prev && frame === this.frame && same(prev.pos, pos) && sameQuat(prev.quat, quat) && !still(vel)) return 'repeat';
    // The pose's own time. Its tick's time labels the last report its client sent, which may be a tick old, or the
    // second of two that reached one tick: labelled as they are, a steady flight would lurch. Along a steady motion, how
    // much further the entity went than the labels' spacing says is how much further apart the reports were taken.
    let skew = 0;
    if (prev && frame === this.frame && onFoot(prev.mode) === onFoot(mode)) {
      const v = _v.fromArray(vel).add(prev.vel).multiplyScalar(0.5);
      const sp2 = v.lengthSq();
      if (sp2 > SKEW_SPEED * SKEW_SPEED) {
        // how long the step took at its velocities, at the entity's pace; how much longer than the labels say
        const took = _d.fromArray(pos).sub(prev.pos).dot(v) / sp2;
        const pace = Math.max(0.5, Math.min(2, 1 + (this.moved - this.labelled) / Math.max(this.labelled, PACE_RAMP_S)));
        const r = took / pace - (label - prev.label);
        if (Math.abs(r) <= 2 * SKEW_S) {
          skew = Math.max(-SKEW_LEAD_S, Math.min(SKEW_S, SKEW_KEEP * (prev.skew + r)));
          this.moved = PACE_KEEP * this.moved + took;
          this.labelled = PACE_KEEP * this.labelled + (label - prev.label);
        }
      }
    }
    const t = prev ? Math.max(label + skew, prev.t + 1e-3) : label;
    let result = 'ok';
    if (prev && frame !== this.frame) {
      // where the newest sample would be at this one's time, riding with its frame, as this frame sees it then
      _p.copy(prev.pos).addScaledVector(prev.vel, t - prev.t);
      _s.pos.copy(_p);
      _s.quat.copy(prev.quat);
      _s.vel.copy(prev.vel);
      reframeAt(_s, this.frame, frame, t);
      this.reframe(frame);
      // The samples held are moved to meet the new one: a client places itself in its new frame with its own clock,
      // which a hitch can leave tenths of a second off the server's that labels its poses, and the two frames move
      // apart by up to a kilometre a second. Held as they were, the step from the last of them to the new one would be a
      // slide of that much in a tick; moved, they carry on into it, and the drawn pose's change is blended out
      // (RemoteEntities) like any other.
      _d.subVectors(_p.fromArray(pos), _s.pos);
      for (let i = 0; i < this.length; i++) this.at(i).pos.add(_d);
      result = 'reframed';
    }
    this.frame = frame;
    if (this.length === this.size) {
      this.start = (this.start + 1) % this.size;
      this.length--;
    }
    const s = this.at(this.length);
    this.length++;
    s.t = t;
    s.label = label;
    s.skew = skew;
    s.pos.fromArray(pos);
    s.quat.fromArray(quat);
    s.vel.fromArray(vel);
    s.mode = mode;
    s.cut = false;
    s.smooth = false;
    s.conv = false;
    if (prev) {
      if (onFoot(prev.mode) !== onFoot(mode)) s.cut = true;
      else {
        // where the sample before and the two velocities put it, against where it is
        const miss = _d
          .copy(prev.vel)
          .add(s.vel)
          .multiplyScalar((t - prev.t) / 2)
          .add(prev.pos)
          .sub(s.pos)
          .length();
        if (miss > jumpLimit(Math.max(prev.vel.length(), s.vel.length()))) s.cut = true;
        else s.smooth = !prev.conv && miss <= Math.max(0.5, 0.2 * prev.pos.distanceTo(s.pos));
      }
    }
    return s.cut ? 'cut' : result;
  }

  /** Re-expresses every sample held in frame `to`, each with both frames as they stood at its own time. */
  reframe(to) {
    for (let i = 0; i < this.length; i++) {
      const s = this.at(i);
      reframeAt(s, this.frame, to, s.t);
      s.conv = true;
      s.smooth = false;
    }
    this.frame = to;
  }

  /**
   * The pose at world time `t` into `out` ({pos, quat, vel} in three's objects; `mode`, `frame` and `since`, the time of
   * the latest cut at or before the pose, are set too). Returns 'empty', 'early' (before the oldest sample: held there),
   * 'interpolate', 'extrapolate' (past the newest, within EXTRAPOLATE_S) or 'hold' (past that).
   */
  sample(t, out) {
    const n = this.length;
    if (!n) return 'empty';
    out.frame = this.frame;
    const first = this.at(0);
    if (t <= first.t) {
      copyPose(first, out);
      out.since = first.cut ? first.t : -Infinity;
      return 'early';
    }
    const last = this.at(n - 1);
    if (t >= last.t) {
      extrapolate(last, t, out);
      out.since = this.cutAtOrBefore(n - 1);
      return t - last.t <= EXTRAPOLATE_S ? 'extrapolate' : 'hold';
    }
    let i = n - 2;
    while (i > 0 && this.at(i).t > t) i--;
    const a = this.at(i);
    const b = this.at(i + 1);
    out.since = this.cutAtOrBefore(i);
    if (b.cut) {
      // nothing crosses into a cut: the pose before it carries on until the cut is due
      extrapolate(a, t, out);
      return 'interpolate';
    }
    const h = b.t - a.t;
    const u = (t - a.t) / h;
    if (b.smooth) hermite(a, b, h, u, out);
    else {
      out.pos.lerpVectors(a.pos, b.pos, u);
      out.vel.subVectors(b.pos, a.pos).divideScalar(h);
    }
    out.quat.slerpQuaternions(a.quat, b.quat, u);
    out.mode = a.mode;
    return 'interpolate';
  }

  cutAtOrBefore(i) {
    for (let j = i; j >= 0; j--) if (this.at(j).cut) return this.at(j).t;
    return -Infinity;
  }
}

function copyPose(s, out) {
  out.pos.copy(s.pos);
  out.quat.copy(s.quat);
  out.vel.copy(s.vel);
  out.mode = s.mode;
}

function extrapolate(s, t, out) {
  copyPose(s, out);
  out.pos.addScaledVector(s.vel, Math.min(Math.max(0, t - s.t), EXTRAPOLATE_S));
}

// The cubic Hermite through a and b with their velocities as tangents, at u in [0, 1] of a segment h seconds long; its
// rate at u is the velocity.
function hermite(a, b, h, u, out) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = (u3 - 2 * u2 + u) * h;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = (u3 - u2) * h;
  const d00 = (6 * u2 - 6 * u) / h;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = (-6 * u2 + 6 * u) / h;
  const d11 = 3 * u2 - 2 * u;
  const p0 = a.pos;
  const v0 = a.vel;
  const p1 = b.pos;
  const v1 = b.vel;
  out.pos.set(
    h00 * p0.x + h10 * v0.x + h01 * p1.x + h11 * v1.x,
    h00 * p0.y + h10 * v0.y + h01 * p1.y + h11 * v1.y,
    h00 * p0.z + h10 * v0.z + h01 * p1.z + h11 * v1.z,
  );
  out.vel.set(
    d00 * p0.x + d10 * v0.x + d01 * p1.x + d11 * v1.x,
    d00 * p0.y + d10 * v0.y + d01 * p1.y + d11 * v1.y,
    d00 * p0.z + d10 * v0.z + d01 * p1.z + d11 * v1.z,
  );
}
