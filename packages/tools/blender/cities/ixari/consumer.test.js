import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { warn } from 'node:console';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from '../../../../client/node_modules/three/build/three.module.js';
import { collectLods, showLod, helperKind } from '../../../../client/src/dev/review.js';
import { resolveBoxes } from '../../../../client/src/gameplay/Structures.js';

// CPU artifact/consumer proof only. No renderer, source regeneration, synthetic replacement
// meshes, texture transcoding, or network. Coordinates in inventories are Blender Z-up;
// exported transforms and decoded geometry stay in glTF Y-up, including quantization scales.
const GROUPS = {
  low: Array.from({ length: 4 }, (_, i) => `ixari_low_${i}`),
  mid: Array.from({ length: 4 }, (_, i) => `ixari_mid_${i}`),
  tall: Array.from({ length: 4 }, (_, i) => `ixari_tall_${i}`),
  civic: ['ixari_plaza', 'ixari_market_hall', 'ixari_skill_house', 'ixari_compact_office', 'ixari_listening_house', 'ixari_shipyard', 'ixari_salvage_yard'],
  kit: ['gate_ixari', 'wall_ixari_straight', 'wall_ixari_corner', 'bridge_ixari', 'kit_ixari_spiral', 'lamp_ixari_biolume'],
  props: ['prop_ixari_terminal', 'prop_ixari_board', 'prop_ixari_stall', 'prop_ixari_seat', 'prop_ixari_basin'],
  landmarks: ['ixari_landmark_spire_hall', 'ixari_landmark_summit'],
  anchor: ['anchor_quavel'],
};
const REQUIRED = ['KHR_texture_basisu', 'EXT_meshopt_compression', 'KHR_mesh_quantization'];
const ROOT = new URL('../../../../../', import.meta.url);
const path = (relative) => fileURLToPath(new URL(relative, ROOT));
const inventoryPath = (group) => `assets/blend/cities/ixari/inventory/${group}.json`;
const exportPath = (group) => `packages/client/public/models/cities/ixari_${group}.glb`;
const rules = JSON.parse(readFileSync(path('packages/tools/blender/families.json'), 'utf8'));
const yup = ([x, y, z]) => new THREE.Vector3(x, z, -y);
const zup = (v) => [v.x, -v.z, v.y];
const vector = (v, label) => assert(Array.isArray(v) && v.length === 3 && v.every(Number.isFinite), `${label}: expected finite xyz`);
const positive = (v, label) => assert(Number.isFinite(v) && v > 0, `${label}: expected positive finite number, got ${v}`);
const sorted = (xs) => [...xs].sort();
const nameOf = (o) => o.userData.name ?? o.name;
const positionOf = (o) => o.getWorldPosition(new THREE.Vector3());

function inventory(group) {
  const entries = JSON.parse(readFileSync(path(inventoryPath(group)), 'utf8'));
  assert.deepEqual(sorted(entries.map((e) => e.id)), sorted(GROUPS[group]), `${group}: exact inventory (including fourth variants)`);
  for (const e of entries) {
    assert.equal(e.node, e.id, `${e.id}: node`);
    assert.equal(e.glb, exportPath(group), `${e.id}: export path`);
    assert.equal(e.source, `assets/blend/cities/ixari_${group}.blend`, `${e.id}: source path`);
    assert(existsSync(path(e.source)), `${e.id}: missing editable source ${e.source}`);
    assert.equal(e.bounds.length, 2, `${e.id}: bounds`);
    e.bounds.forEach((v) => vector(v, `${e.id} bounds`));
    for (let i = 0; i < 3; i++) positive(e.bounds[1][i] - e.bounds[0][i], `${e.id} dimension ${i}`);
    positive(e.authoredHeight, `${e.id} authoredHeight`);
    assert(Math.abs(e.authoredHeight - (e.bounds[1][2] - e.bounds[0][2])) < 1e-5, `${e.id}: inventory Z height`);
    for (const k of ['markers', 'colliders', 'openings', 'walkRoutes', 'lodTriangles']) assert(Array.isArray(e[k]), `${e.id}: missing ${k}`);
    assert.equal(e.lodTriangles.length, 4, `${e.id}: four saved LOD triangle counts`);
    assert(e.colliders.length > 0, `${e.id}: no colliders`);
    assert.equal(new Set(e.colliders).size, e.colliders.length, `${e.id}: duplicate collider names`);
    assert.equal(new Set(e.markers.map((m) => m.name)).size, e.markers.length, `${e.id}: duplicate marker names`);
    const assetClass = ['landmarks', 'anchor'].includes(group) ? 'hero' : group === 'kit' ? 'kit' : group === 'props' ? 'prop' : 'building';
    assert.equal(e.assetClass, assetClass, `${e.id}: asset class`);
    for (const [i, count] of e.lodTriangles.entries()) {
      assert(Number.isInteger(count) && count > 0, `${e.id}: LOD${i} triangles`);
      if (i) assert(count < e.lodTriangles[i - 1], `${e.id}: LOD${i} does not reduce geometry`);
    }
    for (const route of e.walkRoutes) {
      assert(route.points.length >= 2, `${e.id}: route needs endpoints`);
      route.points.forEach((p) => vector(p, `${e.id} route`));
      assert(route.width >= 3 && route.height >= 3.2, `${e.id}: declared 3m x 3.2m walk clearance`);
    }
    for (const opening of e.openings) {
      vector(opening.center, `${e.id} opening`);
      assert(['X', 'Y'].includes(opening.axis), `${e.id}: unsupported doorway axis`);
      assert(opening.width >= 3 && opening.height >= 3.2, `${e.id}: doorway dimensions`);
      assert(e.walkRoutes.length, `${e.id}: doorway has no declared route`);
    }
  }
  return entries;
}

