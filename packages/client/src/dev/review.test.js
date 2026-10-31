import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gameLook } from '@astra/shared/art';
import { abba, applyGameLook, assetCost, blockDiffs, collectLods, countKinds, helperKind, meshBox, orbitOffset, pairedDiffs, parseSpec, pickLod, placeLabels, showLod, spread, wireOver } from './review.js';

// A node tree in the export layout (art bible 8), as GLTFLoader builds it: three.js names sanitised, Blender's names
// kept in userData.name.
function node(name, ...children) {
  const o = new THREE.Object3D();
  o.name = name.replace(/\./g, '');
  o.userData.name = name;
  for (const c of children) o.add(c);
  return o;
}
function mesh(name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  m.name = name;
  m.userData.name = name;
  return m;
}

// Crate: a lone variant, LOD0..2 (LOD2 an empty holding its mesh), a collider and an interact marker beside them.
// Rock: two variants side by side at the origin; Rock_b has no LOD2.
function exportLayout() {
  const root = new THREE.Group();
  root.add(
    node('Crate', mesh('Crate_LOD0'), mesh('Crate_LOD1'), node('Crate_LOD2', mesh('crate_low')), mesh('COL_crate'), node('Interact')),
    node(
      'Rock',
      node('Rock_a', mesh('Rock_a_LOD0'), mesh('Rock_a_LOD1'), mesh('Rock_a_LOD2'), mesh('COL_rock_a')),
      node('Rock_b', mesh('Rock_b_LOD0'), mesh('Rock_b_LOD1.001')),
    ),
  );
  return root;
}

/** Names of the meshes that would draw (visible all the way up). */
function drawn(root) {
  const out = [];
  root.traverseVisible((o) => o.isMesh && out.push(o.userData.name));
  return out.sort();
}

describe('review: collectLods', () => {
  it('reads assets, variants, levels and helpers from the export layout', () => {
    const model = collectLods(exportLayout());
    expect(model.assets.map((a) => a.name)).toEqual(['Crate', 'Rock']);
    const [crate, rock] = model.assets;
    expect(crate.variants.map((v) => v.name)).toEqual(['Crate']);
    expect([...crate.variants[0].lods.keys()]).toEqual([0, 1, 2]);
    expect(rock.variants.map((v) => v.name)).toEqual(['Rock_a', 'Rock_b']);
    expect([...rock.variants[1].lods.keys()]).toEqual([0, 1]);
    expect(model.helpers.map((h) => h.userData.name).sort()).toEqual(['COL_crate', 'COL_rock_a', 'Interact']);
  });

  it('reads the demo flat layout as one asset per base name and a file without LODs as one asset', () => {
    const flat = new THREE.Group();
    flat.add(mesh('boulder_0'), mesh('boulder_0_lod1'), mesh('bush_0'), mesh('bush_0_lod1'));
    const model = collectLods(flat);
    expect(model.assets.map((a) => [a.name, [...a.variants[0].lods.keys()]])).toEqual([
      ['boulder_0', [0, 1]],
      ['bush_0', [0, 1]],
    ]);
    const ship = new THREE.Group();
    ship.add(node('Ship', mesh('Body'), node('GearFront', mesh('GearFront_Leg'))));
    const one = collectLods(ship);
    expect(one.assets.map((a) => a.name)).toEqual(['Ship']);
    showLod(one, 2);
    expect(drawn(ship)).toEqual(['Body', 'GearFront_Leg']);
  });
});

describe('review: the level picker', () => {
  it('falls back to the nearest lower level, else the lowest one', () => {
    expect(pickLod([0, 1, 2, 3], 2)).toBe(2);
    expect(pickLod([0, 1], 2)).toBe(1);
    expect(pickLod([0, 3], 2)).toBe(0);
    expect(pickLod([2, 3], 1)).toBe(2);
    expect(pickLod([], 1)).toBe(null);
  });

  it('lod(2) shows only LOD2 of the chosen asset, colliders hidden', () => {
    const root = exportLayout();
    const model = collectLods(root);
    const shown = showLod(model, 2, { asset: 'Crate' });
    expect(shown).toEqual({ Crate: 2 });
    expect(drawn(root)).toEqual(['crate_low']);
  });

  it('shows one variant at a time, and a missing level falls back to the nearest lower one', () => {
    const root = exportLayout();
    const model = collectLods(root);
    expect(showLod(model, 2, { asset: 'Rock', variant: 'Rock_b' })).toEqual({ Rock_b: 1 });
    expect(drawn(root)).toEqual(['Rock_b_LOD1.001']);
    expect(showLod(model, 0, { asset: 'Rock', variant: 'Rock_a' })).toEqual({ Rock_a: 0 });
    expect(drawn(root)).toEqual(['Rock_a_LOD0']);
    // no colliders or markers at any level
    for (const n of [0, 1, 2, 3]) {
      showLod(model, n, { asset: 'Rock', variant: 'Rock_a' });
      expect(drawn(root).some((x) => /^COL_/.test(x))).toBe(false);
    }
  });
});

