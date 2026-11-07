import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { execute, snapshot, outputPlan, writeOutput } from './entry.mjs';

const root = fs.mkdtempSync('/private/tmp/effects-entry-controls-');
const originalWrite = fs.writeFileSync.bind(fs);
let passed = 0;
function put(file, value) {
  originalWrite(file, JSON.stringify(value));
}
function fixture() {
  const folder = fs.mkdtempSync(path.join(root, 'case-'));
  const output = path.join(folder, 'output'),
    evidence = path.join(folder, 'evidence');
  fs.mkdirSync(output);
  fs.mkdirSync(evidence);
  const pilot = {
    output,
    evidence,
    file: 'effects/gravitic',
    asset: 'gravitic_pull',
    gl: 'metal',
    viewport: [1920, 1080],
    files: outputPlan(),
    authorizationId: folder,
    grant: path.join(folder, 'grant.json'),
    consumption: path.join(folder, 'consumption.json'),
  };
  const readyPath = path.join(folder, 'ready.json');
  const ready = { runtimeEnabled: true, pilot };
  put(readyPath, ready);
  const source = { head: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true };
  const review = path.join(folder, 'review.json');
  put(review, { source, verdict: 'PASS', scope: 'INDEPENDENT_EFFECTS_PILOT_CALLER_REVIEW' });
  const grant = {
    purpose: 'EFFECTS_GRAVITIC_PULL_SINGLE_DISABLED_PILOT',
    oneUse: true,
    nativeReservesAccepted: true,
    authorizationId: folder,
    pilot,
    readinessSha256: snapshot(readyPath).sha256,
    source,
    expiresAt: '2099-01-01T00:00:00Z',
    callerReview: { path: review, sha256: snapshot(review).sha256 },
  };
  put(pilot.grant, grant);
  put(pilot.consumption, {
    state: 'CONSUMED',
    accepted: false,
    grantSha256: snapshot(pilot.grant).sha256,
    readinessSha256: snapshot(readyPath).sha256,
    source,
    pilot,
    authorizationId: folder,
  });
  put(path.join(evidence, 'prelaunch-source.json'), source);
  process.env.EFFECTS_AUTHORIZATION = folder;
  process.env.EFFECTS_READY_SHA256 = snapshot(readyPath).sha256;
  const calls = [];
  return {
    readyPath,
    ready,
    pilot,
    source,
    grant,
    calls,
    args: {
      enabled: true,
      readyPath,
      verify: () => calls.push('verify'),
      captureLoader: async () => {
        calls.push('load');
        return async (file, opts) => {
          calls.push('capture');
          assert.equal(file, 'effects/gravitic');
          assert.deepEqual(opts, { asset: 'gravitic_pull', outDir: output });
          fs.mkdirSync(path.join(output, 'gravitic_pull'));
          const paths = outputPlan().map((p) => path.join(output, p));
          for (const p of paths) fs.writeFileSync(p, 'inert CPU writer control, not a PNG');
          return paths;
        };
      },
    },
  };
}
async function test(name, fn) {
  await fn();
  passed++;
  process.stdout.write('PASS ' + name + '\n');
}
try {
  await test('actual disabled entry zero reads/import/launch/allocation', async () => {
    const result = await execute({ readyPath: '/does/not/exist', captureLoader: () => assert.fail('native import') });
    assert.equal(result.state, 'DISABLED');
    assert.equal(result.allocations, 0);
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('./entry.mjs', import.meta.url)), '/does/not/exist'], { timeout: 5000 });
    assert.equal(run.status, 78);
  });
  await test('actual writer guard and terminal receipt; reused entry refused before load', async () => {
    const f = fixture();
    const result = await execute(f.args);
    assert.equal(result.accepted, true);
    assert.equal(result.writes.length, 12);
    assert.equal(snapshot(path.join(f.pilot.evidence, 'entry.json')).value.accepted, false);
    await assert.rejects(execute(f.args), /Fresh caller-owned/);
    assert.deepEqual(f.calls, ['verify', 'load', 'capture', 'verify']);
  });
  await test('missing grant, mismatched consumption and bad source refuse before capture', async () => {
    const f = fixture();
    fs.unlinkSync(f.pilot.grant);
    await assert.rejects(execute(f.args));
    assert.deepEqual(f.calls, []);
    put(f.pilot.grant, f.grant);
    const c = snapshot(f.pilot.consumption).value;
    c.grantSha256 = 'bad';
    put(f.pilot.consumption, c);
    await assert.rejects(execute(f.args), /Consumption/);
    assert.deepEqual(f.calls, []);
    c.grantSha256 = snapshot(f.pilot.grant).sha256;
    put(f.pilot.consumption, c);
    put(path.join(f.pilot.evidence, 'prelaunch-source.json'), { ...f.source, clean: false });
    await assert.rejects(execute(f.args), /Clean prelaunch/);
    assert.deepEqual(f.calls, []);
  });
  await test('bound source verifier failure precedes loader', async () => {
    const f = fixture();
    await assert.rejects(
      execute({
        ...f.args,
        verify: () => {
          throw Error('source bytes changed');
        },
      }),
      /source bytes/,
    );
    assert.deepEqual(f.calls, []);
  });
  await test('exact PNG/perf cap edges and partial attempted writer charged', async () => {
    const f = fixture();
    fs.mkdirSync(path.join(f.pilot.output, 'gravitic_pull'));
    const records = [],
      written = [];
    const writer = (_p, bytes) => written.push(bytes.length);
    writeOutput(f.pilot.output, records, path.join(f.pilot.output, outputPlan()[0]), Buffer.alloc(16 * 1024 ** 2), writer);
    assert.throws(() => writeOutput(f.pilot.output, records, path.join(f.pilot.output, outputPlan()[1]), Buffer.alloc(16 * 1024 ** 2 + 1), writer), /cap/);
    assert.equal(records.length, 1);
    for (let i = 1; i < 10; i++) writeOutput(f.pilot.output, records, path.join(f.pilot.output, outputPlan()[i]), 'x', writer);
    assert.throws(() => writeOutput(f.pilot.output, records, path.join(f.pilot.output, outputPlan()[10]), Buffer.alloc(16385), writer), /cap/);
    writeOutput(f.pilot.output, records, path.join(f.pilot.output, outputPlan()[10]), Buffer.alloc(16384), writer);
    assert.throws(
      () =>
        writeOutput(f.pilot.output, records, path.join(f.pilot.output, outputPlan()[11]), 'partial', () => {
          throw Error('late write');
        }),
      /late write/,
    );
    assert.equal(records.length, 12);
    assert.equal(records[11].completed, false);
    assert.equal(records[11].bytes, 7);
    const full = [],
      png = Buffer.alloc(16 * 1024 ** 2),
      perf = Buffer.alloc(16384);
    for (const name of outputPlan()) writeOutput(f.pilot.output, full, path.join(f.pilot.output, name), name.endsWith('perf.json') ? perf : png, writer);
    assert.equal(
      full.reduce((sum, row) => sum + row.bytes, 0),
      184565760,
    );
  });
  await test('late final receipt failure then packet fallback; no stale accepted true', async () => {
    const f = fixture();
    const result = await execute({
      ...f.args,
      metadataWriter: (p, data, opts) => {
        originalWrite(p, data, opts);
        if (path.basename(p) === 'entry.json') throw Error('late close');
      },
    });
    assert.equal(result.accepted, false);
    assert.equal(result.checksPassed, false);
    assert.equal(snapshot(path.join(f.pilot.evidence, 'entry.json')).value.accepted, false);
    assert.equal(snapshot(path.join(f.pilot.output, 'failed-entry.json')).value.checksPassed, false);
  });
  await test('all sinks failed retains primary + secondary errors and unknown partial fields', async () => {
    const f = fixture();
    const result = await execute({
      ...f.args,
      metadataWriter: () => {
        const e = Error('write');
        e.unknown = { live: null, bytes: Buffer.from('partial') };
        throw e;
      },
      stderr: () => {
        throw Error('stderr');
      },
    });
    assert.equal(result.accepted, false);
    assert.equal(result.errors.length, 4);
    assert.deepEqual(result.errors[0].error.unknown.live, null);
    assert.equal(result.errors[0].error.unknown.bytes.base64, Buffer.from('partial').toString('base64'));
    assert.deepEqual(f.calls, ['verify']);
  });
  await test('actual scratch replacement retains hash and semantics from same bytes', async () => {
    const file = path.join(root, 'race.json'),
      replace = path.join(root, 'replacement.json');
    put(file, { checksPassed: false });
    const expected = snapshot(file).sha256;
    put(replace, { checksPassed: true });
    const saved = fs.readSync;
    let replaced = false,
      bytes = 0;
    try {
      fs.readSync = (...args) => {
        const count = saved(...args);
        bytes += count;
        if (!replaced) {
          fs.renameSync(replace, file);
          replaced = true;
        }
        return count;
      };
      const value = snapshot(file);
      assert.equal(value.sha256, expected);
      assert.equal(value.value.checksPassed, false);
    } finally {
      fs.readSync = saved;
    }
    assert.ok(bytes < 2097153);
    assert.equal(snapshot(file).value.checksPassed, true);
  });
  await test('8 MiB JSON rejected before reading any bytes', async () => {
    const file = path.join(root, 'oversized.json');
    const fd = fs.openSync(file, 'wx');
    fs.ftruncateSync(fd, 8 * 1024 ** 2);
    fs.closeSync(fd);
    const saved = fs.readSync;
    let bytes = 0;
    try {
      fs.readSync = (...args) => {
        const n = saved(...args);
        bytes += n;
        return n;
      };
      assert.throws(() => snapshot(file), /type\/size cap/);
    } finally {
      fs.readSync = saved;
    }
    assert.equal(bytes, 0);
  });
  process.stdout.write(JSON.stringify({ passed, workers: 1, nativeLaunches: 0, grantCreated: 'inert scratch fixtures only' }) + '\n');
} finally {
  fs.rmSync(root, { recursive: true });
  delete process.env.EFFECTS_AUTHORIZATION;
  delete process.env.EFFECTS_READY_SHA256;
}
