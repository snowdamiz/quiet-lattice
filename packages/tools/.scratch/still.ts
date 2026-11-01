// scratch: take the stills of one UI screen (no clip) into .scratch/out/<screen>/
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { glArgs, startVite } from '../src/capture/capture.ts';
import { SCREENS } from '../src/capture/screens.ts';

const [screen, which = '16x9'] = process.argv.slice(2);
const def = SCREENS[screen!]!;
const out = join(process.cwd(), '../../.scratch/out', screen!);
mkdirSync(out, { recursive: true });
const vite = await startVite();
const browser = await chromium.launch({ args: glArgs().args });
try {
  for (const [tag, width] of [['16x9', 1920], ['21x9', 2520]] as const) {
    if (which !== 'both' && which !== tag) continue;
    const page = await browser.newPage({ viewport: { width, height: 1080 } });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
    await page.goto(`${vite.url}/${def.hash ?? ''}`);
    await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 120_000 });
    await page.evaluate(() => {
      const E = (window as any).game.engine;
      E.adapt = () => {};
      E.maxPixelRatio = 1;
      E.pixelRatio = 1;
      E.renderer.setPixelRatio(1);
      E.resize();
    });
    await def.open(page);
    if (process.env.HIDE) {
      await page.evaluate(async () => {
        const g = (window as any).game;
        g.sky.edge.group.children.forEach((c: any) => { if (c.isLineSegments || c.isPoints) c.visible = false; });
        g.sky.reset();
        await (window as any).step(30);
      });
    }
    await page.screenshot({ path: join(out, `${tag}.png`) });
    for (const [name, pose] of [...(tag === '16x9' ? Object.entries(def.stills16x9 ?? {}) : []), ...Object.entries(def.stills ?? {})]) {
      await pose(page);
      await page.screenshot({ path: join(out, `${tag}-${name}.png`) });
    }
    await page.close();
  }
} finally {
  await browser.close();
  await vite.stop();
}
console.log('done', out);
process.exit(0);
