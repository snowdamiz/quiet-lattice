// Runs the client's scripted playthrough (packages/client/src/dev/playthrough.js) headless and prints each phase's
// result: `pnpm --filter @astra/tools exec tsx src/capture/playthrough-run.ts [phase …]`.
import { chromium } from '@playwright/test';
import { glArgs, startVite } from './capture.ts';

const phases = process.argv.slice(2).filter((a) => a !== '--');
const run = phases.length ? phases : ['leave', 'descend', 'land', 'disembark', 'mine', 'analyze', 'board', 'climb', 'dock'];
const vite = await startVite();
const browser = await chromium.launch({ args: glArgs().args });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${vite.url}/`);
  await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 120_000 });
  await page.evaluate(async () => {
    const w = window as unknown as { dev: { boot(): Promise<void> }; step(n: number): Promise<void>; __pt: unknown };
    await w.dev.boot();
    await w.step(60);
    // a page-side module path (served by Vite), held in a variable so TypeScript does not try to resolve it
    const url = '/src/dev/playthrough.js';
    w.__pt = (await import(/* @vite-ignore */ url)).playthrough();
  });
  for (const ph of run) {
    const t0 = Date.now();
    const r = await page.evaluate(async (ph) => {
      try {
        return String(await (window as unknown as { __pt: Record<string, () => Promise<unknown>> }).__pt[ph]());
      } catch (e) {
        return `THREW ${(e as Error).message}`;
      }
    }, ph);
    console.log(`[${ph}] (${Math.round((Date.now() - t0) / 1000)}s) ${r}`);
    if (ph === 'dock') {
      const pads = await page.evaluate(() => {
        const g = (window as unknown as { game: { station: { pads: { occupied: unknown }[] }; ship: { mode: string }; hud: { root: HTMLElement } } }).game;
        return {
          mode: g.ship.mode,
          pads: g.station.pads.map((p) => (p.occupied ? (p.occupied === (g.ship as unknown) ? 'player' : 'npc') : 'free')),
          hud: g.hud.root.innerText.slice(0, 160),
        };
      });
      console.log('  dock state:', JSON.stringify(pads));
    }
    if (/THREW|fail|timed out|stuck/i.test(r)) failed = true;
  }
  if (errors.length) {
    failed = true;
    console.log('errors:', errors.join('\n'));
  }
} finally {
  await browser.close();
  await vite.stop();
}
process.exit(failed ? 1 : 0);
