// Actual entry/default loader/shared capture. Only external runtime/type-loading ports are inert.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import cp from 'node:child_process';
const D = path.dirname(fileURLToPath(import.meta.url));
const R = fs.mkdtempSync('/private/tmp/effects-entry-capture-controls-');
const pinned = JSON.parse(fs.readFileSync(path.join(D, 'readiness.json')));
const originalWrite = fs.writeFileSync.bind(fs);
const put = (file, value) => originalWrite(file, JSON.stringify(value));
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  cp[name] = () => {
    throw Error('FORBIDDEN_CHILD:' + name);
  };
}
syncBuiltinESMExports();
let mode,
  trace = [];
const primary = Object.freeze(Object.assign(Error('PRIMARY_PAGE_GOTO'), { partial: Buffer.from([0, 255]), unknown: { original: true } }));
const browserError = Object.freeze(Object.assign(Error('SECONDARY_BROWSER_CLOSE'), { partial: Buffer.from([1, 255]), unknown: { cleanup: true } }));
const viteError = Object.freeze(Object.assign(Error('SECONDARY_VITE_CLOSE'), { partial: Buffer.from([2, 255]), unknown: { cleanup: 'vite' } }));
const listenError = Object.freeze(Object.assign(Error('PRIMARY_LISTEN'), { partial: Buffer.from([3, 255]) }));
const launchError = Object.freeze(Object.assign(Error('PRIMARY_LAUNCH'), { partial: Buffer.from([4, 255]) }));
const page = {
  on() {},
  addInitScript: async () => {},
  goto: async () => {
    trace.push('goto');
    throw mode.work;
  },
};
const browser = {
  newPage: async () => page,
  close: async () => {
    trace.push('browser.close');
    if (mode.browser) throw browserError;
  },
};
globalThis.__effectsInertChrome = {
  launch: async () => {
    trace.push('launch');
    if (mode.launch) throw launchError;
    return browser;
  },
};
globalThis.__effectsInertVite = {
  listen: async () => {
    trace.push('listen');
    if (mode.listen) throw listenError;
  },
  close: async () => {
    trace.push('vite.close');
    if (mode.vite) throw viteError;
  },
};
globalThis.__effectsInertNet = () => ({
  listen(_p, _h, cb) {
    cb();
  },
  address() {
    return { port: 12345 };
  },
  close(cb) {
    cb();
  },
});
const loaded = [];
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@playwright/test') return { url: 'inert:pw', shortCircuit: true };
    if (spec === 'vite') return { url: 'inert:vite', shortCircuit: true };
    if (spec === 'node:net' && ctx.parentURL?.endsWith('/capture.ts')) return { url: 'inert:net', shortCircuit: true };
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === 'inert:pw') return { format: 'module', source: 'export const chromium=globalThis.__effectsInertChrome;', shortCircuit: true };
    if (url === 'inert:vite') return { format: 'module', source: 'export const createServer=async()=>globalThis.__effectsInertVite;', shortCircuit: true };
    if (url === 'inert:net') return { format: 'module', source: 'export const createServer=globalThis.__effectsInertNet;', shortCircuit: true };
    if (url === pathToFileURL(pinned.tsxApi).href) return { format: 'commonjs', source: 'exports.tsImport=(url)=>import(url);', shortCircuit: true };
    if (url.endsWith('/capture/screens.ts')) return { format: 'module', source: 'export const SCREENS={};', shortCircuit: true };
    if (url.endsWith('/capture/capture.ts') || url.endsWith('/capture/classes.ts')) {
      loaded.push(url);
      return { format: 'module', source: stripTypeScriptTypes(fs.readFileSync(new URL(url), 'utf8')), shortCircuit: true };
    }
    return next(url, ctx);
  },
});
const { execute, snapshot, outputPlan } = await import(pathToFileURL(path.join(D, 'entry.mjs')));
function fixture() {
  const dir = fs.mkdtempSync(R + '/case-'),
    output = dir + '/output',
    evidence = dir + '/evidence';
  fs.mkdirSync(output);
  fs.mkdirSync(evidence);
  const pilot = {
    file: 'effects/gravitic',
    asset: 'gravitic_pull',
    gl: 'metal',
    viewport: [1920, 1080],
    files: outputPlan(),
    output,
    evidence,
    grant: dir + '/grant.json',
    consumption: dir + '/consumption.json',
    authorizationId: dir,
  };
  const readyPath = dir + '/ready.json';
  put(readyPath, { ...pinned, runtimeEnabled: true, pilot });
  const readySha = snapshot(readyPath).sha256,
    source = { head: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true },
    review = dir + '/review.json';
  put(review, { source, verdict: 'PASS', scope: 'INDEPENDENT_EFFECTS_PILOT_CALLER_REVIEW' });
  const grant = {
    purpose: 'EFFECTS_GRAVITIC_PULL_SINGLE_DISABLED_PILOT',
    oneUse: true,
    nativeReservesAccepted: true,
    expiresAt: '2099-01-01T00:00:00Z',
    pilot,
    authorizationId: dir,
    source,
    readinessSha256: readySha,
    callerReview: { path: review, sha256: snapshot(review).sha256 },
  };
  put(pilot.grant, grant);
  put(pilot.consumption, {
    state: 'CONSUMED',
    accepted: false,
    grantSha256: snapshot(pilot.grant).sha256,
    readinessSha256: readySha,
    source,
    pilot,
    authorizationId: dir,
  });
  put(evidence + '/prelaunch-source.json', source);
  process.env.EFFECTS_AUTHORIZATION = dir;
  process.env.EFFECTS_READY_SHA256 = readySha;
  process.env.SMOKE_GL = 'metal';
  return { dir, readyPath, evidence };
}
const cases = [
  { name: 'goto-only', work: primary },
  { name: 'goto-browser', work: primary, browser: true },
  { name: 'goto-vite', work: primary, vite: true },
  { name: 'goto-both', work: primary, browser: true, vite: true },
  { name: 'listen-close', listen: true, vite: true },
  { name: 'launch-close', launch: true, vite: true },
  { name: 'goto-all-sinks', work: primary, browser: true, vite: true, sinks: true },
  ...[undefined, null, false, 0, '', Object.freeze({ raw: Buffer.from([5, 255]), ownership: null })].map((work, i) => ({
    name: 'raw-work-' + i,
    work,
    browser: true,
    vite: true,
  })),
];
const expectedRaw = (value) =>
  value === undefined
    ? { type: 'undefined' }
    : Buffer.isBuffer(value)
      ? { type: 'Buffer', base64: value.toString('base64') }
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.getOwnPropertyNames(value).map((k) => [k, expectedRaw(value[k])]))
        : value;
