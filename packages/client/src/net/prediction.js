// Prediction and reconciliation of the player's own mover (docs/ARCHITECTURE.md §7, §9; P1.E04.T03). The client moves its
// ship and its walker itself, frame by frame, and sends the pose it predicts; movement authority accepts it as sent or
// refuses it with a `correction`: the last pose the server can vouch for, as of the refused input's time. `Prediction`
// keeps what the client sent, and on a correction rewinds the mover to the server's pose at that input and replays what
// the client did since: its own motion, re-based on the server's pose, or, where the server refused the mode the client
// predicted (the pulse drive on a Charge it holds empty), the server's velocity carried on from there. Each snapshot says
// where the server holds the entity as of the last input it handled (`ack`): one further than MATCH_M from what the client
// sent then is a correction the client never heard (lost on the way), and is taken the same way. Inputs the client sent
// before it took a correction are the old trajectory, which the server refuses quietly: they are not compared.
//
// The rewind moves the mover at once, so its next input fits the server's pose. What that moves on screen is taken up by
// a `Blend`: an offset (and a turn) the drawn ship and both cameras carry, dying away critically damped, unless it is
// larger than the mover's speed over the round trip could make it (`snapLimit`), which is shown as the jump it is.
import * as THREE from 'three';
import { reframeAt } from '../remote/frames.js';

/** Inputs kept: about 3 s at 20 Hz. A correction answers an input at most a round trip and the server's 1 s grace old. */
export const HISTORY = 64;
/** A snapshot further than this (m) from what the client sent for its `ack` is a correction the client did not hear. */
export const MATCH_M = 0.5;
/** The time constant (s) a correction's drawn jump dies away with: the chase camera's own follow (8/s), so a blended
 * correction moves on screen as the camera's lag already does; mostly gone in four of them, inside the server's 1 s grace. */
export const BLEND_S = 0.125;
/** A drawn jump is blended up to this (m)... */
export const SNAP_M = 10;
/** ...or this many seconds of the mover's speed (a round trip and the blend); anything larger is shown as a jump. */
export const SNAP_S = 0.5;

/** The largest drawn jump blended rather than shown, for a mover at `speed` (m/s). */
export const snapLimit = (speed) => Math.max(SNAP_M, SNAP_S * speed);

const _q = new THREE.Quaternion();

/** A pose in three's objects (FrameState's shape, for `reframeAt`). */
const poseObjects = () => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3() });
const _server = poseObjects();
const _sent = poseObjects();

export class Prediction {
  /** `resolve(frameId)` is the client's frame object a wire frame id names (null: inertial; undefined: not this system's). */
  constructor(resolve) {
    this.resolve = resolve;
    /** what each input kept said, oldest first: {seq, time, frame, pos, quat, vel, mode} */
    this.sent = [];
    this.reset();
  }

  /** A new session: its inputs are numbered from 1 again. */
  reset() {
    this.sent.length = 0;
    /** the last input sent before the last correction was taken: up to it, the old trajectory */
    this.fence = 0;
    /** at the last snapshot compared, how far the server's pose was from the client's (m); the largest; how many were
     * compared; corrections taken, and how many of them only a snapshot told of */
    this.stats = { error: 0, maxError: 0, compared: 0, corrections: 0, unheard: 0 };
  }

  /** Keeps an input that went out (`{seq, time, mode, pose}`, as sent). */
  record(msg) {
    const frame = this.resolve(msg.pose.frame);
    if (frame === undefined) return;
    const r = this.sent.length >= HISTORY ? this.sent.shift() : { ...poseObjects() };
    r.seq = msg.seq;
    r.time = msg.time;
    r.frame = frame;
    r.pos.fromArray(msg.pose.pos);
    r.quat.fromArray(msg.pose.quat);
    r.vel.fromArray(msg.pose.vel);
    r.mode = msg.mode;
    this.sent.push(r);
  }

  /** What input `seq` said, or undefined when it is not kept. */
  at(seq) {
    const first = this.sent[0];
    const r = first && this.sent[seq - first.seq];
    return r?.seq === seq ? r : undefined;
  }

  /**
   * A snapshot's account of the player's entity (`entity`: its frame id, pose and mode) as of input `seq`, the snapshot's
   * `ack`, at world time `at`, the tick's (the server re-expresses a pose into another frame with both frames as they stand
   * at the tick): how far it is from what the client sent then. Returns the correction it shows the client did not hear
   * (`{seq, pose, mode}`: the pose further than MATCH_M off, or the pulse drive refused), else null.
   */
  check(seq, entity, at) {
    if (seq <= this.fence) return null;
    const r = this.at(seq);
    const frame = this.resolve(entity.frame);
    if (!r || frame === undefined) return null;
    const server = reframeAt(wireInto(_server, entity), frame, r.frame, at);
    const error = server.pos.distanceTo(r.pos);
    const s = this.stats;
    s.error = error;
    s.maxError = Math.max(s.maxError, error);
    s.compared++;
    if (error <= MATCH_M && (r.mode === 'pulse') === (entity.mode === 'pulse')) return null;
    s.unheard++;
    return { seq, pose: { frame: entity.frame, pos: entity.pos, quat: entity.quat, vel: entity.vel }, mode: entity.mode };
  }

