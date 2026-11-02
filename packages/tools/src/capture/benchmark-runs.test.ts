import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FROZEN_SOURCES, freezeInstrumentation, runComparisons } from './benchmark-runs.ts';

describe('review benchmark: repeated comparison', () => {
  it('awaits five runs on each side in alternating order, keeping the caller sessions unchanged', async () => {
    const sessions = ['baseline', 'candidate'];
    const events: string[] = [];
    await runComparisons(sessions, async ({ session, run }) => {
      events.push(`start:${run}:${session}`);
      await Promise.resolve();
      events.push(`finish:${run}:${session}`);
    });
    const expected = [
      '1:baseline',
      '1:candidate',
      '2:candidate',
      '2:baseline',
      '3:baseline',
      '3:candidate',
      '4:candidate',
      '4:baseline',
      '5:baseline',
      '5:candidate',
    ];
    expect(events).toEqual(expected.flatMap((attempt) => [`start:${attempt}`, `finish:${attempt}`]));
    expect(sessions).toEqual(['baseline', 'candidate']);
  });

  it('performs five single-tree runs when no comparison tree was supplied', async () => {
    const runs: number[] = [];
    await runComparisons(['current'], async ({ run }) => {
      runs.push(run);
    });
    expect(runs).toEqual([1, 2, 3, 4, 5]);
  });

  it('preserves completed and failed attempt evidence without silently retrying or advancing past failure', async () => {
    const evidence: { session: string; run: number; outcome: string }[] = [];
    await expect(
      runComparisons(['baseline', 'candidate'], async ({ session, run }) => {
        const failed = run === 2 && session === 'candidate';
        evidence.push({ session, run, outcome: failed ? 'failed' : 'complete' });
        if (failed) throw new Error('Measurement interrupted');
      }),
    ).rejects.toThrow('Measurement interrupted');
    expect(evidence).toEqual([
      { session: 'baseline', run: 1, outcome: 'complete' },
      { session: 'candidate', run: 1, outcome: 'complete' },
      { session: 'candidate', run: 2, outcome: 'failed' },
    ]);
  });
});

describe('review benchmark: frozen instrumentation', () => {
  const folders: string[] = [];
  function tree() {
    const root = mkdtempSync(join(tmpdir(), 'review-instrumentation-'));
    folders.push(root);
    for (const path of FROZEN_SOURCES) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), `original:${path}`);
    }
    return root;
  }
  afterEach(() => {
    for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('accepts identical instrumentation while allowing the renderer implementation to differ', () => {
    const baseline = tree();
    const candidate = tree();
    for (const [root, content] of [
      [baseline, 'old'],
      [candidate, 'new'],
    ]) {
      mkdirSync(join(root, 'packages/client/src/core'), { recursive: true });
      writeFileSync(join(root, 'packages/client/src/core/Engine.js'), content);
    }
    const frozen = freezeInstrumentation([baseline, candidate]);
    expect(frozen.trees).toHaveLength(2);
    expect(() => frozen.verify()).not.toThrow();
  });

  it.each(FROZEN_SOURCES)('rejects a baseline/candidate mismatch in %s', (path) => {
    const baseline = tree();
    const candidate = tree();
    writeFileSync(join(candidate, path), 'changed');
    expect(() => freezeInstrumentation([baseline, candidate])).toThrow(`Comparison instrumentation differs: ${path}`);
  });

  it('rejects a missing source instead of treating two missing files as equal', () => {
    const baseline = tree();
    const candidate = tree();
    rmSync(join(candidate, 'pnpm-lock.yaml'));
    expect(() => freezeInstrumentation([baseline, candidate])).toThrow();
  });

  it('detects changes after the initial freeze, including changes applied equally to both trees', () => {
    const baseline = tree();
    const candidate = tree();
    const frozen = freezeInstrumentation([baseline, candidate]);
    writeFileSync(join(baseline, 'pnpm-lock.yaml'), 'new dependencies');
    writeFileSync(join(candidate, 'pnpm-lock.yaml'), 'new dependencies');
    expect(() => frozen.verify()).toThrow('Frozen instrumentation changed during the run');
  });
});
