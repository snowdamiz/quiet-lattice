// Planets & moons: LOD terrain (rocky) or banded shader sphere (gas giants),
// optional rings, plus the parameters the atmosphere pass needs.
import * as THREE from 'three';
import { Body } from './Body.js';
import { drawnGround } from '@astra/shared/world';
import { PlanetTerrain } from '../terrain/PlanetTerrain.js';
import { createTerrainMaterial } from '../render/terrainMaterial.js';
import { createTreePointsMaterial } from '../render/treePoints.js';
import { SIMPLEX3 } from '../render/glsl.js';

const RING_GLSL = /* glsl */ `
// ring opacity at radial position u (0 inner edge .. 1 outer edge), shared by the
// ring itself and the shadow it casts on the planet
float ringH(float n, float seed) { return fract(sin(n * 12.9898 + seed) * 43758.5453); }
float ringN(float x, float seed) { float i = floor(x); float f = fract(x); return mix(ringH(i, seed), ringH(i + 1.0, seed), smoothstep(0.0, 1.0, f)); }
// fw: radial footprint of one pixel in u; finer bands than that fade to their average
float ringDensity(float u, float seed, float fw) {
  float d = ringN(u * 40.0, seed) * 0.55 + mix(ringN(u * 130.0, seed), 0.5, smoothstep(0.002, 0.008, fw)) * 0.3 +
    mix(ringN(u * 300.0, seed), 0.5, smoothstep(0.0008, 0.0035, fw)) * 0.15;
  float a = smoothstep(0.2, 0.7, d) * smoothstep(0.0, 0.05, u) * smoothstep(1.0, 0.9, u);
  // a faint inner ring and a clean division two-thirds of the way out
  a *= mix(0.3, 1.0, smoothstep(0.12, 0.28, u));
  a *= 1.0 - 0.9 * smoothstep(0.025, 0.0, abs(u - 0.64 - (ringH(3.0, seed) - 0.5) * 0.1));
  return a * 0.85;
}
`;

let nextPlanetId = 1;
const _v = new THREE.Vector3();

