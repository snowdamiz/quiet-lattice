// pnpm capture — the visual grader's inputs (IMPLEMENTATION_PLAN 0.10.3, P1.E14.T03).
//
//   pnpm capture -- --review <family>/<file> [--asset A] [--variant V]
//        in-engine review of public/models/<family>/<file>.glb (or a demo model: `--review ship`) at 1920×1080: the
//        three lighting cases at LOD0 and LOD2, a wireframe pass at both, a collider and marker overlay (overlay.png),
//        the far view at LOD2 under noon-lush from 100 m (far_lod2.png; a hero also from 200 m, far200_lod2.png), a
//        paired perf readout per case, and a labelled contact sheet → assets/renders/review/<family>/<file>/. A file
//        holding several assets or variants is reviewed one at a time (they share the origin), each in its own folder
//        <asset>/ or <asset>/<variant>/; --asset and --variant pick. (The sibling grid for the consistency criterion is
//        the turntable's: `pnpm turntable -- <file.glb> [out_dir] --family`.)
//   pnpm capture -- --ui <screen>
//        a UI screen at 16:9 (1920×1080) and 21:9 (2520×1080), and its motion as 60 fps frames with a contact sheet
//        → assets/renders/ui/<screen>/ (frames under _frames/, kept in LFS so a grader outside this checkout has them)
//
// It starts its own Vite server and a headless Chromium (ANGLE/Metal on macOS, SwiftShader elsewhere), so it never
// touches a dev server or browser someone else is using. Console errors on the page fail the capture.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { farRanges, loadClassRules, reviewClass } from './classes.ts';
import { SCREENS } from './screens.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LIGHTS = ['noon-lush', 'night-exotic', 'open-space'] as const;

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

/** Collects the page's uncaught exceptions and console errors. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** Lays captures out on one sheet with a label under each, drawn in the page's own 2D canvas. */
async function contactSheet(page: Page, items: { label: string; src: string }[], cols: number, cellW: number, title = ''): Promise<Buffer> {
  const url = await page.evaluate(
    async ({ items, cols, cellW, title }) => {
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
      const head = title ? 36 : 0;
      const c = document.createElement('canvas');
      c.width = cols * cellW;
      c.height = head + rows * (cellH + 28);
      const g = c.getContext('2d')!;
      g.fillStyle = '#0b0c0f';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#e9e7e2';
      g.font = '18px IBM Plex Mono, monospace';
      if (title) g.fillText(title, 8, 25);
      g.font = '16px IBM Plex Mono, monospace';
      imgs.forEach((im, i) => {
        const x = (i % cols) * cellW;
        const y = head + Math.floor(i / cols) * (cellH + 28);
        g.drawImage(im, x, y, cellW, cellH);
        g.fillText(items[i].label, x + 8, y + cellH + 20);
      });
      return c.toDataURL('image/png');
    },
    { items, cols, cellW, title },
  );
  return dataUrlToBuffer(url);
}

interface ReviewTarget {
  asset: string;
  variant: string;
}

interface ReviewApi {
  ready: Promise<unknown>;
  targets(): ReviewTarget[];
  select(asset: string | null, variant: string | null): ReviewTarget;
  light(name: string): Promise<string>;
  lod(n: number): unknown;
  wireframe(on: boolean): void;
  overlay(on: boolean): void;
  capture(): string;
  captureOverlay(): Promise<string>;
  lastOverlay: unknown;
  far(meters: number, opts?: { lod?: number }): Promise<unknown>;
  near(): Promise<void>;
  perf(opts?: { pairs?: number }): Promise<unknown>;
  stats(): unknown;
  spot: Record<string, unknown> | null;
  settled: unknown;
}

declare global {
  interface Window {
    review: ReviewApi;
    __reviewCapture?: boolean;
  }
}

export interface ReviewOptions {
  asset?: string;
  variant?: string;
  /** default assets/renders/review/<file> */
  outDir?: string;
}

