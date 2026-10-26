// Points of interest on planets: outposts, monoliths, crash sites and beacons.
// Sites are deterministic per planet; geometry is built only near the camera.
import * as THREE from 'three';
import { libraryRoot, libraryRootVariants } from './modelLibrary.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '@astra/shared/world';
import { applyPanelDetail } from '../render/panelMaterial.js';
import { collectResources, disposeTree } from '../core/dispose.js';

const _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

const LABELS = { outpost: 'Abandoned Outpost', monolith: 'Ancient Monolith', crash: 'Crashed Starship', beacon: 'Signal Beacon' };
const PROMPTS = { outpost: 'Access terminal', monolith: 'Touch the monolith', crash: 'Salvage cargo pod', beacon: 'Activate beacon' };
const LORE = [
  'The stone hums. A memory that is not yours: a sky with two suns, and a voice counting backwards.',
  'Glyphs rearrange as you watch. They spell a name you almost remember.',
  'Warmth spreads through your suit. The monolith remembers every traveler who came before.',
  'A vision of stars collapsing into a single point of light. Then silence.',
  'The surface is cold. Beneath the cold, something patient is waiting.',
];

let mats = null;
function materials() {
  if (mats) return mats;
  mats = {
    hull: applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0xb8b4aa, metalness: 0.4, roughness: 0.55 }), { scale: 0.25 }),
    dark: applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.6, roughness: 0.5 }), { scale: 0.3 }),
    darkBase: concreteBelowDeck(applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.6, roughness: 0.5 }), { scale: 0.3 })),
    accent: applyPanelDetail(new THREE.MeshStandardMaterial({ color: 0xd2621c, metalness: 0.3, roughness: 0.5 }), { scale: 0.3 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.2, roughness: 0.35 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6fe3ff, emissiveIntensity: 1.5 }),
    rune: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xb07bff, emissiveIntensity: 3 }),
    warm: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc070, emissiveIntensity: 1.1 }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.4, 0.2) }),
  };
  return mats;
}

// Foundation skirts (below the deck, where the ground falls away) read as poured concrete
// rather than dark metal. `aBase` is 1 below the structure's base plane.
function concreteBelowDeck(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBase;\nvarying float vBase;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBase = aBase;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBase;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.155, 0.145), vBase);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - vBase;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, vBase);');
  };
  const key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => key + 'base';
  return material;
}

function markBase(mesh) {
  const geo = mesh.geometry;
  if (geo.attributes.aBase) return;
  const p = geo.attributes.position;
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const y = _v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).y;
    a[i] = 1 - THREE.MathUtils.smoothstep(y, -0.2, 0.05);
  }
  geo.setAttribute('aBase', new THREE.BufferAttribute(a, 1));
}

class Builder {
  constructor() {
    this.buckets = new Map();
    this.colliders = [];
    this.extra = [];
  }
  add(geo, mat) {
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
  }
  box(x0, y0, z0, x1, y1, z1, mat, collide = true) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(g, mat);
    if (collide) this.colliders.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) });
  }
  cyl(r0, r1, h, x, y, z, mat, seg = 16) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg);
    g.translate(x, y + h / 2, z);
    this.add(g, mat);
  }
  finish() {
    const group = new THREE.Group();
    for (const [mat, geos] of this.buckets) {
      for (const g of geos) {
        if (g.attributes.uv === undefined) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      }
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const o of this.extra) group.add(o);
    return group;
  }
}

