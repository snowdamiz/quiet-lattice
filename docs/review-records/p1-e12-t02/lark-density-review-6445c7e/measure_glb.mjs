import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/packages/tools/package.json');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { MeshoptDecoder } = require('meshoptimizer');

const GLB = process.argv[2];
const OUT = process.argv[3];
const ATLAS = 4096;
const ROLES = new Set(['Hull', 'Accent', 'Trim', 'Dark']);

function sha256(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

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

function imageSize(bytes, mime) {
  if (!bytes || bytes.length < 48) return null;
  if (bytes[0] === 0xab) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { kind: 'ktx2', width: view.getUint32(20, true), height: view.getUint32(24, true), levels: view.getUint32(40, true) };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { kind: 'png', width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  return { kind: mime || 'unknown', bytes: bytes.length };
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(GLB);
const root = document.getRoot();
const uvAudit = { renderPrimitives: 0, missingTexcoord0: 0, extraTexcoord: 0, sets: {} };
const accessorHist = {};
const buckets = new Map();
const outside = new Map();
const skippedMaterials = {};
const lodTris = {};
const namedBits = [];
const floatUv = [];
let uvMin = [Infinity, Infinity];
let uvMax = [-Infinity, -Infinity];
let uvSamples = 0;
let uvOutside = 0;

function bump(map, key, n) {
  map[key] = (map[key] || 0) + n;
}

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
    for (const sem of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1']) {
      const attr = primitive.getAttribute(sem);
      const key = attr
        ? `${sem} type=${attr.getType()} ct=${attr.getComponentType()} normalized=${attr.getNormalized()}`
        : `${sem} absent`;
      bump(accessorHist, key, 1);
    }
    const index = primitive.getIndices();
    const position = primitive.getAttribute('POSITION');
    const count = index ? index.getCount() : position ? position.getCount() : 0;
    const lodKey = lodName(chain) || `LOD${lod}`;
    lodTris[lodKey] = (lodTris[lodKey] || 0) + count / 3;
    const nodeName = node.getName() || '';
    if (/glyph|hollow|seam/i.test(nodeName) && namedBits.length < 40) {
      namedBits.push({ node: nodeName, lod, material: roleOf(primitive.getMaterial()), triangles: count / 3 });
    }
    const uvAttr = primitive.getAttribute('TEXCOORD_0');
    if (uvAttr && uvAttr.getNormalized() !== true && floatUv.length < 40) {
      floatUv.push({ node: nodeName, lod, material: roleOf(primitive.getMaterial()), componentType: uvAttr.getComponentType(), count: uvAttr.getCount() });
    }
    if (lod !== 0) continue;
    const material = primitive.getMaterial();
    const role = roleOf(material);
    const uv = primitive.getAttribute('TEXCOORD_0');
    if (!position || !uv) continue;
    const normalized = uv.getNormalized() === true;
    const target = ROLES.has(role) ? buckets : outside;
    if (role && !ROLES.has(role)) skippedMaterials[role] = (skippedMaterials[role] || 0) + 1;
    if (!role) continue;
    const key = `${lodName(chain)}/${stripSuffix(node.getName())}/${role}`;
    let bucket = target.get(key);
    if (!bucket) {
      bucket = { edges: [], triangles: 0, worldArea: 0, uvArea: 0, normalized: normalized };
      target.set(key, bucket);
    }
    bucket.normalized = bucket.normalized && normalized;
    bucket.triangles += count / 3;
    const pos = [[], [], []];
    const texv = [[], [], []];
    for (let t = 0; t < count; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const id = index ? index.getScalar(t + k) : t + k;
        pos[k] = transformPoint(matrix, ...position.getElement(id, []));
        texv[k] = uv.getElement(id, []);
        for (let axis = 0; axis < 2; axis += 1) {
          uvMin[axis] = Math.min(uvMin[axis], texv[k][axis]);
          uvMax[axis] = Math.max(uvMax[axis], texv[k][axis]);
          uvSamples += 1;
          if (texv[k][axis] < -1e-4 || texv[k][axis] > 1 + 1e-4) uvOutside += 1;
        }
      }
      const ab = [pos[1][0] - pos[0][0], pos[1][1] - pos[0][1], pos[1][2] - pos[0][2]];
      const ac = [pos[2][0] - pos[0][0], pos[2][1] - pos[0][1], pos[2][2] - pos[0][2]];
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      bucket.worldArea += Math.hypot(...cross) * 0.5;
      bucket.uvArea += Math.abs((texv[1][0] - texv[0][0]) * (texv[2][1] - texv[0][1]) - (texv[2][0] - texv[0][0]) * (texv[1][1] - texv[0][1])) * 0.5;
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const world = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1], pos[a][2] - pos[b][2]);
        const span = Math.hypot(texv[a][0] - texv[b][0], texv[a][1] - texv[b][1]);
        if (world > 1e-4 && span > 1e-8) bucket.edges.push((span * ATLAS) / world);
      }
    }
  }
}

