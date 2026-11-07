import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capture, runMatrix, toggle, timingEvidence } from './index.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const fake = (perf = async () => ({})) => ({ root: { visible: false }, case: 'noon-lush', lodLevel: 0, perf });
const options = (review, interventions = [], receipt = {runs: [], errors: []}) => ({ review, interventions, receipt, repetitions: 2 });
const validRaw = () => ({gpuTiming: 'EXT_disjoint_timer_query_webgl2 (GPU time of the frame)', scene: {gpuMsMedian: 25, gpuMsP95: 30, gpuSamples: 120, disjoint: 0}, withoutAsset: {gpuMsMedian: 24, gpuMsP95: 29, gpuSamples: 120, disjoint: 0}});

test('async perf rejection restores initial root/control, preserves failure, and releases lease', async () => {
  const control = {enabled: true};
  const receipt = {runs: [], errors: []};
  const review = fake(async () => { await tick(); review.root.visible = true; if (!control.enabled) throw new Error('async perf failure'); return {}; });
  await assert.rejects(runMatrix(options(review, [toggle('bloom', control, 'enabled')], receipt)), /async perf failure/);
  assert.equal(control.enabled, true);
  assert.equal(review.root.visible, false);
  assert.match(receipt.errors.join('\n'), /async perf failure/);
  assert.ok(receipt.runs.at(-1).after);
  review.perf = async () => ({});
  await runMatrix(options(review));
});

test('async apply rejection restores partial mutation and releases lease', async () => {
  const control = {enabled: true};
  const review = fake();
  const adapter = toggle('bloom', control, 'enabled');
  adapter.apply = async arm => { control.enabled = arm === 'A'; await tick(); if (arm === 'B') throw new Error('async apply failure'); };
  await assert.rejects(runMatrix(options(review, [adapter])), /async apply failure/);
  assert.equal(control.enabled, true);
  await runMatrix(options(review));
});

test('async restore rejection retains its failure, restores root, and releases lease', async () => {
  const control = {enabled: true};
  const receipt = {runs: [], errors: []};
  const review = fake(async () => { review.root.visible = true; return {}; });
  const adapter = toggle('bloom', control, 'enabled');
  adapter.restore = async () => { await tick(); throw new Error('restore rejected'); };
  await assert.rejects(runMatrix(options(review, [adapter], receipt)), /restore rejected/);
  assert.match(receipt.errors.join('\n'), /restore rejected/);
  assert.equal(review.root.visible, false);
  await runMatrix(options(review));
});

test('BUG R1: preserve BOTH errors when async perf and final restoration reject', async () => {
  const control = {enabled: true};
  const receipt = {runs: [], errors: []};
  let failing = false;
  const review = fake(async () => { await tick(); if (!control.enabled) { failing = true; throw new Error('original GPU submission failure'); } return {}; });
  const adapter = toggle('bloom', control, 'enabled');
  adapter.restore = async saved => { await tick(); control.enabled = saved; if (failing) throw new Error('restoration failure'); };
  let caught;
  try { await runMatrix(options(review, [adapter], receipt)); } catch (error) { caught = error; }
  assert.match(String(caught), /restoration failure/);
  assert.equal(control.enabled, true);
  await runMatrix(options(fake()));
  assert.match(receipt.errors.join('\n'), /original GPU submission failure/, 'the failure receipt loses the original measurement error');
});

test('BUG R2: initialization failure must not poison future runs on the same review', async () => {
  const review = fake();
  const frozenReceipt = Object.freeze({runs: [], errors: []});
  await assert.rejects(runMatrix(options(review, [], frozenReceipt)), /extensible|read only|readonly|property/);
  await assert.doesNotReject(runMatrix(options(review)), 'a corrected retry is rejected as already active');
});

test('BUG R2 variant: uncloneable input must not leave the matrix lease active', async () => {
  const review = fake();
  await assert.rejects(runMatrix({...options(review), host: {hostLoad: () => 0}}), /clone/);
  await assert.doesNotReject(runMatrix(options(review)), 'correcting host input cannot recover the same session');
});

