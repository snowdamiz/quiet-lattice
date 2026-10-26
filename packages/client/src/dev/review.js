// Asset review scene (IMPLEMENTATION_PLAN 0.4 and 0.10.3, P1.E14.T03). Open the client with
// `#review:<family>/<file>[:<asset>[/<variant>]]` (or `#review:ship` for a demo model at the top of public/models) to load
// public/models/<family>/<file>.glb beside the camera under the art bible's three lighting cases: noon on a lush world,
// night on an exotic world, and open space. `window.review` then picks the asset and variant, switches the light, the LOD,
// a wireframe pass and the camera's orbit, reads a perf readout and captures frames; `review.ready` resolves once the
// first case has settled. `pnpm capture -- --review <family>/<file>` drives it headless and writes the grader's captures;
// a person can drive the same object from the console.
//
// Captures are reproducible: the page's own loop and adaptive resolution are stopped and the game clock is pinned
// (every review frame starts from the same time, so planets, the sun, wind and weather stand still), the asset is set
// down on the flattest open ground near the case's spot, and plants in its footprint or between it and the camera are
// hidden while it is reviewed. Colliders and markers (art bible 8) are hidden and left out of the stats and framing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { maskColors } from '../gameplay/modelLibrary.js';
import { GLOW as FLORA_GLOW } from '../gameplay/floraModels.js';
import { gameLook } from '@astra/shared/art';
import { nodeReviewModel } from '../gameplay/Flora.js';

/** `node/<resource>`: a procedural resource node (P1.E13.T02), built by the flora in place of a .glb, its near and far
 * models as LOD0 and LOD1. Anything else: null, and the asset loads from public/models. */
export function nodeAsset(spec, game) {
  const m = /^node\/([a-z_]+)$/.exec(String(spec).split(':')[0]);
  return m ? { scene: new THREE.Group().add(nodeReviewModel(m[1], game)) } : null;
}

export const LIGHT_CASES = {
  // sun 8° from the zenith over open ground on the home system's lush world
  'noon-lush': { planetType: 'lush', sunAngle: 8, azimuth: 30 },
  // 160° from the zenith: deep night, lit by the sky, the exotic world's own glow and the asset's emissives
  'night-exotic': { planetType: 'alien', sunAngle: 160, azimuth: 30 },
  // well clear of every atmosphere, sunlit from the side
  'open-space': { space: true },
};

/** The game time every review frame runs at (s). Any fixed value will do; it only has to be the same every run. */
export const REVIEW_TIME = 120;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();
const yieldTask = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------------------------- the export layout

const LOD_NAME = /^(.+)_(?:LOD|lod|Lod)(\d+)$/;
const BLENDER_SUFFIX = /\.\d{3,}$/;
// colliders and point markers (families.json "markers", roles collider and point) and scale references; the Blink and
// Spin pivots carry a visible mesh and stay
const HELPER = /^(col_|ref_|interact($|_)|light_|hp_[sml]_|bay_|mount$|muzzle($|_))/i;

/** A node's name as Blender wrote it (GLTFLoader keeps the original in userData.name), without a .001 suffix. */
export function nodeName(o) {
  return String(o.userData?.name ?? o.name ?? '').replace(BLENDER_SUFFIX, '');
}

/** Colliders (`COL_*`) and markers: hidden in the review scene and left out of its stats and framing. */
export function isHelper(o) {
  return HELPER.test(nodeName(o));
}

function lodParts(o) {
  const m = LOD_NAME.exec(nodeName(o));
  return m ? { base: m[1], level: +m[2] } : null;
}

// ---------------------------------------------------------------------------------------------- the game's look

// Creatures and flora carry a colour-region mask in their vertex colours that the game fills with a species' or a
// planet's palette (modelLibrary.recolor); the review fills it the same way with the representative palettes and
// material settings of @astra/shared/art's gameLook, plus the game's flora night glow, so the grader sees what a player
// sees, not the raw mask.

/**
 * Fills every mask-coloured mesh under `root` as the game does for `family`; `glow` is the uniform that scales accent
 * glow (the game's flora glow, which rises at night). Returns the number of meshes changed.
 */
