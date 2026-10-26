// Lightning on storm worlds: a jagged, branching bolt from the cloud deck to the ground a few km
// off (close by when one hits the ship), a hot white core in a soft glow, flickering two or three
// times in a fraction of a second. Built in the planet's own frame, turned to face the camera.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Lightning {
  constructor(game) {
    this.game = game;
    this.bolts = [];
    const mat = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    // (very hot: a real bolt reads through kilometres of rain, and the core writes depth so the
    // atmosphere pass hazes it over its own few km, not over the whole sky behind it)
    this.core = mat(new THREE.Color(40, 44, 66), 1);
    this.core.depthWrite = true;
    this.glow = mat(new THREE.Color(2.4, 2.7, 4.2), 0.3);
  }

  // midpoint displacement: a crooked path from a to b, kicked sideways at every level
  jag(a, b, depth, rough, out = [a]) {
    if (depth === 0) {
      out.push(b);
      return out;
    }
    const m = a.clone().lerp(b, 0.5);
    const len = a.distanceTo(b);
    m.add(_v.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).multiplyScalar(len * rough));
    this.jag(a, m, depth - 1, rough, out);
    return this.jag(m, b, depth - 1, rough, out);
  }

  // a camera-facing ribbon along the points, `width` metres across
  ribbon(pts, width, eye, taper = true) {
    const pos = [];
    const idx = [];
    const t = new THREE.Vector3();
    const side = new THREE.Vector3();
    pts.forEach((p, i) => {
      t.copy(pts[Math.min(i + 1, pts.length - 1)]).sub(pts[Math.max(i - 1, 0)]).normalize();
      side.crossVectors(t, _v.copy(eye).sub(p)).normalize();
      const w = width * (taper ? 0.35 + 0.65 * (1 - i / (pts.length - 1)) : 1) * 0.5;
      pos.push(p.x + side.x * w, p.y + side.y * w, p.z + side.z * w, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      if (i) idx.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  strike(planet, near = false) {
    const g = this.game;
    if (!planet?.sampler) return;
    const eye = planet.worldToLocal(g.camWorld, new THREE.Vector3());
    const up = eye.clone().normalize();
    // somewhere in front, more or less: that is where you will see it
    const fwd = planet.dirToLocal(new THREE.Vector3(0, 0, -1).applyQuaternion(g.camWorldQuat), new THREE.Vector3());
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up);
    const a = (Math.random() - 0.5) * 2.4;
    const dist = near ? 250 + Math.random() * 450 : 1500 + Math.random() * 6000;
    const dir = up.clone().multiplyScalar(planet.radius).addScaledVector(fwd, Math.cos(a) * dist).addScaledVector(right, Math.sin(a) * dist).normalize();
    const ground = dir.clone().multiplyScalar(planet.groundRadius(dir));
    // (from the cloud deck, or from well above a peak that stands up into it)
    const topR = Math.max(planet.radius * planet.cloudBase + 150, ground.length() + 900 + Math.random() * 500);
    const top = dir.clone().multiplyScalar(topR).addScaledVector(right, (Math.random() - 0.5) * 600);
    const main = this.jag(top, ground, 7, 0.16);
    const group = new THREE.Group();
    const add = (pts, w) => {
      group.add(new THREE.Mesh(this.ribbon(pts, w, eye), this.core), new THREE.Mesh(this.ribbon(pts, w * 9, eye, false), this.glow));
    };
    add(main, 5);
    // branches forking off the upper part of the bolt and dying away
    for (let b = 0; b < 2 + Math.floor(Math.random() * 3); b++) {
      const from = main[Math.floor(Math.random() * main.length * 0.6)];
      const to = from.clone().lerp(ground, 0.2 + Math.random() * 0.35).add(_v.set(Math.random() - 0.5, -0.2, Math.random() - 0.5).multiplyScalar(from.distanceTo(ground) * 0.35));
      add(this.jag(from, to, 5, 0.22), 2.2);
    }
    for (const m of group.children) m.frustumCulled = false;
    planet.root.add(group);
    this.bolts.push({ group, t: 0, life: 0.35 + Math.random() * 0.25, seed: Math.random() * 10 });
    return ground.distanceTo(eye);
  }

  update(dt) {
    for (const b of this.bolts) {
      b.t += dt;
      // two or three flickers, then gone
      const on = Math.sin(b.t * 55 + b.seed) > -0.3 ? 1 : 0.15;
      b.group.visible = b.t < b.life && on > 0.5;
    }
    for (const b of this.bolts.filter((x) => x.t >= x.life)) {
      b.group.parent?.remove(b.group);
      for (const m of b.group.children) m.geometry.dispose();
    }
    this.bolts = this.bolts.filter((x) => x.t < x.life);
  }
}
