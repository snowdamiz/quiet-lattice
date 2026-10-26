// Cities on the worlds with a civilisation. Each world has an architecture of its own (spires,
// domes, ziggurats, organic towers or crystal shards, in its own colours); a city is built near
// the camera, a step at a time over frames: streets and plazas paved into the levelled plain,
// hundreds of buildings (instanced, windows lit at night), a landmark tower over the central
// plaza, a trade post, and air traffic circling overhead. From afar at night only its lights show.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../math/rng.js';
import { streetPlan, layoutCity, cityFrame, cityPoint } from '../terrain/cities.js';
import { Citizens, speciesFor } from './Citizens.js';

const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const BUILD_NEAR = 45000;
const BUILD_FAR = 60000;
const STEP_BUDGET = 4;

// ---------- a world's architecture ----------
const ARCH = ['spire', 'dome', 'ziggurat', 'organic', 'crystal'];
export function cultureFor(planet) {
  const p = planet.params;
  const rng = new Random((p.citySeed ^ 0xa5c1) >>> 0);
  const arch = rng.pick(ARCH);
  const second = rng.pick(ARCH.filter((a) => a !== arch));
  const hue = rng.next();
  const light = rng.chance(0.6);
  const wall = new THREE.Color().setHSL(hue, rng.float(0.05, 0.22), light ? rng.float(0.6, 0.78) : rng.float(0.16, 0.28));
  const wall2 = wall.clone().offsetHSL(rng.float(-0.06, 0.06), 0.04, light ? -0.14 : 0.1);
  const accent = new THREE.Color().setHSL((hue + rng.float(0.3, 0.7)) % 1, rng.float(0.45, 0.8), rng.float(0.42, 0.58));
  const glow = new THREE.Color().setHSL(rng.pick([0.08, 0.11, 0.5, 0.55, 0.8, 0.33, 0.93]), 0.9, 0.62);
  const pave = new THREE.Color().setHSL(hue, rng.float(0.05, 0.16), rng.float(0.22, 0.34));
  return {
    arch,
    second,
    wall,
    wall2,
    accent,
    glow,
    pave,
    road: pave.clone().multiplyScalar(0.32),
    glassy: arch === 'crystal' || rng.chance(0.25),
    litFrac: rng.float(0.3, 0.6),
  };
}

// ---------- building models ----------
// Unit footprint (radius ~1), real proportions; colours and how much of each part has windows
// ride on the vertices.
function tag(geo, color, glow) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  return g;
}
const cyl = (rt, rb, h, y, seg, c, glow) => tag(new THREE.CylinderGeometry(rt, rb, h, seg, 1).translate(0, y + h / 2, 0), c, glow);
const cone = (r, h, y, seg, c) => tag(new THREE.ConeGeometry(r, h, seg).translate(0, y + h / 2, 0), c, 0);
const box = (w, h, d, y, c, glow) => tag(new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0), c, glow);
const ball = (r, y, sy, c, glow, seg = 14) => tag(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)).scale(1, sy, 1).translate(0, y, 0), c, glow);
const lathe = (pts, seg, c, glow) => tag(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), c, glow);

