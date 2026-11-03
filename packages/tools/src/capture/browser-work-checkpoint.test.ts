import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { retainBrowserCheckpoint } from './browser-work-probe.ts';

const directories: string[] = [];
function fresh() {
  const directory = mkdtempSync(join(tmpdir(), 't13-checkpoint-cpu-'));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('actual bounded evidence checkpoint files', () => {
  it('publishes returned facts atomically and exclusively without treating them as final acceptance', () => {
    const out = fresh(),
      value = { finalAcceptance: 'NOT_EVALUATED', traceSettlement: 'error-returned', failure: 'PRIMARY', evidence: { status: 'failed' } },
      path = join(out, 'returned-trace-evidence.json');
    retainBrowserCheckpoint(out, 'returned-trace-evidence', value);
    const first = readFileSync(path);
    expect(JSON.parse(first.toString())).toEqual(value);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(path + '.writing')).toBe(false);
    expect(() => retainBrowserCheckpoint(out, 'returned-trace-evidence', { later: true })).toThrow('EEXIST');
    expect(readFileSync(path)).toEqual(first);
  });
  it('retains the explicitly not-returned snapshot without inventing missing evidence', () => {
    const out = fresh(),
      value = { traceSettlement: 'not-returned', evidence: null, host: [{ load: [1, 2, 3] }], counts: [] };
    retainBrowserCheckpoint(out, 'before-browser-teardown', value);
    expect(JSON.parse(readFileSync(join(out, 'before-browser-teardown.json'), 'utf8'))).toEqual(value);
  });
  it('reports actual filesystem refusal instead of silently claiming persistence', () => {
    const out = fresh();
    chmodSync(out, 0o500);
    expect(() => retainBrowserCheckpoint(out, 'returned-trace-evidence', { evidence: 'CPU_ONLY' })).toThrow('EACCES');
    expect(existsSync(join(out, 'returned-trace-evidence.json'))).toBe(false);
  });
  it('keeps bounded prefix and complete hash when a returned evidence snapshot overflows', () => {
    const out = fresh(),
      cap = 64 * 1024 * 1024,
      path = join(out, 'returned-trace-evidence.json');
    expect(() => retainBrowserCheckpoint(out, 'returned-trace-evidence', { evidence: 'x'.repeat(cap) })).toThrow('overflow');
    expect(existsSync(path)).toBe(false);
    expect(statSync(path + '.prefix').size).toBe(cap);
    expect(JSON.parse(readFileSync(path + '.overflow.json', 'utf8'))).toMatchObject({
      retainedBytes: cap,
      complete: false,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
