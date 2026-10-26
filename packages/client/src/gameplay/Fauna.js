// Procedural creatures. Each species is one InstancedMesh; limbs are animated in
// the vertex shader from per-vertex limb ids + pivots and per-instance gait phase.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random, makeName } from '../math/rng.js';
import { archetype } from '../terrain/planetgen.js';
import { libraryMesh, libraryVariants, recolor } from './modelLibrary.js';

const HIDES = [0xb08850, 0xa0502a, 0x8a8a92, 0xd8c8a0, 0x5a4030, 0xc07040, 0x6a6058, 0x4a6a8a, 0x6a4a7a, 0x3a7a6a, 0x8a3a4a];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

// limb ids: 0 body, 1..4 legs (FL, FR, BL, BR), 5 tail, 6 head, 7/8 wings L/R
function part(geo, limb, pivot, color, glow = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  const lim = new Float32Array(n);
  const piv = new Float32Array(n * 3);
  const gl = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    lim[i] = limb;
    piv[i * 3] = pivot.x;
    piv[i * 3 + 1] = pivot.y;
    piv[i * 3 + 2] = pivot.z;
    gl[i] = glow;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aLimb', new THREE.BufferAttribute(lim, 1));
  geo.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

function limbBetween(a, b, r0, r1, seg = 7) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

function ellipsoid(rx, ry, rz, pos, seg = 14) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1));
  g.scale(rx, ry, rz);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function buildQuadruped(rng, cols, biped) {
  const s = 1;
  const parts = [];
  const legLen = rng.float(0.45, 1.1) * (biped ? 1.5 : 1);
  const bodyL = rng.float(0.9, 1.6);
  const bodyH = rng.float(0.5, 0.8);
  const bodyW = rng.float(0.45, 0.75);
  const hipY = legLen;
  const bodyY = hipY + bodyH * 0.25;
  const tilt = biped ? 0.5 : 0;
  // body
  const body = ellipsoid(bodyW / 2, bodyH / 2, bodyL / 2, V(0, bodyY, 0), 16);
  if (tilt) body.rotateX(-tilt * 0.6);
  parts.push(part(body, 0, V(0, 0, 0), cols.base));
  const belly = ellipsoid(bodyW * 0.42, bodyH * 0.38, bodyL * 0.42, V(0, bodyY - bodyH * 0.16, 0), 12);
  parts.push(part(belly, 0, V(0, 0, 0), cols.belly));
  // spots / plates
  if (rng.chance(0.6)) {
    const n = rng.int(3, 7);
    for (let i = 0; i < n; i++) {
      const z = (rng.next() - 0.5) * bodyL * 0.7;
      const g = ellipsoid(0.09, 0.05, 0.09, V((rng.next() - 0.5) * bodyW * 0.4, bodyY + bodyH * 0.45, z), 6);
      parts.push(part(g, 0, V(0, 0, 0), cols.accent, cols.glow ? 1 : 0));
    }
  }
  if (rng.chance(0.4)) {
    // dorsal spikes
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const z = bodyL * 0.35 - (i / n) * bodyL * 0.8;
      const g = new THREE.ConeGeometry(0.06, 0.25 + rng.float(0, 0.2), 5);
      g.translate(0, bodyY + bodyH * 0.5 + 0.1, z);
      parts.push(part(g, 0, V(0, 0, 0), cols.accent));
    }
  }
  // legs
  const legs = biped
    ? [[1, -1, 0.05], [2, 1, 0.05]]
    : [[1, -1, 1], [2, 1, 1], [3, -1, -1], [4, 1, -1]];
  const r = rng.float(0.05, 0.11);
  for (const [id, sx, sz] of legs) {
    const hip = V(sx * bodyW * 0.32, hipY + bodyH * 0.05, sz * bodyL * 0.3);
    const knee = V(hip.x * 1.1, hipY * 0.45, hip.z + (biped ? 0.12 : sz * 0.04));
    const foot = V(hip.x * 1.1, 0.04, hip.z + (biped ? 0.0 : 0.02));
    parts.push(part(limbBetween(hip, knee, r * 1.3, r), id, hip, cols.base));
    parts.push(part(limbBetween(knee, foot, r, r * 0.75), id, hip, cols.legs));
    parts.push(part(ellipsoid(r * 1.4, r * 0.7, r * 2, foot, 6), id, hip, cols.legs));
  }
  // neck & head
  const front = V(0, bodyY + bodyH * (biped ? 0.6 : 0.15), bodyL * (biped ? 0.25 : 0.45));
  const neckLen = rng.float(0.15, 0.7) * (biped ? 0.6 : 1);
  const headPos = front.clone().add(V(0, neckLen * 0.8, neckLen * 0.6));
  parts.push(part(limbBetween(front, headPos, 0.14, 0.1), 6, front, cols.base));
  const hs = rng.float(0.18, 0.32);
  parts.push(part(ellipsoid(hs, hs * 0.85, hs * 1.15, headPos, 12), 6, front, cols.base));
  const snout = new THREE.ConeGeometry(hs * 0.55, hs * rng.float(0.6, 1.4), 8);
  snout.rotateX(Math.PI / 2);
  snout.translate(headPos.x, headPos.y - hs * 0.15, headPos.z + hs * 1.1);
  parts.push(part(snout, 6, front, cols.belly));
  for (const sx of [-1, 1]) {
    const eye = ellipsoid(hs * 0.18, hs * 0.18, hs * 0.12, V(sx * hs * 0.55, headPos.y + hs * 0.25, headPos.z + hs * 0.6), 8);
    parts.push(part(eye, 6, front, 0x05070a, cols.glowEyes ? 1.5 : 0));
  }
  const feature = rng.int(0, 3);
  if (feature === 0) {
    for (const sx of [-1, 1]) {
      const h = new THREE.ConeGeometry(0.05, hs * 1.6, 6);
      h.rotateX(-0.6);
      h.rotateZ(sx * 0.4);
      h.translate(sx * hs * 0.45, headPos.y + hs * 1.0, headPos.z - hs * 0.2);
      parts.push(part(h, 6, front, cols.horn));
    }
  } else if (feature === 1) {
    const crest = ellipsoid(0.03, hs * 0.9, hs * 0.9, V(0, headPos.y + hs * 0.8, headPos.z - hs * 0.4), 8);
    parts.push(part(crest, 6, front, cols.accent, cols.glow ? 0.8 : 0));
  } else if (feature === 2) {
    for (const sx of [-1, 1]) {
      const a = limbBetween(V(sx * hs * 0.3, headPos.y + hs * 0.6, headPos.z), V(sx * hs * 0.8, headPos.y + hs * 2.2, headPos.z - hs * 0.6), 0.025, 0.02, 5);
      parts.push(part(a, 6, front, cols.legs));
      parts.push(part(ellipsoid(0.06, 0.06, 0.06, V(sx * hs * 0.8, headPos.y + hs * 2.2, headPos.z - hs * 0.6), 6), 6, front, cols.accent, 1.2));
    }
  }
  // tail
  const tailBase = V(0, bodyY + (biped ? -bodyH * 0.2 : 0), -bodyL * 0.45);
  const tl = rng.float(0.3, 1.4);
  const tail = new THREE.ConeGeometry(0.1, tl, 7);
  tail.rotateX(-Math.PI / 2 - (biped ? -0.2 : 0.3));
  tail.translate(0, tailBase.y - 0.05, tailBase.z - tl * 0.45);
  parts.push(part(tail, 5, tailBase, cols.base));
  const geo = mergeGeometries(parts, false);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return { geo, height: headPos.y + hs, length: bodyL + tl, legLen };
}

