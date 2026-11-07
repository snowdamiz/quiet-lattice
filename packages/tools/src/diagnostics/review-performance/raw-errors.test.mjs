import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capture, runMatrix, toggle } from './index.mjs';

const opaque = 'Unprintable rejection value';
const raw = message => Object.assign(Object.create(null), { message });
const revoked = () => {
  const pair = Proxy.revocable({}, {});
  pair.revoke();
  return pair.proxy;
};
const values = [
  ['null prototype', () => raw('raw cause'), 'raw cause'],
  ['throwing conversion', () => ({ message: 'conversion cause', [Symbol.toPrimitive]() { throw 0; } }), 'conversion cause'],
  ['conversion getter', () => ({ message: 'getter cause', get [Symbol.toPrimitive]() { throw null; } }), 'getter cause'],
  ['toString getter', () => ({ message: 'toString cause', get toString() { throw false; } }), 'toString cause'],
  ['invalid conversion result', () => ({ message: 'invalid conversion', [Symbol.toPrimitive]() { return {}; } }), 'invalid conversion'],
  ['empty message', () => raw(''), ''],
  ['missing message', () => Object.create(null), opaque],
  ['throwing message getter', () => Object.defineProperty(Object.create(null), 'message', { get() { throw undefined; } }), opaque],
  ['nonstring message', () => raw({ [Symbol.toPrimitive]() { throw new Error('must not coerce message'); } }), opaque],
  ['hostile proxy', () => new Proxy({}, { get() { throw 0; }, getPrototypeOf() { throw false; } }), opaque],
  ['revoked proxy', revoked, opaque],
];
const run = (review, interventions, receipt) => runMatrix({ review, interventions, receipt, repetitions: 2 });
const caught = async promise => {
  try { await promise; } catch (error) { return { error }; }
  assert.fail('expected rejection');
};

for (const [label, makeValue, description] of values) {
  test(`${label}: original causes survive every cleanup boundary and receipt write`, async () => {
    const value = makeValue();
    const target = { enabled: true };
    const adapter = toggle('bloom', target, 'enabled');
    const receipt = { runs: [], errors: [] };
    const review = { root: {}, case: 'noon-lush' };
    const attempts = [];
    let failed = false, visible = false, rootRestored = false;
    Object.defineProperty(review.root, 'visible', {
      get() {
        if (failed && rootRestored) { attempts.push('verify-root'); throw null; }
        return visible;
      },
      set(next) {
        visible = next;
        if (failed) { attempts.push('restore-root'); rootRestored = true; throw value; }
      },
    });
    review.perf = async () => {
      if (!target.enabled) { visible = true; failed = true; throw value; }
      return {};
    };
    adapter.restore = async saved => {
      target.enabled = saved;
      if (failed) { attempts.push('restore'); throw value; }
    };
    const matches = adapter.matches;
    adapter.matches = (arm, saved, observed) => {
      if (failed && arm === 'A') { attempts.push('verify-restoration'); throw false; }
      return matches(arm, saved, observed);
    };

    const { error } = await caught(run(review, [adapter], receipt));
    assert.ok(error instanceof AggregateError);
    const originals = [value, value, false, value, null];
    assert.equal(error.errors.length, originals.length);
    originals.forEach((original, index) => assert.ok(Object.is(error.errors[index], original)));
    assert.deepEqual(attempts, ['restore', 'verify-restoration', 'restore-root', 'verify-root']);
    assert.equal(target.enabled, true);
    assert.equal(visible, false);
    const failures = JSON.parse(JSON.stringify(receipt)).failures;
    const phases = ['perf', 'restore', 'verify-restoration', 'restore-root', 'verify-root-restoration'];
    assert.deepEqual(failures, phases.map((phase, index) => ({
      id: 'bloom', repetition: 0, arm: 'B', phase,
      error: [description, description, 'false', description, 'null'][index],
    })));
    assert.deepEqual(receipt.runs.at(-1).failures, failures.slice(0, 1));
    assert.equal(receipt.errors.length, originals.length);
    assert.equal(error.message, receipt.errors.join('\n'));
    for (const [index, phase] of phases.entries()) {
      assert.ok(receipt.errors[index].includes(`bloom repetition=0 arm=B phase=${phase}: ${failures[index].error}`));
    }
    failed = false;
    review.perf = async () => ({});
    await run(review, [], { runs: [], errors: [] });
  });
}

test('a single opaque rejection is rethrown unchanged with a serializable receipt', async () => {
  const primary = revoked();
  const review = { root: { visible: false }, perf: async () => { throw primary; } };
  const receipt = { runs: [], errors: [] };
  assert.ok(Object.is((await caught(run(review, [], receipt))).error, primary));
  assert.equal(JSON.parse(JSON.stringify(receipt)).failures[0].error, opaque);
});

for (const field of ['failures', 'errors']) {
  test(`hostile receipt ${field} access remains a failure and preserves original causes`, async () => {
    const writeFailure = revoked();
    const review = { root: { visible: false }, perf: async () => { review.root.visible = true; throw 0; } };
    const receipt = { runs: [], errors: [] };
    let writes = 0;
    const reject = () => { writes++; throw writeFailure; };
    Object.defineProperty(receipt, field, field === 'failures' ? { set: reject } : { get: reject });
    const { error } = await caught(run(review, [], receipt));
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.ok(Object.is(error.errors[0], 0));
    assert.ok(Object.is(error.errors[1], writeFailure));
    assert.match(error.message, /phase=receipt-write: Unprintable rejection value/);
    assert.equal(writes, 1);
    assert.equal(review.root.visible, false);
    if (field === 'errors') assert.deepEqual(receipt.failures.map(f => f.phase), ['perf', 'receipt-write']);
    review.perf = async () => ({});
    await run(review, [], { runs: [], errors: [] });
  });
}

test('capture records raw selector failures without failing during formatting', () => {
  for (const [, makeValue, description] of values) {
    const value = makeValue();
    const review = { game: { engine: { atmoPass: { marchPlanet() { throw value; } } } } };
    const snapshot = capture(review);
    assert.deepEqual(snapshot.marchPlanet, { status: 'unknown', reason: description });
    assert.equal(snapshot.marchPlanetEvidence.passExecution, 'unproven');
    JSON.stringify(snapshot);
  }
});
