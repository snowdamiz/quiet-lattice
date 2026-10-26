// Camera-centred weather particles (rain, snow, ash, spores, dust). Particles live
// in a wrapping box expressed in the local "up" frame and stay fixed in the world
// as the camera moves.
import * as THREE from 'three';

const N = 7000;
const BOX = 70;

const KINDS = {
  rain: { color: [0.55, 0.62, 0.72], len: 0.9, fall: 26, size: 1, lines: true, alpha: 0.18, wind: 3 },
  snow: { color: [0.95, 0.97, 1.0], len: 0, fall: 2.2, size: 3.2, lines: false, alpha: 0.9, wind: 6, sway: 1.5 },
  ash: { color: [0.35, 0.3, 0.28], len: 0, fall: 1.6, size: 2.6, lines: false, alpha: 0.9, wind: 3, sway: 0.8, embers: true },
  spores: { color: [0.8, 0.5, 1.0], len: 0, fall: -0.3, size: 3.0, lines: false, alpha: 1, wind: 1, sway: 2, glow: true },
  dust: { color: [0.75, 0.6, 0.42], len: 0.7, fall: 1.0, size: 1.2, lines: true, alpha: 0.35, wind: 22 },
  // driven sideways by the gale
  storm: { color: [0.6, 0.66, 0.74], len: 1.6, fall: 30, size: 1, lines: true, alpha: 0.26, wind: 34 },
  acid: { color: [0.75, 0.95, 0.3], len: 0.9, fall: 22, size: 1, lines: true, alpha: 0.24, wind: 6 },
  cinders: { color: [1.0, 0.45, 0.12], len: 0, fall: -0.6, size: 2.2, lines: false, alpha: 1, wind: 9, sway: 1.2, glow: true, embers: true },
  fallout: { color: [0.7, 0.85, 0.4], len: 0, fall: 0.6, size: 2.0, lines: false, alpha: 0.8, wind: 4, sway: 1.0, glow: true },
  grit: { color: [0.62, 0.58, 0.52], len: 0.7, fall: 0.8, size: 1.2, lines: true, alpha: 0.3, wind: 18 },
};

function weatherFor(planet) {
  const p = planet.params;
  if (!planet.atmo) return null;
  const w = (p.weather || '').toLowerCase();
  if (p.type === 'storm') return 'storm';
  if (p.type === 'corrosive') return 'acid';
  if (p.type === 'inferno') return 'cinders';
  if (p.type === 'irradiated') return 'fallout';
  if (p.type === 'dead' || p.type === 'crushing') return 'grit';
  if (p.type === 'frozen') return 'snow';
  if (p.type === 'volcanic') return 'ash';
  if (p.type === 'desert') return 'dust';
  if (p.type === 'alien') return 'spores';
  if (w.includes('rain') || p.type === 'lush' || p.type === 'toxic') return 'rain';
  return null;
}

