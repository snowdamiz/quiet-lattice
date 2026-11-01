// Prediction and reconciliation (P1.E04.T03) under a bad network: the game's own client against a local server, its
// connection holding every message 100 ms each way and losing 2% of them each way (net/link.js, `?lag=100&loss=2`), on
// clocks the spec steps as movement-online.spec.ts does (P1.E16.T06): each 50 ms step moves the server's clock and the
// page's, runs the page's frames, and waits until the server has handled every input that went onto the wire, so load
// cannot skew the times the server judges. Snapshot by snapshot, the server's pose for the player's entity is judged
// against what the client sent for the same input, both in one frame at the tick's time: within 0.5 m in flight (out of
// the Waystation into its world's frame, boosting, on the pulse drive), on an empty Charge (the client refusing the engage
// itself) and on foot. Inputs the client sent before it took a correction, the old trajectory the server refuses, are
// not judged. Corrections: one the client never hears (lost: a snapshot tells it), blended with no frame showing it; one
// too large to blend, shown as the jump it is; the server refusing an engage the client mispredicted, the ship rewound to
// where the server holds it and carried on at its velocity, blended. Needs `pnpm db:up`.
import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { enterPicked, signUp, type Pilot } from './account.ts';
import { startOnline, type Online } from './online.ts';

const LAG_MS = 100;
const LOSS_PCT = 2;
const BUDGET_M = 0.5;
const STEP_MS = 50;
const FRAMES_PER_STEP = 2;

let online: Online;
test.beforeAll(async () => {
  online = await startOnline({ stepped: true });
});
test.afterAll(async () => {
  await online?.stop();
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    for (const l of online.serverOutput().split('\n')) if (/movement|meters/.test(l)) console.log('SERVER', l.slice(0, 600));
  await page.evaluate(() => (window as { game?: { net?: { close(): void } } }).game?.net?.close()).catch(() => {});
  await online.clock!.thaw();
  await page.waitForTimeout(200);
});

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + randomInt(26))).join('');
const newPilot = (): Pilot => ({
  username: `pred_${Date.now().toString(36)}${letters(4)}`,
  password: `pw-${randomBytes(9).toString('hex')}`,
  name: `Pred ${letters(1).toUpperCase()}${letters(7)}`,
});

/* eslint-disable @typescript-eslint/no-explicit-any -- the page's game is plain JS */
type W = Window & Record<string, any>;

/** Steps the game's frames while waiting for `pred` (setup, before play runs on the stepped clocks). */
async function until(page: Page, pred: string, timeout = 60_000) {
  await page.waitForFunction(
    (src) => {
      const g = (window as W).game;
      if (g) for (let i = 0; i < 2; i++) g.frame(1 / 60);
      return !!(0, eval)(src);
    },
    pred,
    { timeout, polling: 100 },
  );
}

/**
 * A new account and character entering the world through the bad network, what it sends and is sent logged (`watch`).
 * `stage` runs on the scratch database once the character exists and before it enters; `hold` keeps every input back
 * until `__hold` is cleared.
 */
