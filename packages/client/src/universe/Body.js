// Celestial body with orbit + spin. Every body is also a reference frame:
// entities near it store their state in its local (rotating) coordinates.
// Its pose at time t and the frame rules are @astra/shared/world's (kinematics.ts),
// which the server uses too: each body is its own motion spec and its own pose.
import * as THREE from 'three';
import { bodyPoseInto, dirToLocalInto, dirToWorldInto, localToWorldInto, setFrameInto, worldToLocalInto } from '@astra/shared/world';

const _v = new THREE.Vector3();

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
    // world axis it turns about, scaled by its rate (rad/s)
    this.angularVelocity = new THREE.Vector3();
    this.root = new THREE.Group();
    this.root.name = this.name;
    this.children = [];
    if (this.parent) this.parent.children.push(this);
  }

  // pose at world time t (its parent's must already be updated)
  update(t) {
    bodyPoseInto(this, t, this.parent, this);
    this.quaternionInv.copy(this.quaternion).invert();
  }

  localToWorld(local, out) {
    return localToWorldInto(this, local, out);
  }

  worldToLocal(world, out) {
    return worldToLocalInto(this, world, out);
  }

  dirToWorld(local, out) {
    return dirToWorldInto(this, local, out);
  }

  dirToLocal(world, out) {
    return dirToLocalInto(this, world, out);
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
    setFrameInto(this, this.frame, frame);
    this.frame = frame;
  }

  copy(o) {
    this.frame = o.frame;
    this.pos.copy(o.pos);
    this.vel.copy(o.vel);
    this.quat.copy(o.quat);
    return this;
  }
}
