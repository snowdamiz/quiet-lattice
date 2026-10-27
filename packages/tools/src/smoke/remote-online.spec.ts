import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { startOnline, type Online } from './online.ts';

// Remote entities (P1.E04.T02) between two clients, as players run it (online.ts: a scratch database, the server, Vite):
// two pilots sign up and enter, docked at the same home Waystation, then take off and are moved out past the
// Waystation by the admin channel's teleport (movement authority re-seats them there, as an operator's teleport does),
// and fly, their frames running on real time. A flies straight out of the Waystation's sphere of influence into its
// world's frame; B follows a little way behind. Each sees the other's ship, drawn where the other's own client had it (on its path, a fraction of a second
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
 * Takes the ship off its pad (its inputs say so), then has the server teleport it to `pos` in the Waystation's frame, in
 * flight, and waits for the correction that carries it there (the ship then held still where it put it, so nothing it
 * was doing as it hung in the hangar carries it off before it flies).
 */
async function place(page: Page, pos: number[]): Promise<void> {
  await page.evaluate((pos) => {
    const w = window as unknown as Window & { __placed: boolean };
    const g = w.game;
    w.__placed = false;
    g.net.on('correction', (m: { pose: { pos: number[] } }) => {
      if (w.__placed || Math.hypot(m.pose.pos[0]! - pos[0]!, m.pose.pos[1]! - pos[1]!, m.pose.pos[2]! - pos[2]!) > 1) return;
      // (Game.onCorrection, which listened first, has put the ship there)
      g.ship.mode = 'flying';
      g.ship.dockPad = null;
      g.ship.state.vel.set(0, 0, 0);
      g.ship.speed = 0;
      w.__placed = true;
    });
    g.station.releasePad(g.ship);
    g.ship.mode = 'flying';
  }, pos);
  await until(page, "window.game.net.store.entities.get(window.game.net.entityId)?.mode === 'ship'", 30_000);
  const [characterId, system] = await page.evaluate(() => [
    window.game.net.characterId as string,
    window.game.galaxy.systems.findIndex((s: { seed: number }) => s.seed === window.game.net.zone.systemSeed) as number,
  ]);
  const done = await online.admin({ cmd: 'teleport', character: characterId, system, frame: 'station', pose: pos.join(','), mode: 'ship' });
  expect(done, JSON.stringify(done)).toMatchObject({ ok: true });
  await until(page, 'window.__placed', 30_000);
}

/**
 * Sets the ship, where the teleport put it, flying nose turned `yaw` about the station's up at `speed` (flight assist
 * holds it; the docking autopilot, which took it as it hung in the hangar, lets go); from then the page's frames run on real time, each stepped by `__tick`, which logs the ship's own pose and
 * how the remote layer draws entity `other`.
 */
