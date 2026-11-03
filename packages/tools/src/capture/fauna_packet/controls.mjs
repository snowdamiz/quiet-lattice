// CPU controls: importing entry.mjs never imports captureUi, Vite, Playwright or tsx.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { controlledWrite, outputPlan, validateSample } from './entry.mjs';

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
