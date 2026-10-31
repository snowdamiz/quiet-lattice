// The game's own client, played honestly in real time against the server's movement authority (P1.E03.T04): taking off,
// flying out of the Waystation into its world's frame, boosting and engaging the pulse drive, through page stalls of 4 s
// and 9 s (its first input back often changes frame), and a hidden tab's 40 s pause (its clock steps forward on its
// return). It is never corrected and never kicked. Needs `pnpm db:up`.
//
// Movement authority judges the client's time against the server's (ARCHITECTURE §7), and a loaded machine stretches both
// clocks' timers and sockets differently, so the stalls are played on clocks the spec steps: the server's (online.ts
// `stepped`) and the page's (`performance.now`, with its frames stepped by hand). Each 50 ms step moves both, runs the
// page's frames, and waits until the server has handled the input they sent, so the server sees exactly the gaps and times
// the client meant. A stall or a pause is a jump of both clocks with no frames and no inputs.
import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { enterPicked, signUp } from './account.ts';
import { startOnline, type Online } from './online.ts';

let online: Online;
let stepped: Online;
test.beforeAll(async () => {
  online = await startOnline();
  stepped = await startOnline({ stepped: true });
});
test.afterAll(async () => {
  await online?.stop();
  await stepped?.stop();
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    for (const l of [...online.serverOutput().split('\n'), ...stepped.serverOutput().split('\n')])
      if (/movement/.test(l)) console.log('SERVER', l.slice(0, 600));
  await page.evaluate(() => (window as { game?: { net?: { close(): void } } }).game?.net?.close()).catch(() => {});
  await page.waitForTimeout(200);
});

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + randomInt(26))).join('');
const pilot = () => ({
  username: `mov_${Date.now().toString(36)}${letters(4)}`,
  password: `pw-${randomBytes(9).toString('hex')}`,
  name: `Mov ${letters(1).toUpperCase()}${letters(7)}`,
});

/** Steps the game's frames while waiting for `pred` (setup, before play runs on the page's own clock). */
async function until(page: Page, pred: string, timeout = 60_000) {
  await page.waitForFunction(
    (src) => {
      const g = (window as unknown as { game?: { frame(dt: number): void } }).game;
      if (g) for (let i = 0; i < 2; i++) g.frame(1 / 60);
      return !!(0, eval)(src);
    },
    pred,
    { timeout, polling: 100 },
  );
}

/** A new account and character, in the world, its corrections and any close recorded. */
async function enterNew(page: Page, on = online) {
  await page.goto(`${on.url}/`);
  await page.waitForFunction(() => 'game' in window && 'step' in window, null, { timeout: 60_000 });
  await until(page, 'window.game.menus.ready', 120_000);
  await signUp(page, pilot(), 'thalune');
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown> & {
      game: Record<string, (...a: unknown[]) => unknown> & { net: { on(e: string, f: (m: unknown) => void): void } };
    };
    w.__corr = [];
    w.__closed = null;
    const g = w.game;
    const orig = g.enterWorld!.bind(g);
    g.enterWorld = (...a: unknown[]) => {
      orig(...a);
      g.net.on('correction', (m) => (w.__corr as unknown[]).push(m));
      g.net.on('closed', (why) => (w.__closed = why));
    };
  });
  await enterPicked(page);
  await until(page, "window.game.net?.joined && window.game.mode !== 'title'", 120_000);
  await until(page, 'window.game.net.store.ack > 0 && window.game.net.store.entities.has(window.game.net.entityId)', 30_000);
  // capture the mouse as a click would (headless: the fallback lock)
  await page.evaluate(() => {
    const g = (window as unknown as { game: { input: { fallbackLock: boolean; locked: boolean } } }).game;
    g.input.fallbackLock = true;
    g.input.locked = true;
    document.dispatchEvent(new Event('pointerlockchange'));
  });
}

async function hold(page: Page, keys: string[], ms: number) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
}

async function tap(page: Page, key: string) {
  await page.keyboard.down(key);
  await page.waitForTimeout(80);
  await page.keyboard.up(key);
}

/** How fast the server has the player's entity going, m/s, and in what mode. */
async function flight(page: Page) {
  return page.evaluate(() => {
    const n = (window as unknown as { game: { net: { entityId: number; store: { entities: Map<number, { mode?: string; vel?: number[] }> } } } }).game.net;
    const e = n.store.entities.get(n.entityId);
    return { mode: e?.mode, speed: Math.hypot(...(e?.vel ?? [0, 0, 0])) };
  });
}

/** The server has the player's ship under way at close to the space cap (so no correction is not for want of flying). */
async function flyingOn(page: Page, when: string) {
  const f = await flight(page);
  expect(f.mode, when).toBe('ship');
  expect(f.speed, when).toBeGreaterThan(400);
}

/** The corrections it has had, whether its socket closed, and its session's state. */
async function state(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __corr: unknown[]; __closed: unknown; game: { net?: { state: string } } };
    return { corrections: w.__corr, closed: w.__closed, state: w.game.net?.state };
  });
}

