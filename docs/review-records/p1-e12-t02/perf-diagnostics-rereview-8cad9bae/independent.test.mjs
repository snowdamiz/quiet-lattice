import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capture, runMatrix, toggle, timingEvidence, passTimerPlan } from 'file:///Users/andreyyurlov/.t3/worktrees/space/t3-02adc2f8/packages/tools/src/diagnostics/review-performance/index.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const fake = () => ({ root: { visible: false }, case: 'noon-lush', lodLevel: 0, perf: async () => ({}) });
const receipt = () => ({ runs: [], errors: [] });
const run = (review, interventions = [], result = receipt(), extra = {}) => runMatrix({ review, interventions, receipt: result, repetitions: 2, ...extra });
const outcome = async promise => { try { return { rejected: false, value: await promise }; } catch (error) { return { rejected: true, error }; } };
const rawTiming = () => ({ gpuTiming: 'EXT_disjoint_timer_query_webgl2', scene: { gpuMsMedian: 25, gpuMsP95: 30, gpuSamples: 120, disjoint: 0 }, withoutAsset: { gpuMsMedian: 24, gpuMsP95: 29, gpuSamples: 120, disjoint: 0 } });

for (const [label, primary] of [['undefined',undefined], ['null',null], ['false',false], ['zero',0], ['NaN',NaN], ['empty','']]) {
  for (const dual of [false, true]) {
    test(`async perf rejects ${label}; ${dual ? 'falsy cleanup is aggregated' : 'single raw rejection is retained'}`, async () => {
      const review = fake(), result = receipt(), target = { enabled: true };
      const adapter = toggle('bloom', target, 'enabled');
      let failed = false;
      review.perf = async () => { await tick(); if (!target.enabled) { failed = true; review.root.visible = true; throw primary; } return {}; };
      adapter.restore = async saved => { await tick(); target.enabled = saved; if (failed && dual) throw false; };
      const o = await outcome(run(review, [adapter], result));
      assert.equal(o.rejected, true);
      if (dual) { assert.ok(o.error instanceof AggregateError); assert.equal(o.error.errors.length, 2); assert.ok(Object.is(o.error.errors[0], primary)); assert.equal(o.error.errors[1], false); }
      else assert.ok(Object.is(o.error, primary));
      const failures = JSON.parse(JSON.stringify(result)).failures;
      assert.deepEqual(failures[0], { id: 'bloom', repetition: 0, arm: 'B', phase: 'perf', error: String(primary) });
      if (dual) assert.equal(failures[1].phase, 'restore');
      assert.equal(result.runs.length, 4);
      assert.equal(result.runs.at(-1).failures[0].error, String(primary));
      assert.equal(target.enabled, true); assert.equal(review.root.visible, false);
      review.perf = async () => ({}); await run(review);
    });
  }
}

for (const [label, primary] of [['string','apply rejected'],['object',{ message: 'object rejection', code: 'E_APPLY' }],['symbol',Symbol('apply')],['bigint',23n]]) {
  test(`async apply raw ${label} survives restoration by identity and in phase context`, async () => {
    const review = fake(), result = receipt(), target = { enabled: true };
    const adapter = toggle('bloom', target, 'enabled');
    adapter.apply = async (arm, saved) => { target.enabled = arm === 'A' ? saved : !saved; await tick(); if (arm === 'B') throw primary; };
    const o = await outcome(run(review, [adapter], result));
    assert.equal(o.rejected, true); assert.equal(o.error, primary);
    assert.deepEqual(result.failures, [{ id: 'bloom', repetition: 0, arm: 'B', phase: 'apply', error: String(primary) }]);
    assert.equal(target.enabled, true); assert.equal(review.root.visible, false);
    JSON.stringify(result); await run(review);
  });
}

