// The people of a city world: one species per world, from a body plan of its own (height, build,
// legs, two arms or four, a head of one of several kinds, tails, antennae, skin and dress in its
// own colours, a voice and a language). A crowd of them walks the pavements and crosses the
// plaza near you, animated in the vertex shader (walk cycle, swinging arms, idle sway, heads that
// turn to look). Walk up to one and press E to greet them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random, makeName, streetDistance, cityPoint } from '@astra/shared/world';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const CROWD = 90;
const RANGE = 320;

const HEADS = ['dome', 'long', 'mantis', 'cyclops', 'crest', 'tendril'];
const SAYINGS = [
  'Welcome, traveller from the dark between the stars.',
  'The markets never sleep here. Neither do we.',
  'Your ship sings strangely as it lands. We like it.',
  'Walk softly. The old towers are listening.',
  'Once our ancestors swam where these streets now run.',
  'You smell of ozone and far places.',
  'May your engines never cool.',
  'The trade post is in the great plaza. Everything has a price there.',
  'We have watched your kind cross the sky. Few stop.',
  'Stay for the night lights. The city is kinder after dark.',
  'Our children say the edge of the sky moves. The elders say it does not.',
  'Have you seen the far wall of the universe? It glows, they say.',
];

export function speciesFor(planet) {
  const p = planet.params;
  const rng = new Random((p.citySeed ^ 0x5bec1e5) >>> 0);
  const name = makeName(rng, 2, 3);
  const hue = rng.next();
  const skin = new THREE.Color().setHSL(hue, rng.float(0.2, 0.55), rng.float(0.3, 0.6));
  const cloth = new THREE.Color().setHSL(rng.next(), rng.float(0.3, 0.7), rng.float(0.25, 0.55));
  // a handful of syllables for the language
  const syl = Array.from({ length: 10 }, () => makeName(rng, 1, 1).toLowerCase());
  return moreTraits(p, {
    name,
    plural: /[aeiou]$/.test(name) ? `${name}ns` : `${name}i`,
    height: rng.float(1.5, 2.7),
    build: rng.float(0.75, 1.35),
    legs: rng.float(0.42, 0.56),
    arms: rng.chance(0.25) ? 4 : 2,
    armLen: rng.float(0.32, 0.46),
    head: rng.pick(HEADS),
    neck: rng.float(0.02, 0.12),
    robe: rng.chance(0.5),
    cape: rng.chance(0.45),
    pauldrons: rng.chance(0.55),
    tail: rng.chance(0.3),
    antennae: rng.chance(0.3),
    skin,
    skin2: skin.clone().offsetHSL(rng.float(-0.1, 0.1), 0, rng.float(-0.15, 0.1)),
    cloth,
    cloth2: cloth.clone().offsetHSL(rng.float(0.2, 0.5), 0, rng.float(-0.1, 0.15)),
    eye: new THREE.Color().setHSL((hue + rng.float(0.35, 0.65)) % 1, 0.95, 0.62),
    trim: new THREE.Color().setHSL(rng.next(), rng.float(0.5, 0.9), rng.float(0.45, 0.65)),
    pitch: rng.float(0.6, 1.7),
    syl,
    sayings: rng.shuffle ? rng.shuffle(SAYINGS.slice()) : SAYINGS,
  });
}

// Traits added after the first version, from a stream of their own (so every species keeps the
// name and looks it had): a face, markings, and the cut of their clothes.
function moreTraits(p, sp) {
  const rng = new Random((p.citySeed ^ 0x2b0d1e5) >>> 0);
  sp.brow = rng.float(0.2, 0.6);
  sp.jaw = rng.float(0.4, 1.0);
  sp.ears = rng.pick(['none', 'pointed', 'fins', 'frills']);
  sp.nose = rng.chance(0.5);
  sp.pattern = rng.pick([0, 1, 2, 3]); // none, stripes, spots, bands
  sp.mark = sp.skin.clone().offsetHSL(rng.float(-0.2, 0.2), 0.1, rng.chance(0.5) ? -0.2 : 0.15);
  sp.markScale = rng.float(4, 9);
  sp.glowMarks = rng.chance(0.3);
  sp.sleeves = rng.chance(0.5);
  sp.shoulders = rng.float(1.0, 1.35);
  sp.waist = rng.float(0.7, 0.95);
  sp.chest = rng.float(0.95, 1.25);
  return sp;
}

