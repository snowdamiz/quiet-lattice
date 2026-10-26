// Glowing effects around the player's ship (thruster jets, the re-entry plasma), drawn after the
// atmosphere pass so the air's haze cannot wash them out against a bright sky. They live on their
// own layer, which the main camera skips; Engine's FxPass draws them with the scene's depth bound,
// and each fragment fades out where the scene stands in front of it (and softly where it meets it).
import * as THREE from 'three';

export const FX_LAYER = 3;

// set by the FX pass each frame
export const fxUniforms = {
  tSceneDepth: { value: null },
  uFxFar: { value: 1e9 },
};

// view depth of the scene at this pixel (log depth, as the atmosphere pass reads it), and how much
// of a fragment `w` metres deep shows in front of it, softened over `soft` metres
const FX_DEPTH = /* glsl */ `
  uniform sampler2D tSceneDepth;
  uniform float uFxFar;
  float fxSceneDepth() {
    vec2 uv = gl_FragCoord.xy / vec2(textureSize(tSceneDepth, 0));
    float d = texture2D(tSceneDepth, uv).x;
    return pow(uFxFar + 1.0, d) - 1.0;
  }
  float fxDepthFade(float w, float soft) {
    return clamp((fxSceneDepth() - w) / soft, 0.0, 1.0);
  }`;

