import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { startOnline, type Online } from './online.ts';

// Two players chatting and partying up through the chat panel and the party frame (P1.E15.T03), as players run them
// (online.ts: a scratch database, the server, Vite), in two browser contexts: Enter opens the panel, a line typed goes to
// the shard and reaches the other client as text (markup and all, never as HTML); `/invite` reaches the other as a card
// it accepts with the mouse; both frames show the party, its leader marked, and the leader hands the lead on from the
// frame; party chat reaches the party; the server's refusals and the panel's own pace show in the log; `/leave` breaks
// the party up for both; and again from the frame, inviting by name there, accepting with `/accept` and leaving with the
// frame's button. Credentials are made up per run and exist only in the scratch database.

let online: Online;

test.beforeAll(async () => {
  online = await startOnline();
});

test.afterAll(async () => {
  await online?.stop();
});

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + randomInt(26))).join('');

/** Steps frames (the page's own loop may be throttled) until the expression `pred` holds in the page. */
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

/** A new pilot of `people` signs up and enters the world; returns its name and the console errors it collects. */
async function enterAsNewPilot(page: Page, people: string): Promise<{ name: string; errors: string[] }> {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const name = `Pilot ${letters(1).toUpperCase()}${letters(7)}`;
  await page.goto(`${online.url}/`);
  await page.waitForFunction(() => 'game' in window && 'step' in window, null, { timeout: 60_000 });
  await until(page, 'window.game.menus.ready', 120_000);
  await page.click('.title-screen [data-act="start"]');
  await page.fill('.account [name="username"]', `smoke_${Date.now().toString(36)}${letters(4)}`);
  await page.fill('.account [name="password"]', `pw-${randomBytes(9).toString('hex')}`);
  await page.click('.account [data-do="register"]');
  await page.fill('.account [name="name"]', name);
  await page.click(`.account [data-people] [data-v="${people}"]`);
  await page.click('.account [data-form="create"] [type="submit"]');
  await page.waitForSelector('.account [data-enter]');
  await page.click('.account [data-enter]');
  await until(page, "window.game.net?.joined && window.game.mode !== 'title'", 120_000);
  await until(page, 'window.game.net.store.ack > 0 && window.game.net.store.entities.has(window.game.net.entityId)', 30_000);
  return { name, errors };
}

/** Enter: the chat panel opens (and the party frame takes clicks). */
async function openChat(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await until(page, "window.game.overlay === 'chat' && document.querySelector('.social-side').classList.contains('live')", 10_000);
}

/** Opens the panel if it is shut (or gives its input the keys back), types a line and sends it with Enter. */
async function say(page: Page, text: string): Promise<void> {
  if (await page.evaluate(() => window.game.overlay === 'chat')) await page.focus('.social-chat .sc-input input');
  else await openChat(page);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** The log's lines as shown, with how each is drawn. */
async function lines(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.social-chat .sc-line')].map((l) => ({
      text: l.textContent ?? '',
      cls: l.className,
      elements: l.querySelectorAll('*').length,
    })),
  );
}

/** Steps frames until the log shows a line containing `text` (on `channel`, when given). */
async function sees(page: Page, text: string, channel?: string): Promise<void> {
  await until(
    page,
    `[...document.querySelectorAll('.social-chat .sc-line${channel ? `.ch-${channel}` : ''}')].some((l) => l.textContent.includes(${JSON.stringify(text)}))`,
    20_000,
  );
}

/** The party frame as drawn: each member's name, whether it leads, and its health bar's width. */
async function frame(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.sp-member')].map((r) => ({
      name: r.querySelector('.sp-name')?.textContent,
      leader: r.classList.contains('leader'),
      health: (r.querySelector('.sp-hp b') as HTMLElement | null)?.style.width ?? null,
    })),
  );
}

