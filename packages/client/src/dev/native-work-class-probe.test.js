import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import { env } from 'node:process';
import { Review } from './review.js';
import { NATIVE_WORK_CLASSES } from './native-work-class-probe.js';
import { timerRenderer } from '../../test/timer-renderer.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARAAA//8DAAJZAXHr7wAAAABJRU5ErkJggg==';
function fixture(options = {}) {
  const state = { frames: 0, png: 0, syncs: [], deleted: [], events: [], ...options };
  const fake = timerRenderer(() => state.events.push('dependent-draw'), { corruptReadback: !!state.badDependent, beforeRead: () => state.events.push('dependent-read') });
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4, WAIT_FAILED: 5,
    CURRENT_QUERY: 6, isContextLost: () => !!state.contextLost, getQuery: () => state.externalQuery ? {} : null,
    createQuery() { throw new Error('Queries forbidden'); }, beginQuery() { throw new Error('Queries forbidden'); },
    fenceSync() { if (state.syncs.length === 2) { expect(fake.state.readCount).toBe(3); expect(fake.state.disposed).toEqual(fake.state.seen); } const sync = { polls: 0 }; state.syncs.push(sync); state.events.push('fence'); return sync; },
    flush() { state.events.push('flush'); },
    clientWaitSync(sync) {
      const index = state.syncs.indexOf(sync) + 1;
      if (index === state.failSync) return 5;
      if (index === state.timeoutSync) return 4;
      if (index === state.cancelSync && !sync.polls) setTimeout(() => {
        state.atCancel = { frames: state.frames, png: state.png, syncs: state.syncs.length };
        void review.nativeWorkClassProbe('cancel');
      }, 0);
      return ++sync.polls === 1 ? 4 : 3;
    },
    deleteSync(sync) { state.events.push('delete-sync'); state.deleted.push(sync); },
  };
  const renderer = Object.assign(fake.renderer, { getContext: () => gl, domElement: { width: 1920, height: 1080 } });
  // A forbidden PNG path fails even if merely accessed; frame-only/empty/fence cannot defer it.
  Object.defineProperty(renderer.domElement, 'toDataURL', { get() {
    if (state.forbidPng) throw new Error('PNG API must be structurally absent');
    return (type) => {
      expect(type).toBe('image/png'); state.events.push('png'); state.png++;
      if (state.badPng) return 'bad-image';
      if (state.throwPng) throw new Error('PNG failure');
      return PNG;
    };
  } });
  const atmo = { frameIdx: 7, histIdx: 0, histValid: true, prevKey: 'original-history',
    uniforms: { uJitter: { value: { x: 0, y: 0 } }, uMarchPlanet: { value: 1 } },
    hist: [{ width: 960, height: 540 }, { width: 960, height: 540 }],
    resolveUniforms: { uHistValid: { value: 1 }, uBlend: { value: 0.15 } } };
  const review = Object.assign(Object.create(Review.prototype), {
    queue: Promise.resolve(), busy: 0, root: { visible: true }, case: 'noon-lush', lodLevel: 0, clock: 42, liveOn: false,
    game: { time: 42, timeBase: 5, renderTime: 42, engine: { renderer, atmoPass: atmo, gradePass: {} } },
    device: () => ({ renderer: 'CPU synthetic renderer' }), gpuTimer: () => ({ TIME_ELAPSED_EXT: 7 }), glErrors: () => state.glError ? [1282] : [],
    async warmUp() { state.events.push('warmup'); return { stable: !state.unstable, frames: 61 }; },
    // Exercise the actual Review.frameOnce; this is the synthetic realFrame provider, not a replacement frameOnce.
    realFrame(dt) {
      state.events.push('frame'); state.frames++; expect(dt).toBe(1 / 60);
      this.game.time += dt; this.game.renderTime += dt; renderer.info.render = { calls: 650, triangles: 3792981 };
      atmo.frameIdx++; atmo.histIdx = 1 - atmo.histIdx; atmo.uniforms.uJitter.value.x = atmo.frameIdx / 16;
      if (state.failFrame) throw new Error('Frame failed');
    },
  });
  return { review, state, fake, atmo, assertDrained() {
    expect(review.busy).toBe(0); expect(state.deleted).toEqual(state.syncs);
    expect(fake.state.target).toBe(fake.original); expect(review.root.visible).toBe(true);
  } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function action(review, command, workClass) {
  const p = review.nativeWorkClassProbe(command, workClass); const settled = p.catch(() => {});
  await vi.runAllTimersAsync(); await settled; return p;
}
describe('separate native work-class controls (CPU actual Review/gpuCompletion/dependentOutput)', () => {
  it.each(NATIVE_WORK_CLASSES)('preserves exact %s work/order and temporal state without query brackets', async (workClass) => {
    const f = fixture({ forbidPng: workClass !== 'frame-plus-PNG' });
    const prepared = await action(f.review, 'prepare', workClass);
    expect(prepared.preflight).toMatchObject({ disposed: true, proof: { matches: true }, settledAt: expect.any(Object) });
    expect(prepared.preflight.completions.map((r) => r.label)).toEqual(['after-work-class-warmup', 'after-work-class-dependent-preflight', 'after-work-class-preflight-disposal']);
    expect(f.fake.state.readCount).toBe(3); expect(f.fake.state.drawCount).toBe(4);
    expect(f.state.syncs).toHaveLength(3); expect(f.state.frames).toBe(0); expect(f.state.png).toBe(0);
    f.state.events.length = 0;
    const result = await action(f.review, 'run', workClass);
    const s = result.samples[0]; const frames = workClass.startsWith('frame-') ? 1 : 0;
    expect(s.operations).toEqual({ frames, png: workClass === 'frame-plus-PNG' ? 1 : 0, queries: 0 });
    expect(f.state.frames).toBe(frames); expect(f.state.png).toBe(s.operations.png);
    expect(s.completions).toHaveLength(workClass === 'drained-empty' ? 0 : 2);
    const expected = workClass === 'drained-empty' ? [] : ['fence', 'flush', 'delete-sync',
      ...(frames ? ['frame'] : []), ...(s.operations.png ? ['png'] : []), 'fence', 'flush', 'delete-sync'];
    expect(f.state.events).toEqual(expected);
    expect(s.temporalBefore).toMatchObject({ frameIdx: 7, histIdx: 0, histValid: true, prevKey: 'original-history', blend: 0.15 });
    expect(s.temporalAfter).toMatchObject({ frameIdx: 7 + frames, histIdx: frames, histValid: true, prevKey: 'original-history', blend: 0.15 });
    expect(f.atmo.frameIdx).toBe(7 + frames); expect(f.atmo.prevKey).toBe('original-history');
    if (frames) {
      expect(s.rendered).toEqual({ calls: 650, triangles: 3792981 }); expect(s.frameCompleted).toBe(true);
      expect(s.temporalAfter.jitter).not.toEqual(s.temporalBefore.jitter);
    } else expect(s.clocksAfter).toEqual(s.clocksBefore);
    if (workClass === 'frame-plus-PNG') expect(s).toMatchObject({ png: PNG, readbackStarted: expect.any(Object), readbackFinished: expect.any(Object) });
    else { expect(s).not.toHaveProperty('png'); expect(s).not.toHaveProperty('readbackStarted'); }
    // No deferred readback, fence, late state mutation, or terminal cancellation mutation.
    const frozen = JSON.stringify(result); await f.review.nativeWorkClassProbe('cancel');
    await vi.advanceTimersByTimeAsync(5000); expect(JSON.stringify(result)).toBe(frozen);
    f.assertDrained();
    if (env.NATIVE_WORK_CLASS_EVIDENCE) appendFileSync(env.NATIVE_WORK_CLASS_EVIDENCE, JSON.stringify({ workClass, report: result, events: f.state.events, png: f.state.png, frames: f.state.frames }) + '\n');
  });
  it.each(['frame-only', 'frame-plus-PNG', 'fence-only'])('does not submit later work when cancelled during %s pre-completion', async (workClass) => {
    const f = fixture({ cancelSync: 4, forbidPng: true }); await action(f.review, 'prepare', workClass);
    await expect(action(f.review, 'run', workClass)).rejects.toThrow('cancelled');
    expect(f.state.atCancel).toEqual({ frames: 0, png: 0, syncs: 4 });
    expect(f.state.frames).toBe(0); expect(f.state.png).toBe(0); expect(f.state.syncs).toHaveLength(4);
    expect(f.review.lastNativeWorkClassProbe).toMatchObject({ cancelled: true, failureKind: 'cancelled', finishedAt: expect.any(String) });
    const frozen = JSON.stringify(f.review.lastNativeWorkClassProbe); await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.stringify(f.review.lastNativeWorkClassProbe)).toBe(frozen); f.assertDrained();
  });
  it.each(['frame-only', 'frame-plus-PNG'])('awaits terminal %s post-completion cancellation without later reads or state changes', async (workClass) => {
    const f = fixture({ cancelSync: 5, forbidPng: workClass === 'frame-only' }); await action(f.review, 'prepare', workClass);
    await expect(action(f.review, 'run', workClass)).rejects.toThrow('cancelled');
    expect(f.state.frames).toBe(1); expect(f.state.png).toBe(workClass === 'frame-plus-PNG' ? 1 : 0);
    expect(f.state.syncs).toHaveLength(5); expect(f.review.nativeWorkClassOperation).toBeNull();
    const frozen = JSON.stringify(f.review.lastNativeWorkClassProbe); await f.review.nativeWorkClassProbe('cancel');
    await vi.advanceTimersByTimeAsync(5000); expect(JSON.stringify(f.review.lastNativeWorkClassProbe)).toBe(frozen); f.assertDrained();
  });
  it('cancels a queued preparation before warm-up,dependent setup or any GL submission starts', async () => {
    const f = fixture(); const task = f.review.nativeWorkClassProbe('prepare', 'frame-only'); const handled = task.catch(() => {});
    const cancelled = f.review.nativeWorkClassProbe('cancel'); await vi.runAllTimersAsync(); await cancelled; await handled;
    await expect(task).rejects.toThrow('cancelled'); expect(f.state.events).toEqual([]); expect(f.state.syncs).toEqual([]);
    expect(f.review.lastNativeWorkClassProbe).toMatchObject({ cancelled: true, failureKind: 'cancelled', finishedAt: expect.any(String) }); f.assertDrained();
  });
  it('does not acknowledge cancellation until the active preparation has actually settled', async () => {
    const f = fixture(); let warmed = false;
    f.review.warmUp = async () => { await new Promise((r) => setTimeout(r, 50)); warmed = true; return { stable: true }; };
    const task = f.review.nativeWorkClassProbe('prepare', 'frame-only'); const handled = task.catch(() => {});
    await vi.advanceTimersByTimeAsync(10); let acknowledged = false;
    const cancelled = f.review.nativeWorkClassProbe('cancel').then(() => { acknowledged = true; });
    await vi.advanceTimersByTimeAsync(20); expect(acknowledged).toBe(false); expect(warmed).toBe(false);
    await vi.runAllTimersAsync(); await cancelled; await handled; await expect(task).rejects.toThrow('cancelled');
    expect(warmed).toBe(true); expect(f.state.syncs).toHaveLength(0); expect(acknowledged).toBe(true); f.assertDrained();
  });
  it.each([1, 2, 3])('settles preparation cancellation at sync %s without later setup or control work', async (cancelSync) => {
    const f = fixture({ cancelSync }); await expect(action(f.review, 'prepare', 'frame-only')).rejects.toThrow('cancelled');
    expect(f.state.syncs).toHaveLength(cancelSync); expect(f.state.frames).toBe(0); expect(f.state.png).toBe(0);
    expect(f.review.lastNativeWorkClassProbe).toMatchObject({ failureKind: 'cancelled', preparedAt: null, finishedAt: expect.any(String) });
    if (cancelSync >= 2) expect(f.review.lastNativeWorkClassProbe.preflight.disposed).toBe(true);
    await expect(action(f.review, 'run', 'frame-only')).rejects.toThrow('fresh'); f.assertDrained();
  });
  it.each([{ failSync: 4 }, { timeoutSync: 4 }, { failFrame: true }, { badPng: true }, { throwPng: true }])('retains partial failures and bounded sync cleanup (%j)', async (options) => {
    const f = fixture(options); await action(f.review, 'prepare', 'frame-plus-PNG');
    await expect(action(f.review, 'run', 'frame-plus-PNG')).rejects.toThrow();
    expect(f.review.lastNativeWorkClassProbe.failure).toEqual(expect.any(String)); expect(f.state.frames).toBeLessThanOrEqual(1);
    expect(f.state.png).toBeLessThanOrEqual(1); expect(f.review.lastNativeWorkClassProbe.finishedAt).toEqual(expect.any(String)); f.assertDrained();
  });
  it('cancels a bounded empty interval without introducing a completion fence', async () => {
    const f = fixture({ forbidPng: true }); await action(f.review, 'prepare', 'drained-empty');
    const p = f.review.nativeWorkClassProbe('run', 'drained-empty'); const handled = p.catch(() => {});
    await vi.advanceTimersByTimeAsync(20); const cancelled = f.review.nativeWorkClassProbe('cancel'); await vi.runAllTimersAsync(); await cancelled; await handled;
    await expect(p).rejects.toThrow('cancelled'); expect(f.state.syncs).toHaveLength(3); expect(f.state.frames).toBe(0); f.assertDrained();
  });
  it.each([{ unstable: true }, { badDependent: true }, { externalQuery: true }, { contextLost: true }, { glError: true }])('rejects failed preparation without a native control frame (%j)', async (options) => {
    const f = fixture(options); await expect(action(f.review, 'prepare', 'frame-only')).rejects.toThrow();
    expect(f.state.frames).toBe(0); expect(f.state.png).toBe(0); f.assertDrained();
  });
  it('rejects mixed classes,repeated/unprepared runs and broadened scenes', async () => {
    const f = fixture(); await expect(action(f.review, 'run', 'frame-only')).rejects.toThrow('fresh');
    await action(f.review, 'prepare', 'frame-only'); await expect(action(f.review, 'run', 'frame-plus-PNG')).rejects.toThrow('fresh');
    await action(f.review, 'run', 'frame-only'); await expect(action(f.review, 'run', 'frame-only')).rejects.toThrow('fresh');
    f.review.case = 'night-exotic'; await expect(action(f.review, 'prepare', 'frame-only')).rejects.toThrow('noon-lush');
    expect(() => f.review.nativeWorkClassProbe('prepare', 'all')).toThrow('exact'); f.assertDrained();
  });
});