function glb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'GLB version');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB length');
  let json, bin;
  for (let offset = 12; offset < bytes.length;) {
    const size = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4);
    assert(size % 4 === 0 && offset + 8 + size <= bytes.length, 'GLB chunk length');
    const chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === 0x4e4f534a) {
      assert(!json, 'duplicate JSON');
      json = JSON.parse(chunk.toString('utf8'));
    } else if (type === 0x004e4942) {
      assert(!bin, 'duplicate BIN');
      bin = chunk;
    } else assert.fail(`unexpected GLB chunk ${type}`);
    offset += size + 8;
  }
  assert(json && bin, 'GLB needs JSON and BIN');
  return { json, bin };
}

function extensions(json) {
  for (const name of REQUIRED) {
    assert(json.extensionsRequired?.includes(name), `missing required extension ${name}`);
    assert(json.extensionsUsed?.includes(name), `missing used extension ${name}`);
  }
  assert(
    json.bufferViews?.some((v) => v.extensions?.EXT_meshopt_compression),
    'no meshopt streams',
  );
  for (const mesh of json.meshes ?? [])
    for (const p of mesh.primitives) {
      assert.equal(p.mode ?? 4, 4, 'only triangle primitives are supported');
      const position = json.accessors[p.attributes.POSITION];
      assert([5120, 5121, 5122, 5123].includes(position?.componentType), 'position is not quantized');
      for (const index of [...Object.values(p.attributes), p.indices].filter((i) => i !== undefined)) {
        const accessor = json.accessors[index];
        assert(json.bufferViews[accessor.bufferView]?.extensions?.EXT_meshopt_compression, `accessor ${index}: no compressed geometry`);
      }
    }
}

// Matches the stock export's header checks without importing artlib (which imports bpy).
function ktxHeader(bytes, label) {
  assert(
    bytes.length >= 80 && bytes.subarray(0, 12).equals(Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 13, 10, 26, 10])),
    `${label}: KTX2 magic`,
  );
  const u32 = (offset) => bytes.readUInt32LE(offset);
  const width = u32(20),
    height = u32(24),
    levels = u32(40),
    scheme = u32(44);
  positive(width, `${label} width`);
  positive(height, `${label} height`);
  assert.equal(u32(12), 0, `${label}: Basis vkFormat`);
  assert.equal(u32(28), 0, `${label}: 2D depth`);
  assert.equal(u32(32), 0, `${label}: not an array`);
  assert.equal(u32(36), 1, `${label}: one face`);
  assert.equal(levels, Math.floor(Math.log2(Math.max(width, height))) + 1, `${label}: full mip chain`);
  const dfd = u32(48),
    dfdLength = u32(52);
  assert(dfd >= 80 + 24 * levels && dfdLength >= 16 && dfd + dfdLength <= bytes.length, `${label}: DFD range`);
  const codec = bytes[dfd + 12],
    transfer = bytes[dfd + 14];
  assert([163, 166].includes(codec), `${label}: ETC1S or UASTC required`);
  assert.equal(scheme, codec === 163 ? 1 : 2, `${label}: BasisLZ / Zstandard scheme`);
  assert([1, 2].includes(transfer), `${label}: linear or sRGB transfer`);
  const ranges = [];
  for (let i = 0; i < levels; i++) {
    const offset = Number(bytes.readBigUInt64LE(80 + i * 24));
    const size = Number(bytes.readBigUInt64LE(88 + i * 24));
    assert(
      Number.isSafeInteger(offset) && Number.isSafeInteger(size) && size > 0 && offset >= 80 + 24 * levels && offset + size <= bytes.length,
      `${label}: mip ${i} byte range`,
    );
    assert(
      ranges.every(([a, b]) => offset + size <= a || offset >= b),
      `${label}: overlapping mip ${i}`,
    );
    ranges.push([offset, offset + size]);
  }
  return { width, height, codec, transfer };
}