// A modelled site from public/models/structures.glb. Its children carry markers: COL_* box
// meshes become colliders, `Interact` is where the player presses E, Light_* get point
// lights, `Blink` blinks and `Spin` turns. Painted parts use the shared structure materials.
function libraryStructure(type, rng) {
  const names = libraryRootVariants('structures', type);
  if (!names.length) return null;
  const M = materials();
  const remap = { Hull: M.hull, Accent: M.accent, Warm: M.warm, Glow: M.glow, Lamp: M.red };
  const group = libraryRoot('structures', rng.pick(names)).clone(true);
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.set(1, 1, 1);
  group.updateMatrixWorld(true);
  const colliders = [];
  const extras = [];
  const drop = [];
  let interact = new THREE.Vector3(0, 0.5, 5);
  group.traverse((o) => {
    if (o.name.startsWith('COL_')) {
      if (o.isMesh) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        colliders.push({ min: b.min, max: b.max });
      }
      drop.push(o);
    } else if (o.name.startsWith('Interact')) {
      // (the loader makes repeated node names unique with a numeric suffix, so match prefixes)
      interact = o.getWorldPosition(new THREE.Vector3());
    } else if (o.name.startsWith('Light_')) {
      // colour / intensity / distance may come from the model's glTF extras
      const u = o.userData;
      const light = new THREE.PointLight(u.color ? new THREE.Color(...[].concat(u.color).slice(0, 3)) : 0xffc890, u.intensity ?? 60, u.distance ?? 25, 2);
      o.getWorldPosition(light.position);
      extras.push(light);
    } else if (!o.isMesh && o.name.startsWith('Blink')) {
      o.userData.blink = true;
    } else if (!o.isMesh && o.name.startsWith('Spin')) {
      o.userData.spin = true;
    } else if (o.isMesh) {
      if (o.material.name === 'Dark') {
        markBase(o);
        o.material = M.darkBase;
      } else if (o.material.name === 'Glass') {
        // a mirror-smooth dome throws the sun straight into the bloom; keep a soft sheen
        if (!o.material.userData.tamed) {
          o.material.roughness = Math.max(o.material.roughness, 0.32);
          o.material.envMapIntensity = 0.7;
          o.material.userData.tamed = true;
        }
      } else if ((o.material.name === 'Solar' || o.material.name === 'Metal') && !o.material.userData.tamed) {
        // likewise solar cells and bare metal trim: near-mirrors that turned white and bloomed
        o.material.roughness = Math.max(o.material.roughness, o.material.name === 'Solar' ? 0.42 : 0.5);
        o.material.metalness = Math.min(o.material.metalness, 0.55);
        o.material.envMapIntensity = 0.5;
        if (o.material.name === 'Solar') o.material.color.multiplyScalar(0.7);
        o.material.userData.tamed = true;
      } else o.material = remap[o.material.name] || o.material;
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  for (const o of drop) o.parent.remove(o);
  for (const e of extras) group.add(e);
  group.userData.library = true;
  return { group, colliders, interact };
}

function buildOutpost(rng) {
  const M = materials();
  const b = new Builder();
  b.box(-10, -4, -10, 10, 0.5, 10, M.dark);
  const dome = new THREE.SphereGeometry(5, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 0.5, -1);
  b.add(dome, M.hull);
  b.colliders.push({ min: new THREE.Vector3(-4, 0.5, -5), max: new THREE.Vector3(4, 4.8, 3) });
  b.box(-12.5, 0.5, -3.5, -6.5, 4, 2.5, M.hull);
  b.box(-12.6, 2.4, -3.6, -6.4, 2.8, 2.6, M.accent, false);
  for (let i = 0; i < 3; i++) b.box(-12 + i * 1.8, 1.4, 2.5, -10.9 + i * 1.8, 2.1, 2.62, M.warm, false);
  b.box(-1.4, 0.5, 3.4, 1.4, 3.4, 4.2, M.accent, false);
  b.box(-0.9, 0.5, 4.15, 0.9, 3.0, 4.3, M.dark, false);
  // antenna
  b.cyl(0.18, 0.1, 11, 4.5, 0.5, -4.5, M.dark, 8);
  const dish = new THREE.SphereGeometry(1.4, 16, 6, 0, Math.PI * 2, 0, 1.0);
  dish.rotateX(-0.6);
  dish.translate(4.5, 11, -4.3);
  b.add(dish, M.hull);
  // terminal
  b.box(-0.6, 0.5, 6.2, 0.6, 1.6, 7.0, M.dark);
  b.box(-0.5, 1.6, 6.5, 0.5, 2.3, 6.6, M.glow, false);
  // landing pad
  b.cyl(6, 6.2, 0.4, 0, 0.5, 15, M.dark, 32);
  b.colliders.push({ min: new THREE.Vector3(-4.5, -2, 10.5), max: new THREE.Vector3(4.5, 0.9, 19.5) });
  const ring = new THREE.TorusGeometry(5.6, 0.1, 6, 40);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.92, 15);
  b.add(ring, M.glow);
  // crates
  for (let i = 0; i < 5; i++) {
    const x = 5 + rng.float(0, 4);
    const z = rng.float(-8, 6);
    const s = rng.float(0.8, 1.4);
    b.box(x, 0.5, z, x + s, 0.5 + s, z + s, rng.chance(0.3) ? M.accent : M.dark);
  }
  const light = new THREE.PointLight(0xffc890, 60, 25, 2);
  light.position.set(0, 4, 6);
  b.extra.push(light);
  return { group: b.finish(), colliders: b.colliders, interact: new THREE.Vector3(0, 0.5, 7.6) };
}

function buildMonolith(rng) {
  const M = materials();
  const b = new Builder();
  b.box(-6, -3, -6, 6, 0.4, 6, M.stone);
  b.box(-4.5, 0.4, -4.5, 4.5, 0.8, 4.5, M.stone);
  b.box(-3, 0.8, -3, 3, 1.2, 3, M.stone);
  const ob = new THREE.BoxGeometry(2.6, 13, 1.3, 1, 4, 1);
  const p = ob.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + 6.5) / 13;
    p.setX(i, p.getX(i) * (1 - t * 0.35));
    p.setZ(i, p.getZ(i) * (1 - t * 0.35));
  }
  ob.computeVertexNormals();
  ob.translate(0, 1.2 + 6.5, 0);
  b.add(ob, M.stone);
  b.colliders.push({ min: new THREE.Vector3(-1.3, 1.2, -0.7), max: new THREE.Vector3(1.3, 14, 0.7) });
  for (let i = 0; i < 7; i++) {
    const y = 2.5 + i * 1.5;
    const w = rng.float(0.3, 1.2);
    b.box(-w / 2, y, 0.62, w / 2, y + 0.18, 0.7 - i * 0.012, M.rune, false);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 9.5;
    const z = Math.sin(a) * 9.5;
    const h = rng.float(2, 4.5);
    const g = new THREE.BoxGeometry(1.1, h, 0.7);
    g.rotateY(-a);
    g.rotateZ(rng.float(-0.15, 0.15));
    g.translate(x, h / 2 - 0.5, z);
    b.add(g, M.stone);
    b.colliders.push({ min: new THREE.Vector3(x - 0.6, -1, z - 0.6), max: new THREE.Vector3(x + 0.6, h, z + 0.6) });
  }
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), M.rune);
  crystal.position.set(0, 16.5, 0);
  crystal.scale.set(1, 1.8, 1);
  crystal.userData.spin = true;
  b.extra.push(crystal);
  const light = new THREE.PointLight(0xb07bff, 80, 30, 2);
  light.position.set(0, 6, 3);
  b.extra.push(light);
  return { group: b.finish(), colliders: b.colliders, interact: new THREE.Vector3(0, 1.2, 2.2) };
}

