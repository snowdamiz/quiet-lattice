// The galaxy across every scale, in light years. Up close, the reachable star systems of the local
// cluster hang in 3D among the nearby field stars and nebulae. Zoom out and the cluster shrinks to
// a speck in one arm of a spiral galaxy ninety thousand light years across; further, that galaxy is
// one smudge among others; and three million light years out, filling one side of everything,
// is the edge of space.
import * as THREE from 'three';
import { mapNoiseGLSL, starPointVert, starPointFrag, starfieldPoints, worldPointVert, worldPointFrag, discVert, discFrag, nebFrag } from './mapCommon.js';
import { buildEdge, EDGE_X, edgeX, EDGE_SEED } from './EdgeOfSpace.js';
import { mulberry32 } from '../../math/rng.js';
import { cosmos, GALAXY, fmtLy } from '../../universe/Cosmos.js';

const _v = new THREE.Vector3();

export { fmtLy };



// nebulae near the cluster: camera-facing billboards of domain-warped glow
const nebVert = /* glsl */ `
  uniform float uScale;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uScale;
    gl_Position = projectionMatrix * mv;
  }`;

// from inside the cluster, the rest of the galaxy is a band of light right round the sky,
// thickest and warmest toward the core, split by dark dust lanes
const bandVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const bandFrag = /* glsl */ `
  uniform vec3 uCore;
  uniform float uAlpha;
  varying vec3 vDir;
  ${mapNoiseGLSL}
  void main() {
    vec3 d = normalize(vDir);
    float core = max(dot(d, uCore), 0.0);
    float n = fbm(d * 6.0);
    float lat = d.y + (n - 0.5) * 0.035;
    float width = 0.06 + 0.12 * pow(core, 3.0);
    float band = exp(-lat * lat / (width * width));
    float lane = exp(-pow((lat + 0.01) / (width * 0.32), 2.0)) * smoothstep(0.35, 0.75, fbm(d * 11.0 + 2.0));
    float clouds = 0.45 + 0.9 * smoothstep(0.2, 0.9, fbm(d * 19.0 + 7.0));
    float bulge = exp(-(1.0 - core) * 26.0);
    vec3 c = mix(vec3(0.5, 0.58, 0.95), vec3(1.0, 0.82, 0.62), pow(core, 2.0));
    vec3 col = c * (band * (0.4 + 0.6 * pow(core, 2.0)) * clouds * (1.0 - 0.75 * lane) + bulge * 0.7);
    gl_FragColor = vec4(col * uAlpha, 1.0);
  }`;

