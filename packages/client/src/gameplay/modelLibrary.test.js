// GPU memory of a model's textures (P1.E14.T12): what the review readout reports beside its perf numbers.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { textureBytes, textureMemory } from './modelLibrary.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BASIS_TRANSCODER_PATH, gltfLoader, initTextureLoaders } from '../core/Engine.js';

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
