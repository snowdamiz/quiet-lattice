import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { collectLods, parseSpec, pickLod, showLod } from './review.js';

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