// cls: 0 low, 1 mid, 2 tall
function buildModel(arch, cls, rng, cul) {
  const W = cul.wall;
  const W2 = cul.wall2;
  const A = cul.accent;
  const parts = [];
  let H;
  if (arch === 'spire') {
    const seg = rng.pick([6, 8, 10]);
    H = cls === 2 ? rng.float(7, 11) : cls === 1 ? rng.float(2.6, 4) : rng.float(0.9, 1.5);
    const tiers = cls === 2 ? rng.int(3, 5) : cls === 1 ? 2 : 1;
    let y = 0;
    let r = 1;
    for (let t = 0; t < tiers; t++) {
      const h = (H * 0.82) / tiers;
      parts.push(cyl(r * 0.9, r, h, y, seg, t % 2 ? W2 : W, 1));
      y += h;
      parts.push(cyl(r * 1.1, r * 1.1, Math.max(0.05, H * 0.015), y, seg, A, 0));
      r *= rng.float(0.62, 0.8);
    }
    parts.push(cone(r * 0.95, H * 0.18 + 0.2, y, seg, A));
  } else if (arch === 'dome') {
    if (cls === 0) {
      parts.push(cyl(1, 1, 0.4, 0, 18, W, 1), ball(1, 0.4, 0.75, W2, 0.25, 18));
    } else if (cls === 1) {
      const h = rng.float(1.6, 2.6);
      parts.push(cyl(0.8, 0.88, h, 0, 16, W, 1), ball(0.82, h, 0.8, W2, 0.3, 16), cone(0.12, 0.7, h + 0.6, 8, A));
    } else {
      const stem = rng.float(4, 6.5);
      parts.push(cyl(0.45, 0.65, stem, 0, 12, W, 1), ball(1, stem + 0.6, 1.25, W2, 1, 18), cyl(0.18, 0.25, 1.8, stem + 1.6, 8, W, 0.5), ball(0.42, stem + 3.6, 1.2, A, 0.4, 12), cone(0.06, 1.2, stem + 4.0, 6, A));
    }
  } else if (arch === 'ziggurat') {
    const steps = cls === 2 ? rng.int(5, 8) : cls === 1 ? rng.int(3, 4) : 2;
    H = 0;
    let w = 1.45;
    const hs = cls === 2 ? rng.float(1.1, 1.6) : cls === 1 ? rng.float(0.7, 1.0) : rng.float(0.4, 0.6);
    for (let i = 0; i < steps; i++) {
      parts.push(box(w, hs, w * rng.float(0.85, 1.0), H, i % 2 ? W2 : W, 1));
      H += hs;
      parts.push(box(w * 1.04, 0.06, w * 1.04, H - 0.03, A, 0));
      w *= rng.float(0.72, 0.85);
    }
    if (cls > 0) {
      parts.push(cyl(0.03, 0.05, H * 0.25, H, 6, A, 0));
    }
  } else if (arch === 'organic') {
    H = cls === 2 ? rng.float(6, 9) : cls === 1 ? rng.float(2.4, 3.6) : rng.float(1, 1.6);
    const N = 12;
    const f = rng.float(1.5, 3.5);
    const ph = rng.float(0, 6);
    const pts = [[0.001, 0]];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const r = (0.55 + 0.32 * Math.sin(t * f * Math.PI + ph)) * (1 - t * 0.35) + 0.15;
      pts.push([r, t * H * 0.86]);
    }
    // a flared cap, like a mushroom's or a flower's
    const cap = cls === 2 ? rng.float(1.2, 1.7) : rng.float(0.9, 1.3);
    pts.push([cap, H * 0.9], [cap * 0.8, H * 0.95], [0.001, H]);
    parts.push(lathe(pts.slice(0, N + 2), 14, W, 1), lathe(pts.slice(N + 1), 14, W2, 0.2));
  } else {
    // crystal: faceted shards, some leaning
    const n = cls === 2 ? rng.int(2, 3) : cls === 1 ? rng.int(1, 3) : rng.int(1, 2);
    const seg = rng.int(4, 6);
    H = 0;
    for (let i = 0; i < n; i++) {
      const h = (cls === 2 ? rng.float(6, 10) : cls === 1 ? rng.float(2.2, 3.6) : rng.float(0.9, 1.5)) * (i === 0 ? 1 : rng.float(0.45, 0.75));
      const r = i === 0 ? 0.85 : rng.float(0.35, 0.6);
      const shard = mergeGeometries([cyl(r * 0.7, r, h, 0, seg, i % 2 ? W2 : W, 1), cone(r * 0.7, h * 0.22, h, seg, A)]);
      const a = rng.float(0, Math.PI * 2);
      shard.rotateX(i ? rng.float(-0.25, 0.25) : 0).rotateZ(i ? rng.float(-0.25, 0.25) : 0).translate(i ? Math.cos(a) * 0.55 : 0, 0, i ? Math.sin(a) * 0.55 : 0);
      parts.push(shard);
      H = Math.max(H, h * 1.22);
    }
  }
  const geo = mergeGeometries(parts);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  return { geo, height: bb.max.y, reach: Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) };
}

