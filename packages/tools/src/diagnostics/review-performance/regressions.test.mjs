import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capture, runMatrix, toggle } from './index.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const fake = () => ({ root: { visible: false }, case: 'noon-lush', perf: async () => ({}) });
const run = (review, interventions = [], receipt = { runs: [], errors: [] }) =>
  runMatrix({ review, interventions, receipt, repetitions: 2 });

for (const primaryPhase of ['perf', 'apply']) {
  for (const cleanupMode of ['reject', 'silent']) {
    test(`${primaryPhase} rejection survives ${cleanupMode} restoration failure with arm and phase`, async () => {
      const review = fake();
      const target = { enabled: true };
      const adapter = toggle('bloom', target, 'enabled');
      const receipt = { runs: [], errors: [] };
      const primary = new Error(`original ${primaryPhase} failure`);
      const restoration = new Error('restore rejection');
      let failing = false;
      const failOnB = async () => {
        await tick();
        if (!target.enabled) {
          failing = true;
          review.root.visible = true;
          throw primary;
        }
        return {};
      };
      if (primaryPhase === 'perf') review.perf = failOnB;
      else adapter.apply = async (arm, saved) => {
        target.enabled = arm === 'A' ? saved : !saved;
        await failOnB();
      };
      adapter.restore = async saved => {
        await tick();
        if (!failing || cleanupMode === 'reject') target.enabled = saved;
        if (failing && cleanupMode === 'reject') throw restoration;
      };

      await assert.rejects(run(review, [adapter], receipt), error => {
        assert.ok(error instanceof AggregateError);
        assert.ok(error.errors.includes(primary));
        if (cleanupMode === 'reject') assert.ok(error.errors.includes(restoration));
        return true;
      });
      const failures = JSON.parse(JSON.stringify(receipt)).failures;
      for (const failure of failures) {
        assert.equal(failure.id, 'bloom');
        assert.equal(failure.repetition, 0);
        assert.equal(failure.arm, 'B');
      }
      assert.ok(failures.some(f => f.phase === primaryPhase && f.error.includes(primary.message)));
      assert.ok(failures.some(f => f.phase === (cleanupMode === 'reject' ? 'restore' : 'verify-restoration')));
      assert.match(receipt.errors.join('\n'), new RegExp(primary.message));
      if (primaryPhase === 'perf') assert.ok(receipt.runs.at(-1).failures.some(f => f.phase === 'perf'));
      assert.equal(review.root.visible, false);
      assert.equal(target.enabled, cleanupMode === 'reject');
      review.perf = async () => ({});
      await run(review);
    });
  }
}

test('failed post-measurement capture and readback cannot mask perf or skip restore verification', async () => {
  const review = fake();
  const target = { enabled: true };
  const adapter = toggle('bloom', target, 'enabled');
  const receipt = { runs: [], errors: [] };
  let failing = false;
  let verified = false;
  review.perf = async () => {
    await tick();
    if (!target.enabled) {
      failing = true;
      review.case = () => 'uncloneable';
      review.root.visible = true;
      throw new Error('primary perf rejection');
    }
    return {};
  };
  adapter.observe = () => {
    if (failing && !target.enabled) throw new Error('post-measurement readback failed');
    return target.enabled;
  };
  adapter.restore = async saved => {
    await tick();
    target.enabled = saved;
    if (failing) throw new Error('restore rejected after mutation');
  };
  adapter.matches = (arm, saved, observed) => {
    if (failing) {
      verified = true;
      throw new Error('restore verification rejected');
    }
    return observed === (arm === 'A' ? saved : !saved);
  };
  await assert.rejects(run(review, [adapter], receipt), AggregateError);
  const serialized = JSON.parse(JSON.stringify(receipt));
  for (const phase of ['perf', 'capture-after', 'observe-after', 'restore', 'verify-restoration']) {
    assert.ok(serialized.failures.some(f => f.phase === phase), `missing ${phase}`);
  }
  assert.equal(verified, true);
  assert.equal(target.enabled, true);
  assert.equal(review.root.visible, false);
  review.case = 'noon-lush';
  review.perf = async () => ({});
  await run(review);
});

for (const rootMode of ['reject', 'silent']) {
  test(`root ${rootMode} failure retains the primary cause and still releases the guard`, async () => {
    const review = fake();
    const receipt = { runs: [], errors: [] };
    let visible = false;
    let failing = false;
    Object.defineProperty(review.root, 'visible', {
      get: () => visible,
      set: value => {
        if (failing) {
          if (rootMode === 'reject') throw new Error('root setter rejected');
          return;
        }
        visible = value;
      },
    });
    review.perf = async () => {
      await tick();
      review.root.visible = true;
      failing = true;
      throw new Error('primary perf rejection');
    };
    await assert.rejects(run(review, [], receipt), AggregateError);
    assert.match(receipt.errors.join('\n'), /primary perf rejection/);
    assert.ok(receipt.failures.some(f => f.phase === 'verify-root-restoration'));
    if (rootMode === 'reject') assert.ok(receipt.failures.some(f => f.phase === 'restore-root'));
    failing = false;
    review.perf = async () => ({});
    await run(review);
  });
}

test('a throwing initial root read does not hold the active guard', async () => {
  const review = fake();
  Object.defineProperty(review, 'root', { configurable: true, get() { throw new Error('root read rejected'); } });
  await assert.rejects(run(review), /root read rejected/);
  Object.defineProperty(review, 'root', { value: { visible: false } });
  await run(review);
});

test('uncloneable perf options do not hold the active guard', async () => {
  const review = fake();
  await assert.rejects(runMatrix({ review, interventions: [], perfOptions: { pairs: () => 120 } }), /clone/);
  await run(review);
});

test('march selector keeps its receiver and describes selection even when disabled with stale uniforms', () => {
  const review = fake();
  const atmoPass = {
    enabled: false,
    selected: -1,
    uniforms: { uMarchPlanet: { value: 99 } },
    marchPlanet() { return this.selected; },
  };
  review.game = { engine: { atmoPass } };
  for (const selected of [-1, 2]) {
    atmoPass.selected = selected;
    const snapshot = capture(review);
    assert.equal(snapshot.marchPlanet, selected);
    assert.equal(snapshot.marchPlanetEvidence.kind, 'current-selection');
    assert.equal(snapshot.marchPlanetEvidence.passExecution, 'unproven');
    assert.equal(atmoPass.uniforms.uMarchPlanet.value, 99);
  }
});
