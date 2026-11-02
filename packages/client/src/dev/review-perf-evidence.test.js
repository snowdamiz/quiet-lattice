import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchmarkReport } from '../../../tools/src/capture/benchmark-report.ts';
import { Review, abba } from './review.js';

const LIGHTS = ['noon-lush', 'night-exotic', 'open-space'];
const advance = (ms) => vi.setSystemTime(Date.now() + ms);

// Run the real perf/serial/summary control flow. Only rendering, host I/O and time are synthetic;
// this proves evidence ownership, not browser timings or any performance claim.
function perfFixture({ onWarmup = () => {}, onSampling = () => {}, failWarmup = false, failSampling = false } = {}) {
  return Object.assign(Object.create(Review.prototype), {
    queue: Promise.resolve(), busy: 0, root: { visible: true }, case: 'noon-lush', lodLevel: 0,
    game: { engine: { renderer: { domElement: { width: 1920, height: 1080 } } } },
    device: () => ({ renderer: 'Synthetic CPU control-flow fixture', contextLost: false }),
    glErrors: () => [], gpuTimer: () => true, stats: () => ({}),
    async warmUp() {
      advance(5000);
      onWarmup();
      advance(5000);
      if (failWarmup) throw new Error('Synthetic warm-up failure');
      return { frames: 30, stable: true, underBudget: true };
    },
    async sampleInterleaved(pairs, out, samplingWindows) {
      const window = { startedAt: new Date().toISOString(), firstSample: out.length };
      samplingWindows.push(window);
      advance(1000);
      onSampling();
      for (const shown of abba(pairs)) out.push({ shown, cpu: shown ? 3 : 2, gpu: shown ? 12 : 10, calls: shown ? 15 : 10, tris: shown ? 1000 : 800, gpuStatus: 'timer' });
      advance(1000);
      Object.assign(window, { finishedAt: new Date().toISOString(), sampleCount: out.length - window.firstSample });
      if (failSampling) throw new Error('Synthetic sample failure');
      return 0;
    },
  });
}