export function applyGameLook(root, family, glow = { value: 1 }) {
  let changed = 0;
  for (const top of root.children) {
    const look = gameLook(family, nodeName(top));
    if (!look) continue;
    const kind = nodeName(top)
      .replace(/_(?:lod|LOD)\d+$/, '')
      .replace(/_\d+$/, '');
    const glowAccent = family === 'flora' ? (FLORA_GLOW[kind] ?? 0) : 0;
    const [primary, secondary, accent] = look.palette.map((c) => new THREE.Color(c));
    top.traverse((o) => {
      if (!o.isMesh || isHelper(o) || !o.geometry.attributes.color) return;
      const { col, glow: g } = maskColors(o.geometry, { primary, secondary, accent }, { ...look, glowAccent });
      o.geometry = o.geometry.clone();
      o.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      o.geometry.setAttribute('aGlow', new THREE.BufferAttribute(g, 1));
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: look.roughness, metalness: look.metalness, side: THREE.DoubleSide });
      mat.name = `${family} (game look)`;
      if (glowAccent) {
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uGlow = glow;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow;');
        };
      }
      o.material = mat;
      changed++;
    });
  }
  return changed;
}

/**
 * Reads the export layout back from a loaded glTF scene (art bible 8): `<asset>/<variant>/<variant>_LOD<n>`, a lone
 * variant as `<asset>/<asset>_LOD<n>`, colliders and markers beside the LODs, several assets side by side at the origin.
 * The demo's flat layout (`boulder_0` and `boulder_0_lod1` at the top level) reads as one asset per base name, and a
 * file without LOD nodes as one asset per top-level node with every level showing everything.
 *
 * Returns `{ assets: [{ name, nodes, variants: [{ name, nodes, lods: Map<level, Object3D[]> }] }], helpers }`, where
 * `nodes` are the containers shown only while their asset or variant is picked (never LOD nodes themselves).
 */
export function collectLods(root) {
  const helpers = [];
  root.traverse((o) => o !== root && isHelper(o) && helpers.push(o));
  const assets = [];
  const add = (v, level, node) => {
    if (!v.lods.has(level)) v.lods.set(level, []);
    v.lods.get(level).push(node);
  };
  // the LOD nodes among `parent`'s children, by base name, with a legacy unsuffixed LOD0 beside its `_lod1`
  const lodChildren = (parent) => {
    const kids = parent.children.filter((k) => !isHelper(k));
    const bases = new Set(kids.map(lodParts).filter(Boolean).map((p) => p.base));
    const out = [];
    for (const k of kids) {
      const p = lodParts(k) ?? (bases.has(nodeName(k)) ? { base: nodeName(k), level: 0 } : null);
      out.push([k, p]);
    }
    return out;
  };
  const flat = new Map();
  for (const [top, p] of lodChildren(root)) {
    if (p) {
      let a = flat.get(p.base);
      if (!a) {
        a = { name: p.base, nodes: [], variants: [{ name: p.base, nodes: [], lods: new Map() }] };
        flat.set(p.base, a);
        assets.push(a);
      }
      add(a.variants[0], p.level, top);
      continue;
    }
    const name = nodeName(top);
    const a = { name, nodes: [top], variants: [] };
    const visit = (o) => {
      for (const [k, kp] of lodChildren(o)) {
        if (!kp) {
          visit(k);
          continue;
        }
        let v = a.variants.find((x) => x.name === kp.base);
        if (!v) {
          // the variant's own node, when it has one (`<asset>/<variant>/...`); a lone variant is the asset itself
          v = { name: kp.base, nodes: o !== top && nodeName(o) === kp.base ? [o] : [], lods: new Map() };
          a.variants.push(v);
        }
        add(v, kp.level, k);
      }
    };
    visit(top);
    if (!a.variants.length) a.variants.push({ name, nodes: [], lods: new Map() });
    assets.push(a);
  }
  return { assets, helpers };
}

/** The level shown for a request of `n` when a variant has `levels`: `n` itself, else the nearest lower one, else the
 * lowest it has. */
export function pickLod(levels, n) {
  const have = [...levels].sort((a, b) => a - b);
  if (!have.length) return null;
  if (have.includes(n)) return n;
  const lower = have.filter((l) => l < n);
  return lower.length ? lower[lower.length - 1] : have[0];
}

/**
 * Shows one asset and variant at LOD `n` and hides everything else: other assets and variants, other levels, colliders
 * and markers. `sel.asset` / `sel.variant` are names (default: the first asset, and every variant of the chosen asset).
 * Returns the level each shown variant actually shows.
 */
