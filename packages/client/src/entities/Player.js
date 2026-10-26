// First-person explorer: walks on spherical planets (gravity toward the
// planet centre) or inside stations (artificial gravity), with jetpack & swimming.
import * as THREE from 'three';
import { FrameState } from '../universe/Body.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();

export const EYE_HEIGHT = 1.7;
const RADIUS = 0.38;
const HEIGHT = 1.85;

export class Player {
  constructor(game) {
    this.game = game;
    this.state = new FrameState();
    this.heading = new THREE.Vector3(0, 0, -1);
    this.pitch = 0;
    this.grounded = false;
    this.swimming = false;
    this.jetFuel = 1;
    this.jetting = false;
    this.health = 100;
    this.lifeSupport = 100;
    this.hazard = 100;
    this.stepTimer = 0;
    this.bob = 0;
    this.hSpeed = 0;
    this.sprinting = false;
    this.camQuat = new THREE.Quaternion();
    this.landShake = 0;
    this.fallSpeed = 0;
  }

  up(out) {
    const f = this.state.frame;
    if (!f || f.kind === 'station') return out.set(0, 1, 0);
    return out.copy(this.state.pos).normalize();
  }

  spawn(frame, feetPos, heading) {
    this.state.frame = frame;
    this.state.pos.copy(feetPos);
    this.state.vel.set(0, 0, 0);
    const up = this.up(_v);
    this.heading.copy(heading).addScaledVector(up, -heading.dot(up)).normalize();
    this.pitch = -0.05;
    this.grounded = false;
  }

  gravity() {
    const f = this.state.frame;
    if (!f) return 0;
    if (f.kind === 'station') return 9.0;
    return f.gravity || 9;
  }

  update(dt, input) {
    const s = this.state;
    const f = s.frame;
    const up = this.up(_v3).clone();

    // --- look ---
    const sens = 0.0021;
    const yaw = -input.mouseDX * sens;
    this.heading.addScaledVector(up, -this.heading.dot(up));
    if (this.heading.lengthSq() < 1e-6) this.heading.set(1, 0, 0).addScaledVector(up, -up.x).normalize();
    this.heading.normalize().applyAxisAngle(up, yaw);
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouseDY * sens, -1.52, 1.52);
    const right = _v.crossVectors(this.heading, up).normalize().clone();

    // --- environment ---
    const onPlanet = f && f.sampler;
    let seaDepth = -1;
    if (onPlanet && f.ocean && !f.waterEmissive) {
      seaDepth = f.radius - s.pos.length();
    }
    this.swimming = seaDepth > 1.1;
    this.headUnderwater = seaDepth > EYE_HEIGHT - 0.1;
    // lava seas burn
    if (onPlanet && f.ocean && f.waterEmissive && f.radius - s.pos.length() > -0.2) {
      this.health = Math.max(0, this.health - dt * 30);
      this.lavaT = (this.lavaT || 0) - dt;
      if (this.lavaT <= 0) {
        this.lavaT = 0.6;
        this.game.hud?.flash('damage');
        this.game.hud?.toast('LAVA! Get out!', 'warn');
        this.game.audio?.play('hurt');
      }
      s.vel.addScaledVector(s.pos.clone().normalize(), dt * 25);
    }

