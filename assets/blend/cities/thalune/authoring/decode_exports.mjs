// Run from packages/tools: node --input-type=module < ../../assets/blend/cities/thalune/authoring/decode_exports.mjs
// THALUNE_REPORT names a new, exclusive JSON receipt. No asset mutation or image rendering.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const root = path.resolve('../..');
const home = path.join(root, 'assets/blend/cities/thalune');
const manifestPath = path.join(home, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const output = process.env.THALUNE_REPORT;
if (!output || fs.existsSync(output)) throw Error('THALUNE_REPORT must be a new receipt path');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const report = { manifestSha256: sha(fs.readFileSync(manifestPath)), method: 'MeshoptDecoder indexed primitive counts; Khronos KTX 4.4.2 extract rgba8 raw, every mip; G roughness, B metallic, linear data with material factors. Full bronze UV band floor enforced irrespective of metallic cutoff; >=0.5 metallic is a separate diagnostic.', files: [], failures: [], boundaryTests: [] };
const sameLods = (actual, declared) => JSON.stringify(actual?.lodTriangles) === JSON.stringify(declared.exportLodTriangles ?? declared.lodTriangles) && JSON.stringify(actual?.lodNodes) === JSON.stringify(declared.lodNodes);
const floorPasses = (minimum, factor = 1) => minimum / 255 * factor >= .2;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'thalune-orm-'));
try {
  for (const rel of [...new Set(manifest.assets.map(a => a.glb))]) {
    const full = path.join(root, rel);
    const bytes = fs.readFileSync(full);
    const doc = await io.read(full);
    const entry = { path: rel, sha256: sha(bytes), assets: {}, materials: [] };
    const expected = manifest.assets.filter(a => a.glb === rel);
    if (expected.some(a => a.glbSha256 !== entry.sha256)) report.failures.push(`${rel}: manifest GLB hash/pairing mismatch`);
    for (const node of doc.getRoot().listNodes()) {
      if (!node.getMesh()) continue;
      let ancestor = node;
      while (ancestor && !/_LOD[0-3]$/.test(ancestor.getName())) ancestor = ancestor.getParentNode();
      if (!ancestor) continue;
      const name = ancestor.getName();
      const id = name.slice(0, -5), lod = Number(name.at(-1));
      const asset = entry.assets[id] ??= { lodNodes: [], lodTriangles: [0, 0, 0, 0] };
      asset.lodNodes[lod] = name;
      for (const p of node.getMesh().listPrimitives()) {
        if (p.getMode() !== 4) throw Error(`Non-triangle primitive ${name}`);
        asset.lodTriangles[lod] += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
      }
    }
    for (const a of expected) {
      const actual = entry.assets[a.id];
      if (!actual || JSON.stringify(actual.lodNodes) !== JSON.stringify(a.lodNodes)) report.failures.push(`${a.id}: LOD name/pairing`);
      const declared = a.exportLodTriangles ?? a.lodTriangles;
      if (JSON.stringify(actual?.lodTriangles) !== JSON.stringify(declared)) report.failures.push(`${a.id}: export counts ${actual?.lodTriangles} != ${declared}`);
      if (a.id === 'thalune_mid_2' || a.id === 'thalune_tall_2') {
        const exact = { ...a, exportLodTriangles: actual.lodTriangles };
        const wrong = { ...exact, exportLodTriangles: [...actual.lodTriangles] };
        wrong.exportLodTriangles[3] = a.id === 'thalune_mid_2' ? 2004 : 2009;
        const wrongName = { ...actual, lodNodes: [...actual.lodNodes] };
        wrongName.lodNodes[3] = 'unrelated_LOD3';
        report.boundaryTests.push({ asset: a.id, glbSha256: entry.sha256, exactCountsAccepted: sameLods(actual, exact), swappedAssetCountsRejected: !sameLods(actual, wrong), wrongNodeNameRejected: !sameLods(wrongName, exact) });
      }
    }
    if (Object.keys(entry.assets).length !== expected.length) report.failures.push(`${rel}: unexpected exported asset`);
    for (const material of doc.getRoot().listMaterials()) {
      const texture = material.getMetallicRoughnessTexture();
      if (!texture) continue;
      const image = Buffer.from(texture.getImage());
      const width = image.readUInt32LE(20), height = image.readUInt32LE(24), levels = image.readUInt32LE(40);
      const transfer = image[image.readUInt32LE(48) + 14];
      if (transfer !== 1) throw Error('ORM is not linear');
      const ktx = path.join(temp, 'orm.ktx2');
      fs.writeFileSync(ktx, image);
      const m = { name: material.getName(), texture: texture.getName(), ktxSha256: sha(image), width, height, roughnessFactor: material.getRoughnessFactor(), metallicFactor: material.getMetallicFactor(), levels: [], bronzePrimitiveNames: [] };
      for (const node of doc.getRoot().listNodes()) {
        for (const p of node.getMesh()?.listPrimitives() ?? []) {
          if (p.getMaterial() !== material) continue;
          const uv = p.getAttribute('TEXCOORD_0');
          if (!uv) throw Error(`Missing trim UVs: ${node.getName()}`);
          // glTF V is top-down; Blender lane 4/8 occupies glTF V [3/8,4/8].
          const array = uv.getArray();
          const divisor = uv.getNormalized() ? ({5121:255,5123:65535}[uv.getComponentType()]) : 1;
          if (!divisor) throw Error('Unexpected UV component type');
          for (let i = 1; i < array.length; i += 2) {
            if (array[i] / divisor > 3/8 && array[i] / divisor < 4/8) { m.bronzePrimitiveNames.push(node.getName()); break; }
          }
        }
      }
      for (let level = 0; level < levels; level++) {
        const rawPath = path.join(temp, 'orm.raw');
        const args = ['extract', '--transcode', 'rgba8', '--raw', '--level', String(level), ktx, rawPath];
        const result = spawnSync(path.join(root, 'node_modules/.cache/ktx-software-4.4.2/bin/ktx'), args, { timeout: 60000, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { ...process.env, OMP_NUM_THREADS: '2' } });
        if (result.status !== 0) throw Error(`KTX extract ${result.status}: ${result.error ?? result.stderr}`);
        const raw = fs.readFileSync(rawPath);
        const w = Math.max(1,width >> level), h = Math.max(1,height >> level);
        if (raw.length !== w * h * 4) throw Error(`Wrong RGBA byte count ${raw.length}`);
        let bronzeTexels = 0, bronzeMinimum = 1, positiveMetalMinimum = 1, positiveMetalTexels = 0, metallicAtPositiveMinimum = null;
        for (let i = 0; i < raw.length; i += 4) {
          const roughness = raw[i + 1] / 255 * m.roughnessFactor;
          const metallic = raw[i + 2] / 255 * m.metallicFactor;
          if (metallic > 0) { positiveMetalTexels++; if (roughness < positiveMetalMinimum) { positiveMetalMinimum = roughness; metallicAtPositiveMinimum = metallic; } }
          if (metallic >= .5) { bronzeTexels++; bronzeMinimum = Math.min(bronzeMinimum, roughness); }
        }
        // Include the entire bronze band, even pixels outside the inset mesh UVs.
        let laneMinimumByte = 255, laneMaximumMetallicByte = 0;
        let firstLanePixel = null;
        for (let y = Math.floor(3*h/8); y < Math.ceil(h/2); y++) {
          for (let x = 0; x < w; x++) {
            const i = (y*w + x)*4;
            firstLanePixel ??= i;
            laneMinimumByte = Math.min(laneMinimumByte, raw[i+1]);
            laneMaximumMetallicByte = Math.max(laneMaximumMetallicByte, raw[i+2]);
          }
        }
        m.levels.push({ level, width: w, height: h, rawSha256: sha(raw), bronzeLaneMinimum: laneMinimumByte/255*m.roughnessFactor, bronzeLaneMaximumMetallic: laneMaximumMetallicByte/255*m.metallicFactor, bronzeTexels, bronzeMinimum: bronzeTexels ? bronzeMinimum : null, positiveMetalTexels, positiveMetalMinimum: positiveMetalTexels ? positiveMetalMinimum : null, metallicAtPositiveMinimum });
        if (!floorPasses(laneMinimumByte, m.roughnessFactor)) report.failures.push(`${rel}:${m.name}:mip${level} bronze UV band roughness below .2`);
        if (bronzeTexels && bronzeMinimum < .2) report.failures.push(`${rel}:${m.name}:mip${level} bronze roughness ${bronzeMinimum} below .2`);
        if (level === 0) {
          if (laneMaximumMetallicByte/255*m.metallicFactor < .5) throw Error('Bronze atlas orientation/metallic mismatch');
          // Mutate one real decoded bronze texel, at the nearest 8-bit boundary.
          const original = raw[firstLanePixel+1];
          raw[firstLanePixel+1] = 50;
          const belowRejected = !floorPasses(Math.min(laneMinimumByte, raw[firstLanePixel+1]), m.roughnessFactor);
          raw[firstLanePixel+1] = 51;
          const exactAccepted = floorPasses(Math.min(laneMinimumByte, raw[firstLanePixel+1]), m.roughnessFactor);
          const scalarBelowRejected = !floorPasses(51, .99);
          raw[firstLanePixel+1] = original;
          report.boundaryTests.push({ glb: rel, glbSha256: entry.sha256, ktxSha256: m.ktxSha256, belowAt50of255Rejected: belowRejected, exactAt51of255Accepted: exactAccepted, reducedMaterialFactorRejected: scalarBelowRejected });
        }
      }
      m.bronzeUsage = m.bronzePrimitiveNames.length ? 'used on named primitives' : 'unused lane retained in shared atlas; floor checked conservatively';
      if (!m.levels[0].bronzeTexels) report.failures.push(`${rel}: bronze texel coverage missing`);
      entry.materials.push(m);
    }
    if (!entry.materials.length) report.failures.push(`${rel}: missing ORM`);
    report.files.push(entry);
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
if (report.boundaryTests.some(test => Object.values(test).some(value => value === false))) report.failures.push('boundary regression failed');
report.pass = report.failures.length === 0;
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: report.pass, files: report.files.length, failures: report.failures }));
process.exitCode = report.pass ? 0 : 1;
