import { randomInt } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { startOnline, type Online } from './online.ts';

// The server's herds on two clients (P1.E08.T09), as players run it (online.ts: a scratch database, the server, Vite): two
// dev-login scenarios (`?dev#foot`, which go through the server) are put on the home world's ground by the admin channel's
// teleport, a herd is spawned beside them by its spawn, and each client must draw the very herd the server holds: the
// same creatures, species and places, as instances of the species' rig. One of them analyzes a creature it is
// looking at and the server answers with the codex entry: the banner is the drawn creature's.

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

/** A dev-login character on foot in its home hangar, in a browser of its own, its snapshots echoing its input. */
async function walker(browser: Browser, name: string, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${online.url}/?dev=${name}#foot`);
  await page.waitForFunction(() => 'game' in window && 'step' in window, null, { timeout: 60_000 });
  await until(page, "window.game.net?.joined && window.game.mode === 'foot'", 120_000);
  await until(page, 'window.game.net.store.ack > 0 && window.game.net.store.entities.has(window.game.net.entityId)', 30_000);
  return page;
}

interface Seen {
  id: number;
  species: number;
  name: string;
  frame: string;
  pos: number[];
  mode: string;
  shown: boolean;
}

/** The creatures a client follows, as it draws them. */
const seen = (page: Page): Promise<Seen[]> =>
  page.evaluate(() => {
    const g = window.game;
    return g.remotes.list
      .filter((r: { kind: string }) => r.kind === 'mob')
      .map((r: { id: number; species: number; frame: { name: string } | null; pos: { toArray(): number[] }; pose: { mode: string }; shown: boolean }) => ({
        id: r.id,
        species: r.species,
        name: g.fauna.speciesOf(r)?.name ?? '',
        frame: g.system.planets.indexOf(r.frame as never).toString(),
        pos: r.pos.toArray(),
        mode: r.pose.mode,
        shown: r.shown,
      }));
  });

