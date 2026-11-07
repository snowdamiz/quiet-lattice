import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const target = fileURLToPath(new URL('./playthrough-run.ts', import.meta.url));
const node = process.execPath;
const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const directories: string[] = [];

const preload = `import { registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
Date.now = () => 0;
const targetURL = pathToFileURL(realpathSync(process.env.CLI_TARGET)).href;
const stubURL = new URL('./ports.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    const fromTarget = context.parentURL?.split('?')[0] === targetURL;
    if (fromTarget && (specifier === './capture.ts' || specifier === '@playwright/test')) {
      return { url: stubURL, shortCircuit: true };
    }
    if (specifier === 'vite' || specifier.includes('playwright') || specifier.endsWith('/capture.ts')) {
      throw new Error('Real resource dependency blocked: ' + specifier);
    }
    return next(specifier, context);
  },
});
`;

const ports = `import { writeFileSync } from 'node:fs';
const trace = [];
function step(name) { trace.push(name); }
process.on('exit', () => {
  if (process.env.CLI_TRACE) writeFileSync(process.env.CLI_TRACE, JSON.stringify(trace));
});
export function startVite() {
  step('startVite');
  return Promise.resolve({
    get url() { step('url'); return 'http://stub.invalid'; },
    stop() { step('stop'); return Promise.resolve().then(() => step('stop:done')); },
  });
}
export function glArgs() {
  step('glArgs');
  return { get args() { step('glArgs.args'); return ['--stub']; } };
}
export const chromium = {
  launch() {
    step('launch');
    return Promise.resolve({
      newPage() {
        step('newPage');
        let evaluateCount = 0;
        return Promise.resolve({
          on(event) { step('on:' + event); },
          goto() { step('goto'); return Promise.resolve(); },
          waitForFunction() { step('ready'); return Promise.resolve(); },
          async evaluate(fn, arg) {
            evaluateCount += 1;
            if (evaluateCount === 1) { step('initialize'); return; }
            if (typeof arg === 'string') {
              step('phase:' + arg);
              const result = process.env.CLI_PHASE_RESULT ?? arg + ' ok';
              globalThis.window = { __pt: { [arg]: async () => result } };
              return await fn(arg);
            }
            step('dockState');
            const ship = { mode: 'docked' };
            globalThis.window = {
              game: {
                ship,
                station: { pads: [{ occupied: ship }, { occupied: {} }, { occupied: null }] },
                hud: { root: { innerText: 'Docked' } },
              },
            };
            return await fn();
          },
        });
      },
      close() { step('close'); return Promise.resolve().then(() => step('close:done')); },
    });
  },
};
`;

const importer = `import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const loaded = await import(pathToFileURL(realpathSync(process.env.CLI_TARGET)).href);
if (typeof loaded.runPlaythrough !== 'function') throw new Error('missing runPlaythrough');
console.log('import is inert');
`;

const leaveTrace = [
  'startVite',
  'glArgs',
  'glArgs.args',
  'launch',
  'newPage',
  'on:pageerror',
  'on:console',
  'url',
  'goto',
  'ready',
  'initialize',
  'phase:leave',
  'close',
  'close:done',
  'stop',
  'stop:done',
];

const defaultStdout = `${[
  '[leave] (0s) leave ok',
  '[descend] (0s) descend ok',
  '[land] (0s) land ok',
  '[disembark] (0s) disembark ok',
  '[mine] (0s) mine ok',
  '[analyze] (0s) analyze ok',
  '[board] (0s) board ok',
  '[climb] (0s) climb ok',
  '[dock] (0s) dock ok',
  '  dock state: {"mode":"docked","pads":["player","npc","free"],"hud":"Docked"}',
].join('\n')}\n`;

