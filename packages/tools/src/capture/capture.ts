// pnpm capture — the visual grader's inputs (IMPLEMENTATION_PLAN 0.10.3, P1.E14.T03).
//
//   pnpm capture -- --review <asset>   in-engine review of public/models/<asset>.glb: the three lighting cases at LOD0 and
//                                      LOD2, a wireframe pass at both, a perf readout, and a contact sheet
//                                      → assets/renders/review/<asset>/
//   pnpm capture -- --ui <screen>      a UI screen at 16:9 (1920×1080) and 21:9 (2520×1080), and one second of frames at
//                                      60 fps with a contact sheet → assets/renders/ui/<screen>/ (frames under _frames/)
//
// It starts its own Vite server and a headless Chromium (ANGLE/Metal on macOS, SwiftShader elsewhere), so it never
// touches a dev server or browser someone else is using.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { SCREENS } from './screens.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function glArgs(): { args: string[]; gl: string } {
  const gl = process.env.SMOKE_GL ?? (process.platform === 'darwin' && !process.env.CI ? 'metal' : 'swiftshader');
  return {
    gl,
    args: gl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** A Vite dev server for the client on a free port, with the file watcher and HMR off: a capture must never reload
 * because someone saved a file mid-run. */
export async function startVite(): Promise<{ url: string; stop(): Promise<void> }> {
  const { createServer } = await import('vite');
  const port = await freePort();
  const server = await createServer({
    root: join(ROOT, 'packages/client'),
    configFile: join(ROOT, 'packages/client/vite.config.js'),
    logLevel: 'error',
    server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  return { url: `http://127.0.0.1:${port}`, stop: () => server.close() };
}

function dataUrlToBuffer(d: string): Buffer {
  return Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');
}

/** Lays captures out on one sheet with a label under each, drawn in the page's own 2D canvas. */
async function contactSheet(page: Page, items: { label: string; src: string }[], cols: number, cellW: number): Promise<Buffer> {
  const url = await page.evaluate(
    async ({ items, cols, cellW }) => {
      const imgs = await Promise.all(
        items.map(
          (it) =>
            new Promise<HTMLImageElement>((res) => {
              const im = new Image();
              im.onload = () => res(im);
              im.src = it.src;
            }),
        ),
      );
      const cellH = Math.round((cellW * imgs[0].height) / imgs[0].width);
      const rows = Math.ceil(imgs.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * cellW;
      c.height = rows * (cellH + 28);
      const g = c.getContext('2d')!;
      g.fillStyle = '#0b0c0f';
      g.fillRect(0, 0, c.width, c.height);
      g.font = '16px IBM Plex Mono, monospace';
      g.fillStyle = '#e9e7e2';
      imgs.forEach((im, i) => {
        const x = (i % cols) * cellW;
        const y = Math.floor(i / cols) * (cellH + 28);
        g.drawImage(im, x, y, cellW, cellH);
        g.fillText(items[i].label, x + 8, y + cellH + 20);
      });
      return c.toDataURL('image/png');
    },
    { items, cols, cellW },
  );
  return dataUrlToBuffer(url);
}

export async function captureReview(asset: string, outDir = join(ROOT, 'assets/renders/review', asset)): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const vite = await startVite();
  const { args } = glArgs();
  const browser = await chromium.launch({ args });
  const written: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${vite.url}/#review:${asset}`);
    await page.waitForFunction(() => (window as unknown as { review?: { case?: string } }).review?.case === 'noon-lush', null, { timeout: 180_000 });
    const sheet: { label: string; src: string }[] = [];
    const perf: unknown[] = [];
    const save = (name: string, data: string) => {
      const p = join(outDir, name);
      writeFileSync(p, dataUrlToBuffer(data));
      written.push(p);
    };
    for (const light of ['noon-lush', 'night-exotic', 'open-space']) {
      await page.evaluate(async (light) => {
        const r = (window as unknown as { review: ReviewApi }).review;
        r.hold();
        await r.light(light);
      }, light);
      for (const lod of [0, 2]) {
        const shot = await page.evaluate(
          ({ lod }) => {
            const r = (window as unknown as { review: ReviewApi }).review;
            r.lod(lod);
            r.wireframe(false);
            return r.capture();
          },
          { lod },
        );
        save(`${light}_lod${lod}.png`, shot);
        sheet.push({ label: `${light} LOD${lod}`, src: shot });
      }
      perf.push(
        await page.evaluate(async () => {
          const r = (window as unknown as { review: ReviewApi }).review;
          r.lod(0);
          await r.settle(240);
          return r.perf(120);
        }),
      );
    }
    await page.evaluate(async () => (window as unknown as { review: ReviewApi }).review.light('noon-lush'));
    for (const lod of [0, 2]) {
      const shot = await page.evaluate(
        ({ lod }) => {
          const r = (window as unknown as { review: ReviewApi }).review;
          r.lod(lod);
          r.wireframe(true);
          return r.capture();
        },
        { lod },
      );
      save(`wireframe_lod${lod}.png`, shot);
      sheet.push({ label: `wireframe LOD${lod}`, src: shot });
    }
    const stats = await page.evaluate(() => (window as unknown as { review: ReviewApi }).review.stats());
    const report = { asset, gl: glArgs().gl, stats, perf, errors };
    const pj = join(outDir, 'perf.json');
    writeFileSync(pj, JSON.stringify(report, null, 2) + '\n');
    written.push(pj);
    const sp = join(outDir, 'sheet.png');
    writeFileSync(sp, await contactSheet(page, sheet, 2, 960));
    written.push(sp);
    if (errors.length) throw new Error(`review page logged errors:\n${errors.join('\n')}`);
  } finally {
    await browser.close();
    await vite.stop();
  }
  return written;
}

export async function captureUi(screen: string, outDir = join(ROOT, 'assets/renders/ui', screen)): Promise<string[]> {
  const def = SCREENS[screen];
  if (!def) throw new Error(`unknown screen '${screen}'; one of ${Object.keys(SCREENS).join(', ')}`);
  mkdirSync(join(outDir, '_frames'), { recursive: true });
  const vite = await startVite();
  const { args } = glArgs();
  const browser = await chromium.launch({ args });
  const written: string[] = [];
  try {
    for (const [tag, width] of [
      ['16x9', 1920],
      ['21x9', 2520],
    ] as const) {
      const page = await browser.newPage({ viewport: { width, height: 1080 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${vite.url}/${def.hash ?? ''}`);
      await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 120_000 });
      await def.open(page);
      const still = join(outDir, `${tag}.png`);
      await page.screenshot({ path: still });
      written.push(still);
      if (tag === '16x9') {
        // one second at 60 fps: the page's own loop is stopped and each frame stepped by hand
        await page.evaluate(() => {
          const w = window as unknown as { game: { frame(dt: number): void; __frame?: (dt: number) => void } };
          w.game.__frame = w.game.frame.bind(w.game);
          w.game.frame = () => {};
        });
        const frames: { label: string; src: string }[] = [];
        for (let i = 0; i < 60; i++) {
          await page.evaluate(() => (window as unknown as { game: { __frame(dt: number): void } }).game.__frame(1 / 60));
          const p = join(outDir, '_frames', `${String(i).padStart(3, '0')}.jpg`);
          const buf = await page.screenshot({ path: p, type: 'jpeg', quality: 85 });
          if (i % 6 === 0) frames.push({ label: `frame ${i}`, src: `data:image/jpeg;base64,${buf.toString('base64')}` });
        }
        const sp = join(outDir, 'clip-sheet.png');
        writeFileSync(sp, await contactSheet(page, frames, 5, 480));
        written.push(sp, join(outDir, '_frames'));
      }
      if (errors.length) throw new Error(`${screen} logged errors:\n${errors.join('\n')}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await vite.stop();
  }
  return written;
}

interface ReviewApi {
  hold(): void;
  light(name: string): Promise<string>;
  lod(n: number): unknown;
  wireframe(on: boolean): void;
  capture(): string;
  perf(frames?: number): Promise<unknown>;
  settle(maxFrames?: number): Promise<void>;
  stats(): unknown;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const i = argv.findIndex((a) => a === '--review' || a === '--ui');
  if (i < 0 || !argv[i + 1]) {
    console.error('usage: pnpm capture -- --review <asset> | --ui <screen>');
    process.exit(2);
  }
  const run = argv[i] === '--review' ? captureReview(argv[i + 1]) : captureUi(argv[i + 1]);
  run.then(
    (files) => {
      for (const f of files) console.log(`wrote ${f}`);
      process.exit(0);
    },
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
