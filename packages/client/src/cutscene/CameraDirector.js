// The camera-glide system (DESIGN 20.1 keeps it; 19.2: cutscene cameras are curves it follows). Every move of the
// camera that is not the views' own: an ease between the near and far chase views, a glide between viewpoints in a frame
// (into or out of the seat, down to the pilot's eyes beside the ship), a cut behind a short dip from black, and a
// cutscene's camera, glided into from the player's view and back out to it.
//
// While a glide or a cutscene has the camera, the views (the ship's chase camera, the walker's eyes) keep computing the
// player's camera into a copy (viewTarget()), and the director places the real one (game.cam) from it.
import * as THREE from 'three';
import { FrameState } from '../universe/Body.js';
import { mixPoses } from './space.js';
import { smootherstep } from './curve.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
// in ship space: moves into or out of the seat drop vertically through the canopy glass above
// the pilot (between the frame bars), and from the chase view they first rise over the hull
const SEAT_ABOVE = new THREE.Vector3(0, 5.6, -0.6);
const HULL_ABOVE = new THREE.Vector3(0, 9, 7);
/** A cutscene's camera glides from or to the player's only within this distance (m); further, it cuts behind a dip. */
const GLIDE_REACH = 600;
/** Seconds of the dip a cutscene cuts behind. */
const CUT_DIP = 0.45;

export class CameraDirector {
  constructor(game) {
    this.game = game;
    /** easing between the near and far chase views */
    this.blend = null;
    /** a glide between viewpoints in a frame (pose blend) */
    this.pose = null;
    /** a fade up from black after a cut */
    this.dip = null;
    /** a cutscene's camera */
    this.cine = null;
    this._cut = new FrameState();
  }

  /** Where the views write the player's camera this frame: the real camera, or the copy a glide or cutscene keeps. */
  viewTarget() {
    return this.pose ? this.pose.target : this.cine ? this.cine.view : this.game.cam;
  }

  /** Drops the glides between views (the camera snaps to wherever the views put it next). */
  stop() {
    this.blend = null;
    this.pose = null;
  }

