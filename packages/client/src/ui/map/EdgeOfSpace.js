// The edge of space: where the universe stops. A vast curved membrane of iridescent, slowly
// churning light closes off one side of the galaxy map; haze layers stand in front of it for depth,
// shafts of light pour back from it into the galaxy, stars near it are red-shifted and drawn out
// into streaks, sparks fall towards it, and the space-time grid bends and reddens as it meets it.
// Beyond it there is nothing at all. (The universe expands into it, but for now the front is still.)
import * as THREE from 'three';
// (where the membrane stands, EDGE_X, and how it bows back towards the galaxy, EDGE_CURVE_R, are the world's)
import { EDGE_X, EDGE_CURVE_R as CURVE_R, edgeX } from '@astra/shared/world';
import { mapNoiseGLSL } from './mapCommon.js';

// the edge's own random stream (its streaks and sparks), shared by the map and the sky in flight
export const EDGE_SEED = 0xed9e;
// every other length here is laid out on a 1:K scale
const K = 1e4;
const SPAN = 1300 * K;

// The nearest way out from a galactic position: the direction to the membrane (into `out`), and the
// distance in ly returned. (The cap is, near enough, part of a sphere CURVE_R across.)
export function edgeBearing(p, out = new THREE.Vector3()) {
  out.set(p.x - (EDGE_X - CURVE_R), p.y, p.z);
  const r = out.length();
  out.divideScalar(r);
  return CURVE_R - r;
}

const membraneVert = /* glsl */ `
  uniform float uOffset;
  varying vec3 vW;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 p = position;
    // plane in yz, bent into a cap facing the galaxy
    float x = ${EDGE_X.toFixed(1)} - (p.y * p.y + p.z * p.z) / ${(2 * CURVE_R).toFixed(1)} - uOffset;
    vec3 w = vec3(x, p.y, p.z);
    vN = normalize(vec3(-1.0, -p.y / ${CURVE_R.toFixed(1)}, -p.z / ${CURVE_R.toFixed(1)}));
    vW = w;
    // (the group may be moved, as in the sky seen in flight, where it sits relative to the eye)
    vec4 wp = modelMatrix * vec4(w, 1.0);
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const membraneFrag = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uLayer;
  uniform float uSeed;
  uniform float uReveal;
  varying vec3 vW;
  varying vec3 vN;
  varying vec3 vV;
  ${mapNoiseGLSL}
  float fbm3(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      s += vnoise(p) * a;
      p = p * 2.07 + vec3(4.1, 1.3, 7.7);
      a *= 0.5;
    }
    return s;
  }
  void main() {
    // large, slow structures: finer ones aliased into a white hiss at map distances
    vec2 uv = vW.zy * ${(0.001 / 1e4).toExponential(4)};
    float t = uTime;
    vec3 p = vec3(uv * 3.0, t * 0.012 + uSeed);
    vec3 V = normalize(vV);
    float facing = abs(dot(normalize(vN), V));
    float fres = pow(1.0 - facing, 2.0);
    vec3 col;
    if (uLayer < 0.5) {
      vec3 q = vec3(fbm(p + vec3(0.0, 0.0, t * 0.01)), fbm(p + vec3(5.2, 1.3, 2.0)), 0.0);
      // from far off: one soft, luminous wall, its folds only hinted at, opalescent toward its rim
      float ff = fbm(p * 1.4 + q * 1.3 + vec3(0.0, 0.0, t * 0.006));
      vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (ff * 0.55 + fres * 0.5 + vec3(0.0, 0.33, 0.67)));
      vec3 far = (vec3(0.07, 0.04, 0.17) + hue * vec3(0.08, 0.07, 0.11)) * (0.35 + 0.65 * smoothstep(-0.4, 0.7, ff)) * (0.7 + 1.2 * fres);
      col = far;
      float closeUp = smoothstep(0.25, 0.8, uReveal);
      // (the full film only once it is near enough to show: it is the costly part)
      if (closeUp > 0.0) {
        // the membrane itself: doubly domain-warped flow (a cosmic web caught in a soap film)
        vec3 rr = vec3(fbm(p + 4.0 * q + vec3(1.7, 9.2, t * 0.02)), fbm(p + 4.0 * q + vec3(8.3, 2.8, 0.0)), 0.0);
        float f = fbm(p + 4.0 * rr);
        float rid = 1.0 - abs(fbm3(p * 1.5 + rr * 1.6 + vec3(0.0, 0.0, t * 0.03)));
        // (only the crests: the noise sits near zero over wide areas, so a soft power lit most of the wall)
        float fil = pow(max(rid, 0.0), 26.0);
        // thin-film iridescence: hue runs with the flow and with the viewing angle
        float phase = f * 1.25 + length(rr.xy) * 0.9 + fres * 0.6 + t * 0.008;
        vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (phase + vec3(0.0, 0.33, 0.67)));
        vec3 deep = mix(vec3(0.18, 0.04, 0.42), vec3(0.02, 0.22, 0.5), smoothstep(-0.4, 0.5, f));
        // mostly dark, deep-violet film; the light lives in the filaments and the iridescent folds
        vec3 film = deep * 0.4 + irid * (0.07 + 0.85 * fil) * smoothstep(-0.2, 0.7, f + 0.2) + vec3(1.0, 0.94, 1.0) * fil * 0.55;
        // quantum foam: brief pinpricks of light across the film
        vec3 cs = vW * ${(0.11 / 1e4).toExponential(4)};
        vec3 cell = floor(cs);
        float sp = step(0.9988, h31(cell + floor(t * 3.0 + h31(cell) * 10.0)));
        vec2 fc = fract(cs.yz) - 0.5;
        film += vec3(1.2, 1.1, 1.4) * sp * exp(-dot(fc, fc) * 60.0) * 2.4;
        film *= 0.5 + 1.3 * fres;
        col = mix(far, film, closeUp);
      }
    } else {
      // haze layers in front: softer, cheaper, offset
      vec3 q = vec3(fbm3(p * 0.7 + uSeed), fbm3(p * 0.7 + vec3(3.1, 7.4, uSeed)), 0.0);
      float f = fbm3(p * 0.8 + 3.0 * q);
      float phase = f * 1.25 + length(q.xy) * 0.9 + fres * 0.6 + t * 0.008;
      vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (phase + vec3(0.0, 0.33, 0.67)));
      vec3 deep = mix(vec3(0.18, 0.04, 0.42), vec3(0.02, 0.22, 0.5), smoothstep(-0.4, 0.5, f));
      col = mix(deep, irid, 0.4) * smoothstep(0.0, 0.7, f) * 0.6;
    }
    // the cap fades out at its rim
    float r = length(vW.yz);
    float rim = 1.0 - smoothstep(${(SPAN * 0.32).toFixed(1)}, ${(SPAN * 0.5).toFixed(1)}, r);
    // from deep inside the galaxy the wall is only a far glow; it comes up as the view closes in
    float reveal = uLayer < 0.5 ? mix(0.22, 1.0, uReveal) : uReveal;
    gl_FragColor = vec4(col * rim * uIntensity * reveal, 1.0);
  }`;