async function enterNew(page: Page, seed: number, { stage, hold = false }: { stage?: (p: Pilot) => void; hold?: boolean } = {}) {
  await page.goto(`${online.url}/?lag=${LAG_MS}&loss=${LOSS_PCT}&seed=${seed}`);
  await page.waitForFunction(() => 'game' in window && 'step' in window && !!(window as W).game.netLink, null, { timeout: 60_000 });
  await until(page, 'window.game.menus.ready', 120_000);
  const p = newPilot();
  await signUp(page, p, 'thalune');
  stage?.(p);
  await page.evaluate((hold) => {
    const w = window as W;
    const g = w.game;
    w.__hold = hold;
    const orig = g.enterWorld.bind(g);
    g.enterWorld = (...a: unknown[]) => {
      orig(...a);
      const sample = g.net.input;
      g.net.input = () => (w.__hold ? null : sample());
      watch(g);
    };
    // (in the page: what went out, what came back, and each frame's mover, as drawn and as it stands)
    function watch(g: any) {
      const net = g.net;
      w.__inputs = new Map();
      w.__snaps = [];
      w.__corr = [];
      w.__heard = 0;
      w.__frames = [];
      w.__closed = null;
      net.on('input', (m: any) => w.__inputs.set(m.seq, { time: m.time, frame: m.pose.frame, pos: [...m.pose.pos], mode: m.mode }));
      net.on('snapshot', () => {
        const e = net.store.entities.get(net.entityId);
        // (after the game's own look at it, which may have taken a correction from it: the fence is past it then)
        if (e) w.__snaps.push({ ack: net.store.ack, time: net.store.time, frame: e.frame, pos: [...e.pos], mode: e.mode, fence: g.prediction.fence });
      });
      // every correction the game takes, heard or shown by a snapshot, and the mover where it put it
      net.on('correction', () => w.__heard++);
      const onCorrection = g.onCorrection.bind(g);
      g.onCorrection = (m: any) => {
        onCorrection(m);
        const st = g.mode === 'foot' ? g.player.state : g.ship.state;
        w.__corr.push({ seq: m.seq, mode: m.mode, pose: m.pose, at: g.time, pos: st.pos.toArray() });
      };
      net.on('closed', (why: unknown) => (w.__closed = why));
      const frame = g.frame.bind(g);
      g.frame = (dt: number) => {
        frame(dt);
        const m = g.mode === 'foot' ? g.player : g.ship;
        w.__frames.push({ t: g.time, c: w.__corr.length, foot: g.mode === 'foot', state: m.state.pos.toArray(), drawn: m.drawn.pos.toArray() });
        if (w.__frames.length > 4000) w.__frames.shift();
      };
    }
  }, hold);
  await enterPicked(page);
  await until(page, "window.game.net?.joined && window.game.mode !== 'title'", 120_000);
  if (!hold) await until(page, 'window.game.net.store.ack > 0 && window.game.net.store.entities.has(window.game.net.entityId)', 30_000);
  await page.evaluate(() => {
    const g = (window as W).game;
    g.input.fallbackLock = true;
    g.input.locked = true;
    document.dispatchEvent(new Event('pointerlockchange'));
  });
  return p;
}

/**
 * From here the server's clock and the page's move only when the spec moves them (movement-online.spec.ts's `freeze`): the
 * page's `performance.now`, which the net layer, the link, the input cadence and the frame loop run on, and its frames. Each
 * frame is preceded by the link delivering what is due; each step waits until the server has answered every input released
 * onto the wire. A fresh clock sample is taken on the stepped clocks (its round trip exactly the link's).
 */
async function freeze(page: Page) {
  await online.clock!.freeze();
  await page.evaluate(async () => {
    const w = window as W;
    let t = performance.now();
    performance.now = () => t;
    let loop: (() => void) | null = null;
    w.requestAnimationFrame = (cb) => {
      loop = cb as () => void;
      return 0;
    };
    while (!loop) await new Promise((r) => setTimeout(r, 4));
    w.__step = async (ms: number, frames: number) => {
      const g = w.game;
      const link = g.netLink;
      for (let i = 0; i < frames; i++) {
        t += ms / frames;
        link.pump();
        const frame = loop!;
        loop = null;
        frame();
      }
      link.pump();
      const deadline = Date.now() + 120_000;
      while (g.net?.state === 'joined' && link.stats.answered < link.stats.released && Date.now() < deadline) await new Promise((r) => setTimeout(r, 4));
    };
  });
  await play(page, 100);
  // (a ping or its pong may be among the 2% lost: another goes after a while)
  for (let i = 0; i < 60; i++) {
    if (i % 10 === 0)
      await page.evaluate(() => {
        const w = window as W;
        w.__sample ??= w.game.net.clock.samples.at(-1);
        w.game.net.ping();
      });
    await play(page, STEP_MS);
    if (await page.evaluate(() => (window as W).game.net.clock.samples.at(-1) !== (window as W).__sample)) return;
  }
  throw new Error('no clock sample came back on the stepped clocks');
}

/** `ms` of both clocks on, in 50 ms steps, each waiting for the server to handle the inputs it put on the wire. */
async function play(page: Page, ms: number, frames = FRAMES_PER_STEP) {
  for (let left = ms; left > 0; left -= STEP_MS) {
    await online.clock!.advance(Math.min(left, STEP_MS));
    await page.evaluate(([step, n]) => (window as W).__step(step!, n!), [Math.min(left, STEP_MS), frames]);
  }
}

