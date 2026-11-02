import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import { env } from 'node:process';
import { Review } from './review.js';
import { timerRenderer } from '../../test/timer-renderer.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARAAA//8DAAJZAXHr7wAAAABJRU5ErkJggg==';
const STAGES = ['renderPass', 'atmoPass', 'fxPass', 'viewPass', 'bloomPass', 'gradePass'];
function fixture(options = {}) {
  const state = { active: null, frames: 0, images: 0, queries: [], deleted: [], syncs: [], deletedSyncs: [], ...options };
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    CURRENT_QUERY: 3, QUERY_RESULT_AVAILABLE: 4, QUERY_RESULT: 5,
    SYNC_GPU_COMMANDS_COMPLETE: 6, ALREADY_SIGNALED: 7, CONDITION_SATISFIED: 8, TIMEOUT_EXPIRED: 9, WAIT_FAILED: 10,
    isContextLost: () => !!state.contextLost, getQuery: () => state.externalQuery ? {} : state.active,
    getParameter: () => !!state.disjoint,
    createQuery() { if (state.unavailable) return null; const q = { ns: 0 }; state.queries.push(q); return q; },
    beginQuery(_, query) { if (state.active) throw new Error('Nested query'); state.active = query; },
    endQuery() { if (!state.active) throw new Error('No active query'); state.active = null; },
    getQueryParameter: (query, key) => key === 4 ? !state.queryTimeout : query.ns,
    deleteQuery(query) { expect(state.active).toBeNull(); state.deleted.push(query); },
    fenceSync() { expect(state.active).toBeNull(); const s = { polls: 0 }; state.syncs.push(s); return s; },
    flush() { expect(state.active).toBeNull(); },
    clientWaitSync(sync) {
      const index = state.syncs.indexOf(sync) + 1;
      if (index === state.failSync) return 10;
      if (index === state.cancelAtSync && sync.polls === 0) setTimeout(() => {
        state.countsAtCancel = { frames: state.frames, images: state.images };
        void review.nativePassProbe('cancel');
      }, 0);
      return ++sync.polls === 1 ? 9 : 8;
    },
    deleteSync(sync) { state.deletedSyncs.push(sync); },
  };
  const fake = timerRenderer(() => {}, { corruptReadback: !!state.badDependent });
  const renderer = Object.assign(fake.renderer, { getContext: () => gl, domElement: { width: 1920, height: 1080,
    toDataURL(type) {
      expect(type).toBe('image/png'); expect(state.active).toBeNull(); state.images++;
      if (state.cancelAtImage === state.images) review.lastNativePassProbe.cancelled = true;
      return state.mismatch && state.images % 2 === 0 ? PNG + 'changed' : PNG;
    } } });
  const engine = { renderer };
  for (const stage of STAGES) engine[stage] = Object.create({ render() {
    renderer.info.render.calls++; renderer.info.render.triangles += 2;
    if (state.active) state.active.ns += 1e6;
    if (stage === state.failStage) throw new Error('Synthetic pass draw failure');
  } });
  engine.gradePass.uniforms = { uTime: { value: 42 } };
  engine.atmoPass.uniforms = { uTime: { value: 42 }, uMarchPlanet: { value: 0 }, uJitter: { value: { x: 0, y: 0 } } };
  Object.assign(engine.atmoPass, { frameIdx: 7, histIdx: 0, histValid: true, prevKey: 'unchanged-history-key',
    hist: [{ width: 960, height: 540 }, { width: 960, height: 540 }],
    resolveUniforms: { uHistValid: { value: 1 }, uBlend: { value: 0.15 } } });
  const originals = STAGES.map((s) => engine[s].render);
  const review = Object.assign(Object.create(Review.prototype), {
    queue: Promise.resolve(), busy: 0, root: { visible: true }, case: 'noon-lush', lodLevel: 0, clock: 42, liveOn: false,
    game: { engine, time: 42, timeBase: 0, renderTime: 42 }, gpuTimer: () => ext,
    device: () => ({ renderer: 'Synthetic CPU fixture' }), glErrors: () => [],
    async warmUp() { return { stable: !state.unstable, frames: 61, underBudget: false }; },
    frameOnce(dt) {
      expect(dt).toBe(1 / 60); state.frames++; renderer.info.render = { calls: 0, triangles: 0 };
      // A legitimate dt-driven state change is recorded; it is never reset by this diagnostic.
      this.game.time += dt;
      for (const stage of STAGES) engine[stage].render();
      engine.atmoPass.frameIdx++;
      engine.atmoPass.histIdx = 1 - engine.atmoPass.histIdx;
      engine.atmoPass.uniforms.uJitter.value.x = engine.atmoPass.frameIdx / 16;
      if (state.workMismatch && state.frames % 2 === 0) renderer.info.render.calls++;
    },
  });
  return { state, review, restored() {
    expect(review.busy).toBe(0); expect(review.root.visible).toBe(true); expect(state.active).toBeNull();
    expect(state.deleted).toEqual(state.queries); expect(state.deletedSyncs).toEqual(state.syncs);
    for (const [i, stage] of STAGES.entries()) { expect(engine[stage].render).toBe(originals[i]); expect(Object.hasOwn(engine[stage], 'render')).toBe(false); }
  } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function action(review, command) {
  const promise = review.nativePassProbe(command); const handled = promise.catch(() => {});
  await vi.runAllTimersAsync(); await handled; return promise;
}

describe('single-scene native pass-query controls', () => {
  it('runs ten unchanged shown frames in five alternating pairs, preserving work, output and all query/sync outcomes', async () => {
    const { review, state, restored } = fixture();
    const prepared = await action(review, 'prepare');
    expect(prepared.preflight).toMatchObject({ disposed: true, proof: { matches: true } });
    expect(state.frames).toBe(0);
    const result = await action(review, 'run');
    expect(state.frames).toBe(10); expect(state.images).toBe(10); expect(state.queries).toHaveLength(30);
    expect(result.samples.map((s) => s.mode)).toEqual(['off', 'passes', 'passes', 'off', 'off', 'passes', 'passes', 'off', 'off', 'passes']);
    expect(result.samples.every((s) => s.frameCompleted && s.calls === 6 && s.triangles === 12 && s.png === PNG)).toBe(true);
    for (const s of result.samples) {
      expect(s.queries.map((q) => q.stage)).toEqual(s.mode === 'off' ? [] : STAGES);
      expect(s.queries.every((q) => q.status === 'timer' && q.rawNs === 1e6 && q.deletedAt)).toBe(true);
      expect(s.completions.every((c) => c.status === 'signaled')).toBe(true);
      expect(s.readbackStarted.monotonicMs).toBeGreaterThanOrEqual(s.frameFinished.monotonicMs);
      expect(s.clocksAfter.game).toBeGreaterThan(s.clocksBefore.game);
    }
    expect(result.pairMatches).toHaveLength(5);
    expect(result.traceVerdict).toContain('unobserved');
    expect(result).not.toHaveProperty('budgetObservation'); expect(result).not.toHaveProperty('timingValid');
    restored();
  });

  it.each([false, true])('observes two unchanged queries-off frames and temporal progression without forcing output equality (mismatch=%s)', async (mismatch) => {
    const { review, state, restored } = fixture({ mismatch });
    const prepared = await action(review, 'prepare-off-off');
    expect(prepared).toMatchObject({ protocol: 'off-off', kind: 'native-temporal-off-off-controls' });
    if (mismatch) await expect(action(review, 'run-off-off')).rejects.toThrow('stationary-output premise failed without query brackets');
    else await action(review, 'run-off-off');
    const report = review.lastNativePassProbe;
    expect(state.frames).toBe(2); expect(state.images).toBe(2); expect(state.queries).toEqual([]);
    expect(report.samples.map((s) => s.mode)).toEqual(['off', 'off']);
    expect(report.samples.map((s) => [s.temporalBefore.frameIdx, s.temporalAfter.frameIdx])).toEqual([[7, 8], [8, 9]]);
    expect(report.samples.map((s) => [s.temporalBefore.histIdx, s.temporalAfter.histIdx])).toEqual([[0, 1], [1, 0]]);
    for (const sample of report.samples) {
      expect(sample.temporalBefore).toMatchObject({ histValid: true, prevKey: 'unchanged-history-key', marchPlanet: 0,
        historyValidUniform: 1, blend: 0.15, historySizes: [[960, 540], [960, 540]] });
      expect(sample.temporalAfter.jitter).not.toEqual(sample.temporalBefore.jitter);
      expect(sample).toMatchObject({ frameCompleted: true, calls: 6, triangles: 12, queries: [] });
      expect(sample.completions.map((c) => c.label)).toEqual(['before-native-frame', 'after-native-frame-and-readback']);
      expect(sample.readbackStarted.monotonicMs).toBeGreaterThanOrEqual(sample.frameFinished.monotonicMs);
    }
    expect(report.pairMatches).toEqual([{ pair: 1, calls: true, triangles: true, png: !mismatch }]);
    expect(report.failureKind).toBe(mismatch ? 'stationary-output-mismatch' : null);
    expect(report.comparisonLimit).toContain('equality alone proves no query causality');
    expect(review.game.engine.atmoPass.frameIdx).toBe(9); expect(review.game.engine.atmoPass.histIdx).toBe(0);
    restored();
    if (env.NATIVE_OFF_OFF_EVIDENCE) appendFileSync(env.NATIVE_OFF_OFF_EVIDENCE, JSON.stringify({
      scope: 'CPU actual prepare-off-off/run-off-off with synthetic renderer/GL; no browser/GPU/native recording',
      mismatch, report, frames: state.frames, readbacks: state.images, queries: state.queries.length,
      syncs: state.syncs.length, deletedSyncs: state.deletedSyncs.length, wrappersRestored: true,
    }) + '\n');
  });

  it('does not mix the separately prepared off/off and default protocols', async () => {
    const { review, state, restored } = fixture();
    await action(review, 'prepare-off-off'); await expect(action(review, 'run')).rejects.toThrow('Prepare');
    await action(review, 'prepare'); await expect(action(review, 'run-off-off')).rejects.toThrow('Prepare');
    expect(state.frames).toBe(0); restored();
  });

  it('separates scene-output mismatch from missing native evidence without disabling animation or submitting more frames', async () => {
    const { review, state, restored } = fixture({ mismatch: true });
    await action(review, 'prepare');
    await expect(action(review, 'run')).rejects.toThrow('Scene output differs');
    expect(review.lastNativePassProbe).toMatchObject({ failureKind: 'scene-output-mismatch', pairMatches: [{ calls: true, triangles: true, png: false }] });
    expect(state.frames).toBe(2); expect(review.game.time).toBeGreaterThan(42);
    expect(review.lastNativePassProbe.traceVerdict).toContain('unobserved'); restored();
  });

  it('retains a work-count mismatch rather than qualifying equal images alone', async () => {
    const { review, state, restored } = fixture({ workMismatch: true });
    await action(review, 'prepare'); await expect(action(review, 'run')).rejects.toThrow('work counts');
    expect(review.lastNativePassProbe.failureKind).toBe('work-count-mismatch'); expect(state.frames).toBe(2); restored();
  });

  it.each([{ failStage: 'atmoPass' }, { unavailable: true }, { failSync: 4 }, { disjoint: true }, { queryTimeout: true }])('retains partial failures and restores inherited pass methods (%j)', async (options) => {
    const { review, restored } = fixture(options);
    await action(review, 'prepare'); await expect(action(review, 'run')).rejects.toThrow();
    expect(review.lastNativePassProbe.failure).toEqual(expect.any(String)); expect(review.lastNativePassProbe.samples.length).toBeLessThanOrEqual(2);
    restored();
  });

  it('cancels between bounded frames and leaves the partial record', async () => {
    const { review, state, restored } = fixture({ cancelAtImage: 1 });
    await action(review, 'prepare'); await expect(action(review, 'run')).rejects.toThrow('cancelled');
    expect(state.frames).toBe(1); expect(review.lastNativePassProbe.failureKind).toBe('cancelled'); restored();
  });

  it.each([{ cancelAtSync: 3, mode: 'off', completed: 0 }, { cancelAtSync: 5, mode: 'passes', completed: 1 }])(
    'submits no frame, brackets or readback when cancelled during the pending pre-frame completion ($mode)', async ({ cancelAtSync, mode, completed }) => {
      const { review, state, restored } = fixture({ cancelAtSync });
      await action(review, 'prepare');
      await expect(action(review, 'run')).rejects.toThrow('cancelled');
      const report = review.lastNativePassProbe;
      expect(state.countsAtCancel).toEqual({ frames: completed, images: completed });
      expect({ frames: state.frames, images: state.images }).toEqual(state.countsAtCancel);
      expect(report).toMatchObject({ cancelled: true, failureKind: 'cancelled', finishedAt: expect.any(String) });
      const partial = report.samples.at(-1);
      expect(partial).toMatchObject({ mode, frameStarted: null, frameFinished: null, frameCompleted: false,
        readbackStarted: null, readbackFinished: null, png: null, queries: [], failure: expect.stringContaining('cancelled'), finished: expect.any(Object) });
      expect(partial.completions).toHaveLength(1);
      expect(partial.completions[0]).toMatchObject({ status: 'signaled', finishedAt: expect.any(String), deletedAt: expect.any(String) });
      expect(partial.completions[0].polls.map((p) => p.status)).toEqual(['timeout-expired', 'condition-satisfied']);
      expect(state.queries).toHaveLength(0);
      restored();
      if (env.NATIVE_FENCE_EVIDENCE) appendFileSync(env.NATIVE_FENCE_EVIDENCE, JSON.stringify({
        scope: 'CPU actual prepare/run/cancel and gpuCompletion; synthetic renderer/GL; no browser/GPU/native recording',
        mode, completed, countsAtCancel: state.countsAtCancel, frames: state.frames, readbacks: state.images,
        report, deletedSyncs: state.deletedSyncs.length, syncs: state.syncs.length,
        deletedQueries: state.deleted.length, queries: state.queries.length, wrappersRestored: true,
      }) + '\n');
    },
  );

  it.each([{ unstable: true }, { badDependent: true }, { externalQuery: true }, { contextLost: true }])('rejects unproven preflight before controls (%j)', async (options) => {
    const { review, state, restored } = fixture(options);
    await expect(action(review, 'prepare')).rejects.toThrow(); expect(state.frames).toBe(0);
    expect(review.lastNativePassProbe.failureKind).toBe('preflight-failed'); restored();
  });

  it('rejects a broadened scene and a repeated/unprepared run', async () => {
    const { review, restored } = fixture();
    await expect(action(review, 'run')).rejects.toThrow('Prepare');
    review.case = 'night-exotic'; await expect(action(review, 'prepare')).rejects.toThrow('noon-lush');
    review.case = 'noon-lush'; await action(review, 'prepare'); await action(review, 'run');
    await expect(action(review, 'run')).rejects.toThrow('fresh'); restored();
  });

  it('rejects unknown actions before entering the serial frame path', () => {
    const { review } = fixture(); expect(() => review.nativePassProbe('profile-all')).toThrow('action');
  });
});
