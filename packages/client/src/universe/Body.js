// Celestial body with orbit + spin. Every body is also a reference frame:
// entities near it store their state in its local (rotating) coordinates.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

export class Body {
  constructor(opts = {}) {
    this.name = opts.name || 'Body';
    this.kind = opts.kind || 'planet';
    this.parent = opts.parent || null;
    this.radius = opts.radius || 1000;
    this.orbitRadius = opts.orbitRadius || 0;
    this.orbitPeriod = opts.orbitPeriod || 1;
    this.orbitPhase = opts.orbitPhase || 0;
    this.orbitTilt = opts.orbitTilt ? opts.orbitTilt.clone() : new THREE.Quaternion();
    this.rotationPeriod = opts.rotationPeriod || 0;
    this.rotationPhase = opts.rotationPhase || 0;
    this.axialTilt = opts.axialTilt ? opts.axialTilt.clone() : new THREE.Quaternion();
    this.soi = opts.soi || this.radius * 4;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.quaternionInv = new THREE.Quaternion();
    this.angularVelocity = 0;
    this.root = new THREE.Group();
    this.root.name = this.name;
    this.children = [];
    if (this.parent) this.parent.children.push(this);
  }

  orbitPosition(t, out) {
    if (!this.parent || this.orbitRadius === 0) return out.set(0, 0, 0);
    const th = this.orbitPhase + (2 * Math.PI * t) / this.orbitPeriod;
    out.set(Math.cos(th) * this.orbitRadius, 0, Math.sin(th) * this.orbitRadius);
    out.applyQuaternion(this.orbitTilt);
    return out;
  }

  update(t) {
    if (this.parent) {
      this.orbitPosition(t, this.position).add(this.parent.position);
      const th = this.orbitPhase + (2 * Math.PI * t) / this.orbitPeriod;
      const w = (2 * Math.PI) / this.orbitPeriod;
      this.velocity
        .set(-Math.sin(th) * this.orbitRadius * w, 0, Math.cos(th) * this.orbitRadius * w)
        .applyQuaternion(this.orbitTilt)
        .add(this.parent.velocity);
    }
    if (this.rotationPeriod) {
      const a = this.rotationPhase + (2 * Math.PI * t) / this.rotationPeriod;
      _q.setFromAxisAngle(Y, a);
      this.quaternion.copy(this.axialTilt).multiply(_q);
      this.angularVelocity = (2 * Math.PI) / this.rotationPeriod;
    } else {
      this.quaternion.copy(this.axialTilt);
    }
    this.quaternionInv.copy(this.quaternion).invert();
  }

  localToWorld(local, out) {
    return out.copy(local).applyQuaternion(this.quaternion).add(this.position);
  }

  worldToLocal(world, out) {
    return out.copy(world).sub(this.position).applyQuaternion(this.quaternionInv);
  }

  dirToWorld(local, out) {
    return out.copy(local).applyQuaternion(this.quaternion);
  }

  dirToLocal(world, out) {
    return out.copy(world).applyQuaternion(this.quaternionInv);
  }

  // Place root relative to camera (floating origin)
  syncRoot(camWorld) {
    this.root.position.copy(this.position).sub(camWorld);
    this.root.quaternion.copy(this.quaternion);
  }

  distanceTo(world) {
    return _v.copy(world).sub(this.position).length();
  }
}

// Entity state expressed in a body's frame (or the inertial system frame when frame is null).
export class FrameState {
  constructor() {
    this.frame = null;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
  }

  worldPosition(out) {
    return this.frame ? this.frame.localToWorld(this.pos, out) : out.copy(this.pos);
  }

  worldQuaternion(out) {
    return this.frame ? out.copy(this.frame.quaternion).multiply(this.quat) : out.copy(this.quat);
  }

  worldDir(local, out) {
    return this.frame ? this.frame.dirToWorld(local, out) : out.copy(local);
  }

  // Re-express in a new frame. Velocity is treated as relative to the current frame
  // (arcade flight model) and is only rotated, never boosted by frame velocity.
  setFrame(frame) {
    if (frame === this.frame) return;
    const wp = this.worldPosition(new THREE.Vector3());
    const wq = this.worldQuaternion(new THREE.Quaternion());
    const wv = this.worldDir(this.vel, new THREE.Vector3());
    this.frame = frame;
    if (frame) {
      frame.worldToLocal(wp, this.pos);
      this.quat.copy(frame.quaternionInv).multiply(wq);
      frame.dirToLocal(wv, this.vel);
    } else {
      this.pos.copy(wp);
      this.quat.copy(wq);
      this.vel.copy(wv);
    }
  }

  copy(o) {
    this.frame = o.frame;
    this.pos.copy(o.pos);
    this.vel.copy(o.vel);
    this.quat.copy(o.quat);
    return this;
  }
}