const NOISE = /* glsl */ `
  float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fxNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;

function fxMaterial(uniforms, vertexShader, fragmentShader) {
  return new THREE.ShaderMaterial({
    uniforms: { ...fxUniforms, ...uniforms },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function onFxLayer(obj) {
  obj.traverse((o) => {
    o.layers.set(FX_LAYER);
    o.frustumCulled = false;
  });
  return obj;
}

// ---------------------------------------------------------------- jets
// A jet is a ribbon turned to face the camera about its own axis (the exhaust direction, the
// parent's local -y), so it reads as a jet from the side: a white-hot core tapering off the nozzle,
// a softer body that widens and frays down its length, and, for the VTOL jets in air, shock
// diamonds standing in the core.
const jetGeo = new THREE.PlaneGeometry(2, 1, 1, 24).translate(0, 0.5, 0);

export function jetMaterial({ core, outer }) {
  return fxMaterial(
    {
      uPower: { value: 0 },
      uLen: { value: 1 },
      uWidth: { value: 0.2 },
      uSpread: { value: 1 },
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 100 },
      uDiamonds: { value: 0 },
      uCore: { value: new THREE.Color(core) },
      uOuter: { value: new THREE.Color(outer) },
    },
    /* glsl */ `
      uniform float uLen;
      uniform float uWidth;
      uniform float uSpread;
      varying vec2 vUv;
      varying float vW;
      void main() {
        vec4 o = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 axis = normalize(mat3(modelViewMatrix) * vec3(0.0, -1.0, 0.0));
        vec3 side = cross(axis, normalize(-o.xyz));
        // looking straight down the jet the ribbon has no width to show: the glow disc covers it
        side = length(side) > 1e-4 ? normalize(side) : vec3(1.0, 0.0, 0.0);
        float t = position.y;
        float w = uWidth * (1.0 + uSpread * t);
        vec4 p = vec4(o.xyz + axis * (t * uLen) + side * (position.x * w), 1.0);
        vUv = vec2(position.x, t);
        vW = -p.z;
        gl_Position = projectionMatrix * p;
      }`,
    /* glsl */ `
      uniform float uPower;
      uniform float uLen;
      uniform float uTime;
      uniform float uSeed;
      uniform float uDiamonds;
      uniform vec3 uCore;
      uniform vec3 uOuter;
      varying vec2 vUv;
      varying float vW;
      ${FX_DEPTH}
      ${NOISE}
      void main() {
        float t = vUv.y;
        float x = vUv.x;
        // fraying: turbulence racing down the jet eats into its edges, more so further out
        float n = fxNoise(vec2(x * 2.5 + uSeed, t * 7.0 - uTime * 26.0)) * 0.6 + fxNoise(vec2(x * 6.0 - uSeed, t * 16.0 - uTime * 44.0)) * 0.4;
        float edge = 1.0 - smoothstep(0.4, 1.0, abs(x) + (n - 0.5) * 0.7 * t);
        // the envelope: soft across, thinning out down the length
        float body = exp(-x * x * 2.2) * pow(max(1.0 - t, 0.0), 1.25) * edge;
        // the core: a tight white-hot line off the nozzle, gone by two thirds of the way down
        float cw = 0.14 + 0.22 * t;
        float xc = x / cw;
        float core = exp(-xc * xc * 2.0) * (1.0 - smoothstep(0.05, 0.68, t));
        // shock diamonds: bright nodes standing in the core about a metre apart
        float ph = fract(t * uLen * 0.85 + 0.35) - 0.5;
        float node = exp(-ph * ph * 22.0);
        core *= mix(1.0, 0.3 + 1.5 * node, uDiamonds);
        // the hot throat right at the exit
        float hot = exp(-xc * xc * 1.2) * exp(-t * t * 90.0);
        float a = (core * 1.7 + hot * 1.5 + body * (0.4 + 0.6 * n) * 0.9) * smoothstep(0.0, 0.03, t);
        vec3 c = mix(uOuter, uCore, clamp(core * 1.4 + hot, 0.0, 1.0));
        float k = a * uPower * fxDepthFade(vW, 0.4);
        gl_FragColor = vec4(c * k, 1.0);
      }`,
  );
}

export function makeJet(mat) {
  const m = new THREE.Mesh(jetGeo, mat);
  onFxLayer(m);
  m.renderOrder = 3;
  return m;
}

// the glow in the nozzle's mouth: a disc facing the camera, brightest seen head-on
const glowGeo = new THREE.PlaneGeometry(2, 2);

export function glowMaterial(color) {
  return fxMaterial(
    { uPower: { value: 0 }, uSize: { value: 0.3 }, uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
      uniform float uSize;
      varying vec2 vUv;
      varying float vW;
      varying float vFace;
      void main() {
        vec4 o = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 axis = normalize(mat3(modelViewMatrix) * vec3(0.0, -1.0, 0.0));
        vFace = max(dot(axis, normalize(-o.xyz)), 0.0);
        vec4 p = vec4(o.xyz + vec3(position.xy * uSize, 0.0), 1.0);
        vUv = position.xy;
        vW = -o.z;
        gl_Position = projectionMatrix * p;
      }`,
    /* glsl */ `
      uniform float uPower;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vW;
      varying float vFace;
      ${FX_DEPTH}
      void main() {
        float r2 = dot(vUv, vUv);
        float a = exp(-r2 * 5.0) + exp(-r2 * 30.0) * 1.5;
        float k = a * uPower * (0.35 + 0.65 * vFace) * fxDepthFade(vW - 0.3, 0.3);
        gl_FragColor = vec4(uColor * k, 1.0);
      }`,
  );
}

export function makeGlow(mat) {
  const m = new THREE.Mesh(glowGeo, mat);
  onFxLayer(m);
  m.renderOrder = 4;
  return m;
}

// ---------------------------------------------------------------- re-entry
// Plunging into air at hypersonic speed, a shock wave stands off the leading face and the air in it
// glows: a white-hot cap ahead of the ship, wrapping round it into orange and red sheets that tear
// off behind in long tongues, sparks streaming back past. The sheath is laid out along the flow
// (its local +y runs downstream) and placed by the ship each frame, sized to its outline.
const SHEATH_SEGS = [48, 40];
const sheathGeo = new THREE.CylinderGeometry(1, 1, 1, SHEATH_SEGS[0], SHEATH_SEGS[1], true).translate(0, 0.5, 0);