test('error summaries survive cleanup mutating and rethrowing the original Error object', async () => {
  const review = fake(), result = receipt(), target = { enabled: true };
  const adapter = toggle('bloom', target, 'enabled');
  const primary = new Error('primary before cleanup');
  let failed = false;
  review.perf = async () => { await tick(); if (!target.enabled) { failed = true; throw primary; } return {}; };
  adapter.restore = async saved => { await tick(); target.enabled = saved; if (failed) { primary.message = 'mutated during cleanup'; throw primary; } };
  const o = await outcome(run(review, [adapter], result));
  assert.ok(o.error instanceof AggregateError);
  assert.deepEqual(o.error.errors, [primary, primary]);
  assert.deepEqual(result.failures.map(f => [f.phase, f.error]), [['perf', 'Error: primary before cleanup'], ['restore','Error: mutated during cleanup']]);
  assert.equal(result.runs.at(-1).failures[0].error, 'Error: primary before cleanup');
  assert.match(o.error.message, /primary before cleanup/); assert.match(o.error.message, /mutated during cleanup/);
  JSON.stringify(result); assert.equal(target.enabled, true);
  review.perf = async () => ({}); await run(review);
});

test('async cleanup restores state then rejects; verification and root restoration still run', async () => {
  const review = fake(), result = receipt(), target = { enabled: true };
  const adapter = toggle('bloom', target, 'enabled');
  let failed = false, cleanupVerified = false;
  review.perf = async () => { await tick(); if (!target.enabled) { failed = true; review.root.visible = true; throw new Error('primary'); } return {}; };
  adapter.restore = async saved => { await tick(); target.enabled = saved; if (failed) throw new Error('partial cleanup failure'); };
  const matches = adapter.matches;
  adapter.matches = (arm, saved, observed) => { if (failed && arm === 'A') cleanupVerified = true; return matches(arm, saved, observed); };
  const o = await outcome(run(review, [adapter], result));
  assert.ok(o.error instanceof AggregateError);
  assert.equal(cleanupVerified, true); assert.equal(target.enabled, true); assert.equal(review.root.visible, false);
  assert.deepEqual(result.failures.map(f => f.phase), ['perf','restore']);
  review.perf = async () => ({}); await run(review);
});

test('root setter mutates then rejects and still gets independently verified', async () => {
  const review = fake(), result = receipt();
  let visible = false, failed = false, readsAfterSetter = 0;
  Object.defineProperty(review.root, 'visible', { get() { if (failed && !visible) readsAfterSetter++; return visible; }, set(v) { visible = v; if (failed) throw null; } });
  review.perf = async () => { await tick(); review.root.visible = true; failed = true; throw false; };
  const o = await outcome(run(review, [], result));
  assert.ok(o.error instanceof AggregateError); assert.deepEqual(o.error.errors, [false,null]);
  assert.deepEqual(result.failures.map(f => f.phase), ['perf','restore-root']);
  assert.equal(visible, false); assert.ok(readsAfterSetter > 0);
  failed = false; review.perf = async () => ({}); await run(review);
});

test('frozen errors array during cleanup preserves the primary and write failure in the throw', async () => {
  const review = fake(), result = receipt(), target = { enabled: true };
  const adapter = toggle('bloom', target, 'enabled');
  const primary = new Error('primary'); let failed = false;
  review.perf = async () => { if (!target.enabled) { failed = true; throw primary; } return {}; };
  adapter.restore = async saved => { await tick(); target.enabled = saved; if (failed) Object.freeze(result.errors); };
  const o = await outcome(run(review, [adapter], result));
  assert.ok(o.error instanceof AggregateError); assert.equal(o.error.errors[0], primary);
  assert.ok(o.error.errors[1] instanceof TypeError);
  assert.deepEqual(result.failures.map(f => f.phase), ['perf','receipt-write']);
  assert.equal(target.enabled, true); review.perf = async () => ({}); await run(review);
});

