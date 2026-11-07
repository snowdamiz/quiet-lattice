// Real meshopt GLBs through GLTFLoader and the existing Structures route, on CPU.
// Texture upload/transcoding and visual grades remain GPU review gates. Here the
// material texture slots are omitted for Node; the original GLB maps are checked
// by the Blender validator and their compression/atlas contracts below.
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DENS_DRAWN, Random, createPlanetParams } from '@astra/shared/world';
import { gltfLoader } from '../core/Engine.js';
import { Planet } from '../universe/Planet.js';
import { Structures, resolveBoxes } from './Structures.js';
import { DEN_MODELS, addLibrary, libraryRoot, loadLibrary } from './modelLibrary.js';

const IDS = ['den_burrow_0', 'den_burrow_1', 'den_nest_0', 'den_nest_1', 'den_roost_0', 'den_roost_1', 'den_apex_lair_0'];
const loaded = new Map();
const documents = new Map();
const hashes = new Map();
const manifest = JSON.parse(readFileSync(new URL('../../../tools/blender/dens/manifest.json', import.meta.url), 'utf8'));
const Y = new THREE.Vector3(0, 1, 0);

async function parseAsset(id) {
  const data = readFileSync(new URL(`../../public/models/sites/${id}.glb`, import.meta.url));
  hashes.set(id, createHash('sha256').update(data).digest('hex'));
  const jsonLength = data.readUInt32LE(12);
  const js = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
  documents.set(id, js);
  const cpu = structuredClone(js);
  for (const m of cpu.materials) {
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    delete m.pbrMetallicRoughness?.baseColorTexture; delete m.pbrMetallicRoughness?.metallicRoughnessTexture;
    // Optional material extension texture slots are also left to export validation.
    delete m.extensions;
  }
  const bytes = Buffer.from(JSON.stringify(cpu));
  const json = Buffer.alloc(Math.ceil(bytes.length / 4) * 4, 32); bytes.copy(json);
  const bin = data.subarray(20 + jsonLength);
  const glb = Buffer.alloc(20 + json.length + bin.length);
  glb.writeUInt32LE(0x46546c67); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20); bin.copy(glb, 20 + json.length);
  return (await gltfLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), '')).scene;
}

beforeAll(async () => {
  for (const id of IDS) loaded.set(id, await parseAsset(id));
});
afterEach(() => vi.restoreAllMocks());

function publish() {
  const group = new THREE.Group();
  for (const [id, scene] of loaded) group.add(scene.getObjectByName(id).clone(true));
  addLibrary('dens', group);
}

function planet(dens) {
  return { name: 'Dens', radius: 22000, sampler: {}, sites: [], dens, root: new THREE.Group() };
}
function den(kind, seed = 3, role = 'predator') {
  return { kind, role, seed, base: 14, dir: [0, 1, 0], yaw: 0.73, species: 2 };
}

