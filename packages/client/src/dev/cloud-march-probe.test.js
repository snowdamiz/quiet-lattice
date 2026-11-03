import { appendFileSync } from 'node:fs';
import { env } from 'node:process';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Review } from './review.js';
import { Engine } from '../core/Engine.js';
import { AtmospherePass } from '../render/AtmospherePass.js';
import { timerRenderer } from '../../test/timer-renderer.js';

const fixtures = [];
function fixture(options = {}) {
  const state = { frames: 0, syncs: [], deleted: [], draws: [], swaps: [], stage: 'prepare', cloudWrites: 0, ...options };
  const atmo = new AtmospherePass();
  atmo.uniforms.uCount.value = 1; atmo.uniforms.uClouds.value[0] = state.inactive ? 0 : 1;
  atmo.uniforms.uRadius.value[0] = 100; atmo.uniforms.uCamDist.value[0] = 101;
  const fake = timerRenderer();
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4, WAIT_FAILED: 5, CURRENT_QUERY: 6,
    RGBA: 7, UNSIGNED_BYTE: 8, NO_ERROR: 0, getError: () => 0, isContextLost: () => false, getQuery: () => null,
    createQuery() { throw Error('Queries forbidden'); }, beginQuery() { throw Error('Queries forbidden'); },
    readPixels(_x, _y, _w, _h, _type, _format, bytes) { bytes.fill(0); },
    fenceSync() { const s = { polls: 0 }; state.syncs.push(s); return s; }, flush() {},
    clientWaitSync(sync) {
      const index = state.syncs.indexOf(sync) + 1;
      if (index === state.cancelSync && sync.polls === 0) setTimeout(() => { state.atCancel = state.frames; void review.cloudMarchProbe('cancel'); }, 0);
      if (index === state.failSync) return 5;
      if (index === state.timeoutSync) return 4;
      return ++sync.polls === 1 ? 4 : 3;
    },
    deleteSync(sync) { state.deleted.push(sync); },
  };
  const renderer = fake.renderer, dependentRender = renderer.render;
  Object.assign(renderer, { getContext: () => gl, getPixelRatio: () => 1, getSize: (v) => v.set(1920, 1080),
    getDrawingBufferSize: (v) => v.set(1920, 1080), domElement: { width: 1920, height: 1080 } });
  renderer.info.reset = () => { renderer.info.render.calls = 0; renderer.info.render.triangles = 0; };
  Object.defineProperty(renderer.domElement, 'toDataURL', { get() { throw Error('PNG must be structurally absent'); } });
  renderer.render = (mesh, camera) => {
    if (mesh.material.uniforms.uPrevious) return dependentRender(mesh, camera);
    const material = mesh.material;
    const kind = material === atmo.marchMaterial ? 'march' : material === atmo.resolveQuad.material ? 'resolve' : material === atmo.material ? 'composite' : 'unknown';
    expect(kind).not.toBe('unknown');
    if (state.stage === 'control' && kind === state.failDraw) throw Error('PRIMARY ACTUAL PASS DRAW FAILED');
    if (kind === 'march') state.cloudWrites++;
    const target = renderer.getRenderTarget();
    state.draws.push({ stage: state.stage, kind, target, cloudWrites: state.cloudWrites });
    renderer.info.render.calls++; renderer.info.render.triangles += mesh.geometry.attributes.position.count / 3;
    if (kind === 'composite') state.lastComposite = target;
  };
  const hdr = new THREE.WebGLRenderTarget(state.badSize ? 960 : 1920, state.badSize ? 540 : 1080, { depthTexture: new THREE.DepthTexture(1920, 1080) });
  const composer = new EffectComposer(renderer, hdr);
  composer.addPass({ enabled: true, needsSwap: false, setSize() {}, render() { renderer.info.render.calls += 647; renderer.info.render.triangles += 3792978; } });
  composer.addPass(atmo);
  composer.addPass({ enabled: true, needsSwap: false, setSize() {}, render(_r, _write, read) { state.swaps.push(read); expect(read).toBe(state.lastComposite); } });
  const engine = Object.assign(Object.create(Engine.prototype), { renderer, atmoPass: atmo, composer, camera: new THREE.PerspectiveCamera(70, 16 / 9, .05, 1e9), gradePass: {} });
  const review = Object.assign(Object.create(Review.prototype), { queue: Promise.resolve(), busy: 0, root: { visible: true }, case: 'noon-lush', lodLevel: 0, clock: 120, liveOn: false,
    game: { engine, time: 120, timeBase: 0, renderTime: 120 }, device: () => ({ renderer: 'CPU-only actual pass fixture' }), gpuTimer: () => ({ TIME_ELAPSED_EXT: 7 }),
    realFrame(dt) { state.frames++; this.game.time += dt; this.game.renderTime += dt; engine.render(dt); },
  });
  const original = atmo.marchQuad.render;
  if (state.ownDescriptor) Object.defineProperty(atmo.marchQuad, 'render', { value: original, configurable: true, writable: true, enumerable: true });
  const descriptor = Object.getOwnPropertyDescriptor(atmo.marchQuad, 'render');
  const f = { state, review, atmo, renderer, composer, original, descriptor, assertRestored() {
    expect(original).toBe(FullScreenQuad.prototype.render);
      expect(atmo.marchQuad.render).toBe(original); expect(Object.getOwnPropertyDescriptor(atmo.marchQuad, 'render')).toEqual(descriptor);
    expect(state.deleted).toEqual(state.syncs); expect(review.busy).toBe(0); expect(review.cloudMarchOperation).toBeNull();
  } };
  fixtures.push(f); return f;
}
async function action(f, command, mode) {
  const task = f.review.cloudMarchProbe(command, mode); const handled = task.catch(() => {});
  await vi.runAllTimersAsync(); await handled;
  if (env.CLOUD_MARCH_CPU_EVIDENCE && command !== 'cancel') appendFileSync(env.CLOUD_MARCH_CPU_EVIDENCE, JSON.stringify({ command, mode, report: f.review.lastCloudMarchProbe }) + '\n');
  return task;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const f of fixtures.splice(0)) { f.atmo.dispose(); f.composer.dispose(); } vi.useRealTimers(); });

