// Pirate raids in deep space: pursuit / strafing AI, lasers, loot.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

let glowTex = null;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export class Pirates {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'pirates';
    game.engine.scene.add(this.group);
    this.nextRaid = 150 + Math.random() * 120;
    this.beams = [];
    this.fx = [];
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    this.beamGeo = geo;
    this.frame = null;
  }

  clear() {
    for (const p of this.list) this.group.remove(p.obj);
    for (const b of this.beams) this.group.remove(b.m);
    for (const e of this.fx) this.group.remove(e.sp);
    this.list = [];
    this.beams = [];
    this.fx = [];
    this.frame = null;
  }

  get active() {
    return this.list.length > 0;
  }

  makePirate() {
    const base = this.game.ship.model;
    const obj = base.clone(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.name === 'Hull') {
        o.material = o.material.clone();
        o.material.color.set(0x1c1d22);
      } else if (o.material.name === 'Accent') {
        o.material = o.material.clone();
        o.material.color.set(0xb01818);
      } else if (o.material.name === 'EngineGlow') {
        o.material = o.material.clone();
        o.material.emissive.setRGB(1, 0.25, 0.1);
        o.material.emissiveIntensity = 2;
      }
      if (/^Gear/.test(o.parent?.name || '')) o.visible = false;
    });
    obj.traverse((o) => {
      if (/^Gear(Front|Left|Right)$/.test(o.name)) o.visible = false;
    });
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: new THREE.Color(3, 0.8, 0.3), blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.position.set(0, 0.4, 6.2);
    flame.scale.setScalar(3.5);
    obj.add(flame);
    this.group.add(obj);
    return obj;
  }

  spawnRaid() {
    const g = this.game;
    const ship = g.ship;
    const s = ship.state;
    if (ship.mode === 'pulse') {
      ship.exitPulse();
      g.hud.toast('Pulse drive interrupted!', 'warn');
    }
    this.frame = s.frame;
    const n = 2 + Math.floor(Math.random() * 2);
    const back = _v.set(0, 0, 1).applyQuaternion(s.quat);
    const right = _v2.set(1, 0, 0).applyQuaternion(s.quat);
    for (let i = 0; i < n; i++) {
      const pos = s.pos.clone().addScaledVector(back, 1800 + Math.random() * 800).addScaledVector(right, (i - n / 2) * 250);
      const obj = this.makePirate();
      const quat = s.quat.clone();
      this.list.push({ obj, pos, vel: new THREE.Vector3(), quat, hp: 100, shield: 60, speed: 380, cooldown: 2 + Math.random() * 2, breakOff: 0, wobble: Math.random() * 10 });
    }
    g.hud.showBanner('PIRATES DETECTED', 'Hostile starships inbound', ['Fight them off with [LMB] or outrun them']);
    g.audio.play('error');
  }

  update(dt) {
    const g = this.game;
    const ship = g.ship;
    const s = ship.state;
    const inSpace = g.mode === 'ship' && (ship.mode === 'flying' || ship.mode === 'pulse') && ship.atmoDensity < 0.001 &&
      (!s.frame || s.frame.kind !== 'station') && (!isFinite(ship.altitude) || ship.altitude > 15000) && !g.universe.deep;
    if (!this.active) {
      if (inSpace) this.nextRaid -= dt;
      if (this.nextRaid <= 0 && inSpace && g.ship.model) {
        this.nextRaid = 240 + Math.random() * 240;
        this.spawnRaid();
      }
    }
    // keep pirates in the ship's frame
    if (this.active && this.frame !== s.frame) {
      for (const p of this.list) {
        const wp = this.frame ? this.frame.localToWorld(p.pos, new THREE.Vector3()) : p.pos.clone();
        const wq = this.frame ? this.frame.quaternion.clone().multiply(p.quat) : p.quat.clone();
        if (s.frame) {
          s.frame.worldToLocal(wp, p.pos);
          p.quat.copy(s.frame.quaternionInv).multiply(wq);
        } else {
          p.pos.copy(wp);
          p.quat.copy(wq);
        }
      }
      this.frame = s.frame;
    }
    // disengage if the player docks or lands
    if (this.active && (g.mode !== 'ship' || (s.frame && s.frame.kind === 'station') || ship.atmoDensity > 0.05)) {
      for (const p of this.list) this.group.remove(p.obj);
      this.list = [];
      g.hud.toast('Pirates broke off pursuit', 'good');
    }
    // iterate a snapshot: a pirate's shot can end the raid (playerDefeated clears the list)
    for (const p of [...this.list]) {
      if (!this.list.includes(p)) break;
      this.think(p, dt);
    }
    this.dt = dt;
    if (ship.lastHit === undefined || g.time - ship.lastHit > 6) ship.shield = Math.min(100, ship.shield + dt * 4);
  }

  // called after the camera transform for this frame is known
  syncVisual() {
    const g = this.game;
    for (const p of this.list) {
      const wp = this.frame ? this.frame.localToWorld(p.pos, _v) : _v.copy(p.pos);
      p.obj.position.copy(wp).sub(g.camWorld);
      if (this.frame) p.obj.quaternion.copy(this.frame.quaternion).multiply(p.quat);
      else p.obj.quaternion.copy(p.quat);
    }
    this.updateBeams(this.dt || 0);
  }

  think(p, dt) {
    const g = this.game;
    const s = g.ship.state;
    const to = _v.copy(s.pos).sub(p.pos);
    const d = to.length();
    to.divideScalar(d || 1);
    p.breakOff -= dt;
    let desired = to.clone();
    if (p.breakOff > 0) {
      desired = p.breakDir;
    } else if (d < 220) {
      p.breakOff = 2.5 + Math.random() * 1.5;
      p.breakDir = to.clone().negate().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)).normalize();
    } else {
      // lead the target a little
      desired.addScaledVector(s.vel, 0.6 / Math.max(300, d)).normalize();
      desired.x += Math.sin(g.time * 0.7 + p.wobble) * 0.05;
      desired.y += Math.cos(g.time * 0.5 + p.wobble) * 0.05;
      desired.normalize();
    }
    // turn toward desired
    _m.lookAt(_v2.set(0, 0, 0), desired, new THREE.Vector3(0, 1, 0).applyQuaternion(p.quat));
    _q.setFromRotationMatrix(_m);
    p.quat.slerp(_q, 1 - Math.exp(-dt * 1.4));
    const fwd = _v2.set(0, 0, -1).applyQuaternion(p.quat);
    const targetSpeed = d > 1500 ? 700 : 360;
    p.speed = THREE.MathUtils.damp(p.speed, targetSpeed, 1, dt);
    p.vel.copy(fwd).multiplyScalar(p.speed);
    p.pos.addScaledVector(p.vel, dt);
    // fire
    p.cooldown -= dt;
    const aim = fwd.dot(to);
    if (p.cooldown <= 0 && aim > 0.985 && d < 1400 && p.breakOff <= 0) {
      p.cooldown = 0.45 + Math.random() * 0.4;
      const hit = Math.random() < (aim - 0.985) * 30 + 0.15;
      const target = s.pos.clone().add(hit ? new THREE.Vector3() : new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30));
      this.addBeam(p.pos.clone().addScaledVector(fwd, 6), target, new THREE.Color(5, 0.5, 0.3));
      g.audio.play('shipLaser');
      if (hit) {
        g.ship.lastHit = g.time;
        g.ship.damage(2.5 + Math.random() * 2);
        g.ship.shake = Math.max(g.ship.shake, 0.4);
        if (g.ship.shield <= 0) this.playerDefeated();
      }
    }
  }

  playerDefeated() {
    const g = this.game;
    for (const p of this.list) this.group.remove(p.obj);
    this.list = [];
    const loss = Math.floor(g.inventory.units * 0.15);
    g.inventory.units -= loss;
    g.hud.showBanner('SHIP DISABLED', 'Emergency tow to station', [`Repair costs: -${loss} units`]);
    g.hud.flash('damage');
    g.placeShipNearStation();
    g.ship.shield = 60;
  }

  shipFired(ship) {
    if (!this.active) return;
    const s = ship.state;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
    let best = null;
    for (const p of this.list) {
      const to = p.pos.clone().sub(s.pos);
      const d = to.length();
      const a = to.normalize().dot(fwd);
      if (d < 1800 && a > 0.992 && (!best || a > best.a)) best = { p, a, d };
    }
    if (!best) return;
    const p = best.p;
    const dmg = 9 + Math.random() * 4;
    if (p.shield > 0) p.shield -= dmg;
    else p.hp -= dmg;
    this.spark(p.pos.clone(), new THREE.Color(2, 3, 5), 0.25, 6);
    if (p.hp <= 0) this.destroy(p);
  }

  destroy(p) {
    const g = this.game;
    this.list = this.list.filter((x) => x !== p);
    this.group.remove(p.obj);
    this.spark(p.pos.clone(), new THREE.Color(6, 3, 1), 1.2, 60);
    g.audio.play('explode');
    const units = 250 + Math.floor(Math.random() * 500);
    g.inventory.units += units;
    const res = ['gold', 'cobalt', 'copper', 'tritium'][Math.floor(Math.random() * 4)];
    const n = 15 + Math.floor(Math.random() * 30);
    g.inventory.add(res, n);
    g.hud.toast(`Pirate destroyed: +${units} units`, 'good');
    setTimeout(() => g.hud.pickup(res, n), 400);
    if (!this.list.length) {
      setTimeout(() => g.hud.showBanner('THREAT ELIMINATED', 'Pirate raid repelled', []), 800);
    }
  }

  addBeam(from, to, color) {
    const m = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.frustumCulled = false;
    this.group.add(m);
    this.beams.push({ m, from, to, life: 0.15 });
  }

  spark(pos, color, life, size) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(sp);
    this.fx.push({ sp, pos, life, max: life, size });
  }

  updateBeams(dt) {
    const g = this.game;
    const f = this.frame;
    const toWorld = (v) => (f ? f.localToWorld(v, new THREE.Vector3()) : v.clone()).sub(g.camWorld);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.group.remove(b.m);
        b.m.material.dispose();
        this.beams.splice(i, 1);
        continue;
      }
      const a = toWorld(b.from);
      const c = toWorld(b.to);
      b.m.position.copy(a);
      b.m.lookAt(c);
      const w = 0.35;
      b.m.scale.set(w, w, a.distanceTo(c));
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const e = this.fx[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.group.remove(e.sp);
        e.sp.material.dispose();
        this.fx.splice(i, 1);
        continue;
      }
      e.sp.position.copy(toWorld(e.pos));
      const t = 1 - e.life / e.max;
      e.sp.scale.setScalar(e.size * (0.5 + t * 1.5));
      e.sp.material.opacity = 1 - t;
    }
  }

  markers() {
    const g = this.game;
    return this.list.map((p) => ({
      world: this.frame ? this.frame.localToWorld(p.pos, new THREE.Vector3()) : p.pos.clone(),
      label: `Pirate ${p.shield > 0 ? '◆' : '◇'} ${Math.max(0, Math.round(p.hp))}%`,
    }));
  }
}