function textures({ json, bin }, group) {
  assert(json.images?.length > 0 && json.materials?.length > 0, `${group}: missing textures/materials`);
  const headers = json.images.map((im, i) => {
    assert.equal(im.mimeType, 'image/ktx2', `${group} image ${i}: KTX2 required`);
    assert(!im.uri, `${group}: external image prohibited`);
    const view = json.bufferViews[im.bufferView];
    assert(view && view.buffer === 0, `${group}: embedded image buffer`);
    const start = view.byteOffset ?? 0;
    assert(start + view.byteLength <= bin.length, `${group}: image byte range`);
    return ktxHeader(bin.subarray(start, start + view.byteLength), `${group} image ${i}`);
  });
  const used = new Set(),
    slots = new Set();
  const color = new Set(['baseColorTexture', 'emissiveTexture', 'sheenColorTexture', 'specularColorTexture']);
  const visit = (obj) => {
    for (const [key, value] of Object.entries(obj)) {
      if (!value || typeof value !== 'object') continue;
      if (key.endsWith('Texture')) {
        const texture = json.textures[value.index];
        assert(texture && texture.source === undefined, `${group} ${key}: no fallback image`);
        const source = texture.extensions?.KHR_texture_basisu?.source;
        const header = headers[source];
        assert(header, `${group} ${key}: missing basisu source`);
        used.add(source);
        slots.add(key);
        assert.equal(header.transfer, color.has(key) ? 2 : 1, `${group} ${key}: wrong color space`);
        const slot = key.replace(/Texture$/, '');
        const codec = rules.textures.codec[slot] ?? rules.textures.codec.other;
        assert.equal(header.codec, codec === 'uastc' ? 166 : 163, `${group} ${key}: stock ${codec} codec`);
        const cls = group === 'props' ? 'prop' : ['landmarks', 'anchor'].includes(group) ? 'hero' : 'building';
        assert.equal(Math.max(header.width, header.height), rules.classes[cls].texture, `${group} ${key}: authored texture resolution`);
      } else visit(value);
    }
  };
  json.materials.forEach(visit);
  for (const slot of ['baseColorTexture', 'normalTexture', 'metallicRoughnessTexture', 'occlusionTexture', 'emissiveTexture'])
    assert(slots.has(slot), `${group}: missing PBR ${slot}`);
  assert.equal(used.size, headers.length, `${group}: unused embedded images`);
}