async function fly(page: Page, yaw: number, speed: number, other: number): Promise<void> {
  await page.evaluate(
    async ({ yaw, speed, other }) => {
      const w = window as unknown as Window & { __tick(): void; __log: unknown[]; __sent: unknown[]; __last: number; __corrections: number };
      const g = w.game;
      const s = g.ship.state;
      const poseUrl = '/src/net/pose.js';
      const { frameOfId } = await import(/* @vite-ignore */ poseUrl);
      const key = (f: unknown) => (f === g.station ? 'station' : f === null ? 'inertial' : String(g.system.planets.indexOf(f)));
      // what the server sent of the other's ship and of this one, tick by tick: the tick's time, and the pose
      w.__sent = [];
      g.net.on('snapshot', () => {
        const pose = (e: { frame: string | null; pos: number[] } | undefined) => e && { frame: key(frameOfId(g.system, g.station, e.frame)), pos: [...e.pos] };
        w.__sent.push({ t: g.net.store.time, other: pose(g.net.store.entities.get(other)), own: pose(g.net.store.entities.get(g.net.entityId)) });
      });
      g.ship.mode = 'flying';
      g.ship.dockPad = null;
      // (movement authority, which the teleport re-seated there, takes every input from now on)
      w.__corrections = 0;
      g.net.on('correction', () => w.__corrections++);
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
        // (up to half a second: on a busy machine the pages' frames run long, and clamped as the game's own loop clamps
        // them the ships would fall behind their clocks, moving less than their velocities say; the remote layer's
        // handling of such a client is the unit tests')
        frame(Math.min(0.5, (now - w.__last) / 1000));
        w.__last = now;
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
    { yaw, speed, other },
  );
}

interface Rec {
  t: number;
  ts: number;
  own: { frame: string; pos: number[] };
  r: { tr: number; status: string; shown: boolean; drawn: boolean; hull: string; frame: string; pose: number[]; inStation: number[] } | null;
}

interface Sent {
  t: number;
  other?: { frame: string; pos: number[] };
  own?: { frame: string; pos: number[] };
}

/** How far before the tick that carried it the remote layer may take a pose to have been (buffer.js SKEW_LEAD_S), and
 * after it (SKEW_S). */
const SKEW_LEAD_S = 0.1;
const SKEW_S = 0.15;

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

/** The ship the server sent tick by tick in `frame`, each pose with its tick's time (a pose sent again, its client's next
 * report not yet in, left out as the remote layer leaves it). */
function sentTrack(sent: Sent[], which: 'other' | 'own', frame: string) {
  const track: { t: number; pos: number[] }[] = [];
  for (const s of sent) {
    const e = s[which];
    if (!e || e.frame !== frame) continue;
    const last = track.at(-1);
    if (last && len(sub(e.pos, last.pos)) === 0) continue;
    track.push({ t: s.t, pos: e.pos });
  }
  return track;
}

/** The other's ship as `viewer` drew it in `frame`, against what the server sent of it there (`sent`, the viewer's own
 * snapshots): how far off that path, and how far behind the ticks that carried it (by the render time). */
function judge(viewer: Rec[], sent: Sent[], frame: string) {
  const track = sentTrack(sent, 'other', frame);
  // (from half a second after the first pose in the frame: the pad it left before is a cut, held until it is due, and
  // the poses re-expressed from the frame before are not on this path)
  const seen = viewer.filter((x) => x.r?.frame === frame && x.r.status === 'interpolate' && x.r.tr > track[0]!.t + 0.5 && x.r.tr < track.at(-1)!.t);
  const fits = seen.map((x) => {
    const at = onTrack(track, x.r!.pose);
    return { off: at.d, behind: x.r!.tr - at.t };
  });
  return { count: fits.length, off: Math.max(...fits.map((f) => f.off)), behind: fits.map((f) => f.behind).sort((a, b) => a - b) };
}

/** How far ahead of the server's clock `owner`'s own estimate of it ran, at most (s): each pose it sent was taken before
 * the tick that carried it, so by its own clock it was there at most the tick's time. */
function clockAhead(owner: Rec[], sent: Sent[], frame: string): number {
  const track = owner.filter((x) => x.own.frame === frame).map((x) => ({ t: x.ts, pos: x.own.pos }));
  let ahead = -Infinity;
  for (const s of sentTrack(sent, 'own', frame)) {
    const at = onTrack(track, s.pos);
    if (at.d < 0.5) ahead = Math.max(ahead, at.t - s.t);
  }
  return ahead;
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
  await place(a, [0, 60, -4400]);
  await place(b, [-200, 30, -3600]);
  await fly(a, 0, 120, ids[1]!);
  await fly(b, 0, 60, ids[0]!);
  const end = Date.now() + 7000;
  while (Date.now() < end) await Promise.all([a, b].map((p) => p.evaluate(() => (window as unknown as { __tick(): void }).__tick())));
  // (all read before the sockets close: a closed connection leaves the world, which reloads the page)
  const [[logA, sentA, corrA], [logB, sentB, corrB]] = (await Promise.all(
    [a, b].map((p) =>
      p.evaluate(() => {
        const w = window as unknown as { __log: Rec[]; __sent: Sent[]; __corrections: number };
        return [w.__log, w.__sent, w.__corrections];
      }),
    ),
  )) as [[Rec[], Sent[], number], [Rec[], Sent[], number]];
  const planet = await a.evaluate(() => String(window.game.system.planets.indexOf(window.game.station.parent)));
  await Promise.all([a, b].map((p) => p.evaluate(() => window.game.net.close())));

  // both ran: frames of real time, the ships flying, as movement authority judged them
  expect([corrA, corrB]).toEqual([0, 0]);
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

  // drawn where the server sent it: on its path within a metre, and at its pose of the tick the render time names, up to
  // the remote layer's estimate of when each pose was taken (a snapshot labels the last pose the other's client reported
  // with its tick's time; the layer takes it to have been up to SKEW_LEAD_S earlier or SKEW_S later, by its motion); A in
  // the Waystation's frame and, after the change, in the planet's. (Judged against the ticks, not the other client's
  // own clock: that is its estimate of the server's, which a busy page's late pings leave tens of milliseconds off.)
  const report: string[] = [];
  for (const [viewer, sent, owner, ownerSent, frame] of [
    [logB, sentB, logA, sentA, 'station'],
    [logB, sentB, logA, sentA, planet],
    [logA, sentA, logB, sentB, 'station'],
  ] as const) {
    const j = judge(viewer, sent, frame);
    report.push(
      `${frame}: ${j.count} drawn, ${j.behind[0]!.toFixed(3)}..${j.behind.at(-1)!.toFixed(3)} s behind the ticks; its own clock up to ${clockAhead(owner, ownerSent, frame).toFixed(3)} s ahead of the server's`,
    );
    expect(j.count, `${frame}`).toBeGreaterThan(10);
    expect(j.off, `${frame}: off the path`).toBeLessThan(1);
    expect(j.behind[0]!, `${frame}: ahead of the ticks`).toBeGreaterThan(-SKEW_LEAD_S - 0.02);
    expect(j.behind[Math.floor(j.behind.length * 0.95)]!, `${frame}: behind the ticks`).toBeLessThan(SKEW_S + 0.05);
  }
  console.log(`remote-online: ${report.join('; ')}`);

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