function buildFlyer(rng, cols) {
  const parts = [];
  const body = ellipsoid(0.12, 0.1, 0.32, V(0, 0, 0), 10);
  parts.push(part(body, 0, V(0, 0, 0), cols.base));
  const head = ellipsoid(0.08, 0.08, 0.09, V(0, 0.04, 0.3), 8);
  parts.push(part(head, 0, V(0, 0, 0), cols.belly));
  const beak = new THREE.ConeGeometry(0.03, 0.12, 5);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.03, 0.42);
  parts.push(part(beak, 0, V(0, 0, 0), cols.horn));
  const span = rng.float(0.5, 0.9);
  for (const [id, sx] of [[7, -1], [8, 1]]) {
    const w = new THREE.BufferGeometry();
    const pts = [0, 0, 0.12, sx * span, 0, -0.05, sx * span * 0.7, 0, -0.22, 0, 0, -0.12];
    w.setAttribute('position', new THREE.Float32BufferAttribute([
      pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7], pts[8],
      pts[0], pts[1], pts[2], pts[6], pts[7], pts[8], pts[9], pts[10], pts[11],
    ], 3));
    parts.push(part(w, id, V(sx * 0.08, 0, 0), cols.accent, cols.glow ? 0.6 : 0));
  }
  const tail = new THREE.ConeGeometry(0.08, 0.25, 4);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1, 0.3, 1);
  tail.translate(0, 0, -0.4);
  parts.push(part(tail, 5, V(0, 0, -0.3), cols.accent));
  const geo = mergeGeometries(parts, false);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return { geo, height: 0.2, length: 0.8 };
}

