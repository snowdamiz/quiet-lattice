import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { expect, killProcessTree, test } from './harness.ts';

// A spec whose page stops answering must fail within its own timeout (plus the guard's grace), not hold the run up
// until Playwright's close of the stuck page gives up 16 minutes later.
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');

async function run(grace: number, cleanup: boolean): Promise<{ code: number | null; out: string }> {
  const child = spawn(process.execPath, [cli, 'test', 'harness-hang', '--reporter=list'], {
    env: { ...process.env, SMOKE_HARNESS_HANG: '1', SMOKE_HARNESS_HANG_GRACE: String(grace), SMOKE_HARNESS_HANG_CLEANUP: cleanup ? '1' : '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const killer = setTimeout(() => {
    if (child.pid !== undefined) killProcessTree(child.pid);
  }, 60_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    return { code, out };
  } finally {
    clearTimeout(killer);
  }
}

for (const { grace, cleanup } of [
  { grace: 15_000, cleanup: true },
  { grace: 1000, cleanup: false },
  { grace: 1000, cleanup: true },
])
  test(`a hung page fails at its 6 s timeout, closing grace ${grace / 1000} s, cleanup ${cleanup}, and the next test still runs`, async () => {
    test.setTimeout(90_000);
    const { code, out } = await run(grace, cleanup);
    expect(out).toContain('Test timeout of 6000ms exceeded');
    expect(out).toMatch(/1 failed/);
    expect(out).toMatch(/1 passed/);
    expect(code).toBe(1);
    const started = Number(out.match(/HANG_STARTED=(\d+)/)?.[1]);
    const recovered = Number(out.match(/HANG_RECOVERED=(\d+)/)?.[1]);
    // Measure from the spinning page to its successor, allowing four seconds for a fresh worker/browser.
    expect(recovered - started, out).toBeLessThan(6000 + grace + 4000);
    expect(out).toContain('hang guard: the page did not close in time');
  });
