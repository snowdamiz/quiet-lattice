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
  const raw = {
    viewport: [1920, 1080],
    canvas: [1920, 1080],
    numbers: [],
    phase: 'fight',
    clipTime: 204 / 60,
    gameTime: 100,
    hudTime: 1000,
    feedTime: 40000,
    actor: 1,
    events: [],
    takes: [],
  };
  validateSample(raw, '_frames/203.jpg', '16x9', 'broad');
  for (const changed of [
    { clipTime: 0 },
    { phase: 'turn' },
    { canvas: [2520, 1080] },
    { numbers: [{ sameRecord: false }] },
    { gameTime: null },
    { hudTime: NaN },
    { events: undefined },
  ])
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

async function entryFailureControl(scenario, entryUrl) {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  const { default: os } = await import('node:os');
  const { default: cp } = await import('node:child_process');
  const { default: assert } = await import('node:assert/strict');
  const { createHash } = await import('node:crypto');
  const { registerHooks, syncBuiltinESMExports } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fauna-entry-cpu-')));
  const evidence = path.join(root, 'evidence');
  fs.mkdirSync(evidence);
  const readyPath = path.join(root, 'packages/tools/src/capture/fauna_packet/readiness.json');
  fs.mkdirSync(path.dirname(readyPath), { recursive: true });
  const unit = 'cpu-only',
    consumedPath = path.join(root, 'consumed.json');
  const spec = { kind: 'correction', aspect: '16x9', evidence, output: path.join(root, 'output'), consumption: consumedPath };
  const ready = {
    runtimeEnabled: true,
    root,
    node: process.execPath,
    path: process.env.PATH,
    bindings: [],
    productBindings: {},
    tsxApi: path.join(root, 'tsx.mjs'),
    esbuild: path.join(root, 'esbuild.mjs'),
    playwright: path.join(root, 'playwright.mjs'),
    units: { [unit]: spec },
  };
  fs.writeFileSync(readyPath, JSON.stringify(ready));
  fs.writeFileSync(consumedPath, JSON.stringify({ unit, readinessSha256: createHash('sha256').update(fs.readFileSync(readyPath)).digest('hex'), spec }));
  const originalWrite = fs.writeFileSync.bind(fs),
    attempts = [],
    fallbacks = [];
  const originalStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (data) => {
    if (scenario === 'all-reporters') throw Error('STDERR_SECONDARY');
    fallbacks.push(String(data));
    return true;
  };
  fs.writeFileSync = (file, ...rest) => {
    const name = path.basename(String(file));
    attempts.push(name);
    if (
      (scenario === 'catch-write' && name === 'returned-entry-failure.json') ||
      (scenario === 'final-write' && name === 'entry-result.json') ||
      (['combined', 'all-reporters'].includes(scenario) && ['returned-entry-failure.json', 'entry-result.json'].includes(name))
    )
      throw Object.assign(Error('ENOSPC_SECONDARY'), { code: 'ENOSPC' });
    return originalWrite(file, ...rest);
  };
  let native = 0,
    captureCalls = 0;
  const forbidden = () => {
    native++;
    throw Error('FORBIDDEN_NATIVE');
  };
  for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = forbidden;
  globalThis.cpuCapture = () => {
    captureCalls++;
    throw Error('PRIMARY_CAPTURE');
  };
  syncBuiltinESMExports();
  const sources = new Map(
    [
      [
        ready.tsxApi,
        `export function register(){return ()=>{${['combined', 'all-reporters', 'unregister'].includes(scenario) ? 'throw Error("UNREGISTER_SECONDARY")' : ''}}}`,
      ],
      [ready.esbuild, scenario === 'setup' ? 'throw Error("PRIMARY_SETUP")' : 'export function transformSync(){return {code:"cpu-only"}}'],
      [path.join(root, 'packages/client/src/ui/HUD.js'), 'export class HUD {hitNumber(){} hitAnchor(){}}'],
      [path.join(root, 'packages/client/src/gameplay/Fauna.js'), 'export class Fauna {update(){} hitAnchor(){}}'],
      [path.join(root, 'packages/client/src/net/combat.js'), 'export class CombatFeed {event(){} take(){}}'],
      [ready.playwright, 'export const chromium={launch(){throw Error("FORBIDDEN_BROWSER")}}'],
      [
        path.join(root, 'packages/tools/src/capture/screens.ts'),
        `export const SCREENS={${JSON.stringify(unit)}:{clipSeconds:1.2,clipAspect:'16x9',stills:{kill(){},offscreen(){},start(){}},open(){},motion(){}}}`,
      ],
      [path.join(root, 'packages/tools/src/capture/capture.ts'), 'export async function captureUi(){return globalThis.cpuCapture()}'],
    ].map(([file, source]) => [pathToFileURL(file).href, source]),
  );
  registerHooks({
    resolve(s, c, next) {
      if (sources.has(s)) return { url: s, shortCircuit: true };
      if (s.startsWith('node:') || s === entryUrl) return next(s, c);
      throw Error('FORBIDDEN_IMPORT:' + s);
    },
    load(url, c, next) {
      if (sources.has(url)) return { format: 'module', source: sources.get(url), shortCircuit: true };
      return next(url, c);
    },
  });
  const { main } = await import(entryUrl);
  process.argv = [process.execPath, 'entry.mjs', readyPath, unit, consumedPath];
  process.chdir(root);
  process.env.NODE_OPTIONS = '';
  process.env.SMOKE_GL = 'metal';
  let error;
  try {
    await main();
  } catch (e) {
    error = e;
  }
  process.stderr.write = originalStderr;
  assert.equal(error?.message, scenario === 'setup' ? 'PRIMARY_SETUP' : 'PRIMARY_CAPTURE');
  const result = error.entryResult;
  assert.equal(result.accepted, false);
  assert.equal(result.primaryFailure.message, error.message);
  assert.equal(native, 0);
  assert.equal(captureCalls, scenario === 'setup' ? 0 : 1);
  assert.equal(result.pages, 0);
  assert.equal(result.launched, 0);
  assert.deepEqual(result.writes, []);
  assert.ok(attempts.includes('entry-result.json'));
  if (['combined', 'all-reporters', 'unregister'].includes(scenario)) assert.equal(result.cleanupFailures[0].message, 'UNREGISTER_SECONDARY');
  if (['catch-write', 'final-write', 'combined', 'all-reporters'].includes(scenario)) assert.ok(result.persistenceFailures.some((x) => x.code === 'ENOSPC'));
  if (scenario === 'all-reporters') assert.equal(result.persistenceFailures.at(-1).message, 'STDERR_SECONDARY');
  else assert.deepEqual(JSON.parse(fallbacks.at(-1)), result);
  process.chdir(os.tmpdir());
  fs.rmSync(root, { recursive: true });
  process.stdout.write(
    JSON.stringify({
      scenario,
      primary: result.primaryFailure,
      secondary: result.persistenceFailures,
      cleanup: result.cleanupFailures,
      attempts,
      native,
      captureCalls,
    }),
  );
}

test('actual Node main preserves primary, complete fallback, cleanup and write failures without later dispatch', () => {
  for (const scenario of ['catch-write', 'final-write', 'combined', 'all-reporters', 'setup', 'unregister']) {
    const script = `(${entryFailureControl.toString()})(${JSON.stringify(scenario)},${JSON.stringify(new URL('./entry.mjs', import.meta.url).href)})`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(result.stdout).native, 0);
  }
});