interface Invocation {
  status: number;
  stdout: string;
  stderr: string;
  trace: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function invoke(dir: string, prefix: readonly string[], args: readonly string[], phaseResult?: string): Invocation {
  const tracePath = join(dir, `trace-${prefix.length}-${args.join('_').replaceAll('/', '_')}.json`);
  const env: NodeJS.ProcessEnv = { ...process.env, CLI_TARGET: target, CLI_TRACE: tracePath };
  delete env.NODE_OPTIONS;
  delete env.REVIEW_TARGET;
  delete env.REVIEW_CASE;
  delete env.REVIEW_META;
  delete env.REVIEW_TRACE;
  delete env.CLI_PHASE_RESULT;
  env.PATH = `${dirname(node)}${delimiter}${env.PATH ?? ''}`;
  if (phaseResult) env.CLI_PHASE_RESULT = phaseResult;
  const result = spawnSync(prefix[0], [...prefix.slice(1), '--import', join(dir, 'preload.mjs'), ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.status === null) throw new Error(`spawn failed: ${result.error?.message ?? 'unknown'}\n${result.stderr}`);
  const parsed: unknown = JSON.parse(readFileSync(tracePath, 'utf8'));
  if (!isStringArray(parsed)) throw new Error(`trace was not a string array: ${tracePath}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, trace: parsed };
}

function expectCleanupOnce(trace: string[]) {
  const close = trace.indexOf('close');
  const stop = trace.indexOf('stop');
  expect(trace.filter((step) => step === 'close')).toEqual(['close']);
  expect(trace.filter((step) => step === 'stop')).toEqual(['stop']);
  expect(close).toBeGreaterThan(-1);
  expect(stop).toBeGreaterThan(close);
}

afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

describe('playthrough CLI entry', () => {
  it('runs from a direct path or a symlink and stays inert when imported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'playthrough-cli-'));
    directories.push(dir);
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(dir, 'preload.mjs'), preload);
    writeFileSync(join(dir, 'ports.mjs'), ports);
    writeFileSync(join(dir, 'import-check.mjs'), importer);
    const alias = join(dir, 'entry-alias.ts');
    symlinkSync(target, alias);
    const runtimes = [
      { name: 'node', prefix: [node] },
      { name: 'tsx', prefix: [node, tsxCli] },
    ] as const;

    for (const runtime of runtimes) {
      const direct = invoke(dir, runtime.prefix, [target, 'leave']);
      expect(direct.status, `${runtime.name} direct\n${direct.stderr}`).toBe(0);
      expect(direct.stdout).toBe('[leave] (0s) leave ok\n');
      expect(direct.trace).toEqual(leaveTrace);

      const custom = invoke(dir, runtime.prefix, [target, '--', 'mine']);
      expect(custom.status, `${runtime.name} custom\n${custom.stderr}`).toBe(0);
      expect(custom.stdout).toBe('[mine] (0s) mine ok\n');
      expect(custom.trace).toContain('phase:mine');
      expectCleanupOnce(custom.trace);

      const defaults = invoke(dir, runtime.prefix, [target]);
      expect(defaults.status, `${runtime.name} default\n${defaults.stderr}`).toBe(0);
      expect(defaults.stdout).toBe(defaultStdout);
      expectCleanupOnce(defaults.trace);

      const linked = invoke(dir, runtime.prefix, [alias, 'leave']);
      expect(linked.status, `${runtime.name} symlink\n${linked.stderr}`).toBe(0);
      expect(linked.stdout).toBe(direct.stdout);
      expect(linked.trace).toEqual(direct.trace);

      const failed = invoke(dir, runtime.prefix, [alias, 'leave'], 'fail');
      expect(failed.status, `${runtime.name} symlink failure\n${failed.stderr}`).toBe(1);
      expect(failed.stdout).toBe('[leave] (0s) fail\n');
      expect(failed.trace).toEqual(leaveTrace);

      const imported = invoke(dir, runtime.prefix, [join(dir, 'import-check.mjs')]);
      expect(imported.status, `${runtime.name} import\n${imported.stderr}`).toBe(0);
      expect(imported.stdout).toBe('import is inert\n');
      expect(imported.trace).toEqual([]);
    }
  });
});