export class Weather {
  constructor(game) {
    this.game = game;
    const pos = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    const rnd = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * BOX;
      const y = Math.random() * BOX;
      const z = Math.random() * BOX;
      const r = Math.random();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
        rnd[i * 2 + k] = r;
      }
    }
    this.uniforms = {
      uOffset: { value: new THREE.Vector3() },
      uBox: { value: BOX },
      uBasis: { value: new THREE.Matrix3() },
      uDir: { value: new THREE.Vector3(0, -1, 0) },
      uLen: { value: 1 },
      uColor: { value: new THREE.Color() },
      uAlpha: { value: 0 },
      uSize: { value: 2 },
      uTime: { value: 0 },
      uSway: { value: 0 },
      uEmbers: { value: 0 },
      uPixel: { value: 1 },
    };
    const vert = /* glsl */ `
      attribute float aEnd;
      attribute float aRnd;
      uniform vec3 uOffset;
      uniform float uBox;
      uniform mat3 uBasis;
      uniform vec3 uDir;
      uniform float uLen;
      uniform float uSize;
      uniform float uTime;
      uniform float uSway;
      uniform float uPixel;
      varying float vFade;
      varying float vRnd;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec3 p = mod(position + uOffset, uBox) - uBox * 0.5;
        p.x += sin(uTime * (0.7 + aRnd) + aRnd * 30.0) * uSway;
        p.z += cos(uTime * (0.5 + aRnd) + aRnd * 17.0) * uSway;
        p -= aEnd * uDir * uLen;
        vec3 w = uBasis * p;
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = length(p) / (uBox * 0.5);
        vFade = smoothstep(1.0, 0.55, d) * smoothstep(0.0, 1.5, length(mv.xyz));
        vRnd = aRnd;
        gl_PointSize = uSize * uPixel * (0.6 + aRnd * 0.8) * clamp(18.0 / -mv.z, 0.3, 4.0);
        #include <logdepthbuf_vertex>
      }`;
    const frag = /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uEmbers;
      varying float vFade;
      varying float vRnd;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float a = uAlpha * vFade;
        #ifdef POINTS
          vec2 c = gl_PointCoord - 0.5;
          a *= smoothstep(0.5, 0.15, length(c));
        #endif
        vec3 col = uColor;
        if (uEmbers > 0.5 && vRnd > 0.93) col = vec3(4.0, 1.2, 0.2);
        gl_FragColor = vec4(col * a, a);
      }`;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lineGeo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    lineGeo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    const lineMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    lineMat.blending = THREE.CustomBlending;
    lineMat.blendSrc = THREE.OneFactor;
    lineMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.lines = new THREE.LineSegments(lineGeo, lineMat);
    // points use every other vertex (aEnd = 0)
    const pPos = new Float32Array(N * 3);
    const pEnd = new Float32Array(N);
    const pRnd = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pPos.set(pos.subarray(i * 6, i * 6 + 3), i * 3);
      pRnd[i] = rnd[i * 2];
    }
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    ptGeo.setAttribute('aEnd', new THREE.BufferAttribute(pEnd, 1));
    ptGeo.setAttribute('aRnd', new THREE.BufferAttribute(pRnd, 1));
    const ptMat = lineMat.clone();
    ptMat.uniforms = this.uniforms;
    ptMat.defines = { POINTS: 1 };
    this.points = new THREE.Points(ptGeo, ptMat);
    for (const o of [this.lines, this.points]) {
      o.frustumCulled = false;
      o.visible = false;
      o.renderOrder = 10;
      game.engine.scene.add(o);
    }
    this.kind = null;
    this.intensity = 0;
    this.lastCam = new THREE.Vector3();
    this.basisInv = new THREE.Matrix3();
  }

  update(dt, planet) {
    const g = this.game;
    const u = this.uniforms;
    u.uTime.value += dt;
    let kind = null;
    let target = 0;
    let up = null;
    let alt = Infinity;
    if (planet && !g.indoor && g.mode !== 'title') {
      kind = weatherFor(planet);
      const rel = g.camWorld.clone().sub(planet.position);
      alt = rel.length() - planet.radius;
      up = rel.normalize();
      if (kind && alt < 4000) {
        // storms come and go
        const seed = planet.params.seed % 100;
        const cycle = Math.sin(g.time / 90 + seed) * 0.5 + 0.5;
        const always = kind === 'spores' || kind === 'ash' || kind === 'cinders' || kind === 'fallout' ? 0.6 : kind === 'storm' ? 0.85 : 0;
        target = Math.max(always, THREE.MathUtils.smoothstep(cycle, 0.35, 0.75)) * (1 - THREE.MathUtils.smoothstep(alt, 1500, 4000));
        // rain needs a properly overcast world; fair-weather planets stay dry
        if (kind === 'rain') target *= THREE.MathUtils.smoothstep(planet.clouds, 0.45, 0.7);
        if (g.mode === 'foot' && g.player.headUnderwater) target = 0;
      }
    }
    // (well above the weather it is simply gone: after a jump to orbit, no rain falls across the stars)
    this.intensity = alt > 6000 ? 0 : THREE.MathUtils.damp(this.intensity, target, 0.8, dt);
    if (kind) this.kind = kind;
    const k = KINDS[this.kind];
    const vis = this.intensity > 0.01 && k && up;
    this.lines.visible = !!(vis && k.lines);
    this.points.visible = !!(vis && !k.lines);
    g.weatherIntensity = vis ? this.intensity : 0;
    g.weatherKind = vis ? this.kind : null;
    if (!vis) {
      this.lastCam.copy(g.camWorld);
      return;
    }
    // basis: y = up
    const x = new THREE.Vector3(1, 0, 0);
    if (Math.abs(up.x) > 0.9) x.set(0, 0, 1);
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    x.crossVectors(up, z).normalize();
    u.uBasis.value.set(x.x, up.x, z.x, x.y, up.y, z.y, x.z, up.z, z.z);
    // world motion of the camera expressed in the weather basis
    const delta = g.camWorld.clone().sub(this.lastCam);
    this.lastCam.copy(g.camWorld);
    if (delta.length() > 50) delta.set(0, 0, 0);
    const dl = new THREE.Vector3(delta.dot(x), delta.dot(up), delta.dot(z));
    const t = u.uTime.value;
    const wind = new THREE.Vector3(Math.sin(t * 0.1) * k.wind, 0, Math.cos(t * 0.13) * k.wind * 0.6);
    const vel = new THREE.Vector3(wind.x, -k.fall, wind.z);
    u.uOffset.value.addScaledVector(vel, dt).sub(dl);
    const B = BOX * 1000;
    u.uOffset.value.set(((u.uOffset.value.x % B) + B) % B, ((u.uOffset.value.y % B) + B) % B, ((u.uOffset.value.z % B) + B) % B);
    u.uDir.value.copy(vel).normalize();
    u.uLen.value = k.len;
    u.uColor.value.setRGB(...k.color);
    if (k.glow) u.uColor.value.multiplyScalar(2.5);
    const light = g.isDark ? 0.35 : 1;
    u.uAlpha.value = k.alpha * this.intensity * (k.glow ? 1 : light);
    u.uSize.value = k.size;
    u.uSway.value = k.sway || 0;
    u.uEmbers.value = k.embers ? 1 : 0;
    u.uPixel.value = g.engine.renderer.getPixelRatio();
  }
}
