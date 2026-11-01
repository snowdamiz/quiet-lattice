import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { enterPicked, signUp } from './account.ts';
import { startOnline, type Online } from './online.ts';

// Resource nodes from the server's state (P1.E13.T06), between two clients as players run them (online.ts: a scratch
// database, the server on a clock the spec steps, Vite). Two pilots are put on foot on their home world a few metres from
// one resource node and hold their beams on it. Each draws the node from the shared scatter, sends its hits as requests,
// and shows it gone once the server says so: both see it vanish, a client never asks for it while it is gone, and both see
// it back once it has grown back. The server's clock and the pages' are the spec's to step (as in movement-online.spec.ts),
// so the beam's seconds and the node's minutes pass exactly as meant.

let online: Online;

test.beforeAll(async () => {
  online = await startOnline({ stepped: true });
});

test.afterAll(async () => {
  await online?.stop();
});

const t0 = Date.now();
const log = (...a: unknown[]) => process.env.MINING_LOG && console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
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

/** A pilot of the Thalune in a browser of its own: signed up, entered and out of its ship on foot in the hangar. */
async function pilot(browser: Browser, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${online.url}/`);
  await page.waitForFunction(() => 'game' in window && 'step' in window, null, { timeout: 60_000 });
  await until(page, 'window.game.menus.ready', 120_000);
  await signUp(
    page,
    {
      username: `mine_${Date.now().toString(36)}${letters(4)}`,
      password: `pw-${randomBytes(9).toString('hex')}`,
      name: `Miner ${letters(1).toUpperCase()}${letters(7)}`,
    },
    'thalune',
  );
  await enterPicked(page);
  await until(page, "window.game.net?.joined && window.game.mode !== 'title'", 120_000);
  await until(page, 'window.game.net.store.ack > 0 && window.game.net.store.entities.has(window.game.net.entityId)', 30_000);
  await page.evaluate(() => {
    if (window.game.mode === 'ship' && window.game.ship.mode === 'landed') window.game.exitShip();
  });
  await until(page, "window.game.mode === 'foot' && window.game.net.store.entities.get(window.game.net.entityId)?.mode === 'foot'", 30_000);
  return page;
}

/** Puts the pilot on foot at `pose` ('surface:<lat>,<lon>' or 'x,y,z', planet-local) on its home world and waits for the
 * correction that carries it there. */
async function stand(page: Page, pose: string): Promise<void> {
  const [characterId, system, frame] = await page.evaluate(() => {
    const g = window.game;
    return [
      g.net.characterId as string,
      g.galaxy.systems.findIndex((s: { seed: number }) => s.seed === g.net.zone.systemSeed) as number,
      `${g.system.seed}:${g.system.planets.indexOf(g.system.homePlanet)}`,
    ];
  });
  await page.evaluate(() => {
    const w = window as unknown as Window & { __corrected: number };
    w.__corrected = 0;
    window.game.net.on('correction', () => w.__corrected++);
  });
  const done = await online.admin({ cmd: 'teleport', character: characterId, system, frame, pose, mode: 'foot' });
  expect(done, JSON.stringify(done)).toMatchObject({ ok: true });
  await until(page, 'window.__corrected > 0', 30_000);
}

interface Found {
  id: string;
  pos: number[];
  hp: number;
  type: string;
}

/** The sturdiest resource node within reach of the pilot's scatter, once the flora has put its cells down. */
async function nodeNear(page: Page): Promise<Found | null> {
  await until(page, 'window.game.flora.planet && window.game.pool.pending() === 0', 60_000);
  return page.evaluate(() => {
    const g = window.game;
    const f = g.flora;
    const here = g.player.state.pos;
    const nodes = [...f.instancesNear(here, 250, (sp: { node?: string }) => sp.node)];
    nodes.sort((a, b) => b.sp.hp - a.sp.hp || a.pos.distanceTo(here) - b.pos.distanceTo(here));
    const n = nodes[0];
    return n ? { id: f.mineTarget(n).node, pos: n.pos.toArray(), hp: n.sp.hp, type: n.sp.node } : null;
  });
}

/** A point on the ground `along` metres from `pos` (planet-local), across the slope, as 'x,y,z'. */
async function groundBeside(page: Page, pos: number[], along: number): Promise<string> {
  return page.evaluate(
    ({ pos, along }) => {
      const g = window.game;
      const V = g.cam.pos.constructor;
      const n = new V(...pos);
      const up = n.clone().normalize();
      const side = new V(0, 1, 0).cross(up);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const dir = n.clone().addScaledVector(side, along).normalize();
      return dir
        .multiplyScalar(g.system.homePlanet.groundRadius(dir) + 0.3)
        .toArray()
        .join(',');
    },
    { pos, along },
  );
}

type Stepped = Window & { __advance(ms: number): void; __step(ms: number, frames: number): Promise<void> };

/**
 * From here the server's clock and the page's move only when the spec moves them (movement-online.spec.ts): the page's
 * `performance.now` stands still, its frames are the spec's to call, and a fresh clock sample is taken at the standstill.
 */
async function freeze(page: Page): Promise<void> {
  await online.clock!.freeze();
  log('server clock frozen');
  await page.evaluate(async () => {
    const w = window as unknown as Stepped & { game: { net: { ping(): void; on(type: string, fn: () => void): () => void } } };
    let t = performance.now();
    performance.now = () => t;
    w.__advance = (ms) => {
      t += ms;
    };
    // (the game's own loop stops here; a page that is not in front is not given animation frames to wait for, so
    // `__step` runs the game's frames itself)
    w.requestAnimationFrame = () => 0;
    w.__step = async (ms, frames) => {
      const g = window.game;
      for (let i = 0; i < frames; i++) {
        t += ms / frames;
        g.frame(Math.min(0.066, ms / frames / 1000));
      }
      const deadline = Date.now() + 120_000;
      while (g.net?.state === 'joined' && g.net.store.ack < g.net.inputSeq && Date.now() < deadline) await new Promise((r) => setTimeout(r, 4));
    };
    // (a sample whose round trip is nothing wins the clock's estimate; its samples are kept eight at a time, so wait for the pong)
    await new Promise<void>((resolve) => {
      const off = w.game.net.on('pong', () => {
        off();
        resolve();
      });
      w.game.net.ping();
    });
  });
  log('page frozen');
}

/** `ms` of the server's clock and every page's on, in 50 ms steps of two frames, each waiting for the server to have handled
 * the inputs they sent. */
async function play(pages: Page[], ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 50) {
    const step = Math.min(left, 50);
    await online.clock!.advance(step);
    await Promise.all(pages.map((p) => p.evaluate((s) => (window as unknown as Stepped).__step(s, 2), step)));
  }
}

/** `ms` pass with no frame run and no input sent. */
async function stall(pages: Page[], ms: number, chunk = 10_000): Promise<void> {
  for (let left = ms; left > 0; left -= chunk) {
    const step = Math.min(left, chunk);
    await online.clock!.advance(step);
    await Promise.all(pages.map((p) => p.evaluate((s) => (window as unknown as Stepped).__advance(s), step)));
  }
}

/** Plays on until the expression holds in every page, or `limitMs` of play has passed. */
async function playUntil(pages: Page[], pred: string, limitMs: number): Promise<boolean> {
  for (let left = limitMs; left > 0; left -= 100) {
    const held = await Promise.all(pages.map((p) => p.evaluate((src) => !!(0, eval)(src), pred)));
    if (held.every(Boolean)) return true;
    await play(pages, 100);
    // (the sweep that tells the pages runs on real time)
    await new Promise((r) => setTimeout(r, 30));
  }
  return false;
}

/** Turns the pilot to look at the node and holds its beam button down (or lets it go). */
async function aim(page: Page, node: Found, beam: boolean): Promise<void> {
  await page.evaluate(
    ({ node, beam }) => {
      const g = window.game;
      const p = g.player;
      const V = g.cam.pos.constructor;
      const inst = [...g.flora.instancesNear(new V(...node.pos), 3, (sp: { node?: string }) => sp.node)].find((i) => g.flora.mineTarget(i).node === node.id);
      const target = inst ? inst.pos.clone().addScaledVector(inst.up, inst.sp.height * inst.scale * 0.35) : new V(...node.pos);
      const up = p.state.pos.clone().normalize();
      const to = target.sub(p.state.pos.clone().addScaledVector(up, 1.7));
      const heading = to.clone().addScaledVector(up, -to.dot(up)).normalize();
      p.heading.copy(heading);
      p.pitch = Math.asin(Math.max(-1, Math.min(1, to.clone().normalize().dot(up))));
      g.input.fallbackLock = true;
      g.input.locked = true;
      window.dev.button(0, beam);
    },
    { node, beam },
  );
}

test('two clients mine one node: both see it vanish, neither asks for it while it is gone, both see it grow back', async ({ browser }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  const a = await pilot(browser, errors);
  log('pilot a in');
  const b = await pilot(browser, errors);
  log('pilot b in');

  // a node on the home world, found in the first pilot's scatter
  let node: Found | null = null;
  for (const spot of ['surface:0,0', 'surface:25,40', 'surface:-30,110', 'surface:50,-70', 'surface:-10,-150', 'surface:70,20']) {
    await stand(a, spot);
    log('stood at', spot);
    node = await nodeNear(a);
    log('node', node);
    if (node) break;
  }
  expect(node, 'a resource node near one of the spots').not.toBeNull();
  const found = node!;

  await stand(a, await groundBeside(a, found.pos, 6));
  await stand(b, await groundBeside(a, found.pos, -6));
  log('both beside the node');
  const sees = `[...window.game.flora.instancesNear(new (window.game.cam.pos.constructor)(...${JSON.stringify(found.pos)}), 3, (sp) => sp.node)].some((i) => window.game.flora.mineTarget(i).node === ${JSON.stringify(found.id)})`;
  await until(a, sees, 60_000);
  await until(b, sees, 60_000);
  log('both see the node');

  // what each page is told of the node, and every hit it sends for it
  for (const p of [a, b]) {
    await p.evaluate((id) => {
      const w = window as unknown as Window & { __told: { seq: number; result: string }[]; __sentFor: number[] };
      const net = window.game.net;
      w.__told = [];
      w.__sentFor = [];
      net.mining.on((m: { node?: string; seq: number; result: string }) => m.node === id && w.__told.push({ seq: m.seq, result: m.result }));
      const send = net.send.bind(net);
      net.send = (m: { t: string; node?: string; seq: number }) => {
        if (m.t === 'mine' && m.node === id) w.__sentFor.push(m.seq);
        return send(m);
      };
    }, found.id);
  }
  const gone = `window.game.net.mining.gone(window.game.flora.frameId, ${JSON.stringify(found.id.split('_').slice(0, 3).join('_'))}, ${JSON.stringify(found.id.split('_').slice(3).join('_'))})`;

  log('listeners set');
  await freeze(a);
  await freeze(b);
  await play([a, b], 500);
  log('frozen, played 500 ms');
  expect(await a.evaluate(gone)).toBe(false);

  // both hold the beam on it
  await aim(a, found, true);
  await aim(b, found, true);
  const vanished = await playUntil([a, b], gone, 20_000);
  log('vanished', vanished);
  expect(vanished, `the node never went in both pages (${found.type}, ${found.hp} hp)`).toBe(true);
  for (const p of [a, b]) {
    await aim(p, found, false);
    await p.evaluate(() => window.dev.button(0, false));
  }
  await play([a, b], 300);
  for (const p of [a, b]) {
    expect(await p.evaluate(sees), 'drawn while the server says it is gone').toBe(false);
    expect(await p.evaluate(gone)).toBe(true);
  }
  // both beams were on it, and the server told of its breaking once as an answer to a hit
  const sent = await Promise.all([a, b].map((p) => p.evaluate(() => (window as unknown as Window & { __sentFor: number[] }).__sentFor.length)));
  expect(sent[0]).toBeGreaterThan(0);
  expect(sent[1]).toBeGreaterThan(0);
  const told = await Promise.all([a, b].map((p) => p.evaluate(() => (window as unknown as Window & { __told: { seq: number; result: string }[] }).__told)));
  expect(told.flat().filter((m) => m.result === 'depleted' && m.seq > 0)).toHaveLength(1);
  log('told', JSON.stringify(told));

  // holding the beam where it stood asks the server for nothing
  const sentBefore = await Promise.all([a, b].map((p) => p.evaluate(() => (window as unknown as Window & { __sentFor: number[] }).__sentFor.length)));
  for (const p of [a, b]) await aim(p, found, true);
  await play([a, b], 2000);
  for (const p of [a, b]) await p.evaluate(() => window.dev.button(0, false));
  const sentAfter = await Promise.all([a, b].map((p) => p.evaluate(() => (window as unknown as Window & { __sentFor: number[] }).__sentFor.length)));
  expect(sentAfter).toEqual(sentBefore);
  for (const p of [a, b]) expect(await p.evaluate(sees)).toBe(false);
  // (nor does the client ask by name)
  for (const p of [a, b]) {
    const asked = await p.evaluate((id) => window.game.net.mining.beam(1, window.game.flora.frameId, { node: id }, null, window.game.time), found.id);
    expect(asked).toBe(false);
  }

  // it grows back (a formation takes the longest, eight minutes), the same node, in both pages
  log('holding the beam on the gone node asked for nothing');
  await stall([a, b], 490_000);
  await play([a, b], 200);
  const back = await playUntil([a, b], `!(${gone})`, 20_000);
  expect(back, 'the node never grew back in both pages').toBe(true);
  for (const p of [a, b]) expect(await p.evaluate(sees)).toBe(true);

  expect(errors).toEqual([]);
});
