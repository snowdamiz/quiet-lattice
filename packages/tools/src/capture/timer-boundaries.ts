// Separate attribution experiment. Never imports or runs the budget-comparison entry point.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { chromium, type Browser } from '@playwright/test';
import { glArgs, openReview, startVite } from './capture.ts';
import { FROZEN_SOURCES } from './benchmark-runs.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const command = promisify(execFile);
const digest = (body: Buffer) => createHash('sha256').update(body).digest('hex');

export function timerBoundaryArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      review: { type: 'string' },
      'asset-file': { type: 'string' },
      'asset-sha256': { type: 'string' },
      out: { type: 'string' },
      light: { type: 'string', default: 'noon-lush' },
    },
  });
  if (!values.review || !values['asset-file'] || !values['asset-sha256'] || !values.out)
    throw new Error('Required: --review family/file:asset/variant --asset-file exact.glb --asset-sha256 SHA256 --out new-directory [--light noon-lush]');
  if (!/^[a-f0-9]{64}$/.test(values['asset-sha256'])) throw new Error('Expected an exact lowercase SHA-256');
  if (!['noon-lush', 'night-exotic', 'open-space'].includes(values.light)) throw new Error('Unknown standard lighting case');
  return { spec: values.review, assetPath: resolve(values['asset-file']), assetSha256: values['asset-sha256'], out: resolve(values.out), light: values.light };
}

export function timerBoundaryAsset(options: Pick<ReturnType<typeof timerBoundaryArgs>, 'assetPath' | 'assetSha256'>) {
  const body = readFileSync(options.assetPath);
  if (digest(body) !== options.assetSha256) throw new Error('Input asset does not match the requested SHA-256');
  if (body.toString('ascii', 0, 4) !== 'glTF') throw new Error('Input is not hydrated GLB bytes');
  return body;
}

