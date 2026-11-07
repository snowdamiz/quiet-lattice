import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const s = globalThis.__playthroughReview;
const originalLog = console.log;
const originalExitCode = process.exitCode;
const { runPlaythrough } = await import(pathToFileURL(process.env.REVIEW_TARGET).href);
assert.deepEqual(s.trace, [], 'import must not acquire resources');
const logs = [];
beforeEach(() => {
  s.trace.length = 0;
  s.faults.clear();
  s.hook = undefined;
  s.config = {};
  delete s.closePromise;
  delete s.stopPromise;
  logs.length = 0;
  console.log = (...args) => logs.push(args);
});
afterEach(() => {
  console.log = originalLog;
  process.exitCode = originalExitCode;
  delete globalThis.window;
});
async function outcome(promise) {
  return promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
}
function raw(actual, expected) {
  assert.equal(actual.ok, false);
  assert.ok(Object.is(actual.error, expected), 'raw rejection identity changed');
}
function aggregate(actual, values) {
  assert.equal(actual.ok, false);
  assert.ok(actual.error instanceof AggregateError);
  assert.ok(Object.hasOwn(actual.error, 'cause'));
  assert.ok(Object.is(actual.error.cause, values[0]));
  assert.equal(actual.error.errors.length, values.length);
  values.forEach((value, i) => assert.ok(Object.is(actual.error.errors[i], value), 'raw value/order changed at ' + i));
}
function counts(browserOwned) {
  assert.equal(s.trace.filter(v => v === 'close').length, browserOwned ? 1 : 0);
  assert.equal(s.trace.filter(v => v === 'stop').length, 1);
  if (browserOwned) assert.ok(s.trace.indexOf('close') < s.trace.indexOf('stop'));
}
const values = [
  ['undefined', undefined], ['null', null], ['false', false], ['zero', 0], ['empty', ''],
  ['negative-zero', -0], ['NaN', NaN], ['object', Object.freeze({ reason: 'probe' })],
  ['abort', new DOMException('probe cancelled', 'AbortError')],
];
const stages = ['glArgs.args', 'launch', 'newPage', 'on:pageerror', 'on:console', 'url', 'ready', 'initialize', 'phase:leave', 'dockState', 'close', 'stop'];
for (const stage of stages) for (const [name, value] of values) {
  test('single raw failure: ' + stage + ' / ' + name, async () => {
    s.faults.set(stage, value);
    raw(await outcome(runPlaythrough(['leave', 'dock'])), value);
    counts(!['glArgs.args', 'launch'].includes(stage));
    if (stage === 'glArgs.args') assert.equal(s.trace.includes('launch'), false);
  });
}
for (let rotation = 0; rotation < 3; rotation++) for (let i = 0; i < 5; i++) {
  test('falsy triple preserves identity/order: rotation ' + rotation + ' case ' + i, async () => {
    const v = [values[i][1], values[(i + rotation + 1) % 5][1], values[(i + rotation + 2) % 5][1]];
    s.faults.set('goto', v[0]); s.faults.set('close', v[1]); s.faults.set('stop', v[2]);
    aggregate(await outcome(runPlaythrough(['leave'])), v);
    counts(true);
  });
}
for (const stage of ['startVite', 'glArgs', 'goto']) {
  test('AbortError is retained at ' + stage, async () => {
    const abort = new DOMException(stage + ' cancelled', 'AbortError');
    s.faults.set(stage, abort);
    raw(await outcome(runPlaythrough(['leave'])), abort);
    if (stage === 'startVite') assert.deepEqual(s.trace, ['startVite']);
    else counts(stage === 'goto');
  });
}
test('console output throw remains raw and releases both owners', async () => {
  console.log = () => { throw undefined; };
  raw(await outcome(runPlaythrough(['leave'])), undefined);
  counts(true);
});
test('cleanup aggregates retain repeated references without deduplicating', async () => {
  const value = Object.freeze({ repeated: true });
  for (const stage of ['goto', 'close', 'stop']) s.faults.set(stage, value);
  aggregate(await outcome(runPlaythrough(['leave'])), [value, value, value]);
  counts(true);
});
test('a reported phase failure does not hide cleanup rejection', async () => {
  s.config.phaseResults = { leave: 'fail' };
  s.faults.set('stop', false);
  raw(await outcome(runPlaythrough(['leave', 'mine'])), false);
  assert.ok(s.trace.includes('phase:mine'));
  counts(true);
});
test('async cleanup is awaited in close then stop order', async () => {
  let failClose, failStop;
  s.closePromise = new Promise((_resolve, reject) => { failClose = reject; });
  s.stopPromise = new Promise((_resolve, reject) => { failStop = reject; });
  let finished = false;
  const result = outcome(runPlaythrough(['leave'])).then(value => { finished = true; return value; });
  const waitFor = async stage => {
    for (let i = 0; i < 20 && !s.trace.includes(stage); i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(s.trace.includes(stage), 'never reached ' + stage);
  };
  await waitFor('close');
  assert.equal(s.trace.includes('stop'), false);
  assert.equal(finished, false);
  failClose(false);
  await waitFor('stop');
  assert.equal(finished, false);
  failStop(undefined);
  aggregate(await result, [false, undefined]);
  counts(true);
});
test('real phase and dock callbacks preserve successful output', async () => {
  assert.equal(await runPlaythrough(['--', 'leave', 'dock']), 0);
  assert.deepEqual(logs, [
    ['[leave] (0s) leave ok'],
    ['[dock] (0s) dock ok'],
    ['  dock state:', '{"mode":"docked","pads":["player","npc","free"],"hud":"Docked"}'],
  ]);
  assert.deepEqual(s.pageOptions, { viewport: { width: 640, height: 360 } });
  assert.deepEqual(s.launchOptions, { args: ['--stub'] });
  assert.equal(s.url, 'http://stub.invalid/');
  assert.equal(process.exitCode, originalExitCode, 'library call must not change process exitCode');
  counts(true);
});
