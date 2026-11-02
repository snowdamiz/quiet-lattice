import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const structure = (json) =>
  JSON.stringify(
    Object.fromEntries(['nodes', 'skins', 'meshes', 'accessors', 'bufferViews', 'buffers', 'scenes', 'animations'].map((key) => [key, json[key]])),
  );

/** Browser-free actual export decode. Only texture/material loading is omitted, in RAM. */
export async function loadActualRig(species) {
  const file = readFileSync(new URL(`../../public/models/characters/${species}.glb`, import.meta.url));
  const length = file.readUInt32LE(12),
    json = JSON.parse(file.subarray(20, 20 + length));
  const bin = file.subarray(28 + length),
    before = structure(json);
  json.images = [];
  json.textures = [];
  json.materials = json.materials.map((material) => ({ name: material.name }));
  for (const key of ['extensionsRequired', 'extensionsUsed']) json[key] = json[key].filter((name) => name !== 'KHR_texture_basisu');
  assert.equal(structure(json), before);
  let bytes = Buffer.from(JSON.stringify(json));
  bytes = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4, 32)]);
  const rebuilt = Buffer.alloc(28 + bytes.length + bin.length);
  rebuilt.writeUInt32LE(0x46546c67);
  rebuilt.writeUInt32LE(2, 4);
  rebuilt.writeUInt32LE(rebuilt.length, 8);
  rebuilt.writeUInt32LE(bytes.length, 12);
  rebuilt.writeUInt32LE(0x4e4f534a, 16);
  bytes.copy(rebuilt, 20);
  rebuilt.writeUInt32LE(bin.length, 20 + bytes.length);
  rebuilt.writeUInt32LE(0x004e4942, 24 + bytes.length);
  bin.copy(rebuilt, 28 + bytes.length);
  assert.deepEqual(rebuilt.subarray(28 + bytes.length), bin);
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(rebuilt.buffer.slice(rebuilt.byteOffset, rebuilt.byteOffset + rebuilt.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return {
    ...gltf,
    proof: {
      species,
      exportSha256: hash(file),
      binarySha256: hash(bin),
      geometrySkinMorphNodeAndCompressionJsonUnchanged: true,
      binaryBytesUnchanged: true,
      texturesOmittedOnlyInRam: true,
    },
  };
}
