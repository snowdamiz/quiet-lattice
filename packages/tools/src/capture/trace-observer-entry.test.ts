import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';

it('installed tsx imports the disabled entry without acquisition and serializes both actual page paths', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const script = `
    import { createRequire } from 'node:module';
    const { chromium } = createRequire(process.cwd() + '/packages/tools/package.json')('@playwright/test');
    for (const method of ['launch','launchServer','connect','connectOverCDP']) chromium[method] = () => { throw new Error('Browser acquisition forbidden'); };
    const before = { signals: process.listenerCount('SIGINT') + process.listenerCount('SIGTERM'), handles: process.getActiveResourcesInfo() };
    const { traceObserverEntry } = await import('./packages/tools/src/capture/trace-observer.ts');
    const entrySignals = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
    const proposal = traceObserverEntry(['--proposal']);
    const { observerProbePageCall } = await import('./packages/tools/src/capture/browser-work-probe.ts');
    const vm = await import('node:vm');
    const arms = [];
    for (const arm of ['on','off']) {
      const calls = [], marks = [];
      const fn = vm.runInNewContext('(' + observerProbePageCall.toString() + ')', {
        performance: { now: () => 1, mark: name => { marks.push(name); return { startTime: 1 }; } },
        window: { review: { nativeWorkClassProbe: async (...args) => { calls.push(args); return { observed: 'CPU fake' }; } } }
      });
      const result = await fn({ action: 'run', workClass: 'frame-only', id: 'serialized', arm });
      arms.push({ arm, calls, marks, result });
    }
    process.stdout.write(JSON.stringify({ before, entrySignals, proposal, arms }));
  `;
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: root,
    timeout: 10000,
    maxBuffer: 65536,
  });
  const data = JSON.parse(result.stdout);
  expect(data.entrySignals).toBe(data.before.signals);
  expect(data.proposal).toMatchObject({ readiness: 'disabled', runtimeAuthorized: false });
  expect(data.arms.map((arm: { marks: unknown[] }) => arm.marks.length)).toEqual([2, 0]);
  expect(data.arms.map((arm: { calls: unknown[] }) => arm.calls)).toEqual([[['run', 'frame-only']], [['run', 'frame-only']]]);
});