function buildCrash(rng, shipModel) {
  const M = materials();
  const b = new Builder();
  let wreckBox = { min: new THREE.Vector3(-6, -1, -4), max: new THREE.Vector3(6, 2.5, 4) };
  const debris = [];
  for (let i = 0; i < 14; i++) {
    const a = rng.float(0, Math.PI * 2);
    const d = rng.float(6, 22);
    const g = new THREE.BoxGeometry(rng.float(0.4, 2.5), rng.float(0.1, 0.5), rng.float(0.4, 2));
    g.rotateX(rng.float(-0.6, 0.6));
    g.rotateY(rng.float(0, 3));
    g.translate(Math.cos(a) * d, 0.1, Math.sin(a) * d);
    debris.push(g);
    b.add(g, rng.chance(0.3) ? M.accent : M.dark);
  }
  // scorched crater rim
  const rim = new THREE.TorusGeometry(9, 1.2, 6, 24);
  rim.rotateX(Math.PI / 2);
  rim.scale(1.4, 1, 1);
  rim.translate(0, -0.6, 0);
  b.add(rim, M.stone);
  // cargo pod
  b.box(12, 0, 4, 13.6, 1.4, 5.6, M.accent);
  b.box(12.2, 1.4, 4.2, 13.4, 1.5, 5.4, M.glow, false);
  const group = b.finish();
  if (shipModel) {
    const wreck = shipModel.clone(true);
    wreck.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        if (o.material.color) o.material.color.multiplyScalar(0.35);
        if (o.material.emissive) o.material.emissiveIntensity = 0;
        o.castShadow = true;
      }
      if (/^Gear/.test(o.name)) o.visible = false;
    });
    wreck.rotation.set(-0.35, rng.float(0, 6), 0.55);
    wreck.position.set(0, -0.6, 0);
    wreck.scale.setScalar(1.4);
    group.add(wreck);
    // collider from the wreck's real (rotated) bounds, trimmed so its wingtips stay walkable
    wreck.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(wreck);
    bb.min.multiplyScalar(0.8);
    bb.max.multiplyScalar(0.8);
    bb.min.y = -1;
    wreckBox = { min: bb.min, max: bb.max };
  }
  // smoke
  const smoke = [];
  const tex = smokeTexture();
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x3a3a3a, transparent: true, depthWrite: false, opacity: 0.5 }));
    sp.userData.smoke = { t: i / 14, base: new THREE.Vector3(rng.float(-2, 2), 1, rng.float(-2, 2)) };
    group.add(sp);
    smoke.push(sp);
  }
  const fire = new THREE.PointLight(0xff7a30, 50, 18, 2);
  fire.position.set(0, 2, 0);
  fire.userData.flicker = true;
  group.add(fire);
  return {
    group,
    colliders: [...b.colliders, wreckBox],
    interact: new THREE.Vector3(12.8, 0.7, 4.8),
  };
}

