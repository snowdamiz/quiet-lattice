// Player starship: model, arcade flight model with flight assist, auto landing /
// takeoff, pulse drive, docking autopilot and a smoothed chase camera.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FrameState } from '../universe/Body.js';
import { applyPanelDetail } from '../render/panelMaterial.js';
import { Cockpit, EYE } from './Cockpit.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
// seconds the pulse drive takes to cover the open space ahead of it, at full speed
const CRUISE_T = 40;

export const GEAR_HEIGHT = 1.95;
// where the landed hull comes down within reach of a walker, in ship space (x0, x1, z0, z1): the
// fuselage, and the engine pods with the wings over them
const FOOTPRINT = [
  [-1.6, 1.6, -6.8, 1.0],
  [-6.6, 6.6, 0.6, 6.6],
];

export class Ship {
  constructor(game) {
    this.game = game;
    this.state = new FrameState();
    this.group = new THREE.Group();
    this.group.name = 'ship';
    this.mode = 'flying'; // flying | landing | landed | takeoff | docking | pulse
    // throttle 0..1 (a touch below in space: reverse); speed is along the nose
    this.throttle = 0;
    this._speed = 0;
    this.hover = 0;
    this.angVel = new THREE.Vector3();
    this.gear = 1;
    this.boosting = false;
    this.thrust = 0;
    this.shield = 100;
    // the hull takes what the shield cannot (hostile skies); at zero the ship is lost
    this.hull = 100;
    // how many times longer the hull holds out against each kind of hostile sky (upgrades)
    this.resist = { heat: 1, cryo: 1, pressure: 1, acid: 1, radiation: 1, storm: 1 };
    this.hazardLevel = 0;
    this.wind = new THREE.Vector3();
    this.pulseFuel = 100;
    this.launchFuel = 100;
    this.pulse = { spool: 0, speed: 0, active: false };
    this.altitude = Infinity;
    this.seaAltitude = Infinity;
    this.atmoDensity = 0;
    this.camState = new FrameState();
    // high and well back so the ship sits in the lower third and the view stays on the world
    this.camOffset = new THREE.Vector3(0, 5.6, 23);
    this.camDistance = 1;
    this.camSwing = new THREE.Vector3();
    this.camTime = 0;
    this.shake = 0;
    this.lasers = [];
    this.laserCooldown = 0;
    this.landTarget = null;
    this.dockPad = null;
    this.engineGlows = [];
    this.flames = [];
    this.gearNodes = [];
    this.visible = true;
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync('/models/ship.glb');
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const m = o.material;
        if (m.name === 'Hull' || m.name === 'Accent' || m.name === 'Trim' || m.name === 'Dark' || m.name === 'Interior') {
          applyPanelDetail(m, { scale: 0.55 });
          m.envMapIntensity = 0.45;
          if (m.name === 'Hull') m.color.multiplyScalar(0.78);
          // satin rather than polished: sharp sun glints on big metal plates bloom into white blobs
          m.roughness = Math.max(m.roughness, m.name === 'Trim' ? 0.48 : 0.5);
          m.metalness = Math.min(m.metalness, 0.75);
        }
        if (m.name === 'EngineGlow') {
          // dark nozzle throat; the heat glow comes from emissive only
          m.color.setRGB(0.02, 0.025, 0.03);
          m.roughness = 0.55;
          m.emissiveIntensity = 0.2;
          this.engineGlows.push(o);
        }
        if (m.name === 'VentGlow' || m.name === 'SensorGlow') m.emissiveIntensity = m.name === 'VentGlow' ? 1.2 : 1.6;
        if (m.name.startsWith('Nav')) {
          m.emissiveIntensity = 3;
          if (m.name === 'NavWhite') this.strobe = m;
        }
        if (m.name === 'Glass') {
          m.envMapIntensity = 1.0;
          m.roughness = Math.max(m.roughness, 0.14);
        }
      }
      if (/^Gear(Front|Left|Right)$/.test(o.name)) this.gearNodes.push(o);
    });
    // re-entry heating: the faces leading into the airflow glow orange-hot
    this.heatU = { uHeatDir: { value: new THREE.Vector3(0, 0, -1) }, uHeatPower: { value: 0 } };
    const heated = new Set();
    model.traverse((o) => {
      if (!o.isMesh || heated.has(o.material) || !/^(Hull|Accent|Trim|Dark|Glass)$/.test(o.material.name)) return;
      heated.add(o.material);
      applyHeat(o.material, this.heatU);
    });
    this.model = model;
    this.group.add(model);
    this.cockpit = new Cockpit(this);
    this.group.add(this.cockpit.group);
    this.canopyParts = [];
    model.traverse((o) => {
      if (o.isMesh && (o.material.name === 'Glass' || o.name.startsWith('CanopyFrame'))) this.canopyParts.push(o);
    });
    // seen from the seat the canopy is a faint, reflective shell rather than tinted glass
    this.innerGlass = new THREE.MeshPhysicalMaterial({
      color: 0xbfd8ff,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.07,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // exhaust: a trail of additive billboards per engine (reads well from any angle)
    const flameTex = flameTexture();
    this.group.updateMatrixWorld(true);
    for (const g of this.engineGlows) {
      // engine position (centre of the glow mesh, whatever its origin) in the ship group's local space
      g.geometry.computeBoundingSphere();
      const wp = g.localToWorld(g.geometry.boundingSphere.center.clone());
      this.group.worldToLocal(wp);
      const r = g.geometry.boundingSphere.radius;
      const trail = [];
      for (let i = 0; i < 8; i++) {
        const mat = new THREE.SpriteMaterial({ map: flameTex, color: 0x66bbff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        const sp = new THREE.Sprite(mat);
        sp.frustumCulled = false;
        this.group.add(sp);
        trail.push(sp);
      }
      this.flames.push({ base: wp.clone(), r, trail });
    }

    this.buildThrusters(model, flameTex);

    // re-entry plasma: a bow-shock glow on whatever face leads into the air, drawn out into
    // flame streaks along the direction of travel
    this.reentryMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uVel: { value: new THREE.Vector3(0, 0, -1) }, uInside: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform vec3 uVel;
        uniform float uPower;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        varying float vLead;
        varying float vAlign;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vec3 dirP = normalize(position - vec3(0.0, 0.45, 1.2));
          float lead = dot(dirP, uVel);
          // the trailing half is swept back into a tail
          vec3 p = position - uVel * max(0.0, -lead) * (4.0 + 8.0 * uPower);
          vLead = lead;
          vP = p;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          // 1 when the camera looks along the flight path (chasing the ship down)
          vAlign = max(0.0, dot(normalize((modelViewMatrix * vec4(uVel, 0.0)).xyz), normalize(mv.xyz)));
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uPower;
        uniform vec3 uVel;
        uniform float uInside;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        varying float vLead;
        varying float vAlign;
        #include <logdepthbuf_pars_fragment>
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float vnoise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        void main() {
          #include <logdepthbuf_fragment>
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
          float along = dot(vP, uVel);
          vec3 b1 = normalize(cross(uVel, abs(uVel.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec2 perp = vec2(dot(vP, b1), dot(vP, cross(uVel, b1)));
          // streaks run along the flow and race backwards
          float streak = vnoise(vec3(perp * 1.1, along * 0.12 + uTime * 9.0));
          streak = smoothstep(0.35, 0.9, streak * 0.7 + vnoise(vec3(perp * 2.6, along * 0.3 + uTime * 17.0)) * 0.45);
          float flicker = 0.75 + 0.25 * vnoise(vP * 0.8 + uTime * 12.0);
          // the plasma sheath glows where it is seen edge-on: from the chase camera, looking along
          // the dive, that is a burning rim round the ship (filling the whole shell read as a
          // fireball on the ground below)
          float tongues = 0.45 + 0.9 * smoothstep(0.25, 0.75, vnoise(vec3(perp * 1.7, along * 0.25 + uTime * 14.0)));
          // (kept thin: a full bow glow read as peach cotton puffs stuck to the wings)
          float bow = smoothstep(-0.2, 0.8, vLead) * fres * flicker * tongues * 0.5;
          float cap = smoothstep(0.55, 1.0, vLead) * 0.1 * flicker;
          float tail = smoothstep(0.2, -0.6, vLead) * streak * (0.2 + fres);
          float edge = smoothstep(-0.99, -0.75, vLead);
          // chasing the ship down, the swept-back shell sits between it and the camera and filled
          // the screen like a dome: keep it faint there and let the streaks carry the effect
          // from the seat the sheath is all round the canopy: its rim reads as flames licking past
          // the edges of the view while the middle stays clear to fly by
          float a = (bow + cap + tail * edge) * uPower * mix(1.0 - 0.8 * smoothstep(0.5, 0.95, vAlign), 0.7, uInside);
          vec3 hot = vec3(1.0, 0.72, 0.4);
          vec3 warm = vec3(1.0, 0.3, 0.06);
          vec3 c = mix(warm, hot, smoothstep(0.2, 0.9, vLead) * (0.5 + 0.5 * fres));
          gl_FragColor = vec4(c * a * 2.0, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const shell = new THREE.SphereGeometry(1, 32, 16);
    shell.scale(5.6, 2.7, 8.4);
    shell.translate(0, 0.45, 1.2);
    this.reentry = new THREE.Mesh(shell, this.reentryMat);
    this.reentry.frustumCulled = false;
    this.reentry.visible = false;
    this.group.add(this.reentry);
    // flame streaks peeling off round the hull and racing back past the camera; all motion is
    // in the vertex shader (per-streak random phase, angle and length), billboarded about the flow
    const STREAKS = 110;
    const sg = new THREE.InstancedBufferGeometry();
    sg.copy(new THREE.PlaneGeometry(1, 1));
    const rnd = new Float32Array(STREAKS * 4);
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
    sg.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
    sg.instanceCount = STREAKS;
    const ru = this.reentryMat.uniforms;
    this.reentryStreaks = new THREE.Mesh(
      sg,
      new THREE.ShaderMaterial({
        uniforms: { uTime: ru.uTime, uPower: ru.uPower, uVel: ru.uVel },
        vertexShader: /* glsl */ `
          attribute vec4 aRand;
          uniform float uTime;
          uniform float uPower;
          uniform vec3 uVel;
          varying float vA;
          varying vec2 vQ;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main() {
            vec3 v = uVel;
            vec3 b1 = normalize(cross(v, abs(v.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
            vec3 b2 = cross(v, b1);
            // 0 at the bow shock, 1 far behind the ship
            float s = fract(uTime * (1.3 + aRand.x * 0.9) + aRand.x * 7.0);
            float ang = aRand.y * 6.2831853;
            vec2 ell = vec2(cos(ang) * 4.6, sin(ang) * 2.0) * (0.75 + 0.35 * aRand.z) * (1.0 + s * 0.5);
            // they stay well ahead of the chase camera: streaks passing it read as warp lines
            vec3 center = vec3(0.0, 0.45, 1.2) + v * (5.5 - s * 16.0) + b1 * ell.x + b2 * ell.y;
            float len = (2.5 + 5.0 * aRand.w) * (0.5 + uPower);
            // (thin: wide ones read as cotton puffs stuck to the wings)
            float w = (0.35 + 0.5 * aRand.z) * (0.6 + 0.6 * uPower);
            vec4 cv = modelViewMatrix * vec4(center, 1.0);
            vec3 vv = normalize((modelViewMatrix * vec4(v, 0.0)).xyz);
            vec3 side = normalize(cross(vv, -cv.xyz));
            vec3 pv = cv.xyz - vv * ((uv.y) * len) + side * ((uv.x - 0.5) * w);
            vA = (1.0 - s) * smoothstep(0.0, 0.12, s) * smoothstep(0.15, 0.6, uPower) * (0.5 + 0.5 * aRand.w);
            vQ = uv;
            gl_Position = projectionMatrix * vec4(pv, 1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying vec2 vQ;
          #include <logdepthbuf_pars_fragment>
          void main() {
            #include <logdepthbuf_fragment>
            // clamped: with MSAA the varyings are extrapolated past the quad's edges, and a pow() of
            // a negative number there gives NaN, which shows as black dotted lines
            float across = clamp(1.0 - abs(vQ.x - 0.5) * 2.0, 0.0, 1.0);
            float along = clamp(vQ.y, 0.0, 1.0);
            float a = vA * across * sqrt(across) * (1.0 - along) * smoothstep(0.0, 0.08, along);
            vec3 c = mix(vec3(1.0, 0.16, 0.03), vec3(1.0, 0.52, 0.16), (1.0 - along) * across);
            gl_FragColor = vec4(c * a * 4.5, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.reentryStreaks.frustumCulled = false;
    this.reentryStreaks.visible = false;
    this.group.add(this.reentryStreaks);

    // soft contact shadow under the hull near the ground: with a low sun the real shadow falls
    // well to one side and the ship seemed to hover above its feet
    this.contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main() {
            vP = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          varying vec2 vP;
          #include <logdepthbuf_pars_fragment>
          void main() {
            #include <logdepthbuf_fragment>
            float r = length(vP);
            gl_FragColor = vec4(0.0, 0.0, 0.0, uAlpha * 0.5 * (1.0 - smoothstep(0.15, 1.0, r)));
          }`,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    );
    this.contactShadow.scale.set(6.2, 8.0, 1);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.set(0, -GEAR_HEIGHT + 0.12, 0.6);
    this.contactShadow.visible = false;
    this.group.add(this.contactShadow);

    // downwash: hovering low, the VTOL jets blast the ground below into rings of dust and spray
    this.downwash = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.8, 0.76, 0.66) } },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main() {
            vP = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          uniform float uTime;
          uniform vec3 uColor;
          varying vec2 vP;
          #include <logdepthbuf_pars_fragment>
          float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
          void main() {
            #include <logdepthbuf_fragment>
            float r = length(vP);
            float a = atan(vP.y, vP.x);
            // streaks racing outward, broken up round the circle
            float sector = floor((a + 3.14159) / 6.28318 * 48.0);
            float speed = 0.6 + h(sector) * 0.8;
            float wave = fract(r * 2.2 - uTime * speed + h(sector + 7.0));
            float streak = smoothstep(0.0, 0.25, wave) * (1.0 - smoothstep(0.35, 1.0, wave));
            float ring = smoothstep(0.08, 0.3, r) * (1.0 - smoothstep(0.55, 1.0, r));
            gl_FragColor = vec4(uColor, uAlpha * ring * (0.25 + 0.75 * streak) * 0.55);
          }`,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
      }),
    );
    this.downwash.rotation.x = -Math.PI / 2;
    this.downwash.visible = false;
    this.group.add(this.downwash);

    // landing light
    this.landLight = new THREE.SpotLight(0xfff2dd, 0, 120, 0.6, 0.6, 1.2);
    this.landLight.position.set(0, -0.6, 2.5);
    this.landLight.target.position.set(0, -10, -6);
    this.group.add(this.landLight, this.landLight.target);
    // engine light
    this.engineLight = new THREE.PointLight(0x66bbff, 0, 25, 2);
    this.engineLight.position.set(0, 0.4, 9);
    this.group.add(this.engineLight);
  }

  get frame() {
    return this.state.frame;
  }

  // Manoeuvring thrusters round the hull: four VTOL jets under the fuselage and the engine pods that
  // carry the ship when it hovers, side jets for strafing and turning, retro jets in the nose and
  // dorsal jets to push it down. Each is a small nozzle with a hot throat and a plume that grows
  // with how hard it fires; in space they puff to trim drift and turn the ship.
  buildThrusters(model, flameTex) {
    let trim = null;
    model.traverse((o) => {
      if (o.isMesh && o.material.name === 'Trim') trim ||= o.material;
    });
    // [position, exhaust direction, bell radius, kind] in ship space (-z forward, +y up)
    const D = new THREE.Vector3(0, -1, 0);
    const U = new THREE.Vector3(0, 1, 0);
    const L = new THREE.Vector3(-1, 0, 0);
    const R = new THREE.Vector3(1, 0, 0);
    const F = new THREE.Vector3(0, 0, -1);
    const list = [
      [[-0.95, -1.02, -3.2], D, 0.3, 'vtol'],
      [[0.95, -1.02, -3.2], D, 0.3, 'vtol'],
      [[-2.75, -0.92, 2.2], D, 0.38, 'vtol'],
      [[2.75, -0.92, 2.2], D, 0.38, 'vtol'],
      [[-1.42, -0.15, -3.9], L, 0.14, 'rcs'],
      [[1.42, -0.15, -3.9], R, 0.14, 'rcs'],
      [[-6.15, 0.05, 2.6], L, 0.14, 'rcs'],
      [[6.15, 0.05, 2.6], R, 0.14, 'rcs'],
      [[-0.85, 0.2, -5.15], F, 0.12, 'rcs'],
      [[0.85, 0.2, -5.15], F, 0.12, 'rcs'],
      [[-1.05, 1.62, 2.6], U, 0.13, 'rcs'],
      [[1.05, 1.62, 2.6], U, 0.13, 'rcs'],
    ];
    const bell = (r) => {
      // a short bell, throat inside the hull, lip at the exhaust end (lathed about +y, exit at y = 0)
      const pts = [
        [r * 0.62, 0.42],
        [r * 0.7, 0.3],
        [r * 0.82, 0.16],
        [r * 1.0, 0.02],
        [r * 1.06, 0.0],
        [r * 0.96, 0.0],
        [r * 0.86, 0.1],
        [r * 0.55, 0.26],
        [r * 0.45, 0.38],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.LatheGeometry(pts, 20);
    };
    const throatGeo = new THREE.CircleGeometry(1, 20);
    // the plume: an open cone, unit long down -y from the nozzle's exit, that the shader fades
    // along its length and toward its silhouette
    const coneGeo = new THREE.CylinderGeometry(1.0, 1.9, 1, 20, 6, true).translate(0, -0.5, 0);
    this.plumeMats = { vtol: plumeMaterial(new THREE.Color(0.5, 0.78, 1.5)), rcs: plumeMaterial(new THREE.Color(0.9, 0.93, 1.0)) };
    // gunmetal like the trim, seen from inside the bell too
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f34, metalness: 0.8, roughness: 0.38, side: THREE.DoubleSide });
    this.thrusters = list.map(([p, dir, r, kind]) => {
      const g = new THREE.Group();
      g.position.fromArray(p);
      // the bell's axis (+y) points against the exhaust: it sits in the hull, opening outward
      g.quaternion.setFromUnitVectors(_v.set(0, -1, 0), dir);
      const nozzle = new THREE.Mesh(bell(r), nozzleMat);
      nozzle.castShadow = true;
      const throatMat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.6, emissive: new THREE.Color(0.35, 0.65, 1.0), emissiveIntensity: 0 });
      const throat = new THREE.Mesh(throatGeo, throatMat);
      throat.scale.setScalar(r * 0.5);
      throat.position.y = 0.36;
      throat.rotation.x = Math.PI / 2;
      const mat = this.plumeMats[kind].clone();
      const plume = new THREE.Mesh(coneGeo, mat);
      plume.frustumCulled = false;
      plume.visible = false;
      plume.renderOrder = 2;
      g.add(nozzle, throat, plume);
      // a hot spot at the exit
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      core.frustumCulled = false;
      core.visible = false;
      g.add(core);
      this.group.add(g);
      return { pos: new THREE.Vector3().fromArray(p), dir: dir.clone(), r, kind, throatMat, plume, core, out: 0, last: 0 };
    });
  }

  // the VTOL jets' blast on the ground (or the sea) straight below, when hovering low
  updateDownwash(dt) {
    const dw = this.downwash;
    const f = this.state.frame;
    const alt = this.altitude;
    const k = f?.sampler && isFinite(alt) ? (this.hoverOut || 0) * (1 - THREE.MathUtils.smoothstep(alt, 6, 32)) : 0;
    this.downwashK = THREE.MathUtils.damp(this.downwashK || 0, k, 4, dt);
    dw.visible = this.downwashK > 0.02 && !this.inCockpit;
    if (!dw.visible) return;
    const st = this.state;
    const up = _v4.copy(st.pos).normalize();
    const ground = _v6.copy(up).multiplyScalar(f.groundRadius(up) + 0.25);
    const inv = _q2.copy(st.quat).invert();
    dw.position.copy(ground).sub(st.pos).applyQuaternion(inv);
    dw.quaternion.setFromUnitVectors(_v.set(0, 0, 1), up.applyQuaternion(inv));
    const sz = 9 + Math.max(0, alt) * 0.7;
    dw.scale.set(sz, sz, 1);
    const u = dw.material.uniforms;
    u.uAlpha.value = this.downwashK;
    u.uTime.value += dt;
    // spray off water, dust off land
    if (this.overWater()) u.uColor.value.setRGB(0.85, 0.92, 1.0);
    else u.uColor.value.setRGB(0.78, 0.73, 0.62);
  }

  // how hard each thruster fires: the push they are asked for (linear, in ship space) and the turn
  updateThrusters(dt) {
    if (!this.thrusters) return;
    const s = this.state;
    const cmd = _v.set(0, 0, 0);
    const ang = _v2.set(0, 0, 0);
    if (this.mode === 'flying' && this.thrCmd) {
      cmd.copy(this.thrCmd).applyQuaternion(_q2.copy(s.quat).invert());
      if (this.angAcc) ang.copy(this.angAcc);
    } else if (this.mode === 'landing' || this.mode === 'takeoff' || this.mode === 'docking') {
      // settling onto (or lifting off) a pad, the VTOL jets carry the ship
      cmd.set(0, this.mode === 'takeoff' ? 14 : 9, 0);
    }
    const t = performance.now() * 0.001;
    let hoverSum = 0;
    for (const th of this.thrusters) {
      const push = _v3.copy(th.dir).negate();
      // linear share (VTOL jets carry the weight together; the small ones trim)
      let out = Math.max(0, cmd.dot(push)) / (th.kind === 'vtol' ? 26 : 34);
      // rotation: a jet pushing at a lever arm turns the ship about the axis of their cross product
      const torque = _v4.crossVectors(th.pos, push);
      if (torque.lengthSq() > 1e-4) out += Math.max(0, ang.dot(torque.normalize())) * (th.kind === 'vtol' ? 0.05 : 0.22);
      out = Math.min(1, out);
      // jets snap on and fade off
      th.out = out > th.out ? THREE.MathUtils.damp(th.out, out, 22, dt) : THREE.MathUtils.damp(th.out, out, 7, dt);
      if (th.kind === 'vtol') hoverSum += th.out;
      else if (th.out > 0.35 && th.last < 0.2) this.game.audio?.play('rcs', { gain: th.out });
      th.last = th.out;
      th.throatMat.emissiveIntensity = th.out * 4;
      const p = th.out;
      const on = p > 0.03;
      th.plume.visible = th.core.visible = on;
      if (on) {
        const flick = 0.9 + 0.1 * Math.sin(t * 70 + th.pos.x * 3);
        const len = th.r * (th.kind === 'vtol' ? 3 + p * 13 : 2 + p * 7) * flick;
        th.plume.scale.set(th.r * 0.95, len, th.r * 0.95);
        th.plume.material.uniforms.uPower.value = p;
        th.plume.material.uniforms.uTime.value = t;
        const cs = th.r * (2.2 + p * 1.6);
        th.core.scale.set(cs, cs, cs);
        th.core.position.set(0, -th.r * 0.3, 0);
        const b = p * 0.7;
        if (th.kind === 'vtol') th.core.material.color.setRGB(0.5 * b, 0.8 * b, 1.6 * b);
        else th.core.material.color.setRGB(0.8 * b, 0.82 * b, 0.9 * b);
      }
    }
    this.hoverOut = hoverSum / 4;
  }

  // speed along the nose; setting it (a scripted arrival, a teleport) sets the throttle to hold it
  get speed() {
    return this._speed;
  }

  set speed(v) {
    this._speed = v;
    this.throttle = THREE.MathUtils.clamp(v / 600, -0.1, 1);
  }

  // Local "up" in the current frame (planet radial or station +Y), or null in deep space
  upVector(out) {
    const f = this.state.frame;
    if (!f) return null;
    if (f.kind === 'station') return out.set(0, 1, 0);
    return out.copy(this.state.pos).normalize();
  }

  // ---------- per-frame ----------
  update(dt, input, piloting) {
    const s = this.state;
    this.computeEnvironment();
    this.updateHazard(dt);

    switch (this.mode) {
      case 'flying':
        this.updateFlight(dt, input, piloting);
        break;
      case 'landing':
        this.updateLanding(dt);
        break;
      case 'landed':
        s.vel.set(0, 0, 0);
        this.speed = 0;
        this.angVel.set(0, 0, 0);
        break;
      case 'takeoff':
        this.updateTakeoff(dt);
        break;
      case 'docking':
        this.updateDocking(dt);
        break;
      case 'pulse':
        this.updatePulse(dt, input, piloting);
        break;
    }

    if (this.mode !== 'landed') {
      const nearStation = s.frame && s.frame.kind === 'station';
      const steps = nearStation ? Math.min(12, Math.max(1, Math.ceil((s.vel.length() * dt) / 3))) : 1;
      for (let k = 0; k < steps; k++) {
        s.pos.addScaledVector(s.vel, dt / steps);
        this.resolveCollisions(dt / steps);
        if (this.mode === 'docking') break;
      }
    }

    // gear animation
    const wantGear = this.mode === 'landed' || this.mode === 'landing' || this.mode === 'docking' ||
      this.mode === 'takeoff' || (this.altitude < 45 && this.speed < 60);
    this.gear = THREE.MathUtils.damp(this.gear, wantGear ? 1 : 0, 4, dt);
    for (const g of this.gearNodes) {
      g.rotation.x = (1 - this.gear) * -1.35;
      g.scale.setScalar(0.35 + 0.65 * this.gear);
    }

    // engine visuals
    const power = this.mode === 'landed' ? 0.0 : this.mode === 'pulse' ? 1.6 : 0.12 + this.thrust * 0.7 + (this.boosting ? 0.5 : 0);
    this.enginePower = THREE.MathUtils.damp(this.enginePower || 0, power, 6, dt);
    if (this.flames.length) {
      const p = Math.min(1.6, this.enginePower);
      const t = performance.now() * 0.001;
      const pulse = this.mode === 'pulse';
      // the camera (at the render origin) in the ship's frame: seen straight down the exhaust,
      // the trail's sprites stack into one bright disc over each nozzle, so they are thinned there
      this.group.updateMatrixWorld();
      const camLocal = this.group.worldToLocal(_v6.set(0, 0, 0));
      for (const fl of this.flames) {
        const len = fl.r * (1.5 + p * 7);
        const along = Math.max(0, _v5.copy(camLocal).sub(fl.base).normalize().z);
        const stack = along ** 4;
        for (let i = 0; i < fl.trail.length; i++) {
          const f = i / fl.trail.length;
          const sp = fl.trail[i];
          sp.position.copy(fl.base);
          sp.position.z += 0.1 + f * len;
          const flick = 0.85 + 0.15 * Math.sin(t * 50 + i * 1.7);
          const size = fl.r * 2.6 * (1 - f * 0.75) * (0.6 + p * 0.5) * flick * (i === 0 ? 1 - 0.4 * stack : 1);
          sp.scale.set(size, size, size);
          const b = (1 - f) * (1 - f) * p * 0.55 * (i === 0 ? 1 : 1 - 0.65 * stack);
          if (pulse) sp.material.color.setRGB(1.2 * b, 0.9 * b, 3.0 * b);
          else sp.material.color.setRGB(0.35 * b + (i === 0 ? 0.3 * p : 0), 0.8 * b + (i === 0 ? 0.3 * p : 0), 1.8 * b + (i === 0 ? 0.3 * p : 0));
          sp.visible = p > 0.02;
        }
      }
      // kept below a full white-out, so the nozzle's petals and spike still read from behind
      for (const g of this.engineGlows) g.material.emissiveIntensity = 0.07 + this.enginePower * 0.63;
      this.engineLight.intensity = this.enginePower * 8;
      if (this.strobe) this.strobe.emissiveIntensity = t % 1.6 < 0.08 ? 6 : 0.4;
    }
    this.updateThrusters(dt);
    // re-entry glow when diving into an atmosphere fast
    if (this.reentryMat) {
      const fast = THREE.MathUtils.clamp((Math.abs(this.speed) - 380) / 450, 0, 1);
      const thin = this.atmoDensity > 0 ? Math.min(1, Math.sqrt(this.atmoDensity) * 6) : 0;
      // heating comes from plunging in, not from climbing out
      const up = this.upVector(_v4);
      const vs = this.state.vel.length();
      const sink = up && vs > 1 ? -this.state.vel.dot(up) / vs : 0;
      const p = (this.mode === 'flying' ? 1 : 0) * fast * thin * THREE.MathUtils.smoothstep(sink, 0.03, 0.3);
      if (vs > 1) this.reentryMat.uniforms.uVel.value.copy(this.state.vel).divideScalar(vs).applyQuaternion(_q2.copy(this.state.quat).invert());
      this.reentryPower = THREE.MathUtils.damp(this.reentryPower || 0, p, 4, dt);
      this.reentryMat.uniforms.uPower.value = this.reentryPower;
      const flick = 0.85 + 0.15 * Math.sin(this.reentryMat.uniforms.uTime.value * 23.0) * Math.sin(this.reentryMat.uniforms.uTime.value * 7.3);
      // (a hull cooking in a hellish sky glows the same way)
      this.heatU.uHeatPower.value = Math.max(this.reentryPower * 0.75 * flick, this.hazardHeat || 0);
      this.reentryMat.uniforms.uTime.value += dt;
      this.reentry.visible = this.reentryPower > 0.01;
      this.reentryMat.uniforms.uInside.value = this.inCockpit ? 1 : 0;
      this.reentryStreaks.visible = this.reentry.visible;
      if (this.reentryPower > 0.15) this.shake = Math.max(this.shake, this.reentryPower * 0.6);
    }
    if (this.contactShadow) {
      // a soft blob right under the hull when down; on the way in it falls along the sun onto the
      // ground, larger and fainter with height, so the ship has a shadow from about 180 m down
      const f = this.state.frame;
      let a = 0;
      if (f?.sampler && this.game?.system) {
        const st = this.state;
        const alt = Math.max(0, this.altitude);
        const up = _v4.copy(st.pos).normalize();
        const sunL = f.dirToLocal(_v5.copy(this.game.system.star.position).sub(f.position).normalize(), _v5);
        const elev = sunL.dot(up);
        a = alt < 8 ? 1 - alt / 8 * (elev > 0.1 ? 0.25 : 1) : elev > 0.1 ? 0.75 * (1 - THREE.MathUtils.smoothstep(alt, 40, 180)) : 0;
        if (a > 0.01) {
          const ground = _v6.copy(st.pos).addScaledVector(sunL, -alt / Math.max(0.3, elev)).normalize();
          ground.multiplyScalar(f.groundRadius(ground) + 0.12);
          const inv = _q2.copy(st.quat).invert();
          this.contactShadow.position.copy(ground).sub(st.pos).applyQuaternion(inv);
          this.contactShadow.quaternion.setFromUnitVectors(_v.set(0, 0, 1), up.applyQuaternion(inv));
          const g = 1 + alt / 50;
          this.contactShadow.scale.set(6.2 * g, 8.0 * g, 1);
        }
      }
      this.contactShadow.material.uniforms.uAlpha.value = a;
      this.contactShadow.visible = a > 0.01 && !this.inCockpit;
      this.updateDownwash(dt);
    }
    this.shake = Math.max(0, this.shake - dt * 2);
    this.laserCooldown -= dt;
    this.updateLasers(dt);
  }

  computeEnvironment() {
    const s = this.state;
    const f = s.frame;
    this.altitude = Infinity;
    this.seaAltitude = Infinity;
    this.atmoDensity = 0;
    if (f && f.sampler) {
      const r = s.pos.length();
      _v.copy(s.pos).divideScalar(r);
      this.groundR = f.groundRadius(_v);
      this.altitude = r - this.groundR - GEAR_HEIGHT;
      this.seaAltitude = r - f.radius;
      if (f.atmo) {
        const H = (f.atmo.top - 1) * f.radius;
        const h = Math.max(0, this.seaAltitude) / H;
        this.atmoDensity = h < 1 ? Math.exp(-h * f.atmo.falloff) * (1 - h) : 0;
      }
    } else if (f && f.isGas) {
      this.seaAltitude = s.pos.length() - f.radius;
      this.altitude = this.seaAltitude;
      this.atmoDensity = this.seaAltitude < f.radius * 0.05 ? 1 : 0;
    }
  }

  // Two flight models, blended by how thick the air is. In space: the main engine holds the
  // throttle's speed along the nose and the thrusters trim sideways drift away (up to a limit, so a
  // hard turn at speed slides). In the air: the throttle is thrust, drag sets the top speed (higher
  // as the air thins), gravity pulls, the wings lift and turn the ship with its nose once it is
  // moving, and below flying speed the VTOL thrusters take the weight: the ship hovers, strafes,
  // climbs and sinks on them.
  updateFlight(dt, input, piloting) {
    const s = this.state;
    const inp = piloting ? input : null;
    const up = this.upVector(_v3);
    const f = s.frame;
    const planet = f && (f.sampler || f.isGas) ? f : null;
    const rho = this.atmoDensity;
    const air = up && planet ? THREE.MathUtils.smoothstep(rho, 0.004, 0.05) : 0;
    const inAtmo = rho > 0.02;
    const fwd = _v.set(0, 0, -1).applyQuaternion(s.quat);
    const vF = s.vel.dot(fwd);
    // below flying speed in the air, the thrusters fly the ship
    const hover = air * (1 - THREE.MathUtils.smoothstep(vF, 45, 110));
    this.hover = hover;

    // --- rotation ---
    const sens = 0.0016;
    let targetPitch = inp ? THREE.MathUtils.clamp(-inp.mouseDY * sens / Math.max(dt, 1 / 240), -1.6, 1.6) : 0;
    const targetYaw = inp ? THREE.MathUtils.clamp(-inp.mouseDX * sens / Math.max(dt, 1 / 240), -1.6, 1.6) : 0;
    // A/D roll in flight, and strafe on the thrusters while hovering
    const sideIn = inp ? (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0) : 0;
    let targetRoll = -sideIn * 1.6 * (1 - hover);
    // atmospheric auto-level & bank-to-turn (hovering, the ship just sits level)
    if (inAtmo && up) {
      const right = _v2.set(1, 0, 0).applyQuaternion(s.quat);
      const bank = right.dot(up); // >0 when right wing is up
      targetRoll += -bank * (1.6 + hover * 2) * (targetRoll === 0 ? 1 : 0.2);
      targetRoll += targetYaw * 0.35 * (1 - hover);
      // hovering, the nose eases back toward the horizon unless held up or down
      if (hover > 0.3 && Math.abs(targetPitch) < 0.05) {
        const nose = fwd.dot(up);
        if (Math.abs(nose) < 0.6) targetPitch += -nose * 1.2 * hover;
      }
    }
    // ground proximity assist: at speed near the surface the nose is pulled up so the ship levels
    // out instead of ploughing into terrain or skidding along the sea
    let pullUp = 0;
    if (up && this.altitude < 60) {
      const fwdUp = fwd.dot(up);
      const near = 1 - Math.max(0, this.altitude) / 60;
      if (fwdUp < 0.05) pullUp = (0.05 - fwdUp) * near * 3.2 * (1 - hover);
    }
    targetPitch = Math.max(targetPitch, Math.min(1.6, targetPitch + pullUp));
    const resp = 1 - Math.exp(-dt * 9);
    const prevAng = _v6.copy(this.angVel);
    this.angVel.x += (targetPitch - this.angVel.x) * resp;
    this.angVel.y += (targetYaw - this.angVel.y) * resp;
    this.angVel.z += (targetRoll - this.angVel.z) * (1 - Math.exp(-dt * 5));
    (this.angAcc ||= new THREE.Vector3()).copy(this.angVel).sub(prevAng).divideScalar(Math.max(dt, 1e-3));
    _q.setFromAxisAngle(X, this.angVel.x * dt);
    s.quat.multiply(_q);
    // yaw turns about the ship's own up in flight, about the planet's up when hovering
    if (up && hover > 0) {
      const axis = _v2.copy(up).applyQuaternion(_q2.copy(s.quat).invert()).lerp(Y, 1 - hover).normalize();
      _q.setFromAxisAngle(axis, this.angVel.y * dt);
    } else _q.setFromAxisAngle(Y, this.angVel.y * dt);
    s.quat.multiply(_q);
    _q.setFromAxisAngle(Z, this.angVel.z * dt);
    s.quat.multiply(_q).normalize();
    fwd.set(0, 0, -1).applyQuaternion(s.quat);

    // --- throttle: held where you leave it; S at the bottom fires the retro thrusters ---
    const W = !!inp?.down('KeyW');
    const Sk = !!inp?.down('KeyS');
    this.boosting = !!inp?.down('ShiftLeft');
    const floor = air > 0.5 ? 0 : -0.1;
    if (W) this.throttle = Math.min(1, this.throttle + dt * 0.9);
    if (Sk) this.throttle = Math.max(floor, this.throttle - dt * 1.4);
    const retro = Sk && this.throttle <= floor + 1e-3;
    const boost = this.boosting ? 1 : 0;
    const vIn = inp ? (inp.down('Space') ? 1 : 0) - (inp.down('KeyC') ? 1 : 0) : 0;

    const acc = _v4.set(0, 0, 0);
    // what the thrusters (not the main engine) are asked for, for their flames
    const thr = (this.thrCmd ||= new THREE.Vector3()).set(0, 0, 0);
    const vPerp = _v5.copy(s.vel).addScaledVector(fwd, -s.vel.dot(fwd));
    let mainA = 0;

    // --- space ---
    if (air < 1) {
      const k = 1 - air;
      const cap = 600 * (this.speedMul || 1) * (boost ? 2.6 : 1);
      const set = (boost ? 1 : this.throttle) * cap;
      const engA = 160 * (boost ? 2.6 : 1);
      const vNow = s.vel.dot(fwd);
      const aF = THREE.MathUtils.clamp((set - vNow) * 2, -220, engA);
      mainA += Math.max(0, aF) * k;
      acc.addScaledVector(fwd, aF * k);
      if (aF < 0) thr.addScaledVector(fwd, aF * k);
      // flight assist: drift trimmed off, at most so hard
      const assist = _v2.copy(vPerp).multiplyScalar(-1.8);
      if (assist.length() > 140) assist.setLength(140);
      acc.addScaledVector(assist, k);
      thr.addScaledVector(assist, k);
      // a world's pull reaches out past its air (weakly, and mostly trimmed away)
      if (planet && up) {
        const r = s.pos.length();
        acc.addScaledVector(up, -(planet.gravity || 9) * (planet.radius / r) ** 2 * k);
      }
    }

    // --- air ---
    if (air > 0) {
      const g = (planet.gravity || 9) * (planet.radius / s.pos.length()) ** 2;
      const thick = Math.max(rho, 0.05);
      const shipUpDot = Math.max(0, _v2.set(0, 1, 0).applyQuaternion(s.quat).dot(up));
      // main engine: thrust from the throttle; drag sets the speed it reaches
      let aMain = (boost ? 1 : Math.max(0, this.throttle)) * 75 * (this.speedMul || 1) * (boost ? 2.4 : 1);
      if (retro) {
        aMain = -40;
        thr.addScaledVector(fwd, -40 * air);
      }
      mainA += Math.max(0, aMain) * air;
      acc.addScaledVector(fwd, aMain * air);
      const sp = s.vel.length();
      // (capped like an airbrake would be: coming in from orbit at full tilt, raw drag stopped the
      // ship dead in a second)
      acc.addScaledVector(s.vel, -Math.min(0.00115 * thick * sp, 140 / Math.max(sp, 1)) * air);
      // the wings: sideways and vertical slip is turned into the nose's direction, more so faster
      const grip = THREE.MathUtils.clamp((rho * Math.max(0, vF)) / 70, 0, 2.6);
      acc.addScaledVector(vPerp, -(grip + 0.004 * thick * vPerp.length()) * air);
      // gravity, and lift that carries it once there is speed over the wings (less in a steep bank)
      const lift = THREE.MathUtils.smoothstep(vF, 40, 120) * THREE.MathUtils.clamp(0.35 + rho * 2, 0, 1) * shipUpDot;
      acc.addScaledVector(up, -g * (1 - lift) * air);
      // VTOL thrusters: take what the wings do not, hold the height (or climb / sink on Space / C),
      // keep station sideways and strafe on A / D
      const hk = Math.max(hover, vIn !== 0 ? air * 0.9 : 0);
      if (hk > 0) {
        const vUp = s.vel.dot(up);
        const need = g * (1 - lift);
        const aUp = THREE.MathUtils.clamp(need + (vIn * 24 - vUp) * 2.2, -g * 0.8, g * 2.6) * hk;
        acc.addScaledVector(up, aUp);
        thr.addScaledVector(up, aUp);
        const right = _v2.set(1, 0, 0).applyQuaternion(s.quat);
        right.addScaledVector(up, -right.dot(up)).normalize();
        const horiz = _v6.copy(s.vel).addScaledVector(up, -s.vel.dot(up));
        const vR = horiz.dot(right);
        // station-keeping: with the throttle closed, the drift is held off
        const keep = !W && this.throttle < 0.02 && !retro ? hover : 0;
        const fwdH = _v.copy(fwd).addScaledVector(up, -fwd.dot(up));
        if (fwdH.lengthSq() > 1e-4) fwdH.normalize();
        const aFwdKeep = -horiz.dot(fwdH) * 1.4 * keep;
        const aSide = ((sideIn * 22 - vR) * 2.2) * hover;
        const lat = _v6.copy(right).multiplyScalar(aSide).addScaledVector(fwdH, aFwdKeep);
        acc.add(lat);
        thr.add(lat);
        fwd.set(0, 0, -1).applyQuaternion(s.quat);
      }
    }

    s.vel.addScaledVector(acc, dt);
    const vmax = 600 * 2.6 * (this.speedMul || 1) * 1.05;
    if (s.vel.length() > vmax) s.vel.setLength(vmax);
    this._speed = s.vel.dot(fwd);
    this.thrust = THREE.MathUtils.clamp(mainA / 75, 0, 1);

    // terrain avoidance near the ground (at speed: hovering, you can set down)
    if (up && this.altitude < 25) {
      const vUp = s.vel.dot(up);
      const push = (25 - this.altitude) * 1.2 * (1 - hover);
      if (vUp < push) s.vel.addScaledVector(up, (push - vUp) * Math.min(1, dt * 6));
    }
    // hovered down onto dry ground: set down on the gear
    if (hover > 0.6 && this.altitude < 0.5 && s.vel.length() < 5 && vIn <= 0 && !this.overWater()) this.touchDown();

    // actions
    if (inp) {
      if (inp.hit('KeyE') && this.canLand()) this.beginLanding();
      if (inp.hit('KeyJ')) this.tryPulse();
      if (inp.mouse(0)) this.fireLasers();
    }
  }

  canLand() {
    const f = this.state.frame;
    return f && f.sampler && this.altitude < 350 && Math.abs(this.speed) < 160;
  }

  overWater() {
    const f = this.state.frame;
    if (!f || !f.sampler || !f.ocean) return false;
    const dir = _v.copy(this.state.pos).normalize();
    return f.heightAt(dir) < 0.5;
  }

  beginLanding() {
    if (this.overWater()) {
      this.game.hud?.toast(this.state.frame.waterEmissive ? 'Cannot land on lava' : 'Cannot land on water — find solid ground', 'warn');
      this.game.audio?.play('error');
      return;
    }
    this.mode = 'landing';
    this.game.audio?.play('landing');
    this.game.hud?.toast('Landing sequence engaged');
  }

  terrainNormal(dir, out) {
    const f = this.state.frame;
    const e = 3 / f.radius;
    const t1 = _v2.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) t1.set(1, 0, 0);
    const a = new THREE.Vector3().crossVectors(dir, t1).normalize();
    const b = new THREE.Vector3().crossVectors(dir, a).normalize();
    const p0 = dir.clone().multiplyScalar(f.groundRadius(dir));
    const d1 = dir.clone().addScaledVector(a, e).normalize();
    const d2 = dir.clone().addScaledVector(b, e).normalize();
    const p1 = d1.multiplyScalar(f.groundRadius(d1));
    const p2 = d2.multiplyScalar(f.groundRadius(d2));
    out.crossVectors(p1.sub(p0), p2.sub(p0)).normalize();
    if (out.dot(dir) < 0) out.negate();
    return out;
  }

  updateLanding(dt) {
    const s = this.state;
    const up = this.upVector(_v3);
    const dir = _v.copy(s.pos).normalize();
    const n = this.terrainNormal(dir, new THREE.Vector3());
    const surfUp = n.lerp(up, 0.4).normalize();
    // level the ship to the surface, keep heading
    this.alignUp(s.quat, surfUp, 1 - Math.exp(-dt * 3));
    // kill horizontal speed, descend
    const vUp = s.vel.dot(up);
    const horiz = _v2.copy(s.vel).addScaledVector(up, -vUp);
    horiz.multiplyScalar(Math.exp(-dt * 1.6));
    const desc = -THREE.MathUtils.clamp(this.altitude * 0.9, 1.4, 45);
    const newUp = THREE.MathUtils.damp(vUp, desc, 3, dt);
    s.vel.copy(horiz).addScaledVector(up, newUp);
    this.speed = horiz.length();
    this.thrust = 0.3;
    // the downwash flattens the plants on the pad before the ship gets there
    if (this.altitude < 50 && this.landingClearedAt !== s.frame) {
      this.landingClearedAt = s.frame;
      const f = s.frame;
      if (f && f.sampler) {
        const dir = _v5.copy(s.pos).normalize();
        this.game.flora?.clearAround(dir.multiplyScalar(f.groundRadius(dir)), 11, 3.5);
      }
    }
    if (this.altitude < 0.15 && horiz.length() < 2) {
      this.touchDown();
    }
    // drifted over water while descending: abort
    if (this.altitude < 30 && this.overWater()) {
      this.mode = 'flying';
      this.speed = 0;
      this.game.hud?.toast('Landing aborted — surface is liquid', 'warn');
    }
  }

  touchDown() {
    const s = this.state;
    const f = s.frame;
    this.mode = 'landed';
    s.vel.set(0, 0, 0);
    this.speed = 0;
    if (f && f.sampler) {
      const dir = _v.copy(s.pos).normalize();
      s.pos.copy(dir).multiplyScalar(f.groundRadius(dir) + GEAR_HEIGHT);
      this.game.flora?.clearAround(s.pos, 11, 3.5);
    }
    this.shake = 0.4;
    this.game.audio?.play('touchdown');
    // (no toast: the landed prompt already shows the two keys)
  }

  takeOff() {
    if (this.mode !== 'landed') return;
    this.landingClearedAt = null;
    this.mode = 'takeoff';
    this.takeoffT = 0;
    this.game.audio?.play('takeoff');
    if (this.state.frame && this.state.frame.kind === 'station') {
      this.game.station?.releasePad(this);
    }
  }

  updateTakeoff(dt) {
    const s = this.state;
    const up = this.upVector(_v3) || _v3.set(0, 1, 0);
    this.takeoffT += dt;
    this.thrust = 1;
    const inStation = s.frame && s.frame.kind === 'station';
    if (inStation) {
      // rise then fly out of the hangar mouth (+Z)
      this.alignUp(s.quat, up, 1 - Math.exp(-dt * 2));
      const targetY = 14;
      const vy = (targetY - s.pos.y) * 1.5;
      s.vel.set(0, THREE.MathUtils.clamp(vy, -10, 12), 0);
      if (this.takeoffT > 1.8) {
        // turn toward the exit and go
        const exitDir = new THREE.Vector3(0, 0, 1);
        this.faceDirection(s.quat, exitDir, up, 1 - Math.exp(-dt * 2.5));
        const fwd = _v.set(0, 0, -1).applyQuaternion(s.quat);
        s.vel.addScaledVector(fwd, Math.min(60, (this.takeoffT - 1.8) * 30));
        if (s.pos.z > 90) {
          this.mode = 'flying';
          this.speed = 60;
        }
      }
      return;
    }
    const vUp = THREE.MathUtils.clamp((50 - this.altitude) * 0.9, 4, 22);
    s.vel.copy(up).multiplyScalar(vUp);
    if (this.altitude > 25 || this.takeoffT > 5) {
      // up and holding on the thrusters: the throttle takes it from here
      this.mode = 'flying';
      this.speed = 0;
    }
  }

  // ---------- pulse drive ----------
  tryPulse() {
    if (this.atmoDensity > 0.001 || (this.altitude < 2000 && this.state.frame?.sampler)) {
      this.game.hud?.toast('Pulse drive unavailable inside atmosphere', 'warn');
      return;
    }
    if (this.pulseFuel <= 0) {
      this.game.hud?.toast('Pulse drive fuel depleted', 'warn');
      return;
    }
    // (rather than engage and drop straight out again)
    if (this.pulseLimit().dist < 600) {
      this.game.hud?.toast('Too close to engage the pulse drive', 'warn');
      return;
    }
    this.mode = 'pulse';
    this.pulse.spool = 0;
    this.pulse.speed = Math.max(this.speed, 200);
    this.game.audio?.play('pulse');
  }

  pulseLimit() {
    // slow down near any body so arrival is controllable (supercruise style)
    const g = this.game;
    const sys = g.system;
    const wp = this.state.worldPosition(_v2);
    let minD = Infinity;
    if (!g.universe.dormant) {
      for (const b of sys.bodies) {
        // clear of a world's air (or its highest peaks): the drive runs right down to the top of
        // the sky (a flat third of a radius out, it dropped out of the climb with the prompt still
        // offering it)
        let clear = b.kind === 'star' ? b.radius * 3 : b.atmo ? b.radius * b.atmo.top : b.radius + (b.maxTerrain || 0) + 2500;
        // (and above any hostile layer: dropping out into a gas giant's crushing depths is no arrival)
        if (b.params?.hazard) clear = Math.max(clear, b.radius + b.params.hazard.ceiling * 1.3);
        const d = b.distanceTo(wp) - clear;
        if (d < minD) minD = d;
      }
    }
    // and for other stars, other galaxies, the edge
    minD = Math.min(minD, g.universe.clearance());
    // The station always holds the speed down near it (so an overshoot can turn and come back:
    // ignored once behind you, the drive ran away at full speed and circled it far out), but it
    // only counts as arrived-at when you are heading for it (pulsing away just after leaving it,
    // the drive dropped straight out again).
    let ahead = minD;
    if (g.station && !g.universe.dormant) {
      const to = _v3.copy(g.station.position).sub(wp);
      const d = to.length() - 3000;
      minD = Math.min(minD, d);
      if (to.dot(this.state.worldDir(_v4.set(0, 0, -1).applyQuaternion(this.state.quat), _v5)) > 0) ahead = Math.min(ahead, d);
    }
    // close in, a short time constant keeps arrival controllable; in open space the limit grows
    // with the distance to anything (CRUISE_T seconds to cover it), so between the stars it climbs
    // to thousands of times light speed and a few light years take some twenty minutes
    return { limit: Math.max(300, Math.min(minD * 0.55, Math.max(280000, minD / CRUISE_T))), dist: ahead };
  }

  updatePulse(dt, input, piloting) {
    const s = this.state;
    const inp = piloting ? input : null;
    this.pulse.spool = Math.min(1, this.pulse.spool + dt * 0.8);
    const sens = 0.0008;
    const tp = inp ? THREE.MathUtils.clamp(-inp.mouseDY * sens / Math.max(dt, 1 / 240), -0.8, 0.8) : 0;
    const ty = inp ? THREE.MathUtils.clamp(-inp.mouseDX * sens / Math.max(dt, 1 / 240), -0.8, 0.8) : 0;
    let tr = 0;
    if (inp?.down('KeyA')) tr += 1;
    if (inp?.down('KeyD')) tr -= 1;
    const resp = 1 - Math.exp(-dt * 5);
    this.angVel.x += (tp - this.angVel.x) * resp;
    this.angVel.y += (ty - this.angVel.y) * resp;
    this.angVel.z += (tr - this.angVel.z) * resp;
    _q.setFromAxisAngle(X, this.angVel.x * dt);
    s.quat.multiply(_q);
    _q.setFromAxisAngle(Y, this.angVel.y * dt);
    s.quat.multiply(_q);
    _q.setFromAxisAngle(Z, this.angVel.z * dt);
    s.quat.multiply(_q).normalize();

    const { limit, dist } = this.pulseLimit();
    const maxPulse = limit;
    const target = maxPulse * this.pulse.spool;
    // exponential acceleration, quick deceleration
    if (this.pulse.speed < target) this.pulse.speed = Math.min(target, this.pulse.speed * Math.exp(dt * 1.5) + 200 * dt);
    else this.pulse.speed = THREE.MathUtils.damp(this.pulse.speed, target, 4, dt);
    const fwd = _v.set(0, 0, -1).applyQuaternion(s.quat);
    s.vel.copy(fwd).multiplyScalar(this.pulse.speed);
    this.speed = this.pulse.speed;
    this.thrust = 1;
    // fuel burns close to the planets; out in the open gaps (and between the stars) the drive
    // cruises on the interstellar medium, or no trip beyond the home system would ever end
    if (dist < 280000 * CRUISE_T) this.pulseFuel = Math.max(0, this.pulseFuel - dt * 0.35);
    this.shake = Math.max(this.shake, 0.08);

    const exit = (inp && (inp.hit('KeyJ') || inp.hit('Space') || inp.hit('KeyS'))) || this.pulseFuel <= 0 ||
      this.atmoDensity > 0.001 || dist < 400;
    if (exit) this.exitPulse();
  }

  exitPulse() {
    this.mode = 'flying';
    this.speed = Math.min(this.pulse.speed, 400);
    const fwd = _v.set(0, 0, -1).applyQuaternion(this.state.quat);
    this.state.vel.copy(fwd).multiplyScalar(this.speed);
    this.game.audio?.play('pulseExit');
  }

  // ---------- docking ----------
  beginDocking(station, pad) {
    this.mode = 'docking';
    this.dockPad = pad;
    this.dockPhase = 0;
    this.game.hud?.toast('Docking clamps engaged — autopilot');
    this.game.audio?.play('landing');
  }

  updateDocking(dt) {
    const s = this.state;
    const pad = this.dockPad;
    const up = _v3.set(0, 1, 0);
    const hover = _v.set(pad.x, pad.y + 14, pad.z);
    const toHover = new THREE.Vector3().copy(hover).sub(s.pos);
    this.alignUp(s.quat, up, 1 - Math.exp(-dt * 2));
    if (this.dockPhase === 0) {
      const d = toHover.length();
      const spd = Math.min(70, d * 0.9 + 3);
      s.vel.lerp(toHover.normalize().multiplyScalar(spd), 1 - Math.exp(-dt * 2.5));
      const flat = _v.copy(toHover).setY(0);
      if (flat.lengthSq() > 4) this.faceDirection(s.quat, flat.normalize(), up, 1 - Math.exp(-dt * 2));
      if (d < 2.5) this.dockPhase = 1;
    } else {
      // descend
      const target = pad.y + GEAR_HEIGHT;
      const dy = target - s.pos.y;
      s.vel.set((pad.x - s.pos.x) * 2, THREE.MathUtils.clamp(dy * 1.4, -8, 2), (pad.z - s.pos.z) * 2);
      if (Math.abs(dy) < 0.08) {
        s.pos.y = target;
        this.mode = 'landed';
        s.vel.set(0, 0, 0);
        this.speed = 0;
        this.shake = 0.3;
        this.game.audio?.play('touchdown');
        this.game.onDocked?.();
      }
    }
    this.speed = s.vel.length();
    this.thrust = 0.4;
  }

  // ---------- helpers ----------
  alignUp(quat, up, t) {
    const curUp = _v2.set(0, 1, 0).applyQuaternion(quat);
    _q2.setFromUnitVectors(curUp, up);
    _q.copy(_q2).multiply(quat);
    quat.slerp(_q, t);
  }

  faceDirection(quat, dir, up, t) {
    const right = _v2.crossVectors(dir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    _m.makeBasis(right, realUp, _v.copy(dir).negate());
    _q.setFromRotationMatrix(_m);
    quat.slerp(_q, t);
  }

  resolveCollisions(dt) {
    const s = this.state;
    const f = s.frame;
    if (f && f.sampler) {
      const r = s.pos.length();
      const dir = _v.copy(s.pos).divideScalar(r);
      const ground = f.groundRadius(dir) + GEAR_HEIGHT * 0.6;
      if (r < ground) {
        const vIn = s.vel.dot(dir);
        if (vIn < -25 && this.mode === 'flying') {
          this.damage(Math.min(40, -vIn * 0.4));
          this.shake = 1;
        }
        s.pos.copy(dir).multiplyScalar(ground);
        if (vIn < 0) s.vel.addScaledVector(dir, -vIn * 1.2);
      }
    } else if (f && f.isGas) {
      const r = s.pos.length();
      // (the depths crush the ship long before it gets this far: see updateHazard)
      const lim = f.radius * 1.004;
      if (r < lim) {
        const dir = _v.copy(s.pos).divideScalar(r);
        s.pos.copy(dir).multiplyScalar(lim);
        const vIn = s.vel.dot(dir);
        if (vIn < 0) s.vel.addScaledVector(dir, -vIn * 1.5);
      }
    }
    if (f && f.kind === 'station' && this.mode !== 'docking' && this.mode !== 'takeoff') {
      f.collideShip(this);
    }
    if (f && f.sampler && this.mode !== 'landed') this.game.cities?.collideShip(this);
  }

  // Hostile skies: below a world's hazard ceiling the ship takes damage that grows toward the
  // ground (or into a gas giant's depths): heat, crushing pressure, acid, radiation, cryogenic
  // cold, or a superstorm's lightning and gales. The shield takes it first, then the hull.
  updateHazard(dt) {
    const g = this.game;
    const f = this.state.frame;
    const hz = f?.params?.hazard;
    this.hazard = null;
    this.hazardLevel = 0;
    this.hazardNear = 0;
    this.hazardHeat = 0;
    this.wind.multiplyScalar(Math.exp(-dt * 0.5));
    // the station's crews patch the hull while you are docked
    if (this.mode === 'landed' && f?.kind === 'station') this.hull = Math.min(100, this.hull + dt * 20);
    if (!hz || g.mode !== 'ship' || this.mode === 'landed' && f.kind === 'station') return;
    const alt = f.isGas ? this.seaAltitude : this.altitude;
    if (!isFinite(alt)) return;
    this.hazard = hz;
    // within sight of the danger: warn before it bites
    this.hazardNear = 1 - THREE.MathUtils.smoothstep(alt, hz.ceiling, hz.ceiling * 1.8);
    const depth = THREE.MathUtils.clamp(1 - alt / hz.ceiling, 0, 1);
    this.hazardLevel = depth;
    if (depth <= 0) return;
    const resist = this.resist[hz.kind] || 1;
    let dmg = hz.dps * Math.pow(depth, hz.curve || 1.3) * dt / resist;
    const t = g.time;
    if (hz.kind === 'heat') {
      this.hazardHeat = depth * (0.75 + 0.15 * Math.sin(t * 17));
      this.shake = Math.max(this.shake, depth * 0.25);
    } else if (hz.kind === 'pressure') {
      this.shake = Math.max(this.shake, depth * depth * 0.55);
      if (Math.random() < dt * depth * 0.7) g.audio?.play('creak');
    } else if (hz.kind === 'acid') {
      if (Math.random() < dt * 0.5) g.audio?.play('hiss');
    } else if (hz.kind === 'storm' && this.mode !== 'landed') {
      // gales: a wandering push across the sky, and lightning strikes now and then
      const up = this.upVector(_v4);
      const gust = _v5.set(Math.sin(t * 0.37 + 1.3) + Math.sin(t * 1.9) * 0.4, 0, Math.cos(t * 0.29) + Math.sin(t * 2.3 + 2) * 0.4);
      if (up) gust.addScaledVector(up, -gust.dot(up));
      this.wind.addScaledVector(gust, dt * 26 * depth);
      this.state.vel.addScaledVector(this.wind, dt);
      this.angVel.x += (Math.random() - 0.5) * dt * 3 * depth;
      this.angVel.z += (Math.random() - 0.5) * dt * 4 * depth;
      this.shake = Math.max(this.shake, depth * 0.3);
      this.nextStrike = (this.nextStrike ?? 3) - dt * (0.4 + depth);
      if (this.nextStrike <= 0) {
        this.nextStrike = 2 + Math.random() * 6;
        dmg += (5 + Math.random() * 9) / resist;
        g.lightning?.(1, true);
        g.audio?.play('thunder', { dist: 300 });
        this.shake = 1;
      }
    }
    this.hazardDamage(dmg);
  }

  hazardDamage(amount) {
    if (amount <= 0) return;
    const fromShield = Math.min(this.shield, amount);
    this.shield -= fromShield;
    this.hull = Math.max(0, this.hull - (amount - fromShield));
    this.lastHazardHit = this.game.time;
    if (this.hull <= 0) this.game.shipDestroyed(this.hazard);
  }

  damage(amount) {
    this.shield = Math.max(0, this.shield - amount);
    this.game.hud?.flash('damage');
    this.game.audio?.play('impact');
  }

  // ---------- weapons ----------
  fireLasers() {
    if (this.laserCooldown > 0) return;
    this.laserCooldown = 0.12;
    this.game.audio?.play('shipLaser');
    for (const side of [-1, 1]) {
      this.lasers.push({ life: 0.35, side, offset: new THREE.Vector3(5.75 * side, -0.62, -2.5) });
    }
    this.game.onShipFire?.(this);
  }

  updateLasers(dt) {
    if (!this.laserMesh) {
      const geo = new THREE.CylinderGeometry(0.08, 0.08, 1, 6, 1, true);
      geo.translate(0, 0.5, 0);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.6, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      this.laserMesh = new THREE.InstancedMesh(geo, mat, 32);
      this.laserMesh.frustumCulled = false;
      this.group.add(this.laserMesh);
    }
    let n = 0;
    const m = new THREE.Matrix4();
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.life -= dt;
      if (l.life <= 0) {
        this.lasers.splice(i, 1);
        continue;
      }
      const t = 1 - l.life / 0.35;
      const len = 60;
      m.compose(
        _v.copy(l.offset).add(_v2.set(0, 0, -t * 900)),
        _q.identity(),
        _v3.set(1, 1, len),
      );
      if (n < 32) this.laserMesh.setMatrixAt(n++, m);
    }
    this.laserMesh.count = n;
    this.laserMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- camera ----------
  setCockpit(on) {
    this.inCockpit = on;
    this.setCockpitVisual(on);
  }

  // the interior and the inside look of the glass, apart from the seat camera: the camera can be
  // on its way in or out through the canopy
  setCockpitVisual(on) {
    if (this.cockpit) this.cockpit.setVisible(on);
    for (const m of this.canopyParts || []) {
      if (m.userData.outerMat === undefined) m.userData.outerMat = m.material;
      if (m.userData.outerMat.name === 'Glass') m.material = on ? this.innerGlass : m.userData.outerMat;
    }
  }

  updateCamera(dt, input, out) {
    const s = this.state;
    let snap = false;
    if (out.frame !== s.frame) {
      // velocities are per frame: no acceleration to read across the change
      this.camPrevSpeed = null;
      if (out.frame === undefined) {
        snap = true;
        // hard reset (spawn / boarding): snap behind the ship
        out.frame = s.frame;
        out.pos.copy(this.camOffset).applyQuaternion(s.quat).add(s.pos);
        out.quat.copy(s.quat);
        this.camSwing.set(0, 0, 0);
      } else {
        // crossing a sphere of influence: re-express the camera in the new frame, no jump
        out.setFrame(s.frame);
      }
    }
    if (this.inCockpit) {
      out.pos.copy(EYE).applyQuaternion(s.quat).add(s.pos);
      out.quat.copy(s.quat);
      if (this.shake > 0) {
        const a = this.shake * this.shake * 0.25;
        out.quat.multiply(_q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * a * 0.06, (Math.random() - 0.5) * a * 0.06, 0)));
      }
      this.cockpit.update(dt, this.game);
      return;
    }
    if (input.enabled && input.wheel) this.camDistance = THREE.MathUtils.clamp(this.camDistance + input.wheel * 0.15, 0.6, 2.5);
    const speedFactor = Math.min(1, Math.abs(this.speed) / 450);
    // the camera swings out of turns and dips under climbs, so the ship slides and leans
    // across the frame instead of sitting pinned at its centre
    _v4.set(this.angVel.y * 11, -this.angVel.x * 5 - Math.abs(this.angVel.y) * 1.1, 0);
    this.camSwing.lerp(_v4, 1 - Math.exp(-dt * 2.2));
    const offset = _v.copy(this.camOffset).multiplyScalar(this.camDistance).add(this.camSwing);
    offset.z += speedFactor * 4;
    // speeding up, the camera falls back behind the ship; braking, it closes in
    // (from the velocity: `speed` reads 0 through the takeoff and jumped as the ship cleared the hangar)
    const spd = s.vel.length();
    const accel = dt > 0 ? (spd - (this.camPrevSpeed ?? spd)) / dt : 0;
    this.camPrevSpeed = spd;
    this.camLag = THREE.MathUtils.damp(this.camLag || 0, THREE.MathUtils.clamp(accel * 0.025, -3, 8), 2.2, dt);
    offset.z += this.camLag;
    // and rises as it falls back, so the ship keeps its place low in the frame instead of creeping
    // up to the centre (under the reticle) at speed
    offset.y += (offset.z - this.camOffset.z * this.camDistance) * 0.24;
    // a slow handheld drift, so the ship is never pinned to one spot on screen
    const ct = this.camTime;
    const drift = 0.4 + speedFactor;
    offset.x += (Math.sin(ct * 0.37) * 0.45 + Math.sin(ct * 0.91 + 2.0) * 0.2) * drift;
    offset.y += (Math.sin(ct * 0.53 + 1.0) * 0.3 + Math.sin(ct * 1.17) * 0.12) * drift;
    // hold B to swing round and look back past the ship (at the station you just left, say)
    // (a steady ramp, eased below: damping put most of the half-turn into one second, a whip)
    const lbT = input.enabled && input.down?.('KeyB') ? 1 : 0;
    const lb0 = this.lookBack || 0;
    this.lookBack = lb0 + THREE.MathUtils.clamp(lbT - lb0, -dt / 4, dt / 4);
    const lb = this.lookBack * this.lookBack * (3 - 2 * this.lookBack) * Math.PI;
    if (lb > 1e-3) offset.applyAxisAngle(Y, lb);
    // in an atmosphere the rig keeps closer to level than the ship: climbing out, the frame holds
    // the ground and horizon instead of filling with sky, and diving in it doesn't turn top-down
    const fr = s.frame;
    let level = 0;
    if (fr && fr.sampler && !this.inCockpit) {
      const fwdPitch = Math.asin(THREE.MathUtils.clamp(_v5.set(0, 0, -1).applyQuaternion(s.quat).dot(_v6.copy(s.pos).normalize()), -1, 1));
      level = -THREE.MathUtils.clamp(fwdPitch, -1.2, 1.2) * 0.45 * Math.min(1, this.atmoDensity * 6);
    }
    this.camLevel = THREE.MathUtils.damp(this.camLevel || 0, level, 3, dt);
    if (Math.abs(this.camLevel) > 1e-4) offset.applyAxisAngle(X, this.camLevel);
    const desired = _v2.copy(offset).applyQuaternion(s.quat).add(s.pos);
    // position follows tightly (avoid lag at high speed), rotation lags a bit for feel
    const k = this.mode === 'pulse' ? 20 : 8;
    out.pos.lerp(desired, snap ? 1 : 1 - Math.exp(-dt * k));
    // but never far behind at high speed (no rubber banding)
    const rel = _v3.copy(out.pos).sub(desired);
    if (rel.length() > 9) out.pos.copy(desired).add(rel.setLength(9));
    // aimed a little above the ship, so it flies in the lower part of the frame with the view ahead open
    const lookTarget = _v3.set(this.camSwing.x * 0.5, 5.4 * this.camDistance + this.camSwing.y * 0.3, -30);
    if (lb > 1e-3) lookTarget.applyAxisAngle(Y, lb);
    if (Math.abs(this.camLevel) > 1e-4) lookTarget.applyAxisAngle(X, this.camLevel);
    lookTarget.applyQuaternion(s.quat).add(s.pos);
    const camUp = _v4.set(0, 1, 0).applyQuaternion(s.quat);
    // in an atmosphere the camera keeps the horizon steadier than the ship, so banks read on screen
    const f = s.frame;
    if (f && f.sampler) {
      const radial = _v5.copy(s.pos).normalize();
      if (camUp.dot(radial) > 0.2) camUp.lerp(radial, 0.35 * Math.min(1, this.atmoDensity * 6)).normalize();
    }
    _m.lookAt(out.pos, lookTarget, camUp);
    _q.setFromRotationMatrix(_m);
    out.quat.slerp(_q, snap ? 1 : 1 - Math.exp(-dt * 7));
    // buffeting at speed in thick air
    this.camTime += dt;
    const buffet = THREE.MathUtils.clamp((Math.abs(this.speed) - 220) / 1100, 0, 1) * Math.min(1, this.atmoDensity * 6);
    if (buffet > 0) {
      const t = this.camTime;
      const a = buffet * 0.0035;
      out.quat.multiply(_q.setFromEuler(new THREE.Euler((Math.sin(t * 37) + Math.sin(t * 59.3)) * a, (Math.sin(t * 43.1) + Math.sin(t * 23.7)) * a, 0)));
    }
    // ground clearance for camera
    if (f && f.sampler) {
      const r = out.pos.length();
      const dir = _v.copy(out.pos).divideScalar(r);
      const g = f.groundRadius(dir) + 1.2;
      if (r < g) out.pos.copy(dir).multiplyScalar(g);
    }
    if (f && f.kind === 'station') this.unblockCamera(out.pos, f);
    if (this.shake > 0) {
      const a = this.shake * this.shake * 0.25;
      out.quat.multiply(_q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * a * 0.1, (Math.random() - 0.5) * a * 0.1, 0)));
    }
  }

  // Pull the chase camera in along the line from the ship until it is clear of the station's
  // walls and props and of the parked ships (it used to swing straight through them).
  unblockCamera(cam, station) {
    const ships = this.game.traffic?.ships || [];
    const pad = 0.6;
    const blocked = (p) => {
      for (const c of station.colliders) {
        if (p.x > c.min.x - pad && p.x < c.max.x + pad && p.y > c.min.y - pad && p.y < c.max.y + pad && p.z > c.min.z - pad && p.z < c.max.z + pad) return true;
      }
      for (const t of ships) if (t.pos.distanceToSquared(p) < 49) return true;
      return false;
    };
    if (!blocked(cam)) return;
    const from = _v5.copy(this.state.pos);
    from.y += 1.5;
    let clear = 0;
    for (let i = 1; i <= 24; i++) {
      if (blocked(_v6.lerpVectors(from, cam, i / 24))) break;
      clear = i / 24;
    }
    cam.lerpVectors(from, cam, clear);
  }

  // Keep a walker out of the landed ship (they could walk into the engine pods and under the wings).
  collidePlayer(player) {
    if (this.mode !== 'landed' || player.state.frame !== this.state.frame) return;
    const p = player.state.pos;
    if (p.distanceToSquared(this.state.pos) > 400) return;
    const inv = _q2.copy(this.state.quat).invert();
    const l = _v6.copy(p).sub(this.state.pos).applyQuaternion(inv);
    if (l.y > 2.5) return;
    const r = 0.45;
    let moved = false;
    for (const [x0, x1, z0, z1] of FOOTPRINT) {
      if (l.x <= x0 - r || l.x >= x1 + r || l.z <= z0 - r || l.z >= z1 + r) continue;
      // out through the nearest side
      const d = [l.x - (x0 - r), x1 + r - l.x, l.z - (z0 - r), z1 + r - l.z];
      const m = Math.min(...d);
      if (m === d[0]) l.x = x0 - r;
      else if (m === d[1]) l.x = x1 + r;
      else if (m === d[2]) l.z = z0 - r;
      else l.z = z1 + r;
      moved = true;
    }
    if (moved) p.copy(l.applyQuaternion(this.state.quat)).add(this.state.pos);
  }

  syncVisual(camWorld) {
    const wp = this.state.worldPosition(_v);
    this.group.position.copy(wp).sub(camWorld);
    this.state.worldQuaternion(this.group.quaternion);
    if (this.heatU && this.reentryMat) this.heatU.uHeatDir.value.copy(this.reentryMat.uniforms.uVel.value).applyQuaternion(this.group.quaternion);
    // landing light at low altitude
    if (this.landLight) {
      const dark = this.game.isDark ? 1 : 0;
      this.landLight.intensity = (this.altitude < 200 && this.mode !== 'pulse' ? 1 : 0) * dark * 400;
    }
  }
}

// Adds the re-entry glow to a hull material: emissive on the faces that lead into the flow.
function applyHeat(material, u) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uHeatDir = u.uHeatDir;
    shader.uniforms.uHeatPower = u.uHeatPower;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeatN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvHeatN = mat3(modelMatrix) * objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeatN;\nuniform vec3 uHeatDir;\nuniform float uHeatPower;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uHeatPower > 0.001) {
          float lead = max(dot(normalize(vHeatN), uHeatDir), 0.0);
          // concentrated on the faces square to the flow: a broad glow bloomed the whole ship into a fireball
          totalEmissiveRadiance += mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.62, 0.3), lead * lead) * uHeatPower * (pow(lead, 4.0) * 1.8 + lead * 0.2);
        }`,
      );
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + 'heat';
  material.needsUpdate = true;
}

let _flameTex = null;
// additive exhaust cone: brightest at the nozzle and down its axis, fading along its length and
// toward its edges, with a little turbulence running down it
function plumeMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uPower: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      varying float vA;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vT = -position.y;
        vA = atan(position.x, position.z);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uTime;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      varying float vA;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        // facing the camera = looking through the middle of the jet
        float face = abs(dot(normalize(vN), normalize(vV)));
        float body = pow(face, 1.6);
        float fade = pow(1.0 - clamp(vT, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.06, vT);
        float rip = 0.8 + 0.2 * sin(vT * 22.0 - uTime * 40.0 + vA * 3.0);
        float a = body * fade * rip * (0.35 + 0.65 * uPower);
        vec3 c = mix(uColor, vec3(1.0), smoothstep(0.35, 0.0, vT) * 0.6);
        gl_FragColor = vec4(c * a * 2.4, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function flameTexture() {
  if (_flameTex) return _flameTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _flameTex = new THREE.CanvasTexture(c);
  return _flameTex;
}
