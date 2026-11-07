import { expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './evidence.ts';

const ports = vi.hoisted(() => ({
  calls: [] as string[],
  closeFails: false,
  primary: Object.assign(new Error('PRIMARY_GOTO', { cause: new Error('ORIGINAL_CAUSE') }), {
    stdout: Buffer.from([0, 255, 128, 1]),
    stderr: Buffer.from([254, 0, 127]),
    future: { unknown: 'PRIMARY_FUTURE', bytes: Buffer.from([255, 1]) },
  }),
}));
vi.mock('@playwright/test', () => ({
  chromium: {
    launchServer: async () => ({
      process: () => ({ pid: 624242, spawnfile: '/inert-browser', spawnargs: ['/inert-browser', '--use-angle=metal'] }),
      wsEndpoint: () => '/inert-endpoint',
      close: async () => {
        ports.calls.push('browserServer.close');
        if (ports.closeFails) throw Object.assign(new Error('SECONDARY_SERVER_CLOSE'), { raw: Buffer.from([253, 0]) });
      },
    }),
    connect: async () => ({
      newBrowserCDPSession: async () => ({ send: async () => ({ product: 'Inert fixture' }) }),
      newPage: async () => ({
        on: () => {},
        route: async () => {},
        addInitScript: async () => {},
        goto: async () => {
          ports.calls.push('actual-openReview.goto');
          throw ports.primary;
        },
        close: async () => {
          ports.calls.push('page.close');
          if (ports.closeFails) throw new Error('SECONDARY_PAGE_CLOSE');
        },
      }),
      close: async () => {
        ports.calls.push('browser.close');
        ports.primary.stdout.fill(0);
        ports.primary.future.unknown = 'MUTATED_BY_CLEANUP';
        if (ports.closeFails) throw Object.assign(new Error('SECONDARY_BROWSER_CLOSE'), { raw: Buffer.from([252, 0]) });
      },
    }),
  },
}));
vi.mock('../native-vite.ts', () => ({
  startOwnedVite: async () => ({
    url: 'http://127.0.0.1:1',
    stop: async () => {
      ports.calls.push('vite.stop');
      if (ports.closeFails) throw Object.assign(new Error('SECONDARY_VITE_STOP'), { raw: Buffer.from([251, 0]) });
    },
  }),
}));
import { nativeMain } from './worker.ts';

function admission() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 't13-worker-failure-')));
  for (const name of ['capture', 'fallback', 'consumption']) mkdirSync(join(root, name));
  const grant = {
    purpose: 'P1.E14.T13/unchanged-reference-trace-observer-v1',
    readinessSha256: 'a'.repeat(64),
    planSha256: 'b'.repeat(64),
    head: 'c'.repeat(40),
    tree: 'd'.repeat(40),
    output: root,
    expiresAtEpochSeconds: Date.now() / 1000 + 120,
  };
  const raw = Buffer.from(JSON.stringify(grant));
  writeFileSync(join(root, 'consumption/grant.json'), raw);
  const ready = {
    runtimeAuthorized: true,
    purpose: grant.purpose,
    grant,
    grantSha256: sha256(raw),
    admittedReadinessSha256: grant.readinessSha256,
    planSha256: grant.planSha256,
    head: grant.head,
    tree: grant.tree,
    frozenRoot: root,
    capture: join(root, 'capture'),
    fallback: join(root, 'fallback'),
    binding: {
      node: process.execPath,
      consumption: join(root, 'consumption'),
      output: root,
      expectedDevice: { backend: 'metal', rendererContains: 'fixture' },
      controlledLoad: { maxLoad: [1, 1, 1] },
      assetPath: new URL('../../../../client/public/models/characters/thalune.glb', import.meta.url).pathname,
      browser: '/inert-browser',
      prefix: 'bwt-' + '2'.repeat(32),
    },
  };
  const admitted = Buffer.from(JSON.stringify(ready));
  const path = join(root, 'admission.json');
  writeFileSync(path, admitted);
  return { root, ready, path, hash: sha256(admitted) };
}