export async function captureTimerBoundaries(options: ReturnType<typeof timerBoundaryArgs>) {
  const body = timerBoundaryAsset(options);
  // A new directory is mandatory; failed or successful experiments are never overwritten.
  mkdirSync(options.out);
  const save = (name: string, value: unknown) => writeFileSync(join(options.out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const paths = [
    ...FROZEN_SOURCES,
    'packages/client/src/dev/timer-boundaries.js',
    'packages/client/src/dev/gpu-completion.js',
    'packages/client/src/dev/dependent-output.js',
    'packages/tools/src/capture/timer-boundaries.ts',
    'packages/client/src/core/Engine.js',
    'packages/client/src/render/AtmospherePass.js',
    'packages/client/src/Game.js',
  ];
  const sources = Object.fromEntries(paths.map((path) => [path, digest(readFileSync(join(ROOT, path)))]));
  const verify = () => {
    for (const [path, hash] of Object.entries(sources))
      if (digest(readFileSync(join(ROOT, path))) !== hash) throw new Error(`Diagnostic source changed: ${path}`);
    if (digest(readFileSync(options.assetPath)) !== options.assetSha256) throw new Error('Exact input changed during diagnostic');
  };
  const errors: string[] = [];
  const observations: unknown[] = [];
  let phase = 'startup';
  let hostJob: Promise<void> | null = null;
  const observe = (): Promise<void> => {
    if (hostJob) return hostJob;
    const at = new Date().toISOString();
    const sampledPhase = phase;
    const load = loadavg();
    hostJob = (async () => {
      try {
        const [processes, gpu] = await Promise.allSettled([
          command('ps', ['-axo', 'pid,ppid,pcpu,pmem,etime,comm', '-r']),
          platform() === 'darwin' ? command('ioreg', ['-r', '-c', 'IOAccelerator', '-d', '1', '-l']) : Promise.resolve({ stdout: 'IOAccelerator unavailable' }),
        ]);
        observations.push({
          at,
          phase: sampledPhase,
          load,
          processes: processes.status === 'fulfilled' ? processes.value.stdout : String(processes.reason),
          gpu:
            gpu.status === 'fulfilled'
              ? gpu.value.stdout.split('\n').filter((line) => /PerformanceStatistics|"model"|unavailable/.test(line))
              : String(gpu.reason),
        });
      } catch (error) {
        observations.push({ at, phase: sampledPhase, load, error: String(error) });
      }
      writeFileSync(join(options.out, 'host-samples.json'), JSON.stringify(observations, null, 2) + '\n');
    })().finally(() => {
      hostJob = null;
    });
    return hostJob;
  };
  let browser: Browser | undefined;
  let server: Awaited<ReturnType<typeof startVite>> | undefined;
  let session: Awaited<ReturnType<typeof openReview>> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await observe();
    timer = setInterval(() => {
      void observe().catch((error) => errors.push(`Host collector: ${String(error)}`));
    }, 1000);
    const { args, gl } = glArgs();
    browser = await chromium.launch({ args });
    let browserVersion: unknown;
    try {
      const cdp = await browser.newBrowserCDPSession();
      try {
        browserVersion = await cdp.send('Browser.getVersion');
      } finally {
        await cdp.detach();
      }
    } catch (error) {
      browserVersion = { error: String(error), limit: 'Exact Chromium/ANGLE revision remains unpinned' };
    }
    save('context.json', {
      diagnosticOnly: true,
      kind: 'timer-boundary-controls',
      contractVersion: 2,
      ...options,
      assetBytes: body.length,
      viewport: [1920, 1080],
      browser: browser.version(),
      browserVersion,
      gl,
      args,
      sourceHead: (await command('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim(),
      sourceStatus: (await command('git', ['status', '--short'], { cwd: ROOT })).stdout,
      sources,
      logicalCores: cpus().length,
      cpu: cpus()[0]?.model,
      blocks: 5,
      maxControlFrames: 35,
      maxQueryControls: 35,
      maxDependentControlPasses: 25,
      dependentWarmupPasses: 4,
      maxWarmupFrames: 600,
      hostIntervalMs: 1000,
      method:
        'Separate diagnostic only. One-second host observation differs from the five-second budget runner. Snapshot overhead can overlap particular controls and is not assumed equal; raw timestamps retain that uncertainty. No budget or renderer-speedup inference.',
      premise:
        'Timer-query durations may not be trustworthy exclusive elapsed time on this executing backend. Observe WebGLSync completion and GPU-dependent readback before interpreting recorded query/monotonic wall intervals; changing fences alone does not validate timing.',
    });
    phase = 'loading';
    server = await startVite(ROOT);
    session = await openReview(browser, server.url, options.spec, { url: `/models/${options.spec.split(':')[0]}.glb`, body });
    phase = 'settling';
    await session.page.evaluate(async (light) => {
      await window.review.light(light);
      window.review.lod(0);
      window.review.wireframe(false);
    }, options.light);
    verify();
    phase = 'controls';
    await observe();
    try {
      save('controls.json', await session.page.evaluate(() => window.review.timerBoundaries({ blocks: 5 })));
    } catch (error) {
      const partial = await session.page.evaluate(() => window.review.lastTimerBoundaries).catch(() => null);
      save('controls-failed.json', { failed: true, error: String(error), pageErrors: session.errors, partial });
      throw error;
    }
    verify();
    phase = 'capture';
    const shot = await session.page.evaluate(() => window.review.capture());
    writeFileSync(join(options.out, 'scene.png'), Buffer.from(shot.slice(shot.indexOf(',') + 1), 'base64'), { flag: 'wx' });
  } catch (error) {
    errors.push(String(error));
  } finally {
    phase = 'finished';
    if (timer) clearInterval(timer);
    if (browser)
      try {
        await browser.close();
      } catch (error) {
        errors.push(`Browser close: ${String(error)}`);
      }
    if (server)
      try {
        await server.stop();
      } catch (error) {
        errors.push(`Vite stop: ${String(error)}`);
      }
    if (hostJob) await hostJob;
    await observe();
    if (session) errors.push(...session.errors);
    save('status.json', {
      diagnosticOnly: true,
      finishedAt: new Date().toISOString(),
      errors,
      pageErrors: session?.errors ?? [],
      budgetObservation: 'not-measured',
    });
  }
  return { out: options.out, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureTimerBoundaries(timerBoundaryArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.errors.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
