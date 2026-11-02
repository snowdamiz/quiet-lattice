import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Virtual asset/hash and browser/CDP adapters isolate full-entry ownership from GPU/asset validation.
// All native/control/host helper processes and group cleanup use the real production primitive.
const state = vi.hoisted(() => ({
  out: '',
  script: '',
  mode: '',
  identityCalls: 0,
  controlEntered: false,
  controlHelperStarted: false,
  pageClosed: false,
  runCalls: 0,
  runAction: '',
  prepareAction: '',
  workClass: '',
  lateCalls: 0,
  gpuPid: 0,
  stopGpu: async () => {},
  pendingPage: undefined as undefined | { resolve: (value: unknown) => void; reject: (reason: Error) => void },
}));
vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof import('node:crypto')>()),
  createHash: () => ({ update: () => ({ digest: () => 'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27' }) }),
}));
vi.mock('./timer-boundaries.ts', async (original) => ({
  ...(await original<typeof import('./timer-boundaries.ts')>()),
  timerBoundaryAsset: () => Buffer.from('CPU virtual asset'),
}));
vi.mock('./native-vite.ts', () => ({ startOwnedVite: async () => ({ url: 'http://127.0.0.1:1', stop: async () => {} }) }));
vi.mock('./capture.ts', () => ({
  glArgs: () => ({ gl: 'metal', args: [] }),
  openReview: async () => ({
    errors: [],
    page: {
      evaluate: async (callback: () => unknown, argument?: string) => {
        const text = callback.toString();
        const classPrepare = /nativeWorkClassProbe\(['"]prepare['"]/.test(text);
        if (classPrepare) {
          state.prepareAction = 'work-class-prepare';
          state.workClass = argument ?? '';
        }
        const prepare = /nativePassProbe\(['"](prepare(?:-off-off)?)['"]\)/.exec(text);
        if (prepare) state.prepareAction = prepare[1];
        const run = /nativePassProbe\(['"](run(?:-off-off)?)['"]\)/.exec(text);
        const classRun = /nativeWorkClassProbe\(['"]run['"]/.test(text);
        if (run || classRun) {
          state.runAction = classRun ? 'work-class-run' : run![1];
          state.runCalls++;
          if (state.mode === 'work-class-control-failed') throw new Error('Synthetic work-class control failed');
          if (state.mode === 'page-failure' || state.mode === 'outer-timeout')
            return new Promise((resolve, reject) => (state.pendingPage = { resolve, reject }));
          state.lateCalls++;
          if (state.mode === 'work-class-success')
            return {
              workClass: state.workClass,
              failure: null,
              samples: [
                {
                  operations: { frames: state.workClass.startsWith('frame-') ? 1 : 0, png: state.workClass === 'frame-plus-PNG' ? 1 : 0, queries: 0 },
                  ...(state.workClass === 'frame-plus-PNG'
                    ? { png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARAAA//8DAAJZAXHr7wAAAABJRU5ErkJggg==' }
                    : {}),
                },
              ],
            };
        }
        if (text.includes('lastNativeWorkClassProbe')) return { workClass: state.workClass, failure: 'partial retained control failure', samples: [] };
        return null;
      },
      close: async () => {
        state.pageClosed = true;
        state.pendingPage?.reject(new Error('Synthetic owned page closed'));
      },
    },
  }),
}));
vi.mock('@playwright/test', () => ({
  chromium: {
    launchServer: async () => ({
      process: () => ({ pid: process.pid }),
      wsEndpoint: () => 'synthetic',
      close: () => state.stopGpu(),
      kill: () => state.stopGpu(),
    }),
    connect: async () => ({
      close: () => state.stopGpu(),
      newBrowserCDPSession: async () => ({
        detach: async () => {},
        send: async (name: string) => {
          if (name !== 'SystemInfo.getProcessInfo') return { product: 'CPU synthetic' };
          state.identityCalls++;
          if (state.identityCalls === 2) state.controlEntered = true;
          if (state.identityCalls > 2) state.lateCalls++;
          return { processInfo: [{ id: state.gpuPid, type: 'GPU' }] };
        },
      }),
    }),
  },
}));
vi.mock('./native-trace.ts', async (original) => {
  const real = await original<typeof import('./native-trace.ts')>();
  return {
    ...real,
    discoverNativeCli: async () => ({ synthetic: 'CPU-only discovery adapter' }),
    runOwnedHelper: (file: string, args: string[], records: import('./native-trace.ts').CommandRecord[], options: Parameters<typeof real.runOwnedHelper>[3]) =>
      file === 'ioreg' || file === 'ps'
        ? real.runOwnedHelper(process.execPath, ['-e', ''], records, options)
        : real.runOwnedHelper(file, args, records, options),
    processRows: async (records: import('./native-trace.ts').CommandRecord[] = [], signal?: AbortSignal) => {
      if (
        state.controlEntered &&
        !state.controlHelperStarted &&
        !['page-failure', 'outer-timeout', 'work-class-control-failed', 'work-class-success'].includes(state.mode)
      ) {
        state.controlHelperStarted = true;
        await real.runOwnedHelper(process.execPath, [state.script, state.out, 'control-helper'], records, { deadlineMs: 1000, signal });
      }
      return [
        { pid: process.pid, ppid: 1, pgid: process.pid, executable: 'CPU synthetic browser owner' },
        { pid: state.gpuPid, ppid: process.pid, pgid: state.gpuPid, executable: 'CPU synthetic GPU identity' },
      ];
    },
    withNativeTrace: (...args: Parameters<typeof real.withNativeTrace>) => {
      args[3] = {
        xctrace: { file: process.execPath, prefix: [state.script, state.out, state.mode] },
        notifyutil: { file: process.execPath, prefix: [state.script, state.out, state.mode] },
        registrationMs: 0,
        startupMs: 2000,
        controlMs: state.mode === 'helper-timeout' ? 75 : 2000,
        finishMs: 2000,
        exportMs: 2000,
      };
      return real.withNativeTrace(...args);
    },
  };
});

vi.mock('./native-work-class-budget.ts', async (original) => {
  const real = await original<typeof import('./native-work-class-budget.ts')>();
  return {
    ...real,
    withNativeWorkClassDeadline: <T>(work: (signal: AbortSignal) => Promise<T>) =>
      real.withNativeWorkClassDeadline(work, state.mode === 'outer-timeout' ? 2000 : undefined),
  };
});

import { captureNativePass, nativePassArgs } from './native-pass-probe.ts';
import { recordedCommand, type CommandRecord } from './native-trace.ts';
const realTrace = await vi.importActual<typeof import('./native-trace.ts')>('./native-trace.ts');
const dirs: string[] = [];
const gpuJobs: ReturnType<typeof recordedCommand>[] = [];
const helperGroups = new Set<number>();
afterEach(async () => {
  // Old-source negative control must also drain, even when its assertions fail.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  for (const group of helperGroups) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  helperGroups.clear();
  for (const job of gpuJobs.splice(0)) await job.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('full native capture callback ownership (CPU synthetic browser/trace, real helper descendants)', () => {
  const cases = [
    { mode: 'helper-failure', protocol: 'pass-queries', workClass: '' },
    { mode: 'helper-timeout', protocol: 'pass-queries', workClass: '' },
    { mode: 'page-failure', protocol: 'pass-queries', workClass: '' },
    { mode: 'page-failure', protocol: 'off-off', workClass: '' },
    ...['drained-empty', 'fence-only', 'frame-only', 'frame-plus-PNG'].map((workClass) => ({ mode: 'page-failure', protocol: 'work-class', workClass })),
    { mode: 'helper-failure', protocol: 'work-class', workClass: 'frame-only' },
    { mode: 'helper-timeout', protocol: 'work-class', workClass: 'frame-only' },
    { mode: 'work-class-control-failed', protocol: 'work-class', workClass: 'frame-plus-PNG' },
    { mode: 'outer-timeout', protocol: 'work-class', workClass: 'frame-only' },
    ...['drained-empty', 'fence-only', 'frame-only', 'frame-plus-PNG'].map((workClass) => ({ mode: 'work-class-success', protocol: 'work-class', workClass })),
  ];
  it.each(cases)(
    'settles $mode/$protocol before returning terminal artifacts and never launches later control work',
    async ({ mode, protocol, workClass = '' }) => {
      const folder = mkdtempSync(join(tmpdir(), 'native-control-lifecycle-'));
      dirs.push(folder);
      Object.assign(state, {
        out: folder,
        script: join(folder, 'synthetic.mjs'),
        mode,
        identityCalls: 0,
        controlEntered: false,
        controlHelperStarted: false,
        pageClosed: false,
        runCalls: 0,
        runAction: '',
        prepareAction: '',
        workClass: '',
        lateCalls: 0,
        pendingPage: undefined,
      });
      writeFileSync(
        state.script,
        `
      import {existsSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
      import {spawn} from 'node:child_process';
      const [out,mode,...args]=process.argv.slice(2), wait=ms=>new Promise(r=>setTimeout(r,ms));
      if(mode==='control-helper'){
        const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
        appendFileSync(out+'/control-ready',JSON.stringify({pid:process.pid,descendant:c.pid})+'\\n');
        setInterval(()=>{},1000);
      } else if(args[0]==='-v') {
        while(!existsSync(out+'/notify'))await wait(5);
        console.log(args.at(-1));
      } else if(args[0]==='record') {
        if(['work-class-control-failed','outer-timeout','work-class-success'].includes(mode)) {
          process.on('SIGINT',()=>{mkdirSync(args[args.indexOf('--output')+1]);console.log('CPU saved trace');process.exit(0);});
          writeFileSync(out+'/notify','ready');setInterval(()=>{},1000);await new Promise(()=>{});
        }
        writeFileSync(out+'/notify','ready');
        if(mode==='page-failure')await wait(150);
        else while(!existsSync(out+'/control-ready'))await wait(5);
        if(mode==='helper-timeout')setInterval(()=>{},1000);
        else {await wait(20);process.exit(7);}
      } else if(args[0]==='export'&&['work-class-control-failed','outer-timeout','work-class-success'].includes(mode))writeFileSync(args[args.indexOf('--output')+1],'<trace-toc synthetic="CPU-only"/>');
      else process.exit(19);
    `,
      );
      const gpu = recordedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], []);
      gpuJobs.push(gpu);
      state.gpuPid = gpu.record.pid!;
      state.stopGpu = gpu.stop;
      const asset = join(folder, 'virtual-asset');
      writeFileSync(asset, 'CPU virtual asset');
      const out = join(folder, 'output');
      let outerFailure: string | undefined;
      const result = await captureNativePass(
        nativePassArgs([
          '--review',
          'characters/thalune:thalune/thalune_suit2',
          '--asset-file',
          asset,
          '--asset-sha256',
          'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27',
          '--out',
          out,
          ...(protocol === 'work-class' ? ['--protocol', 'work-class', '--work-class', workClass] : protocol === 'off-off' ? ['--protocol', 'off-off'] : []),
        ]),
      ).catch((error) => {
        outerFailure = String(error);
        return { out, errors: [outerFailure] };
      });
      const saved: CommandRecord[] = JSON.parse(readFileSync(join(out, 'helpers.json'), 'utf8'));
      const native = JSON.parse(readFileSync(join(out, 'native.json'), 'utf8'));
      const status = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8'));
      const context = JSON.parse(readFileSync(join(out, 'context.json'), 'utf8'));
      const control = saved.find((c) => c.args.includes('control-helper'));
      for (const c of saved) if (c.group) helperGroups.add(c.group);
      const rows = await realTrace.processRows();
      const live = rows.filter((r) => helperGroups.has(r.pgid));
      const evidence = {
        mode,
        protocol,
        result,
        status,
        native,
        helpers: saved.map(({ stdout, stderr, ...c }) => c),
        liveAtReturn: live,
        runCalls: state.runCalls,
        lateCalls: state.lateCalls,
        pageClosed: state.pageClosed,
        prepareAction: state.prepareAction,
        runAction: state.runAction,
      };
      if (process.env.NATIVE_CONTROL_EVIDENCE) {
        const previous = existsSync(process.env.NATIVE_CONTROL_EVIDENCE) ? JSON.parse(readFileSync(process.env.NATIVE_CONTROL_EVIDENCE, 'utf8')) : [];
        writeFileSync(process.env.NATIVE_CONTROL_EVIDENCE, JSON.stringify([...previous, evidence], null, 2) + '\n');
      }
      if (mode === 'work-class-success') expect(result.errors).toEqual([]);
      else
        expect(result.errors.join('\n')).toContain(
          mode === 'outer-timeout'
            ? 'outer deadline'
            : mode === 'work-class-control-failed'
              ? 'work-class control failed'
              : mode === 'helper-timeout'
                ? 'frame controls exceeded'
                : 'recording ended',
        );
      if (mode === 'outer-timeout') {
        expect(outerFailure).toContain('outer deadline');
        expect(status.errors.join(' ')).toContain('outer deadline');
      }
      if (['outer-timeout', 'work-class-control-failed'].includes(mode)) {
        expect(native.recorderFinalization.status).toBe('finalized');
        expect(native.tocExport.status).toBe('exported');
        expect(readFileSync(join(out, 'controls-failed.json'), 'utf8')).toContain('partial retained control failure');
      }
      expect(saved.every((c) => c.finishedAt && c.groupState === 'absent')).toBe(true);
      expect(live).toEqual([]);
      expect(native.controlsSettledAt).toEqual(expect.any(String));
      if (mode === 'work-class-success') expect(native.controlFailure).toBeNull();
      else expect(native.controlFailure).toEqual(expect.any(String));
      expect(context).toMatchObject({
        protocol,
        pairs: protocol === 'work-class' ? 0 : protocol === 'off-off' ? 1 : 5,
        maxControlFrames: protocol === 'work-class' ? (workClass.startsWith('frame-') ? 1 : 0) : protocol === 'off-off' ? 2 : 10,
      });
      expect(state.prepareAction).toBe(protocol === 'work-class' ? 'work-class-prepare' : protocol === 'off-off' ? 'prepare-off-off' : 'prepare');
      if (protocol === 'work-class') expect(state.workClass).toBe(workClass);
      expect(status.at >= native.controlsSettledAt).toBe(true);
      if (!['page-failure', 'outer-timeout', 'work-class-control-failed', 'work-class-success'].includes(mode)) {
        expect(control).toBeDefined();
        expect(control?.failure).toContain('abort');
        expect(state.runCalls).toBe(0);
      } else {
        expect(state.runCalls).toBe(1);
        expect(state.runAction).toBe(protocol === 'work-class' ? 'work-class-run' : protocol === 'off-off' ? 'run-off-off' : 'run');
        expect(state.pageClosed).toBe(mode !== 'work-class-success');
      }
      expect(state.lateCalls).toBe(mode === 'work-class-success' ? 2 : 0);
      const terminalPaths = ['helpers.json', 'native.json', 'status.json', mode === 'work-class-success' ? 'controls.json' : 'controls-failed.json'];
      const terminal = terminalPaths.map((p) => readFileSync(join(out, p), 'utf8'));
      await new Promise((r) => setTimeout(r, 100));
      expect(terminalPaths.map((p) => readFileSync(join(out, p), 'utf8'))).toEqual(terminal);
    },
  );
});
