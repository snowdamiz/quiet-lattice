// Dev tool: a live 3D view of a real planet. The surface comes from the game's own terrain workers
// and terrain material (a coarse cube sphere: four 32-segment chunks along each face edge), so it
// is the planet you will land on, with its sea, a cloud layer, the glow of its air and its rings.
// Gas giants use their own banded shader. Drag to turn it, wheel to zoom.
import * as THREE from 'three';
import { createTerrainMaterial } from '../render/terrainMaterial.js';
import { SIMPLEX3 } from '../render/glsl.js';

const S = 32;
const N = S + 1;
const SPLIT = 4;

let gridIndex = null;
function chunkIndex() {
  if (gridIndex) return gridIndex;
  const idx = [];
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const a = j * N + i;
      idx.push(a, a + 1, a + N + 1, a, a + N + 1, a + N);
    }
  }
  gridIndex = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  return gridIndex;
}

const cloudFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uCover;
uniform float uSeed;
varying vec3 vLocal;
varying vec3 vWorldN;
${SIMPLEX3}
void main() {
  vec3 p = normalize(vLocal);
  vec3 q = vec3(fbm3(p * 2.0 + uSeed), fbm3(p * 2.0 + uSeed + 7.3), 0.0);
  float n = fbm5(p * 4.5 + q * 1.2 + uSeed) * 0.5 + 0.5;
  float d = smoothstep(0.66 - uCover * 0.16, 0.8 - uCover * 0.12, n);
  float lit = smoothstep(-0.15, 0.45, dot(normalize(vWorldN), uSunDir));
  gl_FragColor = vec4(uColor * (0.06 + lit * 1.1), d * 0.8);
}`;
const shellVert = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorldN;
varying vec3 vView;
void main() {
  vLocal = position;
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vView = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const airFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uColor;
varying vec3 vWorldN;
varying vec3 vView;
void main() {
  vec3 n = normalize(vWorldN);
  float rim = pow(1.0 - abs(dot(n, normalize(vView))), 2.6);
  float day = smoothstep(-0.35, 0.4, dot(n, uSunDir));
  gl_FragColor = vec4(uColor * rim * day * 1.6, 1.0);
}`;