// bones: 0 body, 1 head, 2 upper arm, 3 forearm and hand, 4 thigh, 5 shin and foot, 6 tail,
// 7 skirt (sways). Each vertex carries its joint (aPivA) and, for a limb's lower half, the middle
// joint (aPivB: elbow, knee), so the vertex shader can bend whole limbs.
function part(geo, color, bone, { a = [0, 0, 0], b = [0, 0, 0], side = 0, skin = 0, glow = 0 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const fill = (v, size) => {
    const arr = new Float32Array(n * size);
    for (let i = 0; i < n; i++) arr.set(v, i * size);
    return new THREE.BufferAttribute(arr, size);
  };
  g.setAttribute('color', fill([color.r, color.g, color.b], 3));
  // (packed: WebGL allows only 16 attributes, and the instancing takes five)
  g.setAttribute('aInfo', fill([bone, side, skin, glow], 4));
  g.setAttribute('aPivA', fill(a, 3));
  g.setAttribute('aPivB', fill(b, 3));
  return g;
}

// A body for the species: `elder` is the robed, hooded dress some of them wear, with a staff.
function buildBody(sp, elder) {
  const H = sp.height;
  const hip = H * sp.legs;
  const knee = hip * 0.52;
  const waist = hip + H * 0.07;
  const chest = hip + H * 0.19;
  const sh = hip + H * 0.29;
  const w = H * 0.1 * sp.build;
  const dark = new THREE.Color(0.04, 0.03, 0.04);
  const parts = [];
  const SKIN = { skin: 1 };
  // capsule from y0 down to y1 at x, z
  const limb = (r, x, y0, y1, z, color, bone, opts) => parts.push(part(new THREE.CapsuleGeometry(r, Math.max(0.01, y0 - y1 - r * 2), 4, 10).translate(x, (y0 + y1) / 2, z), color, bone, opts));
  const lathe = (pts, seg, sz, color, bone, opts) => parts.push(part(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg).scale(1, 1, sz), color, bone, opts));

  // torso: hips, a waist, a chest, shoulders
  const ws = sp.shoulders;
  lathe([[0.001, hip - H * 0.03], [w * 0.95, hip - H * 0.01], [w * 0.98, hip + H * 0.03], [w * sp.waist, waist], [w * sp.chest, chest], [w * ws, sh - H * 0.03], [w * ws * 0.8, sh + H * 0.005], [w * 0.4, sh + H * 0.03], [0.001, sh + H * 0.035]], 16, 0.7, sp.cloth, 0);
  // neck
  const neckTop = sh + H * sp.neck + H * 0.03;
  parts.push(part(new THREE.CylinderGeometry(w * 0.3, w * 0.4, neckTop - sh, 10).translate(0, (sh + neckTop) / 2, 0), sp.skin, 1, { a: [0, sh, 0], ...SKIN }));

  // legs, bending at the knee, with feet
  for (const s of [-1, 1]) {
    const x = s * w * 0.55;
    const opts = { a: [x, hip, 0], b: [x, knee, 0], side: s };
    const legCol = elder ? sp.cloth2 : sp.robe ? sp.cloth2 : sp.skin2;
    limb(w * 0.4, x, hip + w * 0.2, knee, 0, legCol, 4, { ...opts, skin: legCol === sp.skin2 ? 1 : 0 });
    limb(w * 0.31, x, knee + w * 0.05, H * 0.05, 0, legCol, 5, { ...opts, skin: legCol === sp.skin2 ? 1 : 0 });
    parts.push(part(new THREE.SphereGeometry(w * 0.33, 10, 8).translate(x, knee, w * 0.08), legCol, 5, opts));
    parts.push(part(new THREE.SphereGeometry(w * 0.42, 12, 8).scale(0.85, 0.42, 1.6).translate(x, w * 0.16, w * 0.3), sp.trim.clone().multiplyScalar(0.5), 5, opts));
  }

  // arms (one pair or two), bending at the elbow, with hands and fingers
  for (let pair = 0; pair < (sp.arms === 4 ? 2 : 1); pair++) {
    const y = sh - w * 0.25 - pair * H * 0.1;
    const L1 = H * sp.armLen * 0.48 * (pair ? 0.85 : 1);
    const L2 = H * sp.armLen * 0.45 * (pair ? 0.85 : 1);
    for (const s of [-1, 1]) {
      const x = s * w * ws * 1.08;
      const elbow = y - L1;
      const opts = { a: [x, y, 0], b: [x, elbow, 0], side: s };
      limb(w * 0.27, x, y + w * 0.15, elbow, 0, pair ? sp.skin2 : sp.cloth2, 2, { ...opts, skin: pair ? 1 : 0 });
      const fore = sp.sleeves && !pair ? sp.cloth2 : sp.skin;
      limb(w * 0.22, x, elbow, elbow - L2, 0, fore, 3, { ...opts, skin: fore === sp.skin ? 1 : 0 });
      const wy = elbow - L2;
      parts.push(part(new THREE.SphereGeometry(w * 0.24, 10, 8).scale(0.7, 1, 1).translate(x, wy - w * 0.12, 0), sp.skin, 3, { ...opts, ...SKIN }));
      for (let f = -1; f <= 1; f++) limb(w * 0.06, x + s * w * 0.03, wy - w * 0.25, wy - w * 0.62 + Math.abs(f) * w * 0.08, f * w * 0.11, sp.skin, 3, { ...opts, ...SKIN });
      if (sp.pauldrons && !pair) parts.push(part(new THREE.SphereGeometry(w * 0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.65, 1).translate(x, y - w * 0.02, 0), sp.trim, 2, opts));
    }
  }

  // dress: a flared tunic and belt, or (elders) a long robe, sash and hood
  if (elder || sp.robe) {
    lathe([[w * 1.0, chest], [w * 1.08, waist], [w * 1.25, hip], [w * 1.6, knee], [w * 1.9, H * 0.04]], 16, 0.85, elder ? sp.cloth2 : sp.cloth, 7, { a: [0, waist, 0] });
    parts.push(part(new THREE.TorusGeometry(w * 1.0, w * 0.1, 6, 18).rotateX(Math.PI / 2).rotateZ(0.35).translate(0, waist + H * 0.03, 0), sp.trim, 0));
    parts.push(part(new THREE.CylinderGeometry(w * 1.88, w * 1.92, H * 0.03, 16, 1, true).scale(1, 1, 0.85).translate(0, H * 0.055, 0), sp.trim, 7, { a: [0, waist, 0] }));
  } else {
    lathe([[w * sp.waist * 1.02, waist], [w * 1.05, hip], [w * 1.3, (hip + knee) / 2 + H * 0.04]], 14, 0.8, sp.cloth, 7, { a: [0, waist, 0] });
    parts.push(part(new THREE.TorusGeometry(w * sp.waist * 1.02, w * 0.09, 6, 16).rotateX(Math.PI / 2).translate(0, waist, 0), sp.trim, 0));
    parts.push(part(new THREE.BoxGeometry(w * 0.32, w * 0.24, w * 0.1).translate(0, waist, w * sp.waist * 0.72), sp.eye, 0, { glow: 0.6 }));
  }
  // collar
  parts.push(part(new THREE.TorusGeometry(w * 0.52, w * 0.13, 6, 14).rotateX(Math.PI / 2).translate(0, sh + H * 0.01, 0), sp.trim, 0));
  if (sp.cape && !elder) parts.push(part(new THREE.CylinderGeometry(w * ws * 1.05, w * 1.7, sh - knee * 0.6, 12, 1, true, Math.PI * 0.62, Math.PI * 0.76).translate(0, (sh + knee * 0.6) / 2, -w * 0.12), sp.cloth2, 7, { a: [0, sh, 0] }));

  // head: the species' kind, with a brow, a jaw, eyes with lids, ears or fins
  const hr = H * 0.075 * (0.85 + sp.build * 0.2);
  const hy = neckTop + hr * 0.85;
  const HEAD = { a: [0, neckTop, 0], ...SKIN };
  const hp = (geo, col, opts = HEAD) => parts.push(part(geo, col, 1, opts));
  const eye = (r, x, y, z) => {
    hp(new THREE.SphereGeometry(r, 12, 10).translate(x, y, z), sp.eye, { a: HEAD.a, glow: 1 });
    hp(new THREE.SphereGeometry(r * 0.45, 8, 6).translate(x, y, z + r * 0.72), dark, { a: HEAD.a });
    // a heavy upper lid
    hp(new THREE.SphereGeometry(r * 1.08, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).translate(x, y + r * 0.05, z), sp.skin2);
  };
  const eyes = (r, sep, y, z) => [-1, 1].forEach((s) => eye(r, s * sep, y, z));
  if (sp.head === 'mantis') {
    hp(new THREE.ConeGeometry(hr * 1.1, hr * 2.2, 3).rotateX(Math.PI).translate(0, hy + hr * 0.2, 0), sp.skin);
    eyes(hr * 0.42, hr * 0.62, hy + hr * 0.75, hr * 0.25);
  } else if (sp.head === 'cyclops') {
    hp(new THREE.SphereGeometry(hr * 1.05, 18, 14).translate(0, hy, 0), sp.skin);
    eye(hr * 0.5, 0, hy + hr * 0.12, hr * 0.78);
  } else {
    if (sp.head === 'long') hp(new THREE.SphereGeometry(hr, 18, 14).scale(0.9, 1, 1.9).rotateX(-0.5).translate(0, hy + hr * 0.3, -hr * 0.5), sp.skin);
    else hp(new THREE.SphereGeometry(hr, 18, 14).scale(1, 1.12, 1).translate(0, hy, 0), sp.skin);
    eyes(hr * 0.2, hr * 0.42, hy + hr * 0.1, hr * 0.78);
    // brow ridge and jaw
    hp(new THREE.SphereGeometry(hr * 0.85, 14, 8).scale(1.05, 0.28 + sp.brow * 0.25, 0.6).translate(0, hy + hr * 0.38, hr * 0.42), sp.skin2);
    hp(new THREE.SphereGeometry(hr * 0.7, 14, 10).scale(0.95, 0.55, 0.85 * sp.jaw + 0.3).translate(0, hy - hr * 0.5, hr * 0.28), sp.skin);
    hp(new THREE.BoxGeometry(hr * 0.5, hr * 0.06, hr * 0.06).translate(0, hy - hr * 0.48, hr * 0.84 * (0.6 + sp.jaw * 0.4)), dark, { a: HEAD.a });
    if (sp.nose) hp(new THREE.SphereGeometry(hr * 0.16, 8, 6).scale(0.8, 1.6, 1).translate(0, hy - hr * 0.08, hr * 0.92), sp.skin2);
    if (sp.head === 'crest') hp(new THREE.BoxGeometry(hr * 0.12, hr * 1.3, hr * 2.2).translate(0, hy + hr * 0.9, -hr * 0.3), sp.cloth2, { a: HEAD.a });
    if (sp.head === 'tendril') for (let i = 0; i < 5; i++) hp(new THREE.ConeGeometry(hr * 0.12, hr * 1.4, 5).rotateX(Math.PI).translate((i - 2) * hr * 0.28, hy - hr * 1.2, hr * 0.55), sp.skin2);
  }
  for (const s of [-1, 1]) {
    if (sp.ears === 'pointed') hp(new THREE.ConeGeometry(hr * 0.2, hr * 0.9, 6).rotateZ(-s * 1.2).translate(s * hr * 1.05, hy + hr * 0.25, 0), sp.skin);
    else if (sp.ears === 'fins') hp(new THREE.BoxGeometry(hr * 0.08, hr * 0.9, hr * 0.7).rotateZ(-s * 0.4).translate(s * hr * 1.0, hy + hr * 0.2, -hr * 0.1), sp.skin2);
    else if (sp.ears === 'frills') for (let k = 0; k < 3; k++) hp(new THREE.ConeGeometry(hr * 0.1, hr * (0.7 - k * 0.12), 4).rotateZ(-s * (1.0 + k * 0.35)).translate(s * hr * 0.95, hy + hr * (0.3 - k * 0.3), -hr * 0.2), sp.skin2);
  }
  if (sp.antennae) for (const s of [-1, 1]) {
    hp(new THREE.CylinderGeometry(hr * 0.04, hr * 0.06, hr * 1.4, 4).rotateZ(s * 0.35).translate(s * hr * 0.4, hy + hr * 1.4, 0), sp.skin2);
    hp(new THREE.SphereGeometry(hr * 0.13, 6, 4).translate(s * hr * 0.66, hy + hr * 2.05, 0), sp.eye, { a: HEAD.a, glow: 1 });
  }
  if (elder) {
    // hood, and a staff with a glowing head in the right hand
    hp(new THREE.SphereGeometry(hr * 1.35, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).rotateX(-0.45).translate(0, hy + hr * 0.1, -hr * 0.25), sp.cloth2, { a: HEAD.a });
    const x = w * ws * 1.08;
    const wy = sh - w * 0.25 - H * sp.armLen * 0.93;
    const opts = { a: [x, sh - w * 0.25, 0], b: [x, sh - w * 0.25 - H * sp.armLen * 0.48, 0], side: 1 };
    parts.push(part(new THREE.CylinderGeometry(w * 0.05, w * 0.06, H * 1.05, 6).translate(x, wy + H * 0.25, w * 0.15), sp.trim.clone().multiplyScalar(0.6), 3, opts));
    parts.push(part(new THREE.OctahedronGeometry(w * 0.22).translate(x, wy + H * 0.8, w * 0.15), sp.eye, 3, { ...opts, glow: 1 }));
  }
  if (sp.tail) parts.push(part(new THREE.ConeGeometry(w * 0.4, hip * 1.1, 8).rotateX(-1.1).translate(0, hip * 0.75, -hip * 0.5), sp.skin2, 6, { a: [0, hip, -w * 0.3], ...SKIN }));
  return { geo: mergeGeometries(parts), waist, chest };
}

