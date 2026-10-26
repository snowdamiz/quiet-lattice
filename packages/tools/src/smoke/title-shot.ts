// The title shot, captured deterministically, and a pixel diff of two captures. Not part of `pnpm smoke`: the pixels
// depend on the GPU backend, so a capture is only ever compared with another made on the same machine and backend
// (for example before and after a refactor that must not change the picture).
//
//   pnpm exec tsx packages/tools/src/smoke/title-shot.ts capture <out>   writes <out>.png and <out>.rgba
//   pnpm exec tsx packages/tools/src/smoke/title-shot.ts diff <a> <b>    prints the fraction of differing pixels
//
// Determinism: the page's own requestAnimationFrame loop is switched off and Math.random is seeded before any script
// runs; once the model libraries have loaded the clock is reset and FRAMES frames are stepped with game.frame(1/60),
// draining the terrain worker pool after each, so every frame sees the same finished chunks whatever the timing.
// The frame after them is read back in the same task it is drawn in. Uses the browser, backend and viewport of
// playwright.config.ts, and serves the client on SMOKE_PORT (default 5191), reusing a server already there.
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import config from '../../playwright.config.ts';

const PORT = Number(process.env.SMOKE_PORT) || 5191;
const URL = `http://localhost:${PORT}`;
const FRAMES = 240;
/** Per-channel difference (out of 255) still counted as the same pixel. */
const TOLERANCE = 2;

// (the page code is kept as source text: tsx would otherwise wrap its functions in helpers the page does not have)
// Before any page script: a seeded Math.random, and no requestAnimationFrame loop.
const INIT = `{
  let a = 424242;
  Math.random = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.requestAnimationFrame = function () { return 0; };
}`;

const SHOOT = `async function (frames) {
  const game = window.game;
  async function drain() {
    for (;;) {
      game.pool.update();
      if (game.pool.pending() === 0) return;
      await new Promise((r) => setTimeout(r, 4));
    }
  }
  game.time = 0;
  await drain();
  for (let i = 0; i < frames; i++) {
    game.frame(1 / 60);
    await drain();
  }
  // drawn and read back in one task, before the drawing buffer is cleared
  game.frame(1 / 60);
  const src = game.engine.renderer.domElement;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let bin = '';
  for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return { width: c.width, height: c.height, rgba: btoa(bin), png: c.toDataURL('image/png') };
}`;

async function up(): Promise<boolean> {
  try {
    return (await fetch(URL)).ok;
  } catch {
    return false;
  }
}

async function serve(): Promise<ChildProcess | null> {
  if (await up()) return null;
  const vite = spawn('pnpm', ['--filter', '@astra/client', 'exec', 'vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 240 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
  return vite;
}

async function capture(out: string) {
  const server = await serve();
  console.log(server ? `serving the client from this checkout on ${URL}` : `reusing the server already on ${URL}`);
  const browser = await chromium.launch({ args: config.use?.launchOptions?.args });
  try {
    const page = await browser.newPage({ viewport: config.use?.viewport ?? { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(INIT);
    await page.goto(URL);
    await page.waitForFunction('window.game?.menus?.loaded === true', null, { timeout: 120_000 });
    const shot = (await page.evaluate(`(${SHOOT})(${FRAMES})`)) as { width: number; height: number; rgba: string; png: string };
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    writeFileSync(`${out}.png`, Buffer.from(shot.png.split(',')[1], 'base64'));
    const header = Buffer.alloc(8);
    header.writeUInt32LE(shot.width, 0);
    header.writeUInt32LE(shot.height, 4);
    writeFileSync(`${out}.rgba`, Buffer.concat([header, Buffer.from(shot.rgba, 'base64')]));
    console.log(`captured ${shot.width}x${shot.height} after ${FRAMES} frames → ${out}.png`);
  } finally {
    await browser.close();
    if (server?.pid) process.kill(-server.pid);
  }
}

function read(path: string) {
  const b = readFileSync(`${path}.rgba`);
  return { width: b.readUInt32LE(0), height: b.readUInt32LE(4), px: b.subarray(8) };
}

/** Fraction of pixels where any channel differs by more than TOLERANCE. */
export function diffFraction(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 1;
  let bad = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > TOLERANCE || Math.abs(a[i + 1] - b[i + 1]) > TOLERANCE || Math.abs(a[i + 2] - b[i + 2]) > TOLERANCE) bad++;
  }
  return bad / (a.length / 4);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'capture' && a) await capture(a);
else if (cmd === 'diff' && a && b) {
  const A = read(a);
  const B = read(b);
  if (A.width !== B.width || A.height !== B.height) throw new Error(`sizes differ: ${A.width}x${A.height} vs ${B.width}x${B.height}`);
  const f = diffFraction(A.px, B.px);
  console.log(`${(f * 100).toFixed(4)}% of ${A.width}x${A.height} pixels differ by more than ${TOLERANCE}/255`);
  process.exitCode = f < 0.01 ? 0 : 1;
} else {
  console.error('usage: title-shot.ts capture <out> | diff <a> <b>');
  process.exitCode = 2;
}