    // --- movement ---
    let fwdIn = 0;
    let strafeIn = 0;
    if (input.down('KeyW')) fwdIn += 1;
    if (input.down('KeyS')) fwdIn -= 1;
    if (input.down('KeyD')) strafeIn += 1;
    if (input.down('KeyA')) strafeIn -= 1;
    this.sprinting = input.down('ShiftLeft') && fwdIn > 0 && this.grounded;
    let speed = this.sprinting ? 9.5 : 5.2;
    if (this.swimming) speed = 3.2;
    const wish = _v2.copy(this.heading).multiplyScalar(fwdIn).addScaledVector(right, strafeIn);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);

    const vUp = s.vel.dot(up);
    const horiz = s.vel.clone().addScaledVector(up, -vUp);
    const accel = this.grounded ? 14 : this.swimming ? 4 : 2.2;
    horiz.lerp(wish, 1 - Math.exp(-dt * accel));
    let newUp = vUp;

    const g = this.gravity();
    if (this.swimming) {
      newUp = THREE.MathUtils.damp(newUp, input.down('Space') ? 2.5 : -0.4, 3, dt);
      this.jetFuel = Math.min(1, this.jetFuel + dt * 0.4);
    } else {
      newUp -= g * dt;
      // jump / jetpack
      if (input.hit('Space') && this.grounded) {
        newUp = 5.5;
        this.grounded = false;
        this.game.audio?.play('jump');
      }
      this.jetting = false;
      if (input.down('Space') && !this.grounded && this.jetFuel > 0 && this.airTime > 0.2) {
        newUp += (g + 9) * dt;
        newUp = Math.min(newUp, 14);
        horiz.addScaledVector(this.heading, fwdIn * 6 * dt);
        this.jetFuel = Math.max(0, this.jetFuel - (dt * 0.42) / (this.jetEfficiency || 1));
        this.jetting = true;
      }
      if (this.grounded) this.jetFuel = Math.min(1, this.jetFuel + dt * 0.6);
    }
    this.airTime = this.grounded ? 0 : (this.airTime || 0) + dt;
    s.vel.copy(horiz).addScaledVector(up, newUp);
    this.fallSpeed = -newUp;
    s.pos.addScaledVector(s.vel, dt);

    // --- collisions ---
    const wasGrounded = this.grounded;
    this.grounded = false;
    if (onPlanet) this.collideTerrain(f);
    if (f && f.kind === 'station') this.collideBoxes(f.playerColliders || f.colliders);
    this.collideShip();
    this.game.flora?.collidePlayer(this);
    this.game.structures?.collidePlayer(this);
    this.game.cities?.collidePlayer(this);
    this.game.fauna?.collidePlayer(this);
    this.game.ship?.collidePlayer(this);
    if (this.grounded && !wasGrounded && this.lastFall > 7) {
      this.landShake = Math.min(1, this.lastFall / 20);
      this.game.audio?.play('land');
      if (this.lastFall > 16) this.damage((this.lastFall - 16) * 4);
    }
    this.lastFall = this.fallSpeed;

    // footsteps & bob
    const hSpeed = horiz.length();
    this.hSpeed = hSpeed;
    if (this.grounded && hSpeed > 1) {
      this.bob += dt * hSpeed * 1.25;
      this.stepTimer -= dt * hSpeed;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.4;
        this.game.audio?.play('step', { surface: this.surfaceType() });
      }
    }
    this.landShake = Math.max(0, this.landShake - dt * 3);

    // --- frame changes (e.g. walking out of a station hangar) ---
  }

  surfaceType() {
    const f = this.state.frame;
    if (!f || f.kind === 'station') return 'metal';
    const t = f.params.type;
    if (t === 'frozen') return 'snow';
    if (t === 'desert') return 'sand';
    return 'ground';
  }

  collideTerrain(f) {
    const s = this.state;
    const r = s.pos.length();
    const dir = _v.copy(s.pos).divideScalar(r);
    const ground = f.surfaceRadius(dir);
    if (r <= ground + 0.02) {
      s.pos.copy(dir).multiplyScalar(ground);
      const vIn = s.vel.dot(dir);
      if (vIn < 0) s.vel.addScaledVector(dir, -vIn);
      this.grounded = true;
    }
  }

  collideBoxes(boxes) {
    if (!boxes) return;
    const s = this.state;
    const p = s.pos;
    for (const b of boxes) {
      // player AABB vs box
      const minX = p.x - RADIUS;
      const maxX = p.x + RADIUS;
      const minY = p.y;
      const maxY = p.y + HEIGHT;
      const minZ = p.z - RADIUS;
      const maxZ = p.z + RADIUS;
      if (maxX <= b.min.x || minX >= b.max.x || maxY <= b.min.y || minY >= b.max.y || maxZ <= b.min.z || minZ >= b.max.z) continue;
      const pushes = [
        [b.max.y - minY, 'y', 1],
        [maxY - b.min.y, 'y', -1],
        [b.max.x - minX, 'x', 1],
        [maxX - b.min.x, 'x', -1],
        [b.max.z - minZ, 'z', 1],
        [maxZ - b.min.z, 'z', -1],
      ];
      // prefer stepping up onto low obstacles (stairs)
      let best = pushes[0];
      if (best[0] > 0.45) {
        for (const pu of pushes) if (pu[0] < best[0]) best = pu;
      }
      const [d, axis, sign] = best;
      p[axis] += d * sign;
      if (axis === 'y' && sign > 0) {
        this.grounded = true;
        if (s.vel.y < 0) s.vel.y = 0;
      } else if (axis === 'y') {
        if (s.vel.y > 0) s.vel.y = 0;
      } else if (s.vel[axis] * sign < 0) {
        s.vel[axis] = 0;
      }
    }
  }

  collideShip() {
    const ship = this.game.ship;
    if (!ship || ship.state.frame !== this.state.frame) return;
    const s = this.state;
    // ship as a capsule along its local Z axis plus a wide wing slab
    const sp = ship.state.pos;
    const sq = ship.state.quat;
    const local = _v.copy(s.pos).sub(sp).applyQuaternion(sq.clone().invert());
    let pushed = false;
    // fuselage capsule
    const segZ = THREE.MathUtils.clamp(local.z, -5.5, 5.2);
    const dx = local.x;
    const dy = local.y + EYE_HEIGHT * 0.5 - 0.4;
    const dz = local.z - segZ;
    const d = Math.hypot(dx, dy, dz);
    const minD = 1.6 + RADIUS;
    if (d < minD && d > 1e-4) {
      const k = (minD - d) / d;
      local.x += dx * k;
      local.z += dz * k;
      pushed = true;
    }
    // wings + engines slab
    if (Math.abs(local.x) < 6.8 && local.z > -6.2 && local.z < 0 && local.y > -2.6 && local.y < 0.6) {
      const pen = 6.8 - Math.abs(local.x);
      const penZ = Math.min(local.z + 6, -local.z);
      if (pen < penZ) local.x += Math.sign(local.x) * pen;
      else local.z += local.z > -3 ? penZ : -penZ;
      pushed = true;
    }
    if (pushed) {
      s.pos.copy(local.applyQuaternion(sq)).add(sp);
    }
  }

  damage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.game.hud?.flash('damage');
    this.game.audio?.play('hurt');
  }

  // Camera transform in the player's frame
  cameraState(out, time) {
    const s = this.state;
    out.frame = s.frame;
    const up = this.up(_v3).clone();
    const bobAmt = this.grounded ? 1 : 0;
    const bobY = Math.sin(this.bob * 2) * 0.045 * bobAmt - this.landShake * 0.15;
    out.pos.copy(s.pos).addScaledVector(up, EYE_HEIGHT + bobY);
    const right = _v.crossVectors(this.heading, up).normalize();
    const fwd = _v2.copy(this.heading).applyAxisAngle(right, this.pitch);
    const camUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
    _m.makeBasis(right, camUp, fwd.clone().negate());
    out.quat.setFromRotationMatrix(_m);
    // subtle sway
    const sway = Math.sin(this.bob) * 0.006 * bobAmt;
    out.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), sway));
    this.camQuat.copy(out.quat);
    return out;
  }

  eyeForward(out) {
    return out.set(0, 0, -1).applyQuaternion(this.camQuat);
  }
}
