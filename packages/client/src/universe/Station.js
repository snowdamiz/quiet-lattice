// Orbital trading station. Built procedurally from merged boxes/cylinders so
// it doubles as a set of axis-aligned colliders for walking and flying.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Body } from './Body.js';
import { applyPanelDetail } from '../render/panelMaterial.js';
import { mulberry32, STATION, stationPoseInto } from '@astra/shared/world';
import { STATION_FABRICATOR, STATION_HANGAR, STATION_LAYOUT } from '@astra/shared/data';

const _v = new THREE.Vector3();

// hangar interior bounds and pads: shared with the server's movement authority (@astra/shared/data, station.ts)
export const HANGAR = STATION_HANGAR;

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#30343a';
  g.fillRect(0, 0, 512, 512);
  // floor plates
  g.strokeStyle = '#2a2d31';
  g.lineWidth = 3;
  for (let i = 0; i <= 512; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 512);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(512, i);
    g.stroke();
  }
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 20, 2 + Math.random() * 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function padTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#26292e';
  g.fillRect(0, 0, 512, 512);
  g.translate(256, 256);
  // hazard ring
  for (let a = 0; a < 48; a++) {
    g.fillStyle = a % 2 ? '#111' : '#e8b020';
    g.beginPath();
    g.arc(0, 0, 250, (a / 48) * Math.PI * 2, ((a + 1) / 48) * Math.PI * 2);
    g.arc(0, 0, 225, ((a + 1) / 48) * Math.PI * 2, (a / 48) * Math.PI * 2, true);
    g.fill();
  }
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.beginPath();
  g.arc(0, 0, 200, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = color;
  g.font = 'bold 220px Orbitron, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', 0, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#7fe6ff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // long station names shrink to fit the board
  g.font = '700 110px Orbitron, sans-serif';
  const size = Math.min(110, Math.floor((110 * 940) / g.measureText(text.toUpperCase()).width));
  g.font = `700 ${size}px Orbitron, sans-serif`;
  g.fillText(text.toUpperCase(), 512, 110);
  g.font = '500 38px Rajdhani, sans-serif';
  g.fillStyle = '#ffb547';
  g.fillText('TRADE · REFUEL · OUTFIT', 512, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// soft radial blob for floor light pools and contact shadows
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// painted bay marking for the hangar walls
function bayTexture(n) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#23262b';
  g.fillRect(0, 0, 1024, 256);
  // hazard band along the bottom
  for (let x = -40; x < 1024; x += 56) {
    g.fillStyle = '#e0a91c';
    g.beginPath();
    g.moveTo(x, 256);
    g.lineTo(x + 28, 256);
    g.lineTo(x + 58, 214);
    g.lineTo(x + 30, 214);
    g.fill();
  }
  g.fillStyle = '#d8dde4';
  g.font = '700 150px Orbitron, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(`BAY ${String(n).padStart(2, '0')}`, 40, 104);
  g.fillStyle = '#e07a2c';
  g.fillRect(760, 40, 220, 130);
  g.fillStyle = '#23262b';
  g.font = '700 54px Rajdhani, sans-serif';
  g.fillText('CARGO', 790, 106);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Station extends Body {
  constructor(opts) {
    super({ ...opts, kind: 'station', soi: opts.soi ?? STATION.soi });
    this.seed = opts.seed || 1;
    this.colliders = [];
    this.pads = [];
    this.interiorLights = [];
    this.blinkers = [];
    // built in sections; staged, a section at a time (step()), so it can be readied over frames
    this.steps = this.buildSteps();
    if (!opts.staged) while (!this.step());
  }

  step() {
    if (this.steps && this.steps.next().done) this.steps = null;
    return !this.steps;
  }

  // Keeps its floor facing its world and its hangar mouth along its orbit (stationPose in @astra/shared/world).
  update(t) {
    stationPoseInto(this, t, this.parent, this);
    this.quaternionInv.copy(this.quaternion).invert();
  }

  *buildSteps() {
    const rng = mulberry32(this.seed);
    // mostly painted plate rather than bare metal: in space a metal hull only mirrors black sky
    const hull = applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0x9aa1aa, metalness: 0.3, roughness: 0.55 }), { scale: 0.09, strength: 0.6 });
    const dark = applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0x353a42, metalness: 0.45, roughness: 0.5 }), { scale: 0.12 });
    const accent = applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0xd8641c, metalness: 0.3, roughness: 0.5 }), { scale: 0.1 });
    const interior = applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0x3e444c, metalness: 0.55, roughness: 0.5 }), { scale: 0.18, strength: 0.7 });
    const floorTex = hazardTexture();
    floorTex.repeat.set(10, 12);
    const floor = new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.5, roughness: 0.55 });
    const glowCyan = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6fdfff, emissiveIntensity: 1.6 });
    const glowWarm = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd7a0, emissiveIntensity: 1.4 });
    const glowOrange = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a30, emissiveIntensity: 1.6 });
    const solar = new THREE.MeshStandardMaterial({ color: 0x0c1a3a, metalness: 0.9, roughness: 0.25, emissive: 0x05102a, emissiveIntensity: 0.6 });
    this.materials = { hull, dark, accent, interior, floor, glowCyan, glowWarm, glowOrange, solar };

    const buckets = new Map();
    const add = (geo, mat) => {
      if (!buckets.has(mat)) buckets.set(mat, []);
      buckets.get(mat).push(geo);
    };
    const box = (ax, ay, az, bx, by, bz, mat, collide = true) => {
      const x0 = Math.min(ax, bx);
      const x1 = Math.max(ax, bx);
      const y0 = Math.min(ay, by);
      const y1 = Math.max(ay, by);
      const z0 = Math.min(az, bz);
      const z1 = Math.max(az, bz);
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(g, mat);
      if (collide) this.colliders.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) });
    };
    const cyl = (r, len, pos, axis, mat, seg = 32, rTop = r) => {
      const g = new THREE.CylinderGeometry(rTop, r, len, seg);
      if (axis === 'z') g.rotateX(Math.PI / 2);
      if (axis === 'x') g.rotateZ(Math.PI / 2);
      g.translate(pos.x, pos.y, pos.z);
      add(g, mat);
    };
    const H = HANGAR;

    yield;
    // ----- hangar shell -----
    box(H.x0, -4, H.z0, H.x1, 0, H.z1, floor); // floor
    box(H.x0 - 5, -4, H.z0 - 5, H.x0, H.y1 + 5, H.z1, interior); // left wall
    box(H.x1, -4, H.z0 - 5, H.x1 + 5, H.y1 + 5, H.z1, interior); // right wall
    box(H.x0, -4, H.z0 - 5, H.x1, H.y1 + 5, H.z0, interior); // back wall
    box(H.x0, H.y1, H.z0, H.x1, H.y1 + 5, H.z1, interior); // ceiling
    // outer armor (non-colliding cosmetic skin slightly outside)
    box(H.x0 - 9, -9, H.z0 - 9, H.x1 + 9, -4, H.z1 + 2, hull, false);
    box(H.x0 - 9, H.y1 + 5, H.z0 - 9, H.x1 + 9, H.y1 + 10, H.z1 + 2, hull, false);
    box(H.x0 - 9, -4, H.z0 - 9, H.x0 - 5, H.y1 + 5, H.z1 + 2, hull, false);
    box(H.x1 + 5, -4, H.z0 - 9, H.x1 + 9, H.y1 + 5, H.z1 + 2, hull, false);
    box(H.x0 - 9, -4, H.z0 - 9, H.x1 + 9, H.y1 + 5, H.z0 - 5, hull, false);
    this.colliders.push({ min: new THREE.Vector3(H.x0 - 9, -9, H.z0 - 9), max: new THREE.Vector3(H.x1 + 9, -4, H.z1 + 2) });
    this.colliders.push({ min: new THREE.Vector3(H.x0 - 9, H.y1 + 5, H.z0 - 9), max: new THREE.Vector3(H.x1 + 9, H.y1 + 10, H.z1 + 2) });
    // mouth frame
    box(H.x0 - 9, -9, H.z1, H.x1 + 9, -2, H.z1 + 6, accent, false);
    box(H.x0 - 9, H.y1 + 2, H.z1, H.x1 + 9, H.y1 + 10, H.z1 + 6, accent, false);
    box(H.x0 - 9, -9, H.z1, H.x0 - 3, H.y1 + 10, H.z1 + 6, accent, false);
    box(H.x1 + 3, -9, H.z1, H.x1 + 9, H.y1 + 10, H.z1 + 6, accent, false);
    // guide lights along mouth
    for (let i = 0; i < 14; i++) {
      const x = H.x0 + 4 + i * ((H.x1 - H.x0 - 8) / 13);
      box(x - 0.6, -2, H.z1 + 1, x + 0.6, -1.4, H.z1 + 5, glowCyan, false);
      box(x - 0.6, H.y1 + 1.4, H.z1 + 1, x + 0.6, H.y1 + 2, H.z1 + 5, glowCyan, false);
    }

    // ceiling light strips & girders
    for (let z = H.z0 + 10; z < H.z1; z += 18) {
      box(H.x0, H.y1 - 2.5, z - 1, H.x1, H.y1, z + 1, dark, false);
      box(H.x0 + 8, H.y1 - 2.9, z - 0.35, H.x1 - 8, H.y1 - 2.5, z + 0.35, glowWarm, false);
    }
    // wall ribs + window strips
    for (let z = H.z0 + 6; z < H.z1 - 2; z += 12) {
      box(H.x0, 0, z - 0.8, H.x0 + 1.6, H.y1, z + 0.8, dark, false);
      box(H.x1 - 1.6, 0, z - 0.8, H.x1, H.y1, z + 0.8, dark, false);
      box(H.x0 + 0.1, 22, z + 2, H.x0 + 0.3, 24, z + 9, glowCyan, false);
      box(H.x1 - 0.3, 22, z + 2, H.x1 - 0.1, 24, z + 9, glowCyan, false);
    }

    yield;
    // ----- landing pads -----
    const padPositions = STATION_LAYOUT.pads.map((pad) => [pad.x, pad.z]);
    const padTex = padTexture('#6fe3ff');
    for (const [x, z] of padPositions) {
      const top = STATION_LAYOUT.padTop;
      const g = new THREE.CylinderGeometry(STATION_LAYOUT.padRadius, STATION_LAYOUT.padRadius + 0.6, top, 48);
      g.translate(x, top / 2, z);
      add(g, dark);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(11.6, 64), new THREE.MeshStandardMaterial({ map: padTex, metalness: 0.4, roughness: 0.5, emissive: 0xffffff, emissiveMap: padTex, emissiveIntensity: 0.12 }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, top + 0.02, z);
      disc.receiveShadow = true;
      this.root.add(disc);
      const ring = new THREE.TorusGeometry(12.3, 0.18, 6, 64);
      ring.rotateX(Math.PI / 2);
      ring.translate(x, top + 0.05, z);
      add(ring, glowOrange);
      this.colliders.push({ min: new THREE.Vector3(x - 9, 0, z - 9), max: new THREE.Vector3(x + 9, top, z + 9) });
      this.pads.push({ x, y: top, z, occupied: null });
    }

    yield;
    // ----- trade deck at the back -----
    const deckY = 7;
    const deckZ = -68;
    box(-45, 0, H.z0, 45, deckY, deckZ, interior);
    box(-45, deckY, deckZ - 0.4, -10, deckY + 1.1, deckZ, dark); // railing
    box(10, deckY, deckZ - 0.4, 45, deckY + 1.1, deckZ, dark);
    box(-45, deckY + 1.05, deckZ - 0.5, -10, deckY + 1.2, deckZ + 0.1, glowCyan, false);
    box(10, deckY + 1.05, deckZ - 0.5, 45, deckY + 1.2, deckZ + 0.1, glowCyan, false);
    // stairs
    const steps = 18;
    const run = 0.75;
    for (let i = 0; i < steps; i++) {
      const y1 = ((i + 1) / steps) * deckY;
      const z1 = deckZ + (steps - i) * run;
      box(-8, 0, deckZ, 8, y1, z1, i % 2 ? interior : dark);
    }
    box(-8.5, 0, deckZ, -8, deckY + 1.2, deckZ + steps * run, accent);
    box(8, 0, deckZ, 8.5, deckY + 1.2, deckZ + steps * run, accent);
    // terminal kiosks
    this.terminals = [];
    const kiosk = (x, z, label) => {
      box(x - 1.2, deckY, z - 0.8, x + 1.2, deckY + 1.1, z + 0.8, dark);
      box(x - 0.9, deckY + 1.1, z - 0.3, x + 0.9, deckY + 2.3, z + 0.1, dark, false);
      box(x - 0.8, deckY + 1.2, z + 0.1, x + 0.8, deckY + 2.2, z + 0.15, glowCyan, false);
      this.terminals.push({ pos: new THREE.Vector3(x, deckY, z + 1.2), label });
    };
    kiosk(-14, -80, 'Galactic Trade Terminal');
    kiosk(14, -80, 'Starship Outfitting');
    // the fabricator terminal (DESIGN 15.7, P1.E13.T05), where the server's crafting service expects its user (shared data)
    kiosk(STATION_FABRICATOR.kiosk.x, STATION_FABRICATOR.kiosk.z, 'Fabricator');
    this.terminals.at(-1).fabricator = true;
    // back wall sign
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 10),
      new THREE.MeshBasicMaterial({ map: signTexture(this.name), color: new THREE.Color(2.2, 2.2, 2.2) }),
    );
    sign.position.set(0, 24, H.z0 + 0.2);
    this.root.add(sign);
    // big doors on the deck (decorative)
    box(-6, deckY, H.z0, 6, deckY + 9, H.z0 + 0.6, accent, false);
    box(-0.15, deckY, H.z0 + 0.6, 0.15, deckY + 9, H.z0 + 0.8, glowOrange, false);

    yield;
    // ----- hangar dressing: cargo along the walls, catwalks and pipe runs, floor lanes -----
    const paint = new THREE.MeshStandardMaterial({ color: 0xe0a91c, metalness: 0.2, roughness: 0.6 });
    const teal = applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0x2c5a72, metalness: 0.35, roughness: 0.5 }), { scale: 0.25 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6f757d, metalness: 0.7, roughness: 0.4 });
    this.materials.paint = paint;
    this.materials.teal = teal;
    this.materials.steel = steel;
    // a flat strip on the floor (or any thin slab), rotated about the vertical
    const flat = (x, z, w, l, ry, mat, y = 0.02) => {
      const g = new THREE.BoxGeometry(w, 0.03, l);
      g.rotateY(ry);
      g.translate(x, y, z);
      add(g, mat);
    };
    // corrugated shipping container, 6 m long along x (alongX) or z
    const container = (x, z, y, alongX, mat) => {
      const L = 6.1;
      const W = 2.45;
      const Hc = 2.6;
      const hx = alongX ? L / 2 : W / 2;
      const hz = alongX ? W / 2 : L / 2;
      box(x - hx, y, z - hz, x + hx, y + Hc, z + hz, mat);
      for (let i = 0; i <= 12; i++) {
        const t = -L / 2 + 0.35 + (i * (L - 0.7)) / 12;
        for (const s of [-1, 1]) {
          if (alongX) box(x + t - 0.07, y + 0.15, z + s * hz, x + t + 0.07, y + Hc - 0.15, z + s * (hz + 0.06), mat, false);
          else box(x + s * hx, y + 0.15, z + t - 0.07, x + s * (hx + 0.06), y + Hc - 0.15, z + t + 0.07, mat, false);
        }
      }
      // steel frame: bottom and top rails, corner posts
      for (const yy of [y, y + Hc - 0.16]) box(x - hx - 0.04, yy, z - hz - 0.04, x + hx + 0.04, yy + 0.16, z + hz + 0.04, dark, false);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const cx = x + sx * (hx - 0.08);
          const cz = z + sz * (hz - 0.08);
          box(cx - 0.13, y, cz - 0.13, cx + 0.13, y + Hc, cz + 0.13, dark, false);
        }
      }
      // door end: lock bars
      for (let k = 0; k < 4; k++) {
        const o = -W / 2 + 0.4 + (k * (W - 0.8)) / 3;
        if (alongX) box(x + hx, y + 0.25, z + o - 0.03, x + hx + 0.08, y + Hc - 0.25, z + o + 0.03, steel, false);
        else box(x + o - 0.03, y + 0.25, z + hz, x + o + 0.03, y + Hc - 0.25, z + hz + 0.08, steel, false);
      }
    };
    // framed cargo crate
    const crate = (x, z, y, s, mat) => {
      box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, mat);
      const e = s * 0.09;
      for (const yy of [y, y + s - e]) box(x - s / 2 - 0.03, yy, z - s / 2 - 0.03, x + s / 2 + 0.03, yy + e, z + s / 2 + 0.03, steel, false);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const cx = x + sx * (s / 2 - e / 2 + 0.03);
          const cz = z + sz * (s / 2 - e / 2 + 0.03);
          box(cx - e / 2, y, cz - e / 2, cx + e / 2, y + s, cz + e / 2, steel, false);
        }
      }
      // a painted band round the middle
      box(x - s / 2 - 0.01, y + s * 0.45, z - s / 2 - 0.01, x + s / 2 + 0.01, y + s * 0.55, z + s / 2 + 0.01, paint, false);
    };
    const barrel = (x, z, mat) => {
      cyl(0.42, 1.25, new THREE.Vector3(x, 0.625, z), 'y', mat, 16);
      for (const yy of [0.3, 0.95]) cyl(0.45, 0.07, new THREE.Vector3(x, yy, z), 'y', steel, 16);
      this.colliders.push({ min: new THREE.Vector3(x - 0.45, 0, z - 0.45), max: new THREE.Vector3(x + 0.45, 1.25, z + 0.45) });
    };
    const clearOfPads = (x, z, r) => !padPositions.some(([px, pz]) => Math.hypot(px - x, pz - z) < 13.5 + r) && Math.abs(x) > 11 + r;
    const containerMats = [accent, teal, hull, accent, teal];
    // rows of containers along both side walls, some stacked
    for (const sx of [-1, 1]) {
      const x = sx * (H.x1 - 4.2);
      let z = -62;
      while (z < 48) {
        const run = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < run && z < 48; k++) {
          container(x, z, 0, false, containerMats[Math.floor(rng() * containerMats.length)]);
          if (rng() < 0.45) container(x, z + (rng() - 0.5) * 0.6, 2.6, false, containerMats[Math.floor(rng() * containerMats.length)]);
          z += 6.4;
        }
        z += 4 + rng() * 8;
      }
      // a second, shorter row turned crosswise near the back
      for (let k = 0; k < 2; k++) container(sx * (H.x1 - 12), -54 + k * 2.7, 0, true, containerMats[(k + (sx > 0 ? 1 : 0)) % 3]);
    }
    // crate stacks and barrel clusters in the open floor between the pads and the walls
    const spots = [[-50, -38], [50, -36], [-48, 2], [49, 4], [-14, -50], [16, -48], [-50, 40], [51, 42], [-12, 44], [14, 6]];
    for (const [sx, sz] of spots) {
      if (!clearOfPads(sx, sz, 3)) continue;
      const n = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const s = 1.2 + rng() * 0.9;
        const x = sx + (rng() - 0.5) * 5;
        const z = sz + (rng() - 0.5) * 5;
        const mat = rng() < 0.4 ? accent : rng() < 0.5 ? teal : dark;
        crate(x, z, 0, s, mat);
        if (rng() < 0.4) crate(x + (rng() - 0.5) * 0.3, z + (rng() - 0.5) * 0.3, s, s * (0.6 + rng() * 0.3), dark);
      }
      if (rng() < 0.7) {
        const bx = sx + (sx < 0 ? 4.6 : -6.5);
        const bz = sz - 2.5;
        for (let i = 0; i < 3 + Math.floor(rng() * 4); i++) barrel(bx + (i % 3) * 0.95, bz + Math.floor(i / 3) * 0.95, rng() < 0.5 ? paint : teal);
      }
    }
    // fuel tanks on cradles beside the trade deck
    for (const sx of [-1, 1]) {
      const x = sx * 55;
      cyl(2.4, 14, new THREE.Vector3(x, 3.4, -77), 'z', hull, 24);
      for (const zz of [-84.2, -69.8]) {
        const cap = new THREE.SphereGeometry(2.4, 20, 10);
        cap.scale(1, 1, 0.45);
        cap.translate(x, 3.4, zz);
        add(cap, hull);
      }
      for (const zz of [-81, -73]) box(x - 2.6, 0, zz - 0.5, x + 2.6, 1.6, zz + 0.5, dark);
      for (const zz of [-79.5, -74.5]) cyl(2.46, 0.5, new THREE.Vector3(x, 3.4, zz), 'z', paint, 24);
      cyl(0.25, 9, new THREE.Vector3(x - sx * 2.0, 6.0, -77), 'z', steel, 8);
      this.colliders.push({ min: new THREE.Vector3(x - 2.6, 0, -85), max: new THREE.Vector3(x + 2.6, 5.8, -69) });
    }
    // catwalks along the side walls, with railings and a light strip underneath
    const walkY = 13;
    for (const sx of [-1, 1]) {
      const xw = sx > 0 ? H.x1 - 1.6 : H.x0 + 1.6;
      const xo = xw - sx * 3.4;
      box(Math.min(xw, xo), walkY - 0.3, H.z0 + 24, Math.max(xw, xo), walkY, H.z1 - 4, steel, false);
      box(Math.min(xo, xo + sx * 0.1), walkY - 0.25, H.z0 + 24, Math.max(xo, xo + sx * 0.1) + 0.05, walkY - 0.15, H.z1 - 4, glowWarm, false);
      // rails thick enough not to break into dashes from across the hangar
      box(xo - 0.09, walkY + 0.98, H.z0 + 24, xo + 0.09, walkY + 1.16, H.z1 - 4, dark, false);
      box(xo - 0.07, walkY + 0.48, H.z0 + 24, xo + 0.07, walkY + 0.6, H.z1 - 4, dark, false);
      for (let z = H.z0 + 24; z <= H.z1 - 4; z += 3) box(xo - 0.05, walkY, z - 0.05, xo + 0.05, walkY + 1.1, z + 0.05, dark, false);
      // brackets under the deck at every wall rib
      for (let z = H.z0 + 30; z < H.z1 - 2; z += 12) box(Math.min(xw, xo + sx * 1.2), walkY - 1.6, z - 0.15, Math.max(xw, xo + sx * 1.2), walkY - 0.3, z + 0.15, dark, false);
      // pipe runs higher up the wall, clamped at the ribs
      const xp = xw - sx * 0.7;
      cyl(0.45, H.z1 - H.z0 - 10, new THREE.Vector3(xp, 27, (H.z0 + H.z1) / 2 - 2), 'z', steel, 12);
      cyl(0.3, H.z1 - H.z0 - 10, new THREE.Vector3(xp - sx * 0.2, 28.4, (H.z0 + H.z1) / 2 - 2), 'z', paint, 10);
      cyl(0.25, H.z1 - H.z0 - 10, new THREE.Vector3(xp, 29.5, (H.z0 + H.z1) / 2 - 2), 'z', teal, 10);
      for (let z = H.z0 + 6; z < H.z1 - 2; z += 12) box(Math.min(xw, xp - sx * 0.6), 26.2, z - 0.25, Math.max(xw, xp - sx * 0.6), 30.2, z + 0.25, dark, false);
    }
    // floor lanes: dashed lines from the front pads to the mouth, chevrons down the centre
    for (const [px, pz] of padPositions) {
      if (pz < 0) continue;
      for (const o of [-6, 6]) {
        for (let z = pz + 13; z < H.z1 - 3; z += 3.5) flat(px + o, z + 1, 0.35, 2, 0, paint);
      }
    }
    for (let z = H.z0 + 30; z < H.z1 - 4; z += 7) {
      flat(-1.3, z, 0.5, 3.4, -0.75, glowCyan);
      flat(1.3, z, 0.5, 3.4, 0.75, glowCyan);
    }
    // hazard edge along the foot of the trade deck
    for (let x = -44; x < 44; x += 2) {
      if (Math.abs(x + 0.5) > 9.5) flat(x + 0.5, deckZ + 0.7, 1.0, 0.8, 0.6, x % 4 === 0 ? paint : dark);
    }
    // warm pools of light on the floor under the ceiling strips, and soft contact shadows on the
    // pads where ships sit (the hangar read as evenly lit grey otherwise)
    const blob = blobTexture();
    const poolMat = new THREE.MeshBasicMaterial({ map: blob, color: new THREE.Color(0.5, 0.4, 0.27), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const poolGeo = new THREE.PlaneGeometry(22, 14);
    for (let z = H.z0 + 28; z < H.z1; z += 18) {
      for (const x of [-42, -14, 14, 42]) {
        const pool = new THREE.Mesh(poolGeo, poolMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x, 0.05, z);
        this.root.add(pool);
      }
    }
    const shadeMat = new THREE.MeshBasicMaterial({ map: blob, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
    for (const [x, z] of padPositions) {
      const shade = new THREE.Mesh(new THREE.PlaneGeometry(13, 15), shadeMat);
      shade.rotation.x = -Math.PI / 2;
      shade.position.set(x, 0.5, z);
      this.root.add(shade);
    }
    // painted bay markings between the wall ribs
    let bay = 1;
    for (const sx of [-1, 1]) {
      for (const z of [-18, 18]) {
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(10, 2.5),
          new THREE.MeshStandardMaterial({ map: bayTexture(bay++), roughness: 0.7, metalness: 0.1 }),
        );
        sign.rotation.y = -sx * Math.PI / 2;
        sign.position.set(sx * (H.x1 - 0.05), 8.6, z);
        this.root.add(sign);
      }
    }

    yield;
    // ----- exterior: spine, ring, solar arrays, habitats -----
    const spineZ0 = H.z0 - 9;
    cyl(16, 260, new THREE.Vector3(0, 21, spineZ0 - 130), 'z', hull, 24);
    this.colliders.push({ min: new THREE.Vector3(-17, 4, spineZ0 - 260), max: new THREE.Vector3(17, 38, spineZ0) });
    for (let i = 0; i < 9; i++) {
      const z = spineZ0 - 20 - i * 26;
      cyl(19, 6, new THREE.Vector3(0, 21, z), 'z', i % 3 === 0 ? accent : dark, 24);
    }
    // ring
    this.ringGroup = new THREE.Group();
    this.ringGroup.position.set(0, 21, spineZ0 - 150);
    // thick enough to read as a habitat drum from afar (a thin one looked like a wire hoop)
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(230, 23, 28, 180), hull);
    ringMesh.castShadow = false;
    this.ringGroup.add(ringMesh);
    const ringBand = new THREE.Mesh(new THREE.TorusGeometry(230, 23.5, 8, 180, Math.PI * 2), dark);
    ringBand.scale.set(1, 1, 0.25);
    this.ringGroup.add(ringBand);
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 210, 14), dark);
      sp.rotation.z = (i / 4) * Math.PI * 2;
      sp.position.set(Math.sin(-(i / 4) * Math.PI * 2) * 115, Math.cos((i / 4) * Math.PI * 2) * 115, 0);
      this.ringGroup.add(sp);
    }
    const windowGeo = new THREE.BoxGeometry(3, 1.4, 0.6);
    const windows = new THREE.InstancedMesh(windowGeo, glowWarm, 160);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      const r = 230;
      m4.makeRotationZ(a).setPosition(Math.cos(a) * r, Math.sin(a) * r, 23.1);
      windows.setMatrixAt(i, m4);
    }
    this.ringGroup.add(windows);
    this.root.add(this.ringGroup);
    this.ringRadius = 230;
    this.ringTube = 23;

    // solar arrays at the spine end
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const z0 = spineZ0 - 200 - k * 22;
        box(side > 0 ? 17 : -150, 20, z0 - 18, side > 0 ? 150 : -17, 22, z0, solar, false);
        box(side > 0 ? 17 : -150, 19.6, z0 - 9.3, side > 0 ? 150 : -17, 22.4, z0 - 8.7, dark, false);
      }
    }
    // comms tower
    cyl(2.2, 80, new THREE.Vector3(30, H.y1 + 50, -40), 'y', dark, 12);
    cyl(9, 2, new THREE.Vector3(30, H.y1 + 85, -40), 'y', hull, 24);
    // hull greebles
    for (let i = 0; i < 220; i++) {
      const face = Math.floor(rng() * 3);
      const w = 2 + rng() * 9;
      const h = 1 + rng() * 4;
      const d = 2 + rng() * 9;
      const mat = rng() < 0.15 ? accent : rng() < 0.5 ? dark : hull;
      if (face === 0) {
        const x = (rng() - 0.5) * 140;
        const z = H.z0 - 5 + rng() * 150;
        box(x - w / 2, H.y1 + 10, z - d / 2, x + w / 2, H.y1 + 10 + h, z + d / 2, mat, false);
      } else if (face === 1) {
        const s = rng() < 0.5 ? -1 : 1;
        const y = rng() * 50 - 5;
        const z = H.z0 - 5 + rng() * 150;
        const x = s * (H.x1 + 9);
        box(x - (s < 0 ? h : 0), y - w / 2, z - d / 2, x + (s > 0 ? h : 0), y + w / 2, z + d / 2, mat, false);
      } else {
        const x = (rng() - 0.5) * 140;
        const z = H.z0 - 5 + rng() * 150;
        box(x - w / 2, -9 - h, z - d / 2, x + w / 2, -9, z + d / 2, mat, false);
      }
    }
    yield;
    // ----- habitat pods along the hangar flanks -----
    for (const sx of [-1, 1]) {
      const x = sx * 92;
      cyl(15, 150, new THREE.Vector3(x, 21, -15), 'z', hull, 28);
      cyl(16, 6, new THREE.Vector3(x, 21, 58), 'z', accent, 28);
      cyl(16, 6, new THREE.Vector3(x, 21, -88), 'z', accent, 28);
      const cap = new THREE.SphereGeometry(15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.rotateX(Math.PI / 2);
      cap.translate(x, 21, 60);
      add(cap, hull);
      for (let k = 0; k < 6; k++) {
        const ring = new THREE.TorusGeometry(15.15, 0.5, 4, 48);
        ring.translate(x, 21, -80 + k * 25);
        add(ring, glowWarm);
      }
      // struts to the hangar
      box(sx > 0 ? H.x1 + 9 : x + 8, 17, -60, sx > 0 ? x - 8 : H.x0 - 9, 25, -50, dark, false);
      box(sx > 0 ? H.x1 + 9 : x + 8, 17, 10, sx > 0 ? x - 8 : H.x0 - 9, 25, 20, dark, false);
      this.colliders.push({ min: new THREE.Vector3(x - 16, 5, -92), max: new THREE.Vector3(x + 16, 37, 75) });
    }
    yield;
    // ----- command tower on top (standing on the hangar roof, not poking down through it) -----
    cyl(24, 73, new THREE.Vector3(0, H.y1 + 41.5, -40), 'y', hull, 32, 18);
    for (let k = 0; k < 5; k++) {
      const r = 24 - (k + 0.5) * 1.2;
      const ring = new THREE.TorusGeometry(r + 0.2, 0.6, 4, 64);
      ring.rotateX(Math.PI / 2);
      ring.translate(0, H.y1 + 18 + k * 12, -40);
      add(ring, k % 2 ? glowCyan : glowWarm);
    }
    const dome = new THREE.SphereGeometry(18, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(0, H.y1 + 78, -40);
    add(dome, dark);
    cyl(1.2, 60, new THREE.Vector3(0, H.y1 + 95, -40), 'y', dark, 8);
    this.colliders.push({ min: new THREE.Vector3(-25, H.y1 + 10, -65), max: new THREE.Vector3(25, H.y1 + 100, -15) });
    yield;
    // ----- inverted tower pointing at the planet -----
    const keel = new THREE.CylinderGeometry(30, 4, 140, 24);
    keel.translate(0, -9 - 70, -20);
    add(keel, hull);
    for (let k = 0; k < 4; k++) {
      const r = 30 - (k + 1) * 6.2;
      const ring = new THREE.TorusGeometry(r, 0.7, 4, 48);
      ring.rotateX(Math.PI / 2);
      ring.translate(0, -9 - (k + 1) * 28, -20);
      add(ring, glowCyan);
    }
    this.colliders.push({ min: new THREE.Vector3(-30, -150, -50), max: new THREE.Vector3(30, -9, 10) });
    yield;
    // ----- second, counter-rotating ring around the hangar -----
    this.ring2 = new THREE.Group();
    this.ring2.position.set(0, 21, -20);
    // a chunky habitat ring (a thin one read as a wireframe bubble from a distance)
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(150, 13, 20, 160), hull);
    this.ring2.add(r2);
    const r2Band = new THREE.Mesh(new THREE.TorusGeometry(150, 13.4, 8, 160), dark);
    r2Band.scale.set(1, 1, 0.3);
    this.ring2.add(r2Band);
    const lights2 = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 1.0, 0.4), glowCyan, 96);
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      m4.makeRotationZ(a).setPosition(Math.cos(a) * 150, Math.sin(a) * 150, 13.2);
      lights2.setMatrixAt(i, m4);
    }
    this.ring2.add(lights2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 64, 10), hull);
      sp.position.set(Math.cos(a) * 118, Math.sin(a) * 118, 0);
      sp.rotation.z = a + Math.PI / 2;
      this.ring2.add(sp);
    }
    this.root.add(this.ring2);
    // exterior window bands on the hangar armor
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const y = 6 + k * 12;
        box(sx * (H.x1 + 9) - 0.2 * sx, y, H.z0, sx * (H.x1 + 9) + 0.3 * sx, y + 1.2, H.z1 - 6, glowWarm, false);
      }
    }

    // blinking beacons
    const beaconGeo = new THREE.SphereGeometry(1.2, 10, 8);
    const beaconPositions = [
      [H.x0 - 9, H.y1 + 10, H.z1 + 2], [H.x1 + 9, H.y1 + 10, H.z1 + 2], [H.x0 - 9, -9, H.z1 + 2], [H.x1 + 9, -9, H.z1 + 2],
      [30, H.y1 + 92, -40], [150, 21, spineZ0 - 222], [-150, 21, spineZ0 - 222],
    ];
    for (const [x, y, z] of beaconPositions) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.6, 0.3) });
      const b = new THREE.Mesh(beaconGeo, mat);
      b.position.set(x, y, z);
      this.root.add(b);
      this.blinkers.push(b);
    }

    // merge buckets into meshes
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      for (const g of geos) g.dispose();
    }

    // force field at the mouth
    this.fieldMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vDist;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vDist;
        uniform float uTime;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          // slow interfering ripples, not scanlines
          vec2 p = vUv * vec2(13.0, 4.0);
          float w = sin(p.x * 1.7 + sin(p.y * 2.3 + uTime * 0.9) * 1.6 + uTime * 0.6) * sin(p.y * 2.1 - sin(p.x * 1.3 - uTime * 0.7) * 1.4 - uTime * 0.5);
          float l = 0.5 + 0.5 * w;
          float e = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
          // faint: space seen through it should still look like the space outside (over black,
          // even 0.05 linear reads as a strong wash once tone mapped and gamma encoded)
          float a = (0.0015 + 0.007 * l * l) * e + (1.0 - e) * 0.06;
          // thins out as you approach, so flying through it is a shimmer rather than a cut
          a *= smoothstep(4.0, 45.0, vDist);
          gl_FragColor = vec4(vec3(0.3, 0.75, 1.0) * a * 2.0, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const field = new THREE.Mesh(new THREE.PlaneGeometry(H.x1 - H.x0, H.y1 - H.y0), this.fieldMat);
    field.position.set(0, H.y1 / 2, H.z1 + 3);
    this.root.add(field);

    // interior lights (intensity driven by Game when the camera is inside)
    for (const [x, y, z] of [[-30, 30, -20], [30, 30, -20], [-30, 30, 25], [30, 30, 25], [0, 20, -78]]) {
      const l = new THREE.PointLight(0xffe2c0, 0, 120, 2);
      l.position.set(x, y, z);
      this.root.add(l);
      this.interiorLights.push(l);
    }

    // hologram trader
    const holo = new THREE.Group();
    const holoMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 6, 12), holoMat);
    body.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 12), holoMat);
    head.position.y = 2.05;
    head.scale.set(1, 1.2, 1);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 8), holoMat);
    crest.position.y = 2.55;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.12, 24), glowCyan);
    holo.add(body, head, crest, base);
    holo.position.set(0, deckY, -84);
    this.root.add(holo);
    this.hologram = holo;

    // the force field keeps walkers inside
    this.playerColliders = this.colliders.concat([
      { min: new THREE.Vector3(H.x0, 0, H.z1 - 1), max: new THREE.Vector3(H.x1, H.y1, H.z1 + 1) },
    ]);
  }

  inHangar(p, margin = 0) {
    const H = HANGAR;
    return p.x > H.x0 + margin && p.x < H.x1 - margin && p.y > H.y0 && p.y < H.y1 - margin && p.z > H.z0 + margin && p.z < H.z1;
  }

  freePad(ship) {
    let best = null;
    for (const p of this.pads) {
      if (p.occupied && p.occupied !== ship) continue;
      const d = Math.hypot(ship.state.pos.x - p.x, ship.state.pos.z - p.z);
      if (!best || d < best.d) best = { pad: p, d };
    }
    if (best) best.pad.occupied = ship;
    return best?.pad || null;
  }

  releasePad(ship) {
    for (const p of this.pads) if (p.occupied === ship) p.occupied = null;
  }

  // sphere (ship) vs station colliders + ring
  collideShip(ship) {
    const p = ship.state.pos;
    const v = ship.state.vel;
    const r = 6;
    let hit = false;
    for (const b of this.colliders) {
      const cx = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x);
      const cy = THREE.MathUtils.clamp(p.y, b.min.y, b.max.y);
      const cz = THREE.MathUtils.clamp(p.z, b.min.z, b.max.z);
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r * r) {
        let n;
        let depth;
        if (d2 < 1e-6) {
          // centre inside the box: leave through the nearest face
          const faces = [
            [p.x - b.min.x, -1, 0, 0], [b.max.x - p.x, 1, 0, 0],
            [p.y - b.min.y, 0, -1, 0], [b.max.y - p.y, 0, 1, 0],
            [p.z - b.min.z, 0, 0, -1], [b.max.z - p.z, 0, 0, 1],
          ];
          let best = faces[0];
          for (const f of faces) if (f[0] < best[0]) best = f;
          n = _v.set(best[1], best[2], best[3]);
          depth = best[0] + r;
        } else {
          const d = Math.sqrt(d2);
          n = _v.set(dx, dy, dz).divideScalar(d);
          depth = r - d;
        }
        p.addScaledVector(n, depth);
        const vn = v.dot(n);
        if (vn < 0) {
          v.addScaledVector(n, -vn * 1.3);
          if (vn < -20) hit = true;
        }
      }
    }
    // ring tori (big habitat ring around the spine, thin ring around the hangar)
    const rings = [[this.ringGroup.position, this.ringRadius, this.ringTube]];
    if (this.ring2) rings.push([this.ring2.position, 150, 9]);
    for (const [center, R, tube] of rings) {
      const lp = new THREE.Vector3().copy(p).sub(center);
      const q = Math.hypot(lp.x, lp.y) - R;
      const dist = Math.hypot(q, lp.z);
      if (dist < tube + r) {
        const radial = new THREE.Vector3(lp.x, lp.y, 0).normalize();
        const n = radial.multiplyScalar(q).add(new THREE.Vector3(0, 0, lp.z)).normalize();
        p.addScaledVector(n, tube + r - dist);
        const vn = v.dot(n);
        if (vn < 0) v.addScaledVector(n, -vn * 1.3);
        if (vn < -20) hit = true;
      }
    }
    if (hit) ship.damage(8);
    // docking trigger
    if (ship.mode === 'flying' && this.inHangar(p, 4) && p.z < HANGAR.z1 - 6) {
      const pad = this.freePad(ship);
      if (pad) ship.beginDocking(this, pad);
      else ship.game.hud?.toast('All landing pads occupied — hold position', 'warn');
    }
  }

  updateVisual(time, camInside) {
    this.ringGroup.rotation.z = time * 0.02;
    if (this.ring2) this.ring2.rotation.z = -time * 0.035;
    this.fieldMat.uniforms.uTime.value = time;
    const blink = (Math.sin(time * 3) > 0.6) ? 1 : 0.05;
    for (const b of this.blinkers) b.material.color.setRGB(8 * blink, 0.6 * blink, 0.3 * blink);
    for (const l of this.interiorLights) l.intensity = camInside ? 380 : 0;
    if (this.hologram) {
      this.hologram.rotation.y = time * 0.4;
      this.hologram.children[0].material.opacity = 0.45 + 0.1 * Math.sin(time * 9);
    }
  }
}