function buildBeacon(rng) {
  const M = materials();
  const b = new Builder();
  b.box(-4, -3, -4, 4, 0.4, 4, M.dark);
  const H = 20;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const a = new THREE.Vector3(sx * 3, 0.4, sz * 3);
    const t = new THREE.Vector3(sx * 0.5, H, sz * 0.5);
    const d = t.clone().sub(a);
    const g = new THREE.CylinderGeometry(0.12, 0.2, d.length(), 6);
    g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
    g.translate(a.x, a.y, a.z);
    b.add(g, M.dark);
    b.colliders.push({ min: new THREE.Vector3(a.x - 0.4, 0, a.z - 0.4), max: new THREE.Vector3(a.x + 0.4, 6, a.z + 0.4) });
  }
  for (let k = 1; k < 6; k++) {
    const y = 0.4 + k * 3.4;
    const w = 3 - (k / 6) * 2.5;
    const ring = new THREE.TorusGeometry(w * 1.41, 0.07, 4, 4);
    ring.rotateX(Math.PI / 2);
    ring.rotateY(Math.PI / 4);
    ring.translate(0, y, 0);
    b.add(ring, M.accent);
  }
  b.box(-1, 0.4, 3.6, 1, 1.6, 4.4, M.dark);
  b.box(-0.8, 1.6, 3.9, 0.8, 2.4, 4.0, M.glow, false);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), M.red);
  lamp.position.set(0, H + 0.6, 0);
  lamp.userData.blink = true;
  b.extra.push(lamp);
  return { group: b.finish(), colliders: b.colliders, interact: new THREE.Vector3(0, 0.4, 5.2) };
}

let _smoke = null;
function smokeTexture() {
  if (_smoke) return _smoke;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _smoke = new THREE.CanvasTexture(c);
  return _smoke;
}

export class Structures {
  constructor(game) {
    this.game = game;
    this.planet = null;
    this.sites = [];
    this.visited = new Set();
    this.time = 0;
  }

  setPlanet(planet) {
    if (planet === this.planet) return;
    for (const s of this.sites) if (s.built) this.unbuild(s);
    this.sites = [];
    this.planet = planet;
    if (!planet || !planet.sampler) return;
    // planned with the planet, which levels the ground under each one
    planet.sites.forEach((x, i) => {
      this.sites.push({
        id: `${planet.name}#${i}`, type: x.type, dir: x.dir, label: LABELS[x.type],
        // wrecks dig in
        pos: x.dir.clone().multiplyScalar(planet.radius + x.base - (x.type === 'crash' ? 0.3 : 0)),
        quat: x.quat, quatInv: x.quat.clone().invert(),
        known: false, built: null, seed: x.seed,
      });
    });
  }

