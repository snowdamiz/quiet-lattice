// Swift's narrow bevels and UV islands need float positions and UVs. Normals
// remain quantized at 16 bits; both required compression extensions stay real.
import { readFileSync, writeFileSync } from 'node:fs';
import { Logger, PropertyType } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, prune, dedup } from '@gltf-transform/functions';
import { meshoptIO, compressDocument, emptyTransforms, checkEmpties, geometryBytes } from '../../../src/art/meshopt.ts';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error('usage: compress_precision.mjs source.glb target.glb');
const input = readFileSync(src);
const io = await meshoptIO();
const doc = (await io.readBinary(input)).setLogger(new Logger(Logger.Verbosity.WARN));
const before = emptyTransforms(doc);
const geometryBefore = geometryBytes(doc);
await doc.transform(
  quantize({ pattern: /^(NORMAL|TANGENT)$/, patternTargets: /^(NORMAL|TANGENT)$/, quantizeNormal: 16, cleanup: false }),
  prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.SKIN], keepAttributes: true, keepIndices: true }),
  dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
);
// The stock float-stream path reorders and losslessly compresses the existing
// attributes, including the actual quantized normal accessors above.
const result = await compressDocument(doc, { quantize: false });
// glTF-Transform 4.5.1's isQuantizedPrimitive inspects POSITION for every
// semantic, so it misses normal-only quantization. Declare the extension that
// the actual normalized-short NORMAL attributes require; assert those below.
doc.createExtension(KHRMeshQuantization).setRequired(true);
const bytes = await io.writeBinary(doc);
const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
for (const name of ['KHR_mesh_quantization', 'EXT_meshopt_compression']) {
  if (!json.extensionsRequired?.includes(name)) throw new Error(`missing required ${name}`);
}
const componentTypes = {};
for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
  for (const [semantic, accessor] of Object.entries(primitive.attributes)) {
    (componentTypes[semantic] ??= new Set()).add(json.accessors[accessor].componentType);
    if ((semantic === 'POSITION' || semantic.startsWith('TEXCOORD_')) && json.accessors[accessor].componentType !== 5126) throw new Error(`${semantic} precision lost`);
  }
}
if (!componentTypes.NORMAL?.has(5122)) throw new Error('16-bit normal quantization missing');
writeFileSync(dst, bytes);
console.log(JSON.stringify({ ...result, maxEmptyShift: checkEmpties(before, doc), geometryBefore, geometryAfter: json.bufferViews.reduce((sum, v) => sum + (v.extensions?.EXT_meshopt_compression?.byteLength ?? 0), 0), bytesBefore: input.length, bytesAfter: bytes.length, quantized: true, policy: 'float positions and UVs; 16-bit normalized normals/tangents; lossless meshopt streams', componentTypes: Object.fromEntries(Object.entries(componentTypes).map(([key, value]) => [key, [...value]])) }));
