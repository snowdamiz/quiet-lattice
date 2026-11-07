import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMatrix, toggle, timingEvidence } from './index.mjs';
const fake = (perf = async () => ({})) => ({ root: { visible: false }, case: 'noon-lush', perf });
test('reproduces baseline, alternates and records configs; restores initial state', async () => {
  const target = { enabled: true };
  const review = fake();
  const result = await runMatrix({ review, interventions: [toggle('bloom', target, 'enabled')], repetitions: 2 });
  assert.deepEqual(result.runs.map(r => r.arm), ['A', 'A', 'A', 'B', 'B', 'A']);
  assert.equal(result.runs[0].before.case, 'noon-lush');
  assert.equal(result.runs[0].before.host.os.status, 'unknown');
  assert.equal(target.enabled, true);
  assert.equal(review.root.visible, false);
});
test('no-op rejected and restoration attempted', async () => {
  const target = { enabled: true };
  const intervention = toggle('noop', target, 'enabled');
  intervention.apply = () => {};
  await assert.rejects(runMatrix({ review: fake(), interventions: [intervention], repetitions: 2 }), /ineffective B/);
  assert.equal(target.enabled, true);
});
test('throw under B restores state and retains error receipt', async () => {
  const target = { enabled: true };
  const receipt = { runs: [], errors: [] };
  const review = fake(async () => { if (!target.enabled) throw new Error('failure'); return {}; });
  await assert.rejects(runMatrix({ review, interventions: [toggle('bloom', target, 'enabled')], repetitions: 2, receipt }), /failure/);
  assert.equal(target.enabled, true);
  assert.equal(receipt.errors.length, 1);
  assert.ok(receipt.runs.at(-1).after);
});
test('missing, invalid and fallback timing never establish performance', () => {
  for (const value of [undefined, {}, { gpuTiming: 'readPixels sync' }, { scene: { gpuMsMedian: NaN } }]) {
    const result = timingEvidence(value);
    assert.equal(result.status, 'invalid-or-incomplete');
    assert.equal(result.performanceFixed, false);
    assert.equal(result.pendingQueries.status, 'unknown');
  }
});
test('runtime undoing intervention is detected', async () => {
  const target = { enabled: true };
  await assert.rejects(runMatrix({ review: fake(async () => { target.enabled = true; return {}; }), interventions: [toggle('bloom', target, 'enabled')], repetitions: 2 }), /control changed/);
});
