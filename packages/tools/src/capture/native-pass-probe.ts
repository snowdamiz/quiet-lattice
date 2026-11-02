import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserServer } from '@playwright/test';
import { glArgs, openReview } from './capture.ts';
import { startOwnedVite } from './native-vite.ts';
import { FROZEN_SOURCES } from './benchmark-runs.ts';
import { timerBoundaryArgs, timerBoundaryAsset } from './timer-boundaries.ts';
import {
  bounded,
  discoverNativeCli,
  NativeDiscoveryError,
  NativeTraceError,
  ownedDescendants,
  ownedGpuPid,
  processRows,
  runOwnedHelper,
  withNativeTrace,
  type NativeTraceLog,
  type ProcessRow,
  type CommandRecord,
} from './native-trace.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function nativePassArgs(args: string[]) {
  const options = timerBoundaryArgs(args);
  nativeScope(options);
  return options;
}

function nativeScope(options: ReturnType<typeof timerBoundaryArgs>) {
  if (
    options.spec !== 'characters/thalune:thalune/thalune_suit2' ||
    options.light !== 'noon-lush' ||
    options.assetSha256 !== 'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27'
  )
    throw new Error('Native pass diagnostic is limited to the exact Thalune suit2/noon-lush input');
}

/** Keep actual image bytes separately; never call capture(), which would render an extra frame. */
export function saveNativeOutputs(value: unknown, out: string) {
  if (!record(value) || !Array.isArray(value.samples)) return value;
  for (const [index, sample] of value.samples.entries()) {
    if (!record(sample) || sample.png === null || sample.png === undefined) continue;
    if (typeof sample.png !== 'string' || !sample.png.startsWith('data:image/png;base64,')) throw new Error('Invalid retained scene PNG');
    const bytes = Buffer.from(sample.png.slice(22), 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Retained image does not have PNG bytes');
    const file = `frame-${index + 1}.png`;
    const path = join(out, file);
    if (existsSync(path)) {
      if (!readFileSync(path).equals(bytes)) throw new Error('Existing retained scene PNG differs; refusing overwrite');
    } else writeFileSync(path, bytes, { flag: 'wx' });
    sample.output = { file, bytes: bytes.length, sha256: digest(bytes) };
    delete sample.png;
  }
  return value;
}

export async function nativeSourceState(root: string, commands: CommandRecord[]) {
  const head = await runOwnedHelper('git', ['rev-parse', 'HEAD'], commands, { cwd: root, deadlineMs: 5000 });
  const status = await runOwnedHelper('git', ['status', '--short'], commands, { cwd: root, deadlineMs: 5000 });
  return { sourceHead: head.stdout.trim(), sourceStatus: status.stdout };
}

export async function captureNativePass(options: ReturnType<typeof nativePassArgs>) {
  nativeScope(options);
  if (existsSync(options.out)) throw new Error('EEXIST: diagnostic output must be a new directory');
  const body = timerBoundaryAsset(options);
  if (platform() !== 'darwin' || glArgs().gl !== 'metal') throw new Error('Native diagnostic requires the macOS Metal backend');
  mkdirSync(options.out);
  const save = (name: string, data: unknown) => writeFileSync(join(options.out, name), JSON.stringify(data, null, 2) + '\n');
  const paths = [
    ...new Set([
      ...FROZEN_SOURCES,
      'packages/client/src/dev/native-pass-probe.js',
      'packages/client/src/dev/gpu-completion.js',
      'packages/client/src/dev/dependent-output.js',
      'packages/tools/src/capture/native-pass-probe.ts',
      'packages/tools/src/capture/native-trace.ts',
      'packages/tools/src/capture/native-vite.ts',
      'packages/tools/src/capture/native-vite-child.ts',
      'packages/client/src/core/Engine.js',
      'packages/client/src/render/AtmospherePass.js',
      'packages/client/src/Game.js',
    ]),
  ];
  const sources = Object.fromEntries(paths.map((p) => [p, digest(readFileSync(join(ROOT, p)))]));
  const verify = () => {
    for (const [p, hash] of Object.entries(sources))
      if (digest(readFileSync(join(ROOT, p))) !== hash) throw new Error(`Native diagnostic source changed: ${p}`);
    if (digest(readFileSync(options.assetPath)) !== options.assetSha256) throw new Error('Exact input asset changed');
  };
  let browserServer: BrowserServer | undefined;
  let browser: Browser | undefined;
  let vite: Awaited<ReturnType<typeof startOwnedVite>> | undefined;
  let session: Awaited<ReturnType<typeof openReview>> | undefined;
  let native: NativeTraceLog | undefined;
  let controlsCancelled = false;
  let cancelledPartial: unknown = null;
  let browserPid: number | undefined;
  let phase = 'preflight';
  let timer: ReturnType<typeof setInterval> | undefined;
  let hostJob: Promise<void> | undefined;
  const host: unknown[] = [];
  const observed = new Map<number, ProcessRow>();
  const errors: string[] = [];
  const helpers: CommandRecord[] = [];
  const observe = () => {
    if (hostJob) return hostJob;
    const at = new Date().toISOString();
    const sampledPhase = phase;
    hostJob = (async () => {
      const [rows, cpu, gpu] = await Promise.allSettled([
        processRows(helpers),
        runOwnedHelper('ps', ['-axo', 'pid,ppid,pgid,pcpu,pmem,etime,comm', '-r'], helpers, { deadlineMs: 1000 }),
        runOwnedHelper('ioreg', ['-r', '-c', 'IOAccelerator', '-d', '1', '-l'], helpers, { deadlineMs: 1000 }),
      ]);
      if (rows.status === 'fulfilled') {
        for (const root of [process.pid, browserPid, ...(native?.commands.map((c) => c.pid) ?? [])])
          if (root) for (const row of ownedDescendants(rows.value, root)) observed.set(row.pid, row);
      }
      const collectorErrors = [rows, cpu, gpu].flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []));
      errors.push(...collectorErrors.map((e) => `Host collector: ${e}`));
      host.push({
        at,
        hostMonotonicNs: process.hrtime.bigint().toString(),
        phase: sampledPhase,
        load: loadavg(),
        owned: [...observed.values()],
        cpuTop20WithoutArguments: cpu.status === 'fulfilled' ? cpu.value.stdout.split('\n').slice(0, 21) : String(cpu.reason),
        aggregateGpu: gpu.status === 'fulfilled' ? gpu.value.stdout.split('\n').filter((l) => /PerformanceStatistics|"model"/.test(l)) : String(gpu.reason),
        collectorErrors,
      });
      save('host.json', host);
      save('helpers.json', helpers);
      if (native) save('native.json', native);
    })().finally(() => {
      hostJob = undefined;
    });
    return hostJob;
  };
  try {
    save('installed-cli.json', await discoverNativeCli());
    const sourceState = await nativeSourceState(ROOT, helpers);
    await observe();
    timer = setInterval(() => {
      void observe().catch((e) => errors.push(`Host collector: ${String(e)}`));
    }, 1000);
    phase = 'server-startup';
    vite = await startOwnedVite(ROOT, helpers);
    const { args, gl } = glArgs();
    browserServer = await chromium.launchServer({ args, timeout: 30_000 });
    browserPid = browserServer.process().pid;
    if (!browserPid) throw new Error('Owned browser PID unavailable');
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 30_000 });
    const cdp = await bounded(browser.newBrowserCDPSession(), 10_000, 'browser CDP session');
    try {
      const browserVersion = await bounded(cdp.send('Browser.getVersion'), 10_000, 'browser version');
      phase = 'loading';
      session = await bounded(openReview(browser, vite.url, options.spec, { url: '/models/characters/thalune.glb', body }), 240_000, 'review load');
      await bounded(
        session.page.evaluate(async () => {
          await window.review.light('noon-lush');
          window.review.lod(0);
          window.review.wireframe(false);
        }),
        120_000,
        'review light',
      );
      phase = 'preparing';
      save(
        'prepared.json',
        await bounded(
          session.page.evaluate(() => window.review.nativePassProbe('prepare')),
          90_000,
          'native probe preparation',
        ),
      );
      const processes = await bounded(cdp.send('SystemInfo.getProcessInfo'), 10_000, 'GPU process identity');
      const rows = await processRows(helpers);
      const gpuPid = ownedGpuPid(processes.processInfo, rows, browserPid);
      const reviewSession = session;
      const clockCorrelations: unknown[] = [];
      const correlateClocks = async (signal: AbortSignal) => {
        signal.throwIfAborted();
        const before = { wallMs: Date.now(), monotonicNs: process.hrtime.bigint().toString() };
        const page = await bounded(
          reviewSession.page.evaluate(() => ({ wallMs: Date.now(), monotonicMs: performance.now(), timeOriginMs: performance.timeOrigin })),
          5000,
          'control clock correlation',
          signal,
        );
        signal.throwIfAborted();
        const after = { wallMs: Date.now(), monotonicNs: process.hrtime.bigint().toString() };
        clockCorrelations.push({ before, page, after });
        save('clock-correlations.json', clockCorrelations);
      };
      save('context.json', {
        diagnosticOnly: true,
        ...options,
        bodyBytes: body.length,
        sources,
        browserVersion,
        gl,
        args,
        browserPid,
        gpuPid,
        owned: ownedDescendants(rows, browserPid),
        viteUrl: vite.url,
        ...sourceState,
        logicalCores: cpus().length,
        cpu: cpus()[0]?.model,
        pairs: 5,
        maxControlFrames: 10,
        trace: 'Attach only to this verified owned GPU PID; no global collection, privacy/settings mutation or automatic trace-evidence qualification.',
      });
      console.log(JSON.stringify({ phase: 'native-startup', at: new Date().toISOString(), runnerPid: process.pid, browserPid, gpuPid }));
      verify();
      phase = 'native';
      const captured = await withNativeTrace(
        gpuPid,
        options.out,
        async (signal) => {
          signal.throwIfAborted();
          const before = await bounded(cdp.send('SystemInfo.getProcessInfo'), 5000, 'GPU identity before controls', signal);
          signal.throwIfAborted();
          const beforeRows = await processRows(helpers, signal);
          signal.throwIfAborted();
          if (ownedGpuPid(before.processInfo, beforeRows, browserPid!) !== gpuPid) throw new Error('Owned GPU process changed before controls');
          await correlateClocks(signal);
          signal.throwIfAborted();
          const result = await bounded(
            reviewSession.page.evaluate(() => window.review.nativePassProbe('run')),
            10_000,
            'native page controls',
            signal,
          );
          signal.throwIfAborted();
          await correlateClocks(signal);
          signal.throwIfAborted();
          const after = await bounded(cdp.send('SystemInfo.getProcessInfo'), 5000, 'GPU identity after controls', signal);
          signal.throwIfAborted();
          const afterRows = await processRows(helpers, signal);
          signal.throwIfAborted();
          if (ownedGpuPid(after.processInfo, afterRows, browserPid!) !== gpuPid) throw new Error('Owned GPU process changed during controls');
          return result;
        },
        undefined,
        (evidence) => {
          native = evidence;
          save('native.json', native);
        },
        async () => {
          controlsCancelled = true;
          // Cleanup operations may run after cancellation; further frame/clock/identity work may not.
          const cleanupErrors: string[] = [];
          try {
            await bounded(
              reviewSession.page.evaluate(() => window.review.nativePassProbe('cancel')),
              5000,
              'native probe cancellation',
            );
            cancelledPartial = await bounded(
              reviewSession.page.evaluate(() => window.review.lastNativePassProbe),
              5000,
              'native partial report',
            );
          } catch (error) {
            cleanupErrors.push(String(error));
          }
          try {
            // Closing the owned page interrupts a pending evaluate, allowing the callback itself to settle.
            await bounded(reviewSession.page.close({ runBeforeUnload: false }), 5000, 'cancelled native page close');
          } catch (error) {
            cleanupErrors.push(String(error));
            try {
              await bounded(browserServer!.kill(), 10_000, 'cancelled owned browser kill');
            } catch (killError) {
              cleanupErrors.push(String(killError));
            }
          }
          if (cleanupErrors.length) throw new Error(`Native control cancellation cleanup failed: ${cleanupErrors.join('; ')}`);
        },
      );
      native = captured.evidence;
      save('controls.json', saveNativeOutputs(captured.result, options.out));
      verify();
    } finally {
      try {
        await bounded(cdp.detach(), 5000, 'browser CDP detach');
      } catch (error) {
        errors.push(`Browser CDP detach: ${String(error)}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
    if (error instanceof NativeDiscoveryError) save('installed-cli.json', error.evidence);
    if (error instanceof NativeTraceError) {
      native = error.evidence;
      save('native.json', native);
    }
    if (session) {
      if (!controlsCancelled)
        await bounded(
          session.page.evaluate(() => window.review.nativePassProbe('cancel')),
          5000,
          'native probe cancellation',
        ).catch((e) => errors.push(`Cancel: ${String(e)}`));
      const partial = controlsCancelled
        ? cancelledPartial
        : await bounded(
            session.page.evaluate(() => window.review.lastNativePassProbe),
            5000,
            'native partial report',
          ).catch(() => null);
      try {
        save('controls-failed.json', { error: String(error), partial: saveNativeOutputs(partial, options.out) });
      } catch (e) {
        errors.push(`Partial image save: ${String(e)}`);
        save('controls-failed.json', { error: String(error), partial });
      }
    }
  } finally {
    phase = 'cleanup';
    if (timer) clearInterval(timer);
    try {
      if (browser) await bounded(browser.close(), 30_000, 'browser close');
    } catch (error) {
      errors.push(`browser: ${String(error)}`);
    }
    if (browserServer)
      try {
        await bounded(browserServer.close(), 30_000, 'browser server close');
      } catch (error) {
        errors.push(`browser server: ${String(error)}`);
        try {
          await bounded(browserServer.kill(), 10_000, 'owned browser server kill');
        } catch (killError) {
          errors.push(`browser server kill: ${String(killError)}`);
        }
      }
    try {
      if (vite) await bounded(vite.stop(), 30_000, 'Vite close');
    } catch (error) {
      errors.push(`Vite: ${String(error)}`);
    }
    if (hostJob)
      try {
        await hostJob;
      } catch (error) {
        errors.push(`Host collector drain: ${String(error)}`);
      }
    try {
      await observe();
    } catch (error) {
      errors.push(`Final host collector: ${String(error)}`);
    }
    save('helpers.json', helpers);
    if (session) errors.push(...session.errors);
    try {
      verify();
    } catch (error) {
      errors.push(String(error));
    }
    save('status.json', {
      diagnosticOnly: true,
      at: new Date().toISOString(),
      errors,
      pageErrors: session?.errors ?? [],
      runnerPid: process.pid,
      observedOwned: [...observed.values()],
      nativeEvidence: 'uninspected/inconclusive until actual owned GPU lifecycle/work, clock mapping and all frame/readback windows are established',
      cleanupLimit:
        'This runner and its launcher/idle assertion finish after this report; parent must verify their final exit and all observed process groups. OS-owned unrelated services are untouched.',
      budgetObservation: 'not-measured',
    });
  }
  return { out: options.out, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureNativePass(nativePassArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.errors.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
