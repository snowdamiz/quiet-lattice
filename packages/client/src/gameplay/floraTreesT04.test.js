// Current T04 exports through the production GLTFLoader, indexer, palette mixer and tree builders.
// Only material creation is bypassed: KTX2 texels are decoded by the companion Blender audit,
// and this CPU contract deliberately makes no claim about a GPU upload or runtime adoption.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { gltfLoader } from '../core/Engine.js';
import { addLibrary, libraryMesh, libraryVariants, recolor } from './modelLibrary.js';
import { TREE_BUILDERS, mulberry32 } from './floraModels.js';

const ROOT = new URL('../../../../', import.meta.url);
const COUNTS = { round: 3, conifer: 3, palm: 2, mushroom: 3, spiral: 2, coral: 2, blob: 2, cactus: 2 };
const prefix = kind => kind === 'cactus' ? kind : `tree_${kind}`;
const palette = { primary: new THREE.Color(.2, .4, .15), secondary: new THREE.Color(.3, .17, .09), accent: new THREE.Color(.6, .3, .1) };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const scenes = new Map();
const audits = new Map();

async function load(kind) {
  const bytes = readFileSync(new URL(`packages/client/public/models/flora/tree_${kind}_t04.glb`, ROOT));
  const loader = gltfLoader();
  loader.register(() => ({ name: 'T04_CPU_MATERIALS', loadMaterial: () => Promise.resolve(new THREE.MeshStandardMaterial()) }));
  return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
}

function positionMaskHash(mesh) {
  const { position, color } = mesh.geometry.attributes;
  const rows = new Set();
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    const values = [...p.toArray(), ...[0, 1, 2, 3].map(k => color.getComponent(i, k))];
    const row = Buffer.alloc(28);
    values.forEach((v, k) => row.writeFloatLE(v === 0 ? 0 : v, k * 4));
    rows.add(row.toString('hex'));
  }
  return { hash: sha([...rows].sort().join('\n') + '\n'), count: rows.size };
}

function contract(mesh) {
  if (!mesh?.isMesh) throw new Error('Missing consumer mesh');
  const { position, normal, uv, color } = mesh.geometry.attributes;
  for (const attr of [position, normal, uv, color]) {
    if (!attr || attr.count !== position.count) throw new Error('Missing vertex attribute');
    if (!(attr.array instanceof Float32Array) || attr.normalized) throw new Error('Quantized vertex attribute');
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) {
      if (!Number.isFinite(attr.getComponent(i, k))) throw new Error('Nonfinite vertex attribute');
    }
  }
  if (color.itemSize !== 4) throw new Error('Missing mask alpha');
  for (let i = 0; i < color.count; i++) {
    const w = [0,1,2,3].map(k => color.getComponent(i,k));
    if (w.some(v => v < 0 || v > 1) || Math.abs(w[0]+w[1]+w[2]-1) > .00001) throw new Error('Invalid region mask');
  }
  return mesh;
}

