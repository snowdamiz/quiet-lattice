import { describe, expect, it } from 'vitest';
import { Review } from './review.js';

const PASSES = ['renderPass', 'atmoPass', 'fxPass', 'viewPass', 'bloomPass', 'gradePass'];
const PARTS = ['marchQuad', 'resolveQuad', 'fsQuad'];

// CPU-only WebGL query contract: actual driver timing remains a separate browser verification.
function profileFixture(options = {}) {
  const state = { active: null, created: [], deleted: [], begun: 0, ended: 0, draws: [], ...options };
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    NO_ERROR: 0,
    QUERY_RESULT_AVAILABLE: 3,
    getExtension: () => state.noExtension ? null : ext,
    getError: () => 0,
    getParameter: () => !!state.disjoint,
    createQuery() {
      if (state.unavailable) return null;
      const query = {};
      state.created.push(query);
      return query;
    },
    beginQuery(_, query) {
      if (state.active) throw new Error('Nested TIME_ELAPSED query');
      state.active = query;
      state.begun++;
    },
    endQuery() {
      if (!state.active) throw new Error('No active query');
      state.active = null;
      state.ended++;
    },
    getQueryParameter: (_, key) => key === 3 ? true : 1_000_000,
    deleteQuery(query) {
      if (state.deleted.includes(query)) throw new Error('Query deleted twice');
      state.deleted.push(query);
    },
  };
  const renderer = { getContext: () => gl, domElement: { width: 1920, height: 1080 }, info: { render: { calls: 0, triangles: 0 } } };
  const draw = (name) => ({ render() {
    if (state.throwAt === name) throw new Error(`Draw failed: ${name}`);
    state.draws.push(name);
    renderer.info.render.calls++;
    renderer.info.render.triangles += 3;
  } });
  const engine = { renderer };
  for (const name of PASSES) engine[name] = draw(name);
  for (const part of PARTS) engine.atmoPass[part] = draw(part);
  engine.atmoPass.render = function () { for (const part of PARTS) this[part].render(); };
  const owners = [...PASSES.map((name) => engine[name]), ...PARTS.map((part) => engine.atmoPass[part])];
  const originals = owners.map((owner) => owner.render);
  const review = Object.assign(Object.create(Review.prototype), {
    game: { engine }, root: { visible: true }, case: 'noon-lush', queue: Promise.resolve(), busy: 0,
    device: () => ({ renderer: 'CPU query contract fixture' }),
    warmUp: async () => ({ frames: 30, stable: true }),
    sync() {},
    frameOnce() { for (const name of PASSES) engine[name].render(); },
  });
  return { review, state, assertRestored() {
    expect(owners.map((owner) => owner.render)).toEqual(originals);
    expect(state.active).toBeNull();
    expect(state.ended).toBe(state.begun);
    expect(state.deleted).toEqual(state.created);
    expect(review.root.visible).toBe(true);
    expect(review.busy).toBe(0);
  } };
}

describe('review: diagnostic query lifecycle', () => {
  it.each(['passes', 'atmosphere'])('profiles %s without overlapping queries or removing rendered work, then restores hooks', async (detail) => {
    const { review, state, assertRestored } = profileFixture();
    const result = await review.profile({ frames: 4, detail });
    const stages = detail === 'passes' ? PASSES : PASSES.flatMap((name) => name === 'atmoPass' ? PARTS.map((part) => `atmoPass.${part}`) : [name]);
    expect(result.samples).toHaveLength(stages.length * 4);
    expect([...new Set(result.samples.map((sample) => sample.stage))]).toEqual(stages);
    expect(result.samples.map((sample) => sample.shown)).toEqual([true, false, false, true].flatMap((shown) => Array(stages.length).fill(shown)));
    expect(result.samples.every((sample) => sample.gpuStatus === 'timer' && sample.gpu === 1)).toBe(true);
    expect(result.samples.reduce((sum, sample) => sum + sample.calls, 0)).toBe(32);
    expect(state.draws).toHaveLength(32);
    assertRestored();
  });

  it('records only the attempted case when warm-up fails after a successful case', async () => {
    const { review, assertRestored } = profileFixture();
    const first = await review.profile({ frames: 1 });
    const previous = structuredClone(first);
    review.case = 'night-exotic';
    review.warmUp = async () => { throw new Error('Warm-up interrupted'); };
    await expect(review.profile({ frames: 1 })).rejects.toThrow('Warm-up interrupted');
    expect(review.lastProfile).toMatchObject({ case: 'night-exotic', warm: null, samples: [], failure: 'Error: Warm-up interrupted' });
    expect(review.lastProfile.finishedAt).toEqual(expect.any(String));
    expect(review.lastProfile).not.toBe(first);
    expect(first).toEqual(previous);
    assertRestored();
  });

  it('retains failed draw evidence, closes every query, restores hooks, and permits another attempt', async () => {
    const { review, state, assertRestored } = profileFixture({ throwAt: 'fsQuad' });
    await expect(review.profile({ frames: 4 })).rejects.toThrow('Draw failed: fsQuad');
    expect(review.lastProfile.samples.map((sample) => sample.stage)).toEqual(['renderPass', 'atmoPass']);
    expect(review.lastProfile.samples.every((sample) => sample.gpu === null && sample.gpuStatus === 'timeout')).toBe(true);
    expect(review.lastProfile.failure).toContain('Draw failed: fsQuad');
    assertRestored();
    state.throwAt = null;
    review.case = 'open-space';
    expect(await review.profile({ frames: 1 })).toMatchObject({ case: 'open-space', failure: null });
    assertRestored();
  });

  it('retains disjoint samples as missing timings and releases their queries', async () => {
    const { review, assertRestored } = profileFixture({ disjoint: true });
    const result = await review.profile({ frames: 2 });
    expect(result.disjoint).toBe(2);
    expect(result.samples).toHaveLength(12);
    expect(result.samples.every((sample) => sample.gpu === null && sample.gpuStatus === 'disjoint' && sample.calls > 0)).toBe(true);
    assertRestored();
  });

  it('keeps actual work records when queries cannot be allocated', async () => {
    const { review, state, assertRestored } = profileFixture({ unavailable: true });
    const result = await review.profile({ frames: 1 });
    expect(result.samples).toHaveLength(6);
    expect(result.samples.every((sample) => sample.gpu === null && sample.gpuStatus === 'unavailable' && sample.calls > 0)).toBe(true);
    expect(state.begun).toBe(0);
    expect(state.draws).toHaveLength(8);
    assertRestored();
  });

  it('records a current failed attempt when timer queries are unsupported', async () => {
    const { review, assertRestored } = profileFixture({ noExtension: true });
    review.lastProfile = { case: 'previous' };
    await expect(review.profile({ frames: 1 })).rejects.toThrow('requires EXT_disjoint_timer_query_webgl2');
    expect(review.lastProfile).toMatchObject({ case: 'noon-lush', warm: null, samples: [] });
    expect(review.lastProfile.failure).toContain('requires EXT_disjoint_timer_query_webgl2');
    assertRestored();
  });
});
