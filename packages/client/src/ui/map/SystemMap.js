// The star system as a 3D orrery: the star, every planet and moon as a small lit globe in its own
// colours, orbits drawn as fading trails, the asteroid belt, the station, the player and the
// navigation target. Distances are compressed (outer orbits would otherwise be specks) but the
// order, the orbit planes and where everything is right now are true.
import * as THREE from 'three';
import { fmtDist } from '../HUD.js';
import { mapNoiseGLSL, glowTexture, starfieldPoints } from './mapCommon.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

const planetVert = /* glsl */ `
  varying vec3 vObjN;
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vObjN = normalize(position);
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const planetFrag = /* glsl */ `
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uRock;
  uniform vec3 uSea;
  uniform vec3 uIce;
  uniform vec3 uAtmo;
  uniform float uSeaLevel;
  uniform float uGas;
  uniform float uSeed;
  uniform vec3 uSunPos;
  uniform float uHighlight;
  varying vec3 vObjN;
  varying vec3 vN;
  varying vec3 vWorld;
  ${mapNoiseGLSL}
  void main() {
    vec3 n = normalize(vN);
    vec3 L = normalize(uSunPos - vWorld);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 p = vObjN * 2.2 + uSeed;
    vec3 col;
    if (uGas > 0.5) {
      float w = fbm(p * vec3(1.0, 6.0, 1.0)) * 1.4;
      float b = sin(vObjN.y * 13.0 + w * 3.0 + uSeed) * 0.5 + 0.5;
      float b2 = sin(vObjN.y * 31.0 + w * 5.0) * 0.5 + 0.5;
      col = mix(uLow, uHigh, b);
      col = mix(col, uRock, b2 * 0.35);
    } else {
      float h = fbm(p) + 0.5 * fbm(p * 2.7 + 3.1);
      float lat = abs(vObjN.y);
      col = mix(uLow, uHigh, smoothstep(-0.1, 0.5, fbm(p * 1.7 + 7.0)));
      col = mix(col, uRock, smoothstep(0.35, 0.75, h));
      col = mix(col, uSea, step(h, uSeaLevel) * (1.0 - step(uSeaLevel, -1.0)));
      col = mix(col, uIce, smoothstep(0.78, 0.92, lat + h * 0.1));
    }
    float ndl = dot(n, L);
    float lit = smoothstep(-0.12, 0.35, ndl);
    vec3 c = col * (0.035 + lit * 1.15);
    // atmosphere: a rim lit on the day side, a thin line round the night side
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    c += uAtmo * fres * (smoothstep(-0.3, 0.4, ndl) * 1.6 + 0.1);
    c += vec3(0.6, 0.7, 1.0) * fres * uHighlight * 0.6;
    gl_FragColor = vec4(c, 1.0);
  }`;

const starFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec3 vObjN;
  varying vec3 vN;
  varying vec3 vWorld;
  ${mapNoiseGLSL}
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float mu = max(dot(normalize(vN), V), 0.0);
    float g = fbm(vObjN * 6.0 + vec3(uTime * 0.05));
    vec3 c = uColor * (0.75 + 0.5 * g) * mix(0.55, 1.0, pow(mu, 0.5));
    gl_FragColor = vec4(c * 2.6, 1.0);
  }`;

// orbit trails: brightest just behind the body, fading round the circle
const orbitVert = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const orbitFrag = /* glsl */ `
  uniform float uPhase;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vT;
  void main() {
    float d = fract(uPhase - vT);
    float a = 0.08 + 0.85 * pow(1.0 - d, 6.0);
    gl_FragColor = vec4(uColor * a * uAlpha, 1.0);
  }`;

function hexToVec(h) {
  const c = new THREE.Color(h);
  return new THREE.Vector3(c.r, c.g, c.b);
}
function arrToVec(a, k = 1) {
  return a ? new THREE.Vector3(a[0] * k, a[1] * k, a[2] * k) : new THREE.Vector3(0.5, 0.5, 0.5);
}

export class SystemMap {
  constructor(view) {
    this.view = view;
    this.game = view.game;
    this.minDistance = 3;
    this.maxDistance = 520;
    this.bloom = 0.9;
  }

  // compressed orbit radius (map units)
  orbitR(r) {
    return Math.pow(r / 1e6, 0.6) * 4.2;
  }

  bodySize(p) {
    if (p.kind === 'star') return 2.4;
    if (p.kind === 'moon') return 0.32 + Math.pow(p.radius / 6e4, 0.5) * 0.16;
    const s = 0.52 * Math.pow(p.radius / 3e4, 0.5);
    return p.isGas ? s * 1.25 : s;
  }