beforeAll(async () => {
  const dir = new URL('assets/blend/flora/trees/evidence/', ROOT);
  for (const name of readdirSync(dir).sort()) {
    if (!name.includes('_audit_')) continue;
    try {
      const audit = JSON.parse(readFileSync(new URL(`${name}/audit.json`, dir), 'utf8'));
      const kind = audit.export.match(/tree_(\w+)_t04/)[1];
      audits.set(kind, audit);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  for (const kind of Object.keys(COUNTS)) scenes.set(kind, await load(kind));
});

describe('T04 current compressed tree inventory', () => {
  for (const [kind, count] of Object.entries(COUNTS)) {
    it(`${kind}: exact names, 4 LODs, source positions and FLOAT mask bits survive compression`, () => {
      const scene = scenes.get(kind);
      const audit = audits.get(kind);
      expect(audit).toBeDefined();
      expect(sha(readFileSync(new URL(audit.source, ROOT)))).toBe(audit.source_sha256);
      expect(sha(readFileSync(new URL(audit.export, ROOT)))).toBe(audit.export_sha256);
      addLibrary('flora', scene);
      expect(libraryVariants('flora', prefix(kind))).toEqual(Array.from({ length: count }, (_, i) => `${prefix(kind)}_${i}`));
      for (let v = 0; v < count; v++) {
        const triangles = [];
        for (let lod = 0; lod < 4; lod++) {
          const name = `${prefix(kind)}_${v}${lod ? `_lod${lod}` : ''}`;
          const mesh = contract(libraryMesh('flora', name));
          const source = audit.source_meshes[name];
          const actual = positionMaskHash(mesh);
          expect(actual.count, name).toBe(source.unique_position_mask_count);
          expect(actual.hash, name).toBe(source.position_mask_sha256);
          triangles.push(mesh.geometry.index.count / 3);
          expect(triangles[lod]).toBe(source.triangles);
          const geo = recolor(mesh, palette);
          expect(geo.boundingBox.max.y).toBeGreaterThan(1);
          // Buttresses deliberately enter the soil; preserve their authored Y-up extent.
          expect(geo.boundingBox.min.y).toBeCloseTo(source.bounds_yup[0][1], 6);
          expect(geo.boundingBox.min.y).toBeLessThan(.05);
          geo.dispose();
        }
        expect(triangles[0]).toBeGreaterThanOrEqual(kind === 'cactus' ? 150 : 3000);
        expect(triangles[0]).toBeLessThanOrEqual(kind === 'cactus' ? 6000 : 15000);
        expect(triangles[1]).toBeLessThan(triangles[0]);
        expect(triangles[2]).toBeLessThan(triangles[1]);
        expect(triangles[3]).toBeLessThan(triangles[0] * .05);
      }
    });

    it(`${kind}: the real builder selects every authored sibling and its far mesh`, () => {
      addLibrary('flora', scenes.get(kind));
      for (let pick = 0; pick < count; pick++) for (const q of [1, 0]) {
        const result = TREE_BUILDERS[kind](mulberry32(424242), { leaf: 0x447733, trunk: 0x6d4a2e, accent: 0xc9a34a, pick }, q);
        const expected = libraryMesh('flora', `${prefix(kind)}_${pick}${q ? '' : '_lod1'}`).geometry;
        expect(result.geo.attributes.position.count).toBe(expected.attributes.position.count);
        expect(result.geo.index.count).toBe(expected.index.count);
        expect(result.height).toBeGreaterThan(2);
        expect(result.radius).toBeGreaterThan(0);
        // Giants use 2.2–4.6× scatter scale; origin remains grounded after that transform.
        const scatter = ['mushroom', 'spiral', 'coral', 'blob'].includes(kind) ? 4.6 : 1.7;
        result.geo.scale(scatter, scatter, scatter);
        result.geo.computeBoundingBox();
        expect(result.geo.boundingBox.min.y).toBeGreaterThan(-1);
        result.geo.dispose();
      }
    });
  }

  it('recolors actual FLOAT weights and transforms geometry through the real consumer matrix', () => {
    const mesh = scenes.get('coral').getObjectByName('tree_coral_1').clone();
    mesh.matrixWorld.makeRotationY(.61).setPosition(3, 4, -2);
    const output = recolor(mesh, palette, { glowAccent: .5 });
    const source = mesh.geometry.attributes;
    for (let i = 0; i < source.position.count; i += 17) {
      const expected = new THREE.Vector3().fromBufferAttribute(source.position, i).applyMatrix4(mesh.matrixWorld);
      expect(new THREE.Vector3().fromBufferAttribute(output.attributes.position, i).distanceTo(expected)).toBeLessThan(.000002);
      const w = [0,1,2,3].map(k => source.color.getComponent(i,k));
      const sum = w[0]+w[1]+w[2];
      const ao = .35+.65*w[3];
      const rgb = ['r','g','b'].map(c => (palette.primary[c]*w[0]+palette.secondary[c]*w[1]+palette.accent[c]*w[2])/sum*ao);
      rgb.forEach((x,k) => expect(output.attributes.color.getComponent(i,k)).toBeCloseTo(x,6));
      expect(output.attributes.aGlow.getX(i)).toBeCloseTo(w[2]/sum*.5,6);
    }
    output.dispose();
  });

  for (const mutation of ['missing','integer','sum','nan','alpha']) {
    it(`rejects a ${mutation} mask on a clone of the real current export`, () => {
      const mesh = scenes.get('round').getObjectByName('tree_round_0').clone();
      mesh.geometry = mesh.geometry.clone();
      const color = mesh.geometry.attributes.color;
      if (mutation === 'missing') mesh.geometry.deleteAttribute('color');
      if (mutation === 'integer') mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Uint16Array(color.count*4),4,true));
      if (mutation === 'sum') color.setXYZ(0,1,1,1);
      if (mutation === 'nan') color.setW(0,NaN);
      if (mutation === 'alpha') mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(color.count*3),3));
      expect(() => contract(mesh)).toThrow();
      mesh.geometry.dispose();
    });
  }

  it('detects renamed real assets instead of accepting procedural fallback as authored content', () => {
    const scene = scenes.get('palm').clone();
    scene.getObjectByName('tree_palm_0').name = 'broken_palm_name';
    addLibrary('flora', scene);
    expect(libraryVariants('flora', 'tree_palm')).toEqual(['tree_palm_1']);
    expect(() => contract(libraryMesh('flora', 'tree_palm_0'))).toThrow('Missing consumer mesh');
  });
});