// light shafts pouring back from the membrane into the galaxy
const shaftVert = /* glsl */ `
  attribute float aT;
  attribute float aSeed;
  uniform float uTime;
  varying float vT;
  varying float vSeed;
  void main() {
    vT = aT;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const shaftFrag = /* glsl */ `
  uniform float uTime;
  uniform float uReveal;
  varying float vT;
  varying float vSeed;
  void main() {
    float flicker = 0.6 + 0.4 * sin(uTime * (0.4 + vSeed * 0.9) + vSeed * 40.0);
    vec3 c = mix(vec3(0.9, 0.7, 1.6), vec3(0.4, 1.1, 1.5), fract(vSeed * 7.3));
    float a = pow(1.0 - vT, 2.4) * flicker * 0.55 * uReveal;
    gl_FragColor = vec4(c * a, 1.0);
  }`;

// stars caught in the expansion: red-shifted and stretched into streaks pointing at the edge
const streakVert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aT;
  attribute float aLen;
  uniform float uProj;
  varying vec3 vColor;
  varying float vT;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // a streak only reads as one when it is long on screen; far off, the short ones are left out
    vColor = aColor * smoothstep(14.0, 90.0, aLen * uProj / max(-mv.z, 1.0));
    vT = aT;
    gl_Position = projectionMatrix * mv;
  }`;
const streakFrag = /* glsl */ `
  uniform float uReveal;
  varying vec3 vColor;
  varying float vT;
  void main() {
    float a = mix(1.0, 0.0, vT) * uReveal;
    gl_FragColor = vec4(vColor * a, 1.0);
  }`;