describe('review: parseSpec', () => {
  it('splits <family>/<file>[:<asset>[/<variant>]]', () => {
    expect(parseSpec('ship')).toEqual({ file: 'ship', url: '/models/ship.glb', asset: null, variant: null });
    expect(parseSpec('flora/trees:Round/Round_b')).toEqual({ file: 'flora/trees', url: '/models/flora/trees.glb', asset: 'Round', variant: 'Round_b' });
    expect(parseSpec('props/pods:Cargo')).toMatchObject({ asset: 'Cargo', variant: null });
  });
});

// A mesh painted with a colour-region mask: every vertex pure R (primary), G (secondary) or B (accent), occlusion 1.
function masked(name, rgb) {
  const m = mesh(name);
  const n = m.geometry.attributes.position.count;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) c.set([...rgb, 1], i * 4);
  m.geometry.setAttribute('color', new THREE.BufferAttribute(c, 4));
  return m;
}

describe('review: the game look', () => {
  it('fills a creature mask with the creature palette, as the game does, instead of drawing the raw mask', () => {
    const root = new THREE.Group();
    const body = masked('grazer_body', [1, 0, 0]);
    root.add(node('quad_grazer_0', body));
    expect(applyGameLook(root, 'creatures')).toBe(1);
    const col = body.geometry.attributes.color;
    expect(col.itemSize).toBe(3);
    const primary = new THREE.Color(0x8a6b4f);
    expect([col.getX(0), col.getY(0), col.getZ(0)].map((v) => +v.toFixed(4))).toEqual([primary.r, primary.g, primary.b].map((v) => +v.toFixed(4)));
    expect(body.material.vertexColors).toBe(true);
  });

  it('gives flora kinds their palette and glow, and leaves other families and colliders alone', () => {
    expect(gameLook('flora', 'deposit_0')?.palette[2]).toBe(0xff8a2a);
    expect(gameLook('flora', 'rock_1_lod1')?.palette[0]).toBe(0x7a746c);
    expect(gameLook('ship', 'Ship')).toBeNull();
    const root = new THREE.Group();
    const hull = masked('Hull', [1, 0, 0]);
    root.add(node('Ship', hull));
    expect(applyGameLook(root, 'ship')).toBe(0);
    expect(hull.geometry.attributes.color.itemSize).toBe(4);
    const flora = new THREE.Group();
    const col = masked('COL_rock', [1, 0, 0]);
    flora.add(node('rock_0', masked('rock_0_mesh', [0, 1, 0]), col));
    expect(applyGameLook(flora, 'flora')).toBe(1);
    expect(col.geometry.attributes.color.itemSize).toBe(4);
  });
});

