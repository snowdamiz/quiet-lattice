import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capture, runMatrix, toggle } from './source-snapshot/index.mjs';

const opaque = 'Unprintable rejection value';
const raw = message => Object.assign(Object.create(null), { message });
const revoked = () => { const pair = Proxy.revocable({}, {}); pair.revoke(); return pair.proxy; };
const rejected = async promise => {
  try { await promise; } catch (error) { return error; }
  assert.fail('expected rejection');
};
const run = (review, interventions, receipt = { runs: [], errors: [] }) => runMatrix({ review, interventions, receipt, repetitions: 2 });

// Distinct hostile originals test ordering, including the after-observation boundaries;
// the author's all-boundaries test reuses one original at perf/restore/root restore.
for (const brokenReceipt of [false, true]) {
  test(`distinct hostile causes keep their order through all cleanup and ${brokenReceipt ? 'failed' : 'successful'} receipt persistence`, async () => {
    const formattingFailure = new Error('formatting must not become a recorded failure');
    const primary = { [Symbol.toPrimitive]() { throw formattingFailure; }, get message() { throw formattingFailure; } };
    const captureFailure = raw('after capture cause');
    const observeFailure = revoked();
    const restoreFailure = { get [Symbol.toPrimitive]() { throw formattingFailure; }, message: 'restore cause' };
    const verifyFailure = Object.defineProperty(Object.create(null), 'message', { get() { throw formattingFailure; } });
    const rootFailure = Object.assign(Object.create(null), { valueOf() { throw formattingFailure; }, message: 'root cause' });
    const rootVerifyFailure = { toString() { throw formattingFailure; }, message: 'root verification cause' };
    const writeFailure = revoked();
    const originals = [primary, captureFailure, observeFailure, restoreFailure, verifyFailure, rootFailure, rootVerifyFailure];
    const descriptions = [opaque, 'after capture cause', opaque, 'restore cause', opaque, 'root cause', 'root verification cause'];
    const phases = ['perf', 'capture-after', 'observe-after', 'restore', 'verify-restoration', 'restore-root', 'verify-root-restoration'];
    const target = { enabled: true }, adapter = toggle('bloom', target, 'enabled'), receipt = { runs: [], errors: [] };
    const attempts = [];
    let failing = false, restoring = false, restoringRoot = false, visible = false;
    const review = { root: {} };
    Object.defineProperty(review, 'case', { get() { if (failing) { attempts.push('capture-after'); throw captureFailure; } return 'noon-lush'; } });
    Object.defineProperty(review.root, 'visible', {
      get() { if (restoringRoot) { attempts.push('verify-root-restoration'); throw rootVerifyFailure; } return visible; },
      set(value) { if (failing) { attempts.push('restore-root'); restoringRoot = true; throw rootFailure; } visible = value; },
    });
    review.perf = async () => {
      if (!target.enabled) { visible = true; failing = true; throw primary; }
      return {};
    };
    adapter.observe = () => {
      if (failing) { const phase = restoring ? 'verify-restoration' : 'observe-after'; attempts.push(phase); throw restoring ? verifyFailure : observeFailure; }
      return target.enabled;
    };
    adapter.restore = saved => {
      if (failing) { attempts.push('restore'); restoring = true; throw restoreFailure; }
      target.enabled = saved;
    };
    if (brokenReceipt) {
      Object.defineProperty(receipt, 'errors', { get() { attempts.push('receipt-write'); throw writeFailure; } });
      originals.push(writeFailure); descriptions.push(opaque); phases.push('receipt-write');
    }
    const error = await rejected(run(review, [adapter], receipt));
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, originals.length);
    originals.forEach((cause, i) => assert.ok(Object.is(error.errors[i], cause), `original ${i}`));
    assert.deepEqual(attempts, phases.slice(1));
    const expected = phases.map((phase, i) => ({ id: 'bloom', repetition: 0, arm: 'B', phase, error: descriptions[i] }));
    assert.deepEqual(JSON.parse(JSON.stringify(receipt.failures)), expected);
    assert.deepEqual(receipt.runs.at(-1).failures, expected.slice(0, 3));
    if (!brokenReceipt) {
      JSON.stringify(receipt);
      assert.equal(error.message, receipt.errors.join('\n'));
      assert.equal(receipt.errors.length, originals.length);
    }
    assert.equal(target.enabled, false, 'a failed restore is not claimed as restored');
    assert.equal(visible, true, 'a failed root setter is not claimed as restored');
    failing = false; restoring = false; restoringRoot = false;
    review.perf = async () => ({});
    await run(review, []);
  });
}

test('successful coercion avoids hostile message access in capture and setup; setup guard releases', async () => {
  let coercions = 0, messageReads = 0;
  const cause = {
    [Symbol.toPrimitive](hint) { assert.equal(hint, 'string'); coercions++; return 'coercion won'; },
    get message() { messageReads++; throw new Error('message must not be accessed'); },
  };
  const review = { root: { visible: false }, perf: async () => ({}) };
  review.game = { engine: { atmoPass: { marchPlanet() { throw cause; } } } };
  assert.deepEqual(capture(review).marchPlanet, { status: 'unknown', reason: 'coercion won' });
  Object.defineProperty(review, 'root', { configurable: true, get() { throw cause; } });
  const receipt = { runs: [], errors: [] };
  assert.ok(Object.is(await rejected(run(review, [], receipt)), cause));
  assert.deepEqual(receipt.failures, [{ id: 'matrix', repetition: null, arm: null, phase: 'setup', error: 'coercion won' }]);
  assert.equal(coercions, 2); assert.equal(messageReads, 0);
  Object.defineProperty(review, 'root', { value: { visible: false } });
  delete review.game;
  await run(review, []);
});
