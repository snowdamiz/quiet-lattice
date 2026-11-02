import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { benchmarkReport, inspectRun, runRange } from './benchmark-report.ts';

function run(light = 'noon-lush', shownGpu = 12) {
  return {
    startedAt: '2026-11-02T01:00:00.000Z',
    finishedAt: '2026-11-02T01:00:10.000Z',
    samplingWindows: [{ startedAt: '2026-11-02T01:00:02.000Z', finishedAt: '2026-11-02T01:00:08.000Z', firstSample: 0, sampleCount: 240 }],
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

// Producer-shaped CPU test evidence; these counters are never measured performance claims.
function hostSample(phase = 'current:noon-lush:run-1', overrides: object = {}) {
  return {
    at: '2026-11-02T01:00:05.000Z',
    phase,
    load: [1, 1, 1],
    freeMemoryBytes: 1024,
    processes: '  PID PPID %CPU %MEM ELAPSED COMM\n  123 1 2.0 0.1 00:05 /synthetic/fixture\n',
    gpu: ['"PerformanceStatistics" = {"Device Utilization %"=10,"Renderer Utilization %"=8,"Tiler Utilization %"=5}'],
    ...overrides,
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
    save(
      'host-samples.json',
      ['noon-lush', 'night-exotic', 'open-space'].flatMap((light) => Array.from({ length: 5 }, (_, i) => hostSample(`current:${light}:run-${i + 1}`))),
    );
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
      expect(group.shownBudgetObservation).toBe('exceeds');
      expect(group.scene.gpuMsP95).toMatchObject({ n: 5, median: 25, min: 25, max: 25 });
      expect(group.hidden.gpuMsP95.median).toBe(10);
      expect(group.pairedAssetGpuMs.median).toBe(0.05);
    }
  });

  it('reports a budget observation without declaring the task passed', () => {
    const { root, save } = directory();
    save('current-noon-lush-5.json', run('noon-lush', 16));
    const report = benchmarkReport(root);
    expect(report.groups[0]).toMatchObject({ shownBudgetObservation: 'within', scene: { gpuMsP95: { n: 5, median: 12, min: 12, max: 16 } } });
    expect(report.taskVerdict).toContain('Pending separate limiter evidence');
  });

  it('preserves failed/missing runs and source hashes rather than selecting only passing captures', () => {
    const { root, save } = directory();
    save('current-noon-lush-2.json', { failed: true, error: 'Capture interrupted', partial: { samples: [] } });
    const failureBefore = readFileSync(join(root, 'current-noon-lush-2.json'));
    rmSync(join(root, 'current-noon-lush-4.json'));
    const group = benchmarkReport(root).groups[0];
    expect(group.shownBudgetObservation).toBe('inconclusive');
    expect(group.scene.gpuMsP95).toMatchObject({ n: 3, missing: 2 });
    expect(group.runs).toHaveLength(5);
    expect(group.runs[1].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(group.runs[1].readError).toBeNull();
    expect(group.runs[1].captureFailure).toEqual({ failed: true, error: 'Capture interrupted', partial: { samples: [] } });
    expect(group.runs[3].sha256).toBeNull();
    expect(readFileSync(join(root, 'current-noon-lush-2.json'))).toEqual(failureBefore);
  });

  it('makes page errors and missing competing-load evidence inconclusive', () => {
    const { root, save } = directory();
    save('status.json', { errors: [], pageErrors: [{ label: 'current', errors: ['WebGL warning promoted to error'] }] });
    save('host-samples.json', []);
    const report = benchmarkReport(root);
    expect(report.globalIssues).toHaveLength(2);
    expect(report.groups.every((group) => group.shownBudgetObservation === 'inconclusive')).toBe(true);
  });

  it('retains a startup collector failure and cannot mistake a nonempty error file for load evidence', () => {
    const { root, save } = directory();
    const failed = { at: '2026-11-02T01:00:00.000Z', phase: 'startup', load: [1, 1, 1], error: 'Unable to sample competing processes' };
    save('host-samples.json', [failed]);
    const report = benchmarkReport(root);
    expect(report.globalIssues).toContain('Competing-load collection failed in 1 observations');
    expect(report.hostEvidence.observations[0].issues).toContain('Collector error: Unable to sample competing processes');
    expect(report.hostEvidence.observations[0].failedObservation).toEqual(failed);
    expect(report.groups.every((group) => group.shownBudgetObservation === 'inconclusive')).toBe(true);
  });

  it('requires observations during measurement, not just successful startup/finished snapshots', () => {
    const { root, save } = directory();
    save('host-samples.json', [hostSample('startup'), hostSample('finished')]);
    const report = benchmarkReport(root);
    expect(report.globalIssues).toContain('No usable measurement-period competing-load observations');
    expect(report.hostEvidence.observations.every((observation) => observation.issues.length === 0)).toBe(true);
    expect(report.groups.every((group) => group.shownBudgetObservation === 'inconclusive')).toBe(true);
  });

  it.each([
    { processes: 'Error: Command failed: ps' },
    { gpu: 'Error: Command failed: ioreg' },
    { gpu: [] },
    { gpu: ['"model" = "Apple M5 Pro"'] },
    { gpu: ['IOAccelerator counters unavailable on this platform'] },
  ])('retains failed or empty process/GPU observations: %j', (failure) => {
    const { root, save } = directory();
    const failed = hostSample('current:noon-lush:run-1', failure);
    save('host-samples.json', [failed, hostSample('current:night-exotic:run-1')]);
    const report = benchmarkReport(root);
    expect(report.hostEvidence.observations[0].failedObservation).toEqual(failed);
    expect(report.hostEvidence.observations[0].usable).toBe(false);
    expect(report.hostEvidence.observations[0].issues.length).toBeGreaterThan(0);
    expect(report.globalIssues).toContain('Competing-load collection failed in 1 observations');
    expect(report.groups.every((group) => group.shownBudgetObservation === 'inconclusive')).toBe(true);
  });

  it.each(['missing', 'malformed'])('reports %s load evidence as inconclusive without dropping the run data', (state) => {
    const { root } = directory();
    if (state === 'missing') rmSync(join(root, 'host-samples.json'));
    else writeFileSync(join(root, 'host-samples.json'), 'not JSON');
    const report = benchmarkReport(root);
    expect(report.hostEvidence.readError).toEqual(expect.any(String));
    expect(report.groups.every((group) => group.shownBudgetObservation === 'inconclusive' && group.scene.gpuMsP95.n === 5)).toBe(true);
  });

  it('checks both the run phase and timestamp before treating a load sample as measurement-period evidence', () => {
    const { root, save } = directory();
    save('host-samples.json', [hostSample('current:noon-lush:run-1', { at: '2026-11-02T00:59:59.000Z' })]);
    const report = benchmarkReport(root);
    expect(report.groups.every((group) => group.shownBudgetObservation === 'inconclusive')).toBe(true);
    expect(report.groups[0].runs[0].hostEvidenceIssue).toBe("No usable competing-load observation during this run's measured sampling");
  });

  it("does not apply one lighting case's load sample to an unobserved case", () => {
    const { root, save } = directory();
    save(
      'host-samples.json',
      Array.from({ length: 5 }, (_, i) => hostSample(`current:noon-lush:run-${i + 1}`)),
    );
    expect(benchmarkReport(root).groups.map((group) => group.shownBudgetObservation)).toEqual(['within', 'inconclusive', 'inconclusive']);
  });

  it('states shown and hidden budget observations separately', () => {
    const { root, save } = directory();
    for (let i = 1; i <= 5; i++) {
      const fixture = run();
      for (const sample of fixture.samples) if (!sample.shown) sample.gpu = 30;
      save(`current-noon-lush-${i}.json`, fixture);
    }
    expect(benchmarkReport(root).groups[0]).toMatchObject({ shownBudgetObservation: 'within', hiddenBudgetObservation: 'exceeds' });
  });

  it('keeps legacy raw results but refuses to infer sampling boundaries from attempt timestamps', () => {
    const { root, save } = directory();
    const { samplingWindows: _windows, ...legacy } = run();
    save('current-noon-lush-1.json', legacy);
    const group = benchmarkReport(root).groups[0];
    expect(group.shownBudgetObservation).toBe('inconclusive');
    expect(group.scene.gpuMsP95.n).toBe(5);
    expect(group.runs[0].result?.issues).toEqual(expect.arrayContaining([expect.stringContaining('Invalid sampling boundaries:')]));
    expect(group.runs[0].hostObservationIndices).toEqual([]);
  });

  it.each([
    [],
    [{ ...run().samplingWindows[0], sampleCount: 239 }],
    [{ ...run().samplingWindows[0], firstSample: 1 }],
    [{ ...run().samplingWindows[0], finishedAt: '2026-11-02T01:00:01.000Z' }],
    [{ ...run().samplingWindows[0], finishedAt: '2026-11-02T01:00:11.000Z' }],
    [run().samplingWindows[0], run().samplingWindows[0]],
  ])('rejects absent, inconsistent or overlapping sampling-window evidence (%j)', (...samplingWindows) => {
    const result = inspectRun({ ...run(), samplingWindows }, 'noon-lush');
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('Invalid sampling boundaries:')]));
    expect(result.samplingWindows).toEqual([]);
    expect(result.scene.frames).toBe(120);
  });

  it.each(['2026-11-02T01:00:01.000Z', '2026-11-02T01:00:08.000Z', '2026-11-02T01:00:09.000Z'])(
    'excludes warm-up, the sampling end boundary and post-sampling observations (%s)',
    (at) => {
      const { root, save } = directory();
      save(
        'host-samples.json',
        Array.from({ length: 5 }, (_, i) => hostSample(`current:noon-lush:run-${i + 1}`, { at })),
      );
      const group = benchmarkReport(root).groups[0];
      expect(group.shownBudgetObservation).toBe('inconclusive');
      expect(group.hostObservationIndices).toEqual([]);
    },
  );

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
