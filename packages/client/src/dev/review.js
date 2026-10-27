// Asset review scene (IMPLEMENTATION_PLAN 0.4 and 0.10.3, P1.E14.T03). Open the client with
// `#review:<family>/<file>[:<asset>[/<variant>]]` (or `#review:ship` for a demo model at the top of public/models) to load
// public/models/<family>/<file>.glb beside the camera under the art bible's three lighting cases: noon on a lush world,
// night on an exotic world, and open space. `window.review` then picks the asset and variant, switches the light, the LOD,
// a wireframe pass, a collider and marker overlay and the camera's orbit (or a far view at a range in metres), reads a
// perf readout and captures frames; `review.ready` resolves once the first case has settled. `pnpm capture -- --review
// <family>/<file>` drives it headless and writes the grader's captures; a person can drive the same object from the console.
//
// Captures are reproducible: the page's own loop and adaptive resolution are stopped and the game clock is pinned
// (every review frame starts from the same time, so planets, the sun, wind and weather stand still), the asset is set
// down on the flattest open ground near the case's spot, and plants in its footprint or between it and the camera are
// hidden while it is reviewed. Colliders and markers (art bible 8) are hidden and left out of the stats and framing; the
// overlay pass draws them over the asset.
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

// ---------------------------------------------------------------------------------------------- colliders and markers

// The kinds the overlay draws and the stats count (families.json "markers", art bible 8): colliders, point markers, and
// the pivot empties that move a visible part (a Gear* pivot's own mesh, GearFront_Leg, is the part, not the pivot).
const KINDS = [
  ['COL', /^col_/i],
  ['Interact', /^interact($|_)/i],
  ['HP', /^hp_[sml]_/i],
  ['BAY', /^bay_/i],
  ['Light', /^light_/i],
  ['Mount', /^mount$/i],
  ['Muzzle', /^muzzle($|_)/i],
  ['Gear', /^gear/i, 'pivot'],
  ['Blink', /^blink($|_)/i, 'pivot'],
  ['Spin', /^spin($|_)/i, 'pivot'],
  ['Canopy', /^canopy/i, 'pivot'],
];

/** A node's overlay kind: `COL` for a collider, the marker's kind (Interact, HP, BAY, Light, Mount, Muzzle), the
 * pivot's (Gear, Blink, Spin, Canopy) for an empty that moves a visible part; null for anything else, scale references
 * included. */
export function helperKind(o) {
  const name = nodeName(o);
  for (const [kind, re, role] of KINDS) {
    if (!re.test(name)) continue;
    // (an empty loads as a plain Object3D; a mesh node as a Mesh, or a Group of its primitives when it has several)
    return role === 'pivot' && (o.isMesh || o.isGroup) ? null : kind;
  }
  return null;
}

/** `{ kind: count }` of `items` (`{ kind }`), in KINDS order. */
export function countKinds(items) {
  const out = {};
  for (const [kind] of KINDS) {
    const n = items.filter((it) => it.kind === kind).length;
    if (n) out[kind] = n;
  }
  return out;
}

/** The overlay's colours: colliders magenta, each marker and pivot kind its own hue. */
export const OVERLAY_COLORS = {
  COL: 0xff3fd2,
  Interact: 0x3dff8b,
  HP: 0xff4a3d,
  BAY: 0xffa23d,
  Light: 0xfff1a0,
  Mount: 0xff7a3d,
  Muzzle: 0xff3d7a,
  Gear: 0xffe53d,
  Blink: 0x3de2ff,
  Spin: 0x3de2ff,
  Canopy: 0x9fb4ff,
};

/**
 * Places a label box beside each point (`{ x, y, w, h }`, pixels) so no two boxes overlap and each stays inside the
 * `width` × `height` frame: the first free spot of a ring of offsets around its point, moving outward; a label that
 * finds none keeps its first spot. Returns `[{ x, y }]`, each box's top-left corner.
 */
