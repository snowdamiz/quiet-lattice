import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { startOnline, type Online } from './online.ts';

// The test cutscene through the server, as players run it (online.ts: a scratch database, the server, Vite): a pilot
// signs up and enters, docked at its home Waystation, and plays the test cutscene. The client's real Net asks the server
// (`cutscene request`); the server, in development, places the player in a story phase and answers `play` with it; the
// phase's tug reaches this client in its snapshots while it watches; Esc skips, the client says `done`, the server takes
// it out of the phase and the tug goes. Credentials are made up per run and exist only in the scratch database.

let online: Online;

test.beforeAll(async () => {
  online = await startOnline();
});

test.afterAll(async () => {
  await online?.stop();
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.game?.net?.close()).catch(() => {});
  await page.waitForTimeout(200);
});

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + randomInt(26))).join('');

/** Steps frames until the expression `pred` holds in the page. */
async function until(page: Page, pred: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    (src) => {
      const g = window.game;
      if (g) for (let i = 0; i < 2; i++) g.frame(1 / 60);
      return !!(0, eval)(src);
    },
    pred,
    { timeout, polling: 100 },
  );
}

test('plays the test cutscene in the story phase the server places the player in', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${online.url}/`);
  await page.waitForFunction(() => 'game' in window && 'step' in window, null, { timeout: 60_000 });
  await until(page, 'window.game.menus.ready', 120_000);
  await page.click('.title-screen [data-act="start"]');
  await page.fill('.account [name="username"]', `smoke_${Date.now().toString(36)}${letters(4)}`);
  await page.fill('.account [name="password"]', `pw-${randomBytes(9).toString('hex')}`);
  await page.click('.account [data-do="register"]');
  await page.fill('.account [name="name"]', `Pilot ${letters(1).toUpperCase()}${letters(7)}`);
  await page.click('.account [data-people] [data-v="thalune"]');
  await page.click('.account [data-form="create"] [type="submit"]');
  await page.waitForSelector('.account [data-enter]');
  await page.click('.account [data-enter]');
  await until(page, "window.game.net?.joined && window.game.mode !== 'title'", 120_000);
  await until(page, 'window.game.net.store.ack > 0 && window.game.net.store.entities.has(window.game.net.entityId)', 30_000);

  // asked through the real Net; the server's answer starts it
  await page.evaluate(() => {
    const w = window as unknown as { __cut: unknown };
    w.__cut = undefined;
    void window.game.cutscenes.play('test').then((r: unknown) => (w.__cut = r));
  });
  await until(page, 'window.game.cutscenes.active', 20_000);
  const playing = await page.evaluate(() => ({
    phase: window.game.cutscenes.state().storyPhase,
    link: window.game.cutscenes.link === window.game.cutscenes.netLink,
  }));
  expect(playing.link).toBe(true);
  expect(playing.phase).toBeGreaterThan(0);
  // the phase's tug reaches this client while it watches
  await until(page, "[...window.game.net.store.entities.values()].some((e) => e.name === 'Waystation tug')", 20_000);

  // Esc skips: the client says done, the server takes the player out and the tug goes
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })));
  await until(page, '!window.game.cutscenes.active', 20_000);
  const result = await page.evaluate(() => (window as unknown as { __cut: unknown }).__cut);
  expect(result).toMatchObject({ id: 'test', skipped: true, phase: playing.phase });
  await until(page, "![...window.game.net.store.entities.values()].some((e) => e.name === 'Waystation tug')", 20_000);

  // at once again: the server's cooldown refuses it, and nothing plays
  const again = await page.evaluate(() => window.game.cutscenes.play('test'));
  expect(again).toEqual({ id: 'test', refused: 'cooldown' });
  expect(await page.evaluate(() => window.game.cutscenes.active)).toBe(false);

  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});
