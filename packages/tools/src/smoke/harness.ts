// `test` for every smoke spec: Playwright's, plus a guard against a page that stops answering. When a renderer is
// stuck (a stalled GPU, a spinning script) Playwright fails the test on its timeout but then waits on the browser to
// close the page, which a stuck renderer never does: one run sat 16 minutes in that wait, 90 times its test timeout.
// The guard gives the contexts `closeGraceMs` to close once the test is over, then kills the browser's process tree, so
// the test ends at its own timeout plus that grace and the failed test's worker starts over with a fresh browser.
import { execFileSync } from 'node:child_process';
import { expect, test as base, type Browser } from '@playwright/test';

export { expect };

async function browserPid(browser: Browser): Promise<number | null> {
  if (browser.browserType().name() !== 'chromium') return null;
  const cdp = await browser.newBrowserCDPSession();
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  return processInfo.find((p) => p.type === 'browser')?.id ?? null;
}

function processTree(root: number): number[] {
  const rows = execFileSync('ps', ['-Ao', 'pid=,ppid='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((r) => r.length === 2 && r.every(Number.isInteger));
  const tree = [root];
  for (let i = 0; i < tree.length; i++) for (const [pid, ppid] of rows) if (ppid === tree[i]) tree.push(pid);
  return tree;
}

function killBrowser(pid: number): void {
  const tree = processTree(pid).reverse();
  console.warn(`hang guard: the page did not close in time; killing the browser (pid ${pid}, ${tree.length} processes)`);
  for (const p of tree) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      // gone already
    }
  }
}

export const test = base.extend<{ closeGraceMs: number; hangGuard: void }>({
  closeGraceMs: [15_000, { option: true }],
  hangGuard: [
    async ({ browser, closeGraceMs }, use) => {
      const pid = process.platform === 'win32' ? null : await browserPid(browser);
      await use();
      const open = browser.contexts();
      if (pid === null || open.length === 0) return;
      let left = open.length;
      const timer = setTimeout(() => killBrowser(pid), closeGraceMs);
      for (const c of open)
        c.once('close', () => {
          if (--left === 0) clearTimeout(timer);
        });
    },
    { auto: true },
  ],
});