  /** Drops the glides and any dip under way: an instant move (teleports, the review scene). */
  clear() {
    this.stop();
    this.dip = null;
    this.game.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, 0);
  }

  /** Each frame, once the views have computed the player's camera. */
  update(dt) {
    this.updateDip(dt);
    this.applyBlend(dt);
    this.applyPose(dt);
    this.applyCutscene(dt);
  }

  // ---------- between views ----------

  // Ease the camera from where it was to the new viewpoint (between the near and far chase
  // views) instead of cutting. The start pose is kept relative to the ship, so a switch at speed
  // does not leave it behind.
  startCamBlend(dur = 0.9) {
    const { cam } = this.game;
    const s = this.game.ship.state;
    if (!cam.frame || cam.frame !== s.frame) return;
    const inv = s.quat.clone().invert();
    this.blend = {
      pos: cam.pos.clone().sub(s.pos).applyQuaternion(inv),
      quat: inv.multiply(cam.quat),
      frame: s.frame,
      t: 0,
      dur,
    };
  }

  applyBlend(dt) {
    const b = this.blend;
    if (!b) return;
    const { cam } = this.game;
    const s = this.game.ship.state;
    b.t += dt / b.dur;
    if (b.t >= 1 || cam.frame !== b.frame || s.frame !== b.frame) {
      this.blend = null;
      return;
    }
    const k = b.t * b.t * (3 - 2 * b.t);
    const from = _v1.copy(b.pos).applyQuaternion(s.quat).add(s.pos);
    const fromQ = s.quat.clone().multiply(b.quat);
    cam.pos.lerpVectors(from, cam.pos, k);
    cam.quat.slerpQuaternions(fromQ, cam.quat, k);
  }

  // Glide the camera from where it is now to a new viewpoint in the same frame (the seat, the
  // chase view, the pilot's eyes on foot), arcing up and over things instead of cutting. The
  // destination keeps being computed as usual, into pose.target. With `seat` the path drops
  // through the canopy glass, and the cockpit interior shows only while the camera is inside.
  startPoseBlend(dur, seat = false) {
    const g = this.game;
    // (a cutscene has the camera: the views just change underneath it)
    if (this.cine) return;
    // (between frames, in open space, it falls back to the fade)
    if (!g.cam.frame || g.cam.frame !== g.ship.state.frame) {
      this.startDip(0.45);
      return;
    }
    this.blend = null;
    this.dip = null;
    g.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, 0);
    const target = this.pose?.target || new FrameState();
    target.frame = g.cam.frame;
    target.pos.copy(g.cam.pos);
    target.quat.copy(g.cam.quat);
    // the start is held in ship space, so a glide into the seat at speed keeps up with the ship
    const s = g.ship.state;
    const inv = s.quat.clone().invert();
    const pos = g.cam.pos.clone().sub(s.pos).applyQuaternion(inv);
    const quat = inv.multiply(g.cam.quat);
    this.pose = { frame: g.cam.frame, pos, quat, t: 0, dur, seat, target, fromFoot: g.mode === 'foot' };
  }

  applyPose(dt) {
    const b = this.pose;
    if (!b) return;
    const g = this.game;
    const { cam, ship } = g;
    const tg = b.target;
    b.t += dt / b.dur;
    if (b.t >= 1 || tg.frame !== b.frame || ship.state.frame !== b.frame) {
      this.pose = null;
      cam.frame = tg.frame;
      cam.pos.copy(tg.pos);
      cam.quat.copy(tg.quat);
      ship.setCockpitVisual(ship.inCockpit && g.mode === 'ship');
      for (const m of ship.canopyParts || []) m.visible = true;
      return;
    }
    const k = b.t * b.t * (3 - 2 * b.t);
    const s = ship.state;
    const from = _v4.copy(b.pos).applyQuaternion(s.quat).add(s.pos);
    const to = tg.pos;
    const up = b.frame.sampler ? _v2.copy(to).normalize() : _v2.set(0, 1, 0);
    let c1;
    let c2;
    if (b.seat) {
      const into = g.mode === 'ship' && ship.inCockpit;
      const seat = _v3.copy(SEAT_ABOVE).applyQuaternion(s.quat).add(s.pos);
      const far = b.fromFoot || g.mode === 'foot' ? _v5.copy(into ? from : to).addScaledVector(up, 3) : _v5.copy(HULL_ABOVE).applyQuaternion(s.quat).add(s.pos);
      c1 = into ? far : seat;
      c2 = into ? seat : far;
    } else {
      // round the ship's side, bowing out (away from the side the walker stands on) at about the
      // height of the ends: craning up and over the hull read as a whip, and a straight line, or a
      // bow towards the tail, skimmed the wing
      const away = _v6.copy(b.fromFoot ? from : to).sub(s.pos);
      away.addScaledVector(up, -away.dot(up));
      if (away.lengthSq() < 1) away.set(1, 0, 0).applyQuaternion(s.quat);
      away.normalize();
      const bow = Math.max(3, from.distanceTo(to) * 0.3);
      c1 = _v5.copy(from).addScaledVector(away, bow).addScaledVector(up, 1);
      c2 = _v3.copy(to).addScaledVector(away, bow).addScaledVector(up, 1);
    }
    const u = 1 - k;
    const p = _v1.copy(from).multiplyScalar(u * u * u).addScaledVector(c1, 3 * u * u * k).addScaledVector(c2, 3 * u * k * k).addScaledVector(to, k * k * k);
    if (b.seat) {
      const l = _v4.copy(p).sub(s.pos).applyQuaternion(_q1.copy(s.quat).invert());
      // passing through the canopy: the glass and its frame go (seen from a hand's width away they
      // were an opaque slab filling the view) and the cockpit shows below
      const over = Math.abs(l.x) < 1.6 && l.z < 2.2 && l.z > -4.0;
      const inside = over && l.y < 1.95;
      const near = over && !inside && l.y < 5.8;
      ship.setCockpitVisual(inside || near);
      for (const m of ship.canopyParts || []) m.visible = !near;
      // and the plasma sheath round the hull dims while the camera is inside it
      const close = 1 - THREE.MathUtils.smoothstep(l.length(), 5, 16);
      if (ship.reentryMat) ship.reentryMat.uniforms.uPower.value *= 1 - 0.85 * close;
    }
    cam.frame = b.frame;
    cam.pos.copy(p);
    cam.quat.slerpQuaternions(_q1.copy(s.quat).multiply(b.quat), tg.quat, k);
    if (!b.seat) {
      // keep the ship in frame on the way: turn towards it through the middle of the move
      const at = _v4.copy(s.pos).addScaledVector(up, 1.5);
      _m4.lookAt(p, at, up);
      _q2.setFromRotationMatrix(_m4);
      cam.quat.slerp(_q2, Math.sin(Math.PI * k) * 0.5);
    }
    // look down at the canopy while passing over it
    if (b.seat) cam.quat.multiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0), -Math.sin(Math.PI * k) * 0.18));
  }

  // ---------- cuts ----------

  // Cut to the new viewpoint behind a short fade from black.
  startDip(dur = 0.35) {
    this.stop();
    this.dip = { t: 0, dur };
    this.game.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, 1);
  }

  updateDip(dt) {
    const d = this.dip;
    if (!d) return;
    d.t += dt / d.dur;
    const a = Math.max(0, 1 - d.t);
    this.game.engine.gradePass.uniforms.uFlash.value.set(0, 0, 0, a * a);
    if (d.t >= 1) this.dip = null;
  }

  // ---------- cutscenes ----------

  /**
   * A cutscene takes the camera. `source.pose(out)` puts its camera into `out` (a FrameState) and returns the screen's
   * vertical field of view. `enter` 'glide' eases from the player's view into the cutscene's over `dur` seconds (a dip
   * instead when the two are far apart, or from the cockpit seat, where the way out runs through the hull); 'dip' cuts
   * behind a fade from black; 'cut' cuts.
   */
  takeOver(source, { enter = 'glide', dur = 1.6 } = {}) {
    const g = this.game;
    const view = new FrameState();
    // the player's camera as the views last left it (a glide under way finishes where it was going)
    view.copy(this.pose ? this.pose.target : g.cam);
    if (this.pose) this.finishPose();
    this.blend = null;
    const fov = source.pose(this._cut);
    let how = enter;
    // (a camera the views have not placed yet, just after a teleport, has nowhere to glide from)
    if (enter === 'glide' && view.frame === undefined) how = 'cut';
    else if (enter === 'glide' && (this.farFrom(view, this._cut) || this.seated())) how = 'dip';
    this.cine = { source, view, phase: 'in', t: 0, dur: how === 'glide' ? dur : 0, fov, w: 0, held: null, heldFov: fov, shown: null };
    if (how === 'dip') this.startDip(CUT_DIP);
    // the views that belong to the player's camera go: the cockpit interior, the hand and its tool
    g.engine.viewScene.visible = false;
    if (g.ship.inCockpit) g.ship.setCockpitVisual(false);
    this.applyCutscene(0);
  }

  /**
   * The cutscene gives the camera back. `exit` 'glide' eases from the cutscene's last pose back to the player's over
   * `dur` seconds (a dip instead when far apart, or into the cockpit seat); 'dip' cuts behind a fade from black.
   */
  release({ exit = 'glide', dur = 1.5 } = {}) {
    const c = this.cine;
    if (!c || c.phase === 'out') return;
    const held = new FrameState().copy(this.game.cam);
    const how = exit === 'glide' && (this.farFrom(held, c.view) || this.seated()) ? 'dip' : exit;
    // (from the field of view last shown: a skip during the glide in leaves from between the two)
    Object.assign(c, { phase: 'out', t: 0, dur: how === 'glide' ? dur : 0, held, heldFov: c.shown ?? c.fov, w: 0 });
    if (how === 'dip') this.startDip(CUT_DIP);
    this.applyCutscene(0);
  }

  /** Ends a cutscene's hold on the camera at once, back on the player's view (no glide, no dip). */
  abort() {
    if (this.cine) this.finishCutscene();
  }

  /** The screen's vertical field of view, given the player's (`base`): the cutscene's, or between the two while gliding. */
  fov(base) {
    const c = this.cine;
    if (!c) return base;
    c.shown = c.phase === 'out' ? c.heldFov + (base - c.heldFov) * c.w : base + (c.fov - base) * c.w;
    return c.shown;
  }

  applyCutscene(dt) {
    const c = this.cine;
    if (!c) return;
    const g = this.game;
    c.t += dt;
    c.w = c.dur > 0 ? smootherstep(c.t / c.dur) : 1;
    if (c.phase === 'out') {
      if (c.w >= 1) this.finishCutscene();
      else mixPoses(c.held, c.view, c.w, c.view.frame, g.cam);
      return;
    }
    c.fov = c.source.pose(this._cut);
    if (c.w < 1) mixPoses(c.view, this._cut, c.w, this._cut.frame, g.cam);
    else {
      g.cam.frame = this._cut.frame;
      g.cam.pos.copy(this._cut.pos);
      g.cam.quat.copy(this._cut.quat);
    }
    if (c.phase === 'in' && c.w >= 1) c.phase = 'on';
  }

  /** The camera back on the player's view, and the views a cutscene hid. */
  finishCutscene() {
    const g = this.game;
    g.cam.copy(this.cine.view);
    this.cine = null;
    g.engine.viewScene.visible = true;
    g.ship.setCockpitVisual(g.ship.inCockpit && g.mode === 'ship');
  }

  farFrom(a, b) {
    return a.worldPosition(_v1).distanceTo(b.worldPosition(_v2)) > GLIDE_REACH;
  }

  /** The player sits in the cockpit seat: a glide to or from it would pass through the hull. */
  seated() {
    return this.game.mode === 'ship' && this.game.ship.inCockpit;
  }

  /** Ends a pose blend where it was going, as its last frame would. */
  finishPose() {
    const g = this.game;
    const tg = this.pose.target;
    this.pose = null;
    g.cam.copy(tg);
    g.ship.setCockpitVisual(g.ship.inCockpit && g.mode === 'ship');
    for (const m of g.ship.canopyParts || []) m.visible = true;
  }
}