async function decode(bytes, json) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(bytes);
  const meshes = doc.getRoot().listMeshes();
  assert.equal(meshes.length, json.meshes.length, 'decoded mesh order/count');
  const geometry = meshes.map((mesh, meshIndex) => {
    assert.equal(mesh.getName(), json.meshes[meshIndex].name ?? '', 'decoded mesh identity');
    return mesh.listPrimitives().map((primitive) => {
      const accessor = primitive.getAttribute('POSITION');
      assert(accessor?.getCount() > 0 && accessor.getElementSize() === 3, 'decoded POSITION');
      const positions = new Float32Array(accessor.getCount() * 3),
        xyz = [];
      for (let i = 0; i < accessor.getCount(); i++) {
        accessor.getElement(i, xyz); // includes normalized integer decoding
        assert(xyz.every(Number.isFinite), `non-finite decoded position ${i}`);
        positions.set(xyz, i * 3);
      }
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const index = primitive.getIndices();
      if (index) {
        const indices = index.getArray();
        assert(
          indices.every((i) => i >= 0 && i < accessor.getCount()),
          'decoded index outside POSITION',
        );
        g.setIndex(new THREE.BufferAttribute(indices, 1));
      }
      const count = g.index?.count ?? accessor.getCount();
      assert(count > 0 && count % 3 === 0, 'decoded triangle count');
      g.computeBoundingBox();
      return g;
    });
  });
  const root = new THREE.Group();
  const nodes = json.nodes.map((n) => {
    assert(n.skin === undefined, 'Ixari city artifacts must be static');
    const primitives = n.mesh === undefined ? [] : geometry[n.mesh];
    const o = primitives.length === 1 ? new THREE.Mesh(primitives[0]) : new THREE.Object3D();
    if (primitives.length > 1) for (const g of primitives) o.add(new THREE.Mesh(g));
    o.name = n.name ?? '';
    o.userData = { ...globalThis.structuredClone(n.extras ?? {}), name: n.name ?? '' };
    if (n.matrix) {
      assert(n.matrix.length === 16 && n.matrix.every(Number.isFinite), `${n.name}: matrix`);
      o.matrix.fromArray(n.matrix);
      o.matrixAutoUpdate = false;
    } else {
      vector(n.translation ?? [0, 0, 0], `${n.name} translation`);
      vector(n.scale ?? [1, 1, 1], `${n.name} scale`);
      assert((n.rotation ?? [0, 0, 0, 1]).length === 4 && (n.rotation ?? []).every(Number.isFinite), `${n.name}: rotation`);
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      if (n.scale) o.scale.fromArray(n.scale);
    }
    return o;
  });
  const linked = new Set();
  const attach = (parent, index) => {
    assert(nodes[index] && !linked.has(index), `invalid/multiply-parented node ${index}`);
    linked.add(index);
    parent.add(nodes[index]);
    for (const child of json.nodes[index].children ?? []) attach(nodes[index], child);
  };
  assert.equal(json.scenes.length, 1, 'one export scene');
  for (const index of json.scenes[json.scene ?? 0].nodes) attach(root, index);
  assert.equal(linked.size, nodes.length, 'unreachable GLB nodes');
  root.updateMatrixWorld(true);
  return root;
}