  build(s) {
    const rng = new Random(s.seed);
    const res =
      (s.type !== 'crash' && libraryStructure(s.type, rng)) ||
      (s.type === 'outpost' ? buildOutpost(rng) : s.type === 'monolith' ? buildMonolith(rng) : s.type === 'crash' ? buildCrash(rng, this.game.ship.model) : buildBeacon(rng));
    res.group.position.copy(s.pos);
    res.group.quaternion.copy(s.quat);
    this.planet.root.add(res.group);
    s.built = res;
  }

  unbuild(s) {
    s.built.group.parent?.remove(s.built.group);
    if (s.built.group.userData.library) {
      // geometry and materials are shared with the library: nothing to free
      s.built = null;
      return;
    }
    // shared: the player's ship geometry (wreck clones), module materials and textures
    if (!this.keep) {
      this.keep = new Set([...Object.values(materials()), smokeTexture()]);
      if (this.game.ship.model) collectResources(this.game.ship.model, this.keep);
    }
    disposeTree(s.built.group, this.keep);
    s.built = null;
  }

  update(dt, planet) {
    const g = this.game;
    let target = null;
    let camLocal = null;
    if (planet && planet.sampler) {
      camLocal = planet.worldToLocal(g.camWorld, new THREE.Vector3());
      if (camLocal.length() - planet.radius < 9000) target = planet;
    }
    if (target !== this.planet) this.setPlanet(target);
    if (!this.planet) return;
    this.time += dt;
    const sunLocal = this.planet.dirToLocal(_v.copy(g.system.star.position).sub(this.planet.position).normalize(), new THREE.Vector3());
    for (const s of this.sites) {
      const d = s.pos.distanceTo(camLocal);
      if (!s.built && d < 2200) this.build(s);
      else if (s.built && d > 2800) this.unbuild(s);
      if (d < 500) s.known = true;
      // ship sensors pick up sites while flying low over the surface
      if (!s.known && g.mode === 'ship' && g.ship.altitude < 2500 && d < 6000) s.known = true;
      if (s.built) {
        // lamps are for the night: at full strength in daylight they blow the walls next to
        // them out into a bloom haze
        const lamp = 1 - 0.88 * THREE.MathUtils.smoothstep(s.dir.dot(sunLocal), -0.05, 0.2);
        s.built.group.traverse((o) => {
          if (o.userData.spin) o.rotation.y = this.time * 0.8;
          if (o.userData.blink) o.visible = Math.sin(this.time * 4) > 0;
          if (o.isPointLight) {
            if (o.userData.flicker) o.intensity = (40 + Math.random() * 30) * lamp;
            else o.intensity = (o.userData.baseIntensity ??= o.intensity) * lamp;
          }
          if (o.userData.smoke) {
            const sm = o.userData.smoke;
            const t = (sm.t + this.time * 0.08) % 1;
            o.position.copy(sm.base).add(_v.set(Math.sin(t * 6 + sm.t * 9) * t * 3, t * 25, t * 4));
            const sc = 2 + t * 9;
            o.scale.set(sc, sc, sc);
            o.material.opacity = (1 - t) * 0.45;
          }
        });
      }
    }
  }

  toLocal(s, p, out) {
    return out.copy(p).sub(s.pos).applyQuaternion(s.quatInv);
  }

  collidePlayer(player) {
    if (!this.planet || player.state.frame !== this.planet) return;
    for (const s of this.sites) {
      if (!s.built) continue;
      if (s.pos.distanceTo(player.state.pos) > 40) continue;
      const lp = this.toLocal(s, player.state.pos, new THREE.Vector3());
      const lv = player.state.vel.clone().applyQuaternion(s.quatInv);
      const grounded = resolveBoxes(lp, lv, s.built.colliders);
      if (grounded) player.grounded = true;
      player.state.pos.copy(lp.applyQuaternion(s.quat).add(s.pos));
      player.state.vel.copy(lv.applyQuaternion(s.quat));
    }
  }

