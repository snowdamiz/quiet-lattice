import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { GALAXY_SEED, Galaxy, frameIdOf, homeSystems } from '@astra/shared/world';
import { startOnline, type Online } from './online.ts';

// The game through the server (P1.E04.T01): sign up, make a character, enter, and spawn docked at the people's home
// Waystation; then a reload resumes the character where the server holds it (on foot in the hangar, its warp cell moved
// to the cargo pod), with no localStorage save anywhere. The server runs against a scratch database (online.ts).
// Credentials are made up per run here and exist only in that database.

let online: Online;

test.beforeAll(async () => {
  online = await startOnline();
});

test.afterAll(async () => {
  await online?.stop();
});

// leave as a player does, so the dev server's proxy sees the socket close rather than torn down with the page
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.game?.net?.close()).catch(() => {});
  await page.waitForTimeout(200);
});

function letters(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(97 + randomInt(26));
  return s;
}

function newPilot() {
  return {
    username: `smoke_${Date.now().toString(36)}${letters(4)}`,
    password: `pw-${randomBytes(9).toString('hex')}`,
    name: `Pilot ${letters(1).toUpperCase()}${letters(7)}`,
  };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Steps frames (rAF may be throttled) until the expression `pred` holds in the page. (Stepped synchronously: a
 * predicate that returned a promise would count as true at once.) */
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

/** The title, ready to play. */
async function openTitle(page: Page): Promise<void> {
  await page.goto(`${online.url}/`);
  await page.waitForFunction(() => 'game' in window && 'step' in window, null, { timeout: 60_000 });
  await until(page, 'window.game.menus.ready', 120_000);
}

/** Play → sign up → make a character of `people` → its row in the list. */
async function signUp(page: Page, pilot: ReturnType<typeof newPilot>, people: string): Promise<void> {
  await page.click('.title-screen [data-act="start"]');
  await page.fill('.account [name="username"]', pilot.username);
  await page.fill('.account [name="password"]', pilot.password);
  await page.click('.account [data-do="register"]');
  await page.fill('.account [name="name"]', pilot.name);
  await page.click(`.account [data-people] [data-v="${people}"]`);
  await page.click('.account [data-form="create"] [type="submit"]');
  await page.waitForSelector('.account [data-enter]');
}

/** Enter with the listed character, and wait until the server's snapshots echo the client's input. */
async function enter(page: Page): Promise<void> {
  await page.click('.account [data-enter]');
  await until(page, "window.game.net?.joined && window.game.mode !== 'title'", 120_000);
  await until(page, 'window.game.net.store.ack > 0 && window.game.net.store.entities.has(window.game.net.entityId)', 30_000);
}

function homeOf(people: string) {
  const index = homeSystems(GALAXY_SEED).find((h) => h.people === people)!.systemIndex;
  return { index, station: frameIdOf(new Galaxy(GALAXY_SEED).systems[index]!.seed, 'station') };
}

test('sign up, make a character and spawn docked at the home Waystation', async ({ page }) => {
  const errors = watchErrors(page);
  const pilot = newPilot();
  await openTitle(page);
  await signUp(page, pilot, 'thalune');
  await enter(page);

  const home = homeOf('thalune');
  const got = await page.evaluate(() => {
    const g = window.game;
    const s = g.ship.state;
    const n = g.net;
    const own = n.store.entities.get(n.entityId);
    return {
      welcome: { mode: n.welcome.mode, frame: n.welcome.pose.frame, zone: n.welcome.zone.id, name: n.welcome.character.name },
      mode: g.mode,
      shipMode: g.ship.mode,
      system: g.galaxy.current.id,
      inStation: s.frame === g.station,
      onPad: g.station.pads.some((p: { x: number; z: number; occupied: unknown }) => p.occupied === g.ship && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 1e-6),
      title: document.querySelector('.title-screen')!.classList.contains('show'),
      own: { mode: own.mode, frame: own.frame, pos: own.pos, local: s.pos.toArray() },
      saved: Object.keys(localStorage),
    };
  });
  expect(got.welcome).toEqual({ mode: 'docked', frame: home.station, zone: `sys:${home.index}`, name: pilot.name });
  expect(got).toMatchObject({ mode: 'ship', shipMode: 'landed', system: home.index, inStation: true, onPad: true, title: false });
  // the server holds what the client sent: docked on that pad
  expect(got.own.mode).toBe('docked');
  expect(got.own.frame).toBe(home.station);
  expect(Math.hypot(...got.own.pos.map((v: number, i: number) => v - got.own.local[i]))).toBeLessThan(1e-6);
  expect(got.saved.filter((k: string) => k !== 'next-horizon-settings')).toEqual([]);
  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});

test('a reload resumes the character where the server holds it', async ({ page }) => {
  const errors = watchErrors(page);
  const pilot = newPilot();
  await openTitle(page);
  await signUp(page, pilot, 'ixari');
  await enter(page);
  const home = homeOf('ixari');
  expect(await page.evaluate(() => window.game.galaxy.current.id)).toBe(home.index);

  // out of the ship onto the hangar floor, and the warp cell across to the cargo pod: both the server's to keep
  await page.evaluate(() => {
    const g = window.game;
    g.exitShip();
    const i = g.inventory.state.suit.findIndex((s: { item: string } | null) => s?.item === 'warp_cell');
    g.inventory.request({ op: 'transfer', from: { c: 'suit', i } });
  });
  await until(page, "window.game.inventory.pending.length === 0 && window.game.inventory.confirmed.pods[0].some((s) => s?.item === 'warp_cell')", 30_000);
  // standing still, and the server's snapshot showing the walker where the client has it
  await until(
    page,
    `(() => {
      const g = window.game;
      const own = g.net.store.entities.get(g.net.entityId);
      const p = g.player.state.pos;
      return own.mode === 'foot' && g.player.grounded && Math.hypot(own.pos[0] - p.x, own.pos[1] - p.y, own.pos[2] - p.z) < 1e-3;
    })()`,
    30_000,
  );
  const before = await page.evaluate(() => window.game.player.state.pos.toArray());

  await page.reload();
  await openTitle(page);
  // still signed in (the session is this tab's): Play lists the character
  await page.click('.title-screen [data-act="start"]');
  await page.waitForSelector('.account [data-enter]');
  await enter(page);

  const after = await page.evaluate(() => {
    const g = window.game;
    const n = g.net;
    return {
      welcome: { mode: n.welcome.mode, frame: n.welcome.pose.frame, pos: n.welcome.pose.pos },
      mode: g.mode,
      system: g.galaxy.current.id,
      inStation: g.player.state.frame === g.station,
      pos: g.player.state.pos.toArray(),
      shipDocked: g.ship.mode === 'landed' && g.ship.state.frame === g.station,
      warpCellInPod: g.inventory.state.pods[0].some((s: { item: string } | null) => s?.item === 'warp_cell'),
      warpCellInSuit: g.inventory.state.suit.some((s: { item: string } | null) => s?.item === 'warp_cell'),
      saved: Object.keys(localStorage),
    };
  });
  expect(after.welcome.mode).toBe('foot');
  expect(after.welcome.frame).toBe(home.station);
  expect(Math.hypot(...after.welcome.pos.map((v: number, i: number) => v - before[i]!))).toBeLessThan(1e-3);
  expect(after).toMatchObject({ mode: 'foot', system: home.index, inStation: true, shipDocked: true, warpCellInPod: true, warpCellInSuit: false });
  expect(Math.hypot(...after.pos.map((v: number, i: number) => v - before[i]!))).toBeLessThan(0.25);
  expect(after.saved.filter((k: string) => k !== 'next-horizon-settings')).toEqual([]);
  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});