/** Waits for `#review:<spec>` to settle its first case. */
async function openReview(browser: Browser, url: string, spec: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = watchErrors(page);
  // no live frame loop: frames advance only when the capture asks; and the page's Math.random seeded, so what the game
  // scatters at random (weather streaks, drifting spores, particles) lands the same way every run
  await page.addInitScript(() => {
    window.__reviewCapture = true;
    let s = 0x9e3779b9;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto(`${url}/#review:${encodeURIComponent(spec)}`);
  await page.waitForFunction(() => !!window.review?.ready, null, { timeout: 180_000 });
  await page.evaluate(() => window.review.ready);
  return { page, errors };
}

export async function captureReview(file: string, opts: ReviewOptions = {}): Promise<string[]> {
  const base = opts.outDir ?? join(ROOT, 'assets/renders/review', file);
  const vite = await startVite();
  const { args, gl } = glArgs();
  const browser = await chromium.launch({ args });
  const written: string[] = [];
  try {
    const spec = file + (opts.asset ? `:${opts.asset}${opts.variant ? `/${opts.variant}` : ''}` : '');
    const { page, errors } = await openReview(browser, vite.url, spec);
    const all = await page.evaluate(() => window.review.targets());
    const targets = all.filter((t) => (!opts.asset || t.asset === opts.asset) && (!opts.variant || t.variant === opts.variant));
    if (!targets.length)
      throw new Error(
        `nothing to review in ${file} for ${opts.asset ?? '*'}/${opts.variant ?? '*'}; it holds ${all.map((t) => `${t.asset}/${t.variant}`).join(', ')}`,
      );
    const rules = loadClassRules(ROOT);
    for (const t of targets) {
      // one asset and variant per folder and sheet; a file holding just one writes straight into its own folder
      const outDir = all.length === 1 ? base : t.variant === t.asset ? join(base, t.asset) : join(base, t.asset, t.variant);
      mkdirSync(outDir, { recursive: true });
      const label = t.variant === t.asset ? t.asset : `${t.asset} / ${t.variant}`;
      console.log(`review ${file}: ${label}`);
      await page.evaluate((t) => window.review.select(t.asset, t.variant), t);
      const cls = reviewClass(rules, file, t.variant);
      const sheet: { label: string; src: string }[] = [];
      // (the overlay and far views after the three cases, two to a row)
      const extra: { label: string; src: string }[] = [];
      const perf: unknown[] = [];
      const far: unknown[] = [];
      let overlay: unknown = null;
      const spots: Record<string, unknown> = {};
      const save = (name: string, data: string) => {
        const p = join(outDir, name);
        writeFileSync(p, dataUrlToBuffer(data));
        written.push(p);
      };
      for (const light of LIGHTS) {
        spots[light] = await page.evaluate(async (light) => {
          await window.review.light(light);
          return { ...(window.review.spot ?? {}), settled: window.review.settled };
        }, light);
        const shots: [string, string, number, boolean][] = [
          [`${light}_lod0.png`, `${light} LOD0`, 0, false],
          [`${light}_lod2.png`, `${light} LOD2`, 2, false],
        ];
        if (light === 'noon-lush') shots.push(['wireframe_lod0.png', 'wireframe LOD0', 0, true], ['wireframe_lod2.png', 'wireframe LOD2', 2, true]);
        for (const [name, cap, lod, wire] of shots) {
          const shot = await page.evaluate(
            ({ lod, wire }) => {
              window.review.lod(lod);
              window.review.wireframe(wire);
              return window.review.capture();
            },
            { lod, wire },
          );
          save(name, shot);
          sheet.push({ label: cap, src: shot });
        }
        if (light === 'noon-lush') {
          // colliders and markers over the shaded asset at LOD0, labelled (rubric "fitness for play")
          const ov = await page.evaluate(async () => {
            window.review.wireframe(false);
            window.review.lod(0);
            window.review.overlay(true);
            const shot = await window.review.captureOverlay();
            window.review.overlay(false);
            return { shot, info: window.review.lastOverlay };
          });
          save('overlay.png', ov.shot);
          extra.push({ label: 'overlay LOD0: COL_* volumes, markers and pivots', src: ov.shot });
          overlay = ov.info;
        }
        perf.push(
          await page.evaluate(async () => {
            window.review.wireframe(false);
            window.review.lod(0);
            return window.review.perf({ pairs: 120 });
          }),
        );
        if (light === 'noon-lush') {
          // the rubric's silhouette distance: LOD2 from 100 m (and 200 m for a hero), uncropped at 1920×1080
          for (const m of farRanges(cls)) {
            const f = await page.evaluate(async (m) => {
              const rec = await window.review.far(m, { lod: 2 });
              return { rec, shot: window.review.capture() };
            }, m);
            const name = m === 100 ? 'far_lod2.png' : `far${m}_lod2.png`;
            save(name, f.shot);
            extra.push({ label: `noon-lush LOD2 from ${m} m`, src: f.shot });
            far.push(f.rec);
          }
          await page.evaluate(() => window.review.near());
        }
      }
      const stats = await page.evaluate(() => {
        window.review.lod(0);
        return window.review.stats();
      });
      const report = {
        file,
        asset: t.asset,
        variant: t.variant,
        class: cls,
        gl,
        viewport: [1920, 1080],
        stats,
        spots,
        perf,
        far,
        overlay,
        errors: [...errors],
      };
      const pj = join(outDir, 'perf.json');
      writeFileSync(pj, JSON.stringify(report, null, 2) + '\n');
      written.push(pj);
      const sp = join(outDir, 'sheet.png');
      writeFileSync(sp, await contactSheet(page, [...sheet, ...extra], 2, 960, `${file}  ${label}`));
      written.push(sp);
    }
    if (errors.length) throw new Error(`review page logged errors:\n${errors.join('\n')}`);
  } finally {
    await browser.close();
    await vite.stop();
  }
  return written;
}

/** Before a screen opens: adaptive resolution off and the pixel ratio fixed at 1, so every capture renders the same. */
async function pinUi(page: Page) {
  await page.evaluate(() => {
    type Engine = { adapt(): void; maxPixelRatio: number; pixelRatio: number; renderer: { setPixelRatio(p: number): void }; resize(): void };
    const E = (window as unknown as { game: { engine: Engine } }).game.engine;
    E.adapt = () => {};
    E.maxPixelRatio = 1;
    E.pixelRatio = 1;
    E.renderer.setPixelRatio(1);
    E.resize();
  });
}

export async function captureUi(screen: string, outDir = join(ROOT, 'assets/renders/ui', screen)): Promise<string[]> {
  const def = SCREENS[screen];
  if (!def) throw new Error(`unknown screen '${screen}'; one of ${Object.keys(SCREENS).join(', ')}`);
  rmSync(join(outDir, '_frames'), { recursive: true, force: true });
  mkdirSync(join(outDir, '_frames'), { recursive: true });
  const vite = await startVite();
  const { args } = glArgs();
  // headless Chromium hides scrollbars unless asked not to
  const browser = await chromium.launch({ args, ignoreDefaultArgs: def.showScrollbars ? ['--hide-scrollbars'] : [] });
  const written: string[] = [];
  const errors: string[] = [];
  try {
    for (const [tag, width] of [
      ['16x9', 1920],
      ['21x9', 2520],
    ] as const) {
      const page = await browser.newPage({ viewport: { width, height: 1080 } });
      const pageErrors = watchErrors(page);
      await page.goto(`${vite.url}/${def.hash ?? ''}`);
      await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 120_000 });
      await pinUi(page);
      await def.open(page);
      const still = join(outDir, `${tag}.png`);
      await page.screenshot({ path: still });
      written.push(still);
      for (const [name, pose] of tag === '16x9' ? Object.entries(def.stills16x9 ?? {}) : []) {
        await pose(page);
        const extra = join(outDir, `${tag}-${name}.png`);
        await page.screenshot({ path: extra });
        written.push(extra);
      }
      if (tag === '16x9') written.push(...(await captureClip(page, def, outDir)));
      errors.push(...pageErrors.map((e) => `${tag}: ${e}`));
      await page.close();
    }
  } finally {
    await browser.close();
    await vite.stop();
  }
  if (errors.length) throw new Error(`${screen} logged errors:\n${errors.join('\n')}`);
  return written;
}

