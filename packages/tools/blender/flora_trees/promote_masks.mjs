import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import assert from 'node:assert/strict';
import { meshoptIO, compressDocument } from '../../src/art/meshopt.ts';

const [src, dst, report] = process.argv.slice(2);
const io = await meshoptIO();
const doc = await io.read(src);
const records = [];
for (const mesh of doc.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const rgb = primitive.getAttribute('_T04_MASK_RGB');
    const ao = primitive.getAttribute('_T04_MASK_AO');
    const old = primitive.getAttribute('COLOR_0');
    assert(rgb && ao && old, `Missing exact mask carriers: ${mesh.getName()}`);
    assert.equal(rgb.getComponentType(), 5126);
    assert.equal(ao.getComponentType(), 5126);
    assert.equal(rgb.getCount(), ao.getCount());
    const rgba = new Float32Array(rgb.getCount() * 4);
    const colors = rgb.getArray();
    const occlusion = ao.getArray();
    let maxQuantizationError = 0;
    for (let i = 0; i < rgb.getCount(); i++) {
      const before = old.getElement(i, []);
      for (let k = 0; k < 4; k++) {
        const value = k === 3 ? occlusion[i] : colors[i * 3 + k];
        assert(Number.isFinite(value) && value >= 0 && value <= 1);
        rgba[i * 4 + k] = value;
        maxQuantizationError = Math.max(maxQuantizationError, Math.abs(value - before[k]));
      }
      assert(Math.abs(rgba[i*4] + rgba[i*4+1] + rgba[i*4+2] - 1) < 0.00001);
    }
    const exact = doc.createAccessor(`${mesh.getName()}_exact_mask`, old.getBuffer()).setType('VEC4').setArray(rgba);
    primitive.setAttribute('COLOR_0', exact);
    primitive.setAttribute('_T04_MASK_RGB', null);
    primitive.setAttribute('_T04_MASK_AO', null);
    records.push({ mesh: mesh.getName(), count: rgb.getCount(), restoredMaximumError: maxQuantizationError });
  }
}
// Remove only orphaned carriers and old colors. Texture, position, normal, UV and node data remain intact.
for (const accessor of doc.getRoot().listAccessors()) {
  if (accessor.listParents().every(p => p.propertyType === 'Root')) accessor.dispose();
}
await compressDocument(doc, { quantize: false });
await io.write(dst, doc);
const decoded = await io.read(dst);
for (const mesh of decoded.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  assert.equal(p.getAttribute('COLOR_0').getComponentType(), 5126);
  assert(!p.getAttribute('_T04_MASK_RGB') && !p.getAttribute('_T04_MASK_AO'));
}
await writeFile(report, JSON.stringify({ mode: 'exact source FLOAT carriers promoted, no validator override', records }, null, 2) + '\n', { flag: 'wx' });