export class Planet extends Body {
  constructor(opts, pool) {
    super(opts);
    this.id = nextPlanetId++;
    this.params = opts.params;
    this.type = opts.params.type;
    this.isGas = this.type === 'gas';
    this.pool = pool;
    this.landable = !this.isGas;
    this.gravity = opts.gravity || 9.0;
    this.description = opts.description || '';
    this.discovered = false;
    const p = this.params;

    if (!this.isGas) {
      // the ground this world is drawn on at its system's tier (shared, so the server scatters its resource nodes over
      // the same ground): its cities, the sites clear of them, and the ground levelled under both (p.pads)
      this.ground = drawnGround(p, opts.tier ?? 0);
      this.sampler = this.ground.sampler;
      this.cities = this.ground.cities;
      this.sites = this.ground.sites;
      pool.registerPlanet(this.id, p);
      this.material = createTerrainMaterial(p, { detailStrength: p.type === 'frozen' ? 0.35 : 0.55 });
      // (no terrain drawn under a city's paving: a little inside its edge)
      this.cities.slice(0, 4).forEach((c, i) => this.material.userData.uniforms.uCities.value[i].set(c.dir.x, c.dir.y, c.dir.z, Math.cos((c.radius + 30) / this.radius)));
      this.treeMat = p.flora > 0.05 ? createTreePointsMaterial(p) : null;
      this.terrain = new PlanetTerrain({
        id: this.id,
        radius: this.radius,
        pool,
        material: this.material,
        treeMaterial: this.treeMat,
        maxHeight: p.mountainHeight + p.landHeight * 3,
        occluderRadius: this.radius - (p.hasOcean ? 30 : p.landHeight * 2 + p.craterCount * 2 + 200),
      });
      this.root.add(this.terrain.group);
      this.maxTerrain = p.mountainHeight + p.landHeight * 2.5 + p.hillHeight + 50;
      // occluding proxy below all terrain: hides the far side / sun while chunks stream in
      const c = p.colors;
      const avg = new THREE.Color((c.low1[0] + c.rock1[0]) / 2, (c.low1[1] + c.rock1[1]) / 2, (c.low1[2] + c.rock1[2]) / 2);
      const proxyR = this.radius - (p.hasOcean ? p.seaDepth * 0.9 : p.landHeight * 2 + p.craterCount * 2 + 200);
      this.proxy = new THREE.Mesh(new THREE.SphereGeometry(proxyR, 96, 48), new THREE.MeshStandardMaterial({ color: avg, roughness: 1 }));
      this.proxy.material.envMapIntensity = 0;
      this.root.add(this.proxy);
    } else {
      this.buildGasGiant();
      this.maxTerrain = 0;
    }
    this.ringSpec = opts.rings || null;
    if (opts.rings) this.buildRings(opts.rings);

    // atmosphere parameters (consumed by AtmospherePass)
    const a = p.atmosphere;
    this.atmo = a
      ? {
          top: 1 + a.height / this.radius,
          // steep density falloff: a slim limb from orbit, a deep sky from the ground. Rayleigh is
          // per planet radius, so it is thinned as the shell deepens (same column straight up, more
          // haze along the ground); Mie is thinned to about its old column too, or the haze goes teal
          scatter: new THREE.Vector3(...a.scatter).multiplyScalar(a.density * (this.isGas ? 0.1 : 0.315)),
          falloff: this.isGas ? 1.6 : 4.0,
          mie: (this.isGas ? 0.035 : 0.05) * a.density,
        }
      : null;
    this.ocean = !!p.hasOcean;
    this.waterShallow = new THREE.Vector3(...(p.water?.shallow || [0, 0, 0]));
    this.waterDeep = new THREE.Vector3(...(p.water?.deep || [0, 0, 0]));
    this.waterEmissive = p.water?.emissive || 0;
    this.clouds = p.clouds || 0;
    this.cloudColor = new THREE.Vector3(1, 1, 1);
    if (p.type === 'toxic') this.cloudColor.set(0.85, 1.0, 0.55);
    if (p.type === 'volcanic') this.cloudColor.set(0.45, 0.4, 0.38);
    if (p.type === 'desert') this.cloudColor.set(1.0, 0.92, 0.82);
    if (p.type === 'alien') this.cloudColor.set(1.0, 0.85, 1.0);
    if (p.type === 'inferno') this.cloudColor.set(1.0, 0.62, 0.32);
    if (p.type === 'storm') this.cloudColor.set(0.42, 0.45, 0.52);
    if (p.type === 'corrosive') this.cloudColor.set(0.86, 0.95, 0.42);
    if (p.type === 'crushing') this.cloudColor.set(0.5, 0.42, 0.72);
    if (p.type === 'irradiated') this.cloudColor.set(0.85, 0.95, 0.6);
    if (p.type === 'dead') this.cloudColor.set(0.8, 0.75, 0.68);
    // a low, fairly thin deck that stays well inside the atmosphere
    const airH = a ? a.height : 3000;
    this.cloudBase = 1 + Math.min(1500, airH * 0.3) / this.radius;
    this.cloudTop = 1 + Math.min(3200, airH * 0.62) / this.radius;
    this.cloudSeed = (p.seed % 1000) * 0.137;
  }

