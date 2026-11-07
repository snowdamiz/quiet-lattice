import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './evidence.ts';
import { observerRequiredSources } from '../trace-observer-report.ts';
import nativeCategoryReceipt from './fixtures/native-attempt3-categories.json';

const state = vi.hoisted(() => ({ calls: [] as string[], closed: false, categories: { categories: [] } as unknown, detachFails: false }));
vi.mock('@playwright/test', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    chromium: {
      launchServer: async () => ({
        process: () => ({ pid: 624242, spawnfile: '/inert-browser', spawnargs: ['/inert-browser'] }),
        wsEndpoint: () => '/inert-endpoint',
        close: async () => {
          state.calls.push('server.close');
        },
      }),
      connect: async () => ({
        newBrowserCDPSession: async () => {
          const events = new EventEmitter();
          return {
            on: events.on.bind(events),
            off: events.off.bind(events),
            detach: async () => {
              state.calls.push('cdp.detach');
              if (state.detachFails) throw new Error('SECONDARY_DETACH');
            },
            send: async (method: string) => {
              state.calls.push(method);
              if (method === 'Browser.getVersion') return { product: 'CPU inert producer' };
              if (method === 'SystemInfo.getProcessInfo') return { processInfo: [{ id: 624243, type: 'renderer' }] };
              if (method === 'Tracing.getCategories') return state.categories;
              if (method === 'Tracing.end') events.emit('Tracing.tracingComplete', { dataLossOccurred: false, stream: 'owned-stream' });
              if (method === 'IO.read') return { data: '{"traceEvents":[]}', eof: true };
              return {};
            },
          };
        },
        newPage: async () => ({
          on: () => {},
          route: async () => {},
          addInitScript: async () => {},
          goto: async () => {},
          waitForFunction: async () => {},
          evaluate: async (fn: (input?: unknown) => unknown, input?: unknown) => {
            if (state.closed) throw new Error('page.evaluate: Target page, context or browser has been closed');
            return fn(input);
          },
        }),
        close: async () => {
          state.calls.push('browser.close');
          state.closed = true;
        },
      }),
    },
  };
});
vi.mock('../native-vite.ts', () => ({
  startOwnedVite: async () => ({
    url: 'http://127.0.0.1:1',
    stop: async () => {
      state.calls.push('vite.stop');
    },
  }),
}));
import { nativeMain } from './worker.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['malformed', 'empty', 'detach-failure'])(
  'drains the page before browser disposal through nativeMain, actual adapter and dispatcher: %s',
  async (mode) => {
    state.calls.length = 0;
    state.closed = false;
    state.detachFails = mode === 'detach-failure';
    state.categories = mode === 'empty' ? nativeCategoryReceipt.response : { categories: [null], unknown: 'retained raw reply' };
    const root = realpathSync(mkdtempSync(join(tmpdir(), 't13-worker-drain-')));
    for (const dir of ['capture', 'fallback', 'consumption']) mkdirSync(join(root, dir));
    const grant = {
      purpose: 'P1.E14.T13/unchanged-reference-trace-observer-v1',
      readinessSha256: 'a'.repeat(64),
      planSha256: 'b'.repeat(64),
      head: 'c'.repeat(40),
      tree: 'd'.repeat(40),
      output: root,
      expiresAtEpochSeconds: Date.now() / 1000 + 120,
      controlledLoad: { gpuReservation: 'inert CPU ports only' },
    };
    const rawGrant = Buffer.from(JSON.stringify(grant));
    writeFileSync(join(root, 'consumption/grant.json'), rawGrant);
    const device = {
      vendor: 'fixture',
      renderer: 'fixture Metal',
      version: 'WebGL2',
      shadingLanguage: 'GLSL',
      context: { alpha: true, antialias: true, depth: true, stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: true },
      contextLost: false,
    };
    const prefix = 'bwt-' + '3'.repeat(32),
      request = { prefix, browserPid: 624242, processes: [{ id: 624243, type: 'renderer' }], device };
    writeFileSync(
      join(root, 'capture/kernel-release.json'),
      JSON.stringify({ prefix, browserPid: 624242, rendererPids: [624243], requestSha256: sha256(Buffer.from(JSON.stringify(request))) }),
    );
    const ready = {
      runtimeAuthorized: true,
      purpose: grant.purpose,
      grant,
      grantSha256: sha256(rawGrant),
      admittedReadinessSha256: grant.readinessSha256,
      planSha256: grant.planSha256,
      head: grant.head,
      tree: grant.tree,
      frozenRoot: root,
      capture: join(root, 'capture'),
      fallback: join(root, 'fallback'),
      sources: observerRequiredSources.map((relative) => ({ relative, sha256: 'e'.repeat(64) })),
      binding: {
        node: process.execPath,
        consumption: join(root, 'consumption'),
        output: root,
        expectedDevice: { backend: 'metal', rendererContains: 'fixture' },
        controlledLoad: { logicalCores: cpus().length, maxLoad: [10000, 10000, 10000] },
        assetPath: new URL('../../../../client/public/models/characters/thalune.glb', import.meta.url).pathname,
        browser: '/inert-browser',
        binaries: [{ path: '/inert-browser', sha256: 'f'.repeat(64) }],
        prefix,
      },
    };
    const raw = Buffer.from(JSON.stringify(ready)),
      path = join(root, 'admission.json');
    writeFileSync(path, raw);
    vi.stubEnv('SMOKE_GL', 'metal');
    vi.stubGlobal('window', {
      review: {
        ready: Promise.resolve(),
        light: async () => {},
        lod: () => {},
        wireframe: () => {},
        device: () => device,
        lastNativeWorkClassProbe: { unknown: 'partial CPU producer' },
        nativeWorkClassProbe: async (action: string) => {
          state.calls.push('probe.' + action);
          if (action !== 'cancel') throw new Error('PRIMARY_PREPARE');
        },
      },
    });
    await expect(nativeMain(['--owned', path, sha256(raw)])).rejects.toThrow('adapter failed');
    const packet = JSON.parse(readFileSync(join(root, 'capture/packet.json'), 'utf8'));
    expect(packet.failure).toContain(mode === 'empty' ? 'PRIMARY_PREPARE' : 'Malformed category receipt');
    expect(packet.steps[0].receipt.categories).toEqual(state.categories);
    expect(packet.status).toBe('failed');
    expect(packet.summary).toBeNull();
    expect(packet.cleanupErrors).toEqual(mode === 'detach-failure' ? ['transport-drain: Error: SECONDARY_DETACH'] : []);
    expect(state.calls.filter((x) => x === 'probe.cancel')).toHaveLength(2);
    expect(state.calls.indexOf('cdp.detach')).toBeGreaterThan(state.calls.indexOf('probe.cancel'));
    expect(state.calls.lastIndexOf('probe.cancel')).toBeLessThan(state.calls.indexOf('browser.close'));
    expect(state.calls.slice(-3)).toEqual(['browser.close', 'server.close', 'vite.stop']);
    expect(state.calls.filter((x) => x === 'browser.close')).toHaveLength(1);
    if (mode === 'empty') {
      expect(state.calls).toContain('IO.close');
      expect(packet.steps[0].prepare.value.unknown).toBe('partial CPU producer');
    } else expect(state.calls).not.toContain('Tracing.start');
  },
);
