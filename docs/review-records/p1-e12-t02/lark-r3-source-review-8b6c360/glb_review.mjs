import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire('/Users/andreyyurlov/.t3/worktrees/space/t3-46f90470/packages/tools/package.json');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { MeshoptDecoder } = require('meshoptimizer');

const GLB = process.argv[2];
const OUT = process.argv[3];
const ATLAS = 4096;
const ROLES = new Set(['Hull', 'Accent', 'Trim', 'Dark']);

function parentChain(node) {
  const names = [];
  let current = node;
  while (current) {
    names.push(current.getName() || '');
    current = current.getParentNode ? current.getParentNode() : null;
  }
  return names;
}

function lodOf(names) {
  const hit = names.join('/').match(/LOD(\d+)/);
  return hit ? Number(hit[1]) : null;
}

function lodName(names) {
  return names.find((name) => /LOD\d+/.test(name)) || null;
}

function stripSuffix(name) {
  return (name || '').replace(/\.\d+$/, '');
}

function roleOf(material) {
  if (!material) return null;
  return stripSuffix(material.getName() || '');
}

function transformPoint(matrix, x, y, z) {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] || 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ];
}

function median(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - index) + sorted[hi] * (index - lo);
}

function imageSize(bytes, mime) {
  if (!bytes || bytes.length < 48) return null;
  const magic = Buffer.from(bytes.subarray(0, 12)).toString('latin1');
  if (magic.startsWith('\u00abKTX 20') || bytes[0] === 0xab) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      kind: 'ktx2',
      width: view.getUint32(20, true),
      height: view.getUint32(24, true),
      levels: view.getUint32(40, true),
    };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { kind: 'png', width: view.getUint32(16, false), height: view.getUint32(20, false), mime };
  }
  return { kind: mime || 'unknown', bytes: bytes.length };
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(GLB);
const root = document.getRoot();

const accessorSamples = [];
const uvAudit = { renderPrimitives: 0, missingTexcoord0: 0, extraTexcoord: 0, sets: {} };
const buckets = new Map();
const skippedMaterials = {};
let worldMin = [Infinity, Infinity, Infinity];
let worldMax = [-Infinity, -Infinity, -Infinity];

