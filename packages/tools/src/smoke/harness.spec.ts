import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { expect, test } from './harness.ts';

// A spec whose page stops answering must fail within its own timeout (plus the guard's grace), not hold the run up
// until Playwright's close of the stuck page gives up 16 minutes later.
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');

async function run(grace: number): Promise<{ code: number | null; out: string; ms: number }> {
  const t0 = Date.now();
  const child = spawn(process.execPath, [cli, 'test', 'harness-hang', '--reporter=list'], {
    env: { ...process.env, SMOKE_HARNESS_HANG: '1', SMOKE_HARNESS_HANG_GRACE: String(grace) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const killer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  const code = await new Promise<number | null>((r) => child.once('exit', r));
  clearTimeout(killer);
  return { code, out, ms: Date.now() - t0 };
}

for (const grace of [15_000, 1000])
  test(`a hung page fails at its 6 s timeout, closing grace ${grace / 1000} s, and the next test still runs`, async () => {
    test.setTimeout(150_000);
    const { code, out, ms } = await run(grace);
    expect(out).toContain('Test timeout of 6000ms exceeded');
    expect(out).toMatch(/1 failed/);
    expect(out).toMatch(/1 passed/);
    expect(code).toBe(1);
    // (the child starts, runs the 6 s test, closes, restarts its worker and runs the next test)
    expect(ms, out).toBeLessThan(6000 + grace + 30_000);
    if (grace < 15_000) expect(out).toContain('hang guard: the page did not close in time');
  });