/** Single frames until an input has just gone out (the inputs go every 50 ms, two frames apart, some three). */
async function playToInput(page: Page) {
  const seq = () => page.evaluate(() => (window as W).game.net.inputSeq as number);
  const was = await seq();
  for (let i = 0; i < 4 && (await seq()) === was; i++) await play(page, STEP_MS / FRAMES_PER_STEP, 1);
  expect(await seq(), 'no input went out in four frames').toBeGreaterThan(was);
}

async function holdFor(page: Page, keys: string[], ms: number) {
  for (const k of keys) await page.keyboard.down(k);
  await play(page, ms);
  for (const k of keys) await page.keyboard.up(k);
}

async function tap(page: Page, key: string) {
  await page.keyboard.down(key);
  await play(page, STEP_MS);
  await page.keyboard.up(key);
}

/**
 * The server's pose for the player's entity, each snapshot, against what the client sent for the input it says it handled:
 * the largest distance, how many were judged, the worst, and how many inputs went out in each mode and frame. A pose the
 * server holds in another frame than the client sent it in was re-expressed by the zone at the edge of a sphere, at the
 * tick that applied it (or a later one, its pose standing still as the frames moved): it is judged re-expressed back with
 * both frames as they stood at the first tick that showed it so, and kept apart (`edge`), with how fast the two frames
 * move apart there (a tick off, a twentieth of that).
 */
async function judge(page: Page) {
  return page.evaluate(async () => {
    const w = window as W;
    const g = w.game;
    const framesUrl = '/src/remote/frames.js';
    const poseUrl = '/src/net/pose.js';
    const { framesApartAt, reframeAt } = await import(/* @vite-ignore */ framesUrl);
    const { frameOfId } = await import(/* @vite-ignore */ poseUrl);
    const v = g.ship.state.pos;
    const same = { max: 0, judged: 0, worst: null as unknown };
    const edge = { max: 0, judged: 0, apart: 0, worst: null as unknown };
    const first = new Map<string, number>();
    for (const s of w.__snaps) if (!first.has(`${s.ack}|${s.frame}`)) first.set(`${s.ack}|${s.frame}`, s.time);
    for (const s of w.__snaps) {
      if (s.ack <= s.fence) continue;
      const sent = w.__inputs.get(s.ack);
      const from = frameOfId(g.system, g.station, s.frame);
      const to = sent && frameOfId(g.system, g.station, sent.frame);
      if (!sent || from === undefined || to === undefined) continue;
      const server = { pos: v.clone().fromArray(s.pos), quat: g.ship.state.quat.clone(), vel: v.clone() };
      const at = from === to ? s.time : first.get(`${s.ack}|${s.frame}`);
      reframeAt(server, from, to, at);
      const d = server.pos.distanceTo(v.clone().fromArray(sent.pos));
      const b = from === to ? same : edge;
      b.judged++;
      if (b === edge)
        edge.apart = Math.max(edge.apart, framesApartAt(from, to, (to ? to.localToWorld(server.pos.clone(), v.clone()) : server.pos.clone()) as unknown));
      if (d > b.max) [b.max, b.worst] = [d, { ack: s.ack, d, mode: s.mode, sentMode: sent.mode, frame: s.frame, sentFrame: sent.frame }];
    }
    const sentIn: Record<string, number> = {};
    for (const i of w.__inputs.values()) sentIn[`${i.mode}@${i.frame}`] = (sentIn[`${i.mode}@${i.frame}`] ?? 0) + 1;
    return { ...same, edge, sentIn, link: { ...g.netLink.stats }, rtt: Math.min(...g.net.clock.samples.map((x: { rtt: number }) => x.rtt)) };
  });
}

async function state(page: Page) {
  return page.evaluate(() => {
    const w = window as W;
    return { corrections: w.__corr.length, closed: w.__closed, state: w.game.net?.state, unheard: w.game.prediction.stats.unheard };
  });
}

/**
 * How the mover was drawn at the frame the `n`th correction was taken (the first frame whose count reached `n`): how far
 * its standing pose jumped beyond its own motion, how far the drawn pose's step strayed from the last (the jump showing on
 * screen), the largest such stray over the next second, and how far drawn and standing poses still were apart then.
 */