describe('seven authored den exports', () => {
  it('gates drawn dens on the complete available asset set, with four LODs and compressed PBR atlases', () => {
    expect(DENS_DRAWN).toBe(true);
    expect(Object.values(DEN_MODELS).flat()).toEqual(IDS);
    expect(manifest.assets.map((a) => a.name)).toEqual(IDS);
    for (const [id, js] of documents) {
      expect(hashes.get(id)).toBe(manifest.assets.find((a) => a.name === id).export.sha256);
      expect(js.extensionsRequired).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu']));
      expect(js.images.every((i) => i.mimeType === 'image/ktx2')).toBe(true);
      const material = js.materials.find((m) => m.name.startsWith('Den_'));
      expect(material.pbrMetallicRoughness.baseColorTexture).toBeDefined();
      expect(material.pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined();
      expect(material.normalTexture).toBeDefined(); expect(material.occlusionTexture).toBeDefined();
      const root = loaded.get(id).getObjectByName(id);
      const triangles = [0, 1, 2, 3].map((i) => {
        let count = 0;
        root.getObjectByName(`${id}_LOD${i}`).traverse((o) => { if (o.isMesh) count += o.geometry.index.count / 3; });
        return count;
      });
      expect(triangles[0]).toBeGreaterThanOrEqual(8000); expect(triangles[0]).toBeLessThanOrEqual(60000);
      expect(triangles[3] / triangles[0]).toBeLessThan(0.05);
      expect(triangles.every((n, i) => n > 0 && (!i || n < triangles[i - 1]))).toBe(true);
    }
  });

  it('loads all seven through the existing startup slot and refuses a missing sibling without publishing partial dens', async () => {
    const paths = [];
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
      paths.push(url);
      const id = url.split('/').at(-1).replace('.glb', '');
      return { scene: loaded.has(id) ? loaded.get(id).clone(true) : new THREE.Group() };
    });
    await loadLibrary('structures', '/models/structures.glb');
    for (const id of IDS) {
      expect(paths).toContain(`/models/sites/${id}.glb`);
      expect(libraryRoot('dens', id)).toBeTruthy();
    }
    addLibrary('dens', null);
    GLTFLoader.prototype.loadAsync.mockImplementation(async (url) => {
      if (url.endsWith('den_roost_1.glb')) throw new Error('missing roost');
      const id = url.split('/').at(-1).replace('.glb', '');
      return { scene: loaded.get(id).clone(true) };
    });
    await expect(loadLibrary('structures', '/models/structures.glb')).rejects.toThrow('missing roost');
    expect(IDS.every((id) => libraryRoot('dens', id) === null)).toBe(true);
  });

  it('draws both variants of every kind and the lair with native distance LOD, fitted colliders and unchanged atlases', () => {
    publish();
    for (const [kind, ids] of Object.entries(DEN_MODELS)) {
      for (const id of ids) {
        let seed = 0;
        while (new Random(seed).pick(ids) !== id) seed++;
        const d = den(kind === 'apex' ? 'nest' : kind, seed, kind === 'apex' ? 'apex' : 'predator');
        const p = planet([d]); const structures = new Structures({}); structures.setPlanet(p);
        const s = structures.sites[0]; structures.build(s);
        expect(s.built.group.name).toBe(id); expect(s.built.group.parent).toBe(p.root);
        expect(s.pos.toArray()).toEqual([0, 22014, 0]);
        expect(new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat).distanceTo(new THREE.Vector3(...d.dir))).toBeLessThan(1e-9);
        expect(s.built.spawn.length()).toBeLessThan(0.002);
        expect(s.built.colliders.length).toBeGreaterThan(0);
        expect(s.built.group.getObjectByName('COL_LeftBank')).toBeUndefined();
        const lod = s.built.group.getObjectByProperty('isLOD', true);
        expect(lod.levels.map((l) => l.distance)).toEqual([0, 80, 220, 650]);
        const camera = new THREE.PerspectiveCamera();
        p.root.updateMatrixWorld(true);
        for (const [i, distance] of [10, 100, 300, 900].entries()) {
          camera.position.copy(s.pos).addScaledVector(Y, distance); camera.updateMatrixWorld(true); lod.update(camera);
          expect(lod.levels.map((l) => l.object.visible)).toEqual([0, 1, 2, 3].map((k) => k === i));
        }
        const mesh = lod.levels[0].object.getObjectByProperty('isMesh', true);
        expect(mesh.material).toBe(libraryRoot('dens', id).getObjectByName(mesh.name).material);
        // The standing capsule can walk from outside to the anchor, including at
        // the real AABB representation used by the client, after compression.
        for (let z = 10; z >= 0; z -= .2) {
          const position = new THREE.Vector3(0, 0, z); const before = position.clone();
          resolveBoxes(position, new THREE.Vector3(), s.built.colliders);
          expect(position.distanceTo(before)).toBeLessThan(.01);
        }
        const box = s.built.colliders[0];
        const inside = box.min.clone().add(box.max).multiplyScalar(.5);
        const beforeCollision = inside.clone();
        resolveBoxes(inside, new THREE.Vector3(), s.built.colliders);
        expect(inside.distanceTo(beforeCollision)).toBeGreaterThan(.01);
        const dispose = vi.spyOn(mesh.geometry, 'dispose');
        structures.setPlanet(null); expect(p.root.children).toHaveLength(0); expect(dispose).not.toHaveBeenCalled();
        structures.setPlanet(p); structures.build(structures.sites[0]);
        expect(structures.sites[0].built.group.name).toBe(id);
      }
    }
  });

  it('rejects a loaded model with missing markers and never builds a procedural den when the library is unavailable', async () => {
    addLibrary('dens', null);
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
      const id = url.split('/').at(-1).replace('.glb', '');
      const scene = loaded.get(id).clone(true);
      if (id === 'den_nest_1') scene.getObjectByName('Spawn').removeFromParent();
      return { scene };
    });
    await expect(loadLibrary('structures', '/models/structures.glb')).rejects.toThrow('den_nest_1');
    const p = planet([den('nest')]); const structures = new Structures({}); structures.setPlanet(p);
    expect(() => structures.build(structures.sites[0])).toThrow('Missing required dens model');
    expect(p.root.children).toHaveLength(0); expect(structures.sites[0].built).toBeNull();
  });

  it('uses the planned tilted frame, preserves site IDs, reveals den IDs across unloads, and offers no client reward interaction', () => {
    publish();
    const d = den('burrow'); d.dir = [0.6, 0.8, 0];
    const p = planet([d]);
    p.sites = [{ type: 'beacon', dir: Y, quat: new THREE.Quaternion(), base: 0, seed: 0 }];
    const structures = new Structures({}); structures.setPlanet(p);
    expect(structures.sites.map((s) => s.id)).toEqual(['Dens#0', 'Dens#den0']);
    const s = structures.sites[1]; structures.build(s);
    expect(Y.clone().applyQuaternion(s.quat).distanceTo(new THREE.Vector3(...d.dir))).toBeLessThan(1e-9);
    expect(structures.nearestInteract(s.pos)).toBeNull();
    structures.interact(s); expect(structures.visited.size).toBe(0);
    expect(structures.revealAll(p)).toBe(2);
    structures.setPlanet(null); structures.setPlanet(p);
    expect(structures.sites.every((s) => s.known)).toBe(true);
    expect(structures.markers(s.pos).some((m) => m.label === 'Burrow')).toBe(true);
  });

  it('streams dens through the actual update route, rebuilds on approach and remembers discovery across planet unloads', () => {
    publish();
    const p = planet([den('roost')]);
    p.position = new THREE.Vector3();
    p.worldToLocal = (v, out) => out.copy(v);
    p.dirToLocal = (v, out) => out.copy(v);
    const game = { camWorld: new THREE.Vector3(0, 22020, 0), system: { star: { position: new THREE.Vector3(1e8, 0, 0) } }, mode: 'foot' };
    const structures = new Structures(game);
    structures.update(1 / 60, p);
    expect(structures.sites[0].built.group.parent).toBe(p.root);
    const name = structures.sites[0].built.group.name;
    game.camWorld.y = 25020; structures.update(1 / 60, p);
    expect(structures.sites[0].built).toBeNull(); expect(p.root.children).toHaveLength(0);
    game.camWorld.y = 24000; structures.update(1 / 60, p);
    expect(structures.sites[0].built.group.name).toBe(name);
    game.camWorld.y = 32000; structures.update(1 / 60, p);
    expect(structures.planet).toBeNull(); expect(p.root.children).toHaveLength(0);
    game.camWorld.y = 22020; structures.update(1 / 60, p);
    expect(structures.sites[0].known).toBe(true);
    expect(structures.sites[0].built.group.name).toBe(name);
  });

  it('Planet copies the actual planned dens and pads at the system tier', () => {
    const params = createPlanetParams(31, 'lush', 22000);
    const pool = { registerPlanet: vi.fn() };
    const p = new Planet({ name: 'Drawn', params, tier: 3, radius: params.radius }, pool);
    expect(p.dens.length).toBeGreaterThan(0); expect(p.dens).toBe(p.ground.dens);
    expect(p.params.pads).toBe(p.ground.pads);
    expect(pool.registerPlanet).toHaveBeenCalledWith(p.id, params);
  });
});
