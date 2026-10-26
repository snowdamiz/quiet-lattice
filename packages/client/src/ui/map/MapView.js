// The navigation map: a navigable 3D view drawn with the game's own renderer while the map is open
// (the game stops drawing then). One scene at a time — the star system or the galaxy — each built by
// its own module, with orbit / pan / zoom controls, screen-space picking, HTML labels pinned to
// objects, and its own bloom and grading.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SystemMap } from './SystemMap.js';
import { GalaxyMap, fmtLy } from './GalaxyMap.js';

const _v = new THREE.Vector3();

// vignette, a little grain, and lens trouble (chromatic fringes, a barrel warp) that grows as the
// camera nears the edge of space
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uWarp: { value: 0 },
    uEdgeDir: { value: new THREE.Vector2(1, 0) },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uWarp;
    uniform vec2 uEdgeDir;
    uniform float uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      vec2 cc = c * vec2(uAspect, 1.0);
      float r2 = dot(cc, cc);
      // toward the edge, space bends: a barrel warp and fringes pulled out along the edge's side
      float side = clamp(dot(normalize(cc + 1e-5), uEdgeDir) * 0.5 + 0.5, 0.0, 1.0);
      vec2 uv = vUv + c * r2 * uWarp * (0.12 + 0.2 * side);
      float ca = (0.0016 + uWarp * 0.012 * side) * (0.3 + r2 * 2.5);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      col *= 1.0 - smoothstep(0.35, 1.1, r2 * 2.2) * 0.55;
      col += (hash(vUv * 1000.0 + fract(uTime * 7.0)) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class MapView {
  constructor(game, root, { onSelect } = {}) {
    this.game = game;
    this.root = root;
    this.onSelect = onSelect || (() => {});
    this.renderer = game.engine.renderer;
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'map-labels';
    root.appendChild(this.labelLayer);
    this.surface = document.createElement('div');
    this.surface.className = 'map-surface';
    this.surface.style.cssText = 'position:absolute;inset:0;';
    root.insertBefore(this.surface, root.firstChild);
    this.scale = document.createElement('div');
    this.scale.className = 'map-scale hidden';
    this.scale.innerHTML = '<span></span><i></i>';
    root.appendChild(this.scale);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.01, 20000);
    this.controls = new OrbitControls(this.camera, this.surface);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.9;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };
    c.keyPanSpeed = 14;
    c.listenToKeyEvents(window);
    // (off until the map opens: WASD on foot or in flight panned the hidden map by a step over its
    // zero-height surface, which poisoned the camera with NaN before the map was ever seen)
    c.enabled = false;

    this.scenes = { system: new SystemMap(this), galaxy: new GalaxyMap(this) };
    this.tab = 'system';
    this.active = false;
    this.items = [];
    this.hovered = null;
    this.selected = null;
    this.fly = null;
    this.time = 0;
    this.buildComposer();
    this.bindPointer();
  }

  buildComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
    this.renderPass = new RenderPass(new THREE.Scene(), this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.85, 0.65, 0.2);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  bindPointer() {
    const s = this.surface;
    let down = null;
    s.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      s.classList.add('drag');
    });
    window.addEventListener('pointerup', () => s.classList.remove('drag'));
    s.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    s.addEventListener('pointerleave', () => (this.pointer = null));
    s.addEventListener('click', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const it = this.pick(e.clientX, e.clientY);
      if (it) this.select(it);
    });
    s.addEventListener('dblclick', (e) => {
      const it = this.pick(e.clientX, e.clientY);
      if (it) {
        this.select(it);
        this.focus(it);
      }
    });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get current() {
    return this.scenes[this.tab];
  }

  open(tab = this.tab) {
    this.active = true;
    this.controls.enabled = true;
    this.setTab(tab, true);
  }

  close() {
    this.active = false;
    this.controls.enabled = false;
    this.labelLayer.innerHTML = '';
  }

  setTab(tab, reset = false) {
    if (tab !== this.tab) reset = true;
    this.tab = tab;
    const m = this.current;
    m.build();
    this.renderPass.scene = m.scene;
    this.items = m.items;
    this.labelLayer.innerHTML = '';
    for (const it of this.items) {
      if (!it.label) continue;
      it.el = document.createElement('div');
      it.el.className = `map-label ${it.labelClass || ''}`;
      it.el.style.opacity = 0;
      // the labels are the list: click one to select it, double-click to fly there
      if (it.pickable !== false) {
        it.el.addEventListener('click', () => this.select(it));
        it.el.addEventListener('dblclick', () => {
          this.select(it);
          this.focus(it);
        });
      }
      it.el.innerHTML = it.label;
      this.labelLayer.appendChild(it.el);
    }
    this.controls.minDistance = m.minDistance;
    this.controls.maxDistance = m.maxDistance;
    this.controls.zoomSpeed = m.zoomSpeed ?? 0.9;
    this.camera.near = m.near ?? 0.01;
    this.camera.far = m.far ?? 20000;
    this.camera.updateProjectionMatrix();
    this.scale.classList.toggle('hidden', !m.scaleBar);
    if (reset) {
      const v = m.defaultView();
      this.camera.position.copy(v.position);
      this.controls.target.copy(v.target);
      this.fly = null;
    }
    this.selected = m.initialSelection?.() || null;
    this.onSelect(this.selected);
  }

  select(it) {
    this.selected = it;
    this.game.audio?.play('ui');
    this.onSelect(it);
  }

  // glide the camera to frame an item
  focus(it) {
    const target = (it.focusTarget || it.position).clone();
    const dist = it.focusDistance || 10;
    const dir = it.focusDir || this.camera.position.clone().sub(this.controls.target).normalize();
    this.fly = {
      t: 0,
      fromTarget: this.controls.target.clone(),
      fromPos: this.camera.position.clone(),
      toTarget: target,
      toPos: target.clone().addScaledVector(dir, dist),
    };
  }

  pick(x, y) {
    let best = null;
    let bd = 1e9;
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    for (const it of this.items) {
      if (it.pickable === false) continue;
      _v.copy(it.position).project(this.camera);
      if (_v.z > 1) continue;
      const sx = (_v.x * 0.5 + 0.5) * W;
      const sy = (-_v.y * 0.5 + 0.5) * H;
      const r = Math.max(14, (it.pickRadius || 0) * this.pixelsPerUnit(it.position));
      const d = Math.hypot(sx - x, sy - y);
      if (d < r && d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  pixelsPerUnit(p) {
    const d = this.camera.position.distanceTo(p);
    return this.root.clientHeight / (2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.composer.width !== size.x || this.composer.height !== size.y) {
      this.composer.setPixelRatio(1);
      this.composer.setSize(size.x, size.y);
    }
    const aspect = this.root.clientWidth / Math.max(1, this.root.clientHeight);
    if (Math.abs(this.camera.aspect - aspect) > 1e-3) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / 1.4);
      const k = f.t * f.t * (3 - 2 * f.t);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
      if (f.t >= 1) this.fly = null;
    }
    this.controls.update(dt);
    this.current.update(dt, this.time);
    // hover
    const h = this.pointer ? this.pick(this.pointer.x, this.pointer.y) : null;
    if (h !== this.hovered) {
      this.hovered = h;
      this.surface.classList.toggle('hover', !!h);
    }
    this.placeLabels();
    if (this.current.scaleBar) this.placeScale();
  }

  // a bar of a round number of light years, as long as that is at the depth of the focus
  placeScale() {
    const perPx = 1 / this.pixelsPerUnit(this.controls.target);
    const want = 110 * perPx;
    const p = Math.pow(10, Math.floor(Math.log10(want)));
    const n = [1, 2, 5, 10].map((k) => k * p).filter((v) => v <= want).pop() || p;
    const text = fmtLy(n);
    if (text !== this.scaleText) {
      this.scaleText = text;
      this.scale.firstChild.textContent = text;
    }
    this.scale.lastChild.style.width = `${(n / perPx).toFixed(1)}px`;
  }

  placeLabels() {
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    for (const it of this.items) {
      if (!it.el) continue;
      _v.copy(it.labelPosition || it.position).project(this.camera);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && (it.labelVisible ? it.labelVisible(this) : true);
      const show = vis || it === this.selected;
      it.el.style.opacity = show && _v.z < 1 ? (it === this.hovered || it === this.selected ? 1 : it.labelOpacity ?? 0.9) : 0;
      if (_v.z >= 1) continue;
      const sx = (_v.x * 0.5 + 0.5) * W;
      const sy = (-_v.y * 0.5 + 0.5) * H;
      const off = it.labelOffset ?? Math.max(10, (it.pickRadius || 0) * this.pixelsPerUnit(it.position) * 0.7 + 8);
      it.el.style.transform = `translate(${(sx + off).toFixed(1)}px, ${(sy - 8).toFixed(1)}px)`;
      it.el.classList.toggle('sel', it === this.selected);
    }
  }

  render(dt) {
    const r = this.renderer;
    const prev = { tm: r.toneMapping, exp: r.toneMappingExposure, cs: r.outputColorSpace };
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    this.grade.uniforms.uTime.value = this.time;
    this.grade.uniforms.uAspect.value = this.camera.aspect;
    this.current.grade?.(this.grade.uniforms, this.camera);
    if (!this.current.grade) this.grade.uniforms.uWarp.value = 0;
    this.bloom.strength = this.current.bloom ?? 0.85;
    this.composer.render(dt);
    r.toneMapping = prev.tm;
    r.toneMappingExposure = prev.exp;
    r.outputColorSpace = prev.cs;
  }
}