  /** A correction is being taken, input `sentSeq` the last sent so far: those up to it are the old trajectory. */
  corrected(sentSeq) {
    this.fence = sentSeq;
    this.stats.corrections++;
  }

  /**
   * Rewinds a mover to where the server holds it, `pose` (a wire pose) in `mode` as of input `seq`, and replays what the
   * client did since: `state` (the mover's FrameState, in the frame it is in now, at world time `now`) keeps its motion in
   * the frame, or, where the server refused the mode the client sent, takes the server's velocity carried on from there.
   * A ship's turning since, in its own axes, is replayed onto the server's orientation; a walker faces its own heading.
   * False when there is nothing to rewind from (an input no longer kept, a frame not of this system).
   */
  take(seq, pose, mode, state, now) {
    const r = this.at(seq);
    const frame = this.resolve(pose.frame);
    if (!r || frame === undefined) return false;
    // both as they stood at that input's time, in the frame the mover is in now
    const server = reframeAt(wireInto(_server, pose), frame, state.frame, r.time);
    const sent = reframeAt(copyInto(_sent, r), r.frame, state.frame, r.time);
    if (mode !== r.mode) {
      state.pos.copy(server.pos).addScaledVector(server.vel, Math.max(0, now - r.time));
      state.vel.copy(server.vel);
    } else {
      state.pos.add(server.pos).sub(sent.pos);
      state.vel.add(server.vel).sub(sent.vel);
    }
    if (mode !== 'foot') state.quat.premultiply(_q.copy(sent.quat).invert()).premultiply(server.quat).normalize();
    return true;
  }
}

function wireInto(out, p) {
  out.pos.fromArray(p.pos);
  out.quat.fromArray(p.quat);
  out.vel.fromArray(p.vel);
  return out;
}

function copyInto(out, p) {
  out.pos.copy(p.pos);
  out.quat.copy(p.quat);
  out.vel.copy(p.vel);
  return out;
}

const _k = new THREE.Vector3();
const _w = new THREE.Quaternion();
const ONE = new THREE.Quaternion();

/**
 * What a mover is drawn with after a correction moved it: an offset in its frame's axes and the rate it changes at, and
 * a turn (drawn = turn × orientation), dying away critically damped over BLEND_S, so the drawn pose leaves from where and
 * as fast as it was drawn.
 */
export class Blend {
  constructor() {
    this.frame = null;
    this.offset = new THREE.Vector3();
    this.rate = new THREE.Vector3();
    this.turn = new THREE.Quaternion();
    this.on = false;
  }

  /**
   * The mover was drawn at `pos`, `quat`, moving at `vel` (its pose with the blend running, in `state`'s frame) and
   * `state` now stands where a correction put it: the difference is blended, unless it is larger than `snapLimit`.
   * Returns whether it was blended.
   */
  take(pos, quat, vel, state) {
    const offset = _k.subVectors(pos, state.pos);
    if (offset.length() > snapLimit(Math.max(vel.length(), state.vel.length()))) {
      this.clear();
      return false;
    }
    this.frame = state.frame;
    this.offset.copy(offset);
    this.rate.subVectors(vel, state.vel);
    this.turn.copy(quat).multiply(_q.copy(state.quat).invert()).normalize();
    this.on = true;
    return true;
  }

  clear() {
    this.offset.set(0, 0, 0);
    this.rate.set(0, 0, 0);
    this.turn.identity();
    this.on = false;
  }

  /** A frame's time on, the mover in `frame`. */
  step(dt, frame) {
    if (!this.on) return;
    this.into(frame);
    const fade = Math.exp(-dt / BLEND_S);
    // x(t) = (x0 + (v0 + x0/T) t) e^(-t/T), v(t) = (v0 - (v0 + x0/T) t/T) e^(-t/T)
    _k.copy(this.rate).addScaledVector(this.offset, 1 / BLEND_S);
    this.offset.addScaledVector(_k, dt).multiplyScalar(fade);
    this.rate.addScaledVector(_k, -dt / BLEND_S).multiplyScalar(fade);
    this.turn.slerp(ONE, 1 - fade);
    if (this.offset.lengthSq() < 1e-6 && this.rate.lengthSq() < 1e-6 && 1 - Math.abs(this.turn.w) < 1e-9) this.clear();
  }

  /** The drawn pose of `state` (a FrameState) into `out`: where it is, with the blend still running. */
  apply(state, out) {
    out.copy(state);
    if (!this.on) return out;
    this.into(state.frame);
    out.pos.add(this.offset);
    out.vel.add(this.rate);
    out.quat.premultiply(this.turn);
    return out;
  }

  // the blend into the axes of `frame`, which the mover changed into
  into(frame) {
    if (frame === this.frame) return;
    turnInto(this.offset, this.frame, frame);
    turnInto(this.rate, this.frame, frame);
    // (a turn in the old axes, conjugated into the new)
    if (this.frame) this.turn.premultiply(this.frame.quaternion).multiply(_w.copy(this.frame.quaternion).invert());
    if (frame) this.turn.premultiply(_w.copy(frame.quaternion).invert()).multiply(frame.quaternion);
    this.frame = frame;
  }
}

function turnInto(v, from, to) {
  if (from) from.dirToWorld(v, v);
  if (to) to.dirToLocal(v, v);
}
