// Geometry compression for exported models (P1.E14.T12): EXT_meshopt_compression, over KHR_mesh_quantization where the
// family allows it, applied to a .glb after its textures are KTX2 (packages/tools/blender/artlib/ktx.py), through
// glTF-Transform and meshoptimizer's encoder, both pinned in packages/tools/package.json. The export runs it from inside
// Blender (artlib/meshopt.py):
//   node <tsx> packages/tools/src/art/meshopt.ts <in.glb> <out.glb> [<options as JSON>]
// and reads the JSON summary it prints. Three's GLTFLoader decodes it with MeshoptDecoder, Blender's importer natively.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Document, Logger, Node, NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export interface MeshoptOptions {
  /** high: quantized attributes go through meshopt's filters (octahedral normals at 8 bits); medium: no filters. */
  level: 'medium' | 'high';
  /** false keeps every attribute float (meshopt still compresses the streams): the creature and flora families, whose
   * client code moves custom attributes (`_pivot`) and colour masks by the node's matrix, need them exact. */
  quantize: boolean;
  /** Bits for positions, per mesh's bounds: 14 is 1/16384 of the mesh's longest side (2.4 cm on a 400 m landmark). */
  positionBits: number;
  /** Bits for texture coordinates: 2 more than the texture's own resolution keeps them within an eighth of a texel. */
  texcoordBits: number;
}

export const MESHOPT_DEFAULTS: MeshoptOptions = { level: 'high', quantize: true, positionBits: 14, texcoordBits: 12 };

/** A glTF-Transform IO that reads and writes every extension, meshopt included. */
export async function meshoptIO(): Promise<NodeIO> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

/** Bytes of vertex, index and animation data: every accessor (images are not accessors). */
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

/** The world matrix of every node that holds no mesh (markers, pivots, LOD and variant nodes), by node. */
export function emptyTransforms(doc: Document): Map<Node, number[]> {
  const out = new Map<Node, number[]>();
  for (const node of doc.getRoot().listNodes()) if (!node.getMesh()) out.set(node, [...node.getWorldMatrix()]);
  return out;
}

/**
 * Checks the empties of `before` (emptyTransforms before compression) against the document now: each must still be in
 * it, still hold no mesh, and sit where it sat in the world (quantize() moves the dequantizing transform onto mesh
 * nodes only, and the engine reads hardpoints, gear pivots and LOD nodes by their place). Returns the largest move.
 */
export function checkEmpties(before: Map<Node, number[]>, doc: Document, tolerance = 1e-4): number {
  const live = new Set(doc.getRoot().listNodes());
  let max = 0;
  for (const [node, was] of before) {
    const name = node.getName() || '(unnamed)';
    if (node.isDisposed() || !live.has(node)) throw new Error(`meshopt: the empty node ${name} is gone`);
    if (node.getMesh()) throw new Error(`meshopt: the empty node ${name} now holds a mesh`);
    const now = node.getWorldMatrix();
    for (let k = 0; k < 16; k++) max = Math.max(max, Math.abs(now[k]! - was[k]!));
  }
  if (max > tolerance) throw new Error(`meshopt: a marker or pivot moved by ${max}`);
  return max;
}

export interface MeshoptSummary {
  geometryBefore: number;
  geometryAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  splitMeshes: number;
  maxEmptyShift: number;
  quantized: boolean;
}

/** `doc` compressed in place (see compressGeometry); returns the split count and the largest empty move. */
export async function compressDocument(doc: Document, options: Partial<MeshoptOptions> = {}): Promise<{ splitMeshes: number; maxEmptyShift: number }> {
  const o = { ...MESHOPT_DEFAULTS, ...options };
  const before = emptyTransforms(doc);
  if (o.quantize) {
    // (quantize()'s own cleanup would also merge equal materials and skins: two variants' "Hull" copies would become one
    // material, and a livery recolour of one variant would recolour the other. Only accessors are merged; accessors and
    // the skins quantize() replaced are pruned.)
    await doc.transform(
      meshopt({ encoder: MeshoptEncoder, level: o.level, cleanup: false, quantizePosition: o.positionBits, quantizeTexcoord: o.texcoordBits }),
      prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.SKIN], keepAttributes: true, keepIndices: true }),
      dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
    );
  } else {
    // (vertex order for the cache and the codec, then the streams compressed as they are: no filters on float data)
    await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), dedup({ propertyTypes: [PropertyType.ACCESSOR] }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  }
  const splitMeshes = nameSplitMeshes(doc);
  return { splitMeshes, maxEmptyShift: checkEmpties(before, doc) };
}

/** `input` (a .glb) with its meshes reordered, quantized (unless `quantize` is false) and meshopt-compressed; every
 * marker, pivot and LOD node stays where it was, and each material stays its own. */
export async function compressGeometry(input: Uint8Array, options: Partial<MeshoptOptions> = {}): Promise<{ glb: Uint8Array; summary: MeshoptSummary }> {
  const glbIO = await meshoptIO();
  const doc = (await glbIO.readBinary(input)).setLogger(new Logger(Logger.Verbosity.WARN));
  const geometryBefore = geometryBytes(doc);
  const { splitMeshes, maxEmptyShift } = await compressDocument(doc, options);
  const glb = await glbIO.writeBinary(doc);
  return {
    glb,
    summary: {
      geometryBefore,
      geometryAfter: streamBytes(glb),
      bytesBefore: input.byteLength,
      bytesAfter: glb.byteLength,
      splitMeshes,
      maxEmptyShift,
      quantized: options.quantize ?? MESHOPT_DEFAULTS.quantize,
    },
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
  const [src, dst, json = '{}'] = process.argv.slice(2);
  if (!src || !dst) {
    console.error('usage: meshopt.ts <in.glb> <out.glb> [{"level":"high","quantize":true,"positionBits":14,"texcoordBits":12}]');
    process.exit(2);
  }
  const { glb, summary } = await compressGeometry(new Uint8Array(readFileSync(src)), JSON.parse(json) as Partial<MeshoptOptions>);
  writeFileSync(dst, glb);
  console.log(JSON.stringify(summary));
}