it.each([false, true])('preserves the actual openReview producer before cleanup mutation, close failures=%s', async (closeFails) => {
  const fixture = admission();
  ports.closeFails = closeFails;
  ports.calls.length = 0;
  ports.primary = Object.assign(new Error('PRIMARY_GOTO', { cause: new Error('ORIGINAL_CAUSE') }), {
    stdout: Buffer.from([0, 255, 128, 1]),
    stderr: Buffer.from([254, 0, 127]),
    future: { unknown: 'PRIMARY_FUTURE', bytes: Buffer.from([255, 1]) },
  });
  Object.defineProperty(ports.primary, 'nonenumerable', { value: Buffer.from([128, 0]), enumerable: false });
  vi.stubEnv('SMOKE_GL', 'metal');
  let thrown: unknown;
  try {
    await nativeMain(['--owned', fixture.path, fixture.hash]);
  } catch (error) {
    thrown = error;
  } finally {
    vi.unstubAllEnvs();
  }
  expect(ports.calls).toEqual(['actual-openReview.goto', 'browser.close', 'browserServer.close', 'vite.stop']);
  const failure = readFileSync(join(fixture.root, 'capture/worker-failure.json'), 'utf8');
  for (const fact of ['PRIMARY_FUTURE', 'ORIGINAL_CAUSE', 'nonenumerable', 'AP+AAQ==', '/gB/', '/wE=']) expect(failure).toContain(fact);
  expect(failure).not.toContain('MUTATED_BY_CLEANUP');
  if (closeFails) {
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown instanceof AggregateError && thrown.cause).toBe(ports.primary);
    const terminal = readFileSync(join(fixture.root, 'capture/worker-terminal.json'), 'utf8');
    for (const fact of ['SECONDARY_BROWSER_CLOSE', 'SECONDARY_SERVER_CLOSE', 'SECONDARY_VITE_STOP', '/AA=', '/QA=', '+wA=']) expect(terminal).toContain(fact);
  } else expect(thrown).toBe(ports.primary);
});

it('retains the original and every stop/write failure when both evidence sinks refuse publication', async () => {
  const fixture = admission();
  for (const root of ['capture', 'fallback'])
    for (const name of ['worker-failure.json', 'worker-close.json', 'worker-terminal.json']) writeFileSync(join(fixture.root, root, name), 'prior evidence');
  ports.closeFails = true;
  ports.calls.length = 0;
  ports.primary = Object.assign(new Error('PRIMARY_GOTO', { cause: new Error('ORIGINAL_CAUSE') }), {
    stdout: Buffer.from([0, 255, 128, 1]),
    stderr: Buffer.from([254, 0, 127]),
    future: { unknown: 'PRIMARY_FUTURE', bytes: Buffer.from([255, 1]) },
  });
  const stderr: string[] = [];
  const output = vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
    stderr.push(String(value));
    return true;
  });
  vi.stubEnv('SMOKE_GL', 'metal');
  let thrown: unknown;
  try {
    await nativeMain(['--owned', fixture.path, fixture.hash]);
  } catch (error) {
    thrown = error;
  } finally {
    output.mockRestore();
    vi.unstubAllEnvs();
  }
  expect(ports.calls).toEqual(['actual-openReview.goto', 'browser.close', 'browserServer.close', 'vite.stop']);
  expect(thrown).toBeInstanceOf(AggregateError);
  expect(thrown instanceof AggregateError && thrown.cause).toBe(ports.primary);
  const terminal = JSON.parse(stderr.join(''));
  expect(terminal.accepted).toBe(false);
  expect(Object.keys(terminal.evidence.durable)).not.toContain('worker-failure.json');
  expect(Object.keys(terminal.evidence.undurable)).toEqual(expect.arrayContaining(['worker-failure.json', 'worker-close.json', 'worker-terminal.json']));
  expect(terminal.evidence.failures).toHaveLength(6);
  for (const fact of ['PRIMARY_FUTURE', 'ORIGINAL_CAUSE', 'SECONDARY_BROWSER_CLOSE', 'SECONDARY_SERVER_CLOSE', 'SECONDARY_VITE_STOP', 'worker-terminal.json'])
    expect(JSON.stringify(terminal)).toContain(fact);
  for (const root of ['capture', 'fallback'])
    for (const name of ['worker-failure.json', 'worker-close.json', 'worker-terminal.json'])
      expect(readFileSync(join(fixture.root, root, name), 'utf8')).toBe('prior evidence');
});

it.each(['disabled', 'missing grant'])('refuses %s admission before any native port runs', async (kind) => {
  const fixture = admission();
  ports.calls.length = 0;
  fixture.ready.runtimeAuthorized = kind !== 'disabled';
  fixture.ready.binding.consumption = join(fixture.root, 'absent-consumption');
  const raw = Buffer.from(JSON.stringify(fixture.ready));
  writeFileSync(fixture.path, raw);
  vi.stubEnv('SMOKE_GL', 'metal');
  try {
    await expect(nativeMain(['--owned', fixture.path, sha256(raw)])).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
  }
  expect(ports.calls).toEqual([]);
});