async function drawnAt(page: Page, n: number) {
  return page.evaluate((n) => {
    const f = (window as W).__frames as { c: number; state: number[]; drawn: number[] }[];
    const i = f.findIndex((x) => x.c >= n);
    if (i < 2) return null;
    const sub = (a: number[], b: number[]) => a.map((x, k) => x - b[k]!);
    const len = (a: number[]) => Math.hypot(...a);
    const stray = (key: 'state' | 'drawn', j: number) => len(sub(sub(f[j]![key], f[j - 1]![key]), sub(f[j - 1]![key], f[j - 2]![key])));
    let after = 0;
    for (let j = i; j < Math.min(f.length, i + 80); j++) after = Math.max(after, stray('drawn', j));
    const end = f[Math.min(f.length - 1, i + 80)]!;
    return { jump: stray('state', i), shown: stray('drawn', i), after, apart: len(sub(f[i]!.drawn, f[i]!.state)), apartAfter: len(sub(end.drawn, end.state)) };
  }, n);
}

async function teleport(page: Page, frame: string, pos: number[], mode: string) {
  const [characterId, system] = await page.evaluate(() => {
    const g = (window as W).game;
    return [g.net.characterId as string, g.galaxy.systems.findIndex((s: { seed: number }) => s.seed === g.net.zone.systemSeed) as number];
  });
  const done = await online.admin({ cmd: 'teleport', character: characterId, system, frame, pose: pos.map((x) => x.toFixed(3)).join(','), mode });
  expect(done, JSON.stringify(done)).toMatchObject({ ok: true });
}

function expectAgreed(j: Awaited<ReturnType<typeof judge>>, when: string) {
  expect(j.max, `${when}: the worst ${JSON.stringify(j.worst)}`).toBeLessThan(BUDGET_M);
  expect(j.edge.max, `${when}: at a sphere's edge, the worst ${JSON.stringify(j.edge.worst)}`).toBeLessThan(BUDGET_M + j.edge.apart / 20);
  // (and the network was as bad as it says)
  expect(j.rtt, when).toBeGreaterThanOrEqual(2 * LAG_MS - 1);
  expect(j.link.lostOut, when).toBeGreaterThan(0);
  expect(j.link.lostIn, when).toBeGreaterThan(0);
}

test('in flight: out of the Waystation into its world’s frame, boosting and on the pulse drive, within 0.5 m of the server', async ({ page }) => {
  test.setTimeout(600_000);
  await enterNew(page, 11);
  await freeze(page);
  await play(page, 2000);
  await holdFor(page, ['KeyE'], 100);
  await play(page, 3000);
  await holdFor(page, ['Space'], 1500);
  await holdFor(page, ['KeyW'], 6000);
  await play(page, 8000);
  await holdFor(page, ['ShiftLeft'], 4000);
  await play(page, 4000);
  await tap(page, 'KeyJ');
  await play(page, 5000);
  // (the drop-out is the frame after an input went out, so it falls between two of them)
  await playToInput(page);
  await tap(page, 'KeyJ');
  await play(page, 3000);
  const j = await judge(page);
  console.log('flight', JSON.stringify(j));
  expectAgreed(j, 'in flight');
  expect(j.judged).toBeGreaterThan(500);
  // out of the Waystation's frame into its world's, and on the pulse drive the server accepted
  const seed = await page.evaluate(() => (window as W).game.system.seed);
  expect(j.sentIn[`ship@${seed}:station`]).toBeGreaterThan(20);
  expect(j.sentIn[`pulse@${seed}:station`] ?? 0).toBe(0);
  expect(Object.keys(j.sentIn).some((k) => k.startsWith('pulse@') && (j.sentIn[k] ?? 0) > 40)).toBe(true);
  expect(Object.keys(j.sentIn).some((k) => k.startsWith('ship@') && !k.endsWith(':station'))).toBe(true);
  expect(await state(page)).toEqual({ corrections: 0, closed: null, state: 'joined', unheard: 0 });
});

