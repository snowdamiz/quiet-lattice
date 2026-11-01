// Real client flight across two stars on controlled clocks, with movement authority enabled.
// Only rendering cadence and input sampling are reduced during the long cruise; every physics
// frame and every boundary uses Game/Ship/Universe, and every sent pose is checked by the server.
import { randomBytes } from 'node:crypto';
import { Galaxy, GALAXY_SEED } from '@astra/shared/world';
import type { Page } from '@playwright/test';
import { expect, test } from './harness.ts';
import { enterPicked, signUp } from './account.ts';
import { startOnline, type Online } from './online.ts';

let online: Online;
test.beforeAll(async () => {
  online = await startOnline({ stepped: true });
});
test.afterAll(async () => {
  await online?.stop();
});

async function flying(page: Page, seconds: number) {
  await online.clock!.advance(seconds * 1000);
  return page.evaluate(async (seconds) => {
    const g = window.game;
    const h = g.__handoff;
    const frames = Math.ceil(seconds * 60);
    for (let i = 0; i < frames; i++) {
      h.ms += (seconds * 1000) / frames;
      h.frame(seconds / frames);
    }
    g.net.sendInput();
    const deadline = Date.now() + 10_000;
    while (g.net.joined && g.net.store.ack < g.net.inputSeq && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    if (!g.net.joined || g.net.store.ack < g.net.inputSeq) throw new Error(`input not acknowledged: ${g.net.state}, ${g.net.store.ack}/${g.net.inputSeq}`);
    if (h.corrections.length) throw new Error(`movement correction: ${JSON.stringify(h.corrections.at(-1))}`);
    return { zone: g.net.zone.id, deep: g.universe.deep, system: g.system.info.id, mode: g.ship.mode, pos: g.universe.hereLy().toArray() };
  }, seconds);
}

test('flies from one star through deep space into another, then warps without duplicating its entity', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const galaxy = new Galaxy(GALAXY_SEED);
  const target = [...galaxy.systems.slice(1)].sort((a, b) => galaxy.distance(a, galaxy.systems[0]!) - galaxy.distance(b, galaxy.systems[0]!))[0]!;
  const length = Math.hypot(target.x, target.y, target.z);
  const [x, y, z] = [target.x / length, target.y / length, target.z / length];
  const q = [y!, -x!, 0, 1 - z!];
  const qn = Math.hypot(...q);
  const pose = { frame: null, pos: [x!, y!, z!].map((v) => v * (6e9 - 1000)), quat: q.map((v) => v / qn), vel: [x!, y!, z!].map((v) => v * 100) };
  await page.goto(online.url);
  await page.waitForFunction(() => window.game?.menus.ready, null, { timeout: 120_000 });
  const suffix = randomBytes(5).toString('hex');
  await signUp(page, { username: `handoff_${suffix}`, password: `pw-${suffix}`, name: `Pilot ${suffix.replace(/[0-9]/g, 'a')}` });
  const character = await page.locator('.acct-step:not(.leaving) .acct-char[aria-selected="true"]').getAttribute('data-id');
  expect(character).toMatch(/^[a-f0-9-]{36}$/);
  // The initial saved pose is the fixture. From entry onward the ship flies every metre.
  const saved = JSON.stringify({ pose: { v: 2, data: { system: 0, pose, mode: 'ship' } } });
  online.sql(`UPDATE characters SET state = '${saved}'::jsonb WHERE id = '${character}'`);
  await enterPicked(page);
  await page.waitForFunction(() => window.game?.net?.joined && window.game.mode === 'ship', null, { timeout: 120_000 });
  await page.evaluate(() => {
    const g = window.game;
    g.__handoff = { frame: g.frame.bind(g), render: g.renderFrame.bind(g), ms: performance.now(), corrections: [], zones: [] };
    g.frame = () => {};
  });
  await online.clock!.freeze();
  await page.evaluate(async () => {
    const g = window.game;
    const h = g.__handoff;
    performance.now = () => h.ms;
    g.net.update = () => {};
    // The renderer resumes for the final scene; flight, frame selection and tier preparation run.
    g.renderFrame = () => {};
    g.net.on('correction', (m: unknown) => h.corrections.push(m));
    g.net.on('zone', (m: { zone: { id: string }; reason: string }) => h.zones.push({ zone: m.zone.id, reason: m.reason }));
    const samples = g.net.clock.samples.length;
    g.net.ping();
    while (g.net.clock.samples.length === samples) await new Promise((resolve) => setTimeout(resolve, 5));
    g.menus.closeAll();
    g.ship.tryPulse();
  });
  let arrived = false;
  for (let elapsed = 0; elapsed < 1700; elapsed++) {
    const state = await flying(page, 1);
    if (state.zone === `sys:${target.id}` && state.system === target.id && !state.deep) {
      arrived = true;
      break;
    }
    if (elapsed % 200 === 0) console.log('handoff cruise', elapsed, state.zone, state.mode);
  }
  expect(arrived).toBe(true);
  const beforeWarp = await page.evaluate(() => {
    const g = window.game;
    return {
      zones: g.__handoff.zones,
      cells: g.inventory.warpCells,
      self: [...g.net.store.entities.values()].filter((e: { id: number }) => e.id === g.net.entityId).length,
    };
  });
  expect(beforeWarp.zones).toContainEqual({ zone: 'deep:0', reason: 'flight' });
  expect(beforeWarp.zones).toContainEqual({ zone: `deep:${target.id}`, reason: 'flight' });
  expect(beforeWarp.zones).toContainEqual({ zone: `sys:${target.id}`, reason: 'flight' });
  expect(beforeWarp.self).toBe(1);
  expect(await online.admin({ cmd: 'who' })).toMatchObject({ ok: true, result: { sessions: 1, online: [{ zone: `sys:${target.id}` }] } });
  expect(await page.evaluate(() => window.game.warpTo(window.game.galaxy.systems[0]))).toBe(true);
  await page.waitForFunction(() => window.game.net.zone.id === 'sys:0' && !window.game.warping, null, { timeout: 15_000 });
  await online.clock!.advance(5400);
  await page.evaluate(() => {
    const g = window.game;
    g.__handoff.ms += 5400;
    g.renderFrame = g.__handoff.render;
    g.__handoff.frame(1 / 60);
    g.net.sendInput();
  });
  await page.waitForFunction(() => window.game.net.store.ack >= window.game.net.inputSeq);
  const final = await page.evaluate(() => {
    const g = window.game;
    return {
      zone: g.net.zone.id,
      system: g.system.info.id,
      cells: g.inventory.warpCells,
      corrections: g.__handoff.corrections,
      self: [...g.net.store.entities.values()].filter((e: { id: number }) => e.id === g.net.entityId).length,
    };
  });
  expect(final).toEqual({ zone: 'sys:0', system: 0, cells: beforeWarp.cells - 1, corrections: [], self: 1 });
  expect(await online.admin({ cmd: 'who' })).toMatchObject({ ok: true, result: { sessions: 1, online: [{ zone: 'sys:0' }] } });
  const zones = await online.admin({ cmd: 'zones' });
  expect(zones).toMatchObject({
    ok: true,
    result: {
      zones: expect.arrayContaining([
        expect.objectContaining({ id: 'deep:0', entities: 0, sessions: 0 }),
        expect.objectContaining({ id: `deep:${target.id}`, entities: 0, sessions: 0 }),
        expect.objectContaining({ id: `sys:${target.id}`, entities: 0, sessions: 0 }),
      ]),
    },
  });
  await page.waitForSelector('.warp-canvas:not(.show)', { state: 'attached' });
  await page.screenshot({ path: info.outputPath('handoff-arrival.png') });
  expect(errors).toEqual([]);
  await page.evaluate(() => window.game.net.close());
});