// windows by floor and bay, lit at random (more at night), worked out on the building itself
function buildingMaterial(cul) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: cul.glassy ? 0.3 : 0.62, metalness: cul.glassy ? 0.45 : 0.15 });
  const uniforms = { uGlow: { value: cul.glow.clone() }, uNight: { value: 0 }, uLitFrac: { value: cul.litFrac } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying vec3 vObj;\nvarying float vInst;\nvarying float vGlowW;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vObj = position * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vInst = float(gl_InstanceID);
        vGlowW = aGlow;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uGlow;
        uniform float uNight;
        uniform float uLitFrac;
        varying vec3 vObj;
        varying float vInst;
        varying float vGlowW;
        float cityHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float fl = vObj.y / 4.2;
        float wy = smoothstep(0.26, 0.33, fract(fl)) * (1.0 - smoothstep(0.7, 0.77, fract(fl)));
        float circ = atan(vObj.z, vObj.x) * max(length(vObj.xz), 1.0) / 3.4;
        float wx = smoothstep(0.15, 0.25, fract(circ)) * (1.0 - smoothstep(0.75, 0.85, fract(circ)));
        float win = wy * wx * vGlowW;
        float lit = step(1.0 - uLitFrac, cityHash(vec3(floor(fl), floor(circ), vInst)));
        // far off, single windows shimmer: there they blend into an even glow
        float farW = smoothstep(1200.0, 5000.0, length(vViewPosition));
        win = mix(win, 0.3 * vGlowW, farW);
        lit = mix(lit, uLitFrac, farW);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.3 + vec3(0.02, 0.03, 0.05), win * 0.7);
        // grime toward the foot of each building
        diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(0.0, 14.0, vObj.y);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * win * lit * (0.03 + uNight * 0.95);`,
      );
  };
  mat.customProgramCacheKey = () => 'city-building-v1';
  return mat;
}

// streets, pavements and plazas, with lamps along the kerbs at night
function groundMaterial(cul, plan, radius, groundCol) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
  const uniforms = {
    uPlan: { value: new THREE.Vector4(plan.radial ? 1 : 0, plan.plaza, plan.width, plan.ringGap) },
    uPlan2: { value: new THREE.Vector4(plan.spokes, plan.block, plan.angle, radius) },
    uPave: { value: cul.pave.clone() },
    uRoad: { value: cul.road.clone() },
    uGlow: { value: cul.glow.clone() },
    uAccent: { value: cul.accent.clone() },
    uGround: { value: groundCol },
    uNight: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCity;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCity = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec4 uPlan;
        uniform vec4 uPlan2;
        uniform vec3 uPave;
        uniform vec3 uRoad;
        uniform vec3 uGlow;
        uniform vec3 uAccent;
        uniform vec3 uGround;
        uniform float uNight;
        varying vec2 vCity;
        // distance to the nearest street's centre line, and how far along it (for dashes and lamps)
        vec2 street(vec2 p) {
          float r = length(p);
          if (uPlan.x > 0.5) {
            float rr = r - uPlan.y;
            float dRing = abs(rr - floor(rr / uPlan.w + 0.5) * uPlan.w);
            float seg = 6.2831853 / uPlan2.x;
            float a = atan(p.y, p.x);
            float dSpoke = abs(a - floor(a / seg + 0.5) * seg) * r;
            return dRing < dSpoke ? vec2(dRing, a * r) : vec2(dSpoke, r);
          }
          float c = cos(uPlan2.z);
          float s = sin(uPlan2.z);
          vec2 q = vec2(p.x * c + p.y * s, -p.x * s + p.y * c);
          float B = uPlan2.y;
          float dx = abs(q.x - floor(q.x / B + 0.5) * B);
          float dy = abs(q.y - floor(q.y / B + 0.5) * B);
          float dr = abs(r - uPlan.y);
          if (dr < min(dx, dy)) return vec2(dr, atan(p.y, p.x) * r);
          return dx < dy ? vec2(dx, q.y) : vec2(dy, q.x);
        }
        float cityLamp;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float r = length(vCity);
        // the paving frays out into the ground at the city's edge
        float edge = uPlan2.w + 70.0 + 25.0 * sin(atan(vCity.y, vCity.x) * 7.0) * sin(r * 0.03);
        if (r > edge) discard;
        vec2 st = street(vCity);
        float hw = uPlan.z * 0.5;
        vec3 col;
        cityLamp = 0.0;
        if (r < uPlan.y) {
          // the plaza: big flagstones and inlaid rings
          vec2 t = fract(vCity / 7.0);
          float joint = step(0.035, t.x) * step(0.035, t.y);
          // flagstones of slightly different shades
          float shade = fract(sin(dot(floor(vCity / 7.0), vec2(12.9898, 78.233))) * 43758.5453);
          col = uPave * (0.6 + 0.4 * joint) * (0.9 + 0.25 * shade) * 1.15;
          float ring = 1.0 - smoothstep(0.4, 1.2, abs(fract(r / (uPlan.y * 0.25)) - 0.5) * uPlan.y * 0.25);
          col = mix(col, uAccent * 0.8, ring * 0.35);
        } else if (st.x < hw) {
          col = uRoad;
          // dashed centre line
          col = mix(col, uPave * 1.4, (1.0 - smoothstep(0.18, 0.3, st.x)) * step(0.5, fract(st.y / 9.0)));
        } else if (st.x < hw + 4.0) {
          vec2 t = fract(vCity / 1.6);
          col = uPave * (0.75 + 0.25 * step(0.06, t.x) * step(0.06, t.y)) * 1.1;
          // lamps along the kerb
          cityLamp = (1.0 - smoothstep(0.35, 0.9, abs(st.x - hw - 0.6))) * (1.0 - smoothstep(0.08, 0.16, abs(fract(st.y / 24.0) - 0.5)));
        } else {
          // building lots: worn, patched paving
          float lotPatch = fract(sin(dot(floor(vCity / 11.0), vec2(39.3468, 11.135))) * 24634.6345);
          col = uPave * (0.62 + 0.18 * lotPatch);
          // toward the edge the lots go back to the world's own ground
          col = mix(col, uGround * (0.85 + 0.2 * lotPatch), smoothstep(uPlan2.w * 0.55, uPlan2.w * 0.95, r));
        }
        // the very rim, streets too, fades into it
        col = mix(col, uGround, smoothstep(uPlan2.w + 10.0, edge, r));
        diffuseColor.rgb *= col;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * cityLamp * (0.05 + uNight * 2.5);`,
      );
  };
  mat.customProgramCacheKey = () => 'city-ground-v1';
  return mat;
}