for (const phase of ['setup','save']) {
  test(`falsy ${phase} failure is contextual and releases the guard`, async () => {
    const review = fake(), result = receipt();
    const adapter = { id: 'save-only', save() { throw undefined; } };
    if (phase === 'setup') Object.defineProperty(review, 'root', { configurable: true, get() { throw undefined; } });
    const o = await outcome(run(review, phase === 'save' ? [adapter] : [], result));
    assert.equal(o.rejected, true); assert.equal(o.error, undefined); assert.equal(result.failures[0].phase, phase);
    assert.equal(result.failures[0].repetition, null); assert.equal(result.failures[0].arm, null);
    if (phase === 'setup') Object.defineProperty(review, 'root', { value: { visible: false } });
    await run(review);
  });
}

test('successful default multi-intervention flow awaits async mutations, restores both controls and detaches raw data', async () => {
  const review = fake(), a = { enabled: true }, b = { enabled: false }, calls = [], result = receipt();
  const raw = rawTiming(); raw.errors = []; raw.inventory = ['original'];
  const opts = { pairs: 120, maxPairs: 720 };
  review.perf = async p => { assert.deepEqual(p, opts); p.pairs = 1; await tick(); calls.push([a.enabled,b.enabled]); review.root.visible = true; return raw; };
  const adapters = [toggle('a',a,'enabled'),toggle('b',b,'enabled')];
  for (const adapter of adapters) { const apply = adapter.apply, restore = adapter.restore; adapter.apply = async (...args) => { await tick(); apply(...args); }; adapter.restore = async (...args) => { await tick(); restore(...args); }; }
  const got = await runMatrix({ review, interventions: adapters, receipt: result, perfOptions: opts });
  assert.equal(got, result); assert.equal(calls.length, 25); assert.equal(result.runs.length, 25);
  const pattern = ['A','B','B','A','A','B','B','A','A','B'];
  assert.deepEqual(result.runs.slice(0,5).map(r => r.id), Array(5).fill('baseline-reproduction'));
  assert.deepEqual(result.runs.slice(5,15).map(r => r.arm), pattern); assert.deepEqual(result.runs.slice(15).map(r => r.arm), pattern);
  assert.deepEqual(calls.slice(5,15), pattern.map(arm => [arm === 'A', false]));
  assert.deepEqual(calls.slice(15), pattern.map(arm => [true,arm !== 'A']));
  assert.equal(a.enabled, true); assert.equal(b.enabled, false); assert.equal(review.root.visible, false);
  raw.inventory[0] = 'mutated'; raw.scene.gpuMsMedian = 1; raw.errors.push('late');
  assert.deepEqual(result.runs[0].raw.inventory, ['original']); assert.equal(result.runs[0].raw.scene.gpuMsMedian, 25);
  assert.deepEqual(result.runs[0].timing.runtimeErrors, []); assert.deepEqual(result.errors, []); assert.deepEqual(result.failures, []);
  assert.equal(opts.pairs, 120);
  for (const row of result.runs) { assert.equal(row.timing.status, 'aggregate-only'); assert.equal(row.timing.performanceFixed, false); assert.equal(row.timing.attribution, 'unproven'); }
  JSON.stringify(result); await run(review);
});

test('march selection is called with receiver; absent and failing adapters stay distinct in reasons', () => {
  const review = fake();
  assert.equal(capture(review).marchPlanet.status, 'unknown');
  const pass = { enabled: false, selected: -1, calls: 0, uniforms: { uMarchPlanet: { value: 77 } }, marchPlanet() { assert.equal(this, pass); this.calls++; return this.selected; } };
  review.game = { engine: { atmoPass: pass } };
  for (const value of [-1,0,3]) { pass.selected = value; const c = capture(review); assert.equal(c.marchPlanet,value); assert.deepEqual(c.marchPlanetEvidence, { kind:'current-selection',passExecution:'unproven' }); }
  assert.equal(pass.calls,3); assert.equal(pass.uniforms.uMarchPlanet.value,77);
  pass.marchPlanet = () => { throw new Error('selector adapter failure'); };
  assert.match(capture(review).marchPlanet.reason,/selector adapter failure/);
  delete pass.marchPlanet;
  assert.match(capture(review).marchPlanet.reason,/not a function/);
});

