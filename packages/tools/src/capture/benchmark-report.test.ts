import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { benchmarkReport, inspectRun, runRange } from './benchmark-report.ts';

function run(light = 'noon-lush', shownGpu = 12) {
  return {
    case: light,
    lod: 0,
    viewport: [1920, 1080],
    failure: null,
    gpuTiming: 'EXT_disjoint_timer_query_webgl2 (GPU time of the frame)',
    device: { renderer: 'Synthetic unit-test fixture', contextLost: false },
    settle: { frames: 30, stable: true, underBudget: true },
    glErrors: { before: [], after: [] },
    scene: { disjoint: 0, gpuMsP95: 1 },
    asset: { gpuMs: 0.05, cpuMs: 0.1, reliable: true },
    samples: Array.from({ length: 240 }, (_, i) => {
      const shown = i % 4 === 0 || i % 4 === 3;
      return { shown, gpu: shown ? shownGpu : 10, cpu: shown ? 3 : 2, calls: shown ? 15 : 10, tris: shown ? 1000 : 800, gpuStatus: 'timer' };
    }),
  };
}

describe('review benchmark: aggregation', () => {
  const folders: string[] = [];
  function directory(gpu = 12) {
    const root = mkdtempSync(join(tmpdir(), 'review-report-'));
    folders.push(root);
    const save = (name: string, value: unknown) => writeFileSync(join(root, name), JSON.stringify(value));
    save('context.json', { mode: 'measure', sourceTrees: [{ label: 'current' }], assetSha256: 'fixture' });
    save('status.json', { errors: [], pageErrors: [{ label: 'current', errors: [] }] });
    save('host-samples.json', [{ phase: 'synthetic fixture' }]);
    for (const light of ['noon-lush', 'night-exotic', 'open-space']) {
      for (let i = 1; i <= 5; i++) save(`current-${light}-${i}.json`, run(light, gpu));
    }
    return { root, save };
  }
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('reports median and full range without hiding missing runs', () => {
    expect(runRange([7, 1, null, 5, 3])).toEqual({ n: 4, missing: 1, median: 4, min: 1, max: 7 });
    expect(runRange([null])).toEqual({ n: 0, missing: 1, median: null, min: null, max: null });
  });

  it('recomputes frame statistics from raw work instead of trusting a saved summary', () => {
    const result = inspectRun(run('noon-lush', 25), 'noon-lush');
    expect(result.scene.gpuMsP95).toBe(25);
    expect(result.scene.drawCalls).toBe(15);
    expect(result.hidden.drawCalls).toBe(10);
    expect(result.issues).toEqual([]);
  });

  it('keeps full scene and hidden scene separate from a cheap asset delta', () => {
    const { root } = directory(25);
    const report = benchmarkReport(root);
    expect(report.groups).toHaveLength(3);
    for (const group of report.groups) {
      expect(group.budgetObservation).toBe('exceeds');
      expect(group.scene.gpuMsP95).toMatchObject({ n: 5, median: 25, min: 25, max: 25 });
      expect(group.hidden.gpuMsP95.median).toBe(10);
      expect(group.pairedAssetGpuMs.median).toBe(0.05);
    }
  });

  it('reports a budget observation without declaring the task passed', () => {
    const { root, save } = directory();
    save('current-noon-lush-5.json', run('noon-lush', 16));
    const report = benchmarkReport(root);
    expect(report.groups[0]).toMatchObject({ budgetObservation: 'within', scene: { gpuMsP95: { n: 5, median: 12, min: 12, max: 16 } } });
    expect(report.taskVerdict).toContain('Pending separate limiter evidence');
  });

  it('preserves failed/missing runs and source hashes rather than selecting only passing captures', () => {
    const { root, save } = directory();
    save('current-noon-lush-2.json', { failed: true, error: 'Capture interrupted', partial: { samples: [] } });
    const failureBefore = readFileSync(join(root, 'current-noon-lush-2.json'));
    rmSync(join(root, 'current-noon-lush-4.json'));
    const group = benchmarkReport(root).groups[0];
    expect(group.budgetObservation).toBe('inconclusive');
    expect(group.scene.gpuMsP95).toMatchObject({ n: 3, missing: 2 });
    expect(group.runs).toHaveLength(5);
    expect(group.runs[1].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(group.runs[3].sha256).toBeNull();
    expect(readFileSync(join(root, 'current-noon-lush-2.json'))).toEqual(failureBefore);
  });

  it('makes page errors and missing competing-load evidence inconclusive', () => {
    const { root, save } = directory();
    save('status.json', { errors: [], pageErrors: [{ label: 'current', errors: ['WebGL warning promoted to error'] }] });
    save('host-samples.json', []);
    const report = benchmarkReport(root);
    expect(report.globalIssues).toHaveLength(2);
    expect(report.groups.every((group) => group.budgetObservation === 'inconclusive')).toBe(true);
  });

  it('rejects profiling sessions as a source of budget evidence', () => {
    const { root, save } = directory();
    save('context.json', { mode: 'profile' });
    expect(() => benchmarkReport(root)).toThrow('Diagnostic profiles cannot be aggregated');
  });

  it('flags invalid raw samples, unstable warmup, disjoint timers and absent asset work', () => {
    const fixture = run();
    fixture.settle.stable = false;
    fixture.scene.disjoint = 1;
    fixture.samples[0].gpuStatus = 'disjoint';
    fixture.samples[0].shown = false;
    for (const sample of fixture.samples) {
      sample.calls = 10;
      sample.tris = 800;
    }
    const result = inspectRun(fixture, 'noon-lush');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Warm-up did not stabilize',
        '1 disjoint events',
        'Shown/hidden order is not ABBA',
        'Missing, invalidated, or fallback GPU samples',
        'The shown asset did not add measured draw and triangle work',
      ]),
    );
  });
});