test('on an empty Charge in its world’s shadow: the engage refused by the client, corrections blended or shown, a mispredicted engage rewound', async ({
  page,
}) => {
  test.setTimeout(600_000);
  // a Charge stored empty, and no input until the ship is in the home world's shadow, where none comes back
  await enterNew(page, 23, {
    hold: true,
    stage: (p) =>
      online.sql(
        `UPDATE characters SET state = state || '{"meters": {"v": 1, "data": {"heat": 0, "overheated": false, "charge": 0, "at": 0}}}'::jsonb WHERE name = '${p.name}'`,
      ),
  });
  // four of its radii out on its night side, on the line from the star, in its frame
  const at = await page.evaluate(() => {
    const g = (window as W).game;
    const planet = g.station.parent;
    const away = planet.position.clone().sub(g.system.star.position).normalize();
    const local = planet.dirToLocal(away, away.clone()).multiplyScalar(planet.radius * 4);
    return {
      body: String(g.system.planets.indexOf(planet)),
      pos: local.toArray() as number[],
      out: planet.dirToLocal(planet.position.clone().sub(g.system.star.position).normalize(), away.clone()).toArray() as number[],
    };
  });
  const placed = `window.game.ship.mode === 'flying' && window.game.ship.state.pos.distanceTo(window.game.ship.state.pos.clone().fromArray(${JSON.stringify(at.pos)})) < 1`;
  // (its correction may be the 2% lost, and with no input yet no snapshot can tell of it: then again)
  for (let i = 0; i < 3 && !(await page.evaluate((p) => !!(0, eval)(p), placed)); i++) {
    await teleport(page, at.body, at.pos, 'ship');
    await until(page, placed, 5000).catch(() => {});
  }
  await until(page, placed, 1000);
  // nose out along the shadow, still; then the inputs go
  await page.evaluate((out) => {
    const w = window as W;
    const g = w.game;
    const s = g.ship.state;
    const dir = s.pos.clone().fromArray(out).normalize();
    s.quat.setFromUnitVectors(s.pos.clone().set(0, 0, -1), dir);
    s.vel.set(0, 0, 0);
    g.ship.speed = 0;
    g.cam.frame = undefined;
    w.__meters = [];
    g.net.on('meters', (m: { meters: { charge: number } }) => w.__meters.push(m.meters.charge));
    w.__corr = [];
    w.__heard = 0;
    w.__frames = [];
    w.__hold = false;
  }, at.out);
  await until(page, 'window.game.net.store.ack > 0 && window.__meters.length > 0 && window.game.ship.charge === 0', 30_000);
  await freeze(page);
  await play(page, 1000);
  const before = await state(page);
  expect(before).toMatchObject({ corrections: 0, closed: null, state: 'joined' });

  // 3 m aside, the correction lost on the way: a snapshot shows it, and it is blended
  const here = await page.evaluate(() => (window as W).game.ship.state.pos.toArray() as number[]);
  await page.evaluate(() => (window as W).game.netLink.dropNext('correction'));
  await teleport(page, at.body, [here[0]! + 3, here[1]!, here[2]!], 'ship');
  // (a tick goes out first: the inputs on their way from 3 m back fit the pose, and once they land the server holds them)
  await page.waitForTimeout(200);
  await play(page, 1500);
  expect(await state(page)).toMatchObject({ corrections: 1, unheard: 1 });
  const small = (await drawnAt(page, 1))!;
  console.log('small', JSON.stringify(small));
  expect(small.jump).toBeGreaterThan(2.5);
  expect(small.shown).toBeLessThan(0.25 * small.jump);
  expect(small.after).toBeLessThan(0.25 * small.jump);
  expect(small.apartAfter).toBeLessThan(0.05);

  // 2 km on along the shadow: more than a blend explains, shown as the jump it is
  const there = await page.evaluate(() => (window as W).game.ship.state.pos.toArray() as number[]);
  const far = there.map((x, k) => x + at.out[k]! * 2000);
  await teleport(page, at.body, far, 'ship');
  await play(page, 1500);
  expect(await state(page)).toMatchObject({ corrections: 2 });
  const large = (await drawnAt(page, 2))!;
  console.log('large', JSON.stringify(large));
  expect(large.jump).toBeGreaterThan(1900);
  expect(large.apart).toBeLessThan(1e-6);

  // under way, the pilot engages: the client holds its Charge empty and refuses it itself
  await holdFor(page, ['KeyW'], 2500);
  await play(page, 2000);
  await tap(page, 'KeyJ');
  await play(page, 2000);
  expect(await page.evaluate(() => (window as W).game.ship.mode)).toBe('flying');
  expect(await state(page)).toMatchObject({ corrections: 2, closed: null, state: 'joined' });
  const refused = await judge(page);
  console.log('refused', JSON.stringify(refused));
  expectAgreed(refused, 'on an empty Charge');
  expect(Object.keys(refused.sentIn).some((k) => k.startsWith('pulse@'))).toBe(false);

  // the client thinks it has Charge (a prediction gone wrong): it engages, the server refuses, and the ship is rewound to
  // where the server holds it as of the refused input, carried on at its velocity, its jump blended
  await page.evaluate(() => ((window as W).game.ship.charge = 50));
  await tap(page, 'KeyJ');
  await play(page, 2500);
  const after = await page.evaluate(() => {
    const w = window as W;
    return { corr: w.__corr.at(-1), shipMode: w.game.ship.mode, charge: w.game.ship.charge, sent: w.__inputs.get(w.__corr.at(-1)?.seq) };
  });
  expect(await state(page)).toMatchObject({ corrections: 3, closed: null, state: 'joined' });
  expect(after.sent?.mode).toBe('pulse');
  expect(after.corr.mode).toBe('ship');
  expect(after.shipMode).toBe('flying');
  expect(after.charge).toBe(0);
  const carried = after.corr.pose.pos.map((x: number, k: number) => x + after.corr.pose.vel[k] * (after.corr.at - after.sent.time));
  const off = Math.hypot(...carried.map((x: number, k: number) => x - after.corr.pos[k]));
  console.log('rewound', JSON.stringify({ off, speed: Math.hypot(...after.corr.pose.vel), since: after.corr.at - after.sent.time }));
  expect(off).toBeLessThan(BUDGET_M);
  const engage = (await drawnAt(page, 3))!;
  console.log('engage', JSON.stringify(engage));
  expect(engage.jump).toBeGreaterThan(5);
  expect(engage.shown).toBeLessThan(0.25 * engage.jump);
  expect(engage.apartAfter).toBeLessThan(0.05);
  await play(page, 2000);
  const j = await judge(page);
  console.log('shadow', JSON.stringify(j));
  expectAgreed(j, 'after the rewind');
  expect(await state(page)).toMatchObject({ corrections: 3, closed: null, state: 'joined' });
});

