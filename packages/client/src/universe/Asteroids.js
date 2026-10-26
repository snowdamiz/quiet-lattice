// Procedural asteroid fields in heliocentric space: dense in the belt, sparse
// elsewhere. Ship lasers break them apart for Tritium and rare metals.
import * as THREE from 'three';
import { hashInts, mulberry32 } from '../math/rng.js';
import { Simplex3 } from '../math/noise.js';
import { applyPanelDetail } from '../render/panelMaterial.js';

const CELL = 3000;
const RANGE = 2;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function rockGeo(seed, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const n = new Simplex3(seed);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let d = 1 + n.noise(x * 1.3, y * 1.3, z * 1.3) * 0.35 + n.noise(x * 3.1, y * 3.1, z * 3.1) * 0.12;
    // craters
    d -= Math.max(0, n.noise(x * 2 + 9, y * 2, z * 2) - 0.45) * 0.6;
    p.setXYZ(i, x * d, y * d * 0.8, z * d);
  }
  g.computeVertexNormals();
  return g;
}

export class Asteroids {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'asteroids';
    this.cells = new Map();
    this.destroyed = new Set();
    this.damage = new Map();
    const mat = applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0x6f6861, roughness: 0.92, metalness: 0.05, envMapIntensity: 0.3 }), { scale: 0.05, strength: 0.25 });
    this.meshes = [];
    for (let k = 0; k < 3; k++) {
      const mesh = new THREE.InstancedMesh(rockGeo(100 + k, 3), mat, 600);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(600 * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.list = [];
    this.debris = [];
    this.lastCell = '';
  }

  configure(system) {
    this.system = system;
    this.cells.clear();
    this.destroyed.clear();
    this.list = [];
    this.lastCell = '';
  }

  densityAt(world) {
    const sys = this.system;
    const star = sys.star.position;
    const dx = world.x - star.x;
    const dz = world.z - star.z;
    const r = Math.hypot(dx, dz);
    const b = sys.belt;
    let d = 0.04;
    const t = Math.abs(r - b.radius) / b.width;
    if (t < 1 && Math.abs(world.y - star.y) < b.thickness) d += (1 - t * t) * 1.6 * b.density;
    // keep clear of planets' inner space
    for (const p of sys.planets) {
      const dd = p.distanceTo(world);
      if (dd < p.radius * 2.2) return 0;
      if (dd < p.soi) d += 0.05;
    }
    return d;
  }

  genCell(cx, cy, cz) {
    const seed = hashInts(this.system.seed, cx, cy, cz);
    const rng = mulberry32(seed);
    const center = new THREE.Vector3((cx + 0.5) * CELL, (cy + 0.5) * CELL, (cz + 0.5) * CELL);
    const density = this.densityAt(center);
    const count = Math.floor(density * 14 + rng());
    const items = [];
    for (let i = 0; i < count; i++) {
      const id = `${cx}_${cy}_${cz}_${i}`;
      const pos = new THREE.Vector3(cx * CELL + rng() * CELL, cy * CELL + rng() * CELL, cz * CELL + rng() * CELL);
      const size = 6 + Math.pow(rng(), 3) * 90;
      if (this.destroyed.has(id)) continue;
      if (this.densityAt(pos) === 0) continue;
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      const rich = rng();
      items.push({
        id, pos, size, axis, spin: (rng() - 0.5) * 0.3, phase: rng() * 6, kind: Math.floor(rng() * 3),
        rich: rich > 0.9 ? 'gold' : rich > 0.8 ? 'cobalt' : rich > 0.7 ? 'copper' : null,
        tint: 0.75 + rng() * 0.35,
      });
    }
    return items;
  }

  update(dt) {
    const g = this.game;
    if (g.mode === 'title' || !this.system || g.universe.dormant) {
      for (const m of this.meshes) m.count = 0;
      return;
    }
    const cam = g.camWorld;
    const cx = Math.floor(cam.x / CELL);
    const cy = Math.floor(cam.y / CELL);
    const cz = Math.floor(cam.z / CELL);
    const key = `${cx}_${cy}_${cz}`;
    if (key !== this.lastCell) {
      this.lastCell = key;
      const keep = new Set();
      for (let x = -RANGE; x <= RANGE; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -RANGE; z <= RANGE; z++) {
            const k = `${cx + x}_${cy + y}_${cz + z}`;
            keep.add(k);
            if (!this.cells.has(k)) this.cells.set(k, this.genCell(cx + x, cy + y, cz + z));
          }
      for (const k of this.cells.keys()) if (!keep.has(k)) this.cells.delete(k);
      this.list = [...this.cells.values()].flat();
    }
    const counts = [0, 0, 0];
    const col = new THREE.Color();
    // the station orbits through the field: keep a clear bubble round it (and out of its hangar)
    const station = g.station?.position;
    for (const a of this.list) {
      const rel = _v.copy(a.pos).sub(cam);
      const d = rel.length();
      if (d > CELL * RANGE) continue;
      const clear = station ? THREE.MathUtils.smoothstep(a.pos.distanceTo(station) - a.size, 500, 900) : 1;
      if (clear < 0.01) continue;
      const mesh = this.meshes[a.kind];
      const n = counts[a.kind]++;
      if (n >= 600) continue;
      _q.setFromAxisAngle(a.axis, a.phase + g.time * a.spin);
      const fade = 1 - THREE.MathUtils.smoothstep(d, CELL * RANGE * 0.8, CELL * RANGE);
      _s.setScalar(a.size * fade * clear);
      _m.compose(rel, _q, _s);
      mesh.setMatrixAt(n, _m);
      if (a.rich === 'gold') col.setRGB(1.1, 0.95, 0.6);
      else if (a.rich === 'cobalt') col.setRGB(0.6, 0.75, 1.2);
      else if (a.rich === 'copper') col.setRGB(1.15, 0.75, 0.55);
      else {
        // dark basalt to dusty brown and cold grey, so the field is not one tone of popcorn
        const t = a.tint * a.tint * 0.95;
        const w = ((a.tint * 13.7) % 1) * 2 - 1;
        col.setRGB(t * (1 + 0.16 * w), t * (1 + 0.02 * w), t * (1 - 0.12 * w));
      }
      mesh.setColorAt(n, col);
    }
    this.meshes.forEach((m, i) => {
      m.count = Math.min(600, counts[i]);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    });
    this.collideShip(dt);
    this.updateDebris(dt);
  }

  collideShip() {
    const ship = this.game.ship;
    if (ship.mode !== 'flying' && ship.mode !== 'pulse') return;
    const wp = ship.state.worldPosition(_v2);
    for (const a of this.list) {
      const d = a.pos.distanceTo(wp);
      const r = a.size * 0.95 + 5;
      if (d < r) {
        const n = _v.copy(wp).sub(a.pos).normalize();
        const push = n.clone().multiplyScalar(r - d);
        const localPush = ship.state.frame ? ship.state.frame.dirToLocal(push, new THREE.Vector3()) : push;
        ship.state.pos.add(localPush);
        const ln = ship.state.frame ? ship.state.frame.dirToLocal(n, new THREE.Vector3()) : n;
        const vn = ship.state.vel.dot(ln);
        if (vn < 0) {
          ship.state.vel.addScaledVector(ln, -vn * 1.4);
          if (vn < -30) ship.damage(Math.min(30, -vn * 0.15));
        }
        if (ship.mode === 'pulse') {
          ship.exitPulse();
          ship.damage(15);
        }
        ship.speed *= 0.5;
      }
    }
  }

  shipFired(ship) {
    // hitscan along the ship's nose
    const g = this.game;
    const origin = ship.state.worldPosition(new THREE.Vector3());
    const dir = ship.state.worldDir(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.state.quat), new THREE.Vector3()).normalize();
    let best = null;
    for (const a of this.list) {
      const oc = _v.copy(origin).sub(a.pos);
      const b = oc.dot(dir);
      const c = oc.lengthSq() - a.size * a.size;
      const h = b * b - c;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t > 0 && t < 1500 && (!best || t < best.t)) best = { a, t };
    }
    if (!best) return;
    const a = best.a;
    const hp = (this.damage.get(a.id) ?? a.size * 0.25) - 1;
    const hitPos = origin.clone().addScaledVector(dir, best.t);
    this.spawnDebris(hitPos, dir.clone().negate(), 6, 0.6);
    if (hp > 0) {
      this.damage.set(a.id, hp);
      return;
    }
    // destroyed
    this.destroyed.add(a.id);
    this.list = this.list.filter((x) => x !== a);
    for (const items of this.cells.values()) {
      const i = items.indexOf(a);
      if (i >= 0) items.splice(i, 1);
    }
    this.spawnDebris(a.pos, null, 40, a.size * 0.08);
    g.audio.play('explode');
    const amount = Math.round(20 + a.size * 1.2);
    g.inventory.add('tritium', amount);
    g.hud.pickup('tritium', amount);
    if (a.rich) {
      const extra = Math.round(10 + a.size * 0.4);
      g.inventory.add(a.rich, extra);
      setTimeout(() => g.hud.pickup(a.rich, extra), 300);
    }
    g.audio.play('pickup');
  }

  spawnDebris(pos, dir, n, size) {
    if (!this.debrisMesh) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a817a, roughness: 0.9, emissive: 0xff6020, emissiveIntensity: 0.6 });
      this.debrisMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1), mat, 500);
      this.debrisMesh.frustumCulled = false;
      this.debrisMesh.count = 0;
      this.group.add(this.debrisMesh);
    }
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(10 + Math.random() * 40);
      if (dir) v.addScaledVector(dir, 20);
      this.debris.push({ p: pos.clone(), v, life: 2 + Math.random() * 2, s: size * (0.5 + Math.random()), r: Math.random() * 6 });
    }
  }

  updateDebris(dt) {
    if (!this.debrisMesh) return;
    const cam = this.game.camWorld;
    let n = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.debris.splice(i, 1);
        continue;
      }
      d.p.addScaledVector(d.v, dt);
      d.r += dt * 3;
      if (n < 500) {
        _q.setFromAxisAngle(_v.set(1, 0.5, 0.2).normalize(), d.r);
        _s.setScalar(d.s * Math.min(1, d.life));
        _m.compose(_v2.copy(d.p).sub(cam), _q, _s);
        this.debrisMesh.setMatrixAt(n++, _m);
      }
    }
    this.debrisMesh.count = n;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
  }
}
