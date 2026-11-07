import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { URL } from 'node:url';
import { runEntryStage, writeJson } from '../entry.mjs';

const native = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  cp[name] = () => {
    native.push(name);
    throw Error('Native execution forbidden');
  };
}
syncBuiltinESMExports();
const [fixture, report] = process.argv.slice(2);
const ready = JSON.parse(fs.readFileSync(new URL('../readiness.json', import.meta.url)));
const stage = ready.stages.find((value) => value.kind === 'stills');
const source = path.join(fixture, 'captures', stage.id);
const previous = JSON.parse(fs.readFileSync(path.join(source, 'entry-result.json')));
const rows = [];
for (const target of ['entry-result.json', 'sequence-index.json', 'artifact-index.json']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't02-publication-'));
  const packet = path.join(root, 'packet');
  fs.mkdirSync(packet);
  fs.mkdirSync(path.join(packet, 'captures'));
  const output = path.join(packet, 'captures', stage.id);
  let injected = false;
  const runtime = {
    async start() {
      return {
        observation: { installed: true },
        backend: async () => previous.backend,
        frame: async (work) => {
          const stem = String(work.ordinal).padStart(4, '0');
          return {
            ...JSON.parse(fs.readFileSync(path.join(source, 'observations', stem + '.json'))),
            dataUrl: 'data:image/png;base64,' + fs.readFileSync(path.join(source, 'images', stem + '.png')).toString('base64'),
          };
        },
      };
    },
    async cleanup() {
      return { released: true };
    },
  };
  const result = await runEntryStage({
    ready: { ...ready, packetRoot: packet },
    stage,
    output,
    runtime,
    writer(file, value) {
      writeJson(file, value);
      if (!injected && path.basename(file) === target) {
        injected = true;
        throw Error('CLOSE_ERROR_AFTER_BYTES');
      }
    },
  });
  assert(injected);
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'HOLD');
  assert.equal(result.completed.length, 8);
  assert(result.persistenceFailures.some((failure) => failure.message === 'CLOSE_ERROR_AFTER_BYTES'));
  // This is entry.mjs's actual exit decision; the Python control feeds exit 1 into the real dispatcher.
  const exitCode = result.accepted ? 0 : 1;
  assert.equal(exitCode, 1);
  const disk = JSON.parse(fs.readFileSync(path.join(output, 'entry-result.json')));
  fs.writeFileSync(path.join(root, 'returned-result-observer.json'), JSON.stringify(result, null, 2) + '\n');
  rows.push({ target, root, exitCode, returnedAccepted: result.accepted, diskAcceptedSnapshot: disk.accepted, snapshotIsNotDispatcherAuthority: true });
}
assert.deepEqual(native, []);
fs.writeFileSync(report, JSON.stringify({ status: 'PASS_AFTER_BYTES_ENTRY_EXIT', controls: rows, nativeCalls: 0 }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status: 'PASS', controls: rows.length, nativeCalls: 0 }) + '\n');