  nearestInteract(pos) {
    if (!this.planet) return null;
    for (const s of this.sites) {
      if (!s.built || this.visited.has(s.id)) continue;
      const ip = s.built.interact.clone().applyQuaternion(s.quat).add(s.pos);
      if (ip.distanceTo(pos) < 4.5) return s;
    }
    return null;
  }

  promptFor(s) {
    return PROMPTS[s.type];
  }

  interact(s) {
    const g = this.game;
    this.visited.add(s.id);
    g.audio.play('discovery');
    const rng = new Random(s.seed ^ 77);
    if (s.type === 'outpost') {
      const u = rng.int(600, 1400);
      g.inventory.units += u;
      g.hud.showBanner('OUTPOST DATA RECOVERED', 'Abandoned Outpost', [`Trade logs decrypted: +${u} units`]);
    } else if (s.type === 'monolith') {
      const u = rng.int(800, 1600);
      g.inventory.units += u;
      const cell = rng.chance(0.5);
      if (cell) g.inventory.warpCells++;
      g.hud.showBanner('THE MONOLITH SPEAKS', 'Ancient Monolith', [rng.pick(LORE), `+${u} units${cell ? ' · +1 Warp Cell' : ''}`]);
    } else if (s.type === 'crash') {
      const res = rng.pick(['gold', 'cobalt', 'copper']);
      const n = rng.int(30, 70);
      g.inventory.add(res, n);
      g.hud.pickup(res, n);
      g.inventory.add('dihydrogen', 25);
      g.hud.showBanner('CARGO SALVAGED', 'Crashed Starship', ['The pilot is nowhere to be found']);
    } else if (s.type === 'beacon') {
      for (const o of this.sites) o.known = true;
      g.hud.showBanner('SIGNAL TRIANGULATED', 'Signal Beacon', [`${this.sites.length - 1} sites revealed on ${this.planet.name}`]);
    }
    g.save();
  }

  // reveal sites in range; the nearest unvisited signal is always picked up
  scanReveal(pos, radius) {
    let n = 0;
    let nearest = null;
    for (const s of this.sites) {
      const d = s.pos.distanceTo(pos);
      if (!s.known && d < radius) {
        s.known = true;
        n++;
      }
      if (!this.visited.has(s.id) && (!nearest || d < nearest.d)) nearest = { s, d };
    }
    if (nearest && !nearest.s.known) {
      nearest.s.known = true;
      n++;
    }
    return { count: n, nearest };
  }

  markers(camLocal) {
    const out = [];
    if (!this.planet) return out;
    for (const s of this.sites) {
      if (!s.known) continue;
      const d = s.pos.distanceTo(camLocal);
      if (d > 12000) continue;
      out.push({ s, label: this.visited.has(s.id) ? `${s.label} ✓` : s.label, pos: s.pos.clone().addScaledVector(s.dir, 6) });
    }
    return out;
  }
}

// AABB resolution for an upright player capsule-ish box; returns true if standing on something.
export function resolveBoxes(p, v, boxes, R = 0.38, H = 1.85) {
  let grounded = false;
  for (const b of boxes) {
    const minX = p.x - R;
    const maxX = p.x + R;
    const minY = p.y;
    const maxY = p.y + H;
    const minZ = p.z - R;
    const maxZ = p.z + R;
    if (maxX <= b.min.x || minX >= b.max.x || maxY <= b.min.y || minY >= b.max.y || maxZ <= b.min.z || minZ >= b.max.z) continue;
    const pushes = [
      [b.max.y - minY, 'y', 1],
      [maxY - b.min.y, 'y', -1],
      [b.max.x - minX, 'x', 1],
      [maxX - b.min.x, 'x', -1],
      [b.max.z - minZ, 'z', 1],
      [maxZ - b.min.z, 'z', -1],
    ];
    let best = pushes[0];
    if (best[0] > 0.45) for (const pu of pushes) if (pu[0] < best[0]) best = pu;
    const [d, axis, sign] = best;
    p[axis] += d * sign;
    if (axis === 'y' && sign > 0) {
      grounded = true;
      if (v.y < 0) v.y = 0;
    } else if (axis === 'y') {
      if (v.y > 0) v.y = 0;
    } else if (v[axis] * sign < 0) v[axis] = 0;
  }
  return grounded;
}
