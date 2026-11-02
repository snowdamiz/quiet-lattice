import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nativeWorkClassBudget,
  nativeWorkClassCancellationDrainMs,
  nativeWorkClassOuterDeadlineMs,
  nativeWorkClassTerminalEnvelopeMs,
  withNativeWorkClassDeadline,
} from './native-work-class-budget.ts';
import { runOwnedHelper, type CommandRecord } from './native-trace.ts';
const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe('work-class aggregate outer cancellation envelope', () => {
  it('sums all existing sequential phases and conservatively reserves cleanup without changing inner limits', () => {
    const drain = 3000 + 2000 + 2000 + 2000;
    expect(nativeWorkClassBudget).toEqual({
      discoveryMs: 4 * (10_000 + drain),
      provenanceMs: 2 * (5000 + drain),
      initialHostMs: 1000 + drain,
      serverStartupMs: 30_000 + drain,
      browserStartupMs: 30_000 + 30_000 + 10_000 + 10_000,
      reviewPreparationMs: 240_000 + 120_000 + 90_000,
      initialGpuIdentityMs: 10_000 + 1000 + drain,
      nativeMs: 100 + 15_000 + 10_000 + 25_000 + 10_000 + 25_000 + 60_000 + 4 * drain,
      cleanupMs: 5000 + 30_000 + 30_000 + 10_000 + 30_000 + 2 * (1000 + drain),
    });
    expect(nativeWorkClassOuterDeadlineMs).toBe(1_009_100);
    expect(nativeWorkClassCancellationDrainMs).toBe(306_100);
    expect(nativeWorkClassTerminalEnvelopeMs).toBe(1_315_200);
  });
  it('leaves a completed operation immutable with no late deadline callback', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = await withNativeWorkClassDeadline(async (s) => {
      signal = s;
      return { complete: true };
    }, 10);
    await vi.advanceTimersByTimeAsync(100);
    expect(signal?.aborted).toBe(false);
    expect(result).toEqual({ complete: true });
  });
  it('never resolves or rejects while the cancelled owned helper/real descendant is draining, and retains failed terminal evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-class-outer-cpu-'));
    dirs.push(dir);
    const records: CommandRecord[] = [];
    let returned = false;
    let serialized = false;
    let captured: AbortSignal | undefined;
    const promise = withNativeWorkClassDeadline(async (signal) => {
      captured = signal;
      try {
        await runOwnedHelper(
          process.execPath,
          [
            '-e',
            `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);process.on('SIGINT',()=>setTimeout(()=>process.exit(0),100));setInterval(()=>{},1000);`,
          ],
          records,
          { deadlineMs: 1000, signal },
        );
      } finally {
        expect(returned).toBe(false);
        expect(records).toHaveLength(1);
        expect(records[0].finishedAt).not.toBeNull();
        expect(records[0].groupState).toBe('absent');
        writeFileSync(join(dir, 'terminal.json'), JSON.stringify({ failed: signal.aborted, records }));
        serialized = true;
      }
    }, 150).finally(() => {
      returned = true;
    });
    const handled = promise.catch(() => {});
    await handled;
    await expect(promise).rejects.toThrow('outer deadline');
    expect(serialized).toBe(true);
    expect(captured?.aborted).toBe(true);
    const persisted = JSON.parse(readFileSync(join(dir, 'terminal.json'), 'utf8'));
    expect(persisted.failed).toBe(true);
    expect(persisted.records[0]).toMatchObject({ groupState: 'absent', finishedAt: expect.any(String), failure: expect.stringContaining('outer deadline') });
    for (const r of records) {
      expect(() => process.kill(-r.group!, 0)).toThrow();
      expect(() => process.kill(r.pid!, 0)).toThrow();
    }
    const child = Number(records[0].stdout.trim());
    expect(child).toBeGreaterThan(1);
    expect(() => process.kill(child, 0)).toThrow();
    const frozen = readFileSync(join(dir, 'terminal.json'), 'utf8');
    await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(join(dir, 'terminal.json'), 'utf8')).toBe(frozen);
  });
  it('does not promote timed-out work that catches cancellation and returns success', async () => {
    await expect(
      withNativeWorkClassDeadline(async (signal) => {
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        return 'false-success';
      }, 5),
    ).rejects.toThrow('outer deadline');
  });
});
