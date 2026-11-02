// Dedicated review-scene diagnostics, then uninstrumented repeated runs. Never run alongside another GPU job.
// pnpm exec tsx packages/tools/src/capture/benchmark.ts --mode profile --review characters/thalune:thalune/thalune_suit2 --asset-file /exact/thalune.glb --out /report
// Add --compare-root /baseline/checkout in measure mode: each case gets five alternating baseline/candidate pairs.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, freemem, loadavg, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { chromium, type Browser } from '@playwright/test';
import { glArgs, openReview, startVite } from './capture.ts';

const command = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LIGHTS = ['noon-lush', 'night-exotic', 'open-space'];
const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    review: { type: 'string' },
    out: { type: 'string' },
    'asset-file': { type: 'string' },
    'asset-sha256': { type: 'string' },
    'compare-root': { type: 'string' },
  },
});
if ((values.mode !== 'profile' && values.mode !== 'measure') || !values.review || !values.out) {
  throw new Error(
    'Required: --mode profile|measure --review family/file:asset/variant --out report-directory [--asset-file exact.glb] [--compare-root baseline-checkout]',
  );
}
if (values.mode === 'profile' && values['compare-root']) throw new Error('Profile one source tree at a time; the comparison is a separate measurement run.');
const mode = values.mode;
const spec = values.review;
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const save = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const assetUrl = `/models/${spec.split(':')[0]}.glb`;
const assetPath = resolve(values['asset-file'] ?? join(ROOT, 'packages/client/public', assetUrl));
const body = readFileSync(assetPath);
if (values['asset-sha256'] && sha256(body) !== values['asset-sha256']) throw new Error('Input asset does not match the requested SHA-256');
const roots = values['compare-root']
  ? [
      { label: 'baseline', root: resolve(values['compare-root']) },
      { label: 'candidate', root: ROOT },
    ]
  : [{ label: 'current', root: ROOT }];