  buildGasGiant() {
    const p = this.params;
    this.gasMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uColA: { value: new THREE.Color(p.gasColors[0]) },
        uColB: { value: new THREE.Color(p.gasColors[1]) },
        uColC: { value: new THREE.Color(p.gasColors[2]) },
        uSeed: { value: p.seed % 100 },
        uTime: { value: 0 },
        uSunColor: { value: new THREE.Vector3(3, 3, 3) },
        uSunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
        uRing: { value: new THREE.Vector3(0, 0, 0) }, // inner, outer (planet radii), seed
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        varying vec3 vWorldNormal;
        varying vec3 vViewDir;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vLocal = normalize(position);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uColA;
        uniform vec3 uColB;
        uniform vec3 uColC;
        uniform float uSeed;
        uniform float uTime;
        uniform vec3 uSunColor;
        uniform vec3 uSunDirLocal;
        uniform vec3 uRing;
        varying vec3 vLocal;
        varying vec3 vWorldNormal;
        varying vec3 vViewDir;
        #include <logdepthbuf_pars_fragment>
        ${SIMPLEX3}
        ${RING_GLSL}
        void main() {
          #include <logdepthbuf_fragment>
          vec3 p = vLocal;
          float lat = p.y;
          // flowing, domain-warped bands
          vec3 q = p * vec3(2.0, 9.0, 2.0) + uSeed;
          vec3 warp = vec3(fbm3(q + vec3(uTime * 0.004, 0.0, 0.0)), fbm3(q + 5.2), fbm3(q - 3.1));
          float turb = fbm5(p * vec3(3.0, 14.0, 3.0) + warp * 1.2 + uSeed + vec3(uTime * 0.002, 0.0, 0.0));
          float bands = sin(lat * 26.0 + turb * 3.0 + sin(lat * 7.0) * 1.6);
          float bands2 = sin(lat * 63.0 + turb * 5.0);
          vec3 c = mix(uColA, uColB, smoothstep(-0.7, 0.7, bands));
          c = mix(c, uColC, smoothstep(0.55, 1.0, bands2) * 0.45);
          // finest streaks fade out once a pixel covers them, instead of aliasing
          float px = length(fwidth(p));
          c *= 0.9 + 0.2 * fbm3(p * 40.0 + warp * 3.0) * (1.0 - smoothstep(0.004, 0.012, px));
          // storm vortices
          for (int k = 0; k < 4; k++) {
            float fk = float(k);
            vec3 sp = normalize(vec3(sin(uSeed + fk * 2.1), (fract(uSeed * 0.37 + fk * 0.29) - 0.5) * 1.2, cos(uSeed + fk * 2.1)));
            vec3 dp = (p - sp) * vec3(1.0, 2.0, 1.0);
            float sd = length(dp);
            float r = 0.05 + 0.06 * fract(fk * 0.61 + uSeed);
            float ang = atan(dp.z, dp.x) + sd * 40.0 - uTime * 0.05;
            float swirl = 0.5 + 0.5 * sin(ang * 3.0);
            float m = smoothstep(r, r * 0.3, sd + fbm3(p * 30.0) * 0.02);
            c = mix(c, mix(uColC, uColA, swirl) * 1.15, m * 0.85);
          }
          vec3 n = normalize(vWorldNormal);
          float NdL = dot(n, uSunDir);
          float diff = smoothstep(-0.08, 0.6, NdL);
          c = mix(c * vec3(1.0, 0.8, 0.7), c, smoothstep(0.0, 0.3, NdL));
          // limb darkening: the deep cloud deck shows face-on, haze dims the edges
          float mu = max(dot(n, normalize(vViewDir)), 0.0);
          c *= mix(0.45, 1.0, pow(mu, 0.45));
          // shadow of the rings across the cloud tops
          float shade = 1.0;
          if (uRing.y > 0.0 && abs(uSunDirLocal.y) > 1e-3) {
            float t = -p.y / uSunDirLocal.y;
            if (t > 0.0) {
              float r = length((p + uSunDirLocal * t).xz);
              float u = (r - uRing.x) / (uRing.y - uRing.x);
              if (u > 0.0 && u < 1.0) shade = 1.0 - ringDensity(u, uRing.z, 0.01) * 0.85;
            }
          }
          gl_FragColor = vec4(c * diff * shade * uSunColor * 0.32, 1.0);
        }`,
    });
    this.gasMesh = new THREE.Mesh(new THREE.SphereGeometry(this.radius, 128, 64), this.gasMat);
    this.root.add(this.gasMesh);
  }

  buildRings(r) {
    const inner = this.radius * r.inner;
    const outer = this.radius * r.outer;
    const geo = new THREE.RingGeometry(inner, outer, 256, 4);
    // reproject uvs so u = radial 0..1
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (d - inner) / (outer - inner), 0);
    }
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
        uColor: { value: new THREE.Color(r.color) },
        uSeed: { value: r.seed },
        uPlanetR: { value: this.radius },
        uSunColor: { value: new THREE.Vector3(3, 3, 3) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vPos;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDirLocal;
        uniform vec3 uColor;
        uniform float uSeed;
        uniform float uPlanetR;
        uniform vec3 uSunColor;
        varying vec2 vUv;
        varying vec3 vPos;
        #include <logdepthbuf_pars_fragment>
        ${RING_GLSL}
        void main() {
          #include <logdepthbuf_fragment>
          float u = vUv.x;
          float fw = fwidth(u);
          float a = ringDensity(u, uSeed, fw);
          // planet shadow on ring (ring is in the planet's xz plane after rotation)
          vec3 p = vec3(vPos.x, 0.0, -vPos.y);
          float b = dot(p, uSunDirLocal);
          float shadow = 1.0;
          if (b < 0.0) {
            float closest = length(p - uSunDirLocal * b);
            shadow = smoothstep(uPlanetR * 0.97, uPlanetR * 1.02, closest);
          }
          vec3 c = uColor * (0.7 + 0.3 * mix(ringN(u * 220.0, uSeed + 7.0), 0.5, smoothstep(0.001, 0.005, fw))) * (0.08 + shadow) * uSunColor * 0.3;
          gl_FragColor = vec4(c * a, a);
        }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    if (this.gasMat) this.gasMat.uniforms.uRing.value.set(r.inner, r.outer, r.seed);
    this.rings = new THREE.Mesh(geo, this.ringMat);
    this.rings.rotation.x = -Math.PI / 2;
    this.rings.renderOrder = 2;
    this.root.add(this.rings);
  }

  // height above sea level for a planet-local unit direction
  heightAt(dir) {
    if (!this.sampler) return 0;
    return this.sampler.height(dir.x, dir.y, dir.z);
  }

  // Surface radius (incl. ocean floor) at a planet-local direction
  surfaceRadius(dir) {
    return this.radius + this.heightAt(dir);
  }

  // Ground or sea level, whichever is higher (what ships hover over)
  groundRadius(dir) {
    const h = this.heightAt(dir);
    return this.radius + (this.ocean ? Math.max(h, 0) : h);
  }

  updateRender(camWorld, camera, sun, isCurrent, time) {
    this.syncRoot(camWorld);
    const sunDirWorld = _v.copy(sun.position).sub(this.position).normalize();
    if (this.material) {
      const u = this.material.userData.uniforms;
      u.uSunDirView.value.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
      if (this.treeMat) {
        this.treeMat.uniforms.uSunDirView.value.copy(u.uSunDirView.value);
        this.treeMat.uniforms.uCenterView.value.copy(this.root.position).applyMatrix4(camera.matrixWorldInverse);
      }
      u.uAmbientScale.value = isCurrent ? 1.0 : 0.05;
      // seen from elsewhere a body has a night side: no all-round fill from the environment map
      this.material.envMapIntensity = isCurrent ? 1.0 : 0.04;
      this.root.updateMatrixWorld();
      u.uPlanetInv.value.copy(this.root.matrixWorld).invert();
      // terrain LOD around the camera, in planet-local coordinates
      this.worldToLocal(camWorld, _camLocal);
      this.terrain.update(_camLocal);
    }
    if (this.gasMat) {
      this.gasMat.uniforms.uSunDir.value.copy(sunDirWorld);
      this.gasMat.uniforms.uSunDirLocal.value.copy(sunDirWorld).applyQuaternion(this.quaternionInv);
      this.gasMat.uniforms.uTime.value = time;
    }
    if (this.ringMat) {
      this.ringMat.uniforms.uSunDirLocal.value.copy(sunDirWorld).applyQuaternion(this.quaternionInv);
    }
  }
}

const _camLocal = new THREE.Vector3();
