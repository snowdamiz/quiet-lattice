/* global process, Buffer, structuredClone */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { admit, execute, errorFacts, metadata } from './entry.mjs';

const here = import.meta.dirname;
const plan = JSON.parse(fs.readFileSync(path.join(here, 'inventory.json')));
for (const unit of plan.units)
  test(`disabled entry ${unit.id} refuses without allocation`, () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-disabled-'));
    try {
      const result = spawnSync(process.execPath, [path.join(here, 'entry.mjs')], { cwd: scratch, env: { VIEWMODEL_UNIT: unit.id }, timeout: 5000 });
      assert.equal(result.status, 1);
      assert.match(String(result.stderr), /entry disabled/);
      assert.deepEqual(fs.readdirSync(scratch), []);
    } finally {
      fs.rmSync(scratch, { recursive: true });
    }
  });
test('missing grant refuses enabled entry before imports', () => assert.throws(() => admit({}, true), /Missing consumed/));
test('primary, secondary, byte and unknown observations survive all sinks', async () => {
  const error = new Error('capture failed');
  error.stdout = Buffer.from([0, 255]);
  error.unknown = { original: true };
  const events = [];
  const result = await execute(
    {},
    {
      capture: async (_context, record, cleanups) => {
        record.observations = { unknown: [7, null] };
        cleanups.push(() => {
          events.push('cleanup');
          throw new Error('cleanup failed');
        });
        throw error;
      },
      receipt: (name) => {
        events.push(name);
        throw new Error('sink failed');
      },
      emit: () => {
        throw new Error('stderr failed');
      },
    },
  );
  assert.equal(result.code, 1);
  assert.equal(result.durable, false);
  assert.equal(result.record.primaryFailure.message, 'capture failed');
  assert.equal(result.record.primaryFailure.stdout.base64, 'AP8=');
  assert.deepEqual(result.record.primaryFailure.unknown, { original: true });
  assert.deepEqual(result.record.observations, { unknown: [7, null] });
  assert.equal(result.record.secondaryFailures.length, 4);
  assert.deepEqual(events, ['cleanup', 'entry-result.json', 'entry-fallback.json']);
});
test('fallback survives first receipt failure, never claims success', async () => {
  let saved;
  const result = await execute(
    {},
    {
      capture: async () => {},
      receipt: (name, record) => {
        if (name === 'entry-result.json') throw new Error('close failed');
        saved = structuredClone(record);
      },
      emit: () => assert.fail('unexpected'),
    },
  );
  assert.equal(result.code, 1);
  assert.equal(result.durable, true);
  assert.equal(saved.accepted, false);
  assert.equal(saved.checksPassed, false);
});
test('successful process record remains provisional', async () => {
  let saved;
  const result = await execute(
    {},
    {
      capture: async () => {},
      receipt: (_name, record) => {
        saved = structuredClone(record);
      },
      emit: () => {},
    },
  );
  assert.equal(result.code, 0);
  assert.equal(saved.accepted, false);
});
test('bounded metadata type/oversize and authenticated bytes', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vm-metadata-')));
  try {
    const file = path.join(scratch, 'file');
    fs.writeFileSync(file, '{}');
    assert.deepEqual(metadata(file, undefined, 2).value, {});
    assert.throws(() => metadata(file, '0'.repeat(64), 2), /authentication/);
    fs.appendFileSync(file, ' ');
    assert.throws(() => metadata(file, undefined, 2), /cap\/type/);
    const link = path.join(scratch, 'link');
    fs.symlinkSync(file, link);
    assert.throws(() => metadata(link), /Noncanonical/);
  } finally {
    fs.rmSync(scratch, { recursive: true });
  }
});
test('error facts retain non-enumerable original cause', () => {
  const error = new Error('primary', { cause: new Error('original') });
  assert.equal(errorFacts(error).cause.message, 'original');
});

test('regular metadata replaced by actual FIFO refuses before read and closes descriptor', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vm-fifo-')));
  const file = path.join(scratch, 'grant.json');
  fs.writeFileSync(file, '{}');
  const open = fs.openSync;
  let descriptor;
  fs.openSync = (name, flags, ...args) => {
    if (name === file && descriptor === undefined) {
      fs.renameSync(file, file + '.original');
      const result = spawnSync('/usr/bin/mkfifo', [file], { timeout: 1000 });
      assert.equal(result.status, 0);
      assert.equal(flags & (fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK), fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      descriptor = open(name, flags, ...args);
      return descriptor;
    }
    return open(name, flags, ...args);
  };
  try {
    assert.throws(() => metadata(file), /Opened metadata cap\/type/);
    assert.throws(() => fs.fstatSync(descriptor), /EBADF/);
  } finally {
    fs.openSync = open;
    fs.rmSync(scratch, { recursive: true });
  }
});
