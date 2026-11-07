// CPU controls: importing entry.mjs never imports captureUi, Vite, Playwright or tsx.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { test } from 'node:test';
import { controlledWrite, outputPlan, validateSample } from './entry.mjs';

test('broad inventory has 219 images, one readout, and unchanged capture order', () => {
  const plan = outputPlan('16x9', 'broad');
  assert.equal(plan.length, 220);
  assert.equal(new Set(plan).size, 220);
  assert.equal(plan.filter((p) => p.endsWith('.jpg')).length, 204);
  assert.equal(plan.filter((p) => p.endsWith('.png')).length, 15);
  assert.equal(plan[6], '16x9-start.png');
  assert.equal(plan[210], '_frames/203.jpg');
  assert.equal(plan[211], 'readout.txt');
  assert.equal(plan[212], 'clip-sheet.png');
  assert.equal(plan.at(-1), '21x9-start.png');
  assert.throws(() => outputPlan('21x9', 'broad'), /inventory/);
});

test('actual disabled Node entry refuses all six units before imports, writes or child launch', () => {
  const program = `import { main } from ${JSON.stringify(new URL('./entry.mjs', import.meta.url).href)};
import fs from 'node:fs'; import cp from 'node:child_process'; import { registerHooks, syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw Error('CPU guard: forbidden launch/allocation'); };
for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[key] = forbidden;
for (const key of ['writeFileSync','appendFileSync','mkdirSync','rmSync']) fs[key] = forbidden;
syncBuiltinESMExports();
registerHooks({resolve(specifier, context, next) { throw Error('CPU guard: forbidden dynamic import: '+specifier); }});
process.argv = ['node', 'entry.mjs', ${JSON.stringify(fileURLToPath(new URL('./readiness.json', import.meta.url)))}, process.argv[1], '/nonexistent-cpu-consumption'];
try { await main(); throw Error('disabled entry unexpectedly accepted'); } catch(error) {
 if(error.message !== 'Readiness disabled before capture imports') throw error;
 process.stdout.write(error.message);
}`;
  for (const unit of [
    'fauna-hit-turn-day-16x9',
    'fauna-hit-turn-day-21x9',
    'fauna-hit-turn-night-16x9',
    'fauna-hit-turn-night-21x9',
    'fauna-combat',
    'fauna-combat-night',
  ]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, unit], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Readiness disabled before capture imports');
  }
});

test('broad frames require the actual fight clock and preserve incarnation checks', () => {
  const raw = { viewport: [1920, 1080], canvas: [1920, 1080], numbers: [], phase: 'fight', clipTime: 204 / 60 };
  validateSample(raw, '_frames/203.jpg', '16x9', 'broad');
  for (const changed of [{ clipTime: 0 }, { phase: 'turn' }, { canvas: [2520, 1080] }, { numbers: [{ sameRecord: false }] }])
    assert.throws(() => validateSample({ ...raw, ...changed }, '_frames/203.jpg', '16x9', 'broad'));
});

test('each bounded screen writes 81 images and one readout in the standard capture order', () => {
  for (const aspect of ['16x9', '21x9']) {
    const plan = outputPlan(aspect);
    assert.equal(plan.length, 82);
    assert.equal(new Set(plan).size, 82);
    assert.equal(plan.filter((p) => p.endsWith('.jpg')).length, 72);
    assert.equal(plan.filter((p) => p.endsWith('.png')).length, 9);
    assert.equal(plan.at(-1), aspect === '16x9' ? '21x9-start.png' : 'clip-sheet.png');
  }
});

test('unexpected, reordered, escaping, oversized and repeated output never overwrites bytes', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'fauna-cpu-'));
  try {
    const writes = [],
      plan = ['first.png', 'readout.txt'];
    assert.throws(() => controlledWrite(output, plan, writes, path.join(output, 'other.png'), 'x'), /Unexpected/);
    assert.throws(() => controlledWrite(output, plan, writes, path.join(output, '../escape.png'), 'x'), /Unexpected/);
    assert.throws(() => controlledWrite(output, plan, writes, path.join(output, 'first.png'), 'four', 3), /per-file cap/);
    assert.equal(fs.readdirSync(output).length, 0);
    controlledWrite(output, plan, writes, path.join(output, 'first.png'), 'original');
    assert.throws(() => controlledWrite(output, plan, writes, path.join(output, 'first.png'), 'replacement'), /Unexpected/);
    assert.equal(fs.readFileSync(path.join(output, 'first.png'), 'utf8'), 'original');
    assert.throws(() => controlledWrite(output, plan, writes, path.join(output, 'readout.txt'), 'x'.repeat(16385)), /per-file cap/);
  } finally {
    // Only this CPU control's known file and owned empty root.
    const file = path.join(output, 'first.png');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(output);
  }
});

test('actual clock, viewport, incarnation and return hit checkpoints reject adverse samples', () => {
  const raw = {
    viewport: [1920, 1080],
    canvas: [1920, 1080],
    phase: 'turn',
    traceFrame: { frame: 60, ms: (61 * 1000) / 60 },
    target: { id: 602, visible: true, incarnation: 1 },
    numbers: [{ value: '11', target: 602, incarnation: 1, sameRecord: true }],
  };
  validateSample(raw, '_frames/060.jpg', '16x9');
  for (const changed of [
    { viewport: [2520, 1080] },
    { traceFrame: { frame: 59, ms: 1000 } },
    { target: { ...raw.target, visible: false } },
    { numbers: [{ ...raw.numbers[0], incarnation: 2 }] },
    { numbers: [] },
  ])
    assert.throws(() => validateSample({ ...raw, ...changed }, '_frames/060.jpg', '16x9'));
});