export function showLod(model, n, sel = {}) {
  const asset = model.assets.find((a) => a.name === sel.asset) ?? model.assets[0];
  const shown = {};
  for (const a of model.assets) {
    const onA = a === asset;
    for (const node of a.nodes) node.visible = onA;
    for (const v of a.variants) {
      const onV = onA && (!sel.variant || v.name === sel.variant);
      for (const node of v.nodes) node.visible = onV;
      const pick = pickLod(v.lods.keys(), n);
      for (const [l, nodes] of v.lods) for (const node of nodes) node.visible = onV && l === pick;
      if (onV) shown[v.name] = pick;
    }
  }
  for (const h of model.helpers) h.visible = false;
  return shown;
}

/** `<family>/<file>[:<asset>[/<variant>]]` → the model's URL and the chosen asset and variant. */
export function parseSpec(spec) {
  const [file, pick = ''] = String(spec).split(':');
  const [asset, variant] = pick.split('/');
  const url = /\.glb$/.test(file) ? file : `/models/${file}.glb`;
  return { file, url, asset: asset || null, variant: variant || null };
}

// ---------------------------------------------------------------------------------------------- placement

/**
 * The flattest dry ground within `range` m of the planet-local unit direction `up0`: candidates on a grid in the tangent
 * plane, each scored by the height range over a disc of radius `reach` (the asset and the camera's ground point), with
 * a small pull toward `up0` so the case's sun angle holds; clear of planned sites and cities. Deterministic: the sampler
 * is seeded.
 */
export function flatSpot(planet, up0, reach, { range = 240 } = {}) {
  const R = planet.radius;
  const t1 = new THREE.Vector3(0, 1, 0).cross(up0);
  if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0).cross(up0);
  t1.normalize();
  const t2 = new THREE.Vector3().crossVectors(up0, t1);
  const step = Math.max(16, reach);
  const n = Math.ceil(range / step);
  const sea = planet.ocean ? 1.5 : -Infinity;
  const dot = (a, b) => (a.x * b.x + a.y * b.y + a.z * b.z) / Math.hypot(a.x, a.y, a.z);
  const avoid = [...(planet.sites ?? []).map((s) => ({ dir: s.dir, r: 160 })), ...(planet.cities ?? []).map((c) => ({ dir: c.dir, r: (c.radius ?? 400) + 250 }))].filter((a) => a.dir);
  const d = new THREE.Vector3();
  const s = new THREE.Vector3();
  const ring = [];
  for (const [rr, k] of [
    [0, 1],
    [0.5, 8],
    [1, 12],
  ])
    for (let i = 0; i < k; i++) ring.push([rr * reach * Math.cos((i / k) * Math.PI * 2), rr * reach * Math.sin((i / k) * Math.PI * 2)]);
  let best = null;
  for (let y = -n; y <= n; y++) {
    for (let x = -n; x <= n; x++) {
      if (x * x + y * y > n * n) continue;
      d.copy(up0).multiplyScalar(R).addScaledVector(t1, x * step).addScaledVector(t2, y * step).normalize();
      if (avoid.some((a) => Math.acos(Math.min(1, dot(a.dir, d))) * R < a.r)) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (const [a, b] of ring) {
        s.copy(d).multiplyScalar(R).addScaledVector(t1, a).addScaledVector(t2, b).normalize();
        const h = planet.heightAt(s);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      if (lo < sea) continue;
      const score = hi - lo + Math.hypot(x, y) * step * 0.004;
      if (!best || score < best.score) best = { dir: d.clone(), score, relief: +(hi - lo).toFixed(2), offset: Math.round(Math.hypot(x, y) * step) };
    }
  }
  return best ?? { dir: up0.clone(), relief: null, offset: 0 };
}

// ---------------------------------------------------------------------------------------------- the review

export class Review {
  constructor(game, { live = true } = {}) {
    this.game = game;
    this.root = new THREE.Group();
    this.root.name = 'review';
    this.content = null;
    this.model = null;
    this.sel = { asset: null, variant: null };
    this.case = null; // the light case whose placement has settled
    this.active = false; // the review camera is in charge (from the first placement on)
    this.lodLevel = 0;
    this.shown = {};
    this.wire = null;
    this.orbit = { azimuth: 35, elevation: 16, distance: 1.7 };
    this.box = new THREE.Box3(); // the shown LOD's bounds, root-local
    this.frameBox = new THREE.Box3(); // LOD0's bounds: framing and placement, the same at every level
    this.size = 1;
    this.clock = null;
    this.held = false;
    this.liveOn = false;
    this.wantLive = live;
    this.busy = 0;
    this.queue = Promise.resolve();
    this.realFrame = game.frame.bind(game);
    this.eyeLocal = new THREE.Vector3();
    this.targetLocal = new THREE.Vector3();
    this.lastPerf = null;
    this.panel = null;
    this.hookGame();
  }