const SHEATH_VERT = /* glsl */ `
  uniform float uK;
  uniform float uLen;
  uniform float uMid;
  uniform float uTime;
  varying float vS;
  varying float vA;
  varying vec3 vN;
  varying vec3 vV;
  varying float vW;
  // radius at y metres downstream of the apex: a paraboloid out to the ship's widest section, then
  // flaring slowly
  float rad(float y) {
    return uK * sqrt(min(y, uMid) + 0.02) + max(y - uMid, 0.0) * 0.12;
  }
  void main() {
    float y = position.y * uLen;
    float a = atan(position.x, position.z);
    float r = rad(y);
    // the trailing sheets ripple
    r *= 1.0 + 0.06 * sin(a * 5.0 + y * 0.4 - uTime * 9.0) * smoothstep(0.0, uMid, y);
    vec3 p = vec3(sin(a) * r, y, cos(a) * r);
    float dr = (rad(y + 0.2) - rad(y)) / 0.2;
    vec3 n = normalize(vec3(sin(a), -dr, cos(a)));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vS = position.y;
    vA = a;
    vN = normalize(normalMatrix * n);
    vV = normalize(-mv.xyz);
    vW = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const SHEATH_FRAG = /* glsl */ `
  uniform float uPower;
  uniform float uTime;
  uniform float uInside;
  varying float vS;
  varying float vA;
  varying vec3 vN;
  varying vec3 vV;
  varying float vW;
  ${FX_DEPTH}
  ${NOISE}
  void main() {
    float s = vS;
    float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    // turbulence streaming downstream
    float n1 = fxNoise(vec2(vA * 7.0, s * 9.0 - uTime * 6.0));
    float n2 = fxNoise(vec2(vA * 17.0 + 3.0, s * 26.0 - uTime * 14.0));
    float flick = 0.85 + 0.15 * fxNoise(vec2(uTime * 30.0, vA * 3.0));
    // the cap: hottest at the stagnation point
    float cap = 1.0 - smoothstep(0.0, 0.22, s);
    // sheets and tongues, torn up more the further back they run
    float sheet = smoothstep(0.25 + s * 0.35, 0.85, n1 * 0.65 + n2 * 0.45) * pow(max(1.0 - s, 0.0), 1.3);
    // mostly where the sheath is seen edge-on: a burning rim round the ship (seen square on, as
    // chasing the ship down, a filled shell is a blob of light over everything)
    float a = cap * (0.06 + 1.0 * pow(fres, 1.5)) + sheet * (0.1 + 1.6 * pow(fres, 1.4));
    // from the seat the sheath is all round: keep the middle of the view clear to fly by
    a *= mix(1.0, smoothstep(0.15, 0.75, fres), uInside);
    // and none of it right in front of the camera
    a *= smoothstep(3.0, 10.0, vW);
    vec3 hot = vec3(1.0, 0.88, 0.62);
    vec3 orange = vec3(1.0, 0.38, 0.05);
    vec3 red = vec3(0.8, 0.09, 0.02);
    vec3 c = mix(hot, orange, smoothstep(0.02, 0.25, s));
    c = mix(c, red, smoothstep(0.3, 0.85, s));
    float k = a * uPower * flick * fxDepthFade(vW, 1.5);
    gl_FragColor = vec4(c * k * 3.0, 1.0);
  }`;

// sparks: streaks riding the sheath's surface downstream (all motion in the vertex shader)
const SPARKS = 240;
function sparkGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.copy(new THREE.PlaneGeometry(1, 1));
  const rnd = new Float32Array(SPARKS * 4);
  for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
  g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
  g.instanceCount = SPARKS;
  return g;
}

const SPARK_VERT = /* glsl */ `
  attribute vec4 aRand;
  uniform float uK;
  uniform float uLen;
  uniform float uMid;
  uniform float uTime;
  uniform float uPower;
  varying float vA;
  varying vec2 vQ;
  varying float vW;
  float rad(float y) {
    return uK * sqrt(min(y, uMid) + 0.02) + max(y - uMid, 0.0) * 0.12;
  }
  void main() {
    float s = fract(uTime * (0.7 + aRand.x * 0.9) + aRand.x * 9.0);
    float y = (0.05 + s * 0.95) * uLen;
    float a = aRand.y * 6.2831853;
    float r = rad(y) * (0.92 + 0.2 * aRand.z);
    vec3 c = vec3(sin(a) * r, y, cos(a) * r);
    float len = (1.5 + 4.0 * aRand.w) * (0.4 + uPower);
    vec4 cv = modelViewMatrix * vec4(c, 1.0);
    vec3 flow = normalize(mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0));
    vec3 side = cross(flow, normalize(-cv.xyz));
    // (seen straight down the flow a spark has no side to it)
    side = length(side) > 1e-4 ? normalize(side) : vec3(1.0, 0.0, 0.0);
    float w = 0.16 + 0.24 * aRand.z;
    vec3 p = cv.xyz + flow * (uv.y * len) + side * ((uv.x - 0.5) * w);
    vA = (1.0 - s) * smoothstep(0.0, 0.1, s) * smoothstep(0.2, 0.6, uPower) * (0.4 + 0.6 * aRand.w);
    vQ = uv;
    vW = -p.z;
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }`;

const SPARK_FRAG = /* glsl */ `
  varying float vA;
  varying vec2 vQ;
  varying float vW;
  ${FX_DEPTH}
  void main() {
    float across = clamp(1.0 - abs(vQ.x - 0.5) * 2.0, 0.0, 1.0);
    float along = clamp(vQ.y, 0.0, 1.0);
    float a = vA * across * across * (1.0 - along) * fxDepthFade(vW, 0.5);
    vec3 c = mix(vec3(1.0, 0.32, 0.04), vec3(1.0, 0.82, 0.45), (1.0 - along) * across);
    gl_FragColor = vec4(c * a * 4.0, 1.0);
  }`;

export class ReentryFx {
  constructor() {
    const shared = {
      uK: { value: 2.5 },
      uLen: { value: 34 },
      uMid: { value: 7 },
      uTime: { value: 0 },
      uPower: { value: 0 },
      uInside: { value: 0 },
    };
    this.u = shared;
    this.group = new THREE.Group();
    this.sheath = new THREE.Mesh(sheathGeo, fxMaterial(shared, SHEATH_VERT, SHEATH_FRAG));
    this.sparks = new THREE.Mesh(sparkGeometry(), fxMaterial(shared, SPARK_VERT, SPARK_FRAG));
    this.group.add(this.sheath, this.sparks);
    onFxLayer(this.group);
    this.group.visible = false;
  }

  // flow: the air's direction past the ship, in ship space (unit); power 0..1
  update(dt, power, flow, inside) {
    const u = this.u;
    u.uPower.value = power;
    u.uTime.value += dt;
    u.uInside.value = inside ? 1 : 0;
    this.group.visible = power > 0.01;
    if (!this.group.visible) return;
    // the hull as an ellipsoid: where it meets the oncoming air, and its outline across the flow
    const up = _v.copy(flow).negate();
    const ax = HULL_AXES;
    const sx = ax.x * up.x;
    const sy = ax.y * up.y;
    const sz = ax.z * up.z;
    const depth = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const lead = _v2.set(ax.x * sx, ax.y * sy, ax.z * sz).divideScalar(Math.max(depth, 1e-3)).add(HULL_CENTRE);
    // (the widest half-span across the flow: a wingtip, nose-first; the hull's length, belly-first)
    const outline = Math.max(ax.x * Math.sqrt(1 - up.x * up.x), ax.y * Math.sqrt(1 - up.y * up.y), ax.z * Math.sqrt(1 - up.z * up.z));
    const stand = 1.3;
    // the shock stands off ahead; its paraboloid reaches the outline (with room) at the widest section
    this.group.position.copy(lead).addScaledVector(up, stand);
    this.group.quaternion.setFromUnitVectors(_v3.set(0, 1, 0), flow);
    const mid = depth + stand;
    u.uMid.value = mid;
    u.uK.value = (outline * 1.1 + 0.35) / Math.sqrt(mid);
    u.uLen.value = mid + 11;
  }
}

const HULL_CENTRE = new THREE.Vector3(0, 0.5, 0.2);
const HULL_AXES = new THREE.Vector3(6.4, 1.9, 6.9);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
