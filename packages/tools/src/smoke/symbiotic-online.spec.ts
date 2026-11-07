import { createHash, randomBytes } from 'node:crypto';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { CharacterSummary, EntityState, ServerMessage, type Vec3 } from '@astra/shared/protocol';
import { newSkillState, storedSkills, type SkillOp } from '@astra/shared/skills';
import { SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import { describeGalaxySystem, faunaSpecies, Galaxy, GALAXY_SEED, frameId, drawnGround, streetPlan, cityFrame, cityPoint } from '@astra/shared/world';
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

async function acquireInput(page: Page) {
  await page.bringToFront();
  await until(
    page,
    'document.hasFocus() && window.game.net?.joined && (window.game.mode === "ship" || window.game.mode === "foot") && !window.game.overlay',
    10_000,
  );
  if (!(await page.evaluate(() => window.game.input.locked))) await page.locator('.pause-menu.show [data-act="resume"]').click({ timeout: 10_000 });
  await until(page, 'document.hasFocus() && window.game.input.locked && window.game.input.enabled && !document.querySelector(".pause-menu.show")', 10_000);
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
      if (body.params.type !== 'lush' || !body.params.cityCount) continue;
      const species = faunaSpecies(body.params, 1);
      const companion = species.find((s) => s.temperament === 'docile' && s.bodyPlan !== 'quad_heavy' && s.kind !== 'flyer');
      const enemy = species.find((s) => s.temperament === 'territorial' && s.bodyPlan !== 'quad_heavy');
      if (companion && enemy) {
        const city = drawnGround(body.params, 1).cities.find((city) => streetPlan(city).plaza >= 100);
        if (city)
          return {
            system,
            seed: info.seed,
            body: body.index,
            companion,
            enemy,
            frame: frameId(info.seed, body.index),
            city,
            plaza: streetPlan(city).plaza,
            radius: body.params.radius,
          };
      }
    }
  }
  throw new Error('No tier-one living world with eligible fauna and a clear existing plaza');
}

async function place(character: string, arena: ReturnType<typeof selectArena>, pose: string, frame = String(arena.body)) {
  // Cross-system placement is saved and restored: transport the owned ship, then disembark through normal input.
  const result = await online.admin({ cmd: 'teleport', character, system: arena.system, frame, pose, mode: pose === 'docked' ? 'docked' : 'landed' });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}

function captureGround(arena: ReturnType<typeof selectArena>) {
  const frame = cityFrame(arena.city);
  const u = -arena.plaza * 0.65;
  const at = (x: number, y: number, clearance = 0): Vec3 => cityPoint(arena.city, frame, arena.radius, u + x, y, clearance).toArray();
  return {
    owner: at(0, -60, SHIP_GEAR_HEIGHT),
    observer: at(-16, -60, SHIP_GEAR_HEIGHT),
    ownerMark: at(0, 0),
    observerMark: at(-1, -6),
    companion: at(8, 3),
    east: frame.east.toArray(),
    north: frame.north.toArray(),
  };
}

/** Read the desired look delta; actual mouse events are the only writer. */
async function lookAt(page: Page, point: number[]) {
  await acquireInput(page);
  let x = 640,
    y = 360;
  await page.mouse.move(x, y);
  for (let attempt = 0; attempt < 20; attempt++) {
    const delta = await page.evaluate((point) => {
      const g = window.game,
        up = g.player.up(g.player.state.pos.clone());
      const direction = g.player.state.pos.clone().fromArray(point).sub(g.cam.pos).normalize();
      const flat = direction.clone().addScaledVector(up, -direction.dot(up)).normalize();
      const heading = g.player.heading;
      const yaw = Math.atan2(up.dot(heading.clone().cross(flat)), heading.dot(flat));
      const pitch = Math.asin(direction.dot(up)) - g.player.pitch;
      return { yaw, pitch, sensitivity: g.input.sensitivity, invertY: g.input.invertY };
    }, point);
    if (Math.abs(delta.yaw) < 0.004 && Math.abs(delta.pitch) < 0.004) return;
    const clamp = (v: number) => Math.max(-160, Math.min(160, v));
    x += clamp(-delta.yaw / (0.0021 * delta.sensitivity));
    y += clamp(-delta.pitch / (0.0021 * delta.sensitivity * (delta.invertY ? -1 : 1)));
    await page.mouse.move(x, y);
    await page.evaluate(() => window.game.frame(1 / 60));
  }
  throw new Error('Real mouse look did not reach the capture direction');
}

