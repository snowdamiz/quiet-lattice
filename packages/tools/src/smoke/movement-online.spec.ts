// The game's own client, played honestly in real time against the server's movement authority (P1.E03.T04): taking off,
// flying out of the Waystation into its world's frame, boosting and engaging the pulse drive, through page stalls of 4 s
// and 9 s (its first input back often changes frame), and a hidden tab's 40 s pause (its clock steps forward on its
// return). It is never corrected and never kicked. Needs `pnpm db:up`.
import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { enterPicked, signUp } from './account.ts';
import { startOnline, type Online } from './online.ts';

let online: Online;
test.beforeAll(async () => {
  online = await startOnline();
});
test.afterAll(async () => {
  await online?.stop();
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) for (const l of online.serverOutput().split('\n')) if (/movement/.test(l)) console.log('SERVER', l.slice(0, 600));
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
async function enterNew(page: Page) {
  await page.goto(`${online.url}/`);
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
  test.setTimeout(300_000);
  await flyOut(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(8000);
  for (const ms of [4000, 9000]) {
    // the page busy: no frame runs, no input leaves
    await page.evaluate((ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        // (busy)
      }
    }, ms);
    await page.waitForTimeout(ms * 2 + 3000);
    expect(await state(page), `after a ${ms} ms stall`).toEqual({ corrections: [], closed: null, state: 'joined' });
  }
  // a hidden tab: its frame loop stops for 40 s, then runs again
  await page.evaluate(() => {
    const g = (window as unknown as { game: Record<string, unknown> }).game;
    g.__frame = g.frame;
    g.frame = () => {};
  });
  await page.waitForTimeout(40_000);
  await page.evaluate(() => {
    const g = (window as unknown as { game: Record<string, unknown> }).game;
    g.frame = g.__frame;
  });
  await page.waitForTimeout(10_000);
  await page.keyboard.up('KeyW');
  expect(await state(page), 'after a 40 s pause').toEqual({ corrections: [], closed: null, state: 'joined' });
});