test('two clients draw the same herd from the server’s snapshots, and analyzing a drawn creature works', async ({ browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const nameA = `fauna${letters(5)}`;
  const nameB = `fauna${letters(5)}`;
  const a = await walker(browser, nameA, errors);
  const b = await walker(browser, nameB, errors);
  const [characters, system, home] = (await a.evaluate(() => [
    window.game.net.welcome.character.name as string,
    window.game.galaxy.systems.findIndex((s: { seed: number }) => s.seed === window.game.net.zone.systemSeed) as number,
    window.game.system.planets.indexOf(window.game.station.parent) as number,
  ])) as [string, number, number];

  // both on the home world's land (found on the client's own copy of its ground: dry, 40 m of it in every direction round a
  // spot at least 30 m over the sea), a few metres apart (a teleport onto the drawn ground, on foot)
  const [lat, lon0] = await a.evaluate(() => {
    const P = window.game.station.parent;
    const dry = (la: number, lo: number) => {
      const c = Math.cos((la * Math.PI) / 180);
      return P.heightAt({ x: c * Math.cos((lo * Math.PI) / 180), y: Math.sin((la * Math.PI) / 180), z: c * Math.sin((lo * Math.PI) / 180) }) > 30;
    };
    for (let la = 0; la <= 70; la += 5)
      for (const sign of [1, -1])
        for (let lo = 0; lo < 360; lo += 5) if (dry(sign * la, lo) && dry(sign * la, lo + 0.1) && dry(sign * la, lo - 0.1)) return [sign * la, lo];
    return [null, null];
  });
  expect(lat, 'dry land on the home world').not.toBeNull();
  for (const [name, lon] of [
    [characters, lon0!],
    [await b.evaluate(() => window.game.net.welcome.character.name as string), lon0! + 0.02],
  ] as const) {
    const done = await online.admin({ cmd: 'teleport', character: name, system, frame: String(home), pose: `surface:${lat},${lon}`, mode: 'foot' });
    expect(done, JSON.stringify(done)).toMatchObject({ ok: true });
  }
  for (const page of [a, b])
    await until(page, 'window.game.player.state.frame === window.game.system.planets[window.game.system.planets.indexOf(window.game.station.parent)]', 60_000);

  // (the server plans a world's ground when a player comes to it, and cells load once it is ready: the world's own herds
  // appearing is the sign, and a herd spawned before it would be put on a flat sea level)
  await until(a, 'window.game.fauna.shown.length > 0', 60_000);

  // a herd of the world's first species 40 m from A along the ground, on the side away from B (further than a skittish herd
  // is alarmed from, and within analysis' 70 m)
  const [x, y, z] = await a.evaluate(() => window.game.net.store.entities.get(window.game.net.entityId)!.pos as number[]);
  const spawned = await online.admin({ cmd: 'spawn', system, spec: { kind: 'herd', species: 0, body: home, at: [x!, y!, z! - 40], count: 4, level: 2 } });
  expect(spawned, JSON.stringify(spawned)).toMatchObject({ ok: true });
  const herd = (spawned.result as { creatures: number[]; name: string }).creatures;
  expect(herd).toHaveLength(4);

  // every one of them reaches both clients, drawn as an instance of its species' rig
  for (const page of [a, b]) {
    await until(page, `[${herd}].every((id) => window.game.remotes.get(id)?.shown === true)`, 60_000);
    await until(page, `[${herd}].every((id) => window.game.remotes.get(id)?.drawn === true)`, 30_000);
  }
  // (a few seconds of them going about, on real time)
  await a.waitForTimeout(1500);
  const [onA, onB] = await Promise.all([seen(a), seen(b)]);
  const herdOf = (list: Seen[]) => list.filter((s) => herd.includes(s.id)).sort((x, y) => x.id - y.id);
  expect(herdOf(onA).map((s) => s.id)).toEqual([...herd].sort((x, y) => x - y));
  expect(herdOf(onB).map((s) => [s.id, s.species, s.name, s.frame])).toEqual(herdOf(onA).map((s) => [s.id, s.species, s.name, s.frame]));
  // the server's name for the species is the one both draw
  for (const s of herdOf(onA)) expect(s.name).toBe((spawned.result as { name: string }).name);
  // and in the same places, up to when each reads the world (they go slowly, and their poses are one stream's)
  const [ha, hb] = [herdOf(onA), herdOf(onB)];
  ha.forEach((s, i) => expect(Math.hypot(...s.pos.map((x, k) => x - hb[i]!.pos[k]!)), `creature ${s.id}`).toBeLessThan(4));
  // each client's instanced mesh for the herd's species holds the spawned creatures
  for (const page of [a, b]) {
    const mesh = await page.evaluate((ids) => {
      const g = window.game;
      const r = g.remotes.get(ids[0]);
      const d = g.fauna.worlds.get(r.frame).drawn.get(r.species);
      return { instanced: d.mesh.isInstancedMesh as boolean, count: d.mesh.count as number, drawn: ids.filter((id: number) => g.remotes.get(id).drawn).length };
    }, herd);
    expect(mesh.instanced).toBe(true);
    expect(mesh.drawn).toBe(herd.length);
    expect(mesh.count).toBeGreaterThanOrEqual(herd.length);
  }

  // A analyzes the nearest of the herd: picked as the crosshair would (a ray from the camera to the creature), asked of the
  // server, which answers with the codex entry for the species the clients drew
  const picked = await a.evaluate((ids) => {
    const g = window.game;
    const r = ids
      .map((id: number) => g.remotes.get(id))
      .sort(
        (x: { world: { distanceTo(v: unknown): number } }, y: { world: { distanceTo(v: unknown): number } }) =>
          x.world.distanceTo(g.camWorld) - y.world.distanceTo(g.camWorld),
      )[0];
    const dir = r.pos.clone().sub(g.cam.pos).normalize();
    const hit = g.fauna.pick(g.cam.frame, g.cam.pos, dir, 70);
    (window as unknown as { __answers: unknown[] }).__answers = [];
    g.net.on('analyze', (m: unknown) => (window as unknown as { __answers: unknown[] }).__answers.push(m));
    g.net.on('refused', (m: unknown) => (window as unknown as { __answers: unknown[] }).__answers.push(m));
    const sent = hit ? g.analyze(hit.id) : null;
    return hit
      ? { id: hit.id, name: hit.sp.name, t: hit.t, sent }
      : { id: 0, name: '', t: -1, dist: r.world.distanceTo(g.camWorld), mode: r.pose.mode, shown: g.fauna.shown.length };
  }, herd);
  expect(picked.id, `a drawn creature in the sights: ${JSON.stringify(picked)}`).toBeGreaterThan(0);
  await until(a, 'window.__answers.length > 0', 30_000);
  const answer = (await a.evaluate(() => (window as unknown as { __answers: unknown[] }).__answers[0])) as { result: string; reason?: string };
  expect(answer, JSON.stringify(answer)).toMatchObject({ result: 'new' });
  await until(a, "document.querySelector('.banner')?.innerText.toLowerCase().includes('new species analyzed')", 30_000);
  const banner = await a.evaluate(() => (document.querySelector('.banner') as HTMLElement).innerText);
  expect(banner.toLowerCase()).toContain(picked!.name.toLowerCase());
  // (the codex line, with its threat stars, and Bond, as the banner's third line; the XP as a toast)
  expect(banner).toMatch(/★[☆★]*.*Bond: /);
  await until(a, "[...document.querySelectorAll('.toast')].some((t) => /^\\+\\d+ XP$/.test(t.textContent))", 30_000);

  await Promise.all([a, b].map((p) => p.evaluate(() => window.game.net.close())));
  expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
});
