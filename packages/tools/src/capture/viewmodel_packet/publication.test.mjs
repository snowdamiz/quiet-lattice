/* global process, Buffer, console */
// Execute the frozen captureReview body; only native/import ports are inert.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire, registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import cp from 'node:child_process';
import netPorts from 'node:net';

const packet = process.env.VM_PACKET_UNDER_TEST ?? import.meta.dirname;
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-r2-publication-'));
function ungraph(facts) {
  if (facts?.rawGraph !== 1) return facts;
  const values = facts.nodes.map((n) => (n.kind === 'array' ? [] : n.kind === 'bytes' ? { base64: n.base64, bytes: n.bytes } : {}));
  const edge = (e) => (Object.hasOwn(e, 'value') ? e.value : values[e.ref]);
  facts.nodes.forEach((n, i) => {
    if (n.entries)
      for (const [k, v] of n.entries) {
        const name = edge(k);
        if (n.kind === 'array' && name === 'length') values[i].length = edge(v);
        else Object.defineProperty(values[i], name, { value: edge(v), enumerable: true, configurable: true, writable: true });
      }
  });
  return edge(facts.root);
}
const ready = JSON.parse(fs.readFileSync(path.join(packet, 'readiness.json')));
const plan = JSON.parse(fs.readFileSync(path.join(packet, 'inventory.json')));
const trace = [];
let failingOperation, cleanupFails, viteFails, primary, secondary, tertiary;

let chromium, originalLaunch;
const inertChromium = {
  launch: async () => {
    trace.push('inert-launch-port');
    let initCalls = 0;
    const page = Object.fromEntries(
      ['on', 'addInitScript', 'goto', 'waitForFunction', 'evaluate'].map((operation) => [
        operation,
        (...args) => {
          trace.push(operation);
          // The first init belongs to the adapter; the second is the real openReview call.
          if (operation === 'addInitScript') initCalls++;
          if (operation === failingOperation && (operation !== 'addInitScript' || initCalls === 2)) throw primary;
          if (operation === 'evaluate') throw new Error('Unexpected later dispatch');
          return operation === 'on' ? page : Promise.resolve(args);
        },
      ]),
    );
    return {
      newPage: async () => {
        trace.push('newPage');
        if (failingOperation === 'newPage') throw primary;
        return page;
      },
      close: async () => {
        trace.push('browser.close');
        if (cleanupFails) throw secondary;
      },
    };
  },
};
const vite = {
  listen: async () => {},
  close: async () => {
    trace.push('vite.close');
    if (viteFails) throw tertiary;
  },
};
const net = () => ({
  listen(_port, _host, callback) {
    callback();
  },
  address() {
    return { port: 12345 };
  },
  close(callback) {
    callback();
  },
});

// Actual installed Playwright is imported; only launch, Vite and network ports are inert.
globalThis.__viewmodelInertPorts = { vite, net };
const hooks = registerHooks({
  resolve(spec, context, next) {
    if (spec === '@playwright/test') return { url: pathToFileURL(ready.bindings.playwright.replace(/index\.js$/, 'index.mjs')).href, shortCircuit: true };
    if (spec === 'vite') return { url: 'inert:vite', shortCircuit: true };
    if (spec === 'node:net' && context.parentURL?.endsWith('/capture.ts')) return { url: 'inert:net', shortCircuit: true };
    return next(spec, context);
  },
  load(url, context, next) {
    if (url === 'inert:vite')
      return { format: 'module', source: 'export const createServer=async()=>globalThis.__viewmodelInertPorts.vite;', shortCircuit: true };
    if (url === 'inert:net') return { format: 'module', source: 'export const createServer=globalThis.__viewmodelInertPorts.net;', shortCircuit: true };
    if (url === pathToFileURL(ready.bindings.tsxApi).href) return { format: 'commonjs', source: 'exports.register=()=>()=>{};', shortCircuit: true };
    if (url.endsWith('/capture/classes.ts'))
      return {
        format: 'module',
        source: 'export const farRanges=()=>[];export const loadClassRules=()=>({});export const reviewClass=()=>"viewmodel";',
        shortCircuit: true,
      };
    if (url.endsWith('/capture/screens.ts')) return { format: 'module', source: 'export const SCREENS={};', shortCircuit: true };
    if (url.endsWith('/capture/capture.ts'))
      return { format: 'module', source: stripTypeScriptTypes(fs.readFileSync(process.env.VM_SHARED_UNDER_TEST ?? new URL(url), 'utf8')), shortCircuit: true };
    return next(url, context);
  },
});
const { execute, productionCapture, errorFacts } = await import(pathToFileURL(path.join(packet, 'entry.mjs')));

const makeFailure = (name, id) =>
  Object.freeze(Object.assign(new Error(name), { partial: Buffer.from([0, 255, id]), unknown: Object.freeze({ owner: name, available: false, id }) }));

