import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gltfLoader, initTextureLoaders } from '../src/core/Engine.js';
import { Review, collectLods, nodeName, parseSpec, showLod } from '../src/dev/review.js';
import { textureMemory } from '../src/gameplay/modelLibrary.js';
import { ITEMS } from '../../shared/src/data/items.ts';
import { cpuWebAdapter } from '../../tools/blender/t08/cpu-web-adapter.mjs';

const inventory = JSON.parse(readFileSync(new URL('../../tools/blender/t08/inventory.json', import.meta.url), 'utf8'));
const publicRoot = new URL('../public/', import.meta.url);
let restore;
let ktx;
beforeAll(() => {
  restore = cpuWebAdapter(publicRoot);
  // Exercise the production BC7 target on CPU; this does not detect or use a physical GPU.
  ktx = initTextureLoaders({ extensions: { has: (name) => name === 'EXT_texture_compression_bptc', get: () => null } });
  ktx.setWorkerLimit(1);
});
afterAll(async () => {
  ktx?.dispose();
  await restore();
});

function bytes(item) {
  return readFileSync(new URL(`models/${item.family}/${item.stem}.glb`, publicRoot));
}
function arrayBuffer(data) {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
function dispose(root) {
  const textures = new Set();
  const materials = new Set();
  const geometries = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    geometries.add(o.geometry);
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}

describe('T08 exact shipped assets through production GLTFLoader and Review', () => {
  it('covers every current ammo and catalyst item ID exactly once', () => {
    for (const [stem, kind] of [
      ['ammo', 'ammo'],
      ['catalyst_vial', 'catalyst'],
    ]) {
      const item = inventory.find((entry) => entry.stem === stem);
      expect(Object.keys(item.itemIds).sort()).toEqual([...item.variants].sort());
      expect(Object.values(item.itemIds).sort()).toEqual(
        ITEMS.filter((row) => row.kind === kind)
          .map((row) => row.id)
          .sort(),
      );
    }
  });

  for (const item of inventory)
    it(`${item.family}/${item.stem}: roots, variants, mips, associations, all LODs`, async () => {
      const data = bytes(item);
      const result = await gltfLoader().parseAsync(arrayBuffer(data), '');
      const root = result.scene;
      root.updateMatrixWorld(true);
      try {
        const model = collectLods(root);
        expect(model.assets.map((a) => a.name)).toEqual([item.stem]);
        expect(model.assets[0].variants.map((v) => v.name).sort()).toEqual([...item.variants].sort());
        expect(root.children.some((o) => o.name.startsWith('REF'))).toBe(false);
        for (const variant of item.variants) {
          const spec = parseSpec(`${item.family}/${item.stem}:${item.stem}/${variant}`);
          expect(spec).toMatchObject({ url: `/models/${item.family}/${item.stem}.glb`, asset: item.stem, variant });
          const v = model.assets[0].variants.find((v) => v.name === variant);
          expect([...v.lods.keys()].sort()).toEqual([0, 1, 2, 3]);
          const bindings = new Map();
          const counts = [];
          for (let level = 0; level < 4; level++) {
            expect(showLod(model, level, { asset: item.stem, variant })).toEqual({ [variant]: level });
            let triangles = 0;
            root.traverseVisible((o) => {
              if (!o.isMesh) return;
              expect(nodeName(o)).not.toMatch(/^(COL_|REF_)/);
              expect(o.geometry.attributes.position.count).toBeGreaterThan(0);
              triangles += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
              for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
                if (/Glass|Lamp/.test(material.name)) continue;
                expect(material.map?.isCompressedTexture).toBe(true);
                expect(material.normalMap?.isCompressedTexture).toBe(true);
                expect(material.roughnessMap?.isCompressedTexture).toBe(true);
                expect(material.metalnessMap?.isCompressedTexture).toBe(true);
                expect(material.emissiveMap?.isCompressedTexture).toBe(true);
                expect(material.aoMap?.isCompressedTexture).toBe(true);
                expect(o.geometry.attributes.uv).toBeDefined();
                const association = [
                  material.map.uuid,
                  material.normalMap.uuid,
                  material.roughnessMap.uuid,
                  material.metalnessMap.uuid,
                  material.aoMap.uuid,
                  material.emissiveMap.uuid,
                ];
                if (bindings.has(material.name)) expect(association).toEqual(bindings.get(material.name));
                else bindings.set(material.name, association);
                for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap]) {
                  const size = item.family === 'props' ? 1024 : 2048;
                  expect(texture.image.width).toBe(size);
                  expect(texture.image.height).toBe(size);
                  expect(texture.mipmaps).toHaveLength(Math.log2(size) + 1);
                  expect(texture.mipmaps.at(-1).width).toBe(1);
                  expect(texture.mipmaps.every((m) => m.data.byteLength > 0)).toBe(true);
                }
              }
            });
            counts.push(triangles);
            const memory = textureMemory(root, { visibleOnly: true });
            expect(memory.bytes).toBeLessThanOrEqual((item.family === 'props' ? 32 : 128) * 1024 * 1024);
          }
          expect(counts[0]).toBeGreaterThanOrEqual(item.family === 'props' ? 2000 : 8000);
          expect(counts[0]).toBeLessThanOrEqual(item.family === 'props' ? 10000 : 60000);
          expect(counts[1]).toBeLessThan(counts[0]);
          expect(counts[2]).toBeLessThan(counts[1]);
          expect(counts[3]).toBeLessThan(0.05 * counts[0]);
          const helperNames = model.helpers.map(nodeName);
          expect(helperNames.some((n) => n.startsWith('Interact'))).toBe(true);
          expect(helperNames.some((n) => n.startsWith('COL_'))).toBe(true);
        }
        // Actual Review selection boundary refuses absent roots/variants rather than accepting a made-up inventory.
        const review = Object.create(Review.prototype);
        review.model = model;
        expect(() => review.select('missing_t08_asset')).toThrow(/no asset/);
        expect(() => review.select(item.stem, 'missing_t08_variant')).toThrow(/no variant/);
      } finally {
        dispose(root);
      }
    }, 120000);

  it('rejects a corrupted real meshopt stream through the production loader', async () => {
    const data = Buffer.from(bytes(inventory[0]));
    const jsonLength = data.readUInt32LE(12);
    const doc = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
    const view = doc.bufferViews.find((v) => v.extensions?.EXT_meshopt_compression);
    const offset = 20 + jsonLength + 8 + view.extensions.EXT_meshopt_compression.byteOffset;
    data[offset] = 0;
    await expect(gltfLoader().parseAsync(arrayBuffer(data), '')).rejects.toThrow();
  });

  it('rejects a malformed actual KTX2 payload through the production transcoder', async () => {
    const data = bytes(inventory[0]);
    const jsonLength = data.readUInt32LE(12);
    const doc = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
    const view = doc.bufferViews[doc.images[0].bufferView];
    const offset = 20 + jsonLength + 8 + view.byteOffset;
    const texture = Buffer.from(data.subarray(offset, offset + view.byteLength));
    texture.fill(0, 0, 12);
    await expect(new Promise((resolve, reject) => ktx.parse(arrayBuffer(texture), resolve, reject))).rejects.toThrow();
  });
});