  build() {
    const g = this.game;
    const sys = g.system;
    if (this.builtFor === sys) return;
    this.dispose();
    this.builtFor = sys;
    const scene = (this.scene = new THREE.Scene());
    scene.background = g.engine.scene.background;
    scene.backgroundIntensity = 0.45;
    this.items = [];
    this.mats = [];

    // star
    const star = sys.star;
    const starCol = new THREE.Color(star.color);
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: starCol }, uTime: { value: 0 } },
      vertexShader: planetVert,
      fragmentShader: starFrag,
    });
    const starMesh = new THREE.Mesh(new THREE.SphereGeometry(2.4, 64, 32), this.starMat);
    scene.add(starMesh);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: starCol, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(13);
    glow.material.opacity = 0.55;
    scene.add(glow);
    const light = new THREE.PointLight(0xffffff, 0);
    scene.add(light);
    this.items.push({
      kind: 'star',
      name: sys.name,
      body: star,
      position: new THREE.Vector3(),
      pickRadius: 2.4,
      focusDistance: 22,
      label: sys.name,
      labelOffset: 34,
    });

    // ecliptic grid: rings and spokes, fading out
    scene.add(this.buildGrid());

    // belt
    if (sys.belt) scene.add(this.buildBelt(sys.belt));

    // planets and moons
    this.bodies = [];
    for (const p of sys.planets) {
      const size = this.bodySize(p);
      const mat = this.planetMaterial(p);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 48, 24), mat);
      scene.add(mesh);
      const rec = { p, mesh, mat, size };
      if (p.kind === 'planet') {
        rec.orbit = this.buildOrbit(this.orbitR(p.orbitRadius), p.orbitTilt);
        scene.add(rec.orbit);
        if (p.ringSpec) {
          const ring = this.buildRings(p, size);
          mesh.add(ring);
        }
      } else {
        rec.orbit = this.buildOrbit(1, p.orbitTilt, 0.6);
        scene.add(rec.orbit);
      }
      this.bodies.push(rec);
      const label = p.kind === 'moon' ? p.name.split(' ').slice(-1)[0] : p.name;
      rec.item = {
        kind: p.kind,
        name: p.name,
        body: p,
        position: new THREE.Vector3(),
        pickRadius: size * 1.4,
        focusDistance: p.kind === 'moon' ? 4 : 7 + size * 4,
        label: `${p.kind === 'moon' ? label : p.name}`,
        labelClass: p.kind === 'moon' ? 'minor' : '',
        labelVisible: (v) => p.kind !== 'moon' || v.camera.position.distanceTo(rec.item.position) < 40 || v.selected === rec.item,
      };
      this.items.push(rec.item);
    }

    // station: a small bright diamond beside its planet
    const stMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.9, 2.2) });
    this.stationMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), stMat);
    scene.add(this.stationMesh);
    this.stationItem = {
      kind: 'station',
      name: g.station.name,
      body: g.station,
      position: new THREE.Vector3(),
      pickRadius: 0.4,
      focusDistance: 4,
      label: g.station.name,
      labelClass: 'minor',
      labelVisible: (v) => v.camera.position.distanceTo(this.stationItem.position) < 60 || v.selected === this.stationItem,
    };
    this.items.push(this.stationItem);

    // you
    this.youMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.42, 3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 2.2, 1.9) }),
    );
    this.youRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.47, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.0, 1.8), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    scene.add(this.youMesh, this.youRing);
    this.youItem = { kind: 'you', name: 'You', position: new THREE.Vector3(), pickable: false, label: 'YOU', labelClass: 'you', labelOffset: 16 };
    this.items.push(this.youItem);

    // selection ring and the line to the waypoint
    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.06, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.4, 2.4), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    scene.add(this.selRing);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
    this.navLine = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xb2bcff, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.7 }));
    scene.add(this.navLine);

    scene.add(starfieldPoints(1600, 1500, 0.55));
  }

  planetMaterial(p) {
    const P = p.params;
    let u;
    if (p.isGas) {
      const pal = P.gasColors || [0xd8b890, 0xa0704a, 0xf0e0c0];
      u = { low: hexToVec(pal[0]), high: hexToVec(pal[2]), rock: hexToVec(pal[1]), sea: hexToVec(pal[1]), ice: hexToVec(pal[2]), seaLevel: -2, gas: 1 };
    } else {
      const c = P.colors || {};
      const ocean = P.hasOcean;
      u = {
        low: arrToVec(c.low1, 1.6),
        high: arrToVec(c.dry || c.high, 1.6),
        rock: arrToVec(c.rock1, 1.5),
        sea: arrToVec(P.water?.deep ? P.water.shallow : c.deep, 1.2),
        ice: arrToVec(c.snow, 1.1),
        seaLevel: ocean ? 0.05 : -2,
        gas: 0,
      };
    }
    const sc = p.atmo ? p.atmo.scatter.clone().normalize() : new THREE.Vector3(0, 0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uLow: { value: u.low },
        uHigh: { value: u.high },
        uRock: { value: u.rock },
        uSea: { value: u.sea },
        uIce: { value: u.ice },
        uAtmo: { value: sc.multiplyScalar(p.atmo ? 0.9 : 0) },
        uSeaLevel: { value: u.seaLevel },
        uGas: { value: u.gas },
        uSeed: { value: (P.seed % 1000) * 0.13 },
        uSunPos: { value: new THREE.Vector3() },
        uHighlight: { value: 0 },
      },
      vertexShader: planetVert,
      fragmentShader: planetFrag,
    });
    this.mats.push(mat);
    return mat;
  }

  buildRings(p, size) {
    const r = p.ringSpec;
    const geo = new THREE.RingGeometry(size * r.inner, size * r.outer, 128, 1);
    const col = new THREE.Color(r.color);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: col }, uIn: { value: size * r.inner }, uOut: { value: size * r.outer }, uSeed: { value: r.seed } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uIn; uniform float uOut; uniform float uSeed; varying vec3 vP;
        void main(){ float t = (length(vP.xy) - uIn) / (uOut - uIn);
          float b = 0.55 + 0.45 * sin(t * 60.0 + uSeed) * sin(t * 23.0 + uSeed * 1.7);
          float a = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.85, t) * b;
          gl_FragColor = vec4(uColor * a * 0.9, a * 0.8); }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2 + 0.35;
    return ring;
  }

  buildOrbit(radius, tilt, alpha = 1) {
    const N = 256;
    const pos = new Float32Array((N + 1) * 3);
    const t = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * radius;
      pos[i * 3 + 2] = Math.sin(a) * radius;
      t[i] = i / N;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPhase: { value: 0 }, uColor: { value: new THREE.Color(0.72, 0.78, 1.0) }, uAlpha: { value: alpha } },
      vertexShader: orbitVert,
      fragmentShader: orbitFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, mat);
    line.quaternion.copy(tilt);
    return line;
  }

  buildGrid() {
    const pts = [];
    for (let r = 10; r <= 90; r += 10) {
      for (let i = 0; i < 128; i++) {
        const a0 = (i / 128) * Math.PI * 2;
        const a1 = ((i + 1) / 128) * Math.PI * 2;
        pts.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      }
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(Math.cos(a) * 4, 0, Math.sin(a) * 4, Math.cos(a) * 90, 0, Math.sin(a) * 90);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){ float r = length(vP.xz); float a = 0.07 * (1.0 - smoothstep(30.0, 90.0, r)); gl_FragColor = vec4(vec3(0.6,0.68,1.0) * a, 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.LineSegments(geo, mat);
  }

  buildBelt(belt) {
    const N = 5000;
    const pos = new Float32Array(N * 3);
    const r0 = this.orbitR(belt.radius - belt.width / 2);
    const r1 = this.orbitR(belt.radius + belt.width / 2);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = r0 + (r1 - r0) * (0.5 + (Math.random() + Math.random() - 1) * 0.5);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 0.35;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(0.75, 0.65, 0.55), size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false }));
  }

  // where a body sits on the map right now
  mapPosition(p, out) {
    const star = this.game.system.star;
    if (p.kind === 'moon') {
      const parent = this.bodies.find((b) => b.p === p.parent);
      _v.copy(p.position).sub(p.parent.position).applyQuaternion(_q.copy(p.orbitTilt).invert());
      const a = Math.atan2(_v.z, _v.x);
      const r = parent.size * (2.4 + p.index * 1.1);
      out.set(Math.cos(a) * r, 0, Math.sin(a) * r).applyQuaternion(p.orbitTilt).add(this.mapPosition(p.parent, new THREE.Vector3()));
      return { out, a, r };
    }
    _v.copy(p.position).sub(star.position).applyQuaternion(_q.copy(p.orbitTilt).invert());
    const a = Math.atan2(_v.z, _v.x);
    const r = this.orbitR(p.orbitRadius);
    out.set(Math.cos(a) * r, 0, Math.sin(a) * r).applyQuaternion(p.orbitTilt);
    return { out, a, r };
  }

  // anywhere else (the player, the station): next to the body whose space it is in, else by radius
  mapPoint(world, out) {
    const sys = this.game.system;
    let near = null;
    let nd = Infinity;
    for (const b of this.bodies) {
      const d = b.p.position.distanceTo(world);
      if (d < b.p.radius * 6 && d < nd) {
        near = b;
        nd = d;
      }
    }
    if (near) {
      const dir = _v.copy(world).sub(near.p.position);
      const len = dir.length();
      dir.normalize();
      const k = near.size * (1.0 + 0.35 * Math.min(4, len / near.p.radius));
      return out.copy(near.item.position).addScaledVector(dir, Math.max(near.size * 1.25, k));
    }
    _v.copy(world).sub(sys.star.position);
    const r = Math.hypot(_v.x, _v.z);
    // (out past the planets, and far out between the stars, held at the map's rim)
    const s = Math.min(this.orbitR(r), this.orbitR(sys.outerOrbit) * 1.35) / Math.max(Math.hypot(r, _v.y), 1);
    return out.set(_v.x * s, _v.y * s, _v.z * s);
  }

  update(dt, time) {
    const g = this.game;
    this.starMat.uniforms.uTime.value = time;
    for (const b of this.bodies) {
      const { a } = this.mapPosition(b.p, b.item.position);
      b.mesh.position.copy(b.item.position);
      b.mesh.rotation.y += dt * 0.08;
      b.orbit.material.uniforms.uPhase.value = a / (Math.PI * 2);
      if (b.p.kind === 'moon') {
        const parent = this.bodies.find((x) => x.p === b.p.parent);
        b.orbit.position.copy(parent.item.position);
        const r = parent.size * (2.4 + b.p.index * 1.1);
        b.orbit.scale.setScalar(r);
      }
      b.mat.uniforms.uHighlight.value = this.view.hovered === b.item || this.view.selected === b.item ? 1 : 0;
    }
    this.mapPoint(g.station.position, this.stationItem.position);
    this.stationMesh.position.copy(this.stationItem.position);
    this.stationMesh.rotation.y += dt;
    this.mapPoint(g.camWorld, this.youItem.position);
    this.youMesh.position.copy(this.youItem.position);
    this.youMesh.rotation.y += dt * 1.5;
    this.youRing.position.copy(this.youItem.position);
    this.youRing.quaternion.copy(this.view.camera.quaternion);
    const pulse = (time * 0.6) % 1;
    this.youRing.scale.setScalar(1 + pulse * 2.2);
    this.youRing.material.opacity = (1 - pulse) * 0.9;

    const sel = this.view.selected;
    this.selRing.visible = !!sel && sel.kind !== 'you';
    if (sel) {
      const r = Math.max(0.5, (sel.pickRadius || 1) * 1.15);
      this.selRing.position.copy(sel.position);
      this.selRing.quaternion.copy(this.view.camera.quaternion);
      this.selRing.scale.setScalar(r * (1 + 0.04 * Math.sin(time * 3)));
    }
    const navItem = this.items.find((it) => it.body && it.body === g.navTarget);
    this.navLine.visible = !!navItem;
    if (navItem) {
      const pos = this.navLine.geometry.attributes.position;
      pos.setXYZ(0, this.youItem.position.x, this.youItem.position.y, this.youItem.position.z);
      pos.setXYZ(1, navItem.position.x, navItem.position.y, navItem.position.z);
      pos.needsUpdate = true;
      this.navLine.computeLineDistances();
      this.navLine.material.dashOffset = -time * 1.2;
    }
    for (const m of this.mats) m.uniforms.uSunPos.value.set(0, 0, 0);
  }

  defaultView() {
    const target = new THREE.Vector3();
    this.update(0, 0);
    // frame the system from above and to the side, the player near the middle
    return { target, position: new THREE.Vector3(18, 46, 72) };
  }

  initialSelection() {
    const g = this.game;
    return this.items.find((it) => it.body && it.body === g.navTarget) || null;
  }

  // details for the info card
  describe(it) {
    const g = this.game;
    if (!it) return null;
    const dist = it.body ? it.body.distanceTo?.(g.camWorld) : 0;
    if (it.kind === 'star') {
      const sys = g.system;
      return { title: sys.name, kind: `Class ${sys.starClass.cls} star`, stats: [['Planets', String(sys.planets.filter((p) => p.kind === 'planet').length)], ['Distance', fmtDist(dist)]] };
    }
    if (it.kind === 'station') {
      return { title: it.name, kind: 'Space station', stats: [['Distance', fmtDist(dist)]], waypoint: true };
    }
    const p = it.body;
    const P = p.params;
    const stats = [
      ['Distance', fmtDist(dist)],
      ['Gravity', `${(p.gravity / 9.81).toFixed(2)} g`],
    ];
    if (P.hazard) stats.push(['Hazard', P.hazard.label]);
    if (P.cityCount) stats.push(['Cities', String(P.cityCount)]);
    return { title: p.name, kind: `${P.label}${p.kind === 'moon' ? ' moon' : ''}`, stats, waypoint: p.landable || p.kind !== 'moon' };
  }

  dispose() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material && o.material !== this.scene.background) o.material.dispose?.();
    });
    this.scene = null;
  }
}
