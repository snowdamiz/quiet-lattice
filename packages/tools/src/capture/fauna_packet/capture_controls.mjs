// CPU-only actual default captureUi consumer. All external native/network ports are inert.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire, registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash } from 'node:crypto';
import cp from 'node:child_process';
import net from 'node:net';
const W = fs.realpathSync(new URL('../../../../..', import.meta.url));
const B = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || '/private/tmp', 'fauna-entry-controls-')));
const sha = (x) => createHash('sha256').update(x).digest('hex'),
  originalWrite = fs.writeFileSync.bind(fs),
  put = (p, v) => originalWrite(p, JSON.stringify(v, null, 2));
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
  cp[name] = () => {
    throw Error('FORBIDDEN_CHILD:' + name);
  };
net.Server.prototype.listen = net.Socket.prototype.connect = () => {
  throw Error('FORBIDDEN_NETWORK');
};
syncBuiltinESMExports();
// Load the real pinned CJS route and the package's public ESM route before fixture hooks.
// Only the browser launch port below is replaced, never either module's export shape.
const installed = JSON.parse(fs.readFileSync(new URL('./readiness.json', import.meta.url), 'utf8'));
assert.equal(process.execPath, installed.node);
const require = createRequire(installed.playwright);
const playwrightNamespace = await import(pathToFileURL(installed.playwright).href);
const playwright = require(installed.playwright);
const publicEntry = path.resolve(path.dirname(installed.playwright), require('./package.json').exports['.'].import);
const publicPlaywright = await import(pathToFileURL(publicEntry).href);
assert.equal(playwrightNamespace.default, playwright);
assert.equal(publicPlaywright.chromium, playwright.chromium);
const originalLaunch = playwright.chromium.launch;
const playwrightBinding = {
  path: installed.playwright,
  sha256: sha(fs.readFileSync(installed.playwright)),
  publicEntry,
  publicEntrySha256: sha(fs.readFileSync(publicEntry)),
  namespaceKeys: Object.keys(playwrightNamespace),
  sameBrowserObject: publicPlaywright.chromium === playwright.chromium,
};
let mode,
  trace = [];
let primary;
const loaded = [],
  sources = new Map(),
  realTS = new Map();