export function placeLabels(points, width, height, gap = 14) {
  const boxes = [];
  const overlaps = (a) => boxes.some((b) => a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2);
  const inside = (a) => a.x >= 0 && a.y >= 0 && a.x + a.w <= width && a.y + a.h <= height;
  return points.map((p) => {
    let first = null;
    let found = null;
    for (let ring = 0; ring < 12 && !found; ring++) {
      const d = gap + ring * (p.h + 4);
      const spots = [
        [p.x + gap, p.y - d - p.h / 2],
        [p.x + gap, p.y + d - p.h / 2],
        [p.x - gap - p.w, p.y - d - p.h / 2],
        [p.x - gap - p.w, p.y + d - p.h / 2],
      ];
      for (const [x, y] of spots) {
        const box = { x: Math.round(x), y: Math.round(y), w: p.w, h: p.h };
        if (!inside(box)) continue;
        first ??= box;
        if (!overlaps(box)) {
          found = box;
          break;
        }
      }
    }
    const box = found ?? first ?? { x: Math.max(0, Math.min(width - p.w, Math.round(p.x + gap))), y: Math.max(0, Math.min(height - p.h, Math.round(p.y))), w: p.w, h: p.h };
    boxes.push(box);
    return { x: box.x, y: box.y };
  });
}

// ---------------------------------------------------------------------------------------------- paired perf

/** The asset's cost is reliable when the 95% interval of its paired GPU median is at most this wide either side (ms):
 * two runs then agree within twice that. */
export const PERF_CI_MS = 0.25;

/** The shown/hidden order of `pairs` pairs of adjacent frames in ABBA blocks (shown, hidden, hidden, shown, …): a
 * block's two pairs run in opposite orders, so a load that rises or falls across the block cancels. */
export function abba(pairs) {
  const out = [];
  for (let i = 0; i < pairs; i++) out.push(...(i % 2 ? [false, true] : [true, false]));
  return out;
}

/** Shown-minus-hidden differences of `key` over frame records `{ shown, [key] }` taken in abba() order (frames 2i and
 * 2i+1 are pair i), one per pair, null where either frame lacks the value. */
function pairDiffs(frames, key) {
  const d = [];
  for (let i = 0; i + 1 < frames.length; i += 2) {
    const [a, b] = [frames[i], frames[i + 1]];
    const [s, h] = a.shown ? [a, b] : [b, a];
    d.push(a.shown === b.shown || s[key] == null || h[key] == null ? null : s[key] - h[key]);
  }
  return d;
}

/** The paired differences of `key` that both frames measured. */
export function pairedDiffs(frames, key) {
  return pairDiffs(frames, key).filter((x) => x !== null);
}

/** One difference per ABBA block (pairs 2j and 2j+1): the mean of its two pairs, in which a load rising or falling
 * steadily across the block cancels exactly; a block that lost one pair keeps the other. */
export function blockDiffs(frames, key) {
  const p = pairDiffs(frames, key);
  const d = [];
  for (let j = 0; j < p.length; j += 2) {
    const [a, b = null] = [p[j], p[j + 1]];
    if (a !== null && b !== null) d.push((a + b) / 2);
    else if (a !== null || b !== null) d.push(a ?? b);
  }
  return d;
}

/** Median, quartiles and a distribution-free 95% interval of the median (the order statistics at ranks n/2 ± 0.98√n)
 * of `values`; null when there are none. */
export function spread(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  const at = (p) => {
    const i = p * (n - 1);
    const lo = Math.floor(i);
    return s[lo] + (s[Math.min(n - 1, lo + 1)] - s[lo]) * (i - lo);
  };
  const half = 0.98 * Math.sqrt(n);
  return { n, median: at(0.5), q1: at(0.25), q3: at(0.75), ci95: [s[Math.max(0, Math.floor(n / 2 - half))], s[Math.min(n - 1, Math.ceil(n / 2 + half) - 1)]] };
}

/**
 * The asset's own cost from interleaved frame records (`{ shown, cpu, gpu, calls, tris }`, abba() order): the median of
 * the paired differences (each block's two pairs averaged, blockDiffs), so a load that changes from frame to frame
 * cancels within each block and a spike in one block is outvoted by the rest, with the interquartile range and the
 * median's 95% interval over the blocks; `reliable` is false when that interval is wider than `ciMs` either side.
 */
