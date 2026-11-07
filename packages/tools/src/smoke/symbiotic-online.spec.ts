import { randomBytes } from 'node:crypto';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { CharacterSummary, EntityState, ServerMessage, type Vec3 } from '@astra/shared/protocol';
import { newSkillState, storedSkills, type SkillOp } from '@astra/shared/skills';
import { SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import { describeGalaxySystem, faunaSpecies, Galaxy, GALAXY_SEED, frameId } from '@astra/shared/world';
import { expect, test } from './harness.ts';
import { startOnline, type Online } from './online.ts';
import { symbioticRoutes, verifySymbioticClaim } from './symbiotic-private.ts';

// Admin commands arrange live actors; SQL stages only a fragment before first join. Every purchase, analysis, cast,
// movement, hit and removal below goes through the real gateway and snapshots. No replay or client-owned mob state.
let online: Online;
declare global {
  interface Window {
    symbioticQa: { messages: ServerMessage[] };
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const routes = symbioticRoutes(process.env);
  verifySymbioticClaim(routes);
  online = await startOnline({ ...routes, stepped: true });
});
test.afterAll(async () => {
  await online?.stop();
});

async function until(page: Page, predicate: string, timeout = 30_000) {
  await page.waitForFunction(
    (source) => {
      if (window.game) for (let i = 0; i < 2; i++) window.game.frame(1 / 60);
      return !!(0, eval)(source);
    },
    predicate,
    { timeout, polling: 100 },
  );
}

async function walker(browser: Browser, errors: string[], fragment: boolean) {
  const name = `bond${randomBytes(5).toString('hex')}`;
  const response = await fetch(`${online.serverUrl}/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, people: 'thalune' }),
    signal: AbortSignal.timeout(15_000),
  });
  expect(response.ok).toBe(true);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('character' in payload)) throw new Error('Missing dev character');
  const character = CharacterSummary.parse(payload.character);
  if (fragment) {
    const state = newSkillState('thalune');
    state.fragments.symbiotic.earned = 1;
    const component = JSON.stringify({ v: 2, data: storedSkills(state) }).replaceAll("'", "''");
    online.sql(`UPDATE characters SET state = jsonb_set(state, '{skills}', '${component}'::jsonb) WHERE id = '${character.id}' AND saved_at IS NULL`);
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(`${online.url}/?dev=${name}#foot`);
  await until(page, 'window.game.net?.joined && window.game.mode === "foot" && window.game.net.store.ack > 0', 120_000);
  await page.evaluate(() => {
    window.symbioticQa = { messages: [] };
    for (const type of ['skills', 'analyze', 'cast', 'event'])
      window.game.net.on(type, (message: ServerMessage) => {
        // Bounded control/event evidence, not a frame recording.
        window.symbioticQa.messages.push(message);
        if (window.symbioticQa.messages.length > 256) window.symbioticQa.messages.shift();
      });
  });
  return { page, character: character.id };
}

async function skill(page: Page, seq: number, op: SkillOp) {
  expect(await page.evaluate(({ seq, op }) => window.game.net.send({ t: 'skills', seq, op }), { seq, op })).toBe(true);
  await until(page, `window.symbioticQa.messages.some(m => m.t === 'skills' && m.seq === ${seq})`);
  const answer = ServerMessage.parse(await page.evaluate((seq) => window.symbioticQa.messages.find((m) => m.t === 'skills' && m.seq === seq), seq));
  if (answer.t !== 'skills') throw new Error('Missing skills response');
  expect(answer.error, JSON.stringify(answer)).toBeUndefined();
  return answer.skills;
}

function selectArena(tiers: number[]) {
  const galaxy = new Galaxy(GALAXY_SEED);
  for (const [system, info] of galaxy.systems.entries()) {
    if (tiers[system] !== 1) continue;
    for (const body of describeGalaxySystem(info).bodies) {
      if (body.params.type !== 'lush') continue;
      const species = faunaSpecies(body.params, 1);
      const companion = species.find((s) => s.temperament === 'docile' && s.bodyPlan !== 'quad_heavy' && s.kind !== 'flyer');
      const enemy = species.find((s) => s.temperament === 'territorial');
      if (companion && enemy) return { system, seed: info.seed, body: body.index, companion, enemy, frame: frameId(info.seed, body.index) };
    }
  }
  throw new Error('No live tier-one lush world with a Bond-eligible docile species and territorial opponent');
}

async function place(character: string, arena: ReturnType<typeof selectArena>, pose: string, frame = String(arena.body)) {
  // Cross-system placement is saved and restored: transport the owned ship, then disembark through normal input.
  const result = await online.admin({ cmd: 'teleport', character, system: arena.system, frame, pose, mode: pose === 'docked' ? 'docked' : 'landed' });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}

async function spawn(arena: ReturnType<typeof selectArena>, species: number, at: Vec3) {
  const result = await online.admin({ cmd: 'spawn', system: arena.system, spec: { kind: 'herd', species, body: arena.body, at, count: 1, level: 2 } });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  const value = result.result;
  if (
    !value ||
    typeof value !== 'object' ||
    !('creatures' in value) ||
    !Array.isArray(value.creatures) ||
    value.creatures.length !== 1 ||
    typeof value.creatures[0] !== 'number'
  )
    throw new Error('Spawn did not return exactly one creature');
  return value.creatures[0];
}

/** Orient only the player's look. The production camera, Fauna picker and castIntent still choose their own target. */
async function aim(page: Page, id: number) {
  await until(page, `window.game.remotes.get(${id})?.shown === true`);
  await page.evaluate((id) => {
    const g = window.game;
    const target = g.fauna.targets(g.player.state.frame).find((t: { id: number }) => t.id === id);
    if (!target) throw new Error(`No live drawn target ${id}`);
    const up = g.player.state.pos.clone().normalize();
    const eye = g.player.state.pos.clone().addScaledVector(up, 1.7);
    const direction = target.pos.clone().sub(eye).normalize();
    g.player.heading.copy(direction).addScaledVector(up, -direction.dot(up)).normalize();
    g.player.pitch = Math.asin(direction.dot(up));
    g.frame(1 / 60);
  }, id);
}

interface DrawnEvidence {
  wire: EntityState;
  id: number;
  species: number;
  body: number;
  pos: number[];
  world: number[];
  name: string;
  drawn: boolean;
  instanced: boolean;
  submitted: boolean;
  slot: number;
  matrix: number[];
  matrixError: number;
  scale: number;
  speciesSize: number;
  screen: number[];
  picked: number | undefined;
  tick: number;
  time: number;
  ack: number;
  offline: boolean;
}

async function inspect(page: Page, id: number) {
  return page.evaluate<DrawnEvidence, number>((id) => {
    const g = window.game;
    const r = g.remotes.get(id);
    if (!r || !r.shown) throw new Error(`Missing remote ${id}`);
    const d = g.fauna.worlds.get(r.frame)?.drawn.get(r.species);
    if (!d) throw new Error(`No instanced species for ${id}`);
    let submitted = false;
    const previous = d.mesh.onAfterRender;
    d.mesh.onAfterRender = function (this: unknown, ...args: unknown[]) {
      if (args[2] === g.engine.camera) submitted = true;
      previous.apply(this, args);
    };
    try {
      g.frame(1 / 60);
      const slot = Array.from({ length: d.mesh.count }, (_, k) => k).find((k) => d.seed.array[k] === Math.fround(r.vis.seed));
      if (slot === undefined) throw new Error(`No instance slot for ${id}`);
      const matrix: number[] = Array.from(d.mesh.instanceMatrix.array.slice(slot * 16, (slot + 1) * 16));
      const expected = r.world.clone().sub(g.camWorld);
      const screen = g.fauna.hitAnchor(r).clone().sub(g.camWorld).project(g.engine.camera);
      const direction = g.cam.pos.clone().set(0, 0, -1).applyQuaternion(g.cam.quat);
      const hit = g.fauna.pick(g.cam.frame, g.cam.pos, direction, 70);
      const wire: EntityState = g.net.store.entities.get(id);
      return {
        wire,
        id: r.id,
        species: r.species,
        body: g.system.planets.indexOf(r.frame),
        pos: r.pos.toArray(),
        world: r.world.toArray(),
        name: d.sp.name,
        drawn: r.drawn,
        instanced: d.mesh.isInstancedMesh,
        submitted,
        slot,
        matrix,
        matrixError: Math.hypot(matrix[12]! - expected.x, matrix[13]! - expected.y, matrix[14]! - expected.z),
        scale: Math.hypot(matrix[0]!, matrix[1]!, matrix[2]!),
        speciesSize: d.sp.size,
        screen: screen.toArray(),
        picked: hit?.id,
        tick: g.net.store.tick,
        time: g.net.store.time,
        ack: g.net.store.ack,
        offline: g.remotes.offline !== null || g.remotes.replay !== null,
      };
    } finally {
      d.mesh.onAfterRender = previous;
    }
  }, id);
}

function drawn(e: Awaited<ReturnType<typeof inspect>>, arena: ReturnType<typeof selectArena>, id: number, species: number, owner?: number) {
  expect(EntityState.parse(e.wire)).toMatchObject({ id, kind: 'mob', species, frame: arena.frame, ...(owner === undefined ? {} : { owner }) });
  expect(e.id).toBe(id);
  expect(e.species).toBe(species);
  expect(e.body).toBe(arena.body);
  expect(e.drawn && e.instanced && e.submitted).toBe(true);
  expect(e.offline).toBe(false);
  expect(e.matrixError).toBeLessThan(0.02);
  // T09 draws at species size. Per-creature quantized scale remains E08.T02; do not invent it in this fixture.
  expect(e.scale).toBeCloseTo(e.speciesSize, 4);
  expect(Math.abs(e.screen[0]!)).toBeLessThan(1);
  expect(Math.abs(e.screen[1]!)).toBeLessThan(1);
  expect(e.screen[2]).toBeGreaterThan(-1);
  expect(e.screen[2]).toBeLessThan(1);
}

async function pixels(info: TestInfo, pages: Page[], label: string) {
  for (const [i, page] of pages.entries())
    await info.attach(`${label}-${i === 0 ? 'owner' : 'observer'}`, {
      body: await page.screenshot({ timeout: 15_000 }),
      contentType: 'image/png',
    });
}

async function cast(page: Page, target: number) {
  await aim(page, target);
  const sent = await page.evaluate(async () => {
    const modulePath = '/src/net/abilities.js';
    const { castIntent } = await import(/* @vite-ignore */ modulePath);
    return window.game.abilities.cast('ground', 0, castIntent(window.game, 'ground'));
  });
  expect(sent).toMatchObject({ node: 'bond', slot: 0, target });
  await until(page, `window.symbioticQa.messages.some(m => m.t === 'cast' && m.seq === ${sent.seq})`);
  const answer = ServerMessage.parse(await page.evaluate((seq: number) => window.symbioticQa.messages.find((m) => m.t === 'cast' && m.seq === seq), sent.seq));
  return answer;
}

const distance = (a: number[], b: number[]) => Math.hypot(...a.map((n, i) => n - b[i]!));

test('Bond is eligible, rendered, picked, follows, damages and retires on two real clients', async ({ browser }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const evidence: Record<string, unknown> = {};
  const a = await walker(browser, errors, true);
  const b = await walker(browser, errors, false);
  const pages = [a.page, b.page];
  try {
    const unlocked = await skill(a.page, 1, { op: 'unlock', node: 'bond' });
    expect(unlocked.state.unlocked).toContain('bond');
    expect(unlocked.state.bought).not.toContain('bond');
    const bought = await skill(a.page, 2, { op: 'buy', node: 'bond' });
    expect(bought.state.bought).toContain('bond');
    const equipped = await skill(a.page, 3, { op: 'slot', bar: 'ground', index: 0, node: 'bond' });
    expect(equipped.state.slots.ground[0]).toBe('bond');
    evidence.skills = { unlocked, bought, equipped };

    const arena = selectArena(await a.page.evaluate(() => window.game.galaxy.systems.map((s: unknown) => window.game.universe.tierOf(s))));
    evidence.arena = arena;
    for (const client of [a, b]) {
      await place(client.character, arena, 'docked', 'station');
      await until(
        client.page,
        `window.game.net?.joined && window.game.net.zone.systemSeed === ${arena.seed} && window.game.system.seed === ${arena.seed} && window.game.mode === 'ship' && window.game.ship.mode === 'landed' && window.game.ship.state.frame === window.game.station && window.game.net.store.entities.get(window.game.net.entityId)?.mode === 'docked'`,
        60_000,
      );
    }
    const ground = await a.page.evaluate(
      ({ body, gearHeight }) => {
        const p = window.game.system.planets[body];
        // Broad dry patch; all offsets are tangent metres, never fixed world-axis displacements on a sphere.
        for (let lat = -60; lat <= 60; lat += 5)
          for (let lon = 0; lon < 360; lon += 5) {
            const up = window.game.player.state.pos
              .clone()
              .set(
                Math.cos((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180),
                Math.sin((lat * Math.PI) / 180),
                Math.cos((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180),
              );
            const east = up.clone().set(-up.z, 0, up.x).normalize();
            const north = up.clone().cross(east).normalize();
            const at = (x: number, y: number, clearance = 0) => {
              const dir = up.clone().multiplyScalar(p.radius).addScaledVector(east, x).addScaledVector(north, y).normalize();
              return dir.multiplyScalar(p.surfaceRadius(dir) + clearance);
            };
            const points = [
              [0, 0],
              [60, 0],
              [-60, 0],
              [0, 60],
              [0, -60],
            ].map(([x, y]) => at(x!, y!));
            const heights = points.map((v) => v.length() - p.radius);
            if (heights.every((h) => h > 30) && Math.max(...heights) - Math.min(...heights) < 4)
              return {
                owner: at(0, 0, gearHeight).toArray(),
                observer: at(0, 12, gearHeight).toArray(),
                companion: at(12, 0).toArray(),
                east: east.toArray(),
              };
          }
        throw new Error('No broad dry arena on the selected world');
      },
      { body: arena.body, gearHeight: SHIP_GEAR_HEIGHT },
    );
    await place(a.character, arena, ground.owner.join(','));
    await place(b.character, arena, ground.observer.join(','));
    const arrivals: { character: string; landed: EntityState; foot: EntityState }[] = [];
    evidence.arrivals = arrivals;
    for (const client of [a, b]) {
      const page = client.page;
      await until(
        page,
        `window.game.net?.joined && window.game.net.store.entities.get(window.game.net.entityId)?.frame === '${arena.frame}' && window.game.net.store.entities.get(window.game.net.entityId)?.mode === 'landed' && window.game.mode === 'ship' && window.game.ship.mode === 'landed' && window.game.ship.state.frame === window.game.system.planets[${arena.body}]`,
      );
      const landed = EntityState.parse(await page.evaluate(() => window.game.net.store.entities.get(window.game.net.entityId)));
      expect(landed).toMatchObject({ kind: 'player', frame: arena.frame, mode: 'landed' });
      // Real F interaction leaves this client's server-owned landed ship; no foot teleport or parked-pose injection.
      await page.keyboard.down('KeyF');
      try {
        await until(page, 'window.game.mode === "foot"', 10_000);
      } finally {
        await page.keyboard.up('KeyF');
      }
      await until(
        page,
        `window.game.net?.joined && window.game.net.store.entities.get(window.game.net.entityId)?.frame === '${arena.frame}' && window.game.net.store.entities.get(window.game.net.entityId)?.mode === 'foot' && window.game.mode === 'foot' && window.game.player.state.frame === window.game.system.planets[${arena.body}] && window.game.player.grounded && !window.game.director.pose && !window.game.director.blend`,
      );
      const foot = EntityState.parse(await page.evaluate(() => window.game.net.store.entities.get(window.game.net.entityId)));
      expect(foot).toMatchObject({ id: landed.id, kind: 'player', frame: arena.frame, mode: 'foot' });
      expect(foot.hp).toBeGreaterThan(0);
      arrivals.push({ character: client.character, landed, foot });
    }
    await until(a.page, 'window.game.fauna.shown.length > 0', 60_000);
    const companion = await spawn(arena, arena.companion.index, ground.companion);
    evidence.companion = companion;
    for (const page of pages) {
      await aim(page, companion);
      const before = await inspect(page, companion);
      drawn(before, arena, companion, arena.companion.index);
      expect(before.picked).toBe(companion);
      expect(before.wire.owner).toBeUndefined();
    }
    expect(await cast(a.page, companion)).toMatchObject({ result: 'refused', reason: 'target' });
    expect(await a.page.evaluate((id) => window.game.analyze(id), companion)).toBe(true);
    await until(a.page, `window.symbioticQa.messages.some(m => m.t === 'analyze' && m.target === ${companion} && m.result === 'new')`);
    evidence.analysis = await a.page.evaluate(() => window.symbioticQa.messages.filter((m) => m.t === 'analyze'));
    expect(await cast(a.page, companion)).toMatchObject({ result: 'cast' });
    const owner: number = await a.page.evaluate(() => window.game.net.entityId);
    const observer: number = await b.page.evaluate(() => window.game.net.entityId);
    expect(observer).not.toBe(owner);
    evidence.players = { owner, observer };
    const bound = [];
    for (const page of pages) {
      await until(page, `window.game.net.store.entities.get(${companion})?.owner === ${owner}`);
      await aim(page, companion);
      const result = await inspect(page, companion);
      drawn(result, arena, companion, arena.companion.index, owner);
      expect(result.picked).toBe(companion);
      bound.push(result);
    }
    evidence.bound = bound;
    expect(bound[0]!.name).toBe(arena.companion.name);
    expect(bound[1]!.name).toBe(bound[0]!.name);
    await pixels(info, pages, 'bond');

    const initialOwner: number[] = await a.page.evaluate(() => window.game.net.store.entities.get(window.game.net.entityId).pos);
    await aim(a.page, companion);
    await a.page.bringToFront();
    await a.page.keyboard.down('KeyS');
    try {
      await until(
        a.page,
        `Math.hypot(...window.game.net.store.entities.get(window.game.net.entityId).pos.map((v,i) => v - ${JSON.stringify(initialOwner)}[i])) > 14`,
        15_000,
      );
    } finally {
      await a.page.keyboard.up('KeyS');
    }
    for (const page of pages)
      await until(
        page,
        `(() => {
      const all = window.game.net.store.entities, c = all.get(${companion}), p = all.get(${owner});
      return c?.owner === ${owner} && p && Math.hypot(...c.pos.map((v,i) => v - p.pos[i])) < 8;
    })()`,
        20_000,
      );
    const followed = [];
    for (const [i, page] of pages.entries()) {
      await aim(page, companion);
      const result = await inspect(page, companion);
      drawn(result, arena, companion, arena.companion.index, owner);
      expect(result.picked).toBe(companion);
      expect(distance(result.wire.pos!, bound[i]!.wire.pos!)).toBeGreaterThan(6);
      expect(distance(result.pos, bound[i]!.pos)).toBeGreaterThan(6);
      expect(result.tick).toBeGreaterThan(bound[i]!.tick);
      followed.push(result);
    }
    evidence.followed = followed;
    await pixels(info, pages, 'follow');

    const enemyAt: Vec3 = await a.page.evaluate((east) => {
      const p = window.game.net.store.entities.get(window.game.net.entityId).pos;
      return [p[0] + east[0] * 8, p[1] + east[1] * 8, p[2] + east[2] * 8];
    }, ground.east);
    if (!online.clock) throw new Error('Stepped fixture clock is required');
    await online.clock.freeze();
    const enemy = await spawn(arena, arena.enemy.index, enemyAt);
    await online.clock.advance(50);
    evidence.enemy = enemy;
    const beforeHp: number[] = [];
    for (const page of pages) {
      await until(page, `window.game.net.store.entities.get(${enemy})?.hp > 0`);
      beforeHp.push(await page.evaluate((id) => window.game.net.store.entities.get(id).hp, enemy));
    }
    expect(beforeHp).toEqual([1, 1]);
    await online.clock.thaw();
    for (const [i, page] of pages.entries())
      await until(
        page,
        `window.symbioticQa.messages.some(m => m.t === 'event' && m.event.kind === 'combat' && m.event.source === ${companion} && m.event.target === ${enemy} && m.event.amount > 0) && window.game.net.store.entities.get(${enemy})?.hp > 0 && window.game.net.store.entities.get(${enemy})?.hp < ${beforeHp[i]}`,
        20_000,
      );
    await online.clock.freeze();
    const combat = [];
    for (const [i, page] of pages.entries()) {
      await aim(page, enemy);
      const result = await inspect(page, enemy);
      drawn(result, arena, enemy, arena.enemy.index);
      expect(result.wire.hp).toBeGreaterThan(0);
      expect(result.wire.hp).toBeLessThan(beforeHp[i]!);
      expect(result.wire.mode).not.toBe('dead');
      const companionView = await inspect(page, companion);
      drawn(companionView, arena, companion, arena.companion.index, owner);
      expect(companionView.wire.hp).toBeGreaterThan(0);
      combat.push({
        target: result,
        companion: companionView,
        hits: await page.evaluate(
          ({ companion, enemy }) =>
            window.symbioticQa.messages.filter((m) => m.t === 'event' && m.event.kind === 'combat' && m.event.source === companion && m.event.target === enemy),
          { companion, enemy },
        ),
      });
    }
    evidence.combat = { beforeHp, after: combat };
    await pixels(info, pages, 'combat');

    await aim(b.page, companion);
    const beforeRelease = await inspect(b.page, companion);
    drawn(beforeRelease, arena, companion, arena.companion.index, owner);
    expect(beforeRelease.wire.hp).toBeGreaterThan(0);
    expect(beforeRelease.picked).toBe(companion);
    evidence.beforeRelease = beforeRelease;
    const release = await b.page.evaluate(
      ({ observer, enemy }) => ({
        tick: window.game.net.store.tick,
        observer: window.game.net.store.entities.get(observer),
        enemy: window.game.net.store.entities.get(enemy),
      }),
      { observer, enemy },
    );
    expect(EntityState.parse(release.observer)).toMatchObject({ id: observer, kind: 'player', frame: arena.frame, mode: 'foot' });
    expect(release.observer.hp).toBeGreaterThan(0);
    expect(EntityState.parse(release.enemy)).toMatchObject({ id: enemy, kind: 'mob', species: arena.enemy.index, frame: arena.frame });
    expect(release.enemy.hp).toBeGreaterThan(0);
    expect(release.enemy.hp).toBeLessThan(beforeHp[1]!);
    expect(release.enemy.mode).not.toBe('dead');
    evidence.release = release;
    // Close the owner while combat is frozen, then require a newer live observer snapshot after thaw.
    await a.page.evaluate(() => window.game.net.close());
    await until(a.page, '!window.game.net || window.game.net.state === "closed"', 10_000);
    await online.clock.thaw();
    await until(
      b.page,
      `window.game.net.joined && window.game.net.entityId === ${observer} && window.game.net.store.tick > ${release.tick} && (() => {
        const witness = window.game.net.store.entities.get(${observer});
        const target = window.game.net.store.entities.get(${enemy});
        return witness?.id === ${observer} && witness.kind === 'player' && witness.frame === '${arena.frame}' && witness.mode === 'foot' && witness.hp > 0
          && target?.id === ${enemy} && target.kind === 'mob' && target.species === ${arena.enemy.index} && target.frame === '${arena.frame}' && target.hp > 0 && target.mode !== 'dead';
      })() && !window.game.net.store.entities.has(${owner}) && !window.game.net.store.entities.has(${companion}) && !window.game.remotes.get(${companion}) && !window.game.fauna.shown.some(r => r.id === ${companion})`,
    );
    const retired = await b.page.evaluate(
      ({ companion, observer, enemy, owner }) => {
        const g = window.game;
        const ray = g.cam.pos.clone().set(0, 0, -1).applyQuaternion(g.cam.quat);
        return {
          joined: g.net.joined,
          entityId: g.net.entityId,
          tick: g.net.store.tick,
          observer: g.net.store.entities.get(observer),
          enemy: g.net.store.entities.get(enemy),
          ownerGone: !g.net.store.entities.has(owner),
          companionGone: !g.net.store.entities.has(companion) && !g.remotes.get(companion) && !g.fauna.shown.some((r: { id: number }) => r.id === companion),
          targetGone: !g.fauna.targets(g.cam.frame).some((t: { id: number }) => t.id === companion),
          picked: g.fauna.pick(g.cam.frame, g.cam.pos, ray, 70)?.id ?? null,
        };
      },
      { companion, observer, enemy, owner },
    );
    expect(retired).toMatchObject({ joined: true, entityId: observer, ownerGone: true, companionGone: true, targetGone: true });
    expect(retired.tick).toBeGreaterThan(release.tick);
    expect(EntityState.parse(retired.observer)).toMatchObject({ id: observer, kind: 'player', frame: arena.frame, mode: 'foot' });
    expect(retired.observer.hp).toBeGreaterThan(0);
    expect(EntityState.parse(retired.enemy)).toMatchObject({ id: enemy, kind: 'mob', species: arena.enemy.index, frame: arena.frame });
    expect(retired.enemy.hp).toBeGreaterThan(0);
    expect(retired.enemy.mode).not.toBe('dead');
    expect(retired.picked).not.toBe(companion);
    evidence.retired = retired;
    await pixels(info, pages, 'disconnect');
    expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
  } finally {
    await info.attach('symbiotic-evidence', { body: Buffer.from(JSON.stringify({ ...evidence, errors }, null, 2)), contentType: 'application/json' });
    await info.attach('server-output', { body: Buffer.from(online.serverOutput()), contentType: 'text/plain' });
    // The imported hang guard bounds closure of both manually created contexts, including failure paths.
    await Promise.all(pages.map((page) => page.evaluate(() => window.game.net?.close()).catch(() => {})));
  }
});
