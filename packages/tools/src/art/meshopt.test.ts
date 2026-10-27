import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { checkEmpties, compressGeometry, emptyTransforms, streamBytes } from './meshopt.ts';

const N = 64;

/** A mesh far from the origin (so a dequantizing transform on the wrong node moves things visibly), with a custom
 * `_pivot` attribute as creatures carry, each a copy of an equal "Hull" material as two variants' baked copies are. */
function mesh(doc: Document, name: string) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const pos = new Float32Array(N * 3);
  const nrm = new Float32Array(N * 3);
  const uv = new Float32Array(N * 2);
  const pivot = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos.set([10 + Math.cos(i) * 4, 2 + Math.sin(i * 0.7) * 3, -5 + (i % 8)], i * 3);
    nrm.set([0, 1, 0], i * 3);
    uv.set([(i % 8) / 8, Math.floor(i / 8) / 8], i * 2);
    pivot.set([3.3, 1.2, -0.1], i * 3);
  }
  const idx = new Uint16Array(Array.from({ length: (N - 2) * 3 }, (_, k) => [0, 1 + Math.floor(k / 3), 2 + Math.floor(k / 3)][k % 3]!));
  const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', a: Float32Array | Uint16Array) => doc.createAccessor().setType(type).setArray(a).setBuffer(buffer);
  return doc.createMesh(name).addPrimitive(
    doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', pos))
      .setAttribute('NORMAL', acc('VEC3', nrm))
      .setAttribute('TEXCOORD_0', acc('VEC2', uv))
      .setAttribute('_pivot', acc('VEC3', pivot))
      .setIndices(acc('SCALAR', idx))
      .setMaterial(doc.createMaterial('Hull').setRoughnessFactor(0.5)),
  );
}

/** A hull in the export layout: lark / lark_LOD0 holding a wing mesh that parents a hardpoint, a gear pivot beside it,
 * and a collider. With `twin`, an empty also named lark_wing sits beside the wing (the false alarm of name matching). */
async function hull(twin = false): Promise<Uint8Array> {
  const doc = new Document();
  const wing = doc
    .createNode('lark_wing')
    .setMesh(mesh(doc, 'wing'))
    .addChild(doc.createNode('HP_S_wing').setTranslation([3, 0.5, -1]));
  const lod = doc
    .createNode('lark_LOD0')
    .addChild(wing)
    .addChild(doc.createNode('GearFront').setTranslation([0, -1.2, -4]));
  if (twin) lod.addChild(doc.createNode('lark_wing').setTranslation([1, 2, 3]));
  const root = doc
    .createNode('lark')
    .setTranslation([0, 0, 2])
    .addChild(lod)
    .addChild(doc.createNode('COL_body').setMesh(mesh(doc, 'col')));
  doc.createScene().addChild(root);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
}

async function read(glb: Uint8Array): Promise<Document> {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(glb);
}

const json = (glb: Uint8Array) => JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true))));

/** World positions of a named mesh's vertices, sorted. */
function world(d: Document, name: string, attribute = 'POSITION'): number[] {
  const node = d
    .getRoot()
    .listNodes()
    .find((x) => x.getName() === name && x.getMesh())!;
  const m = node.getWorldMatrix();
  const p = node.getMesh()!.listPrimitives()[0]!.getAttribute(attribute)!;
  const out: number[] = [];
  for (let i = 0; i < p.getCount(); i++) {
    const [x, y, z] = p.getElement(i, [0, 0, 0]) as number[];
    out.push(m[0]! * x! + m[4]! * y! + m[8]! * z! + m[12]!, m[1]! * x! + m[5]! * y! + m[9]! * z! + m[13]!, m[2]! * x! + m[6]! * y! + m[10]! * z! + m[14]!);
  }
  return out.sort((a, b) => a - b);
}

const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

