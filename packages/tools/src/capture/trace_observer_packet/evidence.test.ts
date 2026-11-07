import { mkdtempSync, writeFileSync, renameSync, rmSync, symlinkSync, readFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { EvidenceStore, failureSnapshot, publish, readBytes, readSnapshot, sha256 } from './evidence.ts';
import { workerAdmission } from './worker.ts';
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});
const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 't13-metadata-cpu-')));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.mocked(childProcess.spawnSync).mockReset();
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

it.each(['preexisting', 'after-admission'])('rejects a real ancestor link %s without admitting the unchanged leaf', (when) => {
  const root = fixture();
  const parent = join(root, 'parent');
  mkdirSync(parent);
  const path = join(parent, 'readiness.json');
  const raw = Buffer.from('{"unchanged":true}');
  writeFileSync(path, raw);
  const replace = () => {
    renameSync(parent, parent + '.saved');
    symlinkSync(parent + '.saved', parent);
  };
  if (when === 'preexisting') replace();
  expect(() => readSnapshot(path, sha256(raw), raw.length, when === 'after-admission' ? replace : undefined)).toThrow();
  expect(readFileSync(join(parent + '.saved', 'readiness.json'))).toEqual(raw);
});

it('uses one descriptor bridge for a default raw read and returns detached bytes', () => {
  const path = join(fixture(), 'raw.bin');
  const raw = Buffer.from([255, 0, 254]);
  writeFileSync(path, raw);
  const spawn = vi.mocked(childProcess.spawnSync);
  try {
    const snapshot = readBytes(path, sha256(raw), raw.length);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toBe('/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14');
    expect(spawn.mock.calls[0][2]).toMatchObject({ timeout: 15000, killSignal: 'SIGKILL' });
    writeFileSync(path, Buffer.from([0, 0, 0]));
    expect(snapshot.raw).toEqual(raw);
  } finally {
    spawn.mockReset();
  }
});

it.each(['preexisting', 'before-bridge'])('refuses publication through an ancestor link %s without writing to its target', async (when) => {
  const root = fixture();
  const parent = join(root, 'parent');
  mkdirSync(parent);
  const replace = () => {
    renameSync(parent, parent + '.saved');
    symlinkSync(parent + '.saved', parent);
  };
  const { spawnSync: realSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  if (when === 'preexisting') replace();
  const spawn = vi.mocked(childProcess.spawnSync).mockImplementation((...args) => {
    if (when === 'before-bridge') replace();
    return realSpawn(...args);
  });
  const store = new EvidenceStore([parent]);
  try {
    expect(() => store.put('result.json', { raw: true })).toThrow();
    expect(store.receipt().durable).toEqual({});
    expect(store.receipt().undurable['result.json']).toBeDefined();
    expect(existsSync(join(parent + '.saved', 'result.json'))).toBe(false);
    expect(existsSync(join(parent + '.saved', 'result.json.writing'))).toBe(false);
  } finally {
    spawn.mockReset();
  }
});

it('retains bounded, detached error bytes, cycles, and cause without executing accessors', () => {
  const error = Object.assign(new Error('primary', { cause: new Error('cause') }), { raw: Buffer.from([255, 0]), future: { nested: true } });
  // V8's lazy stack is an accessor; make this fixture's stacks data attributes.
  Object.defineProperty(error, 'stack', { value: 'primary stack' });
  if (error.cause instanceof Error) Object.defineProperty(error.cause, 'stack', { value: 'cause stack' });
  Object.defineProperty(error, 'cycle', { value: error });
  const result = failureSnapshot(error);
  const encoded = JSON.stringify(result);
  error.raw.fill(0);
  error.future.nested = false;
  expect(result.complete).toBe(true);
  expect(JSON.stringify(result)).toBe(encoded);
  expect(encoded).toContain('/wA=');
  expect(encoded).toContain('"reference":0');
  const access = vi.fn(() => {
    throw new Error('must not execute');
  });
  Object.defineProperty(error, 'accessor', { get: access });
  expect(failureSnapshot(error).complete).toBe(false);
  expect(access).not.toHaveBeenCalled();
  const oversized = failureSnapshot({ raw: Buffer.alloc(2 * 1024 * 1024), text: 'x'.repeat(1024 * 1024) });
  expect(oversized.complete).toBe(false);
  expect(JSON.stringify(oversized).length).toBeLessThan(300000);
});

it('closes every acquired Python descriptor after success, refusal, and an injected close error', () => {
  const root = fixture();
  const python = '/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14';
  const script = `
import sys, os, errno
sys.path.insert(0, sys.argv[1])
import metadata
root=sys.argv[2]
path=root+'/value.json'
with open(path,'wb') as stream: stream.write(b'{}')
opened=[]
real_open, real_close=os.open, os.close
def record(*args, **kwargs):
    fd=real_open(*args, **kwargs); opened.append(fd); return fd
os.open=record
def assert_closed():
    assert opened, 'No real descriptor acquisitions'
    for fd in opened:
        try: os.fstat(fd)
        except OSError as error: assert error.errno == errno.EBADF
        else: raise AssertionError('Descriptor survived: '+str(fd))
    opened.clear()
metadata.read_bytes(path,2); assert_closed()
try: metadata.read_bytes(path,1)
except Exception: pass
else: raise AssertionError('Oversize read accepted')
assert_closed()
metadata.atomic(root+'/new.json',b'{}'); assert_closed()
def close_then_fail(fd):
    real_close(fd)
    raise OSError('SECONDARY_REAL_CLOSE')
os.close=close_then_fail
for operation in [lambda:metadata.read_bytes(path,2),lambda:metadata.atomic(root+'/close.json',b'{}')]:
    try: operation()
    except Exception as error: assert 'SECONDARY_REAL_CLOSE' in str(metadata.failure(error))
    else: raise AssertionError('Close failure reported success')
    assert_closed()
`;
  expect(() => execFileSync(python, ['-I', '-B', '-c', script, new URL('.', import.meta.url).pathname, root], { timeout: 10000 })).not.toThrow();
});

it('kills and reaps a stalled CPU bridge without claiming its evidence durable', async () => {
  const { spawnSync: realSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  let child: ReturnType<typeof realSpawn> | undefined;
  vi.mocked(childProcess.spawnSync).mockImplementationOnce((file, _args, options) => {
    child = realSpawn(file, ['-I', '-B', '-c', 'import time; time.sleep(60)'], options);
    return child;
  });
  const store = new EvidenceStore([fixture()]);
  expect(() => store.put('stalled.json', { fact: true })).toThrow();
  expect(child?.signal).toBe('SIGKILL');
  expect(child?.status).toBeNull();
  expect(child?.pid).toBeGreaterThan(1);
  expect(() => {
    if (child) process.kill(child.pid, 0);
  }).toThrow();
  expect(store.receipt().durable).toEqual({});
  expect(store.receipt().undurable['stalled.json']).toBeDefined();
  expect(JSON.stringify(store.receipt().failures)).toContain('SIGKILL');
}, 30000);