describe('cloud work diagnostic with actual Engine/EffectComposer/AtmospherePass/FullScreenQuad/Review/native controls (CPU renderer only)', () => {
  it.each(['reference', 'reuse'])('runs full actual preparation and exactly one %s frame with original resolve/composite/swap and progressing history', async (mode) => {
    const f = fixture(); const prepared = await action(f, 'prepare', mode);
    expect(prepared.work.preparationOriginalCalls).toBe(prepared.native.warm.frames); expect(prepared.work.suppressedCalls).toBe(0);
    expect(prepared.work.observations.every(o => o.receiverMatches && o.argumentCount === 1)).toBe(true);
    expect(prepared.wrapperRestored).toBe(true); expect(prepared.native.preflight.proof.matches).toBe(true);
    const cloudWrites = f.state.cloudWrites, before = f.atmo.frameIdx, hist = f.atmo.histIdx, frames = f.state.frames;
    f.state.stage = 'control'; const result = await action(f, 'run', mode);
    expect(result.native.samples[0].operations).toEqual({ frames: 1, png: 0, queries: 0 });
    expect(result.native.samples[0]).not.toHaveProperty('png'); expect(result.native.samples[0]).not.toHaveProperty('readbackStarted');
    expect(result.work.controlOriginalCalls).toBe(mode === 'reference' ? 1 : 0); expect(result.work.suppressedCalls).toBe(mode === 'reuse' ? 1 : 0);
    expect(f.state.cloudWrites).toBe(cloudWrites + (mode === 'reference' ? 1 : 0));
    expect(f.state.draws.filter(d => d.stage === 'control').map(d => d.kind)).toEqual(mode === 'reference' ? ['march', 'resolve', 'composite'] : ['resolve', 'composite']);
    expect(f.state.draws.find(d => d.stage === 'control' && d.kind === 'resolve').cloudWrites).toBe(mode === 'reuse' ? cloudWrites : cloudWrites + 1);
    expect(f.atmo.frameIdx).toBe(before + 1); expect(f.atmo.histIdx).toBe(1 - hist); expect(f.atmo.histValid).toBe(true);
    expect(f.atmo.uniforms.tCloud.value).toBe(f.atmo.hist[f.atmo.histIdx].textures[0]); expect(f.atmo.needsSwap).toBe(true); expect(f.state.frames).toBe(frames + 1);
    expect(result.native.samples[0].rendered).toEqual({ calls: mode === 'reuse' ? 649 : 650, triangles: mode === 'reuse' ? 3792980 : 3792981 });
    f.assertRestored(); const frozen = JSON.stringify(result); await action(f, 'cancel'); await vi.advanceTimersByTimeAsync(5000); expect(JSON.stringify(result)).toBe(frozen);
  });
  it.each(['drained-empty', 'fence-only'])('keeps full preparation and no frame/PNG/march in %s control', async mode => {
    const f = fixture(); await action(f, 'prepare', mode); const before = f.state.frames; f.state.stage = 'control'; const result = await action(f, 'run', mode);
    expect(f.state.frames).toBe(before); expect(result.work.controlOriginalCalls + result.work.suppressedCalls).toBe(0); expect(result.native.samples[0].operations).toEqual({ frames: 0, png: 0, queries: 0 }); f.assertRestored();
  });
  it.each(['reference', 'reuse'])('restores exact own descriptor after %s and forces fresh full preparation for every control', async mode => {
    const f = fixture({ ownDescriptor: true }); await action(f, 'prepare', mode); f.state.stage = 'control'; await action(f, 'run', mode); f.assertRestored();
    await expect(action(f, 'run', mode)).rejects.toThrow('fresh');
    expect(f.review.lastCloudMarchProbe).toMatchObject({ failure: expect.any(String), finished: expect.any(Object) }); f.assertRestored();
  });
  it.each(['reference', 'reuse'])('preserves actual pass failure and restores exact method after %s draw error', async mode => {
    const f = fixture({ failDraw: 'resolve' }); await action(f, 'prepare', mode); f.state.stage = 'control';
    await expect(action(f, 'run', mode)).rejects.toThrow('PRIMARY ACTUAL PASS DRAW FAILED'); expect(f.review.lastCloudMarchProbe.failure).toContain('PRIMARY'); f.assertRestored();
  });
  it.each([4, 5])('awaits cancellation at completion%s and restores before acknowledgement without later frames', async cancelSync => {
    const f = fixture({ cancelSync }); await action(f, 'prepare', 'reuse'); f.state.stage = 'control';
    await expect(action(f, 'run', 'reuse')).rejects.toThrow('cancelled'); f.assertRestored(); const result = f.review.lastCloudMarchProbe, frames = f.state.frames;
    await vi.advanceTimersByTimeAsync(5000); expect(f.state.frames).toBe(frames); expect(result.cancelled).toBe(true); expect(result.wrapperRestored).toBe(true);
  });
  it('retains a wrong binding failure without touching an existing method or submitting a frame', async () => {
    const f = fixture(); const unrelated = () => {}; f.atmo.marchQuad.render = unrelated;
    await expect(action(f, 'prepare', 'reuse')).rejects.toThrow('Exact unwrapped');
    expect(f.atmo.marchQuad.render).toBe(unrelated); expect(f.state.frames).toBe(0); expect(f.review.lastCloudMarchProbe).toMatchObject({ failure: expect.any(String), finished: expect.any(Object) });
    delete f.atmo.marchQuad.render;
  });
  it('refuses a second march invocation before issuing its draw', async () => {
    const f = fixture(); await action(f, 'prepare', 'reference'); f.state.stage = 'control'; const actualRender = f.renderer.render;
    f.renderer.render = (mesh, camera) => { actualRender(mesh, camera); if (mesh.material === f.atmo.marchMaterial) f.atmo.marchQuad.render(f.renderer); };
    await expect(action(f, 'run', 'reference')).rejects.toThrow('count ambiguous');
    expect(f.state.draws.filter(d => d.stage === 'control' && d.kind === 'march')).toHaveLength(1); f.assertRestored();
  });
  it('cancels before a queued native preparation without starting any renderer work', async () => {
    const f = fixture(); const task = f.review.cloudMarchProbe('prepare', 'reuse'); const handled = task.catch(() => {}); const cancelled = f.review.cloudMarchProbe('cancel');
    await vi.runAllTimersAsync(); await cancelled; await handled; await expect(task).rejects.toThrow('cancelled');
    expect(f.state.frames).toBe(0); expect(f.state.syncs).toHaveLength(0); f.assertRestored();
  });
  it('refuses mode mismatch without another frame and retains a terminal failure report', async () => {
    const f = fixture(); await action(f, 'prepare', 'reference'); const before = f.state.frames;
    await expect(action(f, 'run', 'reuse')).rejects.toThrow('fresh matching'); expect(f.state.frames).toBe(before); expect(f.review.lastCloudMarchProbe.finished).toEqual(expect.any(Object)); f.assertRestored();
  });
  it.each([{ failSync: 4 }, { timeoutSync: 5 }, { inactive: true }, { badSize: true }])('retains failure and terminal restore for %j', async options => {
    const f = fixture(options);
    if (options.inactive || options.badSize) await expect(action(f, 'prepare', 'reuse')).rejects.toThrow();
    else { await action(f, 'prepare', 'reuse'); f.state.stage = 'control'; await expect(action(f, 'run', 'reuse')).rejects.toThrow(); }
    expect(f.review.lastCloudMarchProbe.failure).toEqual(expect.any(String)); f.assertRestored();
  });
});