// a faint local grid for depth, gone once the view pulls back past the cluster
const gridVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }`;
const gridFrag = /* glsl */ `
  uniform vec3 uFocus;
  uniform float uFade;
  varying vec3 vW;
  void main() {
    float d = length(vW - uFocus);
    float a = 0.07 * (1.0 - smoothstep(60.0, 260.0, d)) * uFade;
    gl_FragColor = vec4(vec3(0.55, 0.62, 1.0) * a, 1.0);
  }`;

// the hyperspace route: a raised arc with light running along it
const routeVert = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const routeFrag = /* glsl */ `
  uniform float uTime;
  varying float vT;
  void main() {
    float dash = smoothstep(0.35, 0.5, fract(vT * 14.0 - uTime * 0.8)) * smoothstep(0.85, 0.7, fract(vT * 14.0 - uTime * 0.8));
    vec3 c = mix(vec3(0.62, 0.53, 1.0), vec3(0.5, 0.94, 0.85), vT);
    gl_FragColor = vec4(c * (0.35 + 1.8 * dash), 1.0);
  }`;

export class GalaxyMap {
  constructor(view) {
    this.view = view;
    this.game = view.game;
    this.minDistance = 6;
    this.maxDistance = 9.5e6;
    this.near = 0.3;
    this.far = 9e7;
    this.zoomSpeed = 3;
    this.scaleBar = true;
    this.bloom = 0.75;
    this.camDist = 100;
  }

  build() {
    if (this.scene) {
      this.refresh();
      return;
    }
    const g = this.game;
    const gal = g.galaxy;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x000002);
    this.mats = [];
    this.pointMats = [];

    // the farthest stars, all round — except toward the edge, where there is nothing at all
    const shell = starfieldPoints(5000, 6e7, 0.45);
    {
      const p = shell.geometry.attributes.position;
      const c = shell.geometry.attributes.color;
      for (let i = 0; i < p.count; i++) if (p.getX(i) > 1.2e7) c.setXYZ(i, 0, 0, 0);
    }
    scene.add(shell);

    scene.add(this.buildMilkyBand());
    scene.add(this.buildLocalField());
    scene.add(this.buildGalaxy());
    scene.add(this.buildGalaxyDisc());
    this.buildOtherGalaxies(scene);
    this.buildNebulae(scene);
    scene.add(this.buildGrid());

    this.edge = buildEdge(mulberry32(EDGE_SEED));
    scene.add(this.edge.group);

    // the reachable systems
    this.items = [];
    const N = gal.systems.length;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    gal.systems.forEach((s, i) => {
      pos.set([s.x, s.y, s.z], i * 3);
      size[i] = 2.2;
      c.set(s.color);
      col.set([c.r * 4.5, c.g * 4.5, c.b * 4.5], i * 3);
      const it = {
        kind: 'system',
        sys: s,
        name: s.name,
        position: new THREE.Vector3(s.x, s.y, s.z),
        pickRadius: 1.4,
        focusDistance: 40,
        label: s.name,
        labelClass: '',
        labelOffset: 12,
        labelVisible: (v) => this.labelVisible(v, it),
      };
      this.items.push(it);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.sysMat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uScale: { value: 1500 } },
      vertexShader: starPointVert,
      fragmentShader: starPointFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(geo, this.sysMat));

    // the galaxy and the edge, as things to select
    this.galaxyItem = {
      kind: 'galaxy',
      name: GALAXY.name,
      position: GALAXY.center.clone(),
      pickRadius: GALAXY.radius * 0.35,
      focusDistance: 140000,
      label: GALAXY.name,
      labelClass: 'big',
      labelOffset: 34,
      labelVisible: () => this.camDist > 20000 && this.camDist < 4e6,
    };
    this.edgeItem = {
      kind: 'edge',
      name: 'The Edge',
      position: new THREE.Vector3(EDGE_X - 1e4, 0, 0),
      labelPosition: new THREE.Vector3(EDGE_X - 3e5, 1.6e6, 0),
      pickRadius: 9e5,
      focusTarget: new THREE.Vector3(EDGE_X - 1e4, 0, 0),
      focusDistance: 4.5e6,
      focusDir: new THREE.Vector3(-1, 0.22, 0.38).normalize(),
      label: 'The Edge',
      labelClass: 'edge',
      labelOffset: 0,
      labelOpacity: 1,
      labelVisible: (v) => this.edgeItem.inView && (this.camDist > 1.5e5 || v.selected === this.edgeItem),
    };
    this.items.push(this.galaxyItem, this.edgeItem);
    // points across the wall, to pin its label on whichever part is in view
    this.edgeAnchors = [];
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) this.edgeAnchors.push(new THREE.Vector3(edgeX(i * 1e6, j * 1e6) - 2e4, i * 1e6, j * 1e6));

    // markers: you are here, visited, selection, route
    const ringGeo = new THREE.RingGeometry(1, 1.07, 96);
    const ringMat = (r, gg, b, o = 1) =>
      new THREE.MeshBasicMaterial({ color: new THREE.Color(r, gg, b), transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.hereRing = new THREE.Mesh(ringGeo, ringMat(0.5, 2.0, 1.7));
    this.herePulse = new THREE.Mesh(ringGeo, ringMat(0.5, 2.0, 1.7));
    this.selRing = new THREE.Mesh(ringGeo, ringMat(1.4, 1.5, 2.6));
    for (const m of [this.hereRing, this.herePulse, this.selRing]) m.frustumCulled = false;
    scene.add(this.hereRing, this.herePulse, this.selRing);
    this.visited = new THREE.Group();
    scene.add(this.visited);
    this.visitedMat = ringMat(0.8, 0.85, 1.2, 0.55);

    const RN = 96;
    const rt = new Float32Array(RN);
    for (let i = 0; i < RN; i++) rt[i] = i / (RN - 1);
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RN * 3), 3));
    rgeo.setAttribute('aT', new THREE.BufferAttribute(rt, 1));
    this.route = new THREE.Line(rgeo, new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: routeVert, fragmentShader: routeFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.route.frustumCulled = false;
    scene.add(this.route);
    this.refresh();
  }

  pointMaterial(max, fadeNear) {
    const m = new THREE.ShaderMaterial({
      uniforms: { uProj: { value: 600 }, uMax: { value: max }, uFadeNear: { value: fadeNear } },
      vertexShader: worldPointVert,
      fragmentShader: worldPointFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pointMats.push(m);
    return m;
  }

  points(n, fill, max, fadeNear) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const count = fill(pos, col, size);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, count * 3), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col.subarray(0, count * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size.subarray(0, count), 1));
    const p = new THREE.Points(geo, this.pointMaterial(max, fadeNear));
    p.frustumCulled = false;
    return p;
  }

  buildMilkyBand() {
    this.bandMat = new THREE.ShaderMaterial({
      uniforms: { uCore: { value: GALAXY.center.clone().normalize() }, uAlpha: { value: 0.5 } },
      vertexShader: bandVert,
      fragmentShader: bandFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(9000, 96, 48), this.bandMat);
    m.frustumCulled = false;
    m.renderOrder = -2;
    return m;
  }

  // the stars round the cluster, in a full 3D volume (the disc is far thicker than this)
  buildLocalField() {
    const f = cosmos().field;
    return this.points(
      f.count,
      (pos, col, size) => {
        pos.set(f.pos);
        size.set(f.size);
        for (let i = 0; i < f.count; i++) for (let k = 0; k < 3; k++) col[i * 3 + k] = f.tint[i * 3 + k] * f.lum[i];
        return f.count;
      },
      3.2,
      0,
    );
  }

  // the spiral galaxy: an old, warm bulge; thin arms of young blue stars and pink star-forming knots
  buildGalaxy() {
    const st = cosmos().stars;
    return this.points(
      st.count,
      (pos, col, size) => {
        pos.set(st.pos);
        col.set(st.col);
        size.set(st.size);
        return st.count;
      },
      3,
      2000,
    );
  }

  // seen from far off, the galaxy also glows as one disc
  buildGalaxyDisc() {
    const S = GALAXY.radius * 2.1;
    this.discMat = this.discMaterial({ arms: 4, twist: 1.9, seed: 3.1, alpha: 0, ellip: 0, size: S, core: [1.0, 0.82, 0.62], arm: [0.55, 0.65, 1.0] });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(S, S), this.discMat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(GALAXY.center);
    m.frustumCulled = false;
    return m;
  }

  discMaterial({ arms, twist, seed, alpha, ellip, size, core, arm }) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uArms: { value: arms },
        uTwist: { value: twist },
        uSeed: { value: seed },
        uAlpha: { value: alpha },
        uEllip: { value: ellip },
        uSize: { value: size },
        uCore: { value: new THREE.Vector3(...core) },
        uArm: { value: new THREE.Vector3(...arm) },
      },
      vertexShader: discVert,
      fragmentShader: discFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }

  // other galaxies, scattered through the millions of light years between us and the edge
  buildOtherGalaxies(scene) {
    for (const g of cosmos().galaxies) {
      const mat = this.discMaterial(g);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(g.size, g.size), mat);
      if (g.ellip) m.scale.y = 0.62;
      m.position.copy(g.position);
      m.rotation.copy(g.rotation);
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  buildNebulae(scene) {
    const quad = new THREE.PlaneGeometry(1, 1);
    for (const n of cosmos().nebulae) {
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
        vertexShader: nebVert,
        fragmentShader: nebFrag,
        transparent: true,
        depthWrite: false,
        blending: n.dark ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(quad, mat);
      m.position.copy(n.position);
      m.frustumCulled = false;
      m.renderOrder = n.dark ? 1 : 0;
      this.mats.push(mat);
      scene.add(m);
    }
  }

  buildGrid() {
    const pts = [];
    const S = 300;
    for (let i = -S; i <= S; i += 20) pts.push(-S, 0, i, S, 0, i, i, 0, -S, i, 0, S);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.gridMat = new THREE.ShaderMaterial({
      uniforms: { uFocus: { value: new THREE.Vector3() }, uFade: { value: 1 } },
      vertexShader: gridVert,
      fragmentShader: gridFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const grid = new THREE.LineSegments(geo, this.gridMat);
    grid.frustumCulled = false;
    return grid;
  }

  // which system labels to show: yours, the selected and hovered ones, visited ones, neighbours
  labelVisible(v, it) {
    const g = this.game;
    const s = it.sys;
    if (s === g.galaxy.current) return this.camDist < 3e4;
    if (v.selected === it || v.hovered === it) return this.camDist < 3e4;
    const d = v.camera.position.distanceTo(it.position);
    if (s.visited && d < 400) return true;
    if (this.neighbors.has(s) && d < 220) return true;
    return d < 60;
  }

  refresh() {
    const g = this.game;
    const gal = g.galaxy;
    this.neighbors = new Set(gal.neighbors(10).map((n) => n.s));
    this.items.forEach((it) => {
      if (it.kind !== 'system') return;
      const s = it.sys;
      it.labelClass = s === gal.current ? 'you-sys' : this.neighbors.has(s) ? '' : 'minor';
      if (it.el) it.el.className = `map-label ${it.labelClass}`;
    });
    this.visited.clear();
    for (const s of gal.systems) {
      if (!s.visited || s === gal.current) continue;
      const m = new THREE.Mesh(this.hereRing.geometry, this.visitedMat);
      m.position.set(s.x, s.y, s.z);
      m.scale.setScalar(1.8);
      this.visited.add(m);
    }
  }

  update(dt, time) {
    const v = this.view;
    const g = this.game;
    const cur = g.galaxy.current;
    const pr = v.renderer.getPixelRatio();
    const H = v.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    const proj = H / (2 * Math.tan(THREE.MathUtils.degToRad(v.camera.fov / 2)));
    // (you are where the ship is: between the stars too)
    const hp = g.galaxy.here;
    const curPos = new THREE.Vector3(hp.x, hp.y, hp.z);
    this.camDist = v.camera.position.distanceTo(curPos);
    // from inside the galaxy the edge is a far, dim glow; its light show comes up once the view
    // pulls out past the neighbouring galaxies, or closes on it
    const cam = v.camera.position;
    this.edgeDist = edgeX(cam.y, cam.z) - cam.x;
    const reveal = Math.max(THREE.MathUtils.smoothstep(this.camDist, 2e5, 1.5e6), 1 - THREE.MathUtils.smoothstep(this.edgeDist, 4e5, 2.6e6));
    this.edge.update(time, pr, reveal, proj);
    this.placeEdgeLabel();
    this.bandMat.uniforms.uAlpha.value = 0.9 * (1 - THREE.MathUtils.smoothstep(cam.length(), 1500, 5000));
    for (const m of this.pointMats) m.uniforms.uProj.value = proj;
    this.sysMat.uniforms.uPixelRatio.value = pr;
    for (const m of this.mats) m.uniforms.uTime.value = time;
    this.gridMat.uniforms.uFocus.value.copy(v.controls.target);
    this.gridMat.uniforms.uFade.value = 1 - THREE.MathUtils.smoothstep(this.camDist, 400, 1500);
    // the whole galaxy glows as a disc only once it is seen from outside
    this.discMat.uniforms.uAlpha.value = THREE.MathUtils.smoothstep(v.camera.position.distanceTo(GALAXY.center), 4.5e4, 1.6e5) * 0.5;

    const q = v.camera.quaternion;
    // markers keep their size on screen
    const k = Math.max(1, this.camDist / 120);
    this.hereRing.position.copy(curPos);
    this.hereRing.quaternion.copy(q);
    this.hereRing.scale.setScalar(2.4 * k);
    const pulse = (time * 0.45) % 1;
    this.herePulse.position.copy(curPos);
    this.herePulse.quaternion.copy(q);
    this.herePulse.scale.setScalar((2.4 + pulse * 9) * k);
    this.herePulse.material.opacity = (1 - pulse) * 0.8;
    for (const m of this.visited.children) m.quaternion.copy(q);

    const sel = v.selected;
    this.selRing.visible = !!sel && sel.kind === 'system' && (sel.sys !== cur || g.universe.deep);
    this.route.visible = this.selRing.visible;
    if (this.selRing.visible) {
      this.selRing.position.copy(sel.position);
      this.selRing.quaternion.copy(q);
      this.selRing.scale.setScalar(3 * k * (1 + 0.05 * Math.sin(time * 3)));
      const a = curPos;
      const b = sel.position;
      const mid = a.clone().lerp(b, 0.5);
      mid.y += a.distanceTo(b) * 0.28;
      const pos = this.route.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = i / (pos.count - 1);
        const u = 1 - t;
        pos.setXYZ(i, u * u * a.x + 2 * u * t * mid.x + t * t * b.x, u * u * a.y + 2 * u * t * mid.y + t * t * b.y, u * u * a.z + 2 * u * t * mid.z + t * t * b.z);
      }
      pos.needsUpdate = true;
      this.route.material.uniforms.uTime.value = time;
    }
  }

  // the wall is too big to label at one point: pin the label to the part of it nearest the
  // upper right of the screen, and pick it there
  placeEdgeLabel() {
    const cam = this.view.camera;
    let best = null;
    let bd = 1e9;
    for (const a of this.edgeAnchors) {
      _v.copy(a).project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 0.75 || Math.abs(_v.y) > 0.75) continue;
      const d = (_v.x - 0.4) ** 2 + (_v.y - 0.35) ** 2;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    const it = this.edgeItem;
    it.inView = !!best;
    if (best) {
      it.position.copy(best);
      it.labelPosition.copy(best);
    }
  }

  // closer to the edge, the lens bends and fringes, pulled out toward it
  grade(u, camera) {
    const ex = edgeX(camera.position.y, camera.position.z);
    const d = ex - camera.position.x;
    u.uWarp.value = 1 - THREE.MathUtils.smoothstep(d, 2e5, 2.2e6);
    _v.set(EDGE_X, 0, 0).project(camera);
    const dir = new THREE.Vector2(_v.x * camera.aspect, _v.y);
    if (_v.z > 1) dir.multiplyScalar(-1);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0);
    u.uEdgeDir.value.copy(dir.normalize());
  }

  // opens close in on where you are, among the neighbouring stars
  defaultView() {
    const h = this.game.galaxy.here;
    const target = new THREE.Vector3(h.x, h.y, h.z);
    return { target, position: new THREE.Vector3(h.x - 90, h.y + 38, h.z + 72) };
  }

  initialSelection() {
    const sel = this.game.menus.selectedSystem;
    return sel ? this.items.find((it) => it.sys === sel) : null;
  }

  describe(it) {
    const g = this.game;
    if (!it) return null;
    const cur = g.galaxy.current;
    const h = g.galaxy.here;
    if (it.kind === 'edge') {
      return { title: 'The Edge', kind: 'End of the universe', stats: [['Distance', fmtLy(edgeX(h.y, h.z) - h.x)], ['Expansion', '0.0000 c']] };
    }
    if (it.kind === 'galaxy') {
      return { title: GALAXY.name, kind: 'Spiral galaxy · home', stats: [['Across', fmtLy(GALAXY.radius * 2)], ['To the core', fmtLy(GALAXY.center.length())]] };
    }
    const s = it.sys;
    const d = g.galaxy.distance(s, h);
    const here = s === cur && !g.universe.deep;
    return {
      title: s.name,
      kind: here ? 'You are here' : `Class ${s.cls} star${s.visited ? ' · visited' : ''}`,
      stats: here ? [] : [['Distance', fmtLy(d)], ['Warp cells', String(g.inventory.warpCells)]],
      warp: !here,
      course: !here,
    };
  }
}
