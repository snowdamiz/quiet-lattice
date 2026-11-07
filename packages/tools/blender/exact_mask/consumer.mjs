// Deferred: actual stock meshopt compressor + client GLTFLoader/consumer boundary, no GPU.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { compressGeometry } from '../../src/art/meshopt.ts';
import { gltfLoader } from '../../../client/src/core/Engine.js';
import { maskColors, recolor } from '../../../client/src/gameplay/modelLibrary.js';

const directory = resolve(process.argv[2]);
const source = JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8'));
const families = JSON.parse(readFileSync(new URL('../families.json', import.meta.url), 'utf8'));
const palette = { primary: new THREE.Color(.4, .2, .1), secondary: new THREE.Color(.1, .3, .5), accent: new THREE.Color(.6, .4, .2) };
const attributes = ['position', 'normal', 'uv', '_limb', '_pivot', '_glow', 'color'];
const json = (bytes) => JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const tuple = (record) => attributes.map((key) => record[key]);
const encode = (record) => JSON.stringify(tuple(record));
function triangle(corners) {
  const strings = corners.map(encode);
  return [0, 1, 2].map((i) => JSON.stringify([...strings.slice(i), ...strings.slice(0, i)])).sort()[0];
}
function accessor(mesh, key) {
  const a = mesh.geometry.getAttribute(key);
  assert(a, `${mesh.name}: missing ${key}`);
  if (key !== 'uv') assert(a.array instanceof Float32Array, `${mesh.name}: ${key} is not Float32`);
  assert.equal(a.normalized, false);
  return a;
}
async function decode(bytes) {
  const gltf = await gltfLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}
function verify(scene) {
  const observed = {};
  let meshes = 0;
  scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let owner = mesh;
    while (owner && !source[owner.name]) owner = owner.parent;
    assert(owner, `unexpected mesh ${mesh.name}`);
    const expected = source[owner.name];
    const translation = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).toArray();
    assert.deepEqual(translation, expected.translation);
    const attrs = Object.fromEntries(attributes.map((key) => [key, accessor(mesh, key)]));
    assert.equal(attrs.color.itemSize, 4, 'occlusion alpha must survive');
    const record = (index) => Object.fromEntries(attributes.map((key) => [key, Array.from({ length: attrs[key].itemSize }, (_, c) => attrs[key].getComponent(index, c))]));
    const material = mesh.material.name;
    const expectedRows = expected.triangles[material].flat();
    const savedByTuple = new Map(expectedRows.map((row) => [encode(row), row]));
    const sourceColors = new Float32Array(attrs.color.count * 4);
    for (let v = 0; v < attrs.color.count; v++) {
      const saved = savedByTuple.get(encode(record(v)));
      assert(saved, `${owner.name}/${material}: vertex ${v} differs from saved source`);
      sourceColors.set(saved.color, v * 4);
    }
    const oracle = mesh.geometry.clone();
    oracle.setAttribute('color', new THREE.BufferAttribute(sourceColors, 4));
    for (const opts of [{ aoFloor: .05, albedoCap: .75 }, { aoFloor: .35, glowAccent: .7 }]) {
      const wanted = maskColors(oracle, palette, opts);
      const got = maskColors(mesh.geometry, palette, opts);
      assert.deepEqual(got, wanted);
      const recolored = recolor(mesh, palette, opts);
      assert.deepEqual(recolored.attributes.color.array, wanted.col);
      assert.deepEqual(recolored.attributes.aGlow.array, wanted.glow);
      recolored.dispose();
    }
    // The non-grid alpha contributes to actual consumer output; an alpha=1 control differs.
    const opaque = oracle.clone();
    for (let i = 0; i < opaque.attributes.color.count; i++) opaque.attributes.color.setW(i, 1);
    assert.notDeepEqual(maskColors(oracle, palette).col, maskColors(opaque, palette).col);
    opaque.dispose();
    oracle.dispose();
    const indices = mesh.geometry.index;
    const count = indices ? indices.count : attrs.position.count;
    const gotTriangles = [];
    for (let i = 0; i < count; i += 3) gotTriangles.push(triangle([0, 1, 2].map((k) => record(indices ? indices.getX(i + k) : i + k))));
    const key = `${owner.name}/${material}`;
    assert(!observed[key], `duplicate primitive ${key}`);
    observed[key] = gotTriangles.sort();
    assert.deepEqual(observed[key], expected.triangles[material].map(triangle).sort(), key);
    meshes++;
  });
  assert.equal(Object.keys(observed).length, Object.values(source).reduce((n, o) => n + Object.keys(o.triangles).length, 0));
  for (const name of ['Interact_point', 'Interact_corner']) {
    const marker = scene.getObjectByName(name);
    assert(marker);
    assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(marker.matrixWorld).toArray(), [.25, .75, -.5]);
  }
  return { meshes, objects: Object.keys(source).length };
}

const baseline = readFileSync(resolve(directory, 'stock-red.glb'));
assert.throws(() => {
  for (const mesh of json(baseline).meshes) for (const p of mesh.primitives) assert.equal(json(baseline).accessors[p.attributes.COLOR_0].componentType, 5126);
}, /5123/);
const redCompressed = Buffer.from((await compressGeometry(baseline, { quantize: false })).glb);
writeFileSync(resolve(directory, 'stock-red-compressed.glb'), redCompressed, { flag: 'wx' });
const redScene = await decode(redCompressed);
assert.throws(() => verify(redScene), /color is not Float32/);
// Preserve the real-source RED even if a later green step fails.
writeFileSync(resolve(directory, 'consumer-red.json'), JSON.stringify({ assertion: 'COLOR_0 Float32 before and after stock compression/GLTFLoader', actual: 5123, expected: 5126, status: 'EXPECTED_FAIL' }, null, 2) + '\n', { flag: 'wx' });
const results = [];
for (const family of ['creatures', 'flora', 'props']) {
  const raw = readFileSync(resolve(directory, `${family}-raw.glb`));
  const exact = family !== 'props';
  if (exact) verify(await decode(raw));
  const settings = { ...families.geometry, ...families.families[family].geometry };
  const { glb, summary } = await compressGeometry(raw, settings);
  const compressed = Buffer.from(glb);
  writeFileSync(resolve(directory, `${family}-compressed.glb`), compressed, { flag: 'wx' });
  assert.deepEqual(json(compressed).materials, json(raw).materials, 'material definitions/order must survive');
  assert.equal(json(compressed).materials.length, 4, 'variants retain separate material instances');
  assert.equal(json(compressed).extensionsRequired.includes('KHR_mesh_quantization'), !exact);
  assert(json(compressed).extensionsRequired.includes('EXT_meshopt_compression'));
  if (exact) {
    for (const mesh of json(compressed).meshes) for (const p of mesh.primitives) {
      const a = json(compressed).accessors[p.attributes.COLOR_0];
      assert.equal(a.componentType, 5126);
      assert.equal(a.type, 'VEC4');
      assert(!a.normalized);
    }
    results.push({ family, ...verify(await decode(compressed)), summary });
  } else {
    assert(json(raw).accessors.some((a) => a.componentType === 5123 && a.normalized), 'stock other-family color format');
    await decode(compressed);
    results.push({ family, summary, quantizingControl: true });
  }
}
writeFileSync(resolve(directory, 'consumer-green.json'), JSON.stringify({ status: 'PASS', results }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(results));