function meshFacts(nodes) {
  const box = new THREE.Box3(),
    meshes = new Set();
  let triangles = 0;
  for (const node of nodes)
    node.traverse((o) => {
      if (!o.isMesh || meshes.has(o)) return;
      meshes.add(o);
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
  assert(meshes.size && !box.isEmpty(), 'missing actual geometry');
  return { box, triangles, meshes };
}

function layout(root, entries) {
  const model = collectLods(root);
  assert.deepEqual(sorted(model.assets.map((a) => a.name)), sorted(entries.map((e) => e.id)), 'exact exported assets / fourth variants');
  root.traverse((o) => assert(!/^REF(?:_|$)/i.test(nameOf(o)), `reference leaked: ${nameOf(o)}`));
  for (const entry of entries) {
    const asset = model.assets.find((a) => a.name === entry.id);
    assert.deepEqual(
      asset.variants.map((v) => v.name),
      [entry.id],
      `${entry.id}: exact variant`,
    );
    const variant = asset.variants[0];
    assert.deepEqual([...variant.lods.keys()].sort(), [0, 1, 2, 3], `${entry.id}: LOD0..LOD3 required; fallback is not acceptable`);
    for (let lod = 0; lod < 4; lod++) {
      assert.deepEqual(showLod(model, lod, { asset: entry.id, variant: entry.id }), { [entry.id]: lod }, `${entry.id}: no silent LOD fallback`);
      const actual = new Set();
      root.traverseVisible((o) => {
        if (o.isMesh) actual.add(o);
      });
      const facts = meshFacts(variant.lods.get(lod));
      assert.deepEqual(actual, facts.meshes, `${entry.id} LOD${lod}: only selected geometry visible`);
      assert(
        model.helpers.every((o) => !o.visible),
        'review must hide every helper',
      );
    }
  }
  return model;
}

function assetFacts(root, e) {
  const objects = [];
  root.traverse((o) => {
    if (nameOf(o) === e.node) objects.push(o);
  });
  assert.equal(objects.length, 1, `${e.id}: unique exact node`);
  const top = objects[0],
    named = new Map();
  top.traverse((o) => {
    const name = nameOf(o);
    if (!name) return;
    assert(!named.has(name), `${e.id}: duplicate node ${name}`);
    named.set(name, o);
  });
  const lod = named.get(`${e.id}_LOD0`);
  assert(lod, `${e.id}: exact case-sensitive LOD0 name`);
  const box = meshFacts([lod]).box;
  const longest = Math.max(...new THREE.Vector3().subVectors(yup(e.bounds[1]), yup(e.bounds[0])).toArray().map(Math.abs));
  // Two 14-bit quantization cells plus float noise, not an arbitrary percentage of a building.
  const tolerance = 0.002 + (2 * longest) / (2 ** rules.geometry.positionBits - 1);
  const expectedBox = new THREE.Box3().setFromPoints([yup(e.bounds[0]), yup(e.bounds[1])]);
  for (const end of ['min', 'max'])
    for (const axis of ['x', 'y', 'z'])
      assert(
        Math.abs(box[end][axis] - expectedBox[end][axis]) <= tolerance,
        `${e.id}: Y-up ${end}.${axis} ${box[end][axis]} != ${expectedBox[end][axis]} (tolerance ${tolerance})`,
      );
  assert(Math.abs(box.max.y - box.min.y - e.authoredHeight) <= 2 * tolerance, `${e.id}: authored height must be glTF Y`);
  assert.equal(top.userData.asset_class, e.assetClass, `${e.id}: exported asset_class`);
  const [min, max] = rules.classes[e.assetClass].tris;
  assert(e.lodTriangles[0] >= min && e.lodTriangles[0] <= max, `${e.id}: LOD0 class budget`);
  const helpers = [...named.values()].filter((o) => helperKind(o));
  assert.deepEqual(sorted(helpers.map(nameOf)), sorted([...e.colliders, ...e.markers.map((m) => m.name)]), `${e.id}: exact helper inventory`);
  const boxes = e.colliders.map((name) => {
    assert(/^COL_/.test(name), `${e.id}: case-sensitive collider ${name}`);
    const o = named.get(name);
    assert(o && helperKind(o) === 'COL', `${e.id}: missing actual collider ${name}`);
    const b = meshFacts([o]).box;
    for (const d of b.getSize(new THREE.Vector3()).toArray()) positive(d, `${name} dimension`);
    return b;
  });
  return { named, box, boxes, tolerance };
}

function light(o) {
  assert(/^Light_/.test(nameOf(o)), 'case-sensitive Light_ marker');
  assert.equal(helperKind(o), 'Light');
  for (const key of ['intensity', 'distance']) positive(o.userData[key], `${nameOf(o)} ${key}`);
  assert(/^#[\da-f]{6}$/i.test(o.userData.color) && o.userData.color.toLowerCase() !== '#000000', `${nameOf(o)}: non-black RGB hex light color`);
}

function markers(e, facts) {
  for (const m of e.markers) {
    assert(/^(Interact_|Light_|BAY_)/.test(m.name), `${e.id}: case-sensitive marker ${m.name}`);
    vector(m.position, m.name);
    const o = facts.named.get(m.name);
    assert(o && !o.isMesh && o.children.length === 0, `${m.name}: actual point marker`);
    assert(positionOf(o).distanceTo(yup(m.position)) < 1e-4, `${m.name}: Y-up position drift`);
    for (const [k, v] of Object.entries(m.properties)) assert.deepEqual(o.userData[k], v, `${m.name}: exported property ${k}`);
    if (m.name.startsWith('Light_')) light(o);
  }
  if (!e.id.startsWith('wall_') && e.id !== 'lamp_ixari_biolume')
    assert(
      e.markers.some((m) => m.name.startsWith('Interact_')),
      `${e.id}: useful interaction marker required`,
    );
  if (e.id === 'lamp_ixari_biolume')
    assert(
      e.markers.some((m) => m.name.startsWith('Light_')),
      'biolume needs a real light',
    );
  if (['ixari_shipyard', 'ixari_salvage_yard'].includes(e.id)) {
    positive(e.padDiameter, `${e.id} padDiameter`);
    const bays = e.markers.filter((m) => m.name.startsWith('BAY_'));
    assert.equal(bays.length, 1, `${e.id}: one bay marker`);
    assert.equal(facts.named.get(bays[0].name).userData.padDiameter, e.padDiameter, `${e.id}: exported pad diameter`);
    assert(e.padDiameter >= (e.id === 'ixari_shipyard' ? 36 : 24), `${e.id}: useful pad diameter`);
    const size = facts.box.getSize(new THREE.Vector3());
    assert(Math.min(size.x, size.z) >= e.padDiameter, `${e.id}: pad exceeds footprint`);
  }
}

function legacyRoute(e, route) {
  return route.kind === 'spiral' || e.id === 'bridge_ixari';
}

function routeSamples(route, step = 0.1) {
  const out = [];
  for (let i = 1; i < route.points.length; i++) {
    const a = yup(route.points[i - 1]),
      b = yup(route.points[i]);
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    assert(n < 10000, 'unbounded route segment');
    for (let j = i === 1 ? 0 : 1; j <= n; j++) out.push(a.clone().lerp(b, j / n));
  }
  return out;
}

function walk(e, route, boxes, tolerance, radius = 0.38, height = 1.85) {
  const samples = routeSamples(route);
  let previous = samples[0],
    p = previous.clone().add(new THREE.Vector3(0, tolerance, 0));
  for (const wanted of samples) {
    p.add(new THREE.Vector3().subVectors(wanted, previous));
    const before = p.clone();
    resolveBoxes(p, new THREE.Vector3().subVectors(wanted, previous), boxes, radius, height);
    assert(
      Math.hypot(p.x - wanted.x, p.z - wanted.z) <= tolerance && Math.abs(p.y - (wanted.y + tolerance)) <= tolerance,
      `${e.id}: blocked route at ${wanted.toArray().map((v) => v.toFixed(3))}, resolveBoxes displacement ${p.clone().sub(before).toArray()} (R=${radius}, H=${height})`,
    );
    previous = wanted;
  }
}

function sweepClearance(e, route, facts) {
  const first = yup(route.points[0]),
    last = yup(route.points.at(-1));
  const direction = last.clone().sub(first).setY(0).normalize();
  assert(direction.lengthSq() > 0, `${e.id}: straight route needs a horizontal direction`);
  const lateral = new THREE.Vector3(-direction.z, 0, direction.x);
  for (const point of route.points) assert(Math.abs(yup(point).sub(first).dot(lateral)) < 1e-4, `${e.id}: unclassified curved route`);
  // Sweep the real actor across the width. Enlarging R would also enlarge depth,
  // incorrectly testing space beyond the beginning/end of the declared corridor.
  const half = route.width / 2 - 0.38,
    steps = Math.ceil((2 * half) / 0.38);
  every(
    Array.from({ length: steps + 1 }, (_, i) => -half + (2 * half * i) / steps),
    (offset) => {
      const shifted = { points: route.points.map((p) => zup(yup(p).addScaledVector(lateral, offset))) };
      walk(e, shifted, facts.boxes, facts.tolerance, 0.38, route.height);
    },
  );
}

function straightRoutes(e, facts, clearance = false) {
  for (const route of e.walkRoutes.filter((r) => !legacyRoute(e, r))) {
    if (clearance) sweepClearance(e, route, facts);
    else {
      walk(e, route, facts.boxes, facts.tolerance);
      walk(e, { ...route, points: [...route.points].reverse() }, facts.boxes, facts.tolerance);
    }
  }
  for (const opening of e.openings) {
    const center = yup(opening.center),
      axis = opening.axis === 'Y' ? 'z' : 'x';
    assert(
      e.walkRoutes.some(
        (route) =>
          !legacyRoute(e, route) &&
          route.points.slice(1).some((point, i) => {
            const a = yup(route.points[i]),
              b = yup(point),
              delta = b[axis] - a[axis];
            if (!delta) return false;
            const t = (center[axis] - a[axis]) / delta;
            if (t < 0 || t > 1) return false;
            return a.lerp(b, t).distanceTo(center) < 0.1;
          }),
      ),
      `${e.id}: no straight route crosses declared opening`,
    );
    const a = center.clone(),
      b = center.clone();
    a[axis] -= 1;
    b[axis] += 1;
    const route = { points: [zup(a), zup(b)], width: opening.width, height: opening.height };
    if (clearance) sweepClearance(e, route, facts);
    else walk(e, route, facts.boxes, facts.tolerance);
  }
}

function interactionPoses(e, facts, o) {
  const marker = positionOf(o),
    near = facts.box.clone().expandByScalar(2);
  assert(near.containsPoint(marker), `${nameOf(o)}: unreachable marker outside asset`);
  const candidates = e.walkRoutes.length
    ? e.walkRoutes.flatMap((r) => routeSamples(r, 0.25).map((feet) => ({ feet, legacy: legacyRoute(e, r) })))
    : [0, 0.4, 0.8, 1.2].flatMap((radius) =>
        Array.from({ length: radius ? 16 : 1 }, (_, i) => ({
          feet: new THREE.Vector3(marker.x + radius * Math.cos((i * Math.PI) / 8), facts.box.min.y, marker.z + radius * Math.sin((i * Math.PI) / 8)),
          legacy: false,
        })),
      );
  const poses = candidates.filter(({ feet }) => Math.hypot(feet.x - marker.x, feet.z - marker.z) <= 1.5 && marker.y - feet.y >= 0 && marker.y - feet.y <= 1.85);
  assert(poses.length, `${nameOf(o)}: unreachable marker; no 1.85m standing pose within 1.5m of a declared route`);
  return poses;
}

function reachable(e, facts, o) {
  const standing = interactionPoses(e, facts, o).some(({ feet }) => {
    const p = feet.clone().add(new THREE.Vector3(0, facts.tolerance, 0));
    const original = p.clone();
    resolveBoxes(p, new THREE.Vector3(), facts.boxes);
    if (p.distanceTo(original) > facts.tolerance) return false;
    const eye = p.clone().add(new THREE.Vector3(0, 1.1, 0)),
      target = positionOf(o);
    const length = eye.distanceTo(target);
    if (length < 1e-5) return true;
    const ray = new THREE.Ray(eye, target.clone().sub(eye).normalize());
    return facts.boxes.every((box) => {
      const hit = ray.intersectBox(box, new THREE.Vector3());
      return !hit || hit.distanceTo(eye) >= length - facts.tolerance;
    });
  });
  assert(standing, `${nameOf(o)}: unreachable marker; no clear 1.85m standing pose within 1.5m of a declared route`);
}

function every(items, check) {
  const errors = [];
  for (const item of items)
    try {
      check(item);
    } catch (error) {
      errors.push(error.message);
    }
  assert.equal(errors.length, 0, errors.join('\n'));
}

describe('P1.E10.T06 actual Ixari GLBs: CPU consumer/artifact contract', () => {
  it('has all 33 assets and all eight inventories and exported packages', () => {
    assert.equal(Object.values(GROUPS).flat().length, 33);
    const missing = Object.keys(GROUPS)
      .flatMap((g) => [inventoryPath(g), exportPath(g)])
      .filter((p) => !existsSync(path(p)));
    assert.deepEqual(missing, [], `MISSING IXARI ARTIFACTS; parent must finish stock export:\n${missing.join('\n')}`);
    assert.equal(Object.keys(GROUPS).flatMap(inventory).length, 33);
  });

  for (const group of Object.keys(GROUPS))
    describe(group, () => {
      let entries, raw, root;
      beforeAll(async () => {
        for (const p of [inventoryPath(group), exportPath(group)]) assert(existsSync(path(p)), `MISSING IXARI ARTIFACT: ${p}; run parent stock export first`);
        entries = inventory(group);
        const bytes = readFileSync(path(exportPath(group)));
        raw = glb(bytes);
        root = await decode(bytes, raw.json);
      });

      it('requires stock compression and audits actual KTX2 image headers', () => {
        extensions(raw.json);
        textures(raw, group);
      });
      it('selects every exact asset and LOD through the real review consumer without fallback', () => {
        layout(root, entries);
      });
      it('matches the saved inventory triangle counts against decoded geometry at all four levels', () => {
        const model = collectLods(root);
        every(
          entries.flatMap((e) => [0, 1, 2, 3].map((lod) => ({ e, lod }))),
          ({ e, lod }) => {
            const variant = model.assets.find((a) => a.name === e.id)?.variants.find((v) => v.name === e.id);
            assert(variant?.lods.has(lod), `${e.id}: missing LOD${lod}`);
            const { triangles } = meshFacts(variant.lods.get(lod));
            assert.equal(
              triangles,
              e.lodTriangles[lod],
              `${e.id} LOD${lod}: decoded ${triangles} != inventory ${e.lodTriangles[lod]}; source/export difference needs reconciliation`,
            );
          },
        );
      });
      it('preserves metric Y-up geometry, case-sensitive helpers, lights and useful markers', () => {
        every(entries, (e) => {
          const facts = assetFacts(root, e);
          markers(e, facts);
          for (const m of e.markers.filter((m) => m.name.startsWith('Interact_'))) {
            const o = facts.named.get(m.name);
            // Curved-route standing uses the same known-limited AABBs as curved walking.
            // Placement still gates here; standing collision is reported in the legacy test below.
            if (interactionPoses(e, facts, o).some((pose) => !pose.legacy)) reachable(e, facts, o);
          }
        });
      });
      it('walks every declared straight doorway route in both directions using real resolveBoxes and transformed collider AABBs', () => {
        every(entries, (e) => straightRoutes(e, assetFacts(root, e)));
      });
      it('preserves the full declared width and height of straight routes and doorways', () => {
        every(entries, (e) => straightRoutes(e, assetFacts(root, e), true));
      });
      it('reports curved bridge/spiral AABB limits separately; this is not traversal qualification', () => {
        for (const e of entries)
          for (const route of e.walkRoutes.filter((r) => legacyRoute(e, r))) {
            const facts = assetFacts(root, e);
            let result = 'centerline had no displacement';
            try {
              walk(e, route, facts.boxes, facts.tolerance);
            } catch (error) {
              result = error.message;
            }
            warn(
              `LEGACY AABB LIMIT — ${e.id}, ${route.kind ?? 'curved bridge'}: ${result}. Axis-aligned boxes do not qualify sloped/curved deck or rail traversal; E10.T01 runtime traversal remains unproven.`,
            );
          }
        for (const e of entries) {
          const facts = assetFacts(root, e);
          for (const m of e.markers.filter((m) => m.name.startsWith('Interact_'))) {
            const o = facts.named.get(m.name);
            if (!interactionPoses(e, facts, o).every((pose) => pose.legacy)) continue;
            let result = 'a clear standing pose exists';
            try {
              reachable(e, facts, o);
            } catch (error) {
              result = error.message;
            }
            warn(`LEGACY AABB LIMIT — ${m.name}: ${result}; curved approach remains unqualified.`);
          }
        }
      });

      it('rejects an in-memory actual artifact missing each required extension', () => {
        extensions(raw.json);
        for (const extension of REQUIRED) {
          const changed = globalThis.structuredClone(raw.json);
          changed.extensionsRequired = changed.extensionsRequired.filter((name) => name !== extension);
          expect(() => extensions(changed)).toThrow(`missing required extension ${extension}`);
        }
      });

      if (group === 'low') {
        it('rejects removal of the actual fourth variant and actual LOD3', () => {
          layout(root, entries);
          const missingVariant = root.clone(true);
          const fourth = missingVariant.getObjectByName('ixari_low_3');
          assert(fourth, 'negative control needs actual fourth variant');
          fourth.removeFromParent();
          expect(() => layout(missingVariant, entries)).toThrow('exact exported assets / fourth variants');
          const missingLod = root.clone(true);
          const lod3 = missingLod.getObjectByName('ixari_low_0_LOD3');
          assert(lod3, 'negative control needs actual LOD3');
          lod3.removeFromParent();
          expect(() => layout(missingLod, entries)).toThrow('LOD0..LOD3 required');
        });
        it('rejects invalid actual light extras and marker casing', () => {
          const e = entries[0],
            facts = assetFacts(root, e);
          const name = e.markers.find((m) => m.name.startsWith('Light_')).name;
          const original = facts.named.get(name);
          light(original);
          for (const field of ['intensity', 'distance'])
            for (const value of [0, -1, NaN, Infinity]) {
              const changed = original.clone();
              changed.userData[field] = value;
              expect(() => light(changed)).toThrow('positive finite');
            }
          const changed = original.clone();
          changed.userData.name = name.toLowerCase();
          expect(() => light(changed)).toThrow('case-sensitive');
        });
        it('rejects an actual collider moved across a doorway and an unreachable actual marker', () => {
          const e = entries[0],
            facts = assetFacts(root, e);
          straightRoutes(e, facts);
          const opening = yup(e.openings[0].center);
          const original = facts.boxes.find((b) => b.max.y - b.min.y > 2);
          assert(original, 'negative control needs actual tall collider');
          const blocking = original.clone();
          const center = blocking.getCenter(new THREE.Vector3());
          blocking.translate(new THREE.Vector3(opening.x - center.x, opening.y - blocking.min.y, opening.z - center.z));
          expect(() => straightRoutes(e, { ...facts, boxes: [...facts.boxes, blocking] })).toThrow('blocked route');
          const name = e.markers.find((m) => m.name.startsWith('Interact_')).name;
          reachable(e, facts, facts.named.get(name));
          const mutated = root.clone(true),
            marker = mutated.getObjectByName(name);
          marker.position.x += 10000;
          mutated.updateMatrixWorld(true);
          expect(() => reachable(e, facts, marker)).toThrow('unreachable marker');
        });
      }
    });
});
