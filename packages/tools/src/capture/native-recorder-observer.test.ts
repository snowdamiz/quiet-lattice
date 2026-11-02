import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recorderObserver, RECORDER_OBSERVATION_LIMITS as limits } from './native-recorder-observer.ts';

const folders: string[] = [];
const observers: ReturnType<typeof recorderObserver>[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'native-recorder-observer-'));
  folders.push(root);
  const trace = join(root, 'owned.trace');
  const observation = recorderObserver(trace);
  observers.push(observation);
  return { root, trace, observation };
}
afterEach(() => {
  for (const o of observers.splice(0)) o.stop();
  vi.useRealTimers();
  for (const p of folders.splice(0)) rmSync(p, { recursive: true, force: true });
});
describe('bounded native-recorder-only observations (CPU/files only)', () => {
  it('observes existing owned-path growth at1Hz and drains without post-stop mutation', async () => {
    vi.useFakeTimers();
    const { trace, observation: o } = fixture();
    o.start();
    expect(o.log.samples[0].status).toBe('missing');
    mkdirSync(trace);
    writeFileSync(join(trace, 'data'), 'one');
    await vi.advanceTimersByTimeAsync(1000);
    expect(o.log.samples.at(-1)?.files).toMatchObject([{ path: 'data', bytes: 3, mtimeMs: expect.any(Number) }]);
    writeFileSync(join(trace, 'data'), 'longer');
    await vi.advanceTimersByTimeAsync(1000);
    expect(o.log.samples.at(-1)?.files[0].bytes).toBe(6);
    o.output('stdout', Buffer.from('Stopping recording...\n'));
    o.output('stderr', Buffer.from('retained stderr\n'));
    o.stopRequested(true, null);
    o.exited(0, null);
    o.stop();
    expect(o.log.output.map((x) => x.stream)).toEqual(['stdout', 'stderr']);
    expect(o.log.requestedStop?.requested).toBe(true);
    expect(o.log.exit?.code).toBe(0);
    const frozen = JSON.stringify(o.log);
    await vi.advanceTimersByTimeAsync(5000);
    o.sample();
    o.output('stdout', Buffer.from('late'));
    o.exited(7, null);
    o.stopRequested(true, null);
    o.stop();
    expect(JSON.stringify(o.log)).toBe(frozen);
  });
  it('retains root/type failure and does not follow a symlink out of the owned trace', () => {
    const { root, trace, observation: o } = fixture();
    writeFileSync(trace, 'not a directory');
    o.start();
    expect(o.log.incomplete).toBe(true);
    expect(o.log.samples[0]).toMatchObject({ status: 'failed', errors: [expect.stringContaining('not a real directory')] });
    o.stop();
    rmSync(trace);
    mkdirSync(trace);
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'must-not-read'), 'private');
    symlinkSync(outside, join(trace, 'link'), 'dir');
    const safe = recorderObserver(trace);
    observers.push(safe);
    safe.start();
    expect(safe.log.samples[0].skippedSymlinks).toBe(1);
    expect(safe.log.samples[0].files).toEqual([]);
  });
  it('bounds file entries,depth and sample retention with explicit incompleteness', async () => {
    vi.useFakeTimers();
    const { trace, observation: o } = fixture();
    mkdirSync(trace);
    for (let i = 0; i < limits.entries + 3; i++) writeFileSync(join(trace, 'f' + i), 'x');
    o.start();
    expect(o.log.samples[0].entries).toBe(limits.entries);
    expect(o.log.samples[0].limits.entries).toBe(true);
    await vi.advanceTimersByTimeAsync((limits.samples + 3) * 1000);
    expect(o.log.samples).toHaveLength(limits.samples);
    expect(o.log.droppedSamples).toBeGreaterThan(0);
    expect(o.log.incomplete).toBe(true);
    o.stop();
    const deep = join(trace, 'nested');
    mkdirSync(join(deep, 'a', 'b', 'c', 'd', 'e'), { recursive: true });
    const d = recorderObserver(deep);
    observers.push(d);
    d.start();
    expect(d.log.samples[0].limits.depth).toBe(true);
  });
  it('bounds output chunks/characters and preserves request/exit milestones through overflow', () => {
    const { observation: o } = fixture();
    o.start();
    for (let i = 0; i < limits.outputEvents + 2; i++) o.output('stdout', Buffer.from('line\n'));
    expect(o.log.output).toHaveLength(limits.outputEvents);
    expect(o.log.droppedOutputEvents).toBe(2);
    o.stopRequested(true, null);
    o.exited(0, null);
    expect(o.log.requestedStop).not.toBeNull();
    expect(o.log.exit).not.toBeNull();
    o.stop();
    const large = recorderObserver('/absent-owned-test-trace');
    observers.push(large);
    large.start();
    large.output('stderr', Buffer.alloc(limits.outputCharacters + 10, 65));
    expect(large.log.output[0].text).toHaveLength(limits.outputCharacters);
    expect(large.log.droppedOutputCharacters).toBe(10);
    large.output('stderr', Buffer.from('next'));
    expect(large.log.droppedOutputEvents).toBe(1);
    expect(large.log.droppedOutputCharacters).toBe(14);
    expect(large.log.incomplete).toBe(true);
  });
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('bounds actual permission errors and closes every observed directory', () => {
    const { trace, observation: o } = fixture();
    mkdirSync(trace);
    const blocked = [];
    for (let i = 0; i < limits.errors + 3; i++) {
      const p = join(trace, 'blocked' + i);
      mkdirSync(p);
      blocked.push(p);
      chmodSync(p, 0);
    }
    try {
      o.start();
      expect(o.log.samples[0].errors).toHaveLength(limits.errors);
      expect(o.log.samples[0].limits.errors).toBe(true);
      expect(o.log.incomplete).toBe(true);
      o.stop();
    } finally {
      for (const p of blocked) chmodSync(p, 0o700);
    }
  });
});
