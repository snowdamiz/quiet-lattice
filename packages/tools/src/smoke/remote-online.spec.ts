import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { startOnline, type Online } from './online.ts';

// Remote entities (P1.E04.T02) between two clients, as players run it (online.ts: a scratch database, the server, Vite):
// two pilots sign up and enter, docked at the same home Waystation, then undock and fly, their frames running on real
// time. A flies straight out of the Waystation's sphere of influence into its world's frame; B follows a little way
// behind. Each sees the other's ship, drawn where the other's own client had it (on its path, a fraction of a second
// behind), and B sees A cross into the planet's frame without a jump. Credentials are made up per run and exist only in
// the scratch database.

let online: Online;

test.beforeAll(async () => {
  online = await startOnline();
});

test.afterAll(async () => {
  await online?.stop();
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

/** A pilot of the Thalune in a browser of its own: signed up, entered, its snapshots echoing its input. */
async function pilot(browser: Browser, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
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
  return page;
}

/**
 * Takes the ship off its pad and sets it flying in the Waystation's frame at `pos`, nose turned `yaw` about the station's
 * up, at `speed` (flight assist holds it); from then the page's frames run on real time, each stepped by `__tick`, which
 * logs the ship's own pose and how the remote layer draws entity `other`.
 */
async function fly(page: Page, pos: number[], yaw: number, speed: number, other: number): Promise<void> {
  await page.evaluate(
    ({ pos, yaw, speed, other }) => {
      const w = window as unknown as Window & { __tick(): void; __log: unknown[]; __last: number };
      const g = w.game;
      const s = g.ship.state;
      g.station.releasePad(g.ship);
      g.ship.mode = 'flying';
      s.frame = g.station;
      s.pos.fromArray(pos);
      s.quat.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
      s.vel.set(0, 0, -speed).applyQuaternion(s.quat);
      g.ship.speed = speed;
      g.cam.frame = undefined;
      // the page's own loop no longer steps the game: __tick does, by the real time since the last
      const frame = g.frame.bind(g);
      g.frame = () => {};
      w.__log = [];
      w.__last = performance.now();
      w.__tick = function () {
        const now = performance.now();
        frame(Math.min(0.066, (now - w.__last) / 1000));
        w.__last = now;
        const key = (f: unknown) => (f === g.station ? 'station' : f === null ? 'inertial' : String(g.system.planets.indexOf(f)));
        const r = g.remotes.get(other);
        w.__log.push({
          t: g.time,
          // (the server's clock as the page reads it: world time may run up to 0.25 s ahead of it)
          ts: g.net.serverTime(),
          own: { frame: key(g.ship.state.frame), pos: g.ship.state.pos.toArray() },
          r: r && {
            tr: g.remotes.renderTime,
            status: r.status,
            shown: r.shown,
            drawn: r.drawn,
            hull: r.hull,
            frame: key(r.frame),
            pose: r.pose.pos.toArray(),
            // where it is drawn, in the Waystation's frame as it is now
            inStation: g.station.worldToLocal(r.world, r.world.clone()).toArray(),
          },
        });
      };
    },
    { pos, yaw, speed, other },
  );
}

interface Rec {
  t: number;
  ts: number;
  own: { frame: string; pos: number[] };
  r: { tr: number; status: string; shown: boolean; drawn: boolean; hull: string; frame: string; pose: number[]; inStation: number[] } | null;
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const len = (a: number[]) => Math.sqrt(dot(a, a));

/** Where on `track` (a ship's own poses by world time, in one frame) point `p` lies nearest: the distance and the time. */
function onTrack(track: { t: number; pos: number[] }[], p: number[]): { d: number; t: number } {
  let best = { d: Infinity, t: NaN };
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]!;
    const seg = sub(track[i]!.pos, a.pos);
    const l2 = dot(seg, seg);
    const u = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a.pos), seg) / l2)) : 0;
    const d = len(
      sub(
        p,
        a.pos.map((x, k) => x + seg[k]! * u),
      ),
    );
    if (d < best.d) best = { d, t: a.t + (track[i]!.t - a.t) * u };
  }
  return best;
}

/** The other's ship as `viewer` drew it in `frame`, against `owner`'s own track there: how far off its path, and how far
 * behind its own clock. */
function judge(viewer: Rec[], owner: Rec[], frame: string) {
  const track = owner.filter((x) => x.own.frame === frame).map((x) => ({ t: x.ts, pos: x.own.pos }));
  // (from half a second after the owner took off: the pad it left is a cut, held until it is due)
  const seen = viewer.filter((x) => x.r?.frame === frame && x.r.status === 'interpolate' && x.r.tr > track[0]!.t + 0.5 && x.r.tr < track.at(-1)!.t);
  const fits = seen.map((x) => {
    const at = onTrack(track, x.r!.pose);
    return { off: at.d, behind: x.r!.tr - at.t };
  });
  return { count: fits.length, off: Math.max(...fits.map((f) => f.off)), behind: fits.map((f) => f.behind).sort((a, b) => a - b) };
}

