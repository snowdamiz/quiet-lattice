// Geometry compression for exported models (P1.E14.T12): EXT_meshopt_compression over KHR_mesh_quantization, applied to
// a .glb after its textures are KTX2 (packages/tools/blender/artlib/ktx.py), through glTF-Transform's meshopt() and
// meshoptimizer's encoder, both pinned in packages/tools/package.json. The export runs it from inside Blender:
//   node <tsx> packages/tools/src/art/meshopt.ts <in.glb> <out.glb> [medium|high]
// and reads the JSON summary it prints. Three's GLTFLoader decodes it with MeshoptDecoder, Blender's importer natively.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Document, Logger, Node, NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export type MeshoptLevel = 'medium' | 'high';

async function io(): Promise<NodeIO> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

/** Bytes of vertex and index data: every accessor that is not an image's (images are views of their own). */
export function geometryBytes(doc: Document): number {
  return doc
    .getRoot()
    .listAccessors()
    .reduce((n, a) => n + a.getByteLength(), 0);
}

/**
 * Where quantize() moves a mesh off a node that has children (so the dequantizing transform does not move them), the
 * mesh lands on a new, unnamed child: it takes its old node's name, so the engine's name lookups (CanopyFrame*, Door*,
 * COL_*) still find the mesh. Returns how many were named.
 */
export function nameSplitMeshes(doc: Document): number {
  let n = 0;
  for (const node of doc.getRoot().listNodes()) {
    if (node.getName() || !node.getMesh()) continue;
    const parent = node.getParentNode();
    if (parent && !parent.getMesh() && parent.getName()) {
      node.setName(parent.getName());
      n++;
    }
  }
  return n;
}

/** World matrices of every named node that holds no mesh (markers, pivots, LOD and variant nodes), by name and order. */
export function emptyTransforms(doc: Document): Map<string, number[][]> {
  const out = new Map<string, number[][]>();
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh() || !node.getName()) continue;
    const list = out.get(node.getName()) ?? [];
    list.push([...(node as Node).getWorldMatrix()]);
    out.set(node.getName(), list);
  }
  return out;
}

export interface MeshoptSummary {
  geometryBefore: number;
  geometryAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  splitMeshes: number;
  maxEmptyShift: number;
}

/** `input` (a .glb) with its meshes reordered, quantized and meshopt-compressed; every marker and pivot stays put. */
export async function compressGeometry(input: Uint8Array, level: MeshoptLevel = 'high'): Promise<{ glb: Uint8Array; summary: MeshoptSummary }> {
  const glbIO = await io();
  const doc = (await glbIO.readBinary(input)).setLogger(new Logger(Logger.Verbosity.WARN));
  const before = emptyTransforms(doc);
  const geometryBefore = geometryBytes(doc);
  // (quantize()'s own cleanup would also merge equal materials and skins: two variants' "Hull" copies would become one
  // material, and a livery recolour of one variant would recolour the other. Only accessors are pruned and merged.)
  await doc.transform(
    meshopt({ encoder: MeshoptEncoder, level, cleanup: false }),
    prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes: true, keepIndices: true }),
    dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
  );
  const splitMeshes = nameSplitMeshes(doc);
  // (quantize() moves the dequantizing transform onto mesh nodes only; the empties the engine reads must not move)
  // (a mesh node quantize() split leaves an empty of the same name behind: only the empties there before are compared)
  let maxEmptyShift = 0;
  const after = emptyTransforms(doc);
  for (const [name, was] of before) {
    const list = after.get(name) ?? [];
    if (list.length !== was.length) throw new Error(`meshopt: there were ${was.length} empty node(s) ${name}, now ${list.length}`);
    list.forEach((m, i) => m.forEach((x, k) => (maxEmptyShift = Math.max(maxEmptyShift, Math.abs(x - was[i]![k]!)))));
  }
  if (maxEmptyShift > 1e-4) throw new Error(`meshopt: a marker or pivot moved by ${maxEmptyShift}`);
  const glb = await glbIO.writeBinary(doc);
  return {
    glb,
    summary: { geometryBefore, geometryAfter: streamBytes(glb), bytesBefore: input.byteLength, bytesAfter: glb.byteLength, splitMeshes, maxEmptyShift },
  };
}

/** Bytes of meshopt-compressed streams in a written .glb (its JSON's EXT_meshopt_compression buffer views). */
export function streamBytes(glb: Uint8Array): number {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const len = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as {
    bufferViews?: { extensions?: { EXT_meshopt_compression?: { byteLength: number } } }[];
  };
  return (json.bufferViews ?? []).reduce((n, bv) => n + (bv.extensions?.EXT_meshopt_compression?.byteLength ?? 0), 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [src, dst, level = 'high'] = process.argv.slice(2);
  if (!src || !dst || (level !== 'medium' && level !== 'high')) {
    console.error('usage: meshopt.ts <in.glb> <out.glb> [medium|high]');
    process.exit(2);
  }
  const { glb, summary } = await compressGeometry(new Uint8Array(readFileSync(src)), level);
  writeFileSync(dst, glb);
  console.log(JSON.stringify(summary));
}