export function assetCost(frames, { ciMs = PERF_CI_MS } = {}) {
  const r = (x) => (x == null ? null : +x.toFixed(3));
  const [gpu, cpu, calls, tris] = ['gpu', 'cpu', 'calls', 'tris'].map((k) => spread(blockDiffs(frames, k)));
  const half = gpu ? (gpu.ci95[1] - gpu.ci95[0]) / 2 : null;
  return {
    cpuMs: r(cpu?.median),
    gpuMs: r(gpu?.median),
    drawCalls: calls ? Math.round(calls.median) : null,
    triangles: tris ? Math.round(tris.median) : null,
    method: 'paired: shown-minus-hidden differences of adjacent frames, each ABBA block\'s two pairs averaged; median and spread over the blocks',
    pairs: pairedDiffs(frames, 'gpu').length,
    blocks: gpu?.n ?? 0,
    gpuMsIqr: gpu ? [r(gpu.q1), r(gpu.q3)] : null,
    gpuMsCi95: gpu ? gpu.ci95.map(r) : null,
    cpuMsIqr: cpu ? [r(cpu.q1), r(cpu.q3)] : null,
    spreadMs: gpu ? r(gpu.q3 - gpu.q1) : null,
    // (a handful of blocks proves nothing however close they are)
    reliable: half !== null && gpu.n >= 20 && half <= ciMs,
  };
}

/** The old readout's per-run summary of frame records (one state): medians and 95th percentiles. */
function summarize(frames, disjoint) {
  const q = (key, p) => {
    const s = frames.map((f) => f[key]).filter((x) => x != null).sort((a, b) => a - b);
    return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3) : null;
  };
  return {
    cpuMsMedian: q('cpu', 0.5),
    cpuMsP95: q('cpu', 0.95),
    gpuMsMedian: q('gpu', 0.5),
    gpuMsP95: q('gpu', 0.95),
    gpuSamples: frames.filter((f) => f.gpu != null).length,
    disjoint,
    drawCalls: q('calls', 0.5),
    triangles: q('tris', 0.5),
  };
}

/** The camera's offset from the asset's centre for an orbit (`azimuth`, `elevation` in degrees, `distance` in asset
 * radii of `size`), or, with `range` set, `range` metres away with `lift` degrees added to the elevation (the far view). */