test('BUG R3: capture records the available atmosphere march branch instead of cloning its method', () => {
  for (const expected of [-1, 0]) {
    const review = fake();
    review.game = {engine: {atmoPass: {marchPlanet() {return expected;}, uniforms: {uMarchPlanet: {value: expected}}}}};
    assert.equal(capture(review).marchPlanet, expected);
  }
});

test('concurrent matrices are rejected and a successful run releases its lease', async () => {
  let release;
  let started;
  const ready = new Promise(resolve => {started = resolve;});
  const barrier = new Promise(resolve => {release = resolve;});
  const review = fake(async () => {started(); await barrier; return {};});
  const running = runMatrix(options(review));
  await ready;
  await assert.rejects(runMatrix(options(review)), /already active/);
  release();
  await running;
  await runMatrix(options(review));
});

test('no-op and persistent runtime reversal of toggle are rejected', async () => {
  const target = {enabled: true};
  const adapter = toggle('bloom', target, 'enabled');
  adapter.apply = () => {};
  await assert.rejects(runMatrix(options(fake(), [adapter])), /ineffective B/);
  const review = fake(async () => {await tick(); target.enabled = true; return {};});
  await assert.rejects(runMatrix(options(review, [toggle('bloom', target, 'enabled')])), /control changed/);
  assert.equal(target.enabled, true);
});

test('restoration that silently fails is detected', async () => {
  const target = {enabled: true};
  let failed = false;
  const adapter = toggle('bloom', target, 'enabled');
  adapter.restore = saved => {if (!failed) target.enabled = saved;};
  const review = fake(async () => {if (!target.enabled) {failed = true; throw new Error('measurement failure');} return {};});
  await assert.rejects(runMatrix(options(review, [adapter])), /restoration failed/);
});

test('five default repetitions really execute 5 baseline and 10 alternating intervention calls', async () => {
  const control = {enabled: false};
  const values = [];
  const review = fake(async () => {values.push(control.enabled); return {};});
  const receipt = await runMatrix({review, interventions: [toggle('bloom', control, 'enabled')]});
  assert.deepEqual(receipt.runs.map(row => row.arm), ['A','A','A','A','A','A','B','B','A','A','B','B','A','A','B']);
  assert.equal(values.length, 15);
  assert.deepEqual(values.slice(5), [false,true,true,false,false,true,true,false,false,true]);
  assert.equal(control.enabled, false);
});

test('captured supported config is detached; missing hardware/query evidence stays unknown', () => {
  const review = fake();
  review.game = {engine: {renderer: {info: {render: {calls: 5, triangles: 10}}}}};
  const snapshot = capture(review);
  review.game.engine.renderer.info.render.calls = 8;
  assert.equal(snapshot.counters.calls, 5);
  assert.equal(snapshot.device.status, 'unknown');
  assert.equal(snapshot.host.driver.status, 'unknown');
  const evidence = timingEvidence(validRaw());
  assert.equal(evidence.status, 'aggregate-only');
  for (const key of ['pendingQueries','lostQueries','rawSamples','runtimeErrors']) assert.equal(evidence[key].status, 'unknown');
  assert.equal(evidence.performanceFixed, false);
  assert.equal(evidence.attribution, 'unproven');
});

test('documented limitation: camera/clock/inventory drift is absent from captured snapshots and does not stop the runner', async () => {
  const review = fake();
  review.orbit = {azimuth: 35, distance: 1.7};
  review.clock = 0;
  review.inventory = ['chunk-1'];
  const before = capture(review);
  review.orbit.azimuth = 70;
  review.clock = 20;
  review.inventory = ['chunk-2'];
  assert.deepEqual(capture(review), before);
  review.perf = async () => {review.orbit.azimuth += 1; return validRaw();};
  const receipt = await runMatrix(options(review));
  assert.equal(receipt.errors.length, 0);
  assert.deepEqual(receipt.runs[0].before, receipt.runs[0].after);
});