describe('review: overlay kinds', () => {
  it("names colliders, markers and pivots, and leaves a pivot's own mesh and scale references alone", () => {
    const kind = (n, isMesh = false) => helperKind(isMesh ? mesh(n) : node(n));
    expect(kind('COL_deck', true)).toBe('COL');
    expect(kind('col_rock.001', true)).toBe('COL');
    expect(['Interact', 'Interact_2', 'interact.001'].map((n) => kind(n))).toEqual(['Interact', 'Interact', 'Interact']);
    expect(['HP_S_L', 'hp_m_nose', 'HP_L_dorsal'].map((n) => kind(n))).toEqual(['HP', 'HP', 'HP']);
    expect(['BAY_1', 'Light_0', 'Mount', 'Muzzle', 'Muzzle_2'].map((n) => kind(n))).toEqual(['BAY', 'Light', 'Mount', 'Muzzle', 'Muzzle']);
    expect(['GearFront', 'Blink', 'Spin_1', 'Canopy'].map((n) => kind(n))).toEqual(['Gear', 'Blink', 'Spin', 'Canopy']);
    // the part a pivot moves is a mesh: GearFront_Leg, CanopyGlass, BlinkLens are not markers
    expect(kind('GearFront_Leg', true)).toBe(null);
    expect(kind('CanopyGlass', true)).toBe(null);
    expect(kind('BlinkLens', true)).toBe(null);
    // a mesh node with several primitives loads as a Group of them: still the part
    const leg = new THREE.Group();
    leg.userData.name = 'GearLeft_Leg';
    leg.add(mesh('GearLeft_Leg_1'), mesh('GearLeft_Leg_2'));
    expect(helperKind(leg)).toBe(null);
    expect(['REF_Biped', 'Body', 'Interactive', 'HP_X_bad', 'Mounting', 'Lighthouse'].map((n) => kind(n))).toEqual([null, null, null, null, null, null]);
  });

  it('counts by kind in a fixed order, leaving out kinds with none', () => {
    const items = ['Gear', 'COL', 'Interact', 'COL', 'Light'].map((kind) => ({ kind }));
    expect(countKinds(items)).toEqual({ COL: 2, Interact: 1, Light: 1, Gear: 1 });
    expect(Object.keys(countKinds(items))).toEqual(['COL', 'Interact', 'Light', 'Gear']);
    expect(countKinds([])).toEqual({});
  });
});