async function walkTo(page: Page, point: number[]) {
  await lookAt(page, point);
  await page.keyboard.down('KeyW');
  try {
    await until(
      page,
      `Math.hypot(...window.game.net.store.entities.get(window.game.net.entityId).pos.map((v,i) => v - ${JSON.stringify(point)}[i])) < 1.5`,
      20_000,
    );
  } finally {
    await page.keyboard.up('KeyW');
  }
  await until(page, 'window.game.player.grounded && window.game.player.state.vel.length() < 0.03', 10_000);
}

/** Bounds from the actual submitted instance geometry; shader animation still needs independent pixel review. */
async function frameSubjects(page: Page, ids: number[], parkedShips: number[][]) {
  const read = () =>
    page.evaluate((ids) => {
      const g = window.game;
      return ids.map((id) => {
        const r = g.remotes.get(id),
          d = r && g.fauna.worlds.get(r.frame)?.drawn.get(r.species);
        if (!r?.drawn || !d?.mesh) throw new Error(`Capture subject ${id} is not drawn`);
        const slot = Array.from({ length: d.mesh.count }, (_, k) => k).find((k) => d.seed.array[k] === Math.fround(r.vis.seed));
        if (slot === undefined) throw new Error(`Capture subject ${id} has no instance`);
        const matrix = d.mesh.matrixWorld.clone().fromArray(d.mesh.instanceMatrix.array, slot * 16);
        const local = g.cam.pos.clone(),
          min = [Infinity, Infinity, Infinity],
          max = [-Infinity, -Infinity, -Infinity];
        const pos = d.mesh.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          local.fromBufferAttribute(pos, k).applyMatrix4(matrix).applyMatrix4(d.mesh.matrixWorld);
          const screen = local.clone().project(g.engine.camera);
          for (let axis = 0; axis < 3; axis++) {
            const v = screen.getComponent(axis);
            min[axis] = Math.min(min[axis]!, v);
            max[axis] = Math.max(max[axis]!, v);
          }
        }
        // Actual model centre in body coordinates: the geometry's vertical span is not the gameplay hit sphere.
        let low = Infinity,
          high = -Infinity;
        for (let k = 0; k < pos.count; k++) {
          low = Math.min(low, pos.getY(k));
          high = Math.max(high, pos.getY(k));
        }
        const centre = r.pos.clone().addScaledVector(r.pos.clone().normalize(), (low + high) * 0.5 * d.sp.size);
        return { id, min, max, centre: centre.toArray(), species: r.species, size: d.sp.size };
      });
    }, ids);
  const initial = await read();
  const centre = initial[0]!.centre.map((_: number, axis: number) => initial.reduce((sum, subject) => sum + subject.centre[axis]!, 0) / initial.length);
  await lookAt(page, centre);
  const bounds = await read();
  for (const b of bounds) {
    expect(b.min[0], `left edge of ${b.id}`).toBeGreaterThan(-0.85);
    expect(b.max[0], `right edge of ${b.id}`).toBeLessThan(0.85);
    expect(b.min[1], `feet of ${b.id}`).toBeGreaterThan(-0.55);
    expect(b.max[1], `head of ${b.id}`).toBeLessThan(0.65);
    expect(b.min[2]).toBeGreaterThan(-1);
    expect(b.max[2]).toBeLessThan(1);
    expect((b.max[1]! - b.min[1]!) * 360, `body height in pixels for ${b.id}`).toBeGreaterThan(100);
  }
  if (bounds.length === 2) {
    const a = bounds[0]!,
      b = bounds[1]!;
    const dx = Math.abs((a.min[0]! + a.max[0]!) / 2 - (b.min[0]! + b.max[0]!) / 2) * 640;
    expect(dx, 'combatant projected centres must be distinguishable').toBeGreaterThan(60);
    const gap = Math.max(a.min[0]! - b.max[0]!, b.min[0]! - a.max[0]!) * 640;
    expect(gap, 'full projected combatant bodies must be separated').toBeGreaterThan(8);
  }
  const surroundings = await page.evaluate((parkedShips) => {
    const g = window.game,
      p = g.player.state.pos,
      up = p.clone().normalize();
    const forward = g.cam.pos.clone().set(0, 0, -1).applyQuaternion(g.cam.quat);
    const ships = parkedShips.map((pos) => {
      const delta = p.clone().fromArray(pos).sub(g.cam.pos);
      return { distance: delta.length(), angle: (Math.acos(Math.max(-1, Math.min(1, delta.normalize().dot(forward)))) * 180) / Math.PI };
    });
    return { clientId: g.net.entityId, ships, paving: g.player.state.frame.sampler.padWear(up.x, up.y, up.z) };
  }, parkedShips);
  for (const ship of surroundings.ships) {
    expect(ship.distance).toBeGreaterThan(25);
    expect(ship.angle).toBeGreaterThan(80);
  }
  expect(surroundings.paving).toBeGreaterThan(0.3);
  return { bounds, surroundings };
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

