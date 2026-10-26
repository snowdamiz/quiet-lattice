// Asset review scene (IMPLEMENTATION_PLAN 0.4 and 0.10.3, P1.E14.T03). Open the client with `#review:<asset>` to load
// public/models/<asset>.glb beside the camera under the art bible's three lighting cases: noon on a lush world, night on
// an exotic world, and open space. `window.review` then switches the light, the LOD (0 or 2), a wireframe overlay and the
// camera's orbit, reads a perf readout and captures frames. `pnpm capture -- --review <asset>` drives it headless and
// writes the grader's captures; a person can drive the same object from the console.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const LIGHT_CASES = {
  // sun 8° from the zenith over open ground on the home system's lush world
  'noon-lush': { planetType: 'lush', sunAngle: 8, azimuth: 30 },
  // 160° from the zenith: deep night, lit by the sky, the exotic world's own glow and the asset's emissives
  'night-exotic': { planetType: 'alien', sunAngle: 160, azimuth: 30 },
  // well clear of every atmosphere, sunlit from the side
  'open-space': { space: true },
};

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Review {
  constructor(game) {
    this.game = game;
    this.asset = null;
    this.root = new THREE.Group();
    this.root.name = 'review';
    this.case = null;
    this.lodLevel = 0;
    this.wire = null;
    this.orbit = { azimuth: 35, elevation: 16, distance: 1.7 };
    this.size = 1;
    this.held = false;
    this.realFrame = game.frame.bind(game);
    this.panel = null;
    this.hookCamera();
  }

  // ---------- the asset ----------

  async load(asset) {
    const url = /\.glb$/.test(asset) ? asset : `/models/${asset}.glb`;
    const gltf = await new GLTFLoader().loadAsync(url);
    if (this.asset) this.root.remove(this.asset);
    this.name = asset;
    this.asset = gltf.scene;
    this.root.add(this.asset);
    this.lods = collectLods(this.asset);
    this.lod(this.lodLevel);
    return this.stats();
  }

  /** Shows one LOD (0–3). An asset without LOD nodes shows everything at every level. */
  lod(n) {
    this.lodLevel = n;
    if (this.lods.size) {
      const have = [...this.lods.keys()].sort((a, b) => a - b);
      const pick = have.includes(n) ? n : have.filter((l) => l <= n).pop() ?? have[0];
      for (const [l, nodes] of this.lods) for (const o of nodes) o.visible = l === pick;
    }
    this.measure();
    if (this.wire) {
      this.wireframe(false);
      this.wireframe(true);
    }
    return this.stats();
  }

  /** The wireframe pass: every surface in flat clay with its edges drawn over it, so topology reads at a glance. */
  wireframe(on) {
    if (this.wire) {
      this.wire.parent?.remove(this.wire);
      this.wire.traverse((o) => o.geometry?.dispose());
      this.wire = null;
      for (const [mesh, mat] of this.shaded ?? []) mesh.material = mat;
      this.shaded = null;
    }
    if (!on) return;
    this.wire = new THREE.Group();
    this.shaded = new Map();
    const clay = new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const line = new THREE.LineBasicMaterial({ color: 0x15181c });
    this.asset.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.asset.matrixWorld).invert();
    this.asset.traverseVisible((o) => {
      if (!o.isMesh) return;
      this.shaded.set(o, o.material);
      o.material = clay;
      const lines = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), line);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(inv).multiply(o.matrixWorld);
      this.wire.add(lines);
    });
    this.asset.add(this.wire);
  }

  /** The visible LOD's bounds in the review root's own space (so the floating origin never moves them). */
  measure() {
    const box = new THREE.Box3();
    const inv = new THREE.Matrix4();
    this.root.updateMatrixWorld(true);
    inv.copy(this.root.matrixWorld).invert();
    const b = new THREE.Box3();
    this.asset.traverseVisible((o) => {
      if (!o.isMesh || o.parent === this.wire) return;
      o.geometry.computeBoundingBox();
      box.union(b.copy(o.geometry.boundingBox).applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld)));
    });
    this.box = box.isEmpty() ? box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1)) : box;
    this.size = Math.max(0.5, this.box.getSize(_v).length() / 2);
  }

  stats() {
    let tris = 0;
    let meshes = 0;
    const materials = new Set();
    this.asset?.traverseVisible((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const m of [].concat(o.material)) materials.add(m.name || m.uuid);
    });
    const size = this.box ? this.box.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(2)) : null;
    return { asset: this.name, lod: this.lodLevel, lods: [...(this.lods?.keys() || [])].sort(), triangles: Math.round(tris), meshes, materials: [...materials], size };
  }

  // ---------- the light cases ----------

  /** Moves the review spot to one of LIGHT_CASES and waits for the terrain under it to stream in. */
  async light(name) {
    const lc = LIGHT_CASES[name];
    if (!lc) throw new Error(`unknown light case ${name}; one of ${Object.keys(LIGHT_CASES).join(', ')}`);
    const g = this.game;
    this.case = name;
    this.root.parent?.remove(this.root);
    if (lc.space) {
      // the ship parked far off; the asset floats in the system frame beside the camera
      const home = g.system.homePlanet;
      const sunDir = _v.copy(g.system.star.position).sub(home.position).normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(sunDir).normalize();
      this.spaceSpot = home.position.clone().addScaledVector(side, home.radius * 4).addScaledVector(sunDir, home.radius);
      g.mode = 'ship';
      const s = g.ship.state;
      s.frame = null;
      s.pos.copy(this.spaceSpot).addScaledVector(side, 5000);
      s.vel.set(0, 0, 0);
      g.ship.mode = 'flying';
      g.ship.speed = 0;
      this.frame = null;
      this.root.position.set(0, 0, 0);
      this.root.quaternion.identity();
      g.engine.scene.add(this.root);
    } else {
      const planet = g.system.planets.find((p) => p.params?.type === lc.planetType && p.landable && !p.isGas);
      if (!planet) throw new Error(`no ${lc.planetType} world in ${g.system.name}`);
      if (g.mode !== 'foot') {
        g.mode = 'ship';
        g.debugGoto(planet, { sunAngle: lc.sunAngle, alt: 0, azimuth: lc.azimuth, land: true });
        g.exitShip();
        g.poseBlend = null;
        g.dip = null;
      } else g.debugGoto(planet, { sunAngle: lc.sunAngle, alt: 0, azimuth: lc.azimuth, land: true });
      // stand where the ship would be; the ship itself goes down 60 m behind so it never shares the frame
      const s = g.ship.state;
      const up = s.pos.clone().normalize();
      const p = g.player.state;
      p.frame = planet;
      p.pos.copy(s.pos);
      p.vel.set(0, 0, 0);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      s.pos.addScaledVector(fwd, -60);
      s.pos.copy(s.pos.normalize().multiplyScalar(planet.groundRadius(s.pos) + 1.95));
      // the asset on the ground ahead of where the player stands, its up along the local vertical
      const spot = p.pos.clone().addScaledVector(fwd, Math.max(6, this.size * 3));
      const dir = spot.clone().normalize();
      spot.copy(dir).multiplyScalar(planet.groundRadius(dir) + 0.02);
      this.frame = planet;
      this.root.position.copy(spot);
      const right = new THREE.Vector3().crossVectors(fwd, dir).normalize();
      _m.makeBasis(right, dir, new THREE.Vector3().crossVectors(right, dir));
      this.root.quaternion.setFromRotationMatrix(_m);
      planet.root.add(this.root);
    }
    g.cam.frame = undefined;
    g.sky.reset();
    await this.settle();
    return this.case;
  }

  // ---------- camera ----------

  /** Orbit the camera: azimuth and elevation in degrees round the asset's up axis, distance in asset radii. */
  view(azimuth = this.orbit.azimuth, elevation = this.orbit.elevation, distance = this.orbit.distance) {
    Object.assign(this.orbit, { azimuth, elevation, distance });
  }

  hookCamera() {
    const g = this.game;
    const pose = (out) => {
      if (!this.case) return false;
      this.measure();
      // root-local centre and camera offset, then into the frame the asset lives in
      const center = this.box.getCenter(new THREE.Vector3());
      const az = THREE.MathUtils.degToRad(this.orbit.azimuth);
      const el = THREE.MathUtils.degToRad(this.orbit.elevation);
      const d = this.size * this.orbit.distance;
      const offset = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d);
      // where the asset sits in its frame: planet-local on a world; in open space the root is kept on the floating
      // origin, so its true place is the system-frame spot
      const origin = this.case === 'open-space' ? this.spaceSpot : this.root.position;
      const toFrame = new THREE.Matrix4().compose(origin, this.root.quaternion, new THREE.Vector3(1, 1, 1));
      const target = center.clone().applyMatrix4(toFrame);
      const eye = center.clone().add(offset).applyMatrix4(toFrame);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
      out.frame = this.frame ?? null;
      out.pos.copy(eye);
      _m.lookAt(eye, target, up);
      out.quat.setFromRotationMatrix(_m);
      return true;
    };
    const cameraState = g.player.cameraState.bind(g.player);
    g.player.cameraState = (out, time) => (pose(out) ? out : cameraState(out, time));
    const updateCamera = g.ship.updateCamera.bind(g.ship);
    g.ship.updateCamera = (dt, inp, out) => (pose(out) ? out : updateCamera(dt, inp, out));
    // in open space the asset sits in the system frame: keep it on the floating origin before each render
    const renderFrame = g.renderFrame.bind(g);
    g.renderFrame = (dt) => {
      if (this.case === 'open-space' && this.spaceSpot) this.root.position.copy(this.spaceSpot).sub(g.camWorld);
      // the review camera is not the player's eye: no first-person tool in the shot
      if (this.case) g.multitool.view.visible = false;
      renderFrame(dt);
    };
  }

  // ---------- frames ----------

  /** Stops the page's own frame loop so frames advance only when the review asks (captures are then deterministic). */
  hold() {
    if (this.held) return;
    this.held = true;
    this.game.frame = () => {};
    this.game.engine.adapt = () => {};
  }

  async step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      this.realFrame(dt);
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** Runs frames until the terrain and flora workers are idle (bounded), so captures never show half-built ground. */
  async settle(maxFrames = 600) {
    for (let i = 0; i < maxFrames; i++) {
      await this.step(2);
      await new Promise((r) => setTimeout(r, 4));
      if (i > 20 && this.game.pool.pending() === 0) break;
    }
    await this.step(4);
  }

  /** Renders one frame and returns it as a PNG data URL (read back in the same task, before the buffer clears). */
  capture() {
    this.realFrame(1 / 600);
    return this.game.engine.renderer.domElement.toDataURL('image/png');
  }

  /** Frame cost over `frames` steps: CPU ms per frame, and CPU plus GPU (the frame waited out with gl.finish), median
   * and p95; draw calls and triangles of one frame. Run after `settle()`: streaming terrain shows up in p95. */
  async perf(frames = 120) {
    const r = this.game.engine.renderer;
    const gl = r.getContext();
    const times = [];
    const full = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      this.realFrame(1 / 60);
      const t1 = performance.now();
      gl.finish();
      times.push(t1 - t0);
      full.push(performance.now() - t0);
      if (i % 10 === 9) await new Promise((res) => setTimeout(res, 0));
    }
    const auto = r.info.autoReset;
    r.info.autoReset = false;
    r.info.reset();
    this.realFrame(1 / 60);
    const info = { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs?.length ?? 0 };
    r.info.autoReset = auto;
    const q = (arr, p) => {
      const s = [...arr].sort((a, b) => a - b);
      return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
    };
    return { case: this.case, lod: this.lodLevel, cpuMsMedian: q(times, 0.5), cpuMsP95: q(times, 0.95), frameMsMedian: q(full, 0.5), frameMsP95: q(full, 0.95), drawCalls: info.calls, frameTriangles: info.triangles, programs: info.programs, asset: this.stats() };
  }

  // ---------- on-screen readout ----------

  showPanel() {
    if (this.panel) return;
    const el = (this.panel = document.createElement('div'));
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:50;font:12px/1.5 var(--font-mono);color:var(--text);background:var(--plate);padding:10px 12px;border:1px solid var(--line-2);pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    setInterval(() => {
      const s = this.stats();
      const info = this.game.engine.renderer.info.render;
      el.textContent = `review  ${s.asset}\nlight   ${this.case}\nLOD     ${s.lod} of [${s.lods.join(', ') || 'none'}]\ntris    ${s.triangles.toLocaleString()}\nmeshes  ${s.meshes}  materials ${s.materials.length}\ncalls   ${info.calls}`;
    }, 250);
  }
}

/** LOD level → nodes, from node names ending in `_LOD<n>` (the export convention, art bible §8). */
function collectLods(root) {
  const lods = new Map();
  root.traverse((o) => {
    const m = /_LOD(\d)$/.exec(o.name);
    if (!m) return;
    const l = +m[1];
    if (!lods.has(l)) lods.set(l, []);
    lods.get(l).push(o);
  });
  return lods;
}

/** `#review:<asset>`: start a silent game, then put the asset under noon on the lush world. */
export async function startReview(game, asset) {
  const review = new Review(game);
  window.review = review;
  await review.load(asset);
  await review.light('noon-lush');
  review.showPanel();
  game.hud.setVisible(false);
  return review;
}