const results = [];
for (mode of cases) {
  trace = [];
  const f = fixture();
  const options = { enabled: true, readyPath: f.readyPath, verify: () => {} };
  if (mode.sinks) {
    options.metadataWriter = (file, data, opts) => {
      if (['entry.json', 'failed-entry.json'].includes(path.basename(file))) throw Error('PUBLICATION_DENIED');
      originalWrite(file, data, opts);
    };
    options.stderr = () => {
      throw Error('STDERR_DENIED');
    };
  }
  const result = await execute(options); // Default loadCapture + actual captureReview/openReview/finishCapture.
  const durable = mode.sinks ? null : snapshot(f.evidence + '/entry.json').value;
  results.push({
    name: mode.name,
    trace: [...trace],
    result,
    durable,
    dir: f.dir,
    inMemoryCausePresent: Object.hasOwn(result.errors[0].error, 'cause'),
    diskCausePresent: durable !== null && Object.hasOwn(durable.errors[0].error, 'cause'),
  });
  put(R + '/results.json', { results, loaded, nativeLaunches: 0 }); // Before assertions: retain any new boundary defect.
  assert.equal(result.accepted, false);
  const work = mode.listen ? listenError : mode.launch ? launchError : mode.work;
  const expected = [
    expectedRaw(work),
    ...(!mode.listen && !mode.launch && mode.browser ? [expectedRaw(browserError)] : []),
    ...(mode.vite ? [expectedRaw(viteError)] : []),
  ];
  const error = result.errors[0].error;
  if (expected.length === 1) assert.deepEqual(error, expected[0]);
  else {
    assert.deepEqual(error.errors, expected);
    assert.deepEqual(error.cause, expected[0]);
  }
  assert.equal(trace.filter((x) => x === 'browser.close').length, mode.listen || mode.launch ? 0 : 1);
  assert.equal(trace.filter((x) => x === 'vite.close').length, 1);
  assert.equal(trace.filter((x) => x === 'launch').length, mode.listen ? 0 : 1);
  if (durable) assert.deepEqual(durable.errors, result.errors);
  else assert.equal(result.errors.at(-1).phase, 'entry-stderr-fallback');
}
process.stdout.write(JSON.stringify({ cases: results.length, evidence: R, defaultProductionLoader: true, nativeLaunches: 0 }) + '\n');