for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const chain = parentChain(node);
  const lod = lodOf(chain);
  if (lod === null) continue;
  const matrix = node.getWorldMatrix();
  for (const primitive of mesh.listPrimitives()) {
    uvAudit.renderPrimitives += 1;
    const semantics = primitive.listSemantics();
    const tex = semantics.filter((name) => name.startsWith('TEXCOORD')).sort();
    const setKey = tex.join(',') || '(none)';
    uvAudit.sets[setKey] = (uvAudit.sets[setKey] || 0) + 1;
    if (!tex.includes('TEXCOORD_0')) uvAudit.missingTexcoord0 += 1;
    if (tex.some((name) => name !== 'TEXCOORD_0')) uvAudit.extraTexcoord += 1;
    if (lod !== 0) continue;
    const material = primitive.getMaterial();
    const role = roleOf(material);
    const position = primitive.getAttribute('POSITION');
    const uv = primitive.getAttribute('TEXCOORD_0');
    if (accessorSamples.length < 6 && position && uv && role === 'Hull') {
      const rawUv = uv.getArray();
      const rawPos = position.getArray();
      accessorSamples.push({
        node: node.getName(),
        parents: chain,
        position: {
          componentType: position.getComponentType(),
          normalized: position.getNormalized(),
          count: position.getCount(),
          raw0: rawPos ? Array.from(rawPos).slice(0, 3) : null,
          element0: position.getElement(0, []),
        },
        uv: {
          componentType: uv.getComponentType(),
          normalized: uv.getNormalized(),
          count: uv.getCount(),
          raw0: rawUv ? Array.from(rawUv).slice(0, 2) : null,
          element0: uv.getElement(0, []),
        },
        world0: transformPoint(matrix, ...position.getElement(0, [])),
      });
    }
    if (!ROLES.has(role) || !position || !uv) {
      if (role && !ROLES.has(role)) skippedMaterials[role] = (skippedMaterials[role] || 0) + 1;
      continue;
    }
    const index = primitive.getIndices();
    const count = index ? index.getCount() : position.getCount();
    const key = `${lodName(chain)}/${stripSuffix(node.getName())}/${role}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { edges: [], triangles: 0, worldArea: 0, uvArea: 0, uvMin: [Infinity, Infinity], uvMax: [-Infinity, -Infinity] };
      buckets.set(key, bucket);
    }
    bucket.triangles += count / 3;
    const pos = [[], [], []];
    const texv = [[], [], []];
    for (let t = 0; t < count; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const id = index ? index.getScalar(t + k) : t + k;
        pos[k] = transformPoint(matrix, ...position.getElement(id, []));
        texv[k] = uv.getElement(id, []);
        for (let axis = 0; axis < 2; axis += 1) {
          bucket.uvMin[axis] = Math.min(bucket.uvMin[axis], texv[k][axis]);
          bucket.uvMax[axis] = Math.max(bucket.uvMax[axis], texv[k][axis]);
        }
        for (let axis = 0; axis < 3; axis += 1) {
          worldMin[axis] = Math.min(worldMin[axis], pos[k][axis]);
          worldMax[axis] = Math.max(worldMax[axis], pos[k][axis]);
        }
      }
      const ab = [pos[1][0] - pos[0][0], pos[1][1] - pos[0][1], pos[1][2] - pos[0][2]];
      const ac = [pos[2][0] - pos[0][0], pos[2][1] - pos[0][1], pos[2][2] - pos[0][2]];
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      bucket.worldArea += Math.hypot(cross[0], cross[1], cross[2]) * 0.5;
      bucket.uvArea += Math.abs((texv[1][0] - texv[0][0]) * (texv[2][1] - texv[0][1]) - (texv[2][0] - texv[0][0]) * (texv[1][1] - texv[0][1])) * 0.5;
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const world = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1], pos[a][2] - pos[b][2]);
        const span = Math.hypot(texv[a][0] - texv[b][0], texv[a][1] - texv[b][1]);
        if (world > 1e-4 && span > 1e-8) bucket.edges.push((span * ATLAS) / world);
      }
    }
  }
}

const density = [];
for (const [key, bucket] of buckets) {
  const edges = bucket.edges;
  edges.sort((a, b) => a - b);
  density.push({
    key,
    triangles: bucket.triangles,
    edges: edges.length,
    world_area_m2: bucket.worldArea,
    uv_area: bucket.uvArea,
    area_px_per_m: bucket.worldArea > 0 ? ATLAS * Math.sqrt(bucket.uvArea / bucket.worldArea) : null,
    median_px_per_m: median(edges.slice()),
    p10_px_per_m: percentile(edges, 0.1),
    p90_px_per_m: percentile(edges, 0.9),
    uv_min: bucket.uvMin,
    uv_max: bucket.uvMax,
  });
}
density.sort((a, b) => a.median_px_per_m - b.median_px_per_m);

const markers = [];
for (const node of root.listNodes()) {
  const name = node.getName() || '';
  if (!/^(BAY_|Canopy)/.test(name)) continue;
  const matrix = node.getWorldMatrix();
  markers.push({
    name,
    hasMesh: Boolean(node.getMesh()),
    parent: node.getParentNode() ? node.getParentNode().getName() : null,
    translation: node.getTranslation(),
    worldTranslation: [matrix[12], matrix[13], matrix[14]],
  });
}

const images = root.listTextures().map((image) => {
  const bytes = image.getImage();
  const declared = image.getSize();
  return {
    name: image.getName(),
    mime: image.getMimeType(),
    bytes: bytes ? bytes.byteLength : 0,
    declaredSize: declared,
    size: bytes ? imageSize(bytes, image.getMimeType()) : null,
  };
});

const medians = density.map((row) => row.median_px_per_m).filter((value) => value != null);
const report = {
  glb: GLB,
  extensions: root.listExtensionsUsed().map((ext) => ext.extensionName),
  extensionsRequired: root.listExtensionsRequired().map((ext) => ext.extensionName),
  accessorSamples,
  uvAudit,
  skippedMaterials,
  worldAabb: { min: worldMin, max: worldMax },
  images,
  markers,
  density: {
    atlas_pixels: ATLAS,
    roles: density.length,
    min_median: medians.length ? Math.min(...medians) : null,
    min_key: density[0] ? density[0].key : null,
    max_median: medians.length ? Math.max(...medians) : null,
    rows: density,
  },
};
writeFileSync(OUT, JSON.stringify(report));
console.log(JSON.stringify({
  extensions: report.extensions,
  uvAudit: report.uvAudit,
  min_median: report.density.min_median,
  min_key: report.density.min_key,
  roles: report.density.roles,
  worldAabb: report.worldAabb,
  markers: report.markers.map((marker) => marker.name),
  imageSizes: images.map((image) => ({ name: image.name, size: image.size, mime: image.mime })),
}, null, 2));