const navigation = Object.freeze(Object.assign(Error('PRIMARY_PAGE_GOTO'), { partial: Buffer.from([0, 255]), unknown: { original: true } }));
const secondary = Object.assign(Error('SECONDARY_BROWSER_CLOSE'), { partial: Buffer.from([1, 255]), unknown: { cleanup: true } });
const viteError = Object.assign(Error('SECONDARY_VITE_CLOSE'), { unknown: { cleanup: 'vite' } });
playwright.chromium.launch = async () => {
  trace.push('INERT-browser-port');
  return {
    newPage: async () => ({
      screenshot: async () => {
        throw Error('UNEXPECTED screenshot');
      },
      on() {},
      goto: async () => {
        trace.push('actual-captureUi-goto');
        throw primary;
      },
    }),
    close: async () => {
      trace.push('browser.close');
      if (mode === 'goto-plus-close' || mode.startsWith('combined')) throw secondary;
    },
  };
};
globalThis.__faunaVite = {
  listen: async () => {},
  close: async () => {
    trace.push('vite.close');
    if (mode === 'goto-plus-vite' || mode.startsWith('combined')) throw viteError;
  },
};
globalThis.__faunaNet = () => ({
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
registerHooks({
  resolve(spec, ctx, next) {
    if (sources.has(spec) || realTS.has(spec)) return { url: spec, shortCircuit: true };
    if (spec === '@playwright/test') return { url: pathToFileURL(publicEntry).href, shortCircuit: true };
    if (spec === pathToFileURL(installed.playwright).href || spec === pathToFileURL(publicEntry).href) return next(spec, ctx);
    if (spec === 'vite') return { url: 'inert:vite', shortCircuit: true };
    if (spec === 'node:net' && ctx.parentURL?.endsWith('/capture.ts')) return { url: 'inert:net', shortCircuit: true };
    if (spec.startsWith('./') && ctx.parentURL?.endsWith('/capture.ts')) return { url: new URL(spec, ctx.parentURL).href, shortCircuit: true };
    if (spec.startsWith('node:') || spec.endsWith('/fauna_packet/entry.mjs')) return next(spec, ctx);
    throw Error('FORBIDDEN_IMPORT:' + spec);
  },
  load(url, ctx, next) {
    if (url === 'inert:vite') return { format: 'module', source: 'export const createServer=async()=>globalThis.__faunaVite;', shortCircuit: true };
    if (url === 'inert:net') return { format: 'module', source: 'export const createServer=globalThis.__faunaNet;', shortCircuit: true };
    if (sources.has(url)) return { format: 'module', source: sources.get(url), shortCircuit: true };
    if (realTS.has(url)) {
      const source = fs.readFileSync(realTS.get(url), 'utf8');
      loaded.push({ source: realTS.get(url), sha256: sha(source) });
      return { format: 'module', source: stripTypeScriptTypes(source), shortCircuit: true };
    }
    return next(url, ctx);
  },
});
fs.writeFileSync = (file, ...args) => {
  if (mode === 'combined-all-sinks' && trace.includes('actual-captureUi-goto') && String(file).includes('/evidence/'))
    throw Object.assign(Error('RECEIPT_UNAVAILABLE'), { path: String(file), raw: Buffer.from([2, 255]) });
  return originalWrite(file, ...args);
};
const { main } = await import(new URL('./entry.mjs', import.meta.url));
const stderr = process.stderr.write.bind(process.stderr);

const results = [];
for (mode of [
  'goto-only',
  'goto-plus-close',
  'goto-plus-vite',
  'combined-errors',
  'combined-undefined',
  'combined-null',
  'combined-false',
  'combined-zero',
  'combined-empty',
  'combined-object',
  'combined-all-sinks',
]) {
  primary =
    mode === 'combined-undefined'
      ? undefined
      : mode === 'combined-null'
        ? null
        : mode === 'combined-false'
          ? false
          : mode === 'combined-zero'
            ? 0
            : mode === 'combined-empty'
              ? ''
              : mode === 'combined-object'
                ? Object.freeze({ partial: Buffer.from([0, 255]), unknown: { original: true } })
                : navigation;
  trace = [];
  const root = fs.realpathSync(fs.mkdtempSync(B + '/capture-fauna-'));
  const evidence = root + '/evidence',
    output = root + '/output';
  fs.mkdirSync(evidence);
  fs.mkdirSync(output);
  const readyPath = root + '/packages/tools/src/capture/fauna_packet/readiness.json';
  fs.mkdirSync(path.dirname(readyPath), { recursive: true });
  const unit = 'fauna-hit-turn-day-16x9',
    consumption = root + '/consumed.json';
  const spec = { kind: 'correction', aspect: '16x9', evidence, output, consumption };
  const ready = {
    runtimeEnabled: true,
    root,
    node: process.execPath,
    path: process.env.PATH,
    bindings: [],
    productBindings: {},
    tsxApi: root + '/tsx.mjs',
    esbuild: root + '/esbuild.mjs',
    playwright: installed.playwright,
    units: { [unit]: spec },
  };
  put(readyPath, ready);
  put(consumption, { unit, readinessSha256: sha(fs.readFileSync(readyPath)), spec });
  for (const [file, source] of [
    [ready.tsxApi, 'export function register(){return ()=>{}}'],
    [ready.esbuild, 'export function transformSync(){return {code:"cpu-only"}}'],
    [root + '/packages/client/src/ui/HUD.js', 'export class HUD {hitNumber(){} hitAnchor(){}}'],
    [root + '/packages/client/src/gameplay/Fauna.js', 'export class Fauna {update(){} hitAnchor(){}}'],
    [root + '/packages/client/src/net/combat.js', 'export class CombatFeed {event(){} take(){}}'],
    [
      root + '/packages/tools/src/capture/screens.ts',
      `export const SCREENS={${JSON.stringify(unit)}:{clipSeconds:1.2,clipAspect:'16x9',stills:{kill(){},offscreen(){},start(){}},open(){},motion(){}}}`,
    ],
  ])
    sources.set(pathToFileURL(file).href, source);
  for (const name of ['capture.ts', 'classes.ts'])
    realTS.set(pathToFileURL(root + '/packages/tools/src/capture/' + name).href, W + '/packages/tools/src/capture/' + name);
  process.argv = [process.execPath, 'entry.mjs', readyPath, unit, consumption];
  process.chdir(root);
  process.env.NODE_OPTIONS = '';
  process.env.SMOKE_GL = 'metal';
  process.stderr.write =
    mode === 'combined-all-sinks'
      ? () => {
          throw Error('STDERR_UNAVAILABLE');
        }
      : stderr;
  let thrown;
  try {
    await main();
  } catch (e) {
    thrown = e;
  } finally {
    process.stderr.write = stderr;
  }
  assert(thrown?.entryResult);
  const result = thrown.entryResult;
  assert.equal(result.accepted, false);
  assert.equal(trace.filter((x) => x === 'actual-captureUi-goto').length, 1);
  assert.deepEqual(trace, ['INERT-browser-port', 'actual-captureUi-goto', 'browser.close', 'vite.close']);
  assert.equal(result.primaryFailure.message, primary?.message ?? String(primary));
  if (primary === navigation || mode === 'combined-object') {
    assert.equal(result.primaryFailure.raw.partial.base64, 'AP8=');
    assert.deepEqual(result.primaryFailure.raw.unknown, { original: true });
  } else assert.deepEqual(result.primaryFailure.raw, primary === undefined ? { type: 'undefined' } : primary);
  const cleanup = mode.startsWith('combined') ? 2 : mode === 'goto-only' ? 0 : 1;
  assert.equal(result.cleanupFailures.length, cleanup);
  if (cleanup === 2) {
    assert.equal(result.cleanupFailures[0].message, 'SECONDARY_BROWSER_CLOSE');
    assert.equal(result.cleanupFailures[0].raw.partial.base64, 'Af8=');
    assert.equal(result.cleanupFailures[1].message, 'SECONDARY_VITE_CLOSE');
    assert.equal(result.cleanupFailures[1].raw.unknown.cleanup, 'vite');
  }
  let durable = null;
  if (mode === 'combined-all-sinks') {
    assert.equal(fs.existsSync(evidence + '/entry-result.json'), false);
    assert.deepEqual(
      result.persistenceFailures.map((x) => x.receipt),
      ['returned-entry-failure.json', 'entry-result.json', 'stderr'],
    );
  } else {
    durable = JSON.parse(fs.readFileSync(evidence + '/entry-result.json'));
    assert.deepEqual(durable, result);
  }
  results.push({ mode, trace: [...trace], root, result, durable, thrown: { message: thrown.message }, nativeLaunches: 0 });
  put(B + '/capture-controls-results.json', { results, loaded, playwrightBinding, node: process.version });
}
playwright.chromium.launch = originalLaunch;
console.log(
  JSON.stringify({
    cases: results.length,
    actualFaunaMain: true,
    actualCaptureUi: true,
    playwrightBinding,
    nativeLaunches: 0,
    node: process.version,
    status: 'PASS: original navigation, both cleanup errors, raw bytes/falsy values and all-sink failure retained',
  }),
);