test('two pilots chat on the shard, party up from an invite card, hand the lead on and part', async ({ browser }) => {
  test.setTimeout(360_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    const A = await enterAsNewPilot(a, 'thalune');
    const B = await enterAsNewPilot(b, 'ixari');

    // a shard line, markup and all, reaches the other client as text
    const line = 'Hello from the Waystation <b>&</b> <img src=x onerror="window.__pwned=1">';
    await say(a, line);
    await until(a, "window.game.overlay !== 'chat'", 10_000);
    await sees(b, line, 'shard');
    await sees(a, line, 'shard');
    const got = (await lines(b)).find((l) => l.text.includes(line))!;
    expect(got.text).toBe(`${A.name}${line}`);
    // (the name and the text spans, and nothing the line carried)
    expect(got.elements).toBe(2);
    expect(await b.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();

    // /invite: the other client gets a card, and accepts it with the mouse once the panel frees it
    await say(a, `/invite ${B.name}`);
    await sees(a, `Invite sent to ${B.name}`);
    await until(b, `[...document.querySelectorAll('.sp-invite')].some((c) => c.textContent.includes(${JSON.stringify(A.name)}))`, 20_000);
    await openChat(b);
    await b.click('.sp-invite .btn:not(.ghost)');
    await until(a, "document.querySelectorAll('.sp-member').length === 2", 20_000);
    await until(b, "document.querySelectorAll('.sp-member').length === 2 && !document.querySelector('.sp-invite')", 20_000);
    for (const page of [a, b]) {
      expect(await frame(page)).toEqual([
        { name: A.name, leader: true, health: '100%' },
        { name: B.name, leader: false, health: '100%' },
      ]);
    }
    await sees(a, `${B.name} joined the party`);
    await sees(b, 'You joined the party');

    // party chat, switched to with /p
    await say(b, '/p on my way');
    await sees(a, 'on my way', 'party');

    // the leader hands the lead on from the frame
    await openChat(a);
    await a.click(`.sp-member[data-name="${B.name}"] .sp-act:text("Lead")`);
    await until(b, `document.querySelector('.sp-member.leader .sp-name')?.textContent === ${JSON.stringify(B.name)}`, 20_000);
    await until(a, `document.querySelector('.sp-member.leader .sp-name')?.textContent === ${JSON.stringify(B.name)}`, 20_000);
    await sees(b, 'You lead the party now');

    // refusals: the server's (no longer the leader; no one by that name online), and the panel's own pace
    await a.keyboard.press('Escape');
    await until(a, "window.game.overlay !== 'chat'", 10_000);
    await say(a, `/kick ${B.name}`);
    await sees(a, "Only the party's leader can remove");
    await say(a, '/invite Nobody Here');
    await sees(a, 'No one called Nobody Here is online');
    // (the pace full again first: A's shard line spent a token a moment ago)
    await until(a, 'window.game.hud.social.model.paceWait() === 0 && window.game.hud.social.model.pace.level >= 5', 20_000);
    const paced = await a.evaluate(() => {
      const m = window.game.hud.social.model;
      return [1, 2, 3, 4, 5, 6].map((i) => m.submit(`line ${i}`).ok);
    });
    // (5 at once, as the server takes them, and the sixth held back with its text)
    expect(paced).toEqual([true, true, true, true, true, false]);
    await sees(a, 'Slow down: chat again in');
    expect((await lines(a)).filter((l) => /Slow down|No one called|Only the party/.test(l.text)).every((l) => l.cls.includes('refusal'))).toBe(true);

    // /leave: a party of two breaks up for both
    await say(b, '/leave');
    await until(a, "document.querySelectorAll('.sp-member').length === 0", 20_000);
    await until(b, "document.querySelectorAll('.sp-member').length === 0", 20_000);
    await sees(a, 'The party disbanded');

    // and again from the frame: an invite by name there, accepted by command, and leaving with the frame's button
    await openChat(a);
    await a.fill('.sp-foot input', B.name);
    await a.click('.sp-foot .btn:not(.ghost)');
    await until(b, `[...document.querySelectorAll('.sp-invite')].some((c) => c.textContent.includes(${JSON.stringify(A.name)}))`, 20_000);
    await say(b, '/accept');
    await until(a, "document.querySelectorAll('.sp-member').length === 2", 20_000);
    await until(b, "document.querySelectorAll('.sp-member').length === 2", 20_000);
    await openChat(b);
    await b.click('.sp-foot .btn.ghost');
    await until(a, "document.querySelectorAll('.sp-member').length === 0", 20_000);
    await until(b, "document.querySelectorAll('.sp-member').length === 0", 20_000);
    await sees(b, 'You left the party');

    expect(A.errors, `${A.errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
    expect(B.errors, `${B.errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
  } finally {
    for (const page of [a, b]) await page.evaluate(() => window.game?.net?.close()).catch(() => {});
    await a.waitForTimeout(200);
    await ctxA.close();
    await ctxB.close();
  }
});