test("two clients each see the other's ship move, across a frame change", async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const a = await pilot(browser, errors);
  const b = await pilot(browser, errors);
  const ids = await Promise.all([a, b].map((p) => p.evaluate(() => window.game.net.entityId as number)));
  // docked side by side, each already sees the other's ship (a Lark: the snapshots name no hull)
  await until(b, `window.game.remotes.get(${ids[0]})?.shown === true`, 30_000);
  await until(a, `window.game.remotes.get(${ids[1]})?.shown === true`, 30_000);
  expect(await b.evaluate((id) => window.game.remotes.get(id).hull, ids[0])).toBe('lark');

  // A 4.4 km astern of the Waystation (its -z: +z leads along its orbit), flying straight out at 120 m/s (the sphere ends
  // at 4.5 km, 4.725 with the hysteresis; out of it the ship no longer rides with the Waystation, which draws away at its
  // orbital speed: ahead of it, the Waystation would catch the ship up and take it back); B 800 m behind A and off to one
  // side, following at 60 m/s
  await fly(a, [0, 60, -4400], 0, 120, ids[1]!);
  await fly(b, [-200, 30, -3600], 0, 60, ids[0]!);
  const end = Date.now() + 7000;
  while (Date.now() < end) await Promise.all([a, b].map((p) => p.evaluate(() => (window as unknown as { __tick(): void }).__tick())));
  const [logA, logB] = (await Promise.all([a, b].map((p) => p.evaluate(() => (window as unknown as { __log: Rec[] }).__log)))) as [Rec[], Rec[]];
  const planet = await a.evaluate(() => String(window.game.system.planets.indexOf(window.game.station.parent)));
  await Promise.all([a, b].map((p) => p.evaluate(() => window.game.net.close())));

  // both ran: frames of real time, the ships flying
  expect(logA.length).toBeGreaterThan(60);
  expect(logB.length).toBeGreaterThan(60);
  // A left the Waystation's sphere for its world's frame; B stayed in it
  expect(logA[0]!.own.frame).toBe('station');
  expect(logA.at(-1)!.own.frame).toBe(planet);
  expect(logB.at(-1)!.own.frame).toBe('station');

  // B saw A all the while, and in front of it, drawn; and A saw B (behind it, out of its view)
  const seenByB = logB.filter((x) => x.r);
  expect(seenByB.every((x) => x.r!.shown)).toBe(true);
  expect(seenByB.filter((x) => x.r!.drawn).length).toBeGreaterThan(seenByB.length * 0.8);
  expect(logA.filter((x) => x.r).every((x) => x.r!.shown)).toBe(true);

  // each saw the other move: A some 800 m, B some 400 m (in the Waystation's frame as drawn)
  const moved = (log: Rec[]) => {
    const r = log.filter((x) => x.r);
    return len(sub(r.at(-1)!.r!.inStation, r[0]!.r!.inStation));
  };
  expect(moved(logB)).toBeGreaterThan(500);
  expect(moved(logA)).toBeGreaterThan(250);

  // drawn where the other's own client had it: on its path within a metre, and at the time it was there to within the
  // tick and the trip (a snapshot labels the last pose the other's client reported with its tick's time); A in the
  // Waystation's frame and, after the change, in the planet's
  for (const [viewer, owner, frame] of [
    [logB, logA, 'station'],
    [logB, logA, planet],
    [logA, logB, 'station'],
  ] as const) {
    const j = judge(viewer, owner, frame);
    expect(j.count, `${frame}`).toBeGreaterThan(10);
    expect(j.off, `${frame}: off the path`).toBeLessThan(1);
    expect(j.behind[0]!, `${frame}: ahead of the ship`).toBeGreaterThan(-0.05);
    expect(j.behind[Math.floor(j.behind.length * 0.95)]!, `${frame}: behind the ship`).toBeLessThan(0.3);
  }

  // B drew A crossing into the planet's frame without a jump: in the Waystation's frame, A goes from riding with it at
  // 120 m/s to being left behind by it (the Waystation's orbit against the planet's turning frame: some 1,100 m/s), but
  // never jumps (the 60-120 m the frames move apart over the render delay, in one frame, would be ten thousand metres a
  // second and more). From half a second after A took off: its leap from the pad (a cut) is shown as the jump it is. (A
  // frame's step is the longer of its world time's and its render time's, which eases or jumps after a hitch.)
  const flying = seenByB.filter((x) => x.r!.tr > logA[0]!.ts + 0.5);
  const frames = flying.map((x) => x.r!.frame);
  expect(frames[0]).toBe('station');
  expect(frames.at(-1)).toBe(planet);
  let fastest = 0;
  for (let i = 1; i < flying.length; i++) {
    const dt = Math.max(flying[i]!.t - flying[i - 1]!.t, flying[i]!.r!.tr - flying[i - 1]!.r!.tr);
    if (dt > 0.003) fastest = Math.max(fastest, len(sub(flying[i]!.r!.inStation, flying[i - 1]!.r!.inStation)) / dt);
  }
  expect(fastest).toBeGreaterThan(300);
  expect(fastest).toBeLessThan(1500);
  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});