// A modelled creature from public/models/creatures.glb, recoloured for the species and scaled
// to the procedural body it replaces. Library meshes carry `_limb`, `_pivot` (Blender axes)
// and `_glow` attributes, which feed the same vertex-shader animation as the procedural ones.
const BODY_PLANS = { quad: ['quad_grazer', 'quad_grazer', 'quad_heavy', 'quad_small'], biped: ['biped'], flyer: ['flyer'] };
function libraryCreature(kind, rng, cols, ref) {
  const prefix = rng.pick(BODY_PLANS[kind]);
  const variants = libraryVariants('creatures', prefix);
  if (!variants.length) return null;
  const mesh = libraryMesh('creatures', rng.pick(variants));
  const src = mesh.geometry;
  if (!src.attributes._limb || !src.attributes._pivot) return null;
  const geo = recolor(mesh, { primary: new THREE.Color(cols.base), secondary: new THREE.Color(cols.belly), accent: new THREE.Color(cols.accent) }, { albedoCap: 0.75, aoFloor: 0.05 });
  const n = geo.attributes.position.count;
  const limb = new Float32Array(n);
  const piv = new Float32Array(n * 3);
  const glow = new Float32Array(n);
  const p = new THREE.Vector3();
  const pa = src.attributes._pivot;
  for (let i = 0; i < n; i++) {
    limb[i] = Math.round(src.attributes._limb.getX(i));
    p.set(pa.getX(i), pa.getZ(i), -pa.getY(i)).applyMatrix4(mesh.matrixWorld);
    piv[i * 3] = p.x;
    piv[i * 3 + 1] = p.y;
    piv[i * 3 + 2] = p.z;
    glow[i] = (src.attributes._glow ? src.attributes._glow.getX(i) : 0) * (cols.glow ? 1.2 : 0);
  }
  const box = geo.boundingBox;
  const s = kind === 'flyer' ? ref.length / Math.max(0.01, box.max.z - box.min.z) : ref.height / Math.max(0.01, box.max.y);
  geo.scale(s, s, s);
  for (let i = 0; i < piv.length; i++) piv[i] *= s;
  geo.setAttribute('aLimb', new THREE.BufferAttribute(limb, 1));
  geo.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  geo.computeBoundingSphere();
  ref.geo.dispose();
  return { geo, height: ref.height, length: ref.length, legLen: hipHeight(geo) || ref.legLen, plan: prefix };
}

// Mean hip / shoulder pivot height of the legs (model units; walkers stand with their soles on y = 0).
function hipHeight(geo) {
  const lim = geo.attributes.aLimb?.array;
  const piv = geo.attributes.aPivot?.array;
  if (!lim || !piv) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < lim.length; i++) {
    if (lim[i] > 0.5 && lim[i] < 4.5) {
      sum += piv[i * 3 + 1];
      n++;
    }
  }
  return n ? sum / n : 0;
}

// Leg swing amplitude (radians) for a gait value (0 idle, 1 walk, 1.4 run). Mirrored in the vertex shader
// and in blender/build_creatures.py (shader_pose), which previews and checks the walk cycle.
const legAmp = (g) => 0.38 * Math.min(g, 1) + 0.55 * Math.max(g - 1, 0);

