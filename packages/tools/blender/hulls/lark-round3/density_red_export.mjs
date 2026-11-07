import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire('/Users/andreyyurlov/Documents/dev/space/packages/tools/package.json');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { MeshoptDecoder } = require('meshoptimizer');

const GLB = '/Users/andreyyurlov/.t3/worktrees/space/t3-46f90470/packages/client/public/models/hulls/lark.glb';
const METALS = new Set(['Hull', 'Accent', 'Trim', 'Dark']);

function parentChain(node) {
  const names = [];
  let current = node;
  while (current) {
    names.push(current.getName());
    current = current.getParentNode ? current.getParentNode() : null;
  }
  return names;
}

function stateOf(names) {
  const blob = names.join('/');
  if (blob.includes('husk')) return 'husked';
  if (blob.includes('dmg') || blob.includes('damaged')) return 'damaged';
  return 'base';
}

function lodOf(names) {
  const hit = names.join('/').match(/LOD(\d)/);
  return hit ? Number(hit[1]) : null;
}

function transformPoint(matrix, x, y, z) {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] || 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ];
}

function summarize(buckets) {
  const out = [];
  for (const [key, bucket] of buckets) {
    const values = bucket.edges;
    values.sort((a, b) => a - b);
    const at = (p) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] : null;
    out.push({
      key,
      triangles: bucket.triangles,
      edges: values.length,
      world_area_m2: bucket.worldArea,
      uv_area: bucket.uvArea,
      area_px_per_m: bucket.worldArea > 0 ? 4096 * Math.sqrt(bucket.uvArea / bucket.worldArea) : null,
      median_px_per_m: at(0.5),
      p10_px_per_m: at(0.1),
      p90_px_per_m: at(0.9),
      uv_min: bucket.uvMin,
      uv_max: bucket.uvMax,
      world_min: bucket.worldMin,
      world_max: bucket.worldMax,
    });
  }
  return out;
}

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(GLB);
const buckets = new Map();
const accessorNotes = [];
for (const node of document.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const chain = parentChain(node);
  const state = stateOf(chain);
  const lod = lodOf(chain);
  if (lod !== 0) continue;
  const matrix = node.getWorldMatrix();
  for (const primitive of mesh.listPrimitives()) {
    const material = primitive.getMaterial();
    const materialName = material ? material.getName() : '';
    if (!METALS.has(materialName)) continue;
    const position = primitive.getAttribute('POSITION');
    const uv = primitive.getAttribute('TEXCOORD_0');
    if (!position || !uv) continue;
    if (accessorNotes.length < 4 && materialName === 'Hull') {
      accessorNotes.push({
        state,
        node: node.getName(),
        position: {
          type: position.getComponentType(),
          normalized: position.getNormalized(),
          min: position.getMin([]),
          max: position.getMax([]),
          raw0: Array.from(position.getArray()).slice(0, 3),
          element0: position.getElement(0, []),
        },
        uv: {
          type: uv.getComponentType(),
          normalized: uv.getNormalized(),
          min: uv.getMin([]),
          max: uv.getMax([]),
          raw0: Array.from(uv.getArray()).slice(0, 2),
          element0: uv.getElement(0, []),
        },
        worldMatrixScale: [matrix[0], matrix[5], matrix[10]],
        world0: transformPoint(matrix, ...position.getElement(0, [])),
      });
    }
    const index = primitive.getIndices();
    const count = index ? index.getCount() : position.getCount();
    const key = `${state}/LOD0/${materialName}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        edges: [],
        triangles: 0,
        worldArea: 0,
        uvArea: 0,
        uvMin: [Infinity, Infinity],
        uvMax: [-Infinity, -Infinity],
        worldMin: [Infinity, Infinity, Infinity],
        worldMax: [-Infinity, -Infinity, -Infinity],
      };
      buckets.set(key, bucket);
    }
    bucket.triangles += count / 3;
    const pos = [ [], [], [] ];
    const tex = [ [], [], [] ];
    for (let t = 0; t < count; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const id = index ? index.getScalar(t + k) : t + k;
        pos[k] = transformPoint(matrix, ...position.getElement(id, []));
        tex[k] = uv.getElement(id, []);
        for (let axis = 0; axis < 2; axis += 1) {
          bucket.uvMin[axis] = Math.min(bucket.uvMin[axis], tex[k][axis]);
          bucket.uvMax[axis] = Math.max(bucket.uvMax[axis], tex[k][axis]);
        }
        for (let axis = 0; axis < 3; axis += 1) {
          bucket.worldMin[axis] = Math.min(bucket.worldMin[axis], pos[k][axis]);
          bucket.worldMax[axis] = Math.max(bucket.worldMax[axis], pos[k][axis]);
        }
      }
      const ab = [pos[1][0] - pos[0][0], pos[1][1] - pos[0][1], pos[1][2] - pos[0][2]];
      const ac = [pos[2][0] - pos[0][0], pos[2][1] - pos[0][1], pos[2][2] - pos[0][2]];
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      bucket.worldArea += Math.hypot(...cross) * 0.5;
      bucket.uvArea += Math.abs((tex[1][0] - tex[0][0]) * (tex[2][1] - tex[0][1]) - (tex[2][0] - tex[0][0]) * (tex[1][1] - tex[0][1])) * 0.5;
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const world = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1], pos[a][2] - pos[b][2]);
        const span = Math.hypot(tex[a][0] - tex[b][0], tex[a][1] - tex[b][1]);
        if (world > 1e-4 && span > 1e-8) bucket.edges.push((span * 4096) / world);
      }
    }
  }
}

const report = { accessorNotes, density: summarize(buckets) };
writeFileSync('/Users/andreyyurlov/.t3/worktrees/space/t3-46f90470/assets/renders/hulls/lark-round3-current/density-20261107/red-export-density.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
