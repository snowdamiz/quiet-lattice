// Decode the actual meshopt accessor payloads for per-module evidence bindings.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MeshoptDecoder } from '../../../../packages/tools/node_modules/meshoptimizer/meshopt_decoder.mjs';

await MeshoptDecoder.ready;
const raw = fs.readFileSync(process.argv[2]);
const length = raw.readUInt32LE(12);
const doc = JSON.parse(raw.subarray(20, 20 + length).toString());
const binary = raw.subarray(28 + length);
const views = new Map();
const components = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const output = doc.accessors.map((accessor) => {
  const view = doc.bufferViews[accessor.bufferView];
  if (!views.has(accessor.bufferView)) {
    const compression = view.extensions?.EXT_meshopt_compression;
    if (compression) {
      const target = new Uint8Array(compression.count * compression.byteStride);
      const compressed = binary.subarray(compression.byteOffset || 0, (compression.byteOffset || 0) + compression.byteLength);
      MeshoptDecoder.decodeGltfBuffer(target, compression.count, compression.byteStride, compressed, compression.mode, compression.filter || 'NONE');
      views.set(accessor.bufferView, target);
    } else {
      views.set(accessor.bufferView, binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
    }
  }
  const data = views.get(accessor.bufferView);
  const size = components[accessor.componentType] * widths[accessor.type];
  const stride = view.byteStride || size;
  const bytes = Buffer.alloc(accessor.count * size);
  for (let i = 0; i < accessor.count; i++) {
    const at = (accessor.byteOffset || 0) + i * stride;
    bytes.set(data.subarray(at, at + size), i * size);
  }
  return crypto.createHash('sha256').update(bytes).digest('hex');
});
process.stdout.write(JSON.stringify(output));
