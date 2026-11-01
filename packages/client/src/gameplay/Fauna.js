// The server's herds, drawn (P1.E08.T09; DESIGN 12.2, docs/ARCHITECTURE.md §6.2, §9). The server owns every creature, its
// species, level, behaviour and place; RemoteEntities follows each `mob` entity from the zone's snapshots (one pose buffer
// each, read at the render time, placed through its frame as that stands now) and hands the ones it shows here. A species
// is an index into its world's shared `faunaSpecies` list, so every client builds the same body for it from that
// species' colours and shape seed. Each species is one InstancedMesh; limbs are animated in the vertex shader from
// per-vertex limb ids + pivots and per-instance gait phase, the gait read off how fast the creature is drawn moving.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { creatureSphere } from '@astra/shared/combat';
import { FAUNA_MAX_TIER, Random, faunaSpecies } from '@astra/shared/world';
import { libraryMesh, libraryVariants, recolor } from './modelLibrary.js';

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
function libraryCreature(kind, prefix, rng, cols, ref) {
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

/** How long a creature takes to go down once the server calls it dead, s (the corpse stays about 3 s). */
export const FALL_S = 0.45;
/** Capacity an instanced species starts with; it doubles when a world's herds outgrow it. */
const START_CAPACITY = 32;
/** A creature calls out when the player on foot is this close, m. */
const CALL_RANGE = 45;

const _rel = new THREE.Vector3();
const _up = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _z = new THREE.Vector3(0, 0, 1);
const _ray = new THREE.Vector3();
const _t = new THREE.Vector3();
const _walk = new THREE.Vector3();
const _push = new THREE.Vector3();

/** One species as this client draws it: the shared data, the body made from it and the instanced mesh that shows it. */
class Drawn {
  constructor(sp, time) {
    this.sp = sp;
    const rng = new Random(sp.shape);
    const proc = sp.kind === 'flyer' ? buildFlyer(rng, sp.colors) : buildQuadruped(rng, sp.colors, sp.kind === 'biped');
    const model = libraryCreature(sp.kind, sp.bodyPlan, rng, sp.colors, proc) || proc;
    if (model === proc) model.legLen = hipHeight(proc.geo) || proc.legLen;
    this.model = model;
    this.geo = model.geo;
    this.mat = creatureMaterial(time, { leg: model.legLen || 1, plan: sp.kind === 'flyer' ? 2 : sp.kind === 'biped' ? 1 : 0 });
    this.max = 0;
    this.count = 0;
    this.mesh = null;
    this.grow(START_CAPACITY);
  }

  /** Room for `n` instances (the attributes and mesh made afresh, twice as big as asked, when there is not). */
  grow(n) {
    if (n <= this.max) return;
    const max = Math.max(n, this.max * 2);
    const old = this.mesh;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.gait = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.phase, this.gait, this.seed]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPhase', this.phase);
    this.geo.setAttribute('aGait', this.gait);
    this.geo.setAttribute('aSeed', this.seed);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (old) {
      old.parent?.add(mesh);
      old.parent?.remove(old);
      old.dispose();
    }
    this.mesh = mesh;
    this.max = max;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}

export class Fauna {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'fauna';
    this.time = { value: 0 };
    /** world (the client's body) → { list: its species (shared data), drawn: index → Drawn, once a creature of it shows } */
    this.worlds = new Map();
    /** the creatures shown this frame (RemoteEntities' records) */
    this.shown = [];
  }

  /** Lets every species go: the system changed or the zone started over. */
  reset() {
    for (const w of this.worlds.values()) for (const d of w.drawn.values()) d.dispose();
    this.worlds.clear();
    this.shown.length = 0;
  }

  world(frame) {
    let w = this.worlds.get(frame);
    if (!w) {
      // (a Waystation, the inertial frame or a world without fauna has no species, so no creature in it is drawn)
      const list = frame?.params ? faunaSpecies(frame.params, FAUNA_MAX_TIER) : [];
      this.worlds.set(frame, (w = { list, drawn: new Map() }));
    }
    return w;
  }

  /** The species creature `r` is (shared data), or undefined when its world has no such species. */
  speciesOf(r) {
    return r.frame && r.species !== null ? this.world(r.frame).list[r.species] : undefined;
  }

  /** Whether the record `r` (RemoteEntities') is a creature that can be drawn. */
  draws(r) {
    return this.speciesOf(r) !== undefined;
  }

  drawnOf(r) {
    const w = this.world(r.frame);
    let d = w.drawn.get(r.species);
    if (!d) {
      d = new Drawn(w.list[r.species], this.time);
      w.drawn.set(r.species, d);
      this.group.add(d.mesh);
    }
    return d;
  }

  /** Each frame: draws the creatures among `list` (RemoteEntities' records) that are shown, each at its pose as placed
   * (`world`, `worldQuat`, camera-relative here), its gait read off how fast it is drawn moving. */
  update(list, dt) {
    const g = this.game;
    this.time.value += dt;
    const now = this.time.value;
    this.shown.length = 0;
    for (const w of this.worlds.values()) for (const d of w.drawn.values()) d.count = 0;
    const cam = g.engine?.camera;
    const inView = cam ? _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)) : null;
    const camWorld = g.camWorld;
    const player = g.mode === 'foot' && g.player ? g.player.state.worldPosition(_walk) : null;
    for (const r of list) {
      if (r.kind !== 'mob') continue;
      r.drawn = false;
      if (!r.shown) continue;
      const d = this.drawnOf(r);
      const sp = d.sp;
      this.shown.push(r);
      const vis = (r.vis ??= { phase: ((r.id * 0.6180339) % 1) * 6.28, speed: 0, seed: (r.id * 0.7548777) % 1, deadAt: null, callT: 3 + ((r.id * 0.41) % 1) * 10, mode: null });
      const dead = r.pose.mode === 'dead';
      if (dead && vis.deadAt === null) vis.deadAt = now;
      else if (!dead) vis.deadAt = null;
      // how fast it is drawn moving in its frame: the gait follows (a held pose, past the newest sample, is standing)
      const moving = !dead && (r.status === 'interpolate' || r.status === 'extrapolate');
      vis.speed = THREE.MathUtils.damp(vis.speed, moving ? r.pose.vel.length() : 0, 8, dt);
      let gait;
      if (sp.kind === 'flyer') {
        vis.phase += dt * 9;
        gait = dead ? 0 : 1;
      } else {
        gait = THREE.MathUtils.clamp(vis.speed / sp.walk, 0, 1.4);
        // cadence matched to the leg swing: during one stance (half a cycle) a planted foot sweeps 2·L·sin(amp) back
        // relative to the hip, so the body must travel exactly that far for the foot not to slide
        const L = (d.model.legLen || 0.8) * sp.size;
        const stride = 2 * L * Math.max(Math.sin(legAmp(gait)), 0.03);
        vis.phase += (vis.speed / stride) * Math.PI * dt;
      }
      this.voice(r, vis, sp, player, dt);
      const rel = _rel.copy(r.world).sub(camWorld);
      if (inView && rel.lengthSq() > 2500 && !inView.intersectsSphere(_sphere.set(rel, sp.size * 2.5 + 2))) continue;
      _q.copy(r.worldQuat);
      if (vis.deadAt !== null) this.fall(r, vis, d, now, rel);
      _s.setScalar(sp.size);
      _m.compose(rel, _q, _s);
      if (d.count === d.max) d.grow(d.count + 1);
      const k = d.count++;
      d.mesh.setMatrixAt(k, _m);
      d.phase.array[k] = vis.phase;
      d.gait.array[k] = gait;
      d.seed.array[k] = vis.seed;
      r.drawn = true;
    }
    for (const w of this.worlds.values()) {
      for (const d of w.drawn.values()) {
        d.mesh.count = d.count;
        d.mesh.instanceMatrix.needsUpdate = true;
        d.phase.needsUpdate = true;
        d.gait.needsUpdate = true;
        d.seed.needsUpdate = true;
      }
    }
  }

  // A creature the server has called dead goes down: it rolls onto its side about its middle over FALL_S and settles on
  // the ground; a flyer drops to it first (the corpse is still where the server left it, in the air).
  fall(r, vis, d, now, rel) {
    const t = now - vis.deadAt;
    const e = THREE.MathUtils.smoothstep(t, 0, FALL_S);
    const size = d.sp.size;
    const flyer = d.sp.kind === 'flyer';
    const roll = (flyer ? Math.PI : Math.PI / 2) * e;
    // the middle of the body in its own space; rolling about it, the body's low edge ends up about 0.3 of its size off the ground
    const mid = _c.set(0, (flyer ? 0 : 0.5) * size, 0);
    _qz.setFromAxisAngle(_z, roll);
    _p.copy(mid).sub(_t.copy(mid).applyQuaternion(_qz)).applyQuaternion(_q);
    rel.add(_p);
    const up = _t.set(0, 1, 0).applyQuaternion(_q);
    if (flyer) {
      const frame = r.frame;
      const ground = frame?.surfaceRadius ? frame.surfaceRadius(_c.copy(r.pos).normalize()) : null;
      const alt = ground === null ? 0 : Math.max(0, r.pos.length() - ground - 0.4 * size);
      rel.addScaledVector(up, -Math.min(alt, 4.9 * t * t));
    } else rel.addScaledVector(up, -0.2 * size * e);
    _q.multiply(_qz);
  }

  // Calls now and then when the player on foot is close, and when a creature bolts.
  voice(r, vis, sp, player, dt) {
    const mode = r.pose.mode;
    const alarm = mode === 'flee' && vis.mode !== 'flee';
    vis.mode = mode;
    if (!player || mode === 'dead') return;
    const d = r.world.distanceTo(player);
    vis.callT -= dt;
    if ((vis.callT <= 0 || alarm) && d < CALL_RANGE) {
      vis.callT = 6 + ((r.id * 0.37 + this.time.value) % 1) * 12;
      const vol = 0.13 * (1 - d / 50) * Math.min(1.5, 0.5 + sp.size * 0.4);
      this.game.audio.creature({ size: sp.size, kind: sp.kind, seed: vis.seed, vol, alarm });
    }
  }

  /** The creatures shown this frame, as `{ r, sp }` for tools that need where they stand. */
  creatures() {
    return this.shown.map((r) => ({ r, sp: this.speciesOf(r) }));
  }

  /** The living creatures shown in `frame` (one of the client's bodies), each `{ id, pos }`: where it is drawn, in the frame,
   * at the middle of its hit sphere (the shared `creatureSphere`, the one the server tests casts, shots and analyses by). */
  targets(frame) {
    const out = [];
    for (const r of this.shown) {
      if (r.frame !== frame || r.pose.mode === 'dead') continue;
      const sp = this.speciesOf(r);
      const s = creatureSphere({ pos: [r.pos.x, r.pos.y, r.pos.z], scale: 1, species: { size: sp.size, kind: sp.kind } });
      out.push({ id: r.id, pos: new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]) });
    }
    return out;
  }

  // walkers are solid: the player is pushed round their bodies instead of walking through them
  collidePlayer(player) {
    const frame = player.state.frame;
    if (!frame) return;
    const p = player.state.pos;
    const up = _up.copy(p).normalize();
    for (const r of this.shown) {
      if (r.frame !== frame || r.pose.mode === 'dead') continue;
      const sp = this.speciesOf(r);
      if (sp.kind === 'flyer') continue;
      const rad = sp.size * 0.5 + 0.4;
      const away = _push.copy(p).sub(r.pos);
      const vert = away.dot(up);
      if (vert > sp.size * 1.2) continue;
      away.addScaledVector(up, -vert);
      const dist = away.length();
      if (dist < rad && dist > 1e-4) p.addScaledVector(away, (rad - dist) / dist);
    }
  }

  /**
   * The creature along a ray (`origin`, unit `dir`, in the coordinates of `frame`, the camera's own), nearest first, within
   * `maxDist`: the one the crosshair is on. Creatures are read where they are drawn in that frame, so the ray and they
   * never disagree by how far the frame moved between one's placing and the other's. It is tested as the server tests
   * shots, casts and analyses (the shared `creatureSphere`, round the body at its species' size). A corpse is not picked.
   * `{ id, sp, r, t }` (its zone entity id, species data, record and distance), or null.
   */
  pick(frame, origin, dir, maxDist) {
    let best = null;
    for (const r of this.shown) {
      if (r.frame !== frame || r.pose.mode === 'dead') continue;
      const sp = this.speciesOf(r);
      const s = creatureSphere({ pos: [r.pos.x, r.pos.y, r.pos.z], scale: 1, species: { size: sp.size, kind: sp.kind } });
      const oc = _ray.set(s.pos[0], s.pos[1], s.pos[2]).sub(origin);
      const t = oc.dot(dir);
      if (t < 0 || t > maxDist) continue;
      if (oc.lengthSq() - t * t < s.radius * s.radius && (!best || t < best.t)) best = { id: r.id, sp, r, t };
    }
    return best;
  }
}