// a paved cap following the curve of the levelled plain (positions relative to the city's centre)
function groundGeometry(city, frame, R, center) {
  const K = 44;
  const S = 160;
  const Rm = city.radius + 110;
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  for (let k = 0; k <= K; k++) {
    const r = Math.pow(k / K, 1.25) * Rm;
    for (let i = 0; i <= S; i++) {
      const a = (i / S) * Math.PI * 2;
      const u = Math.cos(a) * r;
      const v = Math.sin(a) * r;
      const p = cityPoint(city, frame, R, u, v, 0.12, _v);
      nrm.push(...p.clone().normalize().toArray());
      pos.push(p.x - center.x, p.y - center.y, p.z - center.z);
      uv.push(u, v);
    }
  }
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < S; i++) {
      const a = k * (S + 1) + i;
      const b = a + S + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Cities {
  constructor(game) {
    this.game = game;
    this.planet = null;
    this.list = [];
    this.met = new Set();
    this.time = 0;
    this.citizens = new Citizens(game, this);
  }

  setPlanet(planet) {
    if (planet === this.planet) return;
    for (const c of this.list) this.unbuild(c);
    this.citizens.setCity(null);
    if (this.lights) {
      this.lights.parent?.remove(this.lights);
      this.lights.geometry.dispose();
      this.lights.material.dispose();
      this.lights = null;
    }
    this.buildingMat?.dispose();
    this.buildingMat = null;
    this.list = [];
    this.planet = planet;
    if (!planet?.cities?.length) return;
    this.culture = cultureFor(planet);
    this.species = speciesFor(planet);
    this.buildingMat = buildingMaterial(this.culture);
    const R = planet.radius;
    const lightPos = [];
    for (const c of planet.cities) {
      const frame = cityFrame(c);
      const plan = streetPlan(c);
      const layout = layoutCity(c, plan);
      const center = cityPoint(c, frame, R, 0, 0, 0, new THREE.Vector3());
      this.list.push({ city: c, frame, plan, layout, center, name: c.name, built: null, steps: null });
      // from orbit at night: a point of light for every building (thinned)
      for (let i = 0; i < layout.buildings.length; i += 2) {
        const b = layout.buildings[i];
        lightPos.push(...cityPoint(c, frame, R, b[0], b[1], b[3] * 0.5, _v).toArray());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lightPos, 3));
    this.lights = new THREE.Points(g, new THREE.PointsMaterial({ color: this.culture.glow.clone().multiplyScalar(2.2), size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lights.frustumCulled = false;
    planet.root.add(this.lights);
  }

  // the whole city, a step at a time (models, then each kind of building, the ground, the rest)
  *buildSteps(c) {
    const cul = this.culture;
    const planet = this.planet;
    const R = planet.radius;
    const rng = new Random(c.city.seed ^ 0x3d1);
    const group = new THREE.Group();
    group.position.copy(c.center);
    const built = { group, meshes: [], cols: null, traffic: null, kiosk: null };
    // three models per class: two of the world's main style, one of its second
    const models = [0, 1, 2].map((cls) => [0, 1, 2].map((k) => buildModel(k < 2 ? cul.arch : cul.second, cls, rng, cul)));
    yield;
    const groups = new Map();
    for (const b of c.layout.buildings) {
      const key = b[4] * 3 + (b[6] % 3);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    const cols = [];
    const up = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (const [key, list] of groups) {
      const model = models[Math.floor(key / 3)][key % 3];
      const mesh = new THREE.InstancedMesh(model.geo, this.buildingMat, list.length);
      list.forEach((b, i) => {
        const p = cityPoint(c.city, c.frame, R, b[0], b[1], -0.5, _v);
        up.copy(p).normalize();
        _q.setFromUnitVectors(Y, up).multiply(new THREE.Quaternion().setFromAxisAngle(Y, b[5]));
        const s = b[2] / model.reach;
        // stretched toward the height the layout wants, within reason
        const ys = THREE.MathUtils.clamp(b[3] / (model.height * s), 0.8, 1.3);
        scale.set(s, s * ys, s);
        _m.compose(p.sub(c.center), _q, scale);
        mesh.setMatrixAt(i, _m);
        cols.push([b[0], b[1], b[2] + 0.5, model.height * s * ys - 0.5]);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      built.meshes.push(mesh);
      yield;
    }
    // the landmark over the plaza, the world's grandest building
    {
      const lm = buildModel(cul.arch, 2, rng, cul);
      const foot = c.plan.plaza * 0.24;
      const s = foot / lm.reach;
      const ys = THREE.MathUtils.clamp((c.layout.hMax * 1.7) / (lm.height * s), 1, 1.8);
      const mesh = new THREE.InstancedMesh(lm.geo, this.buildingMat, 1);
      const p = cityPoint(c.city, c.frame, R, 0, 0, -0.5, _v);
      _q.setFromUnitVectors(Y, p.clone().normalize());
      _m.compose(p.sub(c.center), _q, scale.set(s, s * ys, s));
      mesh.setMatrixAt(0, _m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      built.meshes.push(mesh);
      cols.push([0, 0, foot + 0.5, lm.height * s * ys]);
      built.landmark = lm.geo;
    }
    yield;
    // the paving
    const pc = planet.params.colors;
    const groundCol = new THREE.Color(...pc.dry).lerp(new THREE.Color(...pc.low1), 0.4);
    const gmat = groundMaterial(cul, c.plan, c.city.radius, groundCol);
    const ground = new THREE.Mesh(groundGeometry(c.city, c.frame, R, c.center), gmat);
    ground.receiveShadow = true;
    group.add(ground);
    built.ground = ground;
    yield;
    // the trade post, on the plaza east of the landmark: a kiosk and a canopy
    {
      const A = cul.accent;
      const parts = [cyl(1.4, 1.6, 1.2, 0, 12, cul.wall2, 0), cyl(0.15, 0.15, 3.4, 1.2, 6, A, 0), cyl(3.2, 2.4, 0.25, 4.4, 16, cul.wall, 0), ball(0.45, 1.9, 1, A, 1, 10)];
      const geo = mergeGeometries(parts);
      const mesh = new THREE.InstancedMesh(geo, this.buildingMat, 1);
      const ku = c.plan.plaza * 0.62;
      const p = cityPoint(c.city, c.frame, R, ku, 0, -0.05, _v);
      _q.setFromUnitVectors(Y, p.clone().normalize());
      _m.compose(p.clone().sub(c.center), _q, scale.set(1, 1, 1));
      mesh.setMatrixAt(0, _m);
      mesh.castShadow = true;
      group.add(mesh);
      built.meshes.push(mesh);
      built.kiosk = cityPoint(c.city, c.frame, R, ku, 0, 1.2, new THREE.Vector3());
      cols.push([ku, 0, 1.7, 1.25]);
    }
    // air traffic: small craft circling at different heights
    {
      const n = 26 + rng.int(0, 20);
      const hull = mergeGeometries([box(1.4, 0.7, 4.2, -0.35, cul.wall2, 0), box(3.6, 0.15, 1.4, -0.1, cul.accent, 0)]);
      const mesh = new THREE.InstancedMesh(hull, this.buildingMat, n);
      const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: cul.glow.clone().multiplyScalar(3) }), n);
      const craft = [];
      for (let i = 0; i < n; i++) {
        craft.push({ r: rng.float(c.plan.plaza * 1.5, c.city.radius * 0.85), h: rng.float(45, 200), a: rng.float(0, Math.PI * 2), w: rng.float(18, 55) * (rng.chance(0.5) ? 1 : -1) });
      }
      mesh.frustumCulled = false;
      lights.frustumCulled = false;
      group.add(mesh, lights);
      built.traffic = { mesh, lights, craft };
    }
    // collision: buildings as upright cylinders, bucketed on a 60 m grid
    const grid = new Map();
    cols.forEach((b, i) => {
      const r = b[2];
      for (let x = Math.floor((b[0] - r) / 60); x <= Math.floor((b[0] + r) / 60); x++) {
        for (let y = Math.floor((b[1] - r) / 60); y <= Math.floor((b[1] + r) / 60); y++) {
          const k = x * 4096 + y;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        }
      }
    });
    built.cols = cols;
    built.grid = grid;
    planet.root.add(group);
    return built;
  }

  unbuild(c) {
    if (c.built) {
      c.built.group.parent?.remove(c.built.group);
      c.built.group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.material !== this.buildingMat) o.material.dispose();
        }
      });
    }
    if (this.citizens.city === c) this.citizens.setCity(null);
    c.built = null;
    c.steps = null;
  }

  update(dt, planet) {
    const g = this.game;
    this.time += dt;
    // cities belong to the world you are at (from orbit too: their lights)
    if (planet !== this.planet) this.setPlanet(planet?.cities?.length ? planet : null);
    if (!this.planet) {
      this.citizens.update(dt, null);
      return;
    }
    const P = this.planet;
    const camLocal = P.worldToLocal(g.camWorld, _v2);
    const sunLocal = P.dirToLocal(_v.copy(g.system.star.position).sub(P.position).normalize(), new THREE.Vector3());
    let budget = STEP_BUDGET;
    let near = null;
    let nearD = Infinity;
    let lightsK = 0;
    for (const c of this.list) {
      const d = camLocal.distanceTo(c.center);
      const night = 1 - THREE.MathUtils.smoothstep(c.city.dir.dot(sunLocal), -0.12, 0.12);
      lightsK = Math.max(lightsK, night * THREE.MathUtils.smoothstep(d, 2500, 9000));
      if (!c.built && d < BUILD_NEAR) {
        c.steps ||= this.buildSteps(c);
        const t0 = performance.now();
        while (performance.now() - t0 < budget) {
          const r = c.steps.next();
          if (r.done) {
            c.built = r.value;
            c.steps = null;
            break;
          }
        }
        budget = 0;
      } else if (c.built && d > BUILD_FAR) this.unbuild(c);
      c.night = night;
      if (c.built) {
        c.built.ground.material.userData.uniforms.uNight.value = night;
        this.flyTraffic(c, dt);
      }
      if (d < nearD) {
        nearD = d;
        near = c;
      }
      // first visit: who lives here
      if (d < c.city.radius * 1.6 && !this.met.has(`${P.name}/${c.name}`)) {
        this.met.add(`${P.name}/${c.name}`);
        const pop = (0.4 + (c.city.seed % 1000) / 1000 * 3.6) * (c.city.radius / 1500);
        const sp = this.species;
        g.hud.showBanner(`${c.name.toUpperCase()}`, `City of the ${sp.plural}`, [`Population ${pop.toFixed(1)} million`, 'Trade post in the central plaza']);
        g.audio.play('discovery');
        g.inventory.units += 400;
      }
    }
    // (the buildings share one material: lit for the city you are nearest)
    if (near) this.buildingMat.userData.uniforms.uNight.value = near.night;
    this.lights.material.opacity = lightsK;
    this.lights.visible = lightsK > 0.01;
    this.citizens.update(dt, near?.built && nearD < near.city.radius + 600 ? near : null);
  }

  flyTraffic(c, dt) {
    const tr = c.built.traffic;
    const R = this.planet.radius;
    const up = new THREE.Vector3();
    tr.craft.forEach((k, i) => {
      k.a += (k.w / k.r) * dt;
      const u = Math.cos(k.a) * k.r;
      const v = Math.sin(k.a) * k.r;
      const p = cityPoint(c.city, c.frame, R, u, v, k.h, _v);
      up.copy(p).normalize();
      // nose along the circle
      const ahead = cityPoint(c.city, c.frame, R, Math.cos(k.a + Math.sign(k.w) * 0.01) * k.r, Math.sin(k.a + Math.sign(k.w) * 0.01) * k.r, k.h, new THREE.Vector3());
      _m.lookAt(p, ahead, up);
      _q.setFromRotationMatrix(_m);
      _m.compose(p.sub(c.center), _q, new THREE.Vector3(1, 1, 1));
      tr.mesh.setMatrixAt(i, _m);
      _m.compose(_v.copy(cityPoint(c.city, c.frame, R, u, v, k.h - 0.4, _v)).sub(c.center), _q, new THREE.Vector3(1, 1, 1));
      tr.lights.setMatrixAt(i, _m);
    });
    tr.mesh.instanceMatrix.needsUpdate = true;
    tr.lights.instanceMatrix.needsUpdate = true;
  }

  // the city a planet-local point is in (with its u, v and height over the paving)
  locate(local, out) {
    for (const c of this.list) {
      if (!c.built) continue;
      const rel = _v.copy(local).sub(c.center);
      if (rel.length() > c.city.radius + 800) continue;
      out.c = c;
      out.u = rel.dot(c.frame.east);
      out.v = rel.dot(c.frame.north);
      out.h = local.length() - (this.planet.radius + c.city.base);
      return out;
    }
    return null;
  }

  // push something of radius `rad` out of the buildings; returns the push (planet-local) or null
  collide(local, rad, height = 0) {
    const at = this.locate(local, {});
    if (!at) return null;
    const { c, u, v, h } = at;
    const list = c.built.grid.get(Math.floor(u / 60) * 4096 + Math.floor(v / 60));
    if (!list) return null;
    let push = null;
    for (const i of list) {
      const b = c.built.cols[i];
      if (h > b[3] || h + height < -2) continue;
      const du = u - b[0];
      const dv = v - b[1];
      const d = Math.hypot(du, dv);
      const min = b[2] + rad;
      if (d >= min) continue;
      // out sideways, or up onto the roof if nearly there
      if (b[3] - h < 1.2) {
        push = { up: b[3] - h, roof: true };
        continue;
      }
      const k = (min - d) / (d || 1);
      push = push || { u: 0, v: 0 };
      push.u = (push.u || 0) + du * k;
      push.v = (push.v || 0) + dv * k;
    }
    if (!push) return null;
    const out = new THREE.Vector3();
    if (push.roof) out.copy(local).normalize().multiplyScalar(push.up);
    else out.copy(c.frame.east).multiplyScalar(push.u).addScaledVector(c.frame.north, push.v);
    out.roof = !!push.roof;
    return out;
  }

  collideShip(ship) {
    const s = ship.state;
    if (!this.planet || s.frame !== this.planet) return;
    const p = this.collide(s.pos, 7, 3);
    if (!p) return;
    s.pos.add(p);
    // a glancing blow: the velocity into the wall is lost (and hurts at speed)
    const n = p.clone().normalize();
    const vin = s.vel.dot(n);
    if (vin < 0) {
      if (vin < -30) ship.damage(Math.min(30, -vin * 0.25));
      s.vel.addScaledVector(n, -vin);
    }
  }

  collidePlayer(player) {
    const s = player.state;
    if (!this.planet || s.frame !== this.planet) return;
    const p = this.collide(s.pos, 0.4, 1.8);
    if (!p) return;
    s.pos.add(p);
    if (p.roof) {
      player.grounded = true;
      const up = s.pos.clone().normalize();
      const vu = s.vel.dot(up);
      if (vu < 0) s.vel.addScaledVector(up, -vu);
    }
  }

  // the trade post, when you stand at it
  nearKiosk(local) {
    for (const c of this.list) if (c.built?.kiosk && c.built.kiosk.distanceTo(local) < 4) return c;
    return null;
  }

  markers(camLocal) {
    const out = [];
    for (const c of this.list) {
      const d = camLocal.distanceTo(c.center);
      if (d < 250 || d > 120000) continue;
      out.push({ label: c.name, pos: cityPoint(c.city, c.frame, this.planet.radius, 0, 0, 60, new THREE.Vector3()) });
    }
    return out;
  }
}