function crowdMaterial(sp, body) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.04 });
  const u = {
    uWaist: { value: body.waist },
    uChest: { value: body.chest },
    uMark: { value: sp.mark.clone() },
    uPattern: { value: sp.pattern },
    uMarkScale: { value: sp.markScale },
    uMarkGlow: { value: sp.glowMarks ? 1 : 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aInfo;
        attribute vec3 aPivA;
        attribute vec3 aPivB;
        attribute vec3 aAnim;
        uniform float uWaist;
        uniform float uChest;
        varying float vEye;
        varying float vSkin;
        varying vec3 vObj;
        vec3 rotX(vec3 p, float a) { float c = cos(a); float s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
        vec3 rotY(vec3 p, float a) { float c = cos(a); float s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float aBone = aInfo.x;
        float aSide = aInfo.y;
        float aPhase = aAnim.x;
        float aWalk = aAnim.y;
        float aLook = aAnim.z;
        vEye = aInfo.w;
        vSkin = aInfo.z;
        vObj = position;
        vec3 p = transformed;
        float w = aWalk;
        // each side's stride half a cycle apart; arms swing against the legs
        float legPh = aPhase + (aSide < 0.0 ? 0.0 : 3.14159);
        if (aBone > 3.5 && aBone < 5.5) {
          float thigh = -sin(legPh) * 0.5 * w;
          float kneeA = (max(0.0, cos(legPh)) * 0.95 + 0.06) * w + 0.04;
          if (aBone > 4.5) p = rotX(p - aPivB, kneeA) + aPivB;
          p = rotX(p - aPivA, thigh) + aPivA;
        } else if (aBone > 1.5 && aBone < 3.5) {
          float arm = sin(legPh) * 0.42 * w + sin(aPhase * 0.37 + aSide) * 0.05 * (1.0 - w);
          float elbow = -(0.25 + 0.35 * max(0.0, -sin(legPh)) * w);
          if (aBone > 2.5) p = rotX(p - aPivB, elbow) + aPivB;
          p = rotX(p - aPivA, arm) + aPivA;
        } else if (aBone > 0.5 && aBone < 1.5) {
          p = rotY(p - aPivA, aLook) + aPivA;
          p = rotX(p - aPivA, sin(aPhase * 2.0) * 0.04 * w - 0.04 * (1.0 - w) * sin(aPhase * 0.2)) + aPivA;
        } else if (aBone > 5.5 && aBone < 6.5) {
          p = rotY(p - aPivA, sin(aPhase) * 0.35) + aPivA;
        } else if (aBone > 6.5) {
          float k = clamp((uWaist - position.y) / uWaist, 0.0, 1.0);
          p.z += sin(aPhase * 2.0) * 0.06 * w * k;
          p.x += sin(aPhase) * 0.05 * w * k;
        }
        // the shoulders turn against the hips, and the chest rises and falls at rest
        float up = smoothstep(uWaist, uChest, position.y);
        p = rotY(p, up * sin(aPhase) * 0.12 * w);
        p.xz *= 1.0 + up * (1.0 - w) * 0.015 * sin(aPhase * 0.8);
        p.y += abs(sin(aPhase)) * 0.035 * w;
        transformed = p;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uMark;
        uniform float uPattern;
        uniform float uMarkScale;
        uniform float uMarkGlow;
        varying float vEye;
        varying float vSkin;
        varying vec3 vObj;
        float markK;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // the species' markings, on skin only: stripes, spots or bands
        markK = 0.0;
        if (vSkin > 0.5 && uPattern > 0.5) {
          vec3 q = vObj * uMarkScale;
          if (uPattern < 1.5) markK = smoothstep(0.32, 0.42, abs(fract(q.y + sin(q.x * 1.3) * 0.25) - 0.5));
          else if (uPattern < 2.5) {
            vec3 c = floor(q);
            float h = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            markK = step(0.55, h) * smoothstep(0.34, 0.2, length(fract(q) - 0.5));
          } else markK = 1.0 - smoothstep(0.04, 0.1, abs(fract(q.y * 0.5) - 0.5) - 0.16);
          diffuseColor.rgb = mix(diffuseColor.rgb, uMark, markK * 0.8);
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (vEye * 1.6 + markK * uMarkGlow * 0.9);');
  };
  mat.customProgramCacheKey = () => 'citizen-v2';
  return mat;
}

export class Citizens {
  constructor(game, cities) {
    this.game = game;
    this.cities = cities;
    this.city = null;
    this.meshes = [];
    this.list = [];
    this.greeted = new Set();
  }

  setCity(c) {
    if (c === this.city) return;
    for (const m of this.meshes) {
      m.parent?.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.meshes = [];
    this.city = c;
    this.list = [];
    if (!c) return;
    const sp = (this.species = this.cities.species);
    // two kinds of dress: everyday, and the elders' robes, hoods and staffs
    this.meshes = [false, true].map((elder) => {
      const body = buildBody(sp, elder);
      const geo = body.geo;
      // phase of the stride, how much it is walking, where its head turns
      const attr = { anim: new THREE.InstancedBufferAttribute(new Float32Array(CROWD * 3), 3) };
      geo.setAttribute('aAnim', attr.anim);
      const mesh = new THREE.InstancedMesh(geo, crowdMaterial(sp, body), CROWD);
      mesh.userData.attr = attr;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.position.copy(c.center);
      this.cities.planet.root.add(mesh);
      return mesh;
    });
    const vr = new Random(c.city.seed ^ 0xface);
    this.sizes = Float32Array.from({ length: CROWD }, () => vr.float(0.88, 1.1));
    // a quarter of them elders; everyone's dress in a shade of their own
    this.kinds = Uint8Array.from({ length: CROWD }, () => (vr.next() < 0.25 ? 1 : 0));
    const tint = new THREE.Color();
    for (let i = 0; i < CROWD; i++) for (const m of this.meshes) m.setColorAt(i, tint.setHSL(vr.next(), vr.float(0, 0.3), vr.float(0.82, 1)).multiplyScalar(1.15));
    this.rng = new Random(c.city.seed ^ 0xc0ffee);
  }

  // a spot on a pavement (or in the plaza) somewhere around u, v
  spawn(k, u0, v0, behind) {
    const plan = this.city.plan;
    const hw = plan.width / 2;
    const rng = this.rng;
    for (let i = 0; i < 40; i++) {
      const a = behind !== undefined && i < 20 ? behind + rng.float(-1.2, 1.2) : rng.float(0, Math.PI * 2);
      const r = rng.float(30, RANGE * 0.9);
      const u = u0 + Math.cos(a) * r;
      const v = v0 + Math.sin(a) * r;
      if (Math.hypot(u, v) > this.city.city.radius) continue;
      const d = streetDistance(plan, u, v);
      const plaza = Math.hypot(u, v) < plan.plaza && Math.hypot(u, v) > plan.plaza * 0.3;
      if (!plaza && (d < hw + 0.7 || d > hw + 2.8)) continue;
      k.u = u;
      k.v = v;
      const g = this.along(u, v);
      const s = rng.chance(0.5) ? 1 : -1;
      k.du = plaza ? Math.cos(a * 7) : g.x * s;
      k.dv = plaza ? Math.sin(a * 7) : g.y * s;
      k.speed = rng.float(1.0, 1.6) * (0.85 + this.species.height * 0.1);
      k.phase = rng.float(0, 6.28);
      k.idle = rng.chance(plaza ? 0.5 : 0.12) ? rng.float(4, 20) : 0;
      k.look = 0;
      k.greet = 0;
      return true;
    }
    return false;
  }

  // the direction along the street at u, v (across the gradient of the distance to it)
  along(u, v) {
    const plan = this.city.plan;
    const e = 0.8;
    const gx = streetDistance(plan, u + e, v) - streetDistance(plan, u - e, v);
    const gy = streetDistance(plan, u, v + e) - streetDistance(plan, u, v - e);
    const l = Math.hypot(gx, gy) || 1;
    return { x: -gy / l, y: gx / l };
  }

  // where the player stands in city coordinates
  playerUV() {
    const g = this.game;
    const c = this.city;
    const P = this.cities.planet;
    // (from where you are on the planet: camWorld is last frame's, and the planet has moved on along
    // its orbit since, by enough that the one in front of you was often out of reach to greet)
    const s = g.mode === 'foot' ? g.player.state : g.ship.state;
    const local = s.frame === P ? _v.copy(s.pos) : P.worldToLocal(g.camWorld, _v);
    const rel = local.sub(c.center);
    return { u: rel.dot(c.frame.east), v: rel.dot(c.frame.north) };
  }

  update(dt, c) {
    this.setCity(c);
    if (!this.city) return;
    const pl = this.playerUV();
    const plan = this.city.plan;
    const hw = plan.width / 2;
    if (this.list.length < CROWD) {
      for (let i = this.list.length; i < CROWD; i++) {
        const k = {};
        if (this.spawn(k, pl.u, pl.v)) this.list.push(k);
      }
    }
    const R = this.cities.planet.radius;
    const C = this.city;
    const up = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const counts = [0, 0];
    this.list.forEach((k, i) => {
      const dx = pl.u - k.u;
      const dy = pl.v - k.v;
      const dp = Math.hypot(dx, dy);
      // gone too far from you: back somewhere behind you
      if (dp > RANGE) this.spawn(k, pl.u, pl.v, Math.atan2(-(k.dv || 0), -(k.du || 0)));
      let walk = 0;
      if (k.greet > 0) {
        // stopped, turned to face you
        k.greet -= dt;
        const l = dp || 1;
        k.du = THREE.MathUtils.lerp(k.du, dx / l, dt * 4);
        k.dv = THREE.MathUtils.lerp(k.dv, dy / l, dt * 4);
      } else if (k.idle > 0) {
        k.idle -= dt;
        k.phase += dt * 1.5;
      } else {
        walk = 1;
        // step aside for you
        let su = 0;
        let sv = 0;
        if (dp < 2.2) {
          su = (-dx / dp) * (2.2 - dp);
          sv = (-dy / dp) * (2.2 - dp);
        }
        k.u += (k.du * k.speed + su) * dt;
        k.v += (k.dv * k.speed + sv) * dt;
        k.phase += dt * k.speed * 4.2 / Math.max(0.8, this.species.height * 0.6);
        // keep to the pavement: follow the street, drift back into the walking band
        const r = Math.hypot(k.u, k.v);
        if (r > plan.plaza || r < plan.plaza * 0.3) {
          const g = this.along(k.u, k.v);
          const s = g.x * k.du + g.y * k.dv >= 0 ? 1 : -1;
          const d = streetDistance(plan, k.u, k.v);
          if (r > plan.plaza) {
            k.du = THREE.MathUtils.lerp(k.du, g.x * s, dt * 3);
            k.dv = THREE.MathUtils.lerp(k.dv, g.y * s, dt * 3);
          }
          if (d < hw + 0.7 || d > hw + 2.8 || r < plan.plaza * 0.3) {
            // off the band: turn round (the cheapest way back onto it)
            k.du = -k.du;
            k.dv = -k.dv;
            k.u += k.du * 0.3;
            k.v += k.dv * 0.3;
          }
        }
        const l = Math.hypot(k.du, k.dv) || 1;
        k.du /= l;
        k.dv /= l;
        if (this.rng.next() < dt * 0.03) k.idle = this.rng.float(2, 8);
      }
      // heads turn toward you as you pass
      const want = dp < 12 ? THREE.MathUtils.clamp(Math.atan2(dx * k.dv - dy * k.du, dx * k.du + dy * k.dv), -1.1, 1.1) : 0;
      k.look = THREE.MathUtils.lerp(k.look, want, dt * 3);
      k.walk = THREE.MathUtils.lerp(k.walk ?? 0, walk, dt * 5);
      const p = cityPoint(C.city, C.frame, R, k.u, k.v, 0, _v);
      up.copy(p).normalize();
      fwd.copy(C.frame.east).multiplyScalar(k.du).addScaledVector(C.frame.north, k.dv);
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      right.crossVectors(up, fwd).normalize();
      _m.makeBasis(right, up, fwd);
      _q.setFromRotationMatrix(_m);
      const sz = this.sizes[i];
      _m.compose(p.sub(C.center), _q, new THREE.Vector3(sz, sz, sz));
      // each one drawn by the mesh of their dress (in its own next slot)
      const mesh = this.meshes[this.kinds[i]];
      const slot = counts[this.kinds[i]]++;
      mesh.setMatrixAt(slot, _m);
      const a = mesh.userData.attr;
      a.anim.array.set([k.phase, k.walk, -k.look], slot * 3);
      k.dist = dp;
    });
    this.meshes.forEach((m, n) => {
      m.count = counts[n];
      m.instanceMatrix.needsUpdate = true;
      for (const a of Object.values(m.userData.attr)) a.needsUpdate = true;
    });
  }

  // the citizen in front of you, close enough to greet
  facing() {
    if (!this.city || this.game.mode !== 'foot') return null;
    const g = this.game;
    const pl = this.playerUV();
    const C = this.city;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camWorldQuat);
    const lu = look.dot(this.cities.planet.dirToWorld(C.frame.east, new THREE.Vector3()));
    const lv = look.dot(this.cities.planet.dirToWorld(C.frame.north, new THREE.Vector3()));
    let best = null;
    for (const k of this.list) {
      if (k.dist > 3.6) continue;
      const du = k.u - pl.u;
      const dv = k.v - pl.v;
      const a = (du * lu + dv * lv) / (Math.hypot(du, dv) * Math.hypot(lu, lv) || 1);
      if (a > 0.6 && (!best || k.dist < best.dist)) best = k;
    }
    return best;
  }

  greet(k) {
    const g = this.game;
    const sp = this.species;
    k.greet = 6;
    k.idle = 0;
    const rng = this.rng;
    const words = Array.from({ length: rng.int(2, 4) }, () => rng.pick(sp.syl)).join(' ');
    const said = `«${words.charAt(0).toUpperCase()}${words.slice(1)}» ${rng.pick(sp.sayings)}`;
    g.audio.play('greet', { pitch: sp.pitch });
    if (!this.greeted.has(sp.name)) {
      this.greeted.add(sp.name);
      g.inventory.units += 300;
      g.hud.showBanner(sp.plural.toUpperCase(), 'First contact', [said, '+300 units']);
    } else g.hud.toast(said);
  }
}