describe('review: actual perf control flow and competing-load evidence', () => {
  const folders = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  async function capture({ sampleDuring, observedRuns = [1, 2, 3, 4, 5], labels = ['current'] }) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T01:00:00.000Z'));
    const root = mkdtempSync(join(tmpdir(), 'review-perf-evidence-'));
    folders.push(root);
    const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value));
    const observations = [];
    for (const label of labels) for (const light of LIGHTS) for (let run = 1; run <= 5; run++) {
      const observe = () => {
        if (!observedRuns.includes(run)) return;
        observations.push({
          at: new Date().toISOString(), phase: `${label}:${light}:run-${run}`, load: [1, 1, 1],
          processes: '  PID PPID %CPU %MEM ELAPSED COMM\n  123 1 2.0 0.1 00:05 /synthetic/fixture\n',
          gpu: ['"PerformanceStatistics" = {"Device Utilization %"=10,"Renderer Utilization %"=8,"Tiler Utilization %"=5}'],
        });
      };
      const review = perfFixture(sampleDuring === 'warmup' ? { onWarmup: observe } : { onSampling: observe });
      review.case = light;
      save(`${label}-${light}-${run}.json`, await review.perf({ pairs: 120 }));
    }
    save('context.json', { mode: 'measure', sourceTrees: labels.map((label) => ({ label })) });
    save('status.json', { errors: [], pageErrors: [] });
    save('host-samples.json', observations);
    return benchmarkReport(root);
  }

  it('does not accept warm-up-only observations inside actual perf attempt timestamps', async () => {
    const report = await capture({ sampleDuring: 'warmup' });
    expect(report.groups.map((group) => group.shownBudgetObservation)).toEqual(['inconclusive', 'inconclusive', 'inconclusive']);
  });

  it('does not let one observed run cover the other four runs of a lighting case', async () => {
    const report = await capture({ sampleDuring: 'sampling', observedRuns: [1] });
    expect(report.groups.map((group) => group.shownBudgetObservation)).toEqual(['inconclusive', 'inconclusive', 'inconclusive']);
    expect(report.groups.every((group) => group.runs.map((run) => run.hostObservationIndices.length).join(',') === '1,0,0,0,0')).toBe(true);
  });

  it('requires the fifth run as well as the first four on each comparison side', async () => {
    const report = await capture({ sampleDuring: 'sampling', observedRuns: [1, 2, 3, 4], labels: ['baseline', 'candidate'] });
    expect(report.groups.every((group) => group.shownBudgetObservation === 'inconclusive' && group.hiddenBudgetObservation === 'inconclusive')).toBe(true);
    expect(report.groups.every((group) => group.runs[4].hostEvidenceIssue !== null)).toBe(true);
  });

  it('accepts usable observations from every measured run on both comparison sides', async () => {
    const report = await capture({ sampleDuring: 'sampling', labels: ['baseline', 'candidate'] });
    expect(report.groups).toHaveLength(6);
    expect(report.groups.every((group) => group.shownBudgetObservation === 'within' && group.hiddenBudgetObservation === 'within')).toBe(true);
  });

  it('preserves separate windows and raw-frame ranges for adaptive sampling batches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const result = await perfFixture().perf({ pairs: 20, maxPairs: 40 });
    expect(result.samplingWindows).toEqual([
      { startedAt: new Date(start + 10000).toISOString(), finishedAt: new Date(start + 12000).toISOString(), firstSample: 0, sampleCount: 40 },
      { startedAt: new Date(start + 12000).toISOString(), finishedAt: new Date(start + 14000).toISOString(), firstSample: 40, sampleCount: 40 },
    ]);
    expect(result.samples).toHaveLength(80);
  });

  it('keeps a failed warm-up distinct from an attempted sampling interval', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const review = perfFixture({ failWarmup: true });
    review.lastPerf = { case: 'previous' };
    await expect(review.perf()).rejects.toThrow('Synthetic warm-up failure');
    expect(review.lastPerf).toMatchObject({ case: 'noon-lush', samples: [], samplingWindows: [], failure: 'Error: Synthetic warm-up failure' });
  });

  // Exercise the actual sampling-loop owner as well, with only WebGL/draws stubbed. Result availability is delayed
  // until after the rendering loop, so a timestamp around the entire async method would fail this assertion.
  it.each([false, true])('records actual loop boundaries outside warm-up and query drain, retaining partial failures (%s)', async (failDraw) => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(new Date('2026-11-02T01:00:00.000Z'));
    const start = Date.now();
    const review = perfFixture();
    const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
    let availabilityChecks = 0;
    let frames = 0;
    const deleted = [];
    const gl = {
      QUERY_RESULT_AVAILABLE: 3,
      getParameter: () => false,
      createQuery: () => ({ shown: review.root.visible }),
      beginQuery() {}, endQuery() {},
      getQueryParameter: (q, key) => key === 3 ? availabilityChecks++ > 0 : q.shown ? 12e6 : 10e6,
      deleteQuery: (q) => deleted.push(q),
    };
    const renderer = review.game.engine.renderer;
    renderer.getContext = () => gl;
    renderer.info = { render: { calls: 0, triangles: 0 } };
    review.gpuTimer = () => ext;
    review.sync = () => {};
    review.frameOnce = () => {
      advance(1);
      if (++frames === 2 && failDraw) throw new Error('Synthetic draw failure');
      renderer.info.render = { calls: review.root.visible ? 15 : 10, triangles: review.root.visible ? 1000 : 800 };
    };
    review.sampleInterleaved = Review.prototype.sampleInterleaved;
    const pending = review.perf({ pairs: 2, maxPairs: 2 });
    const outcome = failDraw ? expect(pending).rejects.toThrow('Synthetic draw failure') : pending;
    await vi.runAllTimersAsync();
    await outcome;
    const result = review.lastPerf;
    const frameCount = failDraw ? 2 : 4;
    expect(result.samplingWindows).toEqual([{
      startedAt: new Date(start + 10000).toISOString(), finishedAt: new Date(start + 10000 + frameCount).toISOString(), firstSample: 0, sampleCount: frameCount,
    }]);
    expect(result.samples).toHaveLength(frameCount);
    expect(deleted).toHaveLength(frameCount);
    expect(review.root.visible).toBe(true);
    expect(result.finishedAt).toBe(new Date(start + 10000 + frameCount + (failDraw ? 0 : 5)).toISOString());
    if (failDraw) expect(result.samples[1].cpu).toBeNull();
    else expect(result.samples.every((sample) => sample.gpuStatus === 'timer')).toBe(true);
  });
});
