import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { compressGeometry, emptyTransforms, streamBytes } from './meshopt.ts';

/** A hull in the export layout: lark / lark_LOD0 holding a wing mesh that parents a hardpoint, a gear pivot beside it,
 * and a collider; positions far from the origin, so a dequantizing transform on the wrong node would move things. */
async function hull(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const n = 64;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    pos.set([10 + Math.cos(i) * 4, 2 + Math.sin(i * 0.7) * 3, -5 + (i % 8)], i * 3);
    nrm.set([0, 1, 0], i * 3);
    uv.set([(i % 8) / 8, Math.floor(i / 8) / 8], i * 2);
  }
  const idx = new Uint16Array(Array.from({ length: (n - 2) * 3 }, (_, k) => [0, 1 + Math.floor(k / 3), 2 + Math.floor(k / 3)][k % 3]!));
  const prim = (name: string) =>
    doc
      .createMesh(name)
      .addPrimitive(
        doc
          .createPrimitive()
          .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos.slice()).setBuffer(buffer))
          .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm.slice()).setBuffer(buffer))
          .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv.slice()).setBuffer(buffer))
          .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx.slice()).setBuffer(buffer)),
      );
  const wing = doc.createNode('lark_wing').setMesh(prim('wing')).addChild(doc.createNode('HP_S_wing').setTranslation([3, 0.5, -1]));
  const lod = doc.createNode('lark_LOD0').addChild(wing).addChild(doc.createNode('GearFront').setTranslation([0, -1.2, -4]));
  const root = doc.createNode('lark').addChild(lod).addChild(doc.createNode('COL_body').setMesh(prim('col')));
  doc.createScene().addChild(root);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
}

describe('meshopt geometry compression', () => {
  it('compresses the meshes, marks both extensions required and leaves every marker, pivot and LOD node in place', async () => {
    const input = await hull();
    const { glb, summary } = await compressGeometry(input, 'high');
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const [before, after] = [await io.readBinary(input), await io.readBinary(glb)];
    const raw = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true))));
    expect(raw.extensionsRequired).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization']));
    expect(summary.geometryAfter).toBe(streamBytes(glb));
    expect(summary.geometryAfter).toBeGreaterThan(0);
    expect(summary.geometryAfter).toBeLessThan(summary.geometryBefore);
    // the empties the engine reads stay where they were, in the world
    expect(summary.maxEmptyShift).toBeLessThan(1e-4);
    // (lark_wing too now: its mesh moved to a child)
    expect([...emptyTransforms(after).keys()].sort()).toEqual(['GearFront', 'HP_S_wing', 'lark', 'lark_LOD0', 'lark_wing']);
    // the wing's mesh moved to a child (its node parents the hardpoint) and kept the wing's name; the collider stayed
    const meshNodes = after
      .getRoot()
      .listNodes()
      .filter((x) => x.getMesh())
      .map((x) => `${x.getParentNode()?.getName()}/${x.getName()}`)
      .sort();
    expect(meshNodes).toEqual(['lark/COL_body', 'lark_wing/lark_wing']);
    expect(summary.splitMeshes).toBe(1);
    // and the decoded vertices are the old ones in the world, to quantization's precision
    const world = (d: Document, name: string) => {
      const node = d
        .getRoot()
        .listNodes()
        .find((x) => x.getName() === name && x.getMesh())!;
      const m = node.getWorldMatrix();
      const p = node.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!;
      const out: number[] = [];
      for (let i = 0; i < p.getCount(); i++) {
        const [x, y, z] = p.getElement(i, [0, 0, 0]) as number[];
        out.push(m[0]! * x! + m[4]! * y! + m[8]! * z! + m[12]!, m[1]! * x! + m[5]! * y! + m[9]! * z! + m[13]!, m[2]! * x! + m[6]! * y! + m[10]! * z! + m[14]!);
      }
      return out.sort((a, b) => a - b);
    };
    const [a, b] = [world(before, 'lark_wing'), world(after, 'lark_wing')];
    expect(a.length).toBe(b.length);
    expect(Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))).toBeLessThan(0.01);
  });
});