// sparks falling into the edge, faster as they near it
const sparkVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uReveal;
  varying float vA;
  varying vec3 vColor;
  void main() {
    float life = fract(uTime * (0.03 + aSeed.w * 0.05) + aSeed.x);
    float d = ${(170 * 1e4).toFixed(1)} * (1.0 - life * life);
    vec3 p = vec3(${EDGE_X.toFixed(1)} - d - (aSeed.y * aSeed.y + aSeed.z * aSeed.z) / ${(2 * CURVE_R).toFixed(1)}, aSeed.y, aSeed.z);
    vA = smoothstep(0.0, 0.15, life) * smoothstep(1.0, 0.85, life) * uReveal;
    vColor = mix(vec3(0.7, 0.85, 1.6), vec3(1.6, 0.6, 1.2), life);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(${(260 * 1e4).toFixed(1)} * uPixelRatio / -mv.z, 1.0, 6.0 * uPixelRatio);
    gl_Position = projectionMatrix * mv;
  }`;
const sparkFrag = /* glsl */ `
  varying float vA;
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    gl_FragColor = vec4(vColor * vA * exp(-r * r * 6.0) * 1.6, 1.0);
  }`;

export function buildEdge(rng = Math.random) {
  const group = new THREE.Group();
  group.name = 'edgeOfSpace';
  const mats = [];
  // shared by every part: how close the view has come (0 from the far side of the universe, 1 up against it)
  const uReveal = { value: 1 };
  const uProj = { value: 800 };
  const add = (o) => {
    // (placed by their shaders: the geometry's own bounds say nothing about where they are)
    o.frustumCulled = false;
    group.add(o);
    if (o.material.uniforms?.uTime) mats.push(o.material);
    return o;
  };

  // the membrane and the haze layers in front of it
  const plane = new THREE.PlaneGeometry(SPAN, SPAN, 220, 220);
  plane.rotateY(Math.PI / 2); // into the yz plane
  const layer = (offset, intensity, kind, seed) =>
    new THREE.Mesh(
      plane,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOffset: { value: offset }, uIntensity: { value: intensity }, uLayer: { value: kind }, uSeed: { value: seed }, uReveal },
        vertexShader: membraneVert,
        fragmentShader: membraneFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
  add(layer(0, 1.0, 0, 0));
  [[6, 0.16, 1.3], [16, 0.1, 4.7], [32, 0.06, 8.1], [56, 0.035, 12.9]].forEach(([o, k, s]) => {
    const m = add(layer(o * K, k, 1, s));
    m.renderOrder = -1;
  });

  // light shafts
  {
    const N = 420;
    const pos = new Float32Array(N * 6);
    const t = new Float32Array(N * 2);
    const seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const y = (rng() - 0.5) * 900 * K;
      const z = (rng() - 0.5) * 1100 * K;
      const len = (60 + Math.pow(rng(), 2) * 260) * K;
      const x0 = edgeX(y, z) - K;
      const spread = 1 + rng() * 0.25;
      pos.set([x0, y, z, x0 - len, y * spread * 0.96, z * spread * 0.96], i * 6);
      t.set([0, 1], i * 2);
      const s = rng();
      seed.set([s, s], i * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    add(new THREE.LineSegments(geo, new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uReveal }, vertexShader: shaftVert, fragmentShader: shaftFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  }

  // red-shifted, stretched stars
  {
    const N = 5200;
    const pos = new Float32Array(N * 6);
    const col = new Float32Array(N * 6);
    const t = new Float32Array(N * 2);
    const lens = new Float32Array(N * 2);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const y = (rng() - 0.5) * 700 * (0.3 + rng()) * K;
      const z = (rng() - 0.5) * 900 * K;
      const k = Math.pow(rng(), 0.6); // 1 = at the edge
      const x = edgeX(y, z) - (4 + (1 - k) * 180) * K;
      const len = (0.4 + Math.pow(k, 4) * 38) * K;
      // white stars turning orange, red, then infra-violet as the stretch takes them
      c.setRGB(1, 1, 1);
      if (k > 0.3) c.lerp(new THREE.Color(1.0, 0.55, 0.25), (k - 0.3) / 0.35);
      if (k > 0.65) c.lerp(new THREE.Color(1.0, 0.12, 0.35), (k - 0.65) / 0.2);
      if (k > 0.85) c.lerp(new THREE.Color(0.65, 0.2, 1.0), (k - 0.85) / 0.15);
      const b = (0.3 + rng() * 0.9) * (1 + k * 1.5);
      pos.set([x, y, z, x + len, y, z], i * 6);
      col.set([c.r * b, c.g * b, c.b * b, c.r * b, c.g * b, c.b * b], i * 6);
      t.set([0, 1], i * 2);
      lens.set([len, len], i * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLen', new THREE.BufferAttribute(lens, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    group.add(new THREE.LineSegments(geo, new THREE.ShaderMaterial({ uniforms: { uReveal, uProj }, vertexShader: streakVert, fragmentShader: streakFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  }

  // sparks
  {
    const N = 2400;
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) seed.set([rng(), (rng() - 0.5) * 800 * K, (rng() - 0.5) * 1000 * K, rng()], i * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const m = add(
      new THREE.Points(
        geo,
        new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uReveal },
          vertexShader: sparkVert,
          fragmentShader: sparkFrag,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    m.frustumCulled = false;
  }

  return {
    group,
    update(time, pixelRatio, reveal = 1, proj = 800) {
      uReveal.value = reveal;
      uProj.value = proj;
      for (const m of mats) {
        m.uniforms.uTime.value = time;
        if (m.uniforms.uPixelRatio) m.uniforms.uPixelRatio.value = pixelRatio;
      }
    },
  };
}