interface CaptureView {
  joined: boolean;
  clientId: number;
  tick: number;
  serverTime: number;
  ack: number;
  sampledAt: number;
  rendererFrame: number;
  frame: string;
  cameraBody: number;
  camera: {
    pos: number[];
    quat: number[];
    worldPos: number[];
    worldQuat: number[];
    projection: number[];
    fov: number;
    near: number;
    far: number;
    aspect: number;
  };
  viewport: { width: number; height: number; pixelRatio: number };
  subjects: {
    id: number;
    wire: EntityState | null;
    remote: boolean;
    shown: boolean;
    drawn: boolean;
    faunaShown: boolean;
    targeted: boolean;
    pos: number[] | null;
    world: number[] | null;
  }[];
  picked: number | null;
  bannerOpacity: number;
  overlay: string | null;
}

async function captureView(page: Page, ids: number[]) {
  return page.evaluate<CaptureView, number[]>((ids) => {
    const g = window.game;
    const player: EntityState = g.net.store.entities.get(g.net.entityId);
    if (!g.net.joined || !player?.frame) throw new Error('Missing live capture player/frame');
    const camera = g.engine.camera;
    const banner = document.querySelector('.banner');
    const targets = g.fauna.targets(g.cam.frame);
    const ray = g.cam.pos.clone().set(0, 0, -1).applyQuaternion(g.cam.quat);
    return {
      joined: g.net.joined,
      clientId: g.net.entityId,
      tick: g.net.store.tick,
      serverTime: g.net.store.time,
      ack: g.net.store.ack,
      sampledAt: performance.now(),
      rendererFrame: g.engine.renderer.info.render.frame,
      frame: player.frame,
      cameraBody: g.system.planets.indexOf(g.cam.frame),
      camera: {
        pos: g.cam.pos.toArray(),
        quat: g.cam.quat.toArray(),
        worldPos: g.camWorld.toArray(),
        worldQuat: g.camWorldQuat.toArray(),
        projection: camera.projectionMatrix.toArray(),
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        aspect: camera.aspect,
      },
      viewport: { width: innerWidth, height: innerHeight, pixelRatio: g.engine.renderer.getPixelRatio() },
      subjects: ids.map((id) => {
        const remote = g.remotes.get(id);
        return {
          id,
          wire: g.net.store.entities.get(id) ?? null,
          remote: remote !== undefined && remote !== null,
          shown: remote?.shown === true,
          drawn: remote?.drawn === true,
          faunaShown: g.fauna.shown.some((r: { id: number }) => r.id === id),
          targeted: targets.some((t: { id: number }) => t.id === id),
          pos: remote?.pos.toArray() ?? null,
          world: remote?.world.toArray() ?? null,
        };
      }),
      picked: g.fauna.pick(g.cam.frame, g.cam.pos, ray, 70)?.id ?? null,
      bannerOpacity: banner ? Number(getComputedStyle(banner).opacity) : 0,
      overlay: g.overlay ?? null,
    };
  }, ids);
}