export class PlanetPreview {
  constructor(canvas, pool) {
    this.canvas = canvas;
    this.pool = pool;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 1e7);
    this.sunDir = new THREE.Vector3(-0.75, 0.35, 0.55).normalize();
    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.position.copy(this.sunDir);
    this.scene.add(this.sun, this.sun.target, new THREE.HemisphereLight(0x8090b0, 0x101014, 0.3));
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.spin = new THREE.Vector2(0.06, 0);
    this.zoom = 3.2;
    this.jobs = [];
    this.bindPointer();
  }

  bindPointer() {
    const c = this.canvas;
    let last = null;
    c.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      c.setPointerCapture(e.pointerId);
      c.classList.add('drag');
      this.spin.set(0, 0);
    });
    c.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      const dt = Math.max(1, performance.now() - last.t) / 1000;
      this.turn(dx * 0.008, dy * 0.008);
      // carries on spinning after a flick
      this.spin.set((dx * 0.008) / dt, (dy * 0.008) / dt).clampLength(0, 6);
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    const up = () => {
      last = null;
      c.classList.remove('drag');
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 1.45, 8);
      },
      { passive: false },
    );
  }

  // yaw about the view's vertical, pitch about its horizontal
  turn(yaw, pitch) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    this.pivot.quaternion.premultiply(q).normalize();
  }

  clear() {
    // (chunks already out with the workers are dropped when they come back)
    this.gen = (this.gen || 0) + 1;
    for (const j of this.jobs) this.pool.cancel(j);
    this.jobs = [];
    for (const o of [...this.pivot.children]) {
      this.pivot.remove(o);
      o.traverse((m) => {
        if (!m.isMesh) return;
        if (m.userData.ownGeometry) m.geometry.dispose();
        m.material.dispose();
      });
    }
    this.mats = null;
  }

  show(planet) {
    this.clear();
    this.planet = planet;
    const R = planet.radius;
    const p = planet.params;
    const gen = (this.gen = (this.gen || 0) + 1);
    this.mats = {};
    if (planet.isGas) {
      const mat = (this.mats.gas = planet.gasMat.clone());
      this.pivot.add(new THREE.Mesh(planet.gasMesh.geometry, mat));
    } else {
      // the surface, chunk by chunk from the workers, coarsest first
      const terrain = (this.mats.terrain = createTerrainMaterial(p, { detailStrength: 0.4 }));
      for (let f = 0; f < 6; f++) {
        for (let j = 0; j < SPLIT; j++) {
          for (let i = 0; i < SPLIT; i++) {
            const size = 2 / SPLIT;
            const msg = { planetId: planet.id, face: f, u0: -1 + i * size, v0: -1 + j * size, size, segments: S, skirtDepth: R * 0.002 };
            this.jobs.push(this.pool.request(msg, -2e9, (data) => gen === this.gen && this.addChunk(data, terrain)));
          }
        }
      }
      // a stand-in ball below all of it (as the game's own), so the planet is whole while the
      // chunks come in
      const coreR = R - (p.hasOcean ? p.seaDepth * 0.9 : p.landHeight * 2 + p.craterCount * 2 + 200);
      const core = new THREE.Mesh(new THREE.SphereGeometry(coreR, 64, 32), new THREE.MeshStandardMaterial({ color: new THREE.Color(...p.colors.low1), roughness: 1 }));
      core.userData.ownGeometry = true;
      this.pivot.add(core);
      if (p.hasOcean) {
        const w = p.water || {};
        const deep = new THREE.Color(...(w.deep || [0.02, 0.08, 0.16]));
        const shallow = new THREE.Color(...(w.shallow || [0.05, 0.25, 0.35]));
        const sea = new THREE.Mesh(
          new THREE.SphereGeometry(R, 128, 64),
          new THREE.MeshStandardMaterial({
            color: deep.clone().lerp(shallow, 0.35),
            roughness: 0.18,
            metalness: 0.1,
            transparent: true,
            opacity: 0.86,
            emissive: shallow,
            emissiveIntensity: (w.emissive || 0) * 0.6,
          }),
        );
        sea.userData.ownGeometry = true;
        this.pivot.add(sea);
      }
    }
    if (planet.clouds > 0.02) {
      const mat = (this.mats.cloud = new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: new THREE.Vector3() },
          uColor: { value: new THREE.Vector3().copy(planet.cloudColor) },
          uCover: { value: Math.min(1, planet.clouds) },
          uSeed: { value: planet.cloudSeed },
        },
        vertexShader: shellVert,
        fragmentShader: cloudFrag,
        transparent: true,
        depthWrite: false,
      }));
      const m = new THREE.Mesh(new THREE.SphereGeometry(R * (planet.cloudTop || 1.02), 96, 48), mat);
      m.userData.ownGeometry = true;
      this.pivot.add(m);
    }
    if (planet.atmo) {
      const s = planet.atmo.scatter;
      const mx = Math.max(s.x, s.y, s.z) || 1;
      const mat = (this.mats.air = new THREE.ShaderMaterial({
        uniforms: { uSunDir: { value: new THREE.Vector3() }, uColor: { value: new THREE.Vector3(s.x / mx, s.y / mx, s.z / mx) } },
        vertexShader: shellVert,
        fragmentShader: airFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      const m = new THREE.Mesh(new THREE.SphereGeometry(R * Math.min(planet.atmo.top, 1.045), 96, 48), mat);
      m.userData.ownGeometry = true;
      this.pivot.add(m);
    }
    if (planet.rings) {
      const mat = (this.mats.ring = planet.ringMat.clone());
      const m = new THREE.Mesh(planet.rings.geometry, mat);
      m.quaternion.copy(planet.rings.quaternion);
      m.renderOrder = 2;
      this.pivot.add(m);
    }
    // framed with room for rings
    this.reach = planet.rings ? R * (planet.ringSpec?.outer || 2.4) : R;
    this.camera.near = R * 0.02;
    this.camera.far = R * 60;
    this.camera.updateProjectionMatrix();
    // a three-quarter view, the day side toward you
    this.pivot.quaternion.setFromEuler(new THREE.Euler(0.35, -0.6, 0));
    this.spin.set(0.06, 0);
  }

  addChunk(data, material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 4, true));
    geo.setIndex(chunkIndex());
    const m = new THREE.Mesh(geo, material);
    m.position.fromArray(data.center);
    m.userData.ownGeometry = true;
    this.pivot.add(m);
  }

  // how much of the surface has come in (0..1)
  get progress() {
    if (!this.planet || this.planet.isGas) return 1;
    return 1 - this.jobs.filter((j) => this.pool.jobs.has(j.id)).length / this.jobs.length;
  }

  render(dt = 1 / 60) {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h || !this.planet) return;
    if (c.width !== Math.round(w * this.renderer.getPixelRatio())) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // drifts on, a little slower every frame after a flick
    this.turn(this.spin.x * dt, this.spin.y * dt);
    this.spin.multiplyScalar(Math.exp(-dt * 1.5));
    if (this.spin.length() < 0.06) this.spin.x = THREE.MathUtils.lerp(this.spin.x, 0.06, dt * 0.5);
    const fit = this.reach / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.min(1, this.camera.aspect);
    this.camera.position.set(0, 0, fit * this.zoom * 0.4);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.pivot.updateMatrixWorld(true);
    const local = this.sunDir.clone().applyQuaternion(this.pivot.quaternion.clone().invert());
    const m = this.mats;
    if (m.terrain) {
      const u = m.terrain.userData.uniforms;
      u.uSunDirView.value.copy(this.sunDir).transformDirection(this.camera.matrixWorldInverse);
      u.uPlanetInv.value.copy(this.pivot.matrixWorld).invert();
      u.uAmbientScale.value = 1;
    }
    if (m.gas) {
      m.gas.uniforms.uSunDir.value.copy(this.sunDir);
      if (m.gas.uniforms.uSunDirLocal) m.gas.uniforms.uSunDirLocal.value.copy(local);
      m.gas.uniforms.uTime.value = performance.now() / 1000;
    }
    if (m.ring) m.ring.uniforms.uSunDirLocal.value.copy(local);
    if (m.cloud) m.cloud.uniforms.uSunDir.value.copy(this.sunDir);
    if (m.air) m.air.uniforms.uSunDir.value.copy(this.sunDir);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clear();
    this.renderer.dispose();
  }
}
