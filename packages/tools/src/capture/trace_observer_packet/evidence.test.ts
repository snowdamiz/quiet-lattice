import { mkdtempSync, writeFileSync, renameSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { EvidenceStore, publish, readSnapshot, sha256 } from './evidence.ts';
import { workerAdmission } from './worker.ts';
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 't13-metadata-cpu-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
it.each(['FIFO', 'symlink', 'replacement', 'growth'])('refuses real metadata %s replacement before bounded reads', (fault) => {
  const root = fixture(),
    path = join(root, 'grant.json'),
    raw = Buffer.from('{"unknown":{"future":true}}');
  writeFileSync(path, raw);
  expect(() =>
    readSnapshot(path, sha256(raw), raw.length, () => {
      renameSync(path, path + '.saved');
      if (fault === 'FIFO') execFileSync('/usr/bin/mkfifo', [path]);
      else if (fault === 'symlink') symlinkSync(path + '.saved', path);
      else writeFileSync(path, fault === 'growth' ? Buffer.concat([raw, Buffer.from(' ')]) : raw);
    }),
  ).toThrow();
});
it('authenticates and parses one exact bounded snapshot', () => {
  const root = fixture(),
    path = join(root, 'result.json'),
    raw = Buffer.from('{"unknown":[1,null]}');
  writeFileSync(path, raw);
  const snapshot = readSnapshot(path, sha256(raw), raw.length);
  writeFileSync(path, '{}');
  expect(snapshot.value).toEqual({ unknown: [1, null] });
  expect(snapshot.raw).toEqual(raw);
  expect(() => readSnapshot(path, '0'.repeat(64))).toThrow('digest');
  expect(() => readSnapshot(path, undefined, 1)).toThrow('size');
});
it('disabled worker admission refuses before native imports/acquisition or grant access', () => {
  const path = join(fixture(), 'readiness.json'),
    raw = Buffer.from('{"runtimeAuthorized":false}');
  writeFileSync(path, raw);
  expect(() => workerAdmission(['--owned', path, sha256(raw)])).toThrow('disabled');
  expect(() => workerAdmission(['--run'])).toThrow('Disabled');
});
it('preserves raw facts on real exclusive publication failure with a bounded fallback', () => {
  const root = fixture(),
    collision = join(root, 'raw.json');
  writeFileSync(collision, 'original');
  const store = new EvidenceStore([root], publish);
  expect(() => store.put('raw.json', { unknown: [null, { future: true }] })).toThrow();
  expect(readFileSync(collision, 'utf8')).toBe('original');
  expect(store.receipt().undurable['raw.json']).toBe(store.raw.get('raw.json')?.toString('base64'));
  expect(readFileSync(collision + '.writing', 'utf8')).toContain('future');
});

it('returns a detached evidence receipt despite later sink failures', () => {
  const store = new EvidenceStore(['/inert'], () => {
    throw new Error('sink failure');
  });
  expect(() => store.put('first.json', { unknown: true })).toThrow();
  const receipt = store.receipt(),
    saved = JSON.stringify(receipt);
  expect(() => store.put('late.json', { late: true })).toThrow();
  expect(JSON.stringify(receipt)).toBe(saved);
});
