// Compressed models in the model library (P1.E14.T12): the GPU memory of their textures (what the review readout reports
// beside its perf numbers), the loaders, and meshopt-compressed fixtures (packages/tools/src/art/fixtures.ts) read the way
// the creatures and flora read them: positions, colour masks and the vertex rig in the world, exactly.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addLibrary, floatAttribute, libraryMesh, recolor, textureBytes, textureMemory } from './modelLibrary.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BASIS_TRANSCODER_PATH, gltfLoader, initTextureLoaders } from '../core/Engine.js';

/** A fixture as the game loads it (meshopt decoded; these carry no textures, which need a GPU). */
async function fixture(name) {
  const data = readFileSync(new URL(`./fixtures/${name}.glb`, import.meta.url));
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return (await gltfLoader().parseAsync(buffer, '')).scene;
}

const PALETTE = { primary: new THREE.Color(1, 0, 0), secondary: new THREE.Color(0, 1, 0), accent: new THREE.Color(0, 0, 1) };

/** The pivot of vertex `i` in the world, as Fauna.js reads `_pivot` (Blender axes) through the mesh's matrix. */
function pivotWorld(mesh, i) {
  const pa = mesh.geometry.attributes._pivot;
  return new THREE.Vector3(pa.getX(i), pa.getZ(i), -pa.getY(i)).applyMatrix4(mesh.matrixWorld).toArray();
}

const close = (a, b, eps) => a.every((x, i) => Math.abs(x - b[i]) <= eps);

/** A KTX2 map as KTX2Loader hands it over: a compressed texture with its own mip levels. */
function compressed(size) {
  const mipmaps = [];
  for (let s = size; s >= 1; s >>= 1) mipmaps.push({ data: new Uint8Array(Math.max(1, s / 4) ** 2 * 16), width: s, height: s });
  return new THREE.CompressedTexture(mipmaps, size, size, THREE.RGBA_BPTC_Format);
}

describe('texture memory', () => {
  it('counts a compressed map by its own mip levels and an image map as RGBA8 with generated mips', () => {
    // (16 bytes a 4x4 block: 256 to 8 px at a byte a texel, then 4, 2 and 1 px at one block each)
    expect(textureBytes(compressed(256))).toBe(256 * 256 + 128 * 128 + 64 * 64 + 32 * 32 + 16 * 16 + 8 * 8 + 3 * 16);
    const img = new THREE.Texture({ width: 256, height: 256 });
    expect(textureBytes(img)).toBe(Math.round(256 * 256 * 4 * (4 / 3)));
    img.minFilter = THREE.LinearFilter;
    expect(textureBytes(img)).toBe(256 * 256 * 4);
  });

  it('counts each texture once, and only what is visible when asked', () => {
    const base = compressed(64);
    const normal = compressed(64);
    const shared = new THREE.MeshStandardMaterial({ map: base, normalMap: normal });
    const a = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const b = new THREE.Mesh(new THREE.BoxGeometry(), [shared, new THREE.MeshStandardMaterial({ map: compressed(32) })]);
    const root = new THREE.Group().add(a, b);
    const all = textureMemory(root);
    expect(all).toMatchObject({ count: 3, compressed: 3 });
    expect(all.bytes).toBe(textureBytes(base) * 2 + textureBytes(b.material[1].map));
    b.visible = false;
    expect(textureMemory(root, { visibleOnly: true })).toEqual({ count: 2, compressed: 2, bytes: textureBytes(base) * 2 });
  });
});

describe('model loaders', () => {
  it('give every GLTFLoader the meshopt decoder and the one KTX2 loader, set up for the renderer and public/basis', () => {
    expect(gltfLoader().ktx2Loader).toBeNull();
    expect(gltfLoader().meshoptDecoder).toBe(MeshoptDecoder);
    // (a WebGL renderer as detectSupport reads it: here, one with BC7 and S3TC)
    const has = new Set(['EXT_texture_compression_bptc', 'WEBGL_compressed_texture_s3tc']);
    const ktx2 = initTextureLoaders({ extensions: { has: (n) => has.has(n), get: () => null } });
    expect(ktx2.transcoderPath).toBe(BASIS_TRANSCODER_PATH);
    expect(ktx2.workerConfig).toMatchObject({ bptcSupported: true, dxtSupported: true, astcSupported: false });
    expect(gltfLoader().ktx2Loader).toBe(ktx2);
    expect(gltfLoader()).not.toBe(gltfLoader());
    expect(initTextureLoaders({ extensions: { has: () => false, get: () => null } })).toBe(ktx2);
  });
});

describe('meshopt-compressed library models', () => {
  // (the values packages/tools/src/art/fixtures.ts wrote: EXPECT there)
  it('a creature keeps its rig exact: positions, _pivot in the world, _limb, _glow and the mask', async () => {
    addLibrary('creatures', await fixture('creature'));
    const mesh = libraryMesh('creatures', 'quad_grazer_0');
    const src = mesh.geometry;
    expect(src.attributes.position.array).toBeInstanceOf(Float32Array);
    const geo = recolor(mesh, PALETTE);
    expect(geo.boundingBox.min.toArray()).toEqual([3.4, 0, -0.3].map(Math.fround));
    expect(close(geo.boundingBox.max.toArray(), [4.6, 1.2, 0.3], 1e-6)).toBe(true);
    for (let i = 0; i < src.attributes.position.count; i++) {
      expect(close(pivotWorld(mesh, i), [4.3, 1.2, -0.1], 1e-6)).toBe(true);
      expect(src.attributes._limb.getX(i)).toBe(2);
      expect(src.attributes._glow.getX(i)).toBe(0.25);
    }
    expect(close([0, 1, 2, 3].map((c) => src.attributes.color.getComponent(0, c)), [0.6, 0.3, 0.1, 0.8], 1e-6)).toBe(true);
  });

  it('a flora model keeps its place and its mask', async () => {
    addLibrary('flora', await fixture('flora'));
    const mesh = libraryMesh('flora', 'bush_0');
    const geo = recolor(mesh, PALETTE);
    expect(close(geo.boundingBox.min.toArray(), [-0.5, 0, 1.5], 1e-6)).toBe(true);
    expect(close(geo.boundingBox.max.toArray(), [0.5, 1.5, 2.5], 1e-6)).toBe(true);
    // R 0.2, G 0.7, B 0.1 of the palette, darkened by full occlusion's floor of nothing (A = 1)
    expect(close(geo.attributes.color.array.slice(0, 3), [0.2 * 0.6, 0.7 * 0.6, 0.1 * 0.6], 1e-6)).toBe(true);
  });

  it('recolor reads quantized positions through their normalisation: a hull away from the origin does not wrap', async () => {
    addLibrary('hulls', await fixture('hull'));
    const mesh = libraryMesh('hulls', 'hull_0');
    const pos = mesh.geometry.attributes.position;
    // (16-bit integers with the scale moved into the node: what wrapped to -0.997..0.992 before)
    expect(pos.array).toBeInstanceOf(Int16Array);
    expect(pos.normalized).toBe(true);
    const geo = recolor(mesh, PALETTE);
    expect(geo.attributes.position.array).toBeInstanceOf(Float32Array);
    expect(close(geo.boundingBox.min.toArray(), [2.4, 0.5, -1], 1e-3)).toBe(true);
    expect(close(geo.boundingBox.max.toArray(), [3.6, 1.5, 1], 1e-3)).toBe(true);
    const n = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, 0);
    expect(n.length()).toBeCloseTo(1, 2);
    expect(floatAttribute(pos).getX(0)).toBe(Math.fround(pos.getX(0)));
  });
});