/** Off the pad, out of the hangar's mouth, and on the engines. */
async function flyOut(page: Page) {
  await enterNew(page);
  await page.waitForTimeout(2000);
  await tap(page, 'KeyE');
  await page.waitForTimeout(3000);
  await hold(page, ['Space'], 1500);
}

const STEP_MS = 50;
const FRAMES_PER_STEP = 2;

type Stepped = Window & { __advance(ms: number): void; __step(ms: number, frames: number): Promise<void> };

/**
 * From here the server's clock and the page's move only when the spec moves them: both are frozen where they stand (the
 * page's `performance.now`, which the game's net layer, its 20 Hz input cadence and its frame loop run on), the animation
 * frames are the spec's to call (the game's own loop, which clamps each frame's time as it does in play), and a fresh clock
 * sample is taken at the standstill, whose round trip is nothing.
 */
async function freeze(page: Page, on: Online) {
  await on.clock!.freeze();
  await page.evaluate(async () => {
    const w = window as unknown as Stepped & { game: { net: { ping(): void; clock: { samples: unknown[] } } } };
    let t = performance.now();
    performance.now = () => t;
    w.__advance = (ms) => {
      t += ms;
    };
    // (the game's loop asks for its next frame at the start of each; the one pending now comes round once more)
    let loop: (() => void) | null = null;
    w.requestAnimationFrame = (cb) => {
      loop = cb as () => void;
      return 0;
    };
    while (!loop) await new Promise((r) => setTimeout(r, 4));
    w.__step = async (ms, frames) => {
      const g = (window as unknown as { game: { net: { state: string; inputSeq: number; store: { ack: number } } | null } }).game;
      for (let i = 0; i < frames; i++) {
        t += ms / frames;
        const frame = loop!;
        loop = null;
        frame();
      }
      const deadline = Date.now() + 120_000;
      while (g.net?.state === 'joined' && g.net.store.ack < g.net.inputSeq && Date.now() < deadline) await new Promise((r) => setTimeout(r, 4));
    };
    const have = w.game.net.clock.samples.length;
    w.game.net.ping();
    while (w.game.net.clock.samples.length === have) await new Promise((r) => setTimeout(r, 4));
  });
}

/** `ms` of both clocks on, in `stepMs` steps of `frames` frames, each waiting for the server to handle the input it sent. */
async function play(page: Page, on: Online, ms: number, stepMs = STEP_MS, frames = FRAMES_PER_STEP) {
  for (let left = ms; left > 0; left -= stepMs) {
    await on.clock!.advance(Math.min(left, stepMs));
    await page.evaluate(([step, n]) => (window as unknown as Stepped).__step(step!, n!), [Math.min(left, stepMs), frames]);
  }
}

/** A stall: both clocks jump `ms`, with no frame run and no input sent. */
async function stall(page: Page, on: Online, ms: number) {
  await on.clock!.advance(ms);
  await page.evaluate((ms) => (window as unknown as Stepped).__advance(ms), ms);
}

async function holdFor(page: Page, on: Online, keys: string[], ms: number) {
  for (const k of keys) await page.keyboard.down(k);
  await play(page, on, ms);
  for (const k of keys) await page.keyboard.up(k);
}

test('takes off, flies out of the Waystation, boosts and engages the pulse drive without a correction', async ({ page }) => {
  test.setTimeout(240_000);
  await flyOut(page);
  await hold(page, ['KeyW'], 6000);
  await page.waitForTimeout(8000);
  await hold(page, ['ShiftLeft'], 4000);
  await page.waitForTimeout(4000);
  await tap(page, 'KeyJ');
  await page.waitForTimeout(8000);
  expect(await state(page)).toEqual({ corrections: [], closed: null, state: 'joined' });
});

test('flies on through page stalls of 4 s and 9 s and a hidden tab’s 40 s pause without a correction', async ({ page }) => {
  test.setTimeout(900_000);
  await enterNew(page, stepped);
  await freeze(page, stepped);
  await play(page, stepped, 2000);
  await holdFor(page, stepped, ['KeyE'], 100);
  await play(page, stepped, 3000);
  await holdFor(page, stepped, ['Space'], 1500);
  await page.keyboard.down('KeyW');
  await play(page, stepped, 8000);
  for (const ms of [4000, 9000]) {
    // the page busy: no frame runs, no input leaves
    await stall(page, stepped, ms);
    await play(page, stepped, 6000);
    await flyingOn(page, `after a ${ms} ms stall`);
    expect(await state(page), `after a ${ms} ms stall`).toEqual({ corrections: [], closed: null, state: 'joined' });
  }
  // a hidden tab: its frame loop runs on for 40 s without a frame, then runs again
  await page.evaluate(() => {
    const g = (window as unknown as { game: Record<string, unknown> }).game;
    g.__frame = g.frame;
    g.frame = () => {};
  });
  await play(page, stepped, 40_000, 1000, 1);
  await page.evaluate(() => {
    const g = (window as unknown as { game: Record<string, unknown> }).game;
    g.frame = g.__frame;
  });
  await play(page, stepped, 10_000);
  await flyingOn(page, 'after a 40 s pause');
  await page.keyboard.up('KeyW');
  expect(await state(page), 'after a 40 s pause').toEqual({ corrections: [], closed: null, state: 'joined' });
});
