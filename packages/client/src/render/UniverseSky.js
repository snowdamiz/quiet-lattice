// The sky in flight, seen from wherever the player really is. Two layers:
// - far: the galaxy round us (its band from inside, its stars, its glow from outside), the other
//   galaxies, the nebulae a few hundred light years out and the edge of space. It is rendered
//   from the player's galactic position into a cubemap that becomes the scene background, and
//   only re-rendered once the ship has moved far enough for the nearest of it to shift (one cube
//   face a frame into a second buffer, then the two swap), so it costs nothing while you hold still.
// - near: the cluster's star systems and the field stars round them, drawn every frame as points,
//   placed and lit by their true distance, so they wheel past and brighten as you fly among them.
import * as THREE from 'three';
import { SIMPLEX3 } from './glsl.js';
import { LY, GALAXY, cosmos } from '../universe/Cosmos.js';
import { buildEdge, edgeX, EDGE_SEED } from '../ui/map/EdgeOfSpace.js';
import { worldPointVert, worldPointFrag, discVert, discFrag, nebFrag } from '../ui/map/mapCommon.js';
import { mulberry32 } from '../math/rng.js';

const FACE = 1024;
// near stars are drawn this far out (m): beyond any planet, inside the camera's far plane
const STAR_R = 5e8;
const _v = new THREE.Vector3();
const _c = new THREE.Color();

// the galaxy's light seen from inside it: a band along its plane, thickest and warmest toward
// the core, mottled with star clouds and split by dark dust
const bandFrag = /* glsl */ `
precision highp float;
uniform vec3 uCore;
uniform float uAlpha;
varying vec3 vDir;
${SIMPLEX3}
float fbm6(vec3 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 6; i++) { s += snoise(p) * a; p *= 2.02; a *= 0.5; }
  return s;
}
float fbm3n(vec3 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 3; i++) { s += snoise(p) * a; p *= 2.02; a *= 0.5; }
  return s;
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 s = vec3(11.0, 14.3, 7.7);
  float core = max(dot(d, uCore), 0.0);
  float lat0 = d.y;
  float lat = lat0 + 0.05 * fbm6(d * 1.3 + 3.1);
  float w = 1.0 + 1.6 * pow(core, 3.0);
  float band = exp(-lat * lat * 70.0 / (w * w));
  float halo = exp(-lat * lat * 8.0 / (w * w));
  vec3 along = d - vec3(0.0, lat0, 0.0);
  vec3 pb = along * 3.0 + vec3(0.0, lat * 4.2, 0.0) + s;
  vec3 q = d * 1.5 + s;
  vec3 warp = vec3(fbm3n(q + 3.1), fbm3n(q + 7.7), fbm3n(q + 13.3));
  float starClouds = fbm6(pb + warp * 0.35);
  float grain = fbm6(d * 30.0 + s * 2.3);
  float bright = 0.35 + 0.5 * pow(core, 2.0) + exp(-(1.0 - core) * 22.0) * 0.6;
  float bandL = (band * 0.13 + halo * 0.022) * (0.45 + 0.8 * smoothstep(-0.4, 0.6, starClouds)) * (0.9 + 0.22 * grain) * bright;
  vec3 bandCol = mix(vec3(1.0, 0.93, 0.82), vec3(0.58, 0.68, 1.0), smoothstep(0.02, 0.3, abs(lat)));
  bandCol = mix(bandCol, vec3(1.0, 0.84, 0.62), pow(core, 3.0) * 0.6);
  float riftLat = 0.05 * fbm6(along * 1.6 + s * 1.9);
  float riftW = (0.035 + 0.025 * fbm6(along * 2.3 + s * 0.6)) * w;
  float rift = exp(-pow((lat - riftLat) / riftW, 2.0)) * smoothstep(-0.6, 0.15, fbm6(pb * 1.2 + 5.0));
  float fil = smoothstep(0.2, 0.55, fbm6(pb * 2.2 + warp * 0.5 + 9.0)) * halo;
  float dust = (1.0 - 0.85 * rift) * (1.0 - 0.55 * fil);
  vec3 col = bandCol * bandL * dust;
  // the band resolves into a haze of faint stars, thickest in the bright star clouds
  float dens = (band * (0.4 + 0.9 * smoothstep(-0.4, 0.6, starClouds)) + halo * 0.12) * dust * min(bright, 1.5);
  float h1 = hash13(floor(d * 650.0) + 17.0);
  col += mix(bandCol, vec3(1.0), 0.5) * step(1.0 - 0.07 * dens, h1) * (0.1 + 0.5 * fract(h1 * 517.0)) * 0.22;
  float h2 = hash13(floor(d * 420.0) + 41.0);
  col += mix(bandCol, vec3(1.0), 0.6) * step(1.0 - 0.012 * dens, h2) * (0.2 + 0.8 * fract(h2 * 331.0)) * 0.35;
  gl_FragColor = vec4(col * 0.6 * uAlpha, 1.0);
}`;

const dirVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// the far, unresolved stars: fixed directions, no parallax
const shellVert = /* glsl */ `
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_PointSize = 1.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const shellFrag = /* glsl */ `
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(vColor * smoothstep(1.0, 0.2, r), 1.0);
}`;

// nebulae turned to face the eye itself (not the view plane), so a cloud spanning two cube faces
// is the same cloud on both; they thin out as the ship flies into one
const nebVertSky = /* glsl */ `
uniform float uScale;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toEye = cameraPosition - c;
  float dist = length(toEye);
  vec3 f = toEye / dist;
  vec3 ref = abs(f.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 r = normalize(cross(ref, f));
  vec3 u = cross(f, r);
  vFade = smoothstep(uScale * 0.15, uScale * 0.7, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (r * position.x + u * position.y) * uScale, 1.0);
}`;
// the galaxy's stars, faded by a gain: from inside the disc the band carries their light (drawn
// as well, they piled into a hard white line along it), and they come up as the ship leaves it
const galaxyVertSky = worldPointVert.replace('uniform float uFadeNear;', 'uniform float uFadeNear;\n  uniform float uGain;').replace('vColor = aColor * dim;', 'vColor = aColor * dim * uGain;');
const nebFragSky = nebFrag.replace('varying vec2 vUv;', 'varying vec2 vUv;\n  varying float vFade;').replace(/\* uAlpha/g, '* uAlpha * vFade');

// the near stars: each placed on a sphere round the camera in its true direction, lit by its true
// distance (luminosity over distance squared)
const fieldVert = /* glsl */ `
attribute vec3 aTint;
attribute float aLum;
uniform vec3 uEye;
uniform float uR;
uniform float uGain;
uniform float uPixelRatio;
uniform float uVis;
varying vec3 vColor;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 rel = position - uEye;
  float d = max(length(rel), 1e-4);
  float b = min(uGain * aLum / (d * d), 6.0);
  vColor = aTint * b * uVis;
  gl_PointSize = (1.0 + min(b, 4.0) * 0.55) * uPixelRatio;
  vec4 mv = modelViewMatrix * vec4(rel / d * uR, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const starsFrag = /* glsl */ `
varying vec3 vColor;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(vColor * a * a, 1.0);
}`;
const systemsVert = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
uniform float uPixelRatio;
uniform float uVis;
varying vec3 vColor;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vColor = aColor * uVis;
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

export class UniverseSky {
  constructor(renderer) {
    this.renderer = renderer;
    const opts = { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rts = [new THREE.WebGLCubeRenderTarget(FACE, opts), new THREE.WebGLCubeRenderTarget(FACE, opts)];
    this.front = 0;
    this.cubeCamera = new THREE.CubeCamera(0.01, 1e9, this.rts[0]);
    this.renderEye = new THREE.Vector3();
    this.lastEye = new THREE.Vector3(1e9, 0, 0);
    this.lastReveal = -1;
    this.face = -1;
    this.needsFull = true;
    this.mats = [];
    this.buildFar();
    this.group = new THREE.Group();
    this.group.name = 'stars';
    this.buildNear();
  }

  get texture() {
    return this.rts[this.front].texture;
  }

  // ---------- far layer ----------
  buildFar() {
    const c = cosmos();
    const scene = (this.scene = new THREE.Scene());
    // centred on the eye
    this.bandMat = new THREE.ShaderMaterial({
      uniforms: { uCore: { value: new THREE.Vector3() }, uAlpha: { value: 1 } },
      vertexShader: dirVert,
      fragmentShader: bandFrag,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), this.bandMat));
    {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(c.shell.count * 3);
      for (let i = 0; i < pos.length; i++) pos[i] = c.shell.dir[i] * 1e8;
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(c.shell.col, 3));
      this.shellMat = new THREE.ShaderMaterial({ vertexShader: shellVert, fragmentShader: shellFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const p = new THREE.Points(geo, this.shellMat);
      p.frustumCulled = false;
      scene.add(p);
    }
    // everything else sits at its galactic position, the group moved so the eye is the origin
    const content = (this.content = new THREE.Group());
    scene.add(content);
    {
      const st = c.stars;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(st.pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(st.col.map((v) => v * 0.5), 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(st.size, 1));
      this.galaxyMat = new THREE.ShaderMaterial({
        uniforms: { uProj: { value: FACE / 2 }, uMax: { value: 1.6 }, uFadeNear: { value: 2000 }, uGain: { value: 0 } },
        vertexShader: galaxyVertSky,
        fragmentShader: worldPointFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const p = new THREE.Points(geo, this.galaxyMat);
      p.frustumCulled = false;
      content.add(p);
    }
    const disc = (g, size) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uArms: { value: g.arms },
          uTwist: { value: g.twist },
          uSeed: { value: g.seed },
          uAlpha: { value: g.alpha },
          uEllip: { value: g.ellip },
          uSize: { value: size },
          uCore: { value: new THREE.Vector3(...g.core) },
          uArm: { value: new THREE.Vector3(...g.arm) },
        },
        vertexShader: discVert,
        fragmentShader: discFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
    {
      const S = GALAXY.radius * 2.1;
      this.discMat = disc({ arms: 4, twist: 1.9, seed: 3.1, alpha: 0, ellip: 0, core: [1.0, 0.82, 0.62], arm: [0.55, 0.65, 1.0] }, S);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(S, S), this.discMat);
      m.rotation.x = -Math.PI / 2;
      m.position.copy(GALAXY.center);
      m.frustumCulled = false;
      content.add(m);
    }
    for (const g of c.galaxies) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(g.size, g.size), disc(g, g.size));
      if (g.ellip) m.scale.y = 0.62;
      m.position.copy(g.position);
      m.rotation.copy(g.rotation);
      m.frustumCulled = false;
      content.add(m);
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    for (const n of c.nebulae) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColA: { value: new THREE.Vector3(...n.colA) },
          uColB: { value: new THREE.Vector3(...n.colB) },
          uSeed: { value: n.seed },
          uTime: { value: 0 },
          uAlpha: { value: n.alpha },
          uDark: { value: n.dark ? 1 : 0 },
          uScale: { value: n.scale },
        },
        vertexShader: nebVertSky,
        fragmentShader: nebFragSky,
        transparent: true,
        depthWrite: false,
        blending: n.dark ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(quad, mat);
      m.position.copy(n.position);
      m.frustumCulled = false;
      m.renderOrder = n.dark ? 1 : 0;
      content.add(m);
    }
    this.edge = buildEdge(mulberry32(EDGE_SEED));
    content.add(this.edge.group);
  }

  // how close the edge has come: 0 from the far side of the universe, 1 against it
  revealAt(eye) {
    return 1 - THREE.MathUtils.smoothstep(edgeX(eye.y, eye.z) - eye.x, 4e5, 2.6e6);
  }

  // how far the ship may move before the nearest far thing visibly shifts (ly)
  tolerance(eye) {
    const c = cosmos();
    let near = Math.min(2000, edgeX(eye.y, eye.z) - eye.x);
    for (const n of c.nebulae) near = Math.min(near, Math.max(5, n.position.distanceTo(eye) - n.scale * 0.5));
    for (const g of c.galaxies) near = Math.min(near, Math.max(50, g.position.distanceTo(eye) - g.size * 0.5));
    return near * 0.0008;
  }

  setEye(eye) {
    this.content.position.copy(eye).negate();
    this.bandMat.uniforms.uCore.value.copy(GALAXY.center).sub(eye).normalize();
    const inside = 1 - THREE.MathUtils.smoothstep(eye.length(), 1500, 5000);
    this.bandMat.uniforms.uAlpha.value = inside;
    this.galaxyMat.uniforms.uGain.value = 1 - inside;
    this.discMat.uniforms.uAlpha.value = THREE.MathUtils.smoothstep(eye.distanceTo(GALAXY.center), 4.5e4, 1.6e5) * 0.5;
    const reveal = this.revealAt(eye);
    this.edge.update(this.time || 0, 1, reveal, FACE / 2);
    this.lastReveal = reveal;
    this.scene.updateMatrixWorld(true);
  }

  renderFace(rt, face) {
    const r = this.renderer;
    const cc = this.cubeCamera;
    if (cc.coordinateSystem !== r.coordinateSystem) {
      cc.coordinateSystem = r.coordinateSystem;
      cc.updateCoordinateSystem();
    }
    cc.updateMatrixWorld();
    const prev = r.getRenderTarget();
    const tm = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(rt, face);
    r.clear();
    r.render(this.scene, cc.children[face]);
    r.setRenderTarget(prev);
    r.toneMapping = tm;
  }

  // ---------- near layer ----------
  buildNear() {
    const f = cosmos().field;
    this.fieldOrigin = new THREE.Vector3();
    const geo = new THREE.BufferGeometry();
    this.fieldPos = new THREE.BufferAttribute(new Float32Array(f.pos), 3);
    geo.setAttribute('position', this.fieldPos);
    geo.setAttribute('aTint', new THREE.BufferAttribute(f.tint, 3));
    geo.setAttribute('aLum', new THREE.BufferAttribute(f.lum, 1));
    this.fieldMat = new THREE.ShaderMaterial({
      uniforms: { uEye: { value: new THREE.Vector3() }, uR: { value: STAR_R }, uGain: { value: 260 }, uPixelRatio: { value: 1 }, uVis: { value: 1 } },
      vertexShader: fieldVert,
      fragmentShader: starsFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.field = new THREE.Points(geo, this.fieldMat);
    this.field.frustumCulled = false;
    this.field.renderOrder = -10;
    this.group.add(this.field);
  }

  // the cluster's systems as stars (built once the galaxy is known)
  setSystems(systems) {
    this.systems = systems;
    const N = systems.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N), 1));
    this.sysMat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uVis: { value: 1 } },
      vertexShader: systemsVert,
      fragmentShader: starsFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sysPoints = new THREE.Points(geo, this.sysMat);
    this.sysPoints.frustumCulled = false;
    this.sysPoints.renderOrder = -9;
    this.group.add(this.sysPoints);
  }

  // force a full redraw of the far layer at the next update (a new system, a warp)
  reset() {
    this.needsFull = true;
  }

  // eye: the camera's galactic position (ly). visited: the built system's star, with its real
  // position relative to the camera (m), so its point hands over to the star itself up close.
  update(eye, { time, pixelRatio, vis, visited, starRel }) {
    this.time = time;
    // near layer
    if (eye.distanceTo(this.fieldOrigin) > 50) {
      this.fieldOrigin.copy(eye);
      const f = cosmos().field;
      const a = this.fieldPos.array;
      for (let i = 0; i < f.count; i++) {
        a[i * 3] = f.pos[i * 3] - eye.x;
        a[i * 3 + 1] = f.pos[i * 3 + 1] - eye.y;
        a[i * 3 + 2] = f.pos[i * 3 + 2] - eye.z;
      }
      this.fieldPos.needsUpdate = true;
    }
    const fu = this.fieldMat.uniforms;
    fu.uEye.value.copy(eye).sub(this.fieldOrigin);
    fu.uPixelRatio.value = pixelRatio;
    fu.uVis.value = vis;
    if (this.sysPoints) {
      const pos = this.sysPoints.geometry.attributes.position;
      const col = this.sysPoints.geometry.attributes.aColor;
      const size = this.sysPoints.geometry.attributes.aSize;
      this.systems.forEach((s, i) => {
        let d;
        let fade = 1;
        if (s === visited && starRel) {
          d = starRel.length();
          _v.copy(starRel).divideScalar(d);
          // the star itself is drawn inside a billion metres; its point fades out on the way in
          fade = THREE.MathUtils.smoothstep(d, 3e8, 8e8);
          d /= LY;
        } else {
          _v.set(s.x - eye.x, s.y - eye.y, s.z - eye.z);
          d = _v.length();
          _v.divideScalar(d);
        }
        // bright when near, and never lost entirely: the cluster's stars are the ones to steer by
        const b = Math.max(0.05, Math.min(40, (s.lum * 70) / (d * d)));
        pos.setXYZ(i, _v.x * STAR_R, _v.y * STAR_R, _v.z * STAR_R);
        _c.set(s.color);
        const k = Math.min(b, 8) * fade;
        col.setXYZ(i, _c.r * k, _c.g * k, _c.b * k);
        size.setX(i, 1.4 + Math.min(4, Math.log2(1 + b)) * 1.1);
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
      size.needsUpdate = true;
      this.sysMat.uniforms.uPixelRatio.value = pixelRatio;
      this.sysMat.uniforms.uVis.value = vis;
    }

    // far layer
    if (this.needsFull) {
      this.needsFull = false;
      this.face = -1;
      this.renderEye.copy(eye);
      this.setEye(eye);
      for (let f = 0; f < 6; f++) this.renderFace(this.rts[this.front], f);
      this.lastEye.copy(eye);
      return true;
    }
    if (this.face < 0) {
      const moved = eye.distanceTo(this.lastEye) > this.tolerance(eye);
      if (moved || Math.abs(this.revealAt(eye) - this.lastReveal) > 0.03) {
        this.face = 0;
        this.renderEye.copy(eye);
        this.setEye(eye);
      }
    }
    if (this.face >= 0) {
      this.renderFace(this.rts[1 - this.front], this.face++);
      if (this.face === 6) {
        this.face = -1;
        this.front = 1 - this.front;
        this.lastEye.copy(this.renderEye);
        return true;
      }
    }
    return false;
  }
}
