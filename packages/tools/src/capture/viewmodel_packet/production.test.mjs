/* global process, Buffer */
// Execute the frozen captureReview body; only native/import ports are inert.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import cp from 'node:child_process';

const packet = process.env.VM_PACKET_UNDER_TEST ?? import.meta.dirname;
const ready = JSON.parse(fs.readFileSync(path.join(packet, 'readiness.json')));
const plan = JSON.parse(fs.readFileSync(path.join(packet, 'inventory.json')));
const trace = [];
let failingOperation, cleanupFails, primary;
const secondary = new Error('SECONDARY_BROWSER_CLOSE');
const chromium = {
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

// Private references avoid importing a real launcher, bundler, server or codec.
globalThis.__viewmodelInertPorts = { chromium, vite, net };
const hooks = registerHooks({
  resolve(spec, context, next) {
    if (spec === '@playwright/test') return { url: 'inert:pw', shortCircuit: true };
    if (spec === 'vite') return { url: 'inert:vite', shortCircuit: true };
    if (spec === 'node:net' && context.parentURL?.endsWith('/capture.ts')) return { url: 'inert:net', shortCircuit: true };
    return next(spec, context);
  },
  load(url, context, next) {
    if (url === 'inert:pw' || url === pathToFileURL(ready.bindings.playwright).href)
      return { format: 'module', source: 'export const chromium=globalThis.__viewmodelInertPorts.chromium;', shortCircuit: true };
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
      return { format: 'module', source: stripTypeScriptTypes(fs.readFileSync(new URL(url), 'utf8')), shortCircuit: true };
    return next(url, context);
  },
});
const { execute, productionCapture } = await import(pathToFileURL(path.join(packet, 'entry.mjs')));

test('actual productionCapture / captureReview preserve operation errors across close failure', async () => {
  const saved = new Map();
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    saved.set(name, cp[name]);
    cp[name] = () => {
      throw new Error(`NO_CHILD_PROCESS:${name}`);
    };
  }
  syncBuiltinESMExports();
  const rows = [];
  try {
    for (const operation of ['newPage', 'on', 'addInitScript', 'goto', 'waitForFunction', 'evaluate']) {
      for (const withCloseFailure of [false, true]) {
        failingOperation = operation;
        cleanupFails = withCloseFailure;
        trace.length = 0;
        primary = new Error(`PRIMARY_${operation}`);
        primary.partial = Buffer.from([0, 255]);
        primary.unknown = { original: true };
        const records = [];
        const result = await execute(
          { ready, spec: plan.units[0], paths: { output: '/INERT-no-output', evidence: '/INERT-no-evidence' } },
          {
            capture: productionCapture,
            receipt: (_name, record) => records.push(JSON.parse(JSON.stringify(record))),
            emit: () => assert.fail('unexpected fallback'),
          },
        );
        rows.push({ operation, withCloseFailure, trace: [...trace], result });
        assert.equal(result.code, 1);
        assert.equal(result.record.primaryFailure.message, `PRIMARY_${operation}`);
        assert.equal(result.record.primaryFailure.partial.base64, 'AP8=');
        assert.deepEqual(result.record.primaryFailure.unknown, { original: true });
        assert.equal(records[0].primaryFailure.message, `PRIMARY_${operation}`);
        assert.equal(
          result.record.secondaryFailures.some((failure) => failure.error.message === secondary.message),
          withCloseFailure,
        );
        if (operation === 'goto') assert.equal(trace.filter((step) => step === 'goto').length, 1);
      }
    }
    if (process.env.VM_ENTRY_EVIDENCE) fs.writeFileSync(process.env.VM_ENTRY_EVIDENCE, JSON.stringify(rows, null, 2), { flag: 'wx' });
  } finally {
    for (const [name, original] of saved) cp[name] = original;
    syncBuiltinESMExports();
    hooks.deregister();
    delete globalThis.__viewmodelInertPorts;
  }
});