function finish(map) {
  const rows = [];
  for (const [key, bucket] of map) {
    const edges = bucket.edges;
    rows.push({
      key,
      triangles: bucket.triangles,
      edges: edges.length,
      world_area_m2: bucket.worldArea,
      uv_area: bucket.uvArea,
      median_px_per_m: median(edges.slice()),
      texcoord_normalized: bucket.normalized,
    });
  }
  rows.sort((a, b) => a.median_px_per_m - b.median_px_per_m);
  return rows;
}

const density = finish(buckets);
const outsideRows = finish(outside);
const medians = density.map((row) => row.median_px_per_m).filter((value) => value != null);
const imageFacts = root.listTextures().map((texture) => {
  const bytes = texture.getImage();
  const declared = texture.getSize();
  return {
    name: texture.getName(),
    mime: texture.getMimeType(),
    bytes: bytes ? bytes.byteLength : 0,
    declaredSize: declared,
    size: bytes ? imageSize(bytes, texture.getMimeType()) : null,
  };
});
const materials = root.listMaterials().map((material) => {
  const slots = {};
  for (const [slot, getter, infoGetter] of [
    ['baseColor', 'getBaseColorTexture', 'getBaseColorTextureInfo'],
    ['metallicRoughness', 'getMetallicRoughnessTexture', 'getMetallicRoughnessTextureInfo'],
    ['normal', 'getNormalTexture', 'getNormalTextureInfo'],
    ['occlusion', 'getOcclusionTexture', 'getOcclusionTextureInfo'],
    ['emissive', 'getEmissiveTexture', 'getEmissiveTextureInfo'],
  ]) {
    const tex = material[getter]();
    if (!tex) continue;
    const info = material[infoGetter]();
    const bytes = tex.getImage();
    slots[slot] = {
      texture: tex.getName(),
      mime: tex.getMimeType(),
      texCoord: info ? info.getTexCoord() : null,
      size: bytes ? imageSize(bytes, tex.getMimeType()) : tex.getSize(),
    };
  }
  const extras = material.getExtras() || {};
  return {
    name: material.getName(),
    role: roleOf(material),
    alphaMode: material.getAlphaMode(),
    extras: extras,
    extensions: material.listExtensions().map((ext) => ext.extensionName),
    slots,
  };
});

const report = {
  glb: GLB,
  glb_sha256: sha256(GLB),
  glb_bytes: readFileSync(GLB).length,
  decoder: {
    node_require_from: '/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/packages/tools/package.json',
    gltf_transform_core: require.resolve('@gltf-transform/core'),
    meshoptimizer: require.resolve('meshoptimizer'),
  },
  extensions: root.listExtensionsUsed().map((ext) => ext.extensionName).sort(),
  extensionsRequired: root.listExtensionsRequired().map((ext) => ext.extensionName).sort(),
  accessorHist,
  uvAudit,
  uv_bounds_lod0: { min: uvMin, max: uvMax, samples: uvSamples, samples_outside_0_1: uvOutside },
  lodTris,
  namedBits,
  floatUv,
  skippedMaterials,
  images: imageFacts,
  image_size_counts: imageFacts.reduce((acc, image) => {
    const key = image.size ? `${image.size.width}x${image.size.height}` : 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}),
  materials,
  density: {
    atlas_pixels: ATLAS,
    roles: density.length,
    min_median: medians.length ? Math.min(...medians) : null,
    min_key: density[0] ? density[0].key : null,
    max_median: medians.length ? Math.max(...medians) : null,
    all_texcoord_normalized: density.every((row) => row.texcoord_normalized),
    rows: density,
  },
  outside_gate: {
    roles: outsideRows.length,
    min_median: outsideRows.length ? outsideRows[0].median_px_per_m : null,
    min_key: outsideRows.length ? outsideRows[0].key : null,
    rows: outsideRows,
  },
};
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log('GLB_MEASURE', JSON.stringify({
  min_median: report.density.min_median,
  min_key: report.density.min_key,
  roles: report.density.roles,
  images: imageFacts.length,
  sizes: report.image_size_counts,
  uv: uvAudit,
  required: report.extensionsRequired,
}));