test('on foot in the hangar: walking, sprinting and jumping within 0.5 m, a small correction blended and a large one shown', async ({ page }) => {
  test.setTimeout(600_000);
  await enterNew(page, 37);
  await freeze(page);
  await play(page, 1500);
  await tap(page, 'KeyF');
  await play(page, 2000);
  expect(await page.evaluate(() => (window as W).game.mode)).toBe('foot');
  await holdFor(page, ['KeyW'], 2000);
  await holdFor(page, ['ShiftLeft', 'KeyW'], 2000);
  await tap(page, 'Space');
  await play(page, 1500);
  await holdFor(page, ['KeyA'], 1000);
  await play(page, 2000);
  const walked = await judge(page);
  console.log('walked', JSON.stringify(walked));
  expectAgreed(walked, 'on foot');
  expect(walked.judged).toBeGreaterThan(150);
  expect(Object.keys(walked.sentIn).some((k) => k.startsWith('foot@') && (walked.sentIn[k] ?? 0) > 150)).toBe(true);
  expect(await state(page)).toEqual({ corrections: 0, closed: null, state: 'joined', unheard: 0 });

  const here = await page.evaluate(() => (window as W).game.player.state.pos.toArray() as number[]);
  await teleport(page, 'station', [here[0]! + 1.5, here[1]!, here[2]!], 'foot');
  await play(page, 1500);
  const small = (await drawnAt(page, 1))!;
  console.log('small', JSON.stringify(small));
  expect(small.jump).toBeGreaterThan(1.2);
  expect(small.shown).toBeLessThan(0.25 * small.jump);
  expect(small.after).toBeLessThan(0.25 * small.jump);
  expect(small.apartAfter).toBeLessThan(0.05);

  // 40 m across the hangar's floor
  await teleport(page, 'station', [here[0]! - 40 * Math.sign(here[0]!), here[1]!, here[2]!], 'foot');
  await play(page, 1500);
  const large = (await drawnAt(page, 2))!;
  console.log('large', JSON.stringify(large));
  expect(large.jump).toBeGreaterThan(35);
  expect(large.apart).toBeLessThan(1e-6);
  await play(page, 1500);
  const j = await judge(page);
  expectAgreed(j, 'on foot after the corrections');
  expect(await state(page)).toMatchObject({ corrections: 2, closed: null, state: 'joined' });
});