// Compare the body's local camera; planetary world transforms keep advancing normally.
// Tiny arithmetic tolerances are below a pixel; no camera field is written or reset.
function sameCaptureView(a: CaptureView, b: CaptureView) {
  const close = (x: number[], y: number[], epsilon: number) => x.length === y.length && x.every((n, i) => Math.abs(n - y[i]!) <= epsilon);
  const rotation = (x: number[], y: number[]) =>
    close(x, y, 1e-7) ||
    close(
      x,
      y.map((n) => -n),
      1e-7,
    );
  return (
    a.clientId === b.clientId &&
    a.frame === b.frame &&
    a.cameraBody === b.cameraBody &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height &&
    a.viewport.pixelRatio === b.viewport.pixelRatio &&
    close(a.camera.pos, b.camera.pos, 1e-5) &&
    rotation(a.camera.quat, b.camera.quat) &&
    close(a.camera.projection, b.camera.projection, 1e-10) &&
    a.camera.fov === b.camera.fov &&
    a.camera.near === b.camera.near &&
    a.camera.far === b.camera.far &&
    a.camera.aspect === b.camera.aspect
  );
}

async function capture(info: TestInfo, page: Page, role: 'owner' | 'observer', label: string, ids: number[]) {
  // Wait for the real banner's CSS lifetime; never hide an overlay or alter a mesh.
  await page.waitForFunction(
    () => {
      const banner = document.querySelector('.banner');
      return !window.game.overlay && !document.querySelector('.pause-menu.show') && (!banner || Number(getComputedStyle(banner).opacity) < 0.01);
    },
    undefined,
    { timeout: 25_000 },
  );
  const before = await captureView(page, ids);
  const body = await page.screenshot({ timeout: 15_000 });
  const after = await captureView(page, ids);
  const name = `${label}-${role}`;
  const receipt = { name, role, pngSha256: createHash('sha256').update(body).digest('hex'), before, after };
  // The image belongs to this explicit capture interval, not an invented exact raster tick.
  await info.attach(name, { body, contentType: 'image/png' });
  await info.attach(`${name}-binding`, { body: Buffer.from(JSON.stringify(receipt, null, 2)), contentType: 'application/json' });
  expect(before.clientId).toBe(after.clientId);
  expect(before.frame).toBe(after.frame);
  expect(after.tick).toBeGreaterThanOrEqual(before.tick);
  expect(after.sampledAt).toBeGreaterThanOrEqual(before.sampledAt);
  return receipt;
}

