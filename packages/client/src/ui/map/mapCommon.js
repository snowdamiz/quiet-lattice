// Small pieces shared by the map scenes.
import * as THREE from 'three';

// value-noise fbm, cheap and smooth enough for map globes and the edge of space
export const mapNoiseGLSL = /* glsl */ `
  float h31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z) * 2.0 - 1.0;
  }
  float fbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += vnoise(p) * a;
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
`;

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.08, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.22)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.05)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

// a shell of faint stars far out, so the map never floats in flat black
export function starfieldPoints(n, radius, size = 1) {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(radius * (0.8 + Math.random() * 0.2));
    pos.set([v.x, v.y, v.z], i * 3);
    c.setHSL(0.55 + Math.random() * 0.15 - (Math.random() < 0.2 ? 0.45 : 0), 0.4, 0.55 + Math.random() * 0.4);
    const b = Math.pow(Math.random(), 3) * 0.9 + 0.1;
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: size * 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  return new THREE.Points(geo, mat);
}

// soft-edged round sprites with a hot core (galaxy stars, map markers)
export const starPointVert = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uScale;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale * uPixelRatio / -mv.z, 1.0, 64.0 * uPixelRatio);
    vFade = clamp(aSize * uScale / -mv.z, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
export const starPointFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float core = exp(-r * r * 18.0);
    float halo = exp(-r * 4.0) * 0.35;
    float a = (core + halo) * (1.0 - smoothstep(0.85, 1.0, r));
    gl_FragColor = vec4(vColor * a, 1.0);
  }`;

// stars with a size in light years, so they shrink with distance like the things they stand for
export const worldPointVert = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uProj;
  uniform float uMax;
  uniform float uFadeNear;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    float px = aSize * uProj / d;
    // sub-pixel points dim instead of shrinking past a pixel; very near ones fade (the local field
    // stands in for them there)
    float dim = clamp(px, 0.0, 1.0) * smoothstep(0.0, uFadeNear, d);
    vColor = aColor * dim;
    gl_PointSize = clamp(px, 1.0, uMax);
    gl_Position = projectionMatrix * mv;
  }`;
export const worldPointFrag = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    gl_FragColor = vec4(vColor * exp(-r * r * 4.5), 1.0);
  }`;

// a galaxy seen as a whole: a flat disc of spiral arms round a bright core
export const discVert = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
export const discFrag = /* glsl */ `
  uniform float uArms;
  uniform float uTwist;
  uniform float uSeed;
  uniform float uAlpha;
  uniform float uEllip;
  uniform float uSize;
  uniform vec3 uCore;
  uniform vec3 uArm;
  varying vec2 vP;
  ${mapNoiseGLSL}
  void main() {
    vec2 q = vP / uSize;
    float r = length(q) * 2.0;
    if (r > 1.0) discard;
    float a = atan(q.y, q.x);
    float n = fbm(vec3(q * 9.0, uSeed));
    float spiral = 0.5 + 0.5 * cos(uArms * (a - log(r + 0.02) * uTwist) + n * 2.2);
    float arms = pow(spiral, 3.0) * smoothstep(1.0, 0.25, r) * (1.0 - uEllip);
    float core = exp(-r * r * 30.0) * 1.0 + exp(-r * 5.0) * 0.25;
    float halo = exp(-r * 3.2) * (0.25 + uEllip * 0.9);
    vec3 c = uCore * (core + halo) + uArm * arms * (0.55 + 0.6 * n);
    gl_FragColor = vec4(c * uAlpha * smoothstep(1.0, 0.85, r), 1.0);
  }`;

export const nebFrag = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uSeed;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uDark;
  varying vec2 vUv;
  ${mapNoiseGLSL}
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    vec3 p = vec3(c * 3.2, uSeed + uTime * 0.004);
    vec3 q = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 0.0)), 0.0);
    float f = fbm(p + 2.6 * q);
    float d = smoothstep(-0.15, 0.6, f) * (1.0 - smoothstep(0.35, 1.0, r));
    vec3 col = mix(uColA, uColB, smoothstep(-0.2, 0.5, q.x));
    if (uDark > 0.5) gl_FragColor = vec4(vec3(0.0), d * uAlpha);
    else gl_FragColor = vec4(col * d * uAlpha, 1.0);
  }`;
