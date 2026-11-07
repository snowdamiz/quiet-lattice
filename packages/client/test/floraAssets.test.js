// Actual T05 assets decoded by the game's loader, indexed/recoloured by its real consumers.
// Texture upload is unavailable on CPU: artlib separately transcodes and validates KTX2 pixels.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { collectLods, showLod, parseSpec, applyGameLook } from '../src/dev/review.js';
import { gltfLoader } from '../src/core/Engine.js';
import { addLibrary, libraryMesh, libraryRoot, libraryVariants, maskColors, recolor } from '../src/gameplay/modelLibrary.js';
import { makeBush, makeFern, makeGrass, makeRock, makeResourcePlant, makeDeposit, TREE_BUILDERS } from '../src/gameplay/floraModels.js';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const manifest = JSON.parse(read('assets/renders/flora/t05/source_manifest.json'));
const groups = ['foliage', 'stone', 'resources'];
let loadedScene;
const palette = { primary: new THREE.Color(0.21, 0.47, 0.32), secondary: new THREE.Color(0.11, 0.16, 0.08), accent: new THREE.Color(0.69, 0.36, 0.17) };
const hash = (values) =>
  createHash('sha256')
    .update([...new Set(values)].sort().join('\n'))
    .digest('hex');
function maskHex(mask, i) {
  const bytes = Buffer.alloc(16);
  for (let k = 0; k < 4; k++) bytes.writeFloatLE(mask.getComponent(i, k), k * 4);
  return bytes.toString('hex');
}
function validateMesh(mesh, expected) {
  if (!mesh?.isMesh) throw new Error('Missing named mesh');
  const { position, color, _glow: glow } = mesh.geometry.attributes;
  if (!position || !(position.array instanceof Float32Array)) throw new Error('Position is not FLOAT');
  if (!color || color.itemSize !== 4 || !(color.array instanceof Float32Array) || color.normalized) throw new Error('Mask is not exact FLOAT VEC4');
  if (!glow || !(glow.array instanceof Float32Array)) throw new Error('Missing float glow');
  const count = (mesh.geometry.index?.count ?? position.count) / 3;
  if (count !== expected.triangles) throw new Error('Triangle mismatch');
  if (mesh.userData.kind !== expected.kind || mesh.userData.glow_accent !== expected.glow_accent) throw new Error('Missing kind/glow metadata');
  const masks = [];
  const associations = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    if (!p.toArray().every(Number.isFinite)) throw new Error('Nonfinite position');
    const rgba = [0, 1, 2, 3].map((k) => color.getComponent(i, k));
    if (!rgba.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) || Math.abs(rgba[0] + rgba[1] + rgba[2] - 1) > 2e-6) throw new Error('Invalid mask weights');
    if (!Number.isFinite(glow.getX(i)) || Math.abs(glow.getX(i) - rgba[2] * expected.glow_accent) > 2e-6) throw new Error('Glow attribute changed');
    const bits = maskHex(color, i);
    masks.push(bits);
    associations.push(
      p
        .toArray()
        .map((v) => (Object.is(v, -0) ? 0 : v).toFixed(5))
        .join(',') +
        ':' +
        bits,
    );
  }
  if (hash(masks) !== expected.mask_sha256) throw new Error('Mask float bits changed');
  if (hash(associations) !== expected.mask_position_sha256) throw new Error('Mask moved to another vertex');
  const geo = recolor(mesh, palette, { glowAccent: expected.glow_accent });
  if (!geo.attributes.color.array.every(Number.isFinite)) throw new Error('Invalid recolour');
  geo.dispose();
}

beforeAll(async () => {
  const scene = new THREE.Group();
  for (const group of groups) {
    const data = read(`packages/client/public/models/flora/non_tree_${group}.glb`);
    const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(json.extensionsRequired).toContain('KHR_texture_basisu');
    expect(json.extensionsUsed).not.toContain('KHR_mesh_quantization');
    expect(json.images.every((image) => image.mimeType === 'image/ktx2')).toBe(true);
    for (const mesh of json.meshes)
      for (const primitive of mesh.primitives) {
        expect(json.accessors[primitive.attributes.COLOR_0]).toMatchObject({ componentType: 5126, type: 'VEC4' });
        expect(Object.keys(primitive.attributes).some((key) => key.startsWith('_T05_MASK_'))).toBe(false);
      }
    const loader = gltfLoader();
    // Only texture upload is replaced. The original GLB, meshopt streams, node transforms,
    // extras, materials and geometry are parsed unchanged by the production GLTFLoader.
    loader.register(() => ({ name: 'KHR_texture_basisu', loadTexture: () => Promise.resolve(null) }));
    const loaded = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
    while (loaded.scene.children.length) scene.add(loaded.scene.children[0]);
  }
  loadedScene = scene;
  addLibrary('flora', scene);
}, 60_000);

