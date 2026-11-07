// Read the shipped attribute streams directly, without Blender's mesh reconstruction.
import { writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: decode_meshopt.mjs source.glb output.json');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(source);
function values(accessor) {
  return Array.from({ length: accessor.getCount() }, (_, i) => accessor.getElement(i, []));
}
const rows = [];
for (const node of doc.getRoot().listNodes()) {
  if (!node.getMesh()) continue;
  let owner = node;
  while (owner && !/_LOD[0-3]$/.test(owner.getName())) owner = owner.getParentNode();
  if (!owner) continue;
  for (const primitive of node.getMesh().listPrimitives()) {
    rows.push({
      lod: owner.getName(),
      node: node.getName(),
      worldMatrix: node.getWorldMatrix(),
      positions: values(primitive.getAttribute('POSITION')),
      normals: values(primitive.getAttribute('NORMAL')),
      uv: values(primitive.getAttribute('TEXCOORD_0')),
      indices: Array.from(primitive.getIndices().getArray()),
    });
  }
}
writeFileSync(output, JSON.stringify(rows), { flag: 'wx' });