export function orbitOffset(orbit, size) {
  const az = THREE.MathUtils.degToRad(orbit.azimuth);
  const el = THREE.MathUtils.degToRad(orbit.elevation + (orbit.range ? (orbit.lift ?? 0) : 0));
  const d = orbit.range ?? size * orbit.distance;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d);
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
    this.aids = null; // the overlay's collider volumes and marker gizmos
    // (range: metres from the asset's centre for the far view, null at the orbit distance; lift: degrees added to the
    // elevation there when the ground would hide the asset)
    this.orbit = { azimuth: 35, elevation: 16, distance: 1.7, range: null, lift: 0 };
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
    if (this.aids) {
      this.overlay(false);
      this.overlay(true);
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
      if (!o.isMesh || this.isAid(o)) return;
      this.shaded.set(o, o.material);
      o.material = clay;
      const lines = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), line);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(inv).multiply(o.matrixWorld);
      this.wire.add(lines);
    });
    this.content.add(this.wire);
  }

  /** A line the review itself draws into the asset (the wireframe's edges). */
  isAid(o) {
    return !!o.parent && o.parent === this.wire;
  }

  /** The colliders, markers and pivots of what is shown (`[{ node, kind, name }]`): every node of a kind whose parents
   * are all visible, so the chosen asset, variant and LOD's own. */
  marked() {
    const out = [];
    const parentsShown = (o) => {
      for (let p = o.parent; p && p !== this.content; p = p.parent) if (!p.visible) return false;
      return true;
    };
    this.content.traverse((o) => {
      if (o === this.content || o === this.wire || this.isAid(o)) return;
      const kind = helperKind(o);
      if (kind && parentsShown(o)) out.push({ node: o, kind, name: nodeName(o) });
    });
    return out;
  }

  /**
   * The collider and marker overlay (rubric "fitness for play"): each `COL_*` volume of what is shown drawn translucent
   * over the shaded asset with its edges solid, each marker and pivot a small axis gizmo (x red, y green, z blue) round a
   * dot in its kind's colour. Drawn through the asset (no depth test), so a collider inside the hull or a marker behind
   * it still shows, and over the finished frame (drawAids), so the atmosphere, bloom and grade never tint it and it
   * lights nothing; captureOverlay() adds the names. Follows lod() like the wireframe.
   */
  overlay(on) {
    if (this.aids) {
      this.aids.parent?.remove(this.aids);
      for (const x of this.aids.userData.owned) x.dispose();
      this.aids = null;
    }
    if (!on) return;
    this.aidScene ??= new THREE.Scene();
    const aids = (this.aids = new THREE.Group());
    aids.name = 'review overlay';
    aids.matrixAutoUpdate = false;
    const owned = (aids.userData.owned = []);
    const own = (x) => {
      owned.push(x);
      return x;
    };
    this.content.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.content.matrixWorld).invert();
    // (the canvas takes linear values as they are: a colour set as linear shows as its hex code)
    const basic = (hex, opacity, Mat = THREE.MeshBasicMaterial) =>
      own(new Mat({ color: new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace), transparent: true, opacity, depthTest: false, depthWrite: false, fog: false }));
    const add = (o, local) => {
      o.matrixAutoUpdate = false;
      o.matrix.copy(local);
      o.renderOrder = 10;
      o.frustumCulled = false;
      aids.add(o);
    };
    const arm = Math.max(0.15, this.size * 0.06);
    const axes = own(new THREE.BufferGeometry());
    axes.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], 3));
    axes.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.2, 0.2, 1, 0.2, 0.2, 0.2, 1, 0.2, 0.2, 1, 0.2, 0.3, 0.5, 1, 0.3, 0.5, 1], 3));
    const axesMat = own(new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, fog: false }));
    const dot = own(new THREE.OctahedronGeometry(arm * 0.22));
    const mats = {};
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const local = new THREE.Matrix4();
    for (const { node, kind } of this.marked()) {
      const color = OVERLAY_COLORS[kind];
      mats[kind] ??= { volume: basic(color, 0.24), edge: basic(color, 0.95, THREE.LineBasicMaterial), dot: basic(color, 0.95) };
      if (kind === 'COL') {
        node.traverse((m) => {
          if (!m.isMesh) return;
          local.multiplyMatrices(inv, m.matrixWorld);
          add(new THREE.Mesh(m.geometry, mats[kind].volume), local);
          add(new THREE.LineSegments(own(new THREE.EdgesGeometry(m.geometry, 25)), mats[kind].edge), local);
        });
        continue;
      }
      // (a gizmo of fixed size, along the marker's own axes whatever its scale)
      local.multiplyMatrices(inv, node.matrixWorld).decompose(pos, quat, scl);
      add(new THREE.LineSegments(axes, axesMat), new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(arm, arm, arm)));
      add(new THREE.Mesh(dot, mats[kind].dot), new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)));
    }
    this.aidScene.add(aids);
  }

  /** Draws the overlay over the frame just finished, in the asset's place (the content's world matrix of that frame). */
  drawAids() {
    const E = this.game.engine;
    const r = E.renderer;
    this.aids.matrix.copy(this.content.matrixWorld);
    this.aids.matrixWorldNeedsUpdate = true;
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(null);
    r.render(this.aidScene, E.camera);
    r.autoClear = ac;
  }

  /**
   * One frame with the overlay (turned on for it if it is off) and each marker's and pivot's name drawn beside it, with a
   * legend of the counts by kind; returns a PNG data URL. The labels are drawn on a 2D copy of the frame, so they are
   * crisp at any distance and never hidden by the asset.
   */
  async captureOverlay() {
    const font = (px, weight = 500) => `${weight} ${px}px "IBM Plex Mono", ui-monospace, monospace`;
    await document.fonts?.load(font(20)).catch(() => {});
    const was = !!this.aids;
    if (!was) this.overlay(true);
    const items = this.marked();
    // (render and copy in one task: the drawing buffer is cleared once the task ends)
    this.frameOnce(1 / 60);
    const src = this.game.engine.renderer.domElement;
    const cam = this.game.engine.camera;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    if (!was) this.overlay(false);
    const px = Math.max(12, Math.round(c.height / 54));
    const hex = (k) => `#${OVERLAY_COLORS[k].toString(16).padStart(6, '0')}`;
    g.font = font(px);
    g.textBaseline = 'middle';
    const pads = { x: Math.round(px * 0.45), y: Math.round(px * 0.3) };
    const marks = [];
    const v = new THREE.Vector3();
    for (const it of items) {
      if (it.kind === 'COL') continue;
      v.setFromMatrixPosition(it.node.matrixWorld).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) continue;
      marks.push({ ...it, x: ((v.x + 1) / 2) * c.width, y: ((1 - v.y) / 2) * c.height, w: Math.ceil(g.measureText(it.name).width) + pads.x * 2, h: px + pads.y * 2 });
    }
    const spots = placeLabels(marks, c.width, c.height);
    marks.forEach((m, i) => {
      const s = spots[i];
      g.strokeStyle = hex(m.kind);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.lineTo(s.x < m.x ? s.x + m.w : s.x, s.y + m.h / 2);
      g.stroke();
      g.fillStyle = 'rgba(8, 10, 14, 0.82)';
      g.fillRect(s.x, s.y, m.w, m.h);
      g.strokeRect(s.x + 0.5, s.y + 0.5, m.w - 1, m.h - 1);
      g.fillStyle = hex(m.kind);
      g.beginPath();
      g.arc(m.x, m.y, 4, 0, Math.PI * 2);
      g.fill();
      g.fillText(m.name, s.x + pads.x, s.y + m.h / 2 + 1);
    });
    // the legend: what each colour is and how many of it the shown asset has
    const counts = countKinds(items);
    const names = { COL: 'COL_* colliders', HP: 'HP_* hardpoints', BAY: 'BAY_* bays', Light: 'Light_* lights', Gear: 'Gear* pivots', Blink: 'Blink pivots', Spin: 'Spin pivots', Canopy: 'Canopy* pivots' };
    const lines = [[null, `colliders and markers  ${this.sel.asset}${this.sel.variant !== this.sel.asset ? ` / ${this.sel.variant}` : ''}  LOD${this.lodLevel}`]];
    for (const [k, n] of Object.entries(counts)) lines.push([k, `${names[k] ?? k}  ${n}`]);
    // (the kinds the rubric's fitness criterion asks about, said outright when there are none)
    const absent = ['COL', 'Interact', 'HP', 'BAY', 'Gear'].filter((k) => !counts[k]).map((k) => (names[k] ?? k).split(' ')[0]);
    if (absent.length) lines.push([null, `none: ${absent.join(', ')}`]);
    const lh = Math.round(px * 1.5);
    const lw = Math.max(...lines.map(([, t]) => g.measureText(t).width)) + px * 2.6;
    g.fillStyle = 'rgba(8, 10, 14, 0.78)';
    g.fillRect(16, 16, lw, lh * lines.length + px * 0.8);
    lines.forEach(([k, t], i) => {
      const y = 16 + px * 0.4 + lh * i + lh / 2;
      if (k) {
        g.fillStyle = hex(k);
        g.fillRect(16 + px * 0.6, y - px * 0.35, px * 0.7, px * 0.7);
      }
      g.fillStyle = k ? '#e9e7e2' : '#ffffff';
      g.fillText(t, 16 + (k ? px * 1.8 : px * 0.6), y + 1);
    });
    this.lastOverlay = { counts, labelled: marks.map((m) => m.name), offscreen: items.filter((it) => it.kind !== 'COL').length - marks.length };
    return c.toDataURL('image/png');
  }

  /** The visible meshes' bounds in the review root's own space (so the floating origin never moves them). Computed when
   * the asset, variant or LOD changes, never per frame. */
  bounds() {
    const box = new THREE.Box3();
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.content.traverseVisible((o) => {
      if (!o.isMesh || this.isAid(o)) return;
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
      if (!o.isMesh || this.isAid(o)) return;
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
      // colliders, markers and pivots of what is shown, by kind (what the overlay draws)
      kinds: this.content ? countKinds(this.marked()) : {},
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
        g.director.clear();
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

  /**
   * The far view (rubric "silhouette and read: identifiable at LOD2 from 100 m"): the camera `meters` from the asset's
   * centre at the orbit's azimuth and elevation, LOD `lod` shown, nothing cropped or zoomed (the game's own camera at the
   * capture size), then `frames` frames settled so the ground and plants round the new eye stream in. Where the ground
   * would hide the asset's centre from there, the elevation is raised in 2° steps until it does not (`lift` in the
   * result). `near()` puts the camera back at the orbit distance.
   */
  far(meters = 100, { lod = 2, frames = 120 } = {}) {
    return this.serial(async () => {
      Object.assign(this.orbit, { range: meters, lift: 0 });
      this.lod(lod);
      this.updateView();
      while (this.groundBlocks() && this.orbit.elevation + this.orbit.lift < 60) {
        this.orbit.lift += 2;
        this.updateView();
      }
      await this.settle(frames);
      const v = this.model.assets.find((a) => a.name === this.sel.asset)?.variants.find((x) => x.name === this.sel.variant);
      return {
        range: meters,
        lod,
        shown: v ? (this.shown[v.name] ?? null) : null,
        azimuth: this.orbit.azimuth,
        elevation: this.orbit.elevation + this.orbit.lift,
        lift: this.orbit.lift,
        clear: !this.groundBlocks(),
        case: this.case,
        plantsHidden: this.floraHidden ?? 0,
        settled: this.settled,
      };
    });
  }

  /** Back from the far view to the orbit distance (the next light() or settle() streams the ground in again). */
  near() {
    return this.serial(() => {
      Object.assign(this.orbit, { range: null, lift: 0 });
      this.updateView();
    });
  }

  /** True when the ground (sampled along the line of sight, short of the asset's own bounds) hides the asset's centre
   * from the eye; never in open space. */
  groundBlocks() {
    const planet = this.frame;
    if (!planet) return false;
    const L = this.eyeLocal.distanceTo(this.targetLocal);
    const stop = Math.max(0, 1 - this.size / L);
    const p = new THREE.Vector3();
    for (let i = 0; i <= 64; i++) {
      p.lerpVectors(this.eyeLocal, this.targetLocal, (i / 64) * stop);
      const r = p.length();
      if (r < planet.groundRadius(p.divideScalar(r)) + 0.25) return true;
    }
    return false;
  }

  /** The camera's eye and target in the frame the asset lives in (planet-local on a world); plants in the way are
   * re-hidden on the next flora rebuild. */
  updateView() {
    const center = this.frameBox.getCenter(new THREE.Vector3());
    const offset = orbitOffset(this.orbit, this.size);
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
    // the review camera is not the player's eye: no first-person tool, no parked ship, no creatures wandering in; the
    // overlay, when on, over the finished frame
    const render = g.engine.render.bind(g.engine);
    g.engine.render = (dt) => {
      if (this.active) {
        g.multitool.view.visible = false;
        g.ship.group.visible = false;
        if (g.fauna?.root) g.fauna.root.visible = false;
      }
      render(dt);
      if (this.active && this.aids) this.drawAids();
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

  /**
   * `pairs` pairs of adjacent frames in abba() order, the asset shown in one frame of each pair and hidden in the other,
   * appended to `out` as `{ shown, cpu, gpu, calls, tris }`: CPU ms (the frame's JavaScript and WebGL calls, started on
   * an idle GPU so no back-pressure from earlier frames is counted), GPU ms (timer queries, or the frame waited out
   * with a pixel read where the extension is missing; null for a frame the timer lost), and the frame's draw calls and
   * triangles. Returns the number of disjoint timer events (each loses the frames then in flight).
   */
  async sampleInterleaved(pairs, out) {
    const r = this.game.engine.renderer;
    const gl = r.getContext();
    const ext = this.gpuTimer();
    const pending = [];
    let disjoint = 0;
    const collect = () => {
      if (!ext) return;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        disjoint++;
        for (const p of pending.splice(0)) gl.deleteQuery(p.q);
        return;
      }
      while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const p = pending.shift();
        p.rec.gpu = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(p.q);
      }
    };
    const order = abba(pairs);
    for (let i = 0; i < order.length; i++) {
      const rec = { shown: order[i], cpu: null, gpu: null, calls: null, tris: null };
      this.root.visible = rec.shown;
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
        // (waited out here, so the frame's commands are submitted on their own: otherwise the frame before each yield
        // shares a submission with the page's present and reads about 1 ms slow, always on the same side of a pair)
        this.sync();
        pending.push({ q, rec });
      } else {
        this.sync();
        rec.gpu = performance.now() - t0;
      }
      rec.cpu = t1 - t0;
      rec.calls = r.info.render.calls;
      rec.tris = r.info.render.triangles;
      out.push(rec);
      // (query results only arrive between tasks)
      if (i % 4 === 3) {
        await yieldTask();
        collect();
      }
    }
    this.root.visible = true;
    for (let k = 0; k < 200 && pending.length; k++) {
      await new Promise((res) => setTimeout(res, 5));
      collect();
    }
    for (const p of pending) gl.deleteQuery(p.q);
    return disjoint;
  }

  /**
   * The perf readout at the current case and LOD. Settles until `steady` frames in a row are under budget, then takes
   * `pairs` pairs of adjacent frames, the asset shown in one and hidden in the other (ABBA blocks), at the same spot and
   * view; the asset's own cost is the median of the paired differences (assetCost: each block's two pairs averaged), so
   * a load that comes and goes between frames cancels. While the median's 95% interval is wider than `ciMs` either side,
   * it takes `pairs` more, up to `maxPairs`;
   * a cost still that uncertain is flagged `reliable: false`. `scene` and `withoutAsset` summarise the shown and the
   * hidden frames as the unpaired readout did (`asset.unpaired` is their difference).
   */
  perf({ frames, pairs = frames ?? 120, maxPairs = 720, ciMs = PERF_CI_MS, budgetMs = 1000 / 60, steady = 30, maxWarmup = 600 } = {}) {
    return this.serial(async () => {
      const warm = await this.warmUp(budgetMs, steady, maxWarmup);
      const recs = [];
      let disjoint = 0;
      let cost;
      do {
        disjoint += await this.sampleInterleaved(Math.min(pairs, maxPairs - recs.length / 2), recs);
        cost = assetCost(recs, { ciMs });
      } while (!cost.reliable && recs.length / 2 < maxPairs);
      const shown = summarize(
        recs.filter((f) => f.shown),
        disjoint,
      );
      const hidden = summarize(
        recs.filter((f) => !f.shown),
        disjoint,
      );
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
        asset: { ...cost, ciTargetMs: ciMs, unpaired: { cpuMs: d('cpuMsMedian'), gpuMs: d('gpuMsMedian') } },
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
        `hidden  ${s.colliders} colliders, ${s.markers} markers, ${this.floraHidden ?? 0} plants${this.aids ? '  (overlay on)' : ''}\n` +
        `camera  ${this.orbit.range ? `${this.orbit.range} m` : `${this.orbit.distance} radii`}\ncalls   ${info.calls}` +
        (p
          ? `\nasset   ${p.asset.cpuMs} ms cpu  ${p.asset.gpuMs} ms gpu  ${p.asset.drawCalls} calls\n        gpu IQR ${p.asset.gpuMsIqr?.join(' to ') ?? '-'} ms over ${p.asset.pairs} pairs${p.asset.reliable ? '' : '  (unreliable: spread too wide)'}`
          : '');
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