test('actual shared exports preserve falsy and cyclic failures through every receipt outcome', async () => {
  const saved = new Map();
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    saved.set(name, cp[name]);
    cp[name] = () => {
      throw Error('NO_NATIVE:' + name);
    };
  }
  syncBuiltinESMExports();
  const network = [netPorts.Socket.prototype.connect, netPorts.Server.prototype.listen];
  netPorts.Socket.prototype.connect = netPorts.Server.prototype.listen = () => assert.fail('NO_NETWORK');
  const rows = [];
  try {
    const imported = await import(pathToFileURL(ready.bindings.playwright).href);
    const required = createRequire(import.meta.url)(ready.bindings.playwright);
    const esm = await import(pathToFileURL(ready.bindings.playwright.replace(/index\.js$/, 'index.mjs')).href);
    assert.equal(imported.default, required);
    assert.equal(required.chromium, esm.chromium);
    assert.equal(typeof required.chromium.launch, 'function');
    chromium = required.chromium;
    originalLaunch = chromium.launch;
    chromium.launch = inertChromium.launch;
    const cyclic = new Error('CYCLIC_PRIMARY');
    cyclic.unknown = { bytes: Buffer.from([0, 255]), source: cyclic };
    cyclic.alias = cyclic.unknown;
    for (const [label, raw] of [
      ['error', makeFailure('PRIMARY', 1)],
      ['false', false],
      ['zero', 0],
      ['empty', ''],
      ['null', null],
      ['undefined', undefined],
      ['cyclic', cyclic],
    ]) {
      for (const both of [false, true])
        for (const sink of ['durable', 'fallback', 'all-sinks']) {
          failingOperation = 'goto';
          cleanupFails = both;
          viteFails = both;
          trace.length = 0;
          primary = raw;
          secondary = makeFailure('SECONDARY_BROWSER_CLOSE', 2);
          tertiary = makeFailure('TERTIARY_VITE_STOP', 3);
          const dir = path.join(evidence, `falsy-${label}-${both}-${sink}`);
          fs.mkdirSync(dir);
          let caught,
            attempt = 0;
          const receipts = [];
          const result = await execute(
            { ready, spec: plan.units[0], paths: { output: dir + '/output', evidence: dir } },
            {
              capture: async (...args) => {
                try {
                  return await productionCapture(...args);
                } catch (e) {
                  caught = e;
                  throw e;
                }
              },
              receipt: (name, record) => {
                attempt++;
                if (sink === 'all-sinks' || (sink === 'fallback' && attempt === 1)) throw Error('RECEIPT');
                const p = path.join(dir, name);
                fs.writeFileSync(p, JSON.stringify(record), { flag: 'wx' });
                receipts.push(JSON.parse(fs.readFileSync(p)));
              },
              emit: () => {
                throw Error('STDERR');
              },
            },
          );
          assert.equal(result.code, 1);
          assert.equal(trace.filter((x) => x === 'goto').length, 1);
          assert.equal(trace.filter((x) => x === 'vite.close').length, 1);
          if (both) {
            assert.equal(caught.errors[0], raw);
            assert.equal(caught.errors[1], secondary);
            assert.equal(caught.errors[2], tertiary);
            assert.equal(caught.cause, raw);
          } else assert.equal(caught, raw);
          assert.equal(result.record.captureFailed, true);
          assert.ok(Object.hasOwn(result.record, 'primaryFailure'));
          assert.deepEqual(result.record.primaryFailure, errorFacts(raw));
          if (label === 'undefined') assert.deepEqual(result.record.primaryFailure, { type: 'undefined' });
          if (both) {
            const aggregate = ungraph(result.record.secondaryFailures.find((f) => f.phase === 'capture-finally').error);
            assert.equal(aggregate.errors.length, 3);
            if (raw !== null && typeof raw === 'object') assert.equal(aggregate.cause, aggregate.errors[0]);
            else assert.deepEqual(aggregate.cause, aggregate.errors[0]);
            assert.deepEqual(aggregate.errors[1], errorFacts(secondary));
            assert.deepEqual(aggregate.errors[2], errorFacts(tertiary));
            if (label === 'undefined') assert.deepEqual(aggregate.errors[0], { type: 'undefined' });
            if (label === 'cyclic') {
              assert.equal(aggregate.errors[0].unknown.source, aggregate.errors[0]);
              assert.equal(aggregate.errors[0].alias, aggregate.errors[0].unknown);
              assert.equal(aggregate.errors[0].unknown.bytes.base64, 'AP8=');
            }
          }
          for (const receipt of receipts) assert.deepEqual(receipt.primaryFailure, errorFacts(raw));
          const encoded = JSON.stringify(result.record);
          const observed = {
            label,
            both,
            sink,
            trace: [...trace],
            result,
            receipts,
            rawSharedIdentityPreserved: true,
            viteFaultRetained: !both || encoded.includes('TERTIARY_VITE_STOP'),
            durablePrimaryKey: receipts.length ? Object.hasOwn(receipts[0], 'primaryFailure') : null,
          };
          rows.push(observed);
        }
    }
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(rows, null, 2), { flag: 'wx' });
    const lost = rows.filter((x) => !x.viteFaultRetained);
    assert.equal(lost.length, 0);
    assert.ok(rows.every((x) => x.durablePrimaryKey !== false));
    console.log(
      JSON.stringify({
        cases: rows.length,
        missingViteFacts: lost.length,
        undefinedDurablePrimaryOmitted: rows.filter((x) => x.label === 'undefined' && !x.both && x.durablePrimaryKey === false).length,
      }),
    );
  } finally {
    if (chromium) chromium.launch = originalLaunch;
    [netPorts.Socket.prototype.connect, netPorts.Server.prototype.listen] = network;
    for (const [name, value] of saved) cp[name] = value;
    syncBuiltinESMExports();
    hooks.deregister();
    delete globalThis.__viewmodelInertPorts;
  }
});