describe('review: overlay labels', () => {
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('keeps labels apart and inside the frame, even for markers on top of one another', () => {
    const pts = [
      { x: 900, y: 500, w: 120, h: 28 },
      { x: 902, y: 501, w: 160, h: 28 },
      { x: 905, y: 499, w: 90, h: 28 },
      { x: 1910, y: 5, w: 140, h: 28 },
      { x: 3, y: 1075, w: 140, h: 28 },
    ];
    const spots = placeLabels(pts, 1920, 1080);
    const boxes = spots.map((s, i) => ({ ...s, w: pts[i].w, h: pts[i].h }));
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1920);
      expect(b.y + b.h).toBeLessThanOrEqual(1080);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${i} and ${j}`).toBe(false);
    // the first label sits right beside its point
    expect(Math.abs(boxes[0].x - 900)).toBeLessThan(40);
    expect(Math.abs(boxes[0].y + 14 - 500)).toBeLessThan(60);
  });
});

describe('review: the far view', () => {
  it('puts the eye `range` metres from the centre at the orbit angles, or `distance` radii without one', () => {
    const near = orbitOffset({ azimuth: 35, elevation: 16, distance: 1.7, range: null }, 8);
    expect(near.length()).toBeCloseTo(13.6, 6);
    const far = orbitOffset({ azimuth: 35, elevation: 16, distance: 1.7, range: 100, lift: 0 }, 8);
    expect(far.length()).toBeCloseTo(100, 6);
    // the same direction either way
    expect(far.clone().normalize().distanceTo(near.clone().normalize())).toBeLessThan(1e-9);
    expect(THREE.MathUtils.radToDeg(Math.asin(far.y / 100))).toBeCloseTo(16, 6);
    // lift raises the far view only
    const lifted = orbitOffset({ azimuth: 35, elevation: 16, distance: 1.7, range: 100, lift: 4 }, 8);
    expect(THREE.MathUtils.radToDeg(Math.asin(lifted.y / 100))).toBeCloseTo(20, 6);
    expect(orbitOffset({ azimuth: 35, elevation: 16, distance: 1.7, range: null, lift: 4 }, 8).y).toBeCloseTo(near.y, 9);
  });
});

describe('review: framing bounds', () => {
  it('frames a quantized skinned body by its posed vertices, not its normalised attributes', () => {
    // a 2 m body as glTF-Transform quantizes a skinned mesh: positions normalised to [-1, 1], the dequantizing scale and
    // offset folded into the inverse bind matrix (GLTFLoader binds with the mesh's own matrix, keeping those inverses)
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const n = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const body = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    const pelvis = new THREE.Bone();
    pelvis.position.set(0, 0.95, 0);
    const root = new THREE.Group().add(pelvis, body);
    root.updateMatrixWorld(true);
    const dequantize = new THREE.Matrix4().compose(new THREE.Vector3(0, 1, 0), new THREE.Quaternion(), new THREE.Vector3(0.3, 1, 0.15));
    body.bind(new THREE.Skeleton([pelvis], [pelvis.matrixWorld.clone().invert().multiply(dequantize)]), body.matrixWorld);
    root.updateMatrixWorld(true);

    expect(body.geometry.boundingBox).toBeNull();
    const box = meshBox(body);
    expect(box.min.toArray().map((x) => +x.toFixed(6))).toEqual([-0.3, 0, -0.15]);
    expect(box.max.toArray().map((x) => +x.toFixed(6))).toEqual([0.3, 2, 0.15]);
    expect(meshBox(mesh('Crate_LOD0')).getSize(new THREE.Vector3()).toArray()).toEqual([1, 1, 1]);
  });
});

describe('review: the wireframe pass', () => {
  /** World positions the GPU draws for `o`: a skinned mesh's posed vertices, else its geometry's own. */
  function drawnPoints(o) {
    const n = o.geometry.getAttribute('position').count;
    if (o.isSkinnedMesh) o.skeleton.update();
    const at = (i) => (o.isSkinnedMesh ? o.getVertexPosition(i, new THREE.Vector3()) : new THREE.Vector3().fromBufferAttribute(o.geometry.getAttribute('position'), i));
    const keys = Array.from({ length: n }, (_, i) => at(i).applyMatrix4(o.matrixWorld).toArray().map((x) => x.toFixed(4)).join(','));
    return [...new Set(keys)].sort();
  }

  it('draws the edges of a quantized skinned body on its posed vertices, under the same skeleton and transform', () => {
    // a 2 m two-bone body quantized as in 'framing bounds', bound at the origin, then its upper bone bent 90° and the
    // asset set down elsewhere
    const geometry = new THREE.BoxGeometry(2, 2, 2, 1, 2, 1);
    const pos = geometry.getAttribute('position');
    const n = pos.count;
    const index = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      index[i * 4] = pos.getY(i) > 0 ? 1 : 0;
      weight[i * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    const body = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    const hips = new THREE.Bone();
    hips.position.set(0, 0.95, 0);
    const chest = new THREE.Bone();
    chest.position.set(0, 0.5, 0);
    hips.add(chest);
    const content = new THREE.Group().add(hips, body);
    content.updateMatrixWorld(true);
    const dequantize = new THREE.Matrix4().compose(new THREE.Vector3(0, 1, 0), new THREE.Quaternion(), new THREE.Vector3(0.3, 1, 0.15));
    body.bind(new THREE.Skeleton([hips, chest], [hips, chest].map((b) => b.matrixWorld.clone().invert().multiply(dequantize))), body.matrixWorld);
    chest.rotation.z = Math.PI / 2;
    content.position.set(40, -3, 7);
    content.rotation.y = 0.6;
    content.updateMatrixWorld(true);

    const wire = new THREE.Group();
    content.add(wire);
    const local = new THREE.Matrix4().copy(content.matrixWorld).invert().multiply(body.matrixWorld);
    const edges = wireOver(body, local, new THREE.LineBasicMaterial(), new THREE.MeshBasicMaterial({ wireframe: true }));
    wire.add(edges);
    content.updateMatrixWorld(true);

    const posed = drawnPoints(body);
    expect(posed).toHaveLength(12);
    expect(drawnPoints(edges)).toEqual(posed);
    expect(edges.skeleton).toBe(body.skeleton);
    expect(edges.geometry).toBe(body.geometry);
  });

  it('draws an unskinned mesh as line segments over its own triangles', () => {
    const crate = mesh('Crate_LOD0');
    crate.position.set(2, 0, 0);
    const content = new THREE.Group().add(crate);
    content.updateMatrixWorld(true);
    const edges = wireOver(crate, crate.matrix, new THREE.LineBasicMaterial(), new THREE.MeshBasicMaterial({ wireframe: true }));
    content.add(edges);
    content.updateMatrixWorld(true);
    expect(edges.isLineSegments).toBe(true);
    expect(drawnPoints(edges)).toEqual(drawnPoints(crate));
  });
});

describe('review: paired perf', () => {
  // A deterministic stand-in for a loaded machine: the frame's base cost wanders by up to 30 ms between frames, in
  // slow swells and sudden spikes; the asset adds `cost` ms in the frames it is shown, plus a little jitter.
  function frames(pairs, cost, { seed = 7, lost = 0 } = {}) {
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    return abba(pairs).map((shown, i) => {
      const swell = 12 * Math.sin(i / 37) + 8 * Math.sin(i / 5.3);
      const spike = rnd() < 0.08 ? 25 * rnd() : 0;
      const base = 22 + swell + spike;
      const gpu = base + (shown ? cost : 0) + (rnd() - 0.5) * 0.2;
      return { shown, gpu: rnd() < lost ? null : gpu, cpu: 4 + (shown ? 0.2 : 0) + swell * 0.05, calls: 676 + (shown ? 44 : 0), tris: 3227801 + (shown ? 61750 : 0) };
    });
  }

  it('interleaves shown and hidden frames in ABBA blocks', () => {
    expect(abba(4)).toEqual([true, false, false, true, true, false, false, true]);
    expect(abba(1)).toEqual([true, false]);
  });

  it('pairs adjacent frames and drops a pair the timer lost', () => {
    const f = [
      { shown: true, gpu: 10 },
      { shown: false, gpu: 9 },
      { shown: false, gpu: 20 },
      { shown: true, gpu: 21.5 },
      { shown: true, gpu: null },
      { shown: false, gpu: 3 },
    ];
    expect(pairedDiffs(f, 'gpu')).toEqual([1, 1.5]);
    // a block is its two pairs' mean; one that lost a pair keeps the other
    expect(blockDiffs(f, 'gpu')).toEqual([1.25]);
    expect(blockDiffs([...f, { shown: false, gpu: 5 }, { shown: true, gpu: 7 }], 'gpu')).toEqual([1.25, 2]);
  });

  it('cancels a load that climbs steadily across a block', () => {
    // frame i costs 20 + 3i ms (a steep climb) and the asset 0.5 ms: every pair alone is off by 3 ms, every block exact
    const f = abba(8).map((shown, i) => ({ shown, gpu: 20 + 3 * i + (shown ? 0.5 : 0) }));
    expect(pairedDiffs(f, 'gpu').map((d) => Math.abs(d - 0.5))).toEqual(Array(8).fill(3));
    for (const d of blockDiffs(f, 'gpu')) expect(d).toBeCloseTo(0.5, 9);
  });

  it("reads the asset's own cost through load noise that swamps the unpaired difference", () => {
    const f = frames(240, 0.34);
    const cost = assetCost(f);
    expect(cost.gpuMs).toBeGreaterThan(0.24);
    expect(cost.gpuMs).toBeLessThan(0.44);
    expect(cost.drawCalls).toBe(44);
    expect(cost.triangles).toBe(61750);
    expect(cost.pairs).toBe(240);
    expect(cost.blocks).toBe(120);
    expect(cost.reliable).toBe(true);
    expect(cost.gpuMsCi95[0]).toBeLessThanOrEqual(cost.gpuMs);
    expect(cost.gpuMsCi95[1]).toBeGreaterThanOrEqual(cost.gpuMs);
    // two runs under different load agree within 0.5 ms
    const again = assetCost(frames(240, 0.34, { seed: 1234, lost: 0.05 }));
    expect(Math.abs(again.gpuMs - cost.gpuMs)).toBeLessThan(0.5);
    // the old way (median shown minus median hidden, all frames) is thrown off by the same load
    const med = (xs) => spread(xs).median;
    const unpaired = med(f.filter((x) => x.shown).map((x) => x.gpu)) - med(f.filter((x) => !x.shown).map((x) => x.gpu));
    expect(Math.abs(unpaired - 0.34)).toBeGreaterThan(Math.abs(cost.gpuMs - 0.34));
  });

  it('flags a cost as unreliable when the pairs disagree too widely, or are too few', () => {
    let s = 3;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const wild = abba(120).map((shown) => ({ shown, gpu: 22 + rnd() * 20 + (shown ? 0.3 : 0) }));
    const cost = assetCost(wild);
    expect(cost.reliable).toBe(false);
    expect(cost.spreadMs).toBeGreaterThan(5);
    expect(assetCost(frames(6, 0.34)).reliable).toBe(false);
    expect(assetCost([]).gpuMs).toBe(null);
  });

  it('spread gives quartiles and a median interval that holds the median', () => {
    const r = spread([5, 1, 4, 2, 3, NaN]);
    expect(r).toMatchObject({ n: 5, median: 3, q1: 2, q3: 4 });
    expect(r.ci95[0]).toBeLessThanOrEqual(3);
    expect(r.ci95[1]).toBeGreaterThanOrEqual(3);
    expect(spread([])).toBe(null);
  });
});