// Vertex-shader animation, from per-vertex limb ids + joint pivots and per-instance phase / gait / seed.
// Walkers: legs swing from the hip in diagonal pairs (bipeds alternate). A planted leg sweeps back at a
// constant rate while the whole body drops by the height its arc gains, so the planted foot stays on the
// ground; a swinging leg bends at half its hip height and lifts. Feet are kept level below 13 % of the hip
// height. The body pitches / rolls a little with the stride and breathes, the head nods with the stride
// and looks around / grazes when idle, the tail sways. Flyers flap with glides in between.
// uLeg: mean hip height (model units), uPlan: 0 quadruped, 1 biped, 2 flyer.
function creatureMaterial(time, { leg = 1, plan = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uLeg = { value: leg };
    shader.uniforms.uPlan = { value: plan };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aLimb;
        attribute vec3 aPivot;
        attribute float aGlow;
        attribute float aPhase;
        attribute float aGait;
        attribute float aSeed;
        varying float vGlow;
        uniform float uTime;
        uniform float uLeg;
        uniform float uPlan;
        vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
        vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
        vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
        float legAmp(float g) { return 0.38 * min(g, 1.0) + 0.55 * max(g - 1.0, 0.0); }
        // swing angle (+ = foot back) and knee lift at cycle position u: stance for u < 0.5, then swing
        vec2 legPose(float u, float amp) {
          if (u < 0.5) return vec2(mix(-amp, amp, u * 2.0), 0.0);
          float s = u * 2.0 - 1.0;
          return vec2(mix(amp, -amp, s * s * (3.0 - 2.0 * s)), sin(3.14159265 * s));
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlow = aGlow;
        int limb = int(aLimb + 0.5);
        float g = aGait;
        float gw = min(g, 1.0);
        float t = uTime;
        float sd = aSeed * 6.2831853;
        vec3 lp = transformed - aPivot;
        if (uPlan > 1.5) {
          float glide = smoothstep(0.3, 0.9, sin(t * 0.33 + sd));
          float flap = sin(aPhase) * mix(0.85, 0.1, glide) + mix(0.1, 0.2, glide);
          if (limb == 7) transformed = aPivot + rotZ(lp, -flap);
          else if (limb == 8) transformed = aPivot + rotZ(lp, flap);
          else if (limb == 5) transformed = aPivot + rotX(rotY(lp, sin(aPhase * 0.5 + sd) * 0.22), sin(aPhase - 0.8) * 0.1 * (1.0 - glide));
          else if (limb == 6) transformed = aPivot + rotX(rotY(lp, sin(t * 0.6 + sd) * 0.3), sin(aPhase + 0.5) * 0.06 * (1.0 - glide));
          transformed.y += cos(aPhase) * 0.025 * (1.0 - glide);
        } else {
          float amp = legAmp(g);
          float cyc = aPhase * 0.15915494;
          float ths = mix(-amp, amp, fract(cyc * 2.0));
          float sink = 0.87 * (1.0 - cos(ths)); // x hip height: the drop that keeps the planted feet down
          float pitch = 0.025 * gw * sin(cyc * 12.566371 + 1.3);
          float roll = (uPlan > 0.5 ? 0.07 : 0.025) * gw * sin(cyc * 6.2831853);
          vec3 C = vec3(0.0, uLeg, 0.0);
          if (limb >= 1 && limb <= 4) {
            vec2 pose = legPose(fract(cyc + ((limb == 1 || limb == 4) ? 0.0 : 0.5)), amp);
            float lift = pose.y * sqrt(gw);
            float kap = lift * (1.05 + 0.4 * max(g - 1.0, 0.0));
            float hy = max(aPivot.y, 1e-3);
            float y0 = transformed.y;
            vec3 K = vec3(aPivot.x, hy * 0.5, aPivot.z);
            vec3 p = K + rotX(transformed - K, kap * (1.0 - smoothstep(hy * 0.38, hy * 0.62, y0)));
            vec3 ank = K + rotX(vec3(0.0, -hy * 0.37, 0.0), kap);
            p = ank + rotX(p - ank, -(pose.x + 0.85 * kap) * (1.0 - smoothstep(hy * 0.1, hy * 0.24, y0)));
            p = aPivot + rotX(p - aPivot, pose.x);
            p.y += lift * 0.04 * hy - hy * sink;
            transformed = p;
          } else {
            if (limb == 0) {
              float br = sin(t * 1.9 + sd) * (0.02 - 0.01 * gw);
              transformed.x *= 1.0 + br;
              transformed.y += max(transformed.y - uLeg, 0.0) * br * 0.8;
            } else if (limb == 5) {
              float sway = sin(cyc * 6.2831853 + 1.2) * 0.3 * gw + sin(t * 1.3 + sd) * 0.18 * (1.0 - gw);
              float lift = 0.06 * gw * sin(cyc * 12.566371 + 0.5) + 0.05 * sin(t * 0.8 + sd * 1.3);
              transformed = aPivot + rotX(rotY(lp, sway), -lift);
            } else if (limb == 6) {
              float idle = 1.0 - gw;
              float look = (sin(t * 0.45 + sd) + 0.6 * sin(t * 1.17 + sd * 2.1)) * 0.3 * idle;
              float graze = smoothstep(0.4, 0.95, sin(t * 0.19 + sd * 1.7)) * (uPlan > 0.5 ? 0.12 : 0.5) * idle;
              float nod = 0.07 * gw * sin(cyc * 12.566371 + 0.3) + 0.035 * sin(t * 1.6 + sd) * idle;
              transformed = aPivot + rotX(rotY(lp, look), nod + graze);
            }
            transformed = C + rotZ(rotX(transformed - C, pitch), roll);
            transformed.y -= uLeg * sink;
          }
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 2.0;');
  };
  mat.customProgramCacheKey = () => 'creature-v2';
  return mat;
}

// Bold, alien colour schemes for the colour-region masks: a richer hide (primary), a strongly contrasting
// secondary for the markings (cream, dark or an opposing hue) and the world's flora colour as the accent.
// Uses its own random stream so the species' rng sequence (and so their names) is unchanged.
function markings(base, accent, prng, extra) {
  const hsl = {};
  base.getHSL(hsl);
  const hide = new THREE.Color().setHSL((hsl.h + prng.float(-0.05, 0.05) + 1) % 1, Math.min(0.8, hsl.s * 1.3 + 0.1), THREE.MathUtils.clamp(hsl.l, 0.3, 0.55));
  const scheme = prng.int(0, 2);
  let second;
  if (scheme === 0) second = hide.clone().lerp(new THREE.Color(0xfff2dc), 0.72);
  else if (scheme === 1) second = hide.clone().multiplyScalar(0.3);
  else second = new THREE.Color().setHSL((hsl.h + prng.pick([0.4, 0.5, 0.6])) % 1, 0.5, hsl.l > 0.42 ? 0.28 : 0.68);
  return { base: hide.getHex(), belly: second.getHex(), legs: hide.clone().multiplyScalar(0.6).getHex(), accent: accent.getHex(), horn: 0xe8e0d0, ...extra };
}

const ADJ = ['Ambling', 'Skittish', 'Lumbering', 'Prancing', 'Burrowing', 'Grazing', 'Crested', 'Spined', 'Glowing', 'Hopping'];
const NOUN = { quad: ['Grazer', 'Strider', 'Hoofer', 'Crawler', 'Beast'], biped: ['Walker', 'Stalker', 'Runner'], flyer: ['Glider', 'Flutterer', 'Skywing'] };

export class Fauna {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.planet = null;
    this.species = [];
    this.creatures = [];
    this.time = { value: 0 };
    this.anchor = new THREE.Vector3();
    this.scanned = new Set();
    this.scannedNames = new Set();
  }

  setPlanet(planet) {
    if (planet === this.planet) return;
    if (this.root) {
      this.root.parent?.remove(this.root);
      for (const sp of this.species) {
        sp.mesh.geometry.dispose();
        sp.mesh.material.dispose();
      }
    }
    this.species = [];
    this.creatures = [];
    this.root = null;
    this.planet = planet;
    if (!planet || !planet.sampler) return;
    const p = planet.params;
    const a = archetype(p.type);
    if (p.type === 'barren' || p.lifeless || p.flora < 0.08) return;
    const rng = new Random(p.seed ^ 0xfa11a);
    this.root = new THREE.Group();
    planet.root.add(this.root);
    const n = p.flora > 0.5 ? rng.int(3, 4) : rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const kind = i === n - 1 && rng.chance(0.75) ? 'flyer' : rng.chance(0.25) ? 'biped' : 'quad';
      const fc = a.floraColors;
      // hides that stand out against the vegetation, with a hint of the world's flora hue, and bold markings
      // (same rng calls in the same order as before, so species keep their names)
      const base = new THREE.Color(rng.pick(HIDES)).lerp(new THREE.Color(rng.pick(fc)), rng.float(0.1, 0.3));
      const accent = new THREE.Color(rng.pick(fc));
      const glow = rng.chance(0.5);
      const glowEyes = rng.chance(0.3);
      const cols = markings(base, accent, new Random(((p.seed ^ 0xc0105) + i * 7919) >>> 0), { glow, glowEyes });
      const proc = kind === 'flyer' ? buildFlyer(rng, cols) : buildQuadruped(rng, cols, kind === 'biped');
      const model = libraryCreature(kind, rng, cols, proc) || proc;
      if (model === proc) model.legLen = hipHeight(proc.geo) || proc.legLen;
      let size = kind === 'flyer' ? rng.float(1.2, 2.2) : kind === 'biped' ? rng.float(0.8, 2.2) : Math.pow(rng.next(), 1.5) * 3.2 + 0.5;
      // body plans keep sizes that suit them
      if (model.plan === 'quad_heavy') size = Math.max(size, 2.2);
      if (model.plan === 'quad_small') size = Math.min(size, 0.9);
      const max = kind === 'flyer' ? 16 : 10;
      const plan = kind === 'flyer' ? 2 : kind === 'biped' ? 1 : 0;
      const mesh = new THREE.InstancedMesh(model.geo, creatureMaterial(this.time, { leg: model.legLen || 1, plan }), max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
      const gait = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
      const seed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
      phase.setUsage(THREE.DynamicDrawUsage);
      gait.setUsage(THREE.DynamicDrawUsage);
      seed.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('aPhase', phase);
      mesh.geometry.setAttribute('aGait', gait);
      mesh.geometry.setAttribute('aSeed', seed);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      const name = `${rng.pick(ADJ)} ${makeName(rng, 2, 2)} ${rng.pick(NOUN[kind === 'quad' ? 'quad' : kind])}`;
      this.species.push({
        kind, name, size, model, mesh, phase, gait, seed, max,
        skittish: rng.chance(0.6), herd: kind === 'flyer' ? rng.int(4, 9) : rng.int(2, 5),
        walk: (kind === 'biped' ? 2.2 : 1.6) * Math.sqrt(size), run: (kind === 'biped' ? 9 : 7) * Math.sqrt(size),
      });
    }
  }

  update(dt, planet) {
    const g = this.game;
    let target = null;
    let camLocal = null;
    if (planet && planet.sampler) {
      camLocal = planet.worldToLocal(g.camWorld, _v2).clone();
      if (camLocal.length() - planet.radius < 1500) target = planet;
    }
    if (target !== this.planet) this.setPlanet(target);
    if (!this.planet || !this.root) return;
    this.time.value += dt;
    const P = this.planet;
    // spawn herds around the camera
    for (const sp of this.species) {
      const alive = this.creatures.filter((c) => c.sp === sp).length;
      if (alive + sp.herd <= sp.max && (!sp.nextSpawn || this.time.value > sp.nextSpawn)) {
        sp.nextSpawn = this.time.value + 4 + Math.random() * 6;
        this.spawnHerd(sp, camLocal);
      }
    }
    const player = g.mode === 'foot' && g.player.state.frame === P ? g.player.state.pos : null;
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (c.pos.distanceTo(camLocal) > 420) {
        this.creatures.splice(i, 1);
        continue;
      }
      const wasFleeing = c.state === 'flee';
      this.think(c, dt, player);
      this.move(c, dt);
      // vocalize now and then when the player is close
      if (player) {
        const d = c.pos.distanceTo(player);
        c.callT = (c.callT ?? 3 + Math.random() * 10) - dt;
        const alarm = !wasFleeing && c.state === 'flee';
        if ((c.callT <= 0 || alarm) && d < 45) {
          c.callT = 6 + Math.random() * 12;
          const vol = 0.13 * (1 - d / 50) * Math.min(1.5, 0.5 + c.sp.size * 0.4);
          g.audio.creature({ size: c.sp.size * c.scale, kind: c.sp.kind, seed: c.sp.voice ?? (c.sp.voice = Math.random()), vol, alarm });
        }
      }
    }
    // render
    this.anchor.copy(camLocal);
    this.root.position.copy(this.anchor);
    for (const sp of this.species) sp.mesh.count = 0;
    for (const c of this.creatures) {
      const sp = c.sp;
      const k = sp.mesh.count++;
      const up = _v.copy(c.pos).normalize();
      const fwd = c.heading;
      const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
      const f2 = new THREE.Vector3().crossVectors(right, up);
      _m.makeBasis(right, up, f2);
      _q.setFromRotationMatrix(_m);
      if (sp.kind === 'flyer') _q.multiply(new THREE.Quaternion().setFromAxisAngle(f2.set(0, 0, 1), c.bank || 0));
      _s.setScalar(sp.size * c.scale);
      _m.compose(_v2.copy(c.pos).sub(this.anchor), _q, _s);
      sp.mesh.setMatrixAt(k, _m);
      sp.phase.array[k] = c.phase;
      sp.gait.array[k] = c.gait;
      sp.seed.array[k] = c.seed ?? (c.seed = Math.random());
    }
    for (const sp of this.species) {
      sp.mesh.instanceMatrix.needsUpdate = true;
      sp.phase.needsUpdate = true;
      sp.gait.needsUpdate = true;
      sp.seed.needsUpdate = true;
    }
  }

  spawnHerd(sp, camLocal) {
    const P = this.planet;
    const up = camLocal.clone().normalize();
    const t1 = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    const t2 = new THREE.Vector3().crossVectors(up, t1);
    const a = Math.random() * Math.PI * 2;
    const d = 70 + Math.random() * 160;
    const center = up.clone().multiplyScalar(P.radius).addScaledVector(t1, Math.cos(a) * d).addScaledVector(t2, Math.sin(a) * d).normalize();
    if (P.heightAt(center) < 1 && sp.kind !== 'flyer') return;
    const heading = t1.clone().applyAxisAngle(center, Math.random() * Math.PI * 2);
    for (let i = 0; i < sp.herd; i++) {
      const off = center.clone().multiplyScalar(P.radius).addScaledVector(t1, (Math.random() - 0.5) * 14).addScaledVector(t2, (Math.random() - 0.5) * 14).normalize();
      const h = P.surfaceRadius(off);
      if (sp.kind !== 'flyer' && h < P.radius + 0.5) continue;
      const c = {
        sp, pos: off.clone().multiplyScalar(h), heading: heading.clone(), phase: Math.random() * 6, gait: 0, speed: 0,
        state: 'idle', timer: Math.random() * 3, scale: 0.85 + Math.random() * 0.3, target: null,
        alt: sp.kind === 'flyer' ? 25 + Math.random() * 30 : 0, circle: Math.random() < 0.5 ? 1 : -1,
      };
      this.creatures.push(c);
    }
  }

  think(c, dt, player) {
    const sp = c.sp;
    c.timer -= dt;
    if (sp.kind === 'flyer') {
      c.state = 'fly';
      return;
    }
    if (player) {
      const d = c.pos.distanceTo(player);
      if (sp.skittish && d < 14 + sp.size * 3 && c.state !== 'flee') {
        c.state = 'flee';
        c.timer = 4 + Math.random() * 2;
        const away = c.pos.clone().sub(player);
        const up = _v.copy(c.pos).normalize();
        c.heading.copy(away.addScaledVector(up, -away.dot(up)).normalize());
      }
    }
    if (c.timer <= 0) {
      if (c.state === 'idle') {
        c.state = 'wander';
        c.timer = 3 + Math.random() * 6;
        const up = _v.copy(c.pos).normalize();
        c.heading.applyAxisAngle(up, (Math.random() - 0.5) * 2.5);
      } else {
        c.state = 'idle';
        c.timer = 2 + Math.random() * 5;
      }
    }
  }

  move(c, dt) {
    const P = this.planet;
    const sp = c.sp;
    const up = _v.copy(c.pos).normalize().clone();
    let targetSpeed = 0;
    if (c.state === 'wander') targetSpeed = sp.walk;
    if (c.state === 'flee') targetSpeed = sp.run;
    if (c.state === 'fly') targetSpeed = 9 + sp.size * 2;
    c.speed = THREE.MathUtils.damp(c.speed, targetSpeed, 3, dt);
    if (sp.kind === 'flyer') {
      c.heading.applyAxisAngle(up, c.circle * dt * 0.35);
      c.bank = -c.circle * 0.4;
    }
    c.heading.addScaledVector(up, -c.heading.dot(up)).normalize();
    const next = c.pos.clone().addScaledVector(c.heading, c.speed * dt);
    const dir = next.clone().normalize();
    const ground = P.surfaceRadius(dir);
    if (sp.kind === 'flyer') {
      const gr = Math.max(ground, P.ocean ? P.radius : 0);
      c.pos.copy(dir.multiplyScalar(gr + c.alt + Math.sin(this.time.value * 0.7 + c.phase) * 3));
      c.phase += dt * 9;
      c.gait = 1;
      return;
    }
    // avoid water and steep climbs
    if (P.ocean && ground < P.radius + 0.3) {
      c.heading.negate();
      c.speed *= 0.3;
      return;
    }
    // walk round rocks and deposits, and never through the player
    if (c.speed > 0.05) {
      const body = c.sp.size * c.scale * 0.45;
      let blocked = null;
      for (const inst of this.game.flora.instancesNear(next, body + 3, (s) => s.collide || s.rock)) {
        const r = inst.sp.hitRadius * inst.scale + body;
        if (inst.pos.distanceTo(next) < r) {
          blocked = inst.pos;
          break;
        }
      }
      const player = this.game.mode === 'foot' && this.game.player.state.frame === P ? this.game.player.state.pos : null;
      // heads and necks reach well past the body: keep them out of the player's face
      if (!blocked && player && player.distanceTo(next) < c.sp.size * c.scale * 1.1 + 1.0) blocked = player;
      if (blocked) {
        // turn away from the obstacle, sliding along it rather than stopping dead
        const away = c.pos.clone().sub(blocked);
        away.addScaledVector(up, -away.dot(up)).normalize();
        c.heading.lerp(away, 0.35).addScaledVector(up, -c.heading.dot(up)).normalize();
        c.speed *= 0.6;
        return;
      }
    }
    c.pos.copy(dir.multiplyScalar(ground));
    // cadence matched to the leg swing: during one stance (half a cycle) a planted foot sweeps 2·L·sin(amp)
    // back relative to the hip, so the body must travel exactly that far for the foot not to slide
    c.gait = THREE.MathUtils.clamp(c.speed / sp.walk, 0, 1.4);
    const L = (sp.model.legLen || 0.8) * sp.size * c.scale;
    const stride = 2 * L * Math.max(Math.sin(legAmp(c.gait)), 0.03);
    c.phase += (c.speed / stride) * Math.PI * dt;
  }

  // walkers are solid: the player is pushed round their bodies instead of walking through them
  collidePlayer(player) {
    const P = this.planet;
    if (!P || player.state.frame !== P) return;
    const p = player.state.pos;
    const up = _v.copy(p).normalize();
    for (const c of this.creatures) {
      if (c.sp.kind === 'flyer') continue;
      const r = c.sp.size * c.scale * 0.5 + 0.4;
      const d = p.clone().sub(c.pos);
      const vert = d.dot(up);
      if (vert > c.sp.size * c.scale * 1.2) continue;
      d.addScaledVector(up, -vert);
      const dist = d.length();
      if (dist < r && dist > 1e-4) p.addScaledVector(d, (r - dist) / dist);
    }
  }

  // creature in the player's crosshair
  pick(origin, dir, maxDist) {
    let best = null;
    for (const c of this.creatures) {
      const r = c.sp.size * c.scale * (c.sp.kind === 'flyer' ? 0.6 : 0.9);
      const center = c.pos.clone().addScaledVector(_v.copy(c.pos).normalize(), c.sp.kind === 'flyer' ? 0 : r * 0.8);
      const oc = center.sub(origin);
      const t = oc.dot(dir);
      if (t < 0 || t > maxDist) continue;
      const d2 = oc.lengthSq() - t * t;
      if (d2 < r * r && (!best || t < best.t)) best = { c, t };
    }
    return best;
  }

  scare(c) {
    c.state = 'flee';
    c.timer = 5;
  }
}