const sources = [
  'packages/client/src/dev/review.js',
  'packages/client/src/core/Engine.js',
  'packages/client/src/render/AtmospherePass.js',
  'packages/tools/src/capture/capture.ts',
  'packages/tools/src/capture/benchmark.ts',
  'pnpm-lock.yaml',
];
const hostSamples: unknown[] = [];
let phase = 'startup';
let sampling = false;
async function hostSample() {
  if (sampling) return;
  sampling = true;
  const at = new Date().toISOString();
  const sampledPhase = phase;
  const load = loadavg();
  const free = freemem();
  try {
    const [processes, gpu] = await Promise.allSettled([
      command('ps', ['-axo', 'pid,ppid,pcpu,pmem,etime,comm', '-r']),
      platform() === 'darwin'
        ? command('ioreg', ['-r', '-c', 'IOAccelerator', '-d', '1', '-l'])
        : Promise.resolve({ stdout: 'IOAccelerator counters unavailable on this platform' }),
    ]);
    hostSamples.push({
      at,
      phase: sampledPhase,
      load,
      freeMemoryBytes: free,
      processes: processes.status === 'fulfilled' ? processes.value.stdout : String(processes.reason),
      gpu:
        gpu.status === 'fulfilled' ? gpu.value.stdout.split('\n').filter((line) => /PerformanceStatistics|"model"|unavailable/.test(line)) : String(gpu.reason),
    });
  } catch (error) {
    hostSamples.push({ at, phase: sampledPhase, load, error: String(error) });
  } finally {
    sampling = false;
    save('host-samples.json', hostSamples);
  }
}
await hostSample();
const timer = setInterval(() => void hostSample(), 5000);
const { args, gl } = glArgs();
const sessions: { label: string; page: Awaited<ReturnType<typeof openReview>>['page']; errors: string[] }[] = [];
const servers: Awaited<ReturnType<typeof startVite>>[] = [];
const errors: string[] = [];
const completed: string[] = [];
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ args });
  save('context.json', {
    mode,
    startedAt: new Date().toISOString(),
    spec,
    assetPath,
    assetSha256: sha256(body),
    viewport: [1920, 1080],
    gl,
    browser: browser.version(),
    args,
    machine: { platform: platform(), release: release(), logicalCores: cpus().length, cpu: cpus()[0]?.model, memoryBytes: totalmem() },
    sourceTrees: await Promise.all(
      roots.map(async ({ label, root }) => ({
        label,
        root,
        head: (await command('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(),
        dirty: (await command('git', ['status', '--short'], { cwd: root })).stdout,
        sources: Object.fromEntries(
          sources.map((path) => {
            try {
              return [path, sha256(readFileSync(join(root, path)))];
            } catch {
              return [path, null];
            }
          }),
        ),
      })),
    ),
    claim:
      'Only the fixed 1080p offline development review scene is measured. All three cases must meet the whole-scene CPU/GPU budget; the asset delta alone cannot pass it. No whole-game FPS or production claim.',
    method:
      mode === 'profile'
        ? 'Separate diagnostic run: CPU sampling and per-stage GPU queries, excluded from budget measurements.'
        : 'Five repetitions per side/case, alternating AB/BA when comparing. Each repetition preserves standard adaptive ABBA shown/hidden sampling, warming and actual work.',
    loadSampling: 'Host process/load snapshots every 5 seconds; unrelated processes are never stopped. Sampling overhead is present on both sides.',
  });
  for (const { label, root } of roots) {
    phase = `${label}:loading`;
    const server = await startVite(root);
    servers.push(server);
    const review = await openReview(browser, server.url, spec, { url: assetUrl, body });
    sessions.push({ label, ...review });
  }
  for (const light of LIGHTS) {
    for (const session of sessions) {
      phase = `${session.label}:${light}:settling`;
      await session.page.evaluate(async (light) => {
        await window.review.light(light);
        window.review.lod(0);
        window.review.wireframe(false);
      }, light);
    }
    if (mode === 'profile') {
      for (const session of sessions) {
        phase = `${session.label}:${light}:cpu-profile`;
        const cdp = await session.page.context().newCDPSession(session.page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        await session.page.evaluate(() => window.review.step(120));
        save(`${light}-cpu-profile.json`, await cdp.send('Profiler.stop'));
        await cdp.detach();
        for (const detail of ['passes', 'atmosphere'] as const) {
          phase = `${session.label}:${light}:${detail}`;
          const name = `${light}-${detail}.json`;
          try {
            save(name, await session.page.evaluate((detail) => window.review.profile({ frames: 120, detail }), detail));
          } catch (error) {
            const partial = await session.page.evaluate(() => window.review.lastProfile).catch(() => null);
            save(name, { failed: true, error: String(error), pageErrors: session.errors, partial });
            throw error;
          }
          completed.push(name);
        }
      }
    } else {
      for (let run = 0; run < 5; run++) {
        const order = run % 2 === 0 ? sessions : [...sessions].reverse();
        for (const session of order) {
          phase = `${session.label}:${light}:run-${run + 1}`;
          const name = `${session.label}-${light}-${run + 1}.json`;
          try {
            save(name, await session.page.evaluate(() => window.review.perf({ pairs: 120 })));
            completed.push(name);
          } catch (error) {
            const partial = await session.page.evaluate(() => window.review.lastPerf).catch(() => null);
            save(name, { failed: true, error: String(error), pageErrors: session.errors, partial });
            throw error;
          }
          save('status.json', { phase, completed, errors, pageErrors: sessions.map(({ label, errors }) => ({ label, errors })) });
        }
      }
    }
    for (const session of sessions) {
      const shot = await session.page.evaluate(() => window.review.capture());
      writeFileSync(join(out, `${session.label}-${light}.png`), Buffer.from(shot.slice(shot.indexOf(',') + 1), 'base64'));
    }
  }
  for (const session of sessions) errors.push(...session.errors.map((error) => `${session.label}: ${error}`));
  if (errors.length) throw new Error(`${errors.length} captured page errors`);
} catch (error) {
  errors.push(String(error));
  process.exitCode = 1;
} finally {
  phase = 'finished';
  clearInterval(timer);
  await browser?.close();
  for (const server of servers) await server.stop();
  await hostSample();
  save('status.json', { finishedAt: new Date().toISOString(), completed, errors, pageErrors: sessions.map(({ label, errors }) => ({ label, errors })) });
}
