import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Review } from './review.js';
import { timerRenderer } from '../../test/timer-renderer.js';

function fixture(options = {}) {
  const state = { active: null, queued: 0, frames: 0, finishes: 0, created: [], deleted: [], syncs: [], deletedSyncs: [], fixturePasses: 0, ...options };
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    CURRENT_QUERY: 3, QUERY_RESULT_AVAILABLE: 4, QUERY_RESULT: 5,
    SYNC_GPU_COMMANDS_COMPLETE: 6, ALREADY_SIGNALED: 7, CONDITION_SATISFIED: 8, TIMEOUT_EXPIRED: 9, WAIT_FAILED: 10,
    getQuery: () => state.externalActive ? {} : state.active,
    isContextLost: () => !!state.contextLost,
    finish() { throw new Error('finish cannot prove completion'); },
    fenceSync() {
      if (state.active) throw new Error('Sync inside measured query');
      if (state.syncUnavailable) return null;
      const sync = { polls: 0, id: state.syncs.length + 1 };
      state.syncs.push(sync);
      return sync;
    },
    flush() {
      if (state.active) throw new Error('Flush inside measured query');
    },
    clientWaitSync(sync, flags, timeout) {
      if (state.active) throw new Error('Wait inside measured query');
      expect([flags, timeout]).toEqual([0, 0]);
      if (state.syncFailed || sync.id === state.syncFailedAt) return 10;
      if (state.syncTimeout || ++sync.polls === 1) return 9;
      state.queued = 0;
      return 7;
    },
    deleteSync(sync) {
      if (state.deletedSyncs.includes(sync)) throw new Error('Sync deleted twice');
      state.deletedSyncs.push(sync);
    },
    createQuery() {
      if (state.unavailable) return null;
      const q = { ns: 0 };
      state.created.push(q);
      return q;
    },
    beginQuery(_, q) {
      if (state.active) throw new Error('Nested query');
      state.active = q;
      // Model the observed driver failure so the controls must expose it rather than normalize it away.
      if (state.leakPriorWork) q.ns = state.queued * 1e6;
    },
    endQuery() {
      if (!state.active) throw new Error('No active query');
      state.active = null;
    },
    getParameter: () => !!state.disjoint,
    getQueryParameter: (q, key) => key === 4 ? !state.timeout : state.invalid ? NaN : q.ns * (state.scale ?? 1),
    deleteQuery(q) {
      if (state.active === q || state.deleted.includes(q)) throw new Error('Invalid query cleanup');
      state.deleted.push(q);
    },
  };
  const fake = timerRenderer(() => {
    state.fixturePasses++; state.queued++;
    if (state.active) state.active.ns += 1e6;
  }, { corruptReadback: !!state.badChecksum, beforeRead: () => {
    if (state.active || state.queued) throw new Error('Readback before observed completion or inside query');
  } });
  const renderer = Object.assign(fake.renderer, { getContext: () => gl, domElement: { width: 1920, height: 1080 } });
  const review = Object.assign(Object.create(Review.prototype), {
    queue: Promise.resolve(), busy: 0, root: { visible: false }, case: 'noon-lush', lodLevel: 0,
    game: { engine: { renderer } }, gpuTimer: () => state.noExtension ? null : ext,
    device: () => ({ renderer: 'Synthetic CPU control fixture', contextLost: false }),
    glErrors() {
      const errors = state.errorRead ? state.afterErrors : state.beforeErrors;
      state.errorRead = true;
      return errors ?? [];
    },
    async warmUp() {
      if (state.failWarmup) throw new Error('Warm-up failed');
      return { frames: 30, stable: true, underBudget: false };
    },
    frameOnce() {
      expect(this.root.visible).toBe(true);
      state.frames++;
      state.queued++;
      renderer.info.render = { calls: 4, triangles: 8 };
      if (state.active) state.active.ns += 1e6;
      if (state.frames === state.failFrame) throw new Error('Draw failed');
    },
  });
  return { review, state, fixtureState: fake.state, restored() {
    expect(review.root.visible).toBe(false);
    expect(review.busy).toBe(0);
    expect(state.active).toBeNull();
    expect(state.deleted).toEqual(state.created);
    expect(state.deletedSyncs).toEqual(state.syncs);
    expect(renderer.getRenderTarget()).toBe(fake.original);
  } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function run(review, options) {
  const pending = review.timerBoundaries(options);
  const handled = pending.catch(() => {});
  await vi.runAllTimersAsync();
  await handled;
  return pending;
}

describe('review timer-boundary experiment', () => {
  it('runs bounded alternating controls and preserves every real frame outside or inside its assigned query', async () => {
    const { review, state, restored } = fixture({ leakPriorWork: true });
    const result = await run(review);
    expect(result).toMatchObject({ diagnosticOnly: true, kind: 'timer-boundary-controls', contractVersion: 2, failure: null, maxControlFrames: 35, maxDependentControlPasses: 25, dependentDisposed: true });
    expect(result.samples).toHaveLength(35);
    expect(state.frames).toBe(35);
    expect(state.fixturePasses).toBe(29);
    expect(result.dependentWarmup.proof.matches).toBe(true);
    const controls = ['idle-empty', 'queued-frame-empty', 'drained-frame-empty', 'isolated-one-frame', 'isolated-four-frames', 'dependent-one-pass', 'dependent-four-passes'];
    for (let block = 1; block <= 5; block++) {
      const samples = result.samples.filter((s) => s.block === block);
      expect(samples.map((s) => s.control)).toEqual(block % 2 ? controls : [...controls].reverse());
      for (const sample of samples) {
        const [queued, timed, gpu] = {
          'idle-empty': [0, 0, 0], 'queued-frame-empty': [1, 0, 1], 'drained-frame-empty': [1, 0, 0],
          'isolated-one-frame': [0, 1, 1], 'isolated-four-frames': [0, 4, 4],
          'dependent-one-pass': [0, 0, 1], 'dependent-four-passes': [0, 0, 4],
        }[sample.control];
        expect(sample.queuedWork).toHaveLength(queued);
        expect(sample.timedWork).toHaveLength(timed);
        expect(sample.gpuMs).toBe(gpu);
        expect(sample.gpuStatus).toBe('timer');
        expect([...sample.queuedWork, ...sample.timedWork].every((f) => f.completed && f.calls === 4 && f.triangles === 8)).toBe(true);
        expect(sample.completions.map((f) => f.label)).toEqual(sample.control === 'drained-frame-empty'
          ? ['before-queued-work', 'drain-queued-work-before-query', 'after-query'] : ['before-queued-work', 'after-query']);
        expect(sample.completions.every((f) => f.status === 'signaled' && f.deletedAt && f.polls.length === 2)).toBe(true);
        expect(sample.queryPolls.length).toBeGreaterThan(0);
        expect(sample.cpuWallThroughObservedCompletionMs).toBeGreaterThanOrEqual(5);
        if (sample.control.startsWith('dependent-')) expect(sample.dependentWork.proof.matches).toBe(true);
      }
    }
    expect(result).not.toHaveProperty('budgetObservation');
    restored();
  });

  it('records an ordinary non-leaking driver without inventing a prior-work cost', async () => {
    const { review, restored } = fixture();
    const result = await run(review, { blocks: 1 });
    expect(result.samples.map((s) => s.gpuMs)).toEqual([0, 0, 0, 1, 4, 1, 4]);
    restored();
  });

  it.each([0, 6, 1.5, NaN, Infinity])('rejects unbounded or invalid block counts before drawing (%s)', (blocks) => {
    const { review, state } = fixture();
    expect(() => review.timerBoundaries({ blocks })).toThrow('integer from 1 to 5');
    expect(state.frames).toBe(0);
    expect(state.finishes).toBe(0);
  });

  it.each([{ unavailable: true }, { disjoint: true }, { invalid: true }, { timeout: true }])('retains missing or invalid query outcomes and actual work (%j)', async (options) => {
    vi.useFakeTimers();
    const { review, state, restored } = fixture(options);
    const result = await run(review, { blocks: 1 });
    const status = options.unavailable ? 'unavailable' : options.disjoint ? 'disjoint' : options.invalid ? 'invalid' : 'timeout';
    expect(result.samples.every((s) => s.gpuStatus === status && s.gpuMs === null)).toBe(true);
    expect(state.frames).toBe(7);
    expect(result.disjointObservations).toBe(options.disjoint ? 7 : 0);
    if (options.invalid) expect(result.samples.every((s) => s.gpuResultNs === 'NaN')).toBe(true);
    restored();
  });

  it('retains a partial draw failure, closes/deletes its query and leaves the review reusable', async () => {
    const { review, state, restored } = fixture({ failFrame: 5 });
    await expect(run(review, { blocks: 1 })).rejects.toThrow('Draw failed');
    expect(review.lastTimerBoundaries.failure).toContain('Draw failed');
    expect(review.lastTimerBoundaries.samples.at(-1)).toMatchObject({ control: 'isolated-four-frames', gpuStatus: 'failed', gpuMs: null, failure: 'Error: Draw failed' });
    expect(review.lastTimerBoundaries.samples.at(-1).timedWork.map((f) => f.completed)).toEqual([true, false]);
    restored();
    state.failFrame = null;
    expect(await run(review, { blocks: 1 })).toMatchObject({ failure: null });
    restored();
  });

  it.each([{ noExtension: true }, { externalActive: true }, { failWarmup: true }])('preserves a current failed report without submitting controls (%j)', async (options) => {
    const { review, state, restored } = fixture(options);
    review.lastTimerBoundaries = { case: 'previous' };
    await expect(run(review)).rejects.toThrow();
    expect(review.lastTimerBoundaries).toMatchObject({ case: 'noon-lush', samples: [] });
    expect(review.lastTimerBoundaries.failure).toEqual(expect.any(String));
    expect(state.frames).toBe(0);
    expect(state.created).toHaveLength(0);
    restored();
  });

  it.each([{ contextLost: true }, { afterErrors: [1282] }])('keeps GL/context failures explicit with all available raw evidence (%j)', async (options) => {
    const { review, restored } = fixture(options);
    await expect(run(review, { blocks: 1 })).rejects.toThrow('GL errors or context loss');
    expect(review.lastTimerBoundaries.contextLostAfter).toBe(!!options.contextLost);
    expect(review.lastTimerBoundaries.glErrors.after).toEqual(options.afterErrors ?? []);
    expect(review.lastTimerBoundaries.samples).toHaveLength(options.contextLost ? 0 : 7);
    restored();
  });

  it('retains implausible query durations even when completion and output checks succeed', async () => {
    const { review, restored } = fixture({ scale: 100 });
    const result = await run(review, { blocks: 1 });
    const control = result.samples.find((s) => s.control === 'dependent-four-passes');
    expect(control.gpuMs).toBe(400);
    expect(control.gpuMs).toBeGreaterThan(control.cpuWallThroughQueryAvailabilityMs);
    expect(control.dependentWork.proof.matches).toBe(true);
    expect(result).not.toHaveProperty('timingValid');
    restored();
  });

  it.each([{ syncUnavailable: true }, { syncFailed: true }, { syncTimeout: true }, { badChecksum: true }])('rejects unproven completion/output and retains failed evidence (%j)', async (options) => {
    const { review, state, restored } = fixture(options);
    await expect(run(review, { blocks: 1 })).rejects.toThrow();
    expect(review.lastTimerBoundaries.failure).toEqual(expect.any(String));
    expect(review.lastTimerBoundaries.samples).toEqual([]);
    if (options.badChecksum) {
      expect(review.lastTimerBoundaries.dependentWarmup.proof.matches).toBe(false);
      expect(review.lastTimerBoundaries.dependentDisposed).toBe(true);
    }
    expect(state.frames).toBe(0);
    restored();
  });

  it('retains a failed post-query wait and releases its query, syncs and owned fixture resources', async () => {
    const { review, fixtureState, restored } = fixture({ syncFailedAt: 4 });
    await expect(run(review, { blocks: 1 })).rejects.toThrow('wait-failed');
    const result = review.lastTimerBoundaries;
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]).toMatchObject({ control: 'idle-empty', gpuStatus: 'failed', queryDeletedAt: expect.any(String) });
    expect(result.samples[0].completions.map((s) => s.status)).toEqual(['signaled', 'wait-failed']);
    expect(result.dependentDisposed).toBe(true);
    expect(fixtureState.disposed.size).toBe(5);
    restored();
  });
});
