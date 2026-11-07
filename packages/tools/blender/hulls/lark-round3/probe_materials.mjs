import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/Users/andreyyurlov/Documents/dev/space/packages/tools/package.json');
const { Document, NodeIO } = require('@gltf-transform/core');
const records = JSON.parse(readFileSync(0, 'utf8'));
const output = [];
for (const record of records) {
  const result = { semantic: record.semantic, material: record.material };
  for (const state of ['before', 'after']) {
    const document = new Document();
    document.createMaterial(record.material).setEmissiveFactor(record[`${state}_factor`]);
    result[state] = (await new NodeIO().writeJSON(document)).json.materials[0];
  }
  output.push(result);
}
process.stdout.write(JSON.stringify(output));