async function pixels(info: TestInfo, pages: Page[], label: string, ids: number[]) {
  const receipts = [];
  for (const [i, page] of pages.entries()) {
    await acquireInput(page);
    receipts.push(await capture(info, page, i === 0 ? 'owner' : 'observer', label, ids));
  }
  return receipts;
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

async function activeFollow(info: TestInfo, pages: Page[], companion: number, owner: number, observer: number, parkedShips: number[][]) {
  if (!online.clock) throw new Error('Active follow requires the stepped clock');
  const page = pages[0]!;
  const initial: number[] = await page.evaluate((owner) => window.game.net.store.entities.get(owner).pos, owner);
  let frozen = false;
  const trail: { tick: number; owner: EntityState; companion: EntityState }[] = [];
  const away = await page.evaluate(
    ({ owner, companion }) => {
      const p = window.game.net.store.entities.get(owner).pos,
        c = window.game.net.store.entities.get(companion).pos;
      return p.map((v: number, i: number) => v + (v - c[i]) * 2);
    },
    { owner, companion },
  );
  await lookAt(page, away);
  try {
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await online.clock.thaw();
    for (let sample = 0; sample < 120; sample++) {
      const state = await page.evaluate(
        ({ owner, companion }) => ({
          tick: window.game.net.store.tick,
          owner: window.game.net.store.entities.get(owner),
          companion: window.game.net.store.entities.get(companion),
        }),
        { owner, companion },
      );
      const player = EntityState.parse(state.owner),
        creature = EntityState.parse(state.companion);
      if (creature.mode === 'follow' && creature.owner === owner && state.tick > (trail.at(-1)?.tick ?? -1)) {
        trail.push({ tick: state.tick, owner: player, companion: creature });
        if (trail.length > 3) trail.splice(1, 1);
      }
      if (distance(player.pos!, initial) > 12) throw new Error('Active-follow capture window missed');
      if (trail.length === 3 && creature.mode === 'follow' && distance(player.pos!, initial) > 7 && distance(creature.pos!, trail[0]!.companion.pos!) > 1) {
        await online.clock.freeze();
        frozen = true;
        break;
      }
      await page.waitForTimeout(50);
    }
  } finally {
    await Promise.all([page.keyboard.up('KeyW'), page.keyboard.up('ShiftLeft')]);
  }
  expect(frozen).toBe(true);
  expect(trail).toHaveLength(3);
  const last = trail.at(-1)!;
  expect(distance(last.owner.pos!, initial)).toBeGreaterThan(7);
  expect(distance(last.companion.pos!, trail[0]!.companion.pos!)).toBeGreaterThan(1);
  expect(last.tick).toBeGreaterThan(trail[0]!.tick);
  for (const client of pages)
    await until(
      client,
      `window.game.net.joined && window.game.net.store.entities.get(${companion})?.owner === ${owner} && window.game.net.store.entities.get(${companion})?.mode === 'follow'`,
      3000,
    );
  const framing = [];
  for (const client of pages) framing.push(await frameSubjects(client, [companion], parkedShips));
  const captures = await pixels(info, pages, 'follow-active', [owner, observer, companion]);
  for (const capture of captures)
    for (const endpoint of [capture.before, capture.after]) {
      const c = endpoint.subjects.find((subject) => subject.id === companion)?.wire;
      expect(c).toMatchObject({ id: companion, owner, mode: 'follow' });
    }
  await online.clock.thaw();
  return { trail, framing, captures };
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
    const ground = captureGround(arena);
    evidence.ground = ground;
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
      await acquireInput(page);
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
    const parkedShips = arrivals.map((arrival) => arrival.landed.pos!);
    await walkTo(a.page, ground.ownerMark);
    await walkTo(b.page, ground.observerMark);
    const companion = await spawn(arena, arena.companion.index, ground.companion);
    await until(a.page, 'window.game.fauna.shown.length > 0', 60_000);
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
    if (!online.clock) throw new Error('Stepped fixture clock is required');
    await online.clock.freeze();
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
    const bondFraming = [];
    for (const page of pages) bondFraming.push(await frameSubjects(page, [companion], parkedShips));
    evidence.bondFraming = bondFraming;
    evidence.bondCaptures = await pixels(info, pages, 'bond', [owner, observer, companion]);

    evidence.activeFollow = await activeFollow(info, pages, companion, owner, observer, parkedShips);
    const initialOwner: number[] = await a.page.evaluate(() => window.game.net.store.entities.get(window.game.net.entityId).pos);
    await aim(a.page, companion);
    await acquireInput(a.page);
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
    // The observer walks with the procession, staying south of the combat lane and north of both ships.
    const observerMark = await a.page.evaluate(({ east, north }) => {
      const p = window.game.net.store.entities.get(window.game.net.entityId).pos;
      return p.map((v: number, i: number) => v - east[i] * 7 - north[i] * 3);
    }, ground);
    await walkTo(b.page, observerMark);

    const enemyAt: Vec3 = await a.page.evaluate((companion) => {
      const g = window.game,
        p = g.player.state.pos.clone().fromArray(g.net.store.entities.get(g.net.entityId).pos);
      const toward = p.clone().fromArray(g.net.store.entities.get(companion).pos).sub(p);
      // The hostile approaches across the follower's lane, exposing both bodies to the owner and western observer.
      const across = toward.cross(p.clone().normalize()).normalize();
      return p.addScaledVector(across, 8).toArray();
    }, companion);
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
    // A short ordinary sidestep gives the owner a view across the contact instead of down the attack lane.
    const combatMark = await a.page.evaluate((east) => {
      const p = window.game.net.store.entities.get(window.game.net.entityId).pos;
      return p.map((v: number, i: number) => v - east[i] * 4);
    }, ground.east);
    await walkTo(a.page, combatMark);
    evidence.combatOwner = EntityState.parse(await a.page.evaluate(() => window.game.net.store.entities.get(window.game.net.entityId)));
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
    const combatFraming = [];
    for (const page of pages) combatFraming.push(await frameSubjects(page, [companion, enemy], parkedShips));
    evidence.combatFraming = combatFraming;
    evidence.combatCaptures = await pixels(info, pages, 'combat', [owner, observer, companion, enemy]);

    await aim(b.page, companion);
    const beforeRelease = await inspect(b.page, companion);
    evidence.beforeRelease = beforeRelease;
    drawn(beforeRelease, arena, companion, arena.companion.index, owner);
    expect(beforeRelease.wire.hp).toBeGreaterThan(0);
    expect(beforeRelease.picked).toBe(companion);
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
    evidence.retirementFraming = await frameSubjects(b.page, [companion, enemy], parkedShips);
    await until(b.page, 'window.game.player.grounded && window.game.player.state.vel.length() < 1e-7 && window.game.player.landShake === 0', 10_000);
    const observerBefore = await capture(info, b.page, 'observer', 'before-disconnect', [owner, observer, companion, enemy]);
    evidence.observerBefore = observerBefore;
    expect(sameCaptureView(observerBefore.before, observerBefore.after)).toBe(true);
    // Net.close() reloads this dev-login URL. Destroy the page so the owner cannot rejoin.
    await a.page.close({ runBeforeUnload: false });
    expect(a.page.isClosed()).toBe(true);
    evidence.ownerPageClosed = true;
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
    const observerAfter = await capture(info, b.page, 'observer', 'disconnect', [owner, observer, companion, enemy]);
    evidence.observerAfter = observerAfter;
    // Overlay readiness and the screenshot each consume time after the original retirement proof.
    // Validate both retained samples, after attachment, so a rejected interval keeps its evidence.
    for (const endpoint of [observerAfter.before, observerAfter.after]) {
      expect(endpoint).toMatchObject({ joined: true, clientId: observer, frame: arena.frame });
      expect(endpoint.tick).toBeGreaterThan(release.tick);
      const witness = EntityState.parse(endpoint.subjects.find((s) => s.id === observer)?.wire);
      expect(witness).toMatchObject({ id: observer, kind: 'player', frame: arena.frame, mode: 'foot' });
      expect(witness.hp).toBeGreaterThan(0);
      const retained = endpoint.subjects.find((s) => s.id === enemy);
      const target = EntityState.parse(retained?.wire);
      expect(target).toMatchObject({ id: enemy, kind: 'mob', species: arena.enemy.index, frame: arena.frame });
      expect(target.hp).toBeGreaterThan(0);
      expect(target.mode).not.toBe('dead');
      expect(retained).toMatchObject({ remote: true, shown: true, drawn: true, faunaShown: true, targeted: true });
      for (const id of [owner, companion]) {
        expect(endpoint.subjects.find((s) => s.id === id)).toMatchObject({
          wire: null,
          remote: false,
          shown: false,
          drawn: false,
          faunaShown: false,
          targeted: false,
        });
        expect(endpoint.picked).not.toBe(id);
      }
    }
    expect(observerBefore.after.clientId).toBe(observer);
    expect(sameCaptureView(observerBefore.after, observerAfter.before)).toBe(true);
    expect(sameCaptureView(observerAfter.before, observerAfter.after)).toBe(true);
    expect(errors, `${errors.join('\n')}\n${online.serverOutput()}`).toEqual([]);
  } finally {
    await info.attach('symbiotic-evidence', { body: Buffer.from(JSON.stringify({ ...evidence, errors }, null, 2)), contentType: 'application/json' });
    await info.attach('server-output', { body: Buffer.from(online.serverOutput()), contentType: 'text/plain' });
    // The imported hang guard bounds closure of both manually created contexts, including failure paths.
    await Promise.all(pages.filter((page) => !page.isClosed()).map((page) => page.evaluate(() => window.game.net?.close()).catch(() => {})));
  }
});