  /** Runs `fn` after every review task queued before it, so a light change never overlaps another one's settling. */
  serial(fn) {
    const run = this.queue.then(async () => {
      this.busy++;
      try {
        return await fn();
      } finally {
        this.busy--;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  // ---------- the asset ----------

  async load(spec) {
    const { url, file, asset, variant } = parseSpec(spec);
    const gltf = nodeAsset(spec, this.game) ?? (await new GLTFLoader().loadAsync(url));
    if (this.content) this.root.remove(this.content);
    this.file = file;
    this.content = gltf.scene;
    this.recoloured = applyGameLook(this.content, file.split('/')[0], this.game.flora?.uniforms?.uGlow);
    this.root.add(this.content);
    this.model = collectLods(this.content);
    if (!this.model.assets.length) throw new Error(`${url} holds no asset`);
    this.select(asset, variant);
    return this.stats();
  }

  /** Every asset and variant in the file, in file order: what `pnpm capture` reviews in turn. */
  targets() {
    return (this.model?.assets ?? []).flatMap((a) => a.variants.map((v) => ({ asset: a.name, variant: v.name })));
  }

  /** Picks the asset and variant to review (default: the first of each). Placement follows on the next `light()`. */
  select(asset = null, variant = null) {
    const a = this.model.assets.find((x) => x.name === asset) ?? (asset ? null : this.model.assets[0]);
    if (!a) throw new Error(`no asset ${asset} in ${this.file}; one of ${this.model.assets.map((x) => x.name).join(', ')}`);
    const v = a.variants.find((x) => x.name === variant) ?? (variant ? null : a.variants[0]);
    if (!v) throw new Error(`no variant ${variant} of ${a.name}; one of ${a.variants.map((x) => x.name).join(', ')}`);
    this.sel = { asset: a.name, variant: v.name };
    showLod(this.model, 0, this.sel);
    this.frameBox.copy(this.bounds());
    this.size = Math.max(0.5, this.frameBox.getSize(_v).length() / 2);
    this.lod(this.lodLevel);
    // (the camera reframes at once; the asset is set down afresh by the next light())
    if (this.active) this.updateView();
    return this.sel;
  }

  /** Shows one LOD (0–3) of the chosen variant; a level it lacks falls back to the nearest lower one. */
  lod(n) {
    this.lodLevel = n;
    this.shown = showLod(this.model, n, this.sel);
    this.box.copy(this.bounds());
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
    this.content.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.content.matrixWorld).invert();
    this.content.traverseVisible((o) => {
      if (!o.isMesh) return;
      this.shaded.set(o, o.material);
      o.material = clay;
      const lines = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), line);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(inv).multiply(o.matrixWorld);
      this.wire.add(lines);
    });
    this.content.add(this.wire);
  }

  /** The visible meshes' bounds in the review root's own space (so the floating origin never moves them). Computed when
   * the asset, variant or LOD changes, never per frame. */
  bounds() {
    const box = new THREE.Box3();
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.content.traverseVisible((o) => {
      if (!o.isMesh || o.parent === this.wire) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(_box.copy(o.geometry.boundingBox).applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld)));
    });
    return box.isEmpty() ? box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1)) : box;
  }

  stats() {
    let tris = 0;
    let meshes = 0;
    const materials = new Set();
    this.content?.traverseVisible((o) => {
      if (!o.isMesh || o.parent === this.wire) return;
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const m of [].concat(this.shaded?.get(o) ?? o.material)) materials.add(m.name || m.uuid);
    });
    const a = this.model?.assets.find((x) => x.name === this.sel.asset);
    const v = a?.variants.find((x) => x.name === this.sel.variant);
    // (the chosen asset's own colliders and markers)
    const within = (h, n) => {
      for (let p = h; p; p = p.parent) if (p === n) return true;
      return false;
    };
    const helpers = (this.model?.helpers ?? []).filter((h) => !a?.nodes.length || a.nodes.some((n) => within(h, n)));
    return {
      file: this.file,
      asset: this.sel.asset,
      variant: this.sel.variant,
      lod: this.lodLevel,
      shown: v ? (this.shown[v.name] ?? null) : null,
      lods: v ? [...v.lods.keys()].sort((x, y) => x - y) : [],
      triangles: Math.round(tris),
      meshes,
      materials: [...materials],
      size: this.box.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(2)),
      colliders: helpers.filter((h) => /^col_/i.test(nodeName(h))).length,
      markers: helpers.filter((h) => !/^col_/i.test(nodeName(h))).length,
    };
  }

  // ---------- the light cases ----------

  /** Moves the review spot to one of LIGHT_CASES and settles there (terrain and plants streamed in, plants in the way
   * hidden). Resolves once the case is ready to capture. */
  light(name) {
    return this.serial(() => this.place(name));
  }

  async place(name) {
    const lc = LIGHT_CASES[name];
    if (!lc) throw new Error(`unknown light case ${name}; one of ${Object.keys(LIGHT_CASES).join(', ')}`);
    const g = this.game;
    this.hold();
    this.case = null;
    this.pin();
    this.root.parent?.remove(this.root);
    const reach = Math.max(this.size * 1.3, this.size * this.orbit.distance + 2);
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
      this.spot = null;
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
      const s = g.ship.state;
      const up0 = s.pos.clone().normalize();
      // the flattest open ground nearby, then the asset on it with its lowest point on the ground (the demo's models
      // have their origin at their centre), its up along the local vertical
      const spot = flatSpot(planet, up0, reach);
      const dir = spot.dir;
      this.spot = { relief: spot.relief, offset: spot.offset };
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
      fwd.addScaledVector(dir, -fwd.dot(dir)).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, dir).normalize();
      _m.makeBasis(right, dir, new THREE.Vector3().crossVectors(right, dir));
      this.root.quaternion.setFromRotationMatrix(_m);
      this.root.position.copy(dir).multiplyScalar(planet.groundRadius(dir) - this.frameBox.min.y);
      // the player stands at the spot (the review camera replaces their eyes); the ship is set down 400 m off and hidden
      const p = g.player.state;
      p.frame = planet;
      p.pos.copy(dir).multiplyScalar(planet.groundRadius(dir) + 0.05);
      p.vel.set(0, 0, 0);
      const away = dir.clone().multiplyScalar(planet.radius).addScaledVector(fwd, -400).normalize();
      s.pos.copy(away).multiplyScalar(planet.groundRadius(away) + 1.95);
      this.frame = planet;
      planet.root.add(this.root);
    }
    g.cam.frame = undefined;
    g.sky.reset();
    // the image light in space refreshes on a timer the pinned clock never reaches
    g.spaceEnvTime = -1e9;
    this.active = true;
    this.updateView();
    await this.settle();
    this.case = name;
    return this.case;
  }

  // ---------- camera ----------

  /** Orbit the camera: azimuth and elevation in degrees round the asset's up axis, distance in asset radii. */
  view(azimuth = this.orbit.azimuth, elevation = this.orbit.elevation, distance = this.orbit.distance) {
    Object.assign(this.orbit, { azimuth, elevation, distance });
    this.updateView();
  }

  /** The camera's eye and target in the frame the asset lives in (planet-local on a world); plants in the way are
   * re-hidden on the next flora rebuild. */
  updateView() {
    const center = this.frameBox.getCenter(new THREE.Vector3());
    const az = THREE.MathUtils.degToRad(this.orbit.azimuth);
    const el = THREE.MathUtils.degToRad(this.orbit.elevation);
    const d = this.size * this.orbit.distance;
    const offset = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d);
    // in open space the root is kept on the floating origin, so its true place is the system-frame spot
    const origin = this.frame ? this.root.position : (this.spaceSpot ?? this.root.position);
    const toFrame = new THREE.Matrix4().compose(origin, this.root.quaternion, new THREE.Vector3(1, 1, 1));
    this.targetLocal.copy(center).applyMatrix4(toFrame);
    this.eyeLocal.copy(center).add(offset).applyMatrix4(toFrame);
    this.upLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
    this.viewQuat = new THREE.Quaternion().setFromRotationMatrix(_m.lookAt(this.eyeLocal, this.targetLocal, this.upLocal));
    if (this.game.flora) this.game.flora.dirty = true;
  }

  hookGame() {
    const g = this.game;
    const pose = (out) => {
      if (!this.active) return false;
      out.frame = this.frame ?? null;
      out.pos.copy(this.eyeLocal);
      out.quat.copy(this.viewQuat);
      return true;
    };
    const cameraState = g.player.cameraState.bind(g.player);
    g.player.cameraState = (out, time) => (pose(out) ? out : cameraState(out, time));
    const updateCamera = g.ship.updateCamera.bind(g.ship);
    g.ship.updateCamera = (dt, inp, out) => (pose(out) ? out : updateCamera(dt, inp, out));
    // in open space the asset sits in the system frame: keep it on the floating origin before each render
    const renderFrame = g.renderFrame.bind(g);
    g.renderFrame = (dt) => {
      if (this.active && !this.frame && this.spaceSpot) this.root.position.copy(this.spaceSpot).sub(g.camWorld);
      renderFrame(dt);
    };
    // the review camera is not the player's eye: no first-person tool, no parked ship, no creatures wandering in
    const render = g.engine.render.bind(g.engine);
    g.engine.render = (dt) => {
      if (this.active) {
        g.multitool.view.visible = false;
        g.ship.group.visible = false;
        if (g.fauna?.root) g.fauna.root.visible = false;
      }
      render(dt);
    };
    // plants in the asset's footprint or between it and the camera are left out of the flora's instances (only while
    // reviewing: the keys are put back after each rebuild, so nothing is mined for real)
    const f = g.flora;
    const rebuild = f.rebuild.bind(f);
    f.rebuild = () => {
      const added = [];
      if (this.active && this.frame && f.planet === this.frame) {
        for (const key of this.floraInView()) {
          if (f.mined.has(key)) continue;
          f.mined.add(key);
          added.push(key);
        }
      }
      rebuild();
      for (const key of added) f.mined.delete(key);
      this.floraHidden = added.length;
    };
  }

  /** Keys of the plant instances whose bounds touch the asset's bounding sphere or the cone from the eye to it. */
  floraInView() {
    const f = this.game.flora;
    const eye = this.eyeLocal;
    const target = this.targetLocal;
    const radius = this.size * 1.05;
    const axis = new THREE.Vector3().subVectors(target, eye);
    const L = axis.length();
    axis.normalize();
    const k = L > radius ? radius / Math.sqrt(L * L - radius * radius) : Infinity;
    const mid = new THREE.Vector3().addVectors(eye, target).multiplyScalar(0.5);
    const keys = [];
    const c = new THREE.Vector3();
    for (const it of f.instancesNear(mid, L / 2 + radius + 12)) {
      const h = (it.sp.height ?? 1) * it.scale;
      const r = Math.max(h * 0.5, (it.sp.hitRadius ?? 0.5) * it.scale) + 0.15;
      c.copy(it.up).multiplyScalar(h * 0.5).add(it.pos);
      if (c.distanceTo(target) < radius + r) {
        keys.push(it.key);
        continue;
      }
      _v.subVectors(c, eye);
      const t = _v.dot(axis);
      if (t < -r || t > L) continue;
      const perp = _v.addScaledVector(axis, -t).length();
      if (perp < Math.max(0, t) * k + 0.3 + r) keys.push(it.key);
    }
    return keys;
  }

  // ---------- frames ----------

  /** Stops the page's own frame loop and its adaptive resolution, fixes the pixel ratio and pins the game clock: frames
   * then advance only when the review asks, all at the same game time, so captures are reproducible. */
  hold() {
    if (this.held) return;
    this.held = true;
    const g = this.game;
    const E = g.engine;
    g.frame = () => {};
    E.adapt = () => {};
    E.pixelRatio = E.maxPixelRatio;
    E.renderer.setPixelRatio(E.pixelRatio);
    E.resize();
    this.clock = REVIEW_TIME;
    this.pin();
  }

  /** The pinned clock: game time, and the wind and weather shaders' own clocks. */
  pin() {
    if (this.clock === null) return;
    const g = this.game;
    g.time = this.clock;
    if (g.flora?.uniforms) g.flora.uniforms.uTime.value = this.clock;
    if (g.weather?.uniforms) g.weather.uniforms.uTime.value = this.clock;
    g.system.update(this.clock);
    g.station.update(this.clock);
  }

  frameOnce(dt = 1 / 60) {
    const g = this.game;
    if (this.clock !== null) {
      g.time = this.clock;
      if (g.flora?.uniforms) g.flora.uniforms.uTime.value = this.clock;
      if (g.weather?.uniforms) g.weather.uniforms.uTime.value = this.clock;
    }
    this.realFrame(dt);
  }

  async step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      this.frameOnce(dt);
      if (i % 10 === 9) await yieldTask();
    }
  }

  /**
   * Runs a fixed number of frames, each one waiting for the terrain and flora workers to finish the jobs it queued
   * (bounded) before the next one starts, so captures never show half-built ground. How far the ground and plants have
   * streamed in, and every value the frames ease toward, then depend on the frame count alone, not on how fast the
   * workers ran: two runs end in the same state.
   */
  async settle(frames = 180) {
    const g = this.game;
    let waits = 0;
    for (let i = 0; i < frames; i++) {
      this.frameOnce(1 / 60);
      // (the pool hands out queued jobs only when asked; results land between tasks)
      for (let k = 0; k < 1000 && g.pool.pending() > 0; k++) {
        g.pool.update();
        await new Promise((r) => setTimeout(r, 2));
        waits++;
      }
      if (i % 10 === 9) await yieldTask();
    }
    this.settled = { frames, idle: g.pool.pending() === 0, waits };
  }

  /** Shows the scene in a browser tab: a frame loop on the pinned clock that pauses while a review task runs. */
  live(on = true) {
    this.liveOn = on;
    if (!on || this.liveRaf) return;
    const tick = () => {
      this.liveRaf = this.liveOn ? requestAnimationFrame(tick) : 0;
      if (this.liveOn && !this.busy) this.frameOnce(1 / 60);
    };
    this.liveRaf = requestAnimationFrame(tick);
  }

  /** Renders one frame and returns it as a PNG data URL (read back in the same task, before the buffer clears). */
  capture() {
    this.frameOnce(1 / 60);
    return this.game.engine.renderer.domElement.toDataURL('image/png');
  }

  // ---------- performance ----------

  gpuTimer() {
    if (this._timer === undefined) this._timer = this.game.engine.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2') || null;
    return this._timer;
  }

  /** Waits on the GPU for the frame just drawn (a 1×1 read of the default framebuffer). */
  sync() {
    const r = this.game.engine.renderer;
    const gl = r.getContext();
    r.setRenderTarget(null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, (this._px ||= new Uint8Array(4)));
  }

  /**
   * Runs frames (each waited out on the GPU) until `steady` in a row come in under `budgetMs`, at most `max`. A scene
   * that never gets under budget is settled once `steady` frames in a row stay within 15% of their median (nothing
   * left streaming in); the readout says which.
   */
  async warmUp(budgetMs, steady, max) {
    let run = 0;
    let i = 0;
    const recent = [];
    let stable = false;
    for (; i < max && run < steady && !stable; i++) {
      this.sync();
      const t0 = performance.now();
      this.frameOnce(1 / 60);
      this.sync();
      const ms = performance.now() - t0;
      run = ms < budgetMs ? run + 1 : 0;
      recent.push(ms);
      if (recent.length > steady) recent.shift();
      if (recent.length === steady && i >= steady * 2) {
        const med = [...recent].sort((a, b) => a - b)[steady >> 1];
        stable = recent.every((x) => Math.abs(x - med) <= med * 0.15);
      }
      if (i % 5 === 4) await yieldTask();
    }
    const med = recent.length ? +[...recent].sort((a, b) => a - b)[recent.length >> 1].toFixed(2) : null;
    return { frames: i, underBudget: run >= steady, stable: run >= steady || stable, frameMs: med };
  }

  /** `frames` frames: CPU ms (the frame's JavaScript and WebGL calls, started on an idle GPU so no back-pressure from
   * earlier frames is counted), GPU ms (timer queries, or the frame waited out with a pixel read where the extension is
   * missing), and the draw calls and triangles of a frame. */
  async sample(frames) {
    const r = this.game.engine.renderer;
    const gl = r.getContext();
    const ext = this.gpuTimer();
    const cpu = [];
    const gpu = [];
    const calls = [];
    const tris = [];
    const pending = [];
    let disjoint = 0;
    const collect = () => {
      if (!ext) return;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        disjoint++;
        for (const q of pending.splice(0)) gl.deleteQuery(q);
        return;
      }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
    };
    for (let i = 0; i < frames; i++) {
      this.sync();
      let q = null;
      if (ext) {
        q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      }
      const t0 = performance.now();
      this.frameOnce(1 / 60);
      const t1 = performance.now();
      if (ext) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(q);
      } else {
        this.sync();
        gpu.push(performance.now() - t0);
      }
      cpu.push(t1 - t0);
      calls.push(r.info.render.calls);
      tris.push(r.info.render.triangles);
      // (query results only arrive between tasks)
      if (i % 4 === 3) {
        await yieldTask();
        collect();
      }
    }
    for (let k = 0; k < 200 && pending.length; k++) {
      await new Promise((res) => setTimeout(res, 5));
      collect();
    }
    for (const q of pending) gl.deleteQuery(q);
    const q = (arr, p) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3);
    };
    return { cpuMsMedian: q(cpu, 0.5), cpuMsP95: q(cpu, 0.95), gpuMsMedian: q(gpu, 0.5), gpuMsP95: q(gpu, 0.95), gpuSamples: gpu.length, disjoint, drawCalls: q(calls, 0.5), triangles: q(tris, 0.5) };
  }

  /**
   * The perf readout at the current case and LOD. Settles until `steady` frames in a row are under budget, then
   * measures `frames` frames with the asset hidden and `frames` with it shown, at the same spot and view; the
   * difference is the asset's own cost.
   */
  perf({ frames = 120, budgetMs = 1000 / 60, steady = 30, maxWarmup = 600 } = {}) {
    return this.serial(async () => {
      const warm = await this.warmUp(budgetMs, steady, maxWarmup);
      this.root.visible = false;
      await this.step(10);
      const hidden = await this.sample(frames);
      this.root.visible = true;
      await this.step(10);
      const shown = await this.sample(frames);
      const d = (k) => (shown[k] === null || hidden[k] === null ? null : +(shown[k] - hidden[k]).toFixed(3));
      const timer = !!this.gpuTimer();
      const r = this.game.engine.renderer;
      this.lastPerf = {
        case: this.case,
        lod: this.lodLevel,
        viewport: [r.domElement.width, r.domElement.height],
        gpuTiming: timer ? 'EXT_disjoint_timer_query_webgl2 (GPU time of the frame)' : 'readPixels sync (no timer queries here: CPU+GPU wall time of the frame, the frame waited out with a 1x1 pixel read)',
        budgetMs: +budgetMs.toFixed(2),
        settle: { ...warm, steady },
        scene: shown,
        withoutAsset: hidden,
        asset: { cpuMs: d('cpuMsMedian'), gpuMs: d('gpuMsMedian'), drawCalls: d('drawCalls'), triangles: d('triangles') },
        stats: this.stats(),
      };
      return this.lastPerf;
    });
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
      const p = this.lastPerf;
      const others = this.targets().length - 1;
      el.textContent =
        `review  ${s.file}  ${s.asset}${s.variant !== s.asset ? ` / ${s.variant}` : ''}${others > 0 ? `  (+${others} more)` : ''}\n` +
        `light   ${this.case ?? '…'}\nLOD     ${s.lod} → ${s.shown ?? '-'} of [${s.lods.join(', ') || 'none'}]\n` +
        `tris    ${s.triangles.toLocaleString()}\nmeshes  ${s.meshes}  materials ${s.materials.length}\n` +
        `hidden  ${s.colliders} colliders, ${s.markers} markers, ${this.floraHidden ?? 0} plants\ncalls   ${info.calls}` +
        (p ? `\nasset   ${p.asset.cpuMs} ms cpu  ${p.asset.gpuMs} ms gpu  ${p.asset.drawCalls} calls` : '');
    }, 250);
  }
}

/** `#review:<spec>`: hold the started game, load the asset and settle it under noon on the lush world. `review.ready`
 * resolves (with the stats) once that first case is ready to capture. */
export function startReview(game, spec, { live = !window.__reviewCapture } = {}) {
  const review = new Review(game, { live });
  window.review = review;
  review.ready = (async () => {
    review.hold();
    game.hud.setVisible(false);
    await review.load(spec);
    await review.light('noon-lush');
    review.showPanel();
    if (live) review.live(true);
    return review.stats();
  })();
  review.ready.catch((e) => console.error(`review: ${e?.message ?? e}`));
  return review;
}