test('unavailable hardware remains unknown and valid aggregate timings never admit runtime or a performance result', () => {
  const snapshot = capture(fake());
  for (const key of ['backend','vendor','renderer','device','viewport','composer','passes','marchPlanet','counters','shadows']) assert.equal(snapshot[key].status,'unknown');
  for (const value of Object.values(snapshot.host)) assert.equal(value.status,'unknown');
  const evidence = timingEvidence(rawTiming());
  assert.equal(evidence.status,'aggregate-only'); assert.equal(evidence.performanceFixed,false); assert.equal(evidence.attribution,'unproven');
  for (const key of ['pendingQueries','lostQueries','rawSamples','runtimeErrors']) assert.equal(evidence[key].status,'unknown');
  assert.equal(passTimerPlan.status,'pending');
});

// Contract probes for raw non-Error rejection values without a string conversion.
const rawError = message => Object.assign(Object.create(null), { message, code: 'E_RAW' });
test('R1 raw primary without toString remains in the serializable failure receipt', async () => {
  const review = fake(), result = receipt(), target = { enabled: true }, primary = rawError('raw primary cause');
  const adapter = toggle('bloom', target, 'enabled');
  let failed = false;
  review.perf = async () => { await tick(); if (!target.enabled) { failed = true; throw primary; } return {}; };
  adapter.restore = async saved => { await tick(); target.enabled = saved; if (failed) throw new Error('cleanup cause'); };
  const o = await outcome(run(review, [adapter], result));
  assert.equal(o.rejected,true); assert.ok(o.error instanceof AggregateError); assert.equal(o.error.errors[0],primary);
  assert.equal(target.enabled,true); review.perf = async () => ({}); await run(review);
  assert.ok(result.failures.some(f => f.phase === 'perf' && f.error.includes('raw primary cause')), JSON.stringify(result.failures));
});

test('R1 raw restore failure cannot skip restoration verification', async () => {
  const review = fake(), result = receipt(), target = { enabled: true };
  const adapter = toggle('bloom', target, 'enabled');
  let failed = false, verified = false;
  review.perf = async () => { await tick(); if (!target.enabled) { failed = true; review.root.visible = true; throw new Error('primary'); } return {}; };
  adapter.restore = async saved => { await tick(); target.enabled = saved; if (failed) throw rawError('raw cleanup cause'); };
  const matches = adapter.matches;
  adapter.matches = (arm,saved,observed) => { if (failed && arm === 'A') verified = true; return matches(arm,saved,observed); };
  const o = await outcome(run(review,[adapter],result));
  assert.equal(o.rejected,true); assert.equal(target.enabled,true); assert.equal(review.root.visible,false);
  review.perf = async () => ({}); await run(review);
  assert.equal(verified,true, 'raw cleanup error prevented the separate verify-restoration step');
});

test('R1 raw root-cleanup failure cannot prevent receipt persistence and root verification', async () => {
  const review = fake(), result = receipt();
  let visible = false, failed = false, verified = false;
  Object.defineProperty(review.root,'visible',{ get() { if (failed) verified = true; return visible; }, set(v) { if (failed) throw rawError('raw root failure'); visible = v; } });
  review.perf = async () => { await tick(); review.root.visible = true; failed = true; throw new Error('primary perf'); };
  const o = await outcome(run(review,[],result));
  assert.equal(o.rejected,true);
  failed = false; review.perf = async () => ({}); await run(review);
  assert.ok(result.failures?.some(f => f.phase === 'perf'), `receipt failure summary missing: ${JSON.stringify({errors:result.errors,failures:result.failures,thrown:String(o.error)})}`);
  assert.equal(verified,true);
});
