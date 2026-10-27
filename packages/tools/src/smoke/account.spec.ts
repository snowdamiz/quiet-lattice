import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { GALAXY_SEED, Galaxy, frameIdOf, homeSystems } from '@astra/shared/world';
import { startOnline, type Online } from './online.ts';

// The title's sign-in and character screens through the server (P1.E04.T05; online.ts: a scratch database, the server
// with its dev login on, Vite): title → create an account (a reserved username refused first) → its empty list → a name
// the server refuses, then one it takes, of the people picked → the list → enter → the world (the welcome held until
// the screen has gone dark), all by keyboard; a wrong password refused on its field, Esc back a step at a
// time, the session kept until signing out; the dev scenarios through the dev login (`?dev#foot` on foot in its home
// hangar, `?dev=<name>&people=<id>#fly` in its people's home system); and `#foot` without `?dev` still the offline
// sandbox, asking the server nothing. Credentials are made up per run and exist only in the scratch database.

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
const newPilot = () => ({ username: `acct_${Date.now().toString(36)}${letters(4)}`, password: `pw-${randomBytes(9).toString('hex')}` });

/** Console errors, but for the refused requests (wrong password, refused name) the browser reports on purpose. */
function watchErrors(page: Page, refused: number[] = []): string[] {
  const errors: string[] = [];
  const expected = (t: string) => refused.some((s) => t.includes(`the server responded with a status of ${s}`));
  page.on('console', (m) => m.type() === 'error' && !expected(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Steps frames (rAF may be throttled) until the expression `pred` holds in the page. */
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

async function openTitle(page: Page, path = '/'): Promise<void> {
  await page.goto(`${online.url}${path}`);
  await page.waitForFunction(() => 'game' in window && 'step' in window, null, { timeout: 60_000 });
  await until(page, 'window.game.menus.ready', 120_000);
}

/** The flow's step now (`closed`: the title's menu). */
const step = (page: Page) => page.evaluate(() => window.game.menus.account.flow.step as string);
/** What has the focus: an input's name, a button's action or row, or the element. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement & { name?: string };
    return a?.name || a?.dataset?.do || a?.dataset?.act || (a?.dataset?.id ? 'row' : a?.tagName);
  });
const message = (page: Page) => page.locator('.acct-step:not(.leaving) .acct-msgwrap.on .acct-msg');

function homeOf(people: string) {
  const index = homeSystems(GALAXY_SEED).find((h) => h.people === people)!.systemIndex;
  return { index, station: frameIdOf(new Galaxy(GALAXY_SEED).systems[index]!.seed, 'station') };
}

test('title → a new account → a refused name, then a character of the people picked → enter, by keyboard', async ({ page }) => {
  const errors = watchErrors(page, [400]);
  const p = newPilot();
  await openTitle(page);
  // Play has the focus once the title is ready: Enter opens the sign-in, its username field focused
  expect(await focused(page)).toBe('start');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.acct [data-form="signin"]');
  expect(await focused(page)).toBe('username');
  await page.click('.acct [data-form="signin"] [data-do="to-register"]');
  await page.waitForSelector('.acct [data-form="register"]');
  expect(await focused(page)).toBe('username');
  // a username the dev login keeps: refused on its field, the password sent with it gone from the page
  await page.keyboard.type(`dev-${p.username.slice(5)}`);
  await page.keyboard.press('Tab');
  await page.keyboard.type(p.password);
  await page.keyboard.press('Enter');
  await expect(message(page)).toContainText('reserved');
  await expect(page.locator('.acct .acct-field[data-field="username"].bad')).toHaveCount(1);
  expect(await focused(page)).toBe('username');
  expect(await page.inputValue('.acct [data-form="register"] [name="password"]')).toBe('');
  await page.keyboard.type(p.username);
  await page.keyboard.press('Tab');
  await page.keyboard.type(p.password);
  await page.keyboard.press('Enter');

  // a new account lands on its empty list, the new character offered and focused: Enter opens it
  await page.waitForSelector('.acct-step:not(.leaving) .acct-list [data-do="new"]');
  expect(await page.locator('.acct-step:not(.leaving) .acct-char[data-id]').count()).toBe(0);
  expect(await focused(page)).toBe('new');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.acct [data-form="create"]');
  expect(await focused(page)).toBe('name');
  // a word the server reserves: refused, on the name field
  await page.keyboard.type('Dev Pilot');
  await page.keyboard.press('Enter');
  await expect(message(page)).toContainText('reserved');
  await expect(page.locator('.acct .acct-field[data-field="name"].bad')).toHaveCount(1);
  expect(await focused(page)).toBe('name');
  // the arrows pick the people from the name field; the name retyped over the selection
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.acct .acct-people.on')).toHaveAttribute('data-v', 'ixari');
  const name = `Ilya ${letters(1).toUpperCase()}${letters(6)}`;
  await page.keyboard.type(name);
  await expect(page.locator('.acct .acct-field.bad')).toHaveCount(0);
  await page.keyboard.press('Enter');

  // the list, the new character picked and focused: Enter enters
  await page.waitForSelector('.acct-step:not(.leaving) .acct-char[data-id][aria-selected="true"]');
  expect(await page.locator('.acct .acct-char[aria-selected="true"] .acct-char-name').textContent()).toBe(name);
  expect(await focused(page)).toBe('row');
  await page.keyboard.press('Enter');
  expect(await step(page)).toBe('entering');
  await until(page, "window.game.net?.joined && window.game.mode !== 'title'", 120_000);
  await until(page, 'window.game.net.store.ack > 0 && window.game.net.store.entities.has(window.game.net.entityId)', 30_000);

  const home = homeOf('ixari');
  const got = await page.evaluate(() => {
    const g = window.game;
    return {
      name: g.net.welcome.character.name,
      people: g.net.welcome.character.people,
      mode: g.net.welcome.mode,
      frame: g.net.welcome.pose.frame,
      system: g.galaxy.current.id,
      title: document.querySelector('.title-screen')!.classList.contains('show'),
      flow: g.menus.account.flow.step,
    };
  });
  expect(got).toEqual({ name, people: 'ixari', mode: 'docked', frame: home.station, system: home.index, title: false, flow: 'closed' });
  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});

test('a wrong password is refused on its field; Esc steps back; the session lasts until signing out', async ({ page, request }) => {
  const errors = watchErrors(page, [401]);
  const p = newPilot();
  const token = (await (await request.post(`${online.serverUrl}/auth/register`, { data: p })).json()).token as string;
  await request.post(`${online.serverUrl}/characters`, {
    headers: { authorization: `Bearer ${token}` },
    data: { name: `Tess ${letters(1).toUpperCase()}${letters(6)}`, people: 'thalune', look: { palette: 0, pattern: 0, head: 0, suit: 0 } },
  });
  await openTitle(page);
  await page.click('.title-screen [data-act="start"]');
  await page.fill('.acct [data-form="signin"] [name="username"]', p.username);
  await page.fill('.acct [data-form="signin"] [name="password"]', 'not-the-password');
  await page.keyboard.press('Enter');
  await expect(message(page)).toHaveText('Wrong username or password.');
  await expect(page.locator('.acct .acct-field[data-field="password"].bad')).toHaveCount(1);
  // the password field has the focus, the refused password gone from the page
  expect(await focused(page)).toBe('password');
  expect(await page.inputValue('.acct [data-form="signin"] [name="password"]')).toBe('');
  await page.keyboard.type(p.password);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.acct-step:not(.leaving) .acct-char[data-id][aria-selected="true"]');
  expect(await page.locator('.acct .acct-char[data-id]').count()).toBe(1);

  // Esc: back to the title's menu, Play focused; Play again: the list (the tab is still signed in)
  await page.keyboard.press('Escape');
  expect(await step(page)).toBe('closed');
  expect(await focused(page)).toBe('start');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.acct-step:not(.leaving) .acct-char[data-id][aria-selected="true"]');
  // N: a new character; Esc: back to the list
  await page.keyboard.press('n');
  await page.waitForSelector('.acct [data-form="create"]');
  await page.keyboard.press('Escape');
  expect(await step(page)).toBe('characters');
  // signing out forgets the session
  await page.click('.acct [data-do="signout"]');
  expect(await step(page)).toBe('signin');
  expect(await page.evaluate(() => sessionStorage.getItem('astra-session'))).toBeNull();
  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});

test('dev scenarios go through the dev login: ?dev#foot on foot in its home hangar', async ({ page }) => {
  const errors = watchErrors(page);
  await openTitle(page, '/?dev#foot');
  await until(page, "window.game.net?.joined && window.game.mode === 'foot'", 120_000);
  const home = homeOf('thalune');
  const got = await page.evaluate(() => {
    const g = window.game;
    return {
      name: g.net.welcome.character.name,
      system: g.galaxy.current.id,
      inHangar: g.player.state.frame === g.station,
      session: JSON.parse(sessionStorage.getItem('astra-session') ?? 'null')?.username,
    };
  });
  expect(got).toEqual({ name: 'Dev Foot', system: home.index, inHangar: true, session: 'dev-foot' });
  // the server took the walker where the client put it
  await until(page, "window.game.net.store.entities.get(window.game.net.entityId)?.mode === 'foot'", 30_000);
  expect(online.serverOutput()).toContain('dev login');
  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});

test("?dev=<name>&people=<id>: that people's dev character, in its home system", async ({ page }) => {
  const errors = watchErrors(page);
  const name = `smoke${letters(6)}`;
  await openTitle(page, `/?dev=${name}&people=ulgani#fly`);
  await until(page, "window.game.net?.joined && window.game.mode === 'ship'", 120_000);
  const home = homeOf('ulgani');
  const got = await page.evaluate(() => ({
    people: window.game.net.welcome.character.people,
    system: window.game.galaxy.current.id,
    frame: window.game.net.welcome.pose.frame,
  }));
  expect(got).toEqual({ people: 'ulgani', system: home.index, frame: home.station });
  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});

test('#foot without ?dev is still the offline sandbox: no sign-in, no socket', async ({ page }) => {
  const errors = watchErrors(page);
  const asked: string[] = [];
  page.on('request', (r) => /\/(auth|characters|ws)\b/.test(new URL(r.url()).pathname) && asked.push(r.url()));
  await openTitle(page, '/#foot');
  await until(page, "window.game.mode === 'foot'", 60_000);
  const got = await page.evaluate(() => ({
    net: window.game.net,
    flow: window.game.menus.account.flow.step,
    sandboxFrame: !!window.game.player.state.frame?.sampler,
  }));
  expect(got).toEqual({ net: null, flow: 'closed', sandboxFrame: true });
  expect(asked).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});