/**
 * The screen's motion at 60 fps (`clipSeconds`, default 1 s). The page's own loop is stopped and each game frame stepped
 * by hand; CSS transitions and animations (which run on real time) are slowed tenfold through the DevTools Animation
 * domain, so each frame is taken 1/60 s of animation time after the last one. With `hudClock` the HUD's clock and timers
 * (game.hud.now / later / cancel) run on the clip's clock too.
 */
async function captureClip(page: Page, def: (typeof SCREENS)[string], outDir: string): Promise<string[]> {
  const frames = Math.round((def.clipSeconds ?? 1) * 60);
  await page.evaluate((hudClock) => {
    type Timer = { id: number; at: number; fn: () => void };
    const w = window as unknown as {
      game: { frame(dt: number): void; hud: { now(): number; later(fn: () => void, ms: number): number; cancel(id: number): void } };
      __clip: { frame(dt: number): void; t: number; timers: Timer[]; id: number };
    };
    const g = w.game;
    const frame = g.frame.bind(g);
    g.frame = () => {};
    const clip = (w.__clip = {
      t: 0,
      timers: [] as Timer[],
      id: 0,
      frame(dt: number) {
        frame(dt);
        clip.t += dt;
        const due = clip.timers.filter((x) => x.at <= clip.t * 1000);
        clip.timers = clip.timers.filter((x) => x.at > clip.t * 1000);
        for (const x of due) x.fn();
      },
    });
    if (hudClock) {
      const base = g.hud.now();
      g.hud.now = () => base + clip.t * 1000;
      g.hud.later = (fn, ms) => {
        clip.timers.push({ id: ++clip.id, at: clip.t * 1000 + ms, fn });
        return clip.id;
      };
      g.hud.cancel = (id) => (clip.timers = clip.timers.filter((x) => x.id !== id));
    }
  }, !!def.hudClock);
  const RATE = 0.1;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: RATE });
  if (def.motion) await def.motion(page);
  const t0 = Date.now();
  const sheet: { label: string; src: string }[] = [];
  const every = Math.max(1, Math.round(frames / 20));
  const onSheet = (i: number) => (def.sheetFrames ? def.sheetFrames.includes(i) : i % every === 0);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => (window as unknown as { __clip: { frame(dt: number): void } }).__clip.frame(1 / 60));
    const p = join(outDir, '_frames', `${String(i).padStart(3, '0')}.jpg`);
    const buf = await page.screenshot({ path: p, type: 'jpeg', quality: 85 });
    if (onSheet(i)) sheet.push({ label: `frame ${i} (${(i / 60).toFixed(2)} s)`, src: `data:image/jpeg;base64,${buf.toString('base64')}` });
    const due = t0 + ((i + 1) * 1000) / 60 / RATE;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  const sp = join(outDir, 'clip-sheet.png');
  writeFileSync(sp, await contactSheet(page, sheet, 5, 480));
  return [sp, join(outDir, '_frames')];
}

function usage(): never {
  console.error('usage: pnpm capture -- --review <family>/<file> [--asset A] [--variant V] | --ui <screen>');
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) usage();
    return argv[i + 1];
  };
  const reviewFile = opt('--review');
  const ui = opt('--ui');
  if (!reviewFile === !ui) usage();
  const run = reviewFile ? captureReview(reviewFile, { asset: opt('--asset'), variant: opt('--variant') }) : captureUi(ui!);
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
