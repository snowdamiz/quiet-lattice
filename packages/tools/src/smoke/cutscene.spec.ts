import { expect, test } from '@playwright/test';

// The test cutscene (packages/client/public/cutscenes/test.json, exported from assets/blend/cutscenes/
// test_cutscene.blend) plays end to end on window.step: the letterbox eases in and the player's controls lock; its lines
// show in order, the key reveals one and then jumps to the next behind a dip; the banner it raises shows; the letterbox
// eases out and the camera comes back to the player's ship, the controls with it. Played again and skipped with Esc,
// its remaining events fire marked skipped (no banner) and the camera comes back the same way. It asks for its phase
// first (offline: the local layer). Nothing logs an error.
//
// Online (game.net, here a stand-in for the client's Net) it asks the server first and plays only on its `play`.
//
// The page's own frame loop is held (its requestAnimationFrame callbacks parked) once the game is up, so frames advance
// only through window.step and every number below is the same on every run.

interface Trace {
  lines: { id: string; clock: number }[];
  events: { name: string; skipped: boolean }[];
  k: number[];
  banners: string[];
}

test('plays the test cutscene end to end, and skips it', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const w = window as unknown as { __holdRaf: boolean };
    w.__holdRaf = false;
    window.requestAnimationFrame = (cb) => (w.__holdRaf ? 0 : raf(cb));
  });

  await page.goto('/');
  await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    await window.dev.boot();
    const g = window.game;
    g.cutscenes.stage(await g.cutscenes.load('test'));
    await window.step(90);
  });
  // (the arrival banner, raised on a timer as the game starts, out of the way)
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const g = window.game;
    g.hud.clearBanners();
    (window as unknown as { __holdRaf: boolean }).__holdRaf = true;
    await new Promise((r) => setTimeout(r, 100));
    const trace: Trace = { lines: [], events: [], k: [], banners: [] };
    (window as unknown as { __trace: Trace }).__trace = trace;
    g.cutscenes.on('line', (l: { id: string }) => trace.lines.push({ id: l.id, clock: g.cutscenes.state().clock }));
    g.cutscenes.on('event', (e: { name: string; skipped: boolean }) => trace.events.push({ name: e.name, skipped: e.skipped }));
    const show = g.hud.showBanner.bind(g.hud);
    g.hud.showBanner = (title: string, sub: string) => {
      trace.banners.push(`${title} / ${sub}`);
      show(title, sub);
    };
  });

  // ---- play ----
  const begun = await page.evaluate(async () => {
    const g = window.game;
    const w = window as unknown as { __result: Promise<unknown> & { value?: unknown } };
    const p = g.cutscenes.play('test');
    p.then((v: unknown) => (w.__result.value = v));
    w.__result = p;
    await new Promise((r) => setTimeout(r, 0));
    const trace = (window as unknown as { __trace: Trace }).__trace;
    for (let i = 0; i < 60; i++) {
      await window.step(1);
      trace.k.push(g.cutscenes.letterbox);
    }
    return {
      active: g.cutscenes.active,
      overlay: g.overlay,
      inputEnabled: g.input.enabled,
      k: trace.k,
      sent: [...g.cutscenes.link.sent],
      hud: getComputedStyle(document.querySelector('.hud-layer')!).opacity,
    };
  });
  expect(begun.active).toBe(true);
  expect(begun.overlay).toBe('cutscene');
  expect(begun.inputEnabled).toBe(false);
  // eased in: starting from nothing, never going back, closed within LETTERBOX_IN (0.9 s)
  expect(begun.k[0]).toBeGreaterThan(0);
  expect(begun.k[0]).toBeLessThan(0.02);
  expect(begun.k.every((v, i) => i === 0 || v >= begun.k[i - 1]!)).toBe(true);
  expect(begun.k[53]).toBeCloseTo(1, 4);
  expect(Number(begun.hud)).toBe(0);
  // asked for its phase first
  expect(begun.sent.map((m) => JSON.parse(m))).toEqual([{ t: 'cutscene', op: 'request', id: 'test' }]);

  // at 2 s the first line has been read; the key jumps to the next (behind a dip), and pressed early in it reveals it
  const keyed = await page.evaluate(async () => {
    const g = window.game;
    await window.step(60);
    const before = g.cutscenes.state();
    const press = async () => {
      window.dev.key('Space', true);
      await window.step(1);
      window.dev.key('Space', false);
    };
    await press();
    const jumped = { ...g.cutscenes.state(), dip: !!g.director.dip };
    await window.step(6);
    await press();
    const revealed = g.cutscenes.state();
    return { before, jumped, revealed };
  });
  expect(keyed.before.line).toMatchObject({ id: 'hail', complete: true });
  expect(keyed.jumped.line?.id).toBe('tow');
  // (the next line's start, and the frame the key was read in)
  expect(keyed.jumped.clock).toBeCloseTo(4.7917 + 1 / 60, 3);
  expect(keyed.jumped.dip).toBe(true);
  expect(keyed.revealed.line).toMatchObject({ id: 'tow', complete: true });
  expect(keyed.revealed.clock).toBeLessThan(5);

  // on to the end: the banner, the last line, then the letterbox opening and the camera back on the ship
  const ended = await page.evaluate(async () => {
    const g = window.game;
    const trace = (window as unknown as { __trace: Trace }).__trace;
    await window.step(30);
    const banner = document.querySelector('#hud > .banner')!.textContent;
    while (g.cutscenes.state()?.phase === 'play') await window.step(1);
    const atEnd = g.overlay;
    const k: number[] = [];
    let frames = 0;
    while (g.cutscenes.active && frames < 600) {
      await window.step(1);
      k.push(g.cutscenes.letterbox);
      frames++;
    }
    await window.step(1);
    const ship = g.ship.state;
    const camToShip = g.cam.worldPosition(g.camWorld.clone()).distanceTo(ship.worldPosition(g.camWorld.clone()));
    return {
      banner,
      atEnd,
      k,
      frames,
      active: g.cutscenes.active,
      overlayAfter: g.overlay,
      result: (window as unknown as { __result: { value?: unknown } }).__result.value,
      camOnShip: g.cam.frame === ship.frame,
      camToShip,
      director: { cine: !!g.director.cine, viewScene: g.engine.viewScene.visible },
      fov: [g.engine.camera.fov, g.fov],
      cineShown: getComputedStyle(document.querySelector('.cine')!).display,
      hud: getComputedStyle(document.querySelector('.hud-layer')!).opacity,
      sent: [...g.cutscenes.link.sent].map((m: string) => JSON.parse(m)),
      trace,
    };
  });
  expect(ended.banner).toContain('Inbound lane');
  expect(ended.banner).toMatch(/WAYSTATION/);
  expect(ended.trace.lines.map((l) => l.id)).toEqual(['hail', 'tow', 'welcome']);
  expect(ended.trace.events).toEqual([
    { name: 'station', skipped: false },
    { name: 'cleared', skipped: false },
  ]);
  expect(ended.trace.banners).toHaveLength(1);
  // the controls stay with the cutscene while the camera goes home, and come back once it is there
  expect(ended.atEnd).toBe('cutscene');
  expect(ended.overlayAfter).toBeNull();
  // eased out over the exit, never closing again
  expect(ended.k.every((v, i) => i === 0 || v <= ended.k[i - 1]!)).toBe(true);
  expect(ended.k.at(-1)).toBe(0);
  expect(ended.frames).toBeGreaterThan(80);
  expect(ended.frames).toBeLessThan(100);
  expect(ended.active).toBe(false);
  expect(ended.result).toEqual({ id: 'test', skipped: false, phase: null, events: ['station', 'cleared'] });
  expect(ended.camOnShip).toBe(true);
  expect(ended.camToShip).toBeLessThan(40);
  expect(ended.director).toEqual({ cine: false, viewScene: true });
  expect(Math.abs(ended.fov[0] - ended.fov[1])).toBeLessThan(0.05);
  expect(ended.cineShown).toBe('none');
  expect(Number(ended.hud)).toBe(1);
  expect(ended.sent.at(-1)).toEqual({ t: 'cutscene', op: 'done', id: 'test', skipped: false });

  // ---- play again, and skip it with Esc ----
  const skipped = await page.evaluate(async () => {
    const g = window.game;
    const trace = (window as unknown as { __trace: Trace }).__trace;
    trace.lines = [];
    trace.events = [];
    trace.banners = [];
    let result: unknown;
    void g.cutscenes.play('test').then((v: unknown) => (result = v));
    await new Promise((r) => setTimeout(r, 0));
    await window.step(60);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', bubbles: true }));
    const after = { ...g.cutscenes.state(), overlay: g.overlay };
    await window.step(1);
    const overlayDuring = g.overlay;
    const pauseShown = document.querySelector('.pause-menu')?.classList.contains('show') ?? false;
    let frames = 0;
    while (g.cutscenes.active && frames < 600) {
      await window.step(1);
      frames++;
    }
    await window.step(1);
    const ship = g.ship.state;
    return {
      after,
      overlayDuring,
      pauseShown,
      overlayAfter: g.overlay,
      frames,
      result,
      trace,
      camOnShip: g.cam.frame === ship.frame,
      camToShip: g.cam.worldPosition(g.camWorld.clone()).distanceTo(ship.worldPosition(g.camWorld.clone())),
      sent: JSON.parse(g.cutscenes.link.sent.at(-1)),
    };
  });
  expect(skipped.after.phase).toBe('exit');
  // (Esc closed the overlay as it skipped; the cutscene keeps the screen, and no pause screen, until the camera is home)
  expect(skipped.after.overlay).toBeNull();
  expect(skipped.overlayDuring).toBe('cutscene');
  expect(skipped.pauseShown).toBe(false);
  expect(skipped.overlayAfter).toBeNull();
  expect(skipped.after.clock).toBe(11.5);
  expect(skipped.trace.lines.map((l) => l.id)).toEqual(['hail']);
  expect(skipped.trace.events).toEqual([
    { name: 'station', skipped: true },
    { name: 'cleared', skipped: true },
  ]);
  expect(skipped.trace.banners).toEqual([]);
  expect(skipped.result).toEqual({ id: 'test', skipped: true, phase: null, events: ['station', 'cleared'] });
  expect(skipped.frames).toBeLessThan(100);
  expect(skipped.camOnShip).toBe(true);
  expect(skipped.camToShip).toBeLessThan(40);
  expect(skipped.sent).toEqual({ t: 'cutscene', op: 'done', id: 'test', skipped: true });

  // ---- online (a stand-in for game.net): it asks the server, and plays only on its `play`, in the phase it names ----
  const online = await page.evaluate(async () => {
    const g = window.game;
    const handlers = new Map<string, ((m: unknown) => void)[]>();
    const sent: unknown[] = [];
    g.net = {
      joined: true,
      send: (m: unknown) => (sent.push(m), true),
      on: (type: string, fn: (m: unknown) => void) => {
        handlers.set(type, [...(handlers.get(type) ?? []), fn]);
        return () =>
          handlers.set(
            type,
            (handlers.get(type) ?? []).filter((f) => f !== fn),
          );
      },
    };
    const answer = (m: unknown) => (handlers.get('cutscene') ?? []).forEach((fn) => fn(m));
    // refused: nothing plays
    const refusedP = g.cutscenes.play('test');
    await new Promise((r) => setTimeout(r, 0));
    answer({ t: 'cutscene', op: 'refused', id: 'test', phase: null, reason: 'denied' });
    const refused = await refusedP;
    await window.step(5);
    const activeAfterRefusal = g.cutscenes.active;
    // play: it plays in the server's phase, and says done at the end
    const playP = g.cutscenes.play('test');
    await new Promise((r) => setTimeout(r, 0));
    answer({ t: 'cutscene', op: 'play', id: 'test', phase: 9 });
    await new Promise((r) => setTimeout(r, 0));
    await window.step(2);
    const state = g.cutscenes.state();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    while (g.cutscenes.active) await window.step(5);
    const result = await playP;
    g.net = null;
    return { refused, activeAfterRefusal, storyPhase: state?.storyPhase, result, sent };
  });
  expect(online.refused).toEqual({ id: 'test', refused: 'denied' });
  expect(online.activeAfterRefusal).toBe(false);
  expect(online.storyPhase).toBe(9);
  expect(online.result).toMatchObject({ id: 'test', skipped: true, phase: 9 });
  expect(online.sent).toEqual([
    { t: 'cutscene', op: 'request', id: 'test' },
    { t: 'cutscene', op: 'request', id: 'test' },
    { t: 'cutscene', op: 'done', id: 'test', skipped: true },
  ]);

  expect(errors, errors.join('\n')).toEqual([]);
});
