// First-person cockpit interior with live instrument screens.
import * as THREE from 'three';

export const EYE = new THREE.Vector3(0, 1.52, -1.15);
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

function screen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { c, g: c.getContext('2d'), tex };
}

export class Cockpit {
  // The interior is modelled into the ship (CockpitInterior); this adds the live screens on its
  // ScreenLeft/Center/Right markers and animates the stick and throttle.
  constructor(ship) {
    this.ship = ship;
    this.group = new THREE.Group();
    const model = ship.model;
    this.interior = model.getObjectByName('CockpitInterior');
    this.interior.visible = false;
    this.stick = model.getObjectByName('CockpitStick');
    this.throttle = model.getObjectByName('CockpitThrottle');
    this.stickRest = this.stick.quaternion.clone();
    this.throttleRest = this.throttle.position.clone();

    this.left = screen(256, 160);
    this.center = screen(256, 256);
    this.right = screen(256, 160);
    const scrMat = (s) => new THREE.MeshBasicMaterial({ map: s.tex, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false });
    const mount = (name, w, h, s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), scrMat(s));
      model.getObjectByName(name).add(m);
    };
    mount('ScreenLeft', 0.3, 0.19, this.left);
    mount('ScreenCenter', 0.27, 0.27, this.center);
    mount('ScreenRight', 0.3, 0.19, this.right);
    this.timer = 0;
    this.time = 0;
  }

  setVisible(on) {
    this.interior.visible = on;
  }

  update(dt, game) {
    if (!this.interior.visible) return;
    this.time += dt;
    const ship = this.ship;
    // stick leans with the turn rates, throttle slides forward with speed
    _e.set(THREE.MathUtils.clamp(-ship.angVel.x * 0.25, -0.3, 0.3), 0, THREE.MathUtils.clamp(ship.angVel.y * 0.25, -0.3, 0.3));
    this.stick.quaternion.copy(this.stickRest).multiply(_q.setFromEuler(_e));
    this.throttle.position.copy(this.throttleRest);
    this.throttle.position.z -= Math.min(1, Math.abs(ship.speed) / 1500) * 0.3;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const cyan = '#6fe3ff';
    const amber = '#ffb547';
    // left: speed / altitude
    {
      const { g, c, tex } = this.left;
      g.fillStyle = '#04121a';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = cyan;
      g.font = "600 18px 'Barlow Condensed', sans-serif";
      g.fillText('VELOCITY', 14, 26);
      g.font = "500 46px 'Barlow Condensed', sans-serif";
      const v = Math.abs(ship.speed);
      const vs = v < 2000 ? v.toFixed(0) : (v / 1000).toFixed(1);
      g.fillText(vs, 14, 78);
      const vw = g.measureText(vs).width;
      g.font = "600 18px 'Barlow Condensed', sans-serif";
      g.fillText(v < 2000 ? 'M/S' : 'KM/S', 22 + vw, 78);
      g.font = "600 18px 'Barlow Condensed', sans-serif";
      g.fillStyle = amber;
      const alt = ship.altitude;
      g.fillText(isFinite(alt) && alt < 1e5 ? `ALT ${alt < 1000 ? alt.toFixed(0) + ' m' : (alt / 1000).toFixed(1) + ' km'}` : 'ALT ---', 14, 112);
      g.fillStyle = cyan;
      g.fillText(ship.mode.toUpperCase(), 14, 144);
      tex.needsUpdate = true;
    }
    // center: radar
    {
      const { g, c, tex } = this.center;
      const W = c.width;
      g.fillStyle = '#04121a';
      g.fillRect(0, 0, W, W);
      g.strokeStyle = 'rgba(111,227,255,0.5)';
      g.lineWidth = 2;
      for (const r of [40, 80, 118]) {
        g.beginPath();
        g.arc(W / 2, W / 2, r, 0, Math.PI * 2);
        g.stroke();
      }
      const sweep = (this.time * 2) % (Math.PI * 2);
      g.strokeStyle = 'rgba(111,227,255,0.8)';
      g.beginPath();
      g.moveTo(W / 2, W / 2);
      g.lineTo(W / 2 + Math.cos(sweep) * 118, W / 2 + Math.sin(sweep) * 118);
      g.stroke();
      // blips: bodies relative to ship heading
      const wq = ship.state.worldQuaternion(new THREE.Quaternion()).invert();
      const wp = ship.state.worldPosition(new THREE.Vector3());
      const blip = (world, col, size) => {
        const rel = world.clone().sub(wp).applyQuaternion(wq);
        const d = rel.length();
        const r = Math.min(110, Math.log10(1 + d / 200) * 30);
        const a = Math.atan2(rel.x, -rel.z);
        g.fillStyle = col;
        g.beginPath();
        g.arc(W / 2 + Math.sin(a) * r, W / 2 - Math.cos(a) * r, size, 0, Math.PI * 2);
        g.fill();
      };
      for (const p of game.system.planets) blip(p.position, cyan, p.kind === 'moon' ? 3 : 5);
      blip(game.station.position, amber, 4);
      g.fillStyle = '#fff';
      g.fillRect(W / 2 - 3, W / 2 - 3, 6, 6);
      tex.needsUpdate = true;
    }
    // right: shields / pulse
    {
      const { g, c, tex } = this.right;
      g.fillStyle = '#04121a';
      g.fillRect(0, 0, c.width, c.height);
      const bar = (label, v, y, col) => {
        g.fillStyle = col;
        g.font = "600 18px 'Barlow Condensed', sans-serif";
        g.fillText(label, 14, y);
        g.fillStyle = 'rgba(255,255,255,0.15)';
        g.fillRect(14, y + 8, 228, 14);
        g.fillStyle = col;
        g.fillRect(14, y + 8, 228 * Math.max(0, Math.min(1, v)), 14);
      };
      bar('SHIELDS', ship.shield / 100, 30, cyan);
      bar('CHARGE', ship.chargeMax > 0 ? ship.charge / ship.chargeMax : 0, 80, '#c7a6ff');
      g.fillStyle = amber;
      g.font = "600 16px 'Barlow Condensed', sans-serif";
      g.fillText(game.focusFrame ? game.focusFrame.name.toUpperCase() : 'DEEP SPACE', 14, 140);
      tex.needsUpdate = true;
    }
  }
}
