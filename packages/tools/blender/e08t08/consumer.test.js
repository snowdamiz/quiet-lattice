import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { applyGameLook, collectLods, isHelper, nodeName, parseSpec, showLod } from '../../../client/src/dev/review.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const proof = JSON.parse(readFileSync(new URL('./reports/source-contract.json', import.meta.url)));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const expected = {
  quad_heavy: ['0', '0_charge', '0_stomp', '1', '1_charge', '1_stomp'],
  quad_grazer: ['0', '0_kick', '1', '1_kick'],
  quad_small: ['0', '0_bite_swarm', '1', '1_bite_swarm', 'predator', 'predator_bite_swarm'],
  biped: ['0', '0_leap', '0_claw_combo', '1', '1_leap', '1_claw_combo', 'predator', 'predator_leap', 'predator_claw_combo'],
  flyer: ['0', '0_dive', '0_screech', '1', '1_dive', '1_screech', 'predator', 'predator_dive', 'predator_screech'],
  outpost_drone: [''], outpost_overseer: ['', 'dome', 'core'],
};
const reports = [];
// Blender's pinned stock glTF exporter writes RGBA COLOR_n as normalized
// uint16, even for FLOAT_COLOR sources. Three decodes n/65535. This is an
// inherited export limitation: geometry.quantize=false does not change it.
const MASK_CHANNEL_ERROR = .5 / 65535 + 1e-7;

