import { afterEach, describe, expect, it, vi } from 'vitest';
import { gpuCompletion } from './gpu-completion.js';

afterEach(() => vi.useRealTimers());

function context(options = {}) {
  const state = { polls: 0, deleted: [], flushed: 0, ...options };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4, WAIT_FAILED: 5,
    fenceSync: () => state.unavailable ? null : {}, isContextLost: () => !!state.lost,
    finish: () => { throw new Error('finish is not a completion signal'); },
    flush: () => state.flushed++,
    clientWaitSync(sync, flags, timeout) {
      expect(flags).toBe(0); expect(timeout).toBe(0);
      state.polls++;
      if (state.waitFailed) return 5;
      if (state.unexpected) return 99;
      if (state.timeout || state.polls === 1) return 4;
      return state.satisfied ? 3 : 2;
    },
    deleteSync: (sync) => state.deleted.push(sync),
  };
  return { gl, state };
}

describe('GPU completion observation', () => {
  it.each([false, true])('records initial timeout and a later observed signal, with bounded zero-time polls (%s)', async (satisfied) => {
    vi.useFakeTimers();
    const { gl, state } = context({ satisfied });
    const out = [];
    const pending = gpuCompletion(gl, 'control', out);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 'signaled', deletedAt: expect.any(String), failure: null });
    expect(out[0].polls.map((p) => p.status)).toEqual(['timeout-expired', satisfied ? 'condition-satisfied' : 'already-signaled']);
    expect(out[0].polls.map((p) => p.yieldedBeforePoll)).toEqual([false, true]);
    expect(state.flushed).toBe(1);
    expect(state.deleted).toHaveLength(1);
  });

  it.each([
    { unavailable: true, expected: 'unavailable' }, { waitFailed: true, expected: 'wait-failed' },
    { unexpected: true, expected: 'unexpected' }, { lost: true, expected: 'context-lost' }, { timeout: true, expected: 'timeout' },
  ])('retains failure/timeout status and releases every allocated sync (%j)', async (options) => {
    vi.useFakeTimers();
    const { gl, state } = context(options);
    const out = [];
    const pending = expect(gpuCompletion(gl, 'control', out)).rejects.toThrow();
    await vi.runAllTimersAsync();
    await pending;
    expect(out[0].status).toBe(options.expected);
    expect(out[0].failure).toEqual(expect.any(String));
    expect(state.deleted).toHaveLength(options.unavailable ? 0 : 1);
    expect(state.polls).toBe(options.timeout ? 100 : options.unavailable || options.lost ? 0 : 1);
  });
});
