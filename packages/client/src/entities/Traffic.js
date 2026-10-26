// NPC starships that arrive at the station, land on free pads, idle and depart.
import * as THREE from 'three';
import { GEAR_HEIGHT } from './Ship.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

const LIVERIES = [
  [0x3a6fd8, 0xe8e8e8], [0xc83a3a, 0x2a2a2a], [0x2fae6a, 0xf0d040], [0xe0b030, 0x303540],
  [0x8a4ad0, 0xf0f0f0], [0xd8d8d8, 0x2a8ad8], [0x404850, 0xff7020],
];

export class Traffic {
  constructor(game) {
    this.game = game;
    this.ships = [];
    this.station = null;
  }

  attach(station) {
    for (const s of this.ships) s.obj.parent?.remove(s.obj);
    this.ships = [];
    this.station = station;
    const base = this.game.ship.model;
    if (!base || !station) return;
    const count = 5;
    for (let i = 0; i < count; i++) {
      const obj = base.clone(true);
      const [hullCol, accentCol] = LIVERIES[(i + (station.seed % 7)) % LIVERIES.length];
      const gears = [];
      obj.traverse((o) => {
        if (o.isMesh) {
          if (o.material.name === 'Hull') {
            o.material = o.material.clone();
            o.material.color.set(hullCol);
          } else if (o.material.name === 'Accent') {
            o.material = o.material.clone();
            o.material.color.set(accentCol);
          }
          o.castShadow = true;
        }
        if (/^Gear(Front|Left|Right)$/.test(o.name)) gears.push(o);
      });
      obj.scale.setScalar(0.9 + Math.random() * 0.3);
      station.root.add(obj);
      const s = { obj, gears, state: 'parked', timer: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), pad: null, path: [], gear: 1 };
      this.ships.push(s);
      // stagger: some start parked, some in flight
      if (i < 2) this.parkOnFreePad(s, 5 + Math.random() * 30);
      else this.startArrival(s, Math.random());
    }
  }

  // NPCs never take the last free pad, so the player can always dock
  claimPad(s) {
    const free = this.station.pads.filter((p) => !p.occupied);
    if (free.length <= 1) return null;
    const pad = free[Math.floor(Math.random() * free.length)];
    pad.occupied = s;
    return pad;
  }

  parkOnFreePad(s, time) {
    const pad = this.claimPad(s);
    if (!pad) return this.startArrival(s, Math.random() * 0.5);
    s.pad = pad;
    s.state = 'parked';
    s.timer = time;
    s.pos.set(pad.x, pad.y + GEAR_HEIGHT, pad.z);
    s.quat.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
  }

  randomFar() {
    return new THREE.Vector3((Math.random() - 0.5) * 3000, (Math.random() - 0.3) * 1200, 2500 + Math.random() * 2000);
  }

  startArrival(s, progress = 0) {
    s.state = 'arrive';
    s.pad = null;
    s.path = [this.randomFar(), new THREE.Vector3((Math.random() - 0.5) * 40, 18, 160), new THREE.Vector3(0, 16, 40)];
    s.pos.copy(s.path[0]).lerp(s.path[1], progress * 0.8);
    s.speed = 220;
    s.quat.setFromRotationMatrix(_m.lookAt(s.pos, s.path[1], UP));
  }

  startDeparture(s, immediate = false) {
    // keep the pad reserved until the ship has cleared the hangar
    if (immediate && s.pad) {
      s.pad.occupied = null;
      s.pad = null;
    }
    s.state = immediate ? 'leave' : 'lift';
    s.timer = 0;
    s.path = [new THREE.Vector3(s.pos.x * 0.3, 16, 60), new THREE.Vector3((Math.random() - 0.5) * 60, 22, 200), this.randomFar()];
    s.speed = 0;
  }

  update(dt) {
    if (!this.station) return;
    const near = this.game.cam.frame === this.station || this.station.distanceTo(this.game.camWorld) < 8000;
    for (const s of this.ships) {
      s.obj.visible = near;
      this.step(s, dt);
      s.obj.position.copy(s.pos);
      s.obj.quaternion.copy(s.quat);
      const wantGear = s.state === 'parked' || s.state === 'land' || s.state === 'lift' ? 1 : 0;
      s.gear = THREE.MathUtils.damp(s.gear, wantGear, 3, dt);
      for (const g of s.gears) {
        g.rotation.x = (1 - s.gear) * -1.35;
        g.scale.setScalar(0.35 + 0.65 * s.gear);
      }
    }
  }

  flyToward(s, target, speed, dt, turn = 2) {
    const to = _v.copy(target).sub(s.pos);
    const d = to.length();
    const dir = to.divideScalar(d || 1);
    s.speed = THREE.MathUtils.damp(s.speed, speed, 1.2, dt);
    s.pos.addScaledVector(dir, Math.min(d, s.speed * dt));
    _q.setFromRotationMatrix(_m.lookAt(s.pos, target, UP));
    s.quat.slerp(_q, 1 - Math.exp(-dt * turn));
    return d;
  }

  step(s, dt) {
    switch (s.state) {
      case 'parked':
        s.timer -= dt;
        if (s.timer <= 0) this.startDeparture(s);
        break;
      case 'arrive': {
        const target = s.path[0 + (s.leg || 0) + 1] || s.path[s.path.length - 1];
        const speed = (s.leg || 0) === 0 ? 220 : 40;
        const d = this.flyToward(s, target, speed, dt);
        if (d < 15) {
          s.leg = (s.leg || 0) + 1;
          if (s.leg >= s.path.length - 1) {
            const pad = this.claimPad(s);
            s.leg = 0;
            if (!pad) {
              this.startDeparture(s, true);
              break;
            }
            s.pad = pad;
            s.state = 'approach';
          }
        }
        break;
      }
      case 'approach': {
        const hover = _v.set(s.pad.x, 14, s.pad.z).clone();
        const d = this.flyToward(s, hover, 18, dt, 1.5);
        if (d < 1.5) s.state = 'land';
        break;
      }
      case 'land': {
        const ty = s.pad.y + GEAR_HEIGHT;
        s.pos.y = THREE.MathUtils.damp(s.pos.y, ty, 1.2, dt);
        const level = _q.copy(s.quat);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(level).setY(0).normalize();
        _m.lookAt(new THREE.Vector3(), fwd, UP);
        s.quat.slerp(_q.setFromRotationMatrix(_m), 1 - Math.exp(-dt * 2));
        if (Math.abs(s.pos.y - ty) < 0.05) {
          s.state = 'parked';
          s.timer = 20 + Math.random() * 40;
        }
        break;
      }
      case 'lift':
        s.pos.y = THREE.MathUtils.damp(s.pos.y, 16, 1.0, dt);
        s.timer += dt;
        if (s.timer > 3) {
          s.state = 'leave';
          s.leg = 0;
        }
        break;
      case 'leave': {
        const target = s.path[s.leg || 0];
        const speed = (s.leg || 0) < 2 ? 50 : 320;
        const d = this.flyToward(s, target, speed, dt, 1.6);
        if (d < 20) {
          s.leg = (s.leg || 0) + 1;
          if (s.leg >= 2 && s.pad) {
            s.pad.occupied = null;
            s.pad = null;
          }
          if (s.leg >= s.path.length) {
            s.leg = 0;
            this.startArrival(s, 0);
          }
        }
        break;
      }
    }
  }
}