describe('saved non-tree flora exports', () => {
  it('retains all 21 old non-tree base names and expands to 31 distinct variants and 13 kinds', () => {
    const demo = JSON.parse(read('assets/renders/flora/t05/demo_inventory.json'));
    for (const name of demo.non_tree_names) expect(libraryMesh('flora', name), name).not.toBeNull();
    const bases = Object.keys(manifest.meshes).filter((name) => !name.includes('_lod'));
    expect(bases).toHaveLength(31);
    expect(new Set(bases.map((name) => manifest.meshes[name].kind)).size).toBe(13);
    expect(libraryVariants('flora', 'deposit')).toHaveLength(8);
    for (const name of bases) expect(libraryRoot('flora', manifest.meshes[name].root), name).not.toBeNull();
  });

  for (const [name, expected] of Object.entries(manifest.meshes)) {
    it(`${name}: exact float masks stay attached to saved geometry after meshopt and recolouring`, () => {
      validateMesh(libraryMesh('flora', name), expected);
    });
  }

  it('selects every named variant and LOD through the actual review scene parser', () => {
    const scene = loadedScene.clone(true);
    const model = collectLods(scene);
    expect(model.assets.flatMap((asset) => asset.variants)).toHaveLength(31);
    for (const [name, entry] of Object.entries(manifest.meshes).filter(([name]) => !name.includes('_lod'))) {
      const spec = parseSpec(`flora/${entry.file.replace('.blend', '')}:${entry.root}/${entry.variant_node}`);
      for (const level of [0, 2]) {
        expect(showLod(model, level, spec)).toEqual({ [entry.variant_node]: level });
        const meshes = [];
        scene.traverseVisible((o) => {
          if (o.isMesh) meshes.push(o.name);
        });
        expect(meshes).toEqual([name + (level ? '_lod2' : '')]);
      }
    }
    expect(applyGameLook(scene, 'flora')).toBe(124);
  });

  it('has four strictly decreasing LODs below the final 5% threshold', () => {
    for (const name of Object.keys(manifest.meshes).filter((name) => !name.includes('_lod'))) {
      const tris = ['', '_lod1', '_lod2', '_lod3'].map((suffix) => {
        const geo = libraryMesh('flora', name + suffix).geometry;
        return (geo.index?.count ?? geo.attributes.position.count) / 3;
      });
      expect(tris[0]).toBeGreaterThanOrEqual(150);
      expect(tris[0]).toBeLessThanOrEqual(6000);
      for (let i = 1; i < 4; i++) expect(tris[i]).toBeLessThan(tris[i - 1]);
      expect(tris[3] / tris[0]).toBeLessThan(0.05);
    }
  });

  it('uses actual library geometry in existing floraModels consumers at both exposed LODs', () => {
    const cases = [
      ['bush_0', (q) => makeBush(() => 0, { leaf: 0x448844 }, q)],
      ['fern_0', (q) => makeFern(() => 0, { leaf: 0x448844 }, q)],
      ['rock_0', (q) => makeRock(() => 0, 0x777777, false, q)],
      ['boulder_0', (q) => makeRock(() => 0, 0x777777, true, q)],
      ['crystal_0', (q) => TREE_BUILDERS.crystal(() => 0, { leaf: 0x8877aa, trunk: 0x555555 }, q)],
      ['plant_bulb_0', (q) => makeResourcePlant(() => 0, 0xffcc30, 'bulb', q)],
      ['plant_flower_0', (q) => makeResourcePlant(() => 0, 0xff4a40, 'flower', q)],
      ['deposit_0', (q) => makeDeposit(() => 0, 0xff8a2a, q)],
    ];
    for (const [name, build] of cases)
      for (const q of [1, 0]) {
        const { geo, height } = build(q);
        expect((geo.index?.count ?? geo.attributes.position.count) / 3).toBe(manifest.meshes[name + (q ? '' : '_lod1')].triangles);
        expect(height).toBeGreaterThan(0);
        geo.dispose();
      }
    const grass = makeGrass(() => 0, 0x447744, 0x336633);
    expect((grass.geo.index?.count ?? grass.geo.attributes.position.count) / 3).toBe(manifest.meshes.grass_0.triangles);
    grass.geo.dispose();
  });

  it('applies measured AO and accent feedback through the real maskColors calculation', () => {
    const mesh = libraryMesh('flora', 'plant_bulb_0');
    const mask = mesh.geometry.attributes.color;
    const { col, glow } = maskColors(mesh.geometry, palette, { glowAccent: 1.6 });
    for (let i = 0; i < mask.count; i++) {
      const r = mask.getX(i),
        g = mask.getY(i),
        b = mask.getZ(i),
        sum = r + g + b;
      const ao = 0.35 + 0.65 * mask.getW(i);
      expect(col[i * 3]).toBeCloseTo(((0.21 * r + 0.11 * g + 0.69 * b) / sum) * ao, 6);
      expect(glow[i]).toBeCloseTo((b / sum) * 1.6, 6);
    }
  });

  it('rejects missing, quantized, misweighted and detached masks, missing names and nonfinite geometry', () => {
    const original = libraryMesh('flora', 'bush_0');
    const expected = manifest.meshes.bush_0;
    for (const mutation of ['missing', 'quantized', 'weights', 'detached', 'nonfinite']) {
      const mesh = original.clone();
      mesh.geometry = original.geometry.clone();
      mesh.updateMatrixWorld(true);
      const mask = mesh.geometry.attributes.color;
      if (mutation === 'missing') mesh.geometry.deleteAttribute('color');
      if (mutation === 'quantized')
        mesh.geometry.setAttribute(
          'color',
          new THREE.Uint16BufferAttribute(
            Array.from(mask.array, (x) => Math.round(x * 65535)),
            4,
            true,
          ),
        );
      if (mutation === 'weights') mask.setXYZ(0, 0.8, 0.8, 0.8);
      if (mutation === 'detached') mesh.geometry.attributes.position.setX(0, 17);
      if (mutation === 'nonfinite') mesh.geometry.attributes.position.setX(0, NaN);
      expect(() => validateMesh(mesh, expected), mutation).toThrow();
      mesh.geometry.dispose();
    }
    expect(() => validateMesh(null, expected)).toThrow('Missing named mesh');
  });
});