describe('meshopt geometry compression', () => {
  it('compresses the meshes, marks both extensions required and leaves every marker, pivot and LOD node in place', async () => {
    const input = await hull();
    const { glb, summary } = await compressGeometry(input, { level: 'high' });
    const [before, after] = [await read(input), await read(glb)];
    expect(json(glb).extensionsRequired).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization']));
    expect(summary.geometryAfter).toBe(streamBytes(glb));
    expect(summary.geometryAfter).toBeGreaterThan(0);
    expect(summary.geometryAfter).toBeLessThan(summary.geometryBefore);
    expect(summary.maxEmptyShift).toBeLessThan(1e-4);
    // every empty is where it was in the world (lark_wing too now: its mesh moved to a child)
    const names = (d: Document) => [...emptyTransforms(d).keys()].map((n) => n.getName()).sort();
    expect(names(after)).toEqual(['GearFront', 'HP_S_wing', 'lark', 'lark_LOD0', 'lark_wing']);
    for (const [node, m] of emptyTransforms(before)) {
      const twin = [...emptyTransforms(after)].find(([n]) => n.getName() === node.getName())!;
      expect(maxDiff(m, twin[1])).toBeLessThan(1e-6);
    }
    // the wing's mesh moved to a child (its node parents the hardpoint) and kept the wing's name; the collider stayed
    const meshNodes = after
      .getRoot()
      .listNodes()
      .filter((x) => x.getMesh())
      .map((x) => `${x.getParentNode()?.getName()}/${x.getName()}`)
      .sort();
    expect(meshNodes).toEqual(['lark/COL_body', 'lark_wing/lark_wing']);
    expect(summary.splitMeshes).toBe(1);
    // equal materials stay separate (a recolour of one must not reach the other), and no stale accessor is written
    const materials = after
      .getRoot()
      .listMaterials()
      .map((m) => m.getName());
    expect(materials).toEqual(['Hull', 'Hull']);
    const stale = after
      .getRoot()
      .listAccessors()
      .filter((a) => !a.listParents().some((p) => p.propertyType !== 'Root'));
    expect(stale).toEqual([]);
    // and the decoded vertices are the old ones in the world, to quantization's precision
    expect(maxDiff(world(before, 'lark_wing'), world(after, 'lark_wing'))).toBeLessThan(0.01);
  });

  it('tells empties apart by node, not by name: an empty named like a split mesh is no false alarm', async () => {
    const { summary, glb } = await compressGeometry(await hull(true), { level: 'high' });
    expect(summary.splitMeshes).toBe(1);
    const twins = (await read(glb))
      .getRoot()
      .listNodes()
      .filter((n) => n.getName() === 'lark_wing');
    expect(twins).toHaveLength(3); // the wing node, its mesh child, and the empty beside it
  });

  it('refuses an empty that moved, went or took a mesh', async () => {
    const doc = await read(await hull());
    const gear = () =>
      doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === 'GearFront')!;
    const before = emptyTransforms(doc);
    expect(checkEmpties(before, doc)).toBe(0);
    gear().setTranslation([0, -1.2, -3.9]);
    expect(() => checkEmpties(before, doc)).toThrow(/moved by/);
    gear().setTranslation([0, -1.2, -4]);
    gear().setMesh(doc.getRoot().listMeshes()[0]!);
    expect(() => checkEmpties(before, doc)).toThrow(/now holds a mesh/);
    gear().setMesh(null);
    gear().dispose();
    expect(() => checkEmpties(before, doc)).toThrow(/GearFront is gone/);
  });

  it('can leave every attribute float (creatures and flora): positions, custom attributes and node matrices exact', async () => {
    const input = await hull();
    const { glb, summary } = await compressGeometry(input, { quantize: false });
    expect(summary.quantized).toBe(false);
    expect(json(glb).extensionsRequired).toEqual(['EXT_meshopt_compression']);
    expect(json(glb).extensionsUsed).not.toContain('KHR_mesh_quantization');
    expect(summary.geometryAfter).toBeLessThan(summary.geometryBefore);
    const [before, after] = [await read(input), await read(glb)];
    for (const name of ['lark_wing', 'COL_body']) {
      const node = (d: Document) =>
        d
          .getRoot()
          .listNodes()
          .find((x) => x.getName() === name)!;
      expect(node(after).getMatrix()).toEqual(node(before).getMatrix());
      const attr = node(after).getMesh()!.listPrimitives()[0]!.getAttribute('_pivot')!;
      expect(attr.getArray()).toBeInstanceOf(Float32Array);
      expect(maxDiff(world(before, name), world(after, name))).toBe(0);
      expect(maxDiff(world(before, name, '_pivot'), world(after, name, '_pivot'))).toBe(0);
    }
  });
});