async function load(file) {
  const bytes = readFileSync(`${ROOT}packages/client/public/models/${file.family}/${file.stem}.glb`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
  expect(json.extensionsRequired).toContain('KHR_texture_basisu');
  expect(json.extensionsRequired.includes('KHR_mesh_quantization')).toBe(file.family === 'constructs');
  expect(json.animations ?? []).toHaveLength(0);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const textures = [];
  // This CPU test runs the actual GLTFLoader geometry and Review selection/mask
  // consumers. It does not create a renderer or claim to test KTX pixel display.
  // Stock Blender export validation separately transcodes every actual KTX image.
  // A texture metadata proxy avoids a WebGL transcoder and browser image APIs.
  loader.register((parser) => ({
    name: 'KHR_texture_basisu',
    async loadTexture(index) {
      const ext = parser.json.textures[index].extensions?.KHR_texture_basisu;
      if (!ext) return null;
      const image = parser.json.images[ext.source];
      expect(image.mimeType).toBe('image/ktx2');
      const data = new DataView(await parser.getDependency('bufferView', image.bufferView));
      const width = data.getUint32(20, true), height = data.getUint32(24, true), levels = data.getUint32(40, true);
      expect(width).toBe(2048); expect(height).toBe(2048); expect(levels).toBe(12);
      textures.push({ index, width, height, levels });
      const texture = new THREE.Texture({ width, height });
      texture.name = `CPU metadata proxy ${index}`;
      return texture;
    },
  }));
  await MeshoptDecoder.ready;
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return { scene: gltf.scene, json, sha256: hash(bytes), textures };
}

function meshes(nodes) {
  const out = [];
  for (const node of nodes) node.traverse((o) => { if (o.isMesh && !isHelper(o)) out.push(o); });
  return out;
}

function checkRig(geometry, walker = true) {
  const { position, _limb: limb, _pivot: pivot, _glow: glow, color } = geometry.attributes;
  expect(limb?.count).toBe(position.count); expect(pivot?.count).toBe(position.count);
  expect(glow?.count).toBe(position.count); expect(color?.count).toBe(position.count);
  expect(pivot.itemSize).toBe(3); expect(color.itemSize).toBe(4);
  for (const a of [position, limb, pivot, glow]) expect(a.array).toBeInstanceOf(Float32Array);
  expect(color.array).toBeInstanceOf(Uint16Array); expect(color.normalized).toBe(true);
  let glowCount = 0;
  for (let i = 0; i < position.count; i++) {
    const id = limb.getX(i);
    if (!Number.isInteger(id) || id < 0 || id > 8) throw new Error(`integer limb contract at ${i}: ${id}`);
    if (![0, 1].includes(glow.getX(i))) throw new Error('binary glow contract');
    glowCount += glow.getX(i);
    if (Math.abs(color.getX(i) + color.getY(i) + color.getZ(i) - 1) > 3 * MASK_CHANNEL_ERROR) throw new Error(`mask sum contract at ${i}: ${color.getX(i)},${color.getY(i)},${color.getZ(i)}; ${color.array.constructor.name}; normalized=${color.normalized}`);
    if (walker && id >= 1 && id <= 4 && pivot.getZ(i) <= 0) throw new Error('Z-up pivot contract');
  }
  expect(glowCount / position.count).toBeLessThan(.025);
}

function pointKey(p) { return p.map((x) => Math.round(x * 1000)).join(','); }
function checkSamples(objects, samples) {
  const lookup = new Map();
  for (const o of objects) {
    const g = o.geometry;
    for (let i = 0; i < g.attributes.position.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(g.attributes.position, i).applyMatrix4(o.matrixWorld).toArray();
      const k = pointKey(p), list = lookup.get(k) ?? [];
      list.push({ p, g, i }); lookup.set(k, list);
    }
  }
  for (const s of samples) {
    const candidates = lookup.get(pointKey(s.position)) ?? [];
    const found = candidates.some(({ p, g, i }) => {
      const a = g.attributes;
      return p.every((x, k) => Math.abs(x - s.position[k]) < 2e-5) &&
        a._limb.getX(i) === s.limb && a._glow.getX(i) === s.glow &&
        [a._pivot.getX(i), a._pivot.getY(i), a._pivot.getZ(i)].every((x, k) => Math.abs(x - s.pivot[k]) < 2e-6) &&
        [a.color.getX(i), a.color.getY(i), a.color.getZ(i), a.color.getW(i)].every((x, k) => Math.abs(x - s.mask[k]) <= MASK_CHANNEL_ERROR);
    });
    expect(found, `saved point/joint/mask survived actual decode: ${JSON.stringify(s)}`).toBe(true);
  }
}

function checkInventory(scene, stem) {
  const model = collectLods(scene);
  expect(model.assets.map((a) => a.name)).toEqual([stem]);
  const ids = expected[stem].map((s) => stem + (s ? `_${s}` : ''));
  expect(model.assets[0].variants.map((v) => v.name).sort()).toEqual(ids.toSorted());
  for (const v of model.assets[0].variants) expect([...v.lods.keys()].sort()).toEqual([0, 1, 2, 3]);
  return model;
}

function checkMarkers(model, file) {
  for (const marker of file.markers) {
    const object = model.helpers.find((o) => nodeName(o) === marker.name);
    expect(object, marker.name).toBeDefined();
    if (marker.type === 'EMPTY') {
      expect(object.isMesh).not.toBe(true);
      const actual = object.getWorldPosition(new THREE.Vector3()).toArray();
      if (!actual.every((x, k) => Math.abs(x - marker.position[k]) < .004)) throw new Error('muzzle position contract');
    } else {
      // Mesh quantization may recenter the node; its decoded world box is the
      // collider boundary. Empty muzzle transforms must remain unchanged.
      const box = new THREE.Box3().setFromObject(object, true);
      expect(box.min.toArray().every((x, k) => Math.abs(x - marker.min[k]) < .004)).toBe(true);
      expect(box.max.toArray().every((x, k) => Math.abs(x - marker.max[k]) < .004)).toBe(true);
    }
  }
}

it('P1.E08.T08: actual compressed geometry reaches stock Review pose, mask, and LOD consumers', async () => {
  expect(proof.files).toHaveLength(7);
  let totalVariants = 0, totalLods = 0, controls = 0;
  for (const file of proof.files) {
    expect(hash(readFileSync(`${ROOT}${file.source}`))).toBe(file.sha256);
    const { scene, json, sha256, textures } = await load(file);
    const model = checkInventory(scene, file.stem);
    const variants = [], geometryHashes = new Map();
    for (const v of model.assets[0].variants) {
      const source = file.variants.find((s) => s.id === v.name);
      const tris = [];
      for (let level = 0; level < 4; level++) {
        const spec = parseSpec(`${file.family}/${file.stem}:${file.stem}/${v.name}`);
        expect(spec.url).toBe(`/models/${file.family}/${file.stem}.glb`);
        expect(showLod(model, level, spec)).toEqual({ [v.name]: level });
        const objects = meshes(v.lods.get(level));
        const drawn = []; scene.traverseVisible((o) => { if (o.isMesh) drawn.push(o); });
        expect(new Set(drawn)).toEqual(new Set(objects));
        let count = 0;
        for (const o of objects) {
          expect(o.isSkinnedMesh).not.toBe(true);
          expect(o.morphTargetInfluences ?? []).toHaveLength(0);
          count += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
          if (file.family === 'creatures') {
            try { checkRig(o.geometry, file.stem !== 'flyer'); } catch (error) { throw new Error(`${v.name} LOD${level} ${o.name}: ${error.message}`, { cause:error }); }
          }
          else {
            expect(o.geometry.attributes.color).toBeUndefined();
            expect(o.geometry.attributes._pivot).toBeUndefined();
          }
        }
        tris.push(count); totalLods++;
        if (level === 0 && file.family === 'creatures') checkSamples(objects, source.samples);
        if (level === 0) {
          const geometryHash = hash(Buffer.concat(objects.map((o) => Buffer.from(o.geometry.attributes.position.array.buffer))));
          expect([...geometryHashes.values()]).not.toContain(geometryHash);
          geometryHashes.set(v.name,geometryHash);
          expect(count).toBe(source.triangles);
          const box = new THREE.Box3(); for (const o of objects) box.expandByObject(o, true);
          const actualMin = box.min.toArray(), actualMax = box.max.toArray();
          const min = [source.min[0], source.min[2], -source.max[1]], max = [source.max[0], source.max[2], -source.min[1]];
          expect(actualMin.every((x, k) => Math.abs(x-min[k]) < .004)).toBe(true);
          expect(actualMax.every((x, k) => Math.abs(x-max[k]) < .004)).toBe(true);
          if (file.stem.startsWith('quad')) {
            let shoulder = 0;
            for (const o of objects) for (let i=0;i<o.geometry.attributes.position.count;i++) {
              if (o.geometry.attributes._limb.getX(i)===0) shoulder=Math.max(shoulder,o.geometry.attributes.position.getY(i));
            }
            const [lo,hi]={quad_heavy:[2.5,5],quad_grazer:[1.2,2.4],quad_small:[.4,1.2]}[file.stem];
            expect(shoulder).toBeGreaterThanOrEqual(lo); expect(shoulder).toBeLessThanOrEqual(hi);
          }
        }
      }
      expect(tris[0]).toBeGreaterThanOrEqual(15000); expect(tris[0]).toBeLessThanOrEqual(40000);
      expect(tris[1]).toBeLessThan(tris[0]); expect(tris[2]).toBeLessThan(tris[1]); expect(tris[3]).toBeLessThan(tris[0]*.05);
      variants.push({ id: v.name, lodTriangles: tris, samples: source.samples.length }); totalVariants++;
    }
    const colliders = model.helpers.filter((o) => /^COL_/i.test(nodeName(o)));
    expect(colliders.length).toBe(file.family === 'creatures' ? file.variants.length : 1);
    for (const c of colliders) expect(c.geometry.index.count/3).toBe(12);
    const muzzles = model.helpers.filter((o) => /^Muzzle_/i.test(nodeName(o)));
    expect(muzzles.length).toBe(file.stem === 'outpost_drone' ? 1 : file.stem === 'outpost_overseer' ? 4 : 0);
    checkMarkers(model, file);
    if (muzzles.length) {
      const muzzle = muzzles[0], original = muzzle.position.clone();
      muzzle.position.x += 1; scene.updateMatrixWorld(true);
      expect(() => checkMarkers(model, file)).toThrow('muzzle position'); controls++;
      muzzle.position.copy(original); scene.updateMatrixWorld(true);
    }
    expect(model.helpers.some((o) => /^(Door|Interact|Socket_|HP_|Mount|Spin)/i.test(nodeName(o)))).toBe(false);
    const first = meshes(model.assets[0].variants[0].lods.get(0))[0];
    if (file.family === 'creatures') {
      const raw = first.geometry;
      const fractured = raw.clone(); fractured.attributes._limb.setX(0, 1.5);
      expect(() => checkRig(fractured, file.stem !== 'flyer')).toThrow('integer limb'); controls++;
      const zero = raw.clone(); zero.attributes.color.setXYZ(0,0,0,0);
      expect(() => checkRig(zero, file.stem !== 'flyer')).toThrow('mask sum'); controls++;
      const yUp = raw.clone();
      for (let i=0;i<yUp.attributes.position.count;i++) if (yUp.attributes._limb.getX(i)===1) yUp.attributes._pivot.setZ(i,0);
      if (file.stem !== 'flyer') { expect(() => checkRig(yUp)).toThrow('Z-up pivot'); controls++; }
      const count = applyGameLook(scene, file.family);
      expect(count).toBeGreaterThanOrEqual(file.variants.length * 4);
      expect(first.material.name).toBe('creatures (game look)');
      expect(first.material.roughness).toBe(.65); expect(first.material.metalness).toBe(.05);
      expect(first.geometry.attributes.color.itemSize).toBe(3);
      const colours = first.geometry.attributes.color.array;
      expect(Math.max(...colours.subarray(0,3000)) - Math.min(...colours.subarray(0,3000))).toBeGreaterThan(.02);
    } else {
      const materials = meshes(model.assets[0].variants.flatMap((v) => [...v.lods.values()].flat())).map((o) => o.material);
      expect(applyGameLook(scene, file.family)).toBe(0);
      expect(materials.every((m) => m.name !== 'constructs (game look)')).toBe(true);
      if (file.stem === 'outpost_overseer') expect(json.materials.some((m) => m.name === 'Glass')).toBe(true);
    }
    const broken = scene.clone();
    const level = collectLods(broken).assets[0].variants[0].lods.get(3)[0]; level.removeFromParent();
    expect(() => checkInventory(broken,file.stem)).toThrow(); controls++;
    reports.push({ stem:file.stem,sha256,textures,variants,markers:file.markers });
  }
  expect(totalVariants).toBe(38); expect(totalLods).toBe(152);
  expect(parseSpec('creatures').url).toBe('/models/creatures.glb');
  expect(hash(readFileSync(`${ROOT}packages/client/public/models/creatures.glb`))).toBe('4065f277d602a1ef0e5e79ecb597258c313b710a32cc89256c0b17d9d8f09b2b');
  writeFileSync(new URL('./reports/consumer-contract.json',import.meta.url),JSON.stringify({ totalVariants,totalLods,malformedControls:controls,maskBoundary:'FLOAT_COLOR source; pinned stock Blender writes normalized UINT16 COLOR_0, error <= 0.5/65535 plus float tolerance per channel; not exact float export',textureBoundary:'metadata proxy in GLTFLoader; actual CPU transcode and PBR checks in stock validation',files:reports },null,2)+'\n');
});
