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
      evaluate: async (callback: () => unknown) => {
        const text = callback.toString();
        if (/nativePassProbe\(['"]run['"]\)/.test(text)) {
          state.runCalls++;
          if (state.mode === 'page-failure') return new Promise((resolve, reject) => (state.pendingPage = { resolve, reject }));
          state.lateCalls++;
        }
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
      if (state.controlEntered && !state.controlHelperStarted && state.mode !== 'page-failure') {
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
  it.each(['helper-failure', 'helper-timeout', 'page-failure'])(
    'settles %s before returning terminal artifacts and never launches later control work',
    async (mode) => {
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
        lateCalls: 0,
        pendingPage: undefined,
      });
      writeFileSync(
        state.script,
        `
      import {existsSync,writeFileSync,appendFileSync} from 'node:fs';
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
        writeFileSync(out+'/notify','ready');
        if(mode==='page-failure')await wait(150);
        else while(!existsSync(out+'/control-ready'))await wait(5);
        if(mode==='helper-timeout')setInterval(()=>{},1000);
        else {await wait(20);process.exit(7);}
      } else process.exit(19);
    `,
      );
      const gpu = recordedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], []);
      gpuJobs.push(gpu);
      state.gpuPid = gpu.record.pid!;
      state.stopGpu = gpu.stop;
      const asset = join(folder, 'virtual-asset');
      writeFileSync(asset, 'CPU virtual asset');
      const out = join(folder, 'output');
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
        ]),
      );
      const saved: CommandRecord[] = JSON.parse(readFileSync(join(out, 'helpers.json'), 'utf8'));
      const native = JSON.parse(readFileSync(join(out, 'native.json'), 'utf8'));
      const status = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8'));
      const control = saved.find((c) => c.args.includes('control-helper'));
      for (const c of saved) if (c.group) helperGroups.add(c.group);
      const rows = await realTrace.processRows();
      const live = rows.filter((r) => helperGroups.has(r.pgid));
      const evidence = {
        mode,
        result,
        status,
        native,
        helpers: saved.map(({ stdout, stderr, ...c }) => c),
        liveAtReturn: live,
        runCalls: state.runCalls,
        lateCalls: state.lateCalls,
        pageClosed: state.pageClosed,
      };
      if (process.env.NATIVE_CONTROL_EVIDENCE) {
        const previous = existsSync(process.env.NATIVE_CONTROL_EVIDENCE) ? JSON.parse(readFileSync(process.env.NATIVE_CONTROL_EVIDENCE, 'utf8')) : [];
        writeFileSync(process.env.NATIVE_CONTROL_EVIDENCE, JSON.stringify([...previous, evidence], null, 2) + '\n');
      }
      expect(result.errors.join('\n')).toContain(mode === 'helper-timeout' ? 'frame controls exceeded' : 'recording ended');
      expect(saved.every((c) => c.finishedAt && c.groupState === 'absent')).toBe(true);
      expect(live).toEqual([]);
      expect(native.controlsSettledAt).toEqual(expect.any(String));
      expect(native.controlFailure).toEqual(expect.any(String));
      expect(status.at >= native.controlsSettledAt).toBe(true);
      if (mode !== 'page-failure') {
        expect(control).toBeDefined();
        expect(control?.failure).toContain('abort');
        expect(state.runCalls).toBe(0);
      } else {
        expect(state.runCalls).toBe(1);
        expect(state.pageClosed).toBe(true);
      }
      expect(state.lateCalls).toBe(0);
    },
  );
});
