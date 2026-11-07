// CPU controls execute the live fixture functions and actual world/input/render math. No browser or pixels are produced.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { EntityState } from '@astra/shared/protocol';
import { SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import * as world from '@astra/shared/world';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSourceFile, forEachChild, isFunctionDeclaration, isVariableDeclaration, ScriptTarget, transpileModule, type Node } from 'typescript';
import { resolvePlacement } from '../../../server/src/admin/place.ts';
import { planHere } from '../../../server/src/fauna/terrain.ts';
import { MovementAuthority } from '../../../server/src/sim/movement/authority.ts';
import { exitFeet, LARK } from '../../../server/src/sim/movement/testing.ts';
import { describeZoneSystem } from '../../../server/src/zones/system.ts';

const spec = readFileSync(new URL('./symbiotic-online.spec.ts', import.meta.url), 'utf8');
const ast = createSourceFile('spec.ts', spec, ScriptTarget.Latest, true);
function fixture(name: string, ports: Record<string, unknown> = {}) {
  const fn = ast.statements.find((s) => isFunctionDeclaration(s) && s.name?.text === name);
  if (!fn) throw new Error(`Missing fixture function ${name}`);
  const code = transpileModule(fn.getText(ast), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(ports), `${code};return ${name};`)(...Object.values(ports));
}
function fixtureValue(name: string, ports: Record<string, unknown>) {
  let text: string | undefined;
  const visit = (node: Node) => {
    if (isVariableDeclaration(node) && node.name.getText(ast) === name) text = node.initializer?.getText(ast);
    forEachChild(node, visit);
  };
  visit(ast);
  if (!text) throw new Error(`Missing live value ${name}`);
  const code = transpileModule(`async function value() { return ${text}; }`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(ports), `${code};return value();`)(...Object.values(ports));
}
const selectArena = fixture('selectArena', world);
const captureGround = fixture('captureGround', { ...world, SHIP_GEAR_HEIGHT });
const arena = selectArena(new world.Galaxy(world.GALAXY_SEED).systems.map((s) => world.tierOf(s)));
const ground = captureGround(arena);
const params = (() => {
  const p = world.describeGalaxySystem(new world.Galaxy(world.GALAXY_SEED).systems[arena.system]!).bodies[arena.body]!.params;
  if (p.type === 'gas') throw new Error('Expected rocky arena');
  return p;
})();
const plan = world.drawnGround(params, 1);
const vectorUrl = pathToFileURL(
  createRequire(new URL('../../../client/package.json', import.meta.url))
    .resolve('three')
    .replace(/three\.cjs$/, 'three.module.js'),
).href;
const THREE = await import(/* @vite-ignore */ vectorUrl);
const { Player } = await import(/* @vite-ignore */ new URL('../../../client/src/entities/Player.js', import.meta.url).href);
const { Body, FrameState } = await import(/* @vite-ignore */ new URL('../../../client/src/universe/Body.js', import.meta.url).href);
const { Input } = await import(/* @vite-ignore */ new URL('../../../client/src/core/Input.js', import.meta.url).href);
const { Fauna } = await import(/* @vite-ignore */ new URL('../../../client/src/gameplay/Fauna.js', import.meta.url).href);
const { RemoteEntities } = await import(/* @vite-ignore */ new URL('../../../client/src/remote/RemoteEntities.js', import.meta.url).href);
const vec = (a: number[]) => new THREE.Vector3().fromArray(a);
const same = fixture('sameCaptureView');

afterEach(() => vi.unstubAllGlobals());

describe('visibility staging on the actual eligible world', () => {
  it('keeps the previously proved species and selects a real open plaza', () => {
    expect(arena).toMatchObject({ system: 31, body: 7, companion: { index: 0 }, enemy: { index: 4 } });
    expect(arena.plaza).toBeGreaterThan(100);
    expect(arena.plaza).toBeLessThan(120); // The initial scratch proposal's >=120 could never select this arena.
  });
  it.each(['owner', 'observer'])('parks %s through real placement and disembark authority', (role) => {
    const at = resolvePlacement({ system: arena.system, frame: String(arena.body), pose: ground[role].join(','), mode: 'landed' });
    const system = describeZoneSystem(arena.system);
    const movement = new MovementAuthority({ zone: 'visibility-cpu', system, grounds: planHere, tier: () => 1 });
    const profile = { ship: LARK, characterId: role, accountId: role };
    movement.add(1, at.pose, at.mode, profile, 1e6);
    const feet = { ...at.pose, pos: exitFeet(system, at.pose) };
    expect(movement.check(1, { t: 'input', seq: 1, time: 1e6 + 0.05, pose: feet, mode: 'foot', buttons: 0 }, 1e6 + 0.05)).toMatchObject({
      ok: true,
      mode: 'foot',
    });
    expect(movement.parkedOf(1)).toEqual(at.pose);
    expect(movement.poseProblem(feet, 'foot', profile, 1e6 + 0.05, at.pose)).toBeNull();
  });
  it('keeps staging and the bounded procession on existing flora-free paving, outside buildings', () => {
    const frame = world.cityFrame(arena.city),
      buildings = world.layoutCity(arena.city, world.streetPlan(arena.city)).buildings;
    const samples = [ground.owner, ground.observer, ground.companion, ground.ownerMark, ground.observerMark];
    // Corridor includes the 12 m active-follow cap + original 14 m walk and observer's southern flank.
    for (let x = -27; x <= 12; x += 3)
      for (let y = -18; y <= 6; y += 3) samples.push(world.cityPoint(arena.city, frame, arena.radius, -arena.plaza * 0.65 + x, y, 0).toArray());
    for (const p of samples) {
      const dir = vec(p).normalize();
      expect(plan.sampler.padWear(dir.x, dir.y, dir.z)).toBeGreaterThan(0.3);
      const u = (dir.dot(frame.east) / dir.dot(frame.up)) * arena.radius,
        v = (dir.dot(frame.north) / dir.dot(frame.up)) * arena.radius;
      expect(Math.hypot(u, v)).toBeGreaterThan(arena.plaza * 0.24 + 8); // centre landmark
      for (const [x, y, radius] of buildings) expect(Math.hypot(u - x, v - y) - radius).toBeGreaterThan(3);
    }
    const worker = readFileSync(new URL('../../../client/src/terrain/chunkWorker.js', import.meta.url), 'utf8');
    expect(worker).toContain('if (sampler.padWear(d[0], d[1], d[2]) > 0.3) continue;');
  });
});

function scene(at = ground.ownerMark, rows = [{ id: 34, species: arena.companion.index, pos: ground.companion }]) {
  const events = new Map<string, ((e: unknown) => void)[]>();
  const listen = (key: string, fn: (e: unknown) => void) => events.set(key, [...(events.get(key) ?? []), fn]);
  const emit = (key: string, event: unknown) => {
    for (const fn of events.get(key) ?? []) fn(event);
  };
  const doc = { pointerLockElement: null as unknown, addEventListener: listen, hasFocus: () => true, querySelector: () => null };
  const realm = { addEventListener: listen };
  vi.stubGlobal('window', realm);
  vi.stubGlobal('document', doc);
  const canvas = {
    requestPointerLock() {
      doc.pointerLockElement = canvas;
      emit('pointerlockchange', {});
    },
  };
  const input = new Input(canvas);
  const planet = new Body({ kind: 'planet', radius: arena.radius });
  Object.assign(planet, {
    params,
    sampler: plan.sampler,
    surfaceRadius: (dir: { x: number; y: number; z: number }) => arena.radius + plan.sampler.height(dir.x, dir.y, dir.z),
  });
  const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.1, 1e7);
  const game = {
    player: new Player({}),
    input,
    cam: new FrameState(),
    camWorld: new THREE.Vector3(),
    camWorldQuat: new THREE.Quaternion(),
    system: { seed: arena.seed, planets: Array.from({ length: arena.body + 1 }, (_, i) => (i === arena.body ? planet : null)) },
    time: 1000,
    mode: 'foot',
    overlay: null,
    engine: { camera, renderer: { info: { render: { frame: 0 } }, getPixelRatio: () => 1 } },
    net: { joined: true, entityId: 1, store: { tick: 100, time: 1000, ack: 20, entities: new Map<number, unknown>() } },
  };
  const fauna = new Fauna(game);
  const remotes = new RemoteEntities(game, { view: { group: new THREE.Group(), draws: () => false, update() {} }, fauna });
  const g = {
    ...game,
    fauna,
    remotes,
    frame() {
      game.player.update(0, input);
      input.endFrame();
      game.player.cameraState(game.cam, game.time);
      game.cam.worldPosition(game.camWorld);
      game.cam.worldQuaternion(game.camWorldQuat);
      camera.position.set(0, 0, 0);
      camera.quaternion.copy(game.camWorldQuat);
      camera.updateMatrixWorld(true);
      remotes.update(0);
      fauna.group.updateMatrixWorld(true);
      game.engine.renderer.info.render.frame++;
    },
  };
  Object.assign(realm, { game: g });
  game.player.spawn(planet, vec(at), vec(ground.east));
  game.player.grounded = true;
  const entities = rows.map((r) => ({
    ...r,
    kind: 'mob',
    frame: arena.frame,
    quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec(r.pos).normalize()).toArray(),
    vel: [0, 0, 0],
    hp: 1,
    owner: 1,
    mode: 'follow',
  }));
  for (const e of entities) game.net.store.entities.set(e.id, e);
  game.net.store.entities.set(1, { id: 1, kind: 'player', frame: arena.frame, mode: 'foot', pos: at, hp: 1 });
  remotes.ingest(new Map(entities.map((e) => [e.id, e])), game.time, game.time, null);
  g.frame();
  let mouse = [0, 0];
  const calls: string[] = [];
  const page = {
    evaluate: async (fn: (...args: unknown[]) => unknown, arg: unknown) => fn(arg),
    mouse: {
      move: async (x: number, y: number) => {
        calls.push('mouse');
        emit('mousemove', { movementX: x - mouse[0]!, movementY: y - mouse[1]! });
        mouse = [x, y];
      },
    },
    keyboard: {
      down: async (code: string) => {
        calls.push(`down:${code}`);
        emit('keydown', { code, preventDefault() {} });
      },
      up: async (code: string) => {
        calls.push(`up:${code}`);
        emit('keyup', { code });
      },
    },
  };
  const acquireInput = async () => {
    calls.push('gesture');
    input.lock();
  };
  const lookAt = fixture('lookAt', { acquireInput });
  const frameSubjects = fixture('frameSubjects', { lookAt, expect });
  return { g, input, page, lookAt, frameSubjects, calls, close: () => fauna.reset() };
}

describe('actual input, instances and camera framing', () => {
  it('acquires input and converges through actual mouse events and Player.update', async () => {
    const s = scene();
    try {
      await s.lookAt(s.page, ground.companion);
      expect(s.calls[0]).toBe('gesture');
      const want = vec(ground.companion).sub(s.g.cam.pos).normalize(),
        actual = new THREE.Vector3(0, 0, -1).applyQuaternion(s.g.cam.quat);
      expect(want.angleTo(actual)).toBeLessThan(0.006);
    } finally {
      s.close();
    }
  });
  it('rejects ignored mouse motion instead of directly writing a look transform', async () => {
    const s = scene();
    const look = fixture('lookAt', { acquireInput: async () => {} });
    try {
      await expect(look(s.page, ground.companion)).rejects.toThrow('Real mouse look');
    } finally {
      s.close();
    }
  });
  it('releases W when a real-source walk wait rejects', async () => {
    const s = scene();
    const walk = fixture('walkTo', {
      lookAt: s.lookAt,
      until: async () => {
        throw new Error('arrival refused');
      },
    });
    try {
      await expect(walk(s.page, ground.companion)).rejects.toThrow('arrival refused');
      expect(s.input.keys.size).toBe(0);
      expect(s.calls.at(-1)).toBe('up:KeyW');
    } finally {
      s.close();
    }
  });
  it.each(['ownerMark', 'observerMark'])('frames the whole actual procedural instance from %s without parked ships in view', async (mark) => {
    const s = scene(ground[mark]);
    try {
      const out = await s.frameSubjects(s.page, [34], [ground.owner, ground.observer]);
      expect(out.bounds[0].species).toBe(arena.companion.index);
    } finally {
      s.close();
    }
  });
  it('rejects the old near-body cropping through real instance projection', async () => {
    const at = vec(ground.companion).addScaledVector(vec(ground.east), -1).toArray(),
      s = scene(at);
    try {
      await expect(s.frameSubjects(s.page, [34], [ground.owner, ground.observer])).rejects.toThrow();
    } finally {
      s.close();
    }
  });
  it('rejects an observer too far away to distinguish the body', async () => {
    const at = vec(ground.ownerMark).addScaledVector(vec(ground.east), -40).toArray(),
      s = scene(at);
    try {
      await expect(s.frameSubjects(s.page, [34], [ground.owner, ground.observer])).rejects.toThrow();
    } finally {
      s.close();
    }
  });
  it('rejects overlapping combatants instead of equating drawn with visible', async () => {
    const s = scene(ground.ownerMark, [
      { id: 34, species: 0, pos: ground.companion },
      { id: 35, species: 4, pos: ground.companion },
    ]);
    try {
      await expect(s.frameSubjects(s.page, [34, 35], [ground.owner, ground.observer])).rejects.toThrow();
    } finally {
      s.close();
    }
  });
  it('rejects a foreground ship even when the body geometry projects inside the image', async () => {
    const s = scene();
    try {
      await expect(s.frameSubjects(s.page, [34], [ground.companion, ground.observer])).rejects.toThrow();
    } finally {
      s.close();
    }
  });
});

function view(s: ReturnType<typeof scene>) {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 720);
  return fixture('captureView')(s.page, [1, 34, 35]);
}

describe('per-image provenance and fixed observer camera', () => {
  it('binds actual entity, frame, projection and renderer samples to exact attachment bytes', async () => {
    const s = scene();
    const attach = vi.fn(),
      screenshot = vi.fn(async () => Buffer.from('inert screenshot bytes - not native pixels'));
    const capture = fixture('capture', { captureView: () => view(s), createHash, expect });
    try {
      const receipt = await capture(
        { attach },
        { ...s.page, screenshot, waitForFunction: async (fn: () => unknown) => expect(fn()).toBe(true) },
        'observer',
        'before-disconnect',
        [1, 34, 35],
      );
      expect(receipt).toMatchObject({
        name: 'before-disconnect-observer',
        role: 'observer',
        pngSha256: createHash('sha256')
          .update(await screenshot())
          .digest('hex'),
        before: { clientId: 1, frame: arena.frame, tick: 100 },
      });
      expect(receipt.before.subjects[1].wire).toMatchObject({ id: 34, owner: 1, species: 0 });
      expect(receipt.before.subjects[2].wire).toBeNull();
      expect(attach.mock.calls.map((c) => c[0])).toEqual(['before-disconnect-observer', 'before-disconnect-observer-binding']);
      expect(same(receipt.before, receipt.after)).toBe(true);
    } finally {
      s.close();
    }
  });
  it.each(['position', 'rotation', 'projection', 'client', 'bob'])('rejects actual %s drift', async (change) => {
    const s = scene();
    try {
      const before = await view(s);
      if (change === 'position') s.g.player.state.pos.addScaledVector(vec(ground.east), 0.01);
      if (change === 'rotation') s.g.player.heading.applyAxisAngle(s.g.player.up(new THREE.Vector3()), 0.01);
      if (change === 'bob') s.g.player.bob = 1;
      if (change === 'client') s.g.net.entityId = 2;
      if (change === 'projection') {
        s.g.engine.camera.fov = 71;
        s.g.engine.camera.updateProjectionMatrix();
      }
      if (change === 'client') s.g.net.store.entities.set(2, { id: 2, frame: arena.frame });
      s.g.frame();
      expect(same(before, await view(s))).toBe(false);
    } finally {
      s.close();
    }
  });
  it('accepts unchanged camera across newer actual store ticks and equivalent quaternion sign', async () => {
    const s = scene();
    try {
      const before = await view(s);
      s.g.net.store.tick++;
      const after = await view(s);
      after.camera.quat = after.camera.quat.map((v: number) => -v);
      expect(same(before, after)).toBe(true);
    } finally {
      s.close();
    }
  });
});

// This producer uses the real Player movement and companionStep/terrain before the fixture samples its wire ports.
// The transport and screenshot sink are inert. It proves a feasible follow window, never live replication or pixels.
async function followControl(fault?: 'idle' | 'stunned' | 'owner' | 'capture') {
  const { newCreature, orientation } = await import('../../../server/src/fauna/ai.ts');
  const { companionStep } = await import('../../../server/src/fauna/symbiotic.ts');
  const { Ground } = await import('../../../server/src/fauna/terrain.ts');
  const s = scene(),
    g = s.g;
  const herd = { id: 1, species: arena.companion, home: ground.companion, level: 2, members: [], apex: false, intrusion: new Map() };
  const c = newCreature({
    id: 34,
    herd,
    species: arena.companion,
    slot: 0,
    scale: 1,
    pos: [ground.companion[0], ground.companion[1], ground.companion[2]],
    heading: ground.east,
    rng: new world.Random(1),
  });
  if (fault === 'stunned') c.stunUntil = Infinity;
  const terrain = new Ground(params, plan.pads);
  let frozen = true,
    captures = 0,
    steps = 0;
  const store = () => {
    g.net.store.entities.set(1, {
      id: 1,
      kind: 'player',
      mode: 'foot',
      frame: arena.frame,
      hp: 1,
      pos: g.player.state.pos.toArray(),
      quat: g.player.state.quat.toArray(),
      vel: g.player.state.vel.toArray(),
    });
    g.net.store.entities.set(34, {
      id: 34,
      kind: 'mob',
      species: 0,
      mode: fault === 'idle' ? 'idle' : c.state,
      frame: arena.frame,
      hp: 1,
      owner: fault === 'owner' ? 2 : 1,
      pos: [...c.pos],
      quat: orientation(c),
      vel: [0, 0, 0],
    });
  };
  store();
  const page = {
    ...s.page,
    waitForTimeout: async (ms: number) => {
      if (frozen) throw new Error('sampled frozen clock');
      const dt = ms / 1000;
      g.player.update(dt, s.input);
      s.input.endFrame();
      g.time += dt;
      steps++;
      const owner = { id: 1, pos: g.player.state.pos.toArray(), onFoot: true, hidden: false, veiled: false, phase: null };
      companionStep(
        c,
        { dt, now: g.time, ground: terrain, rng: new world.Random(2), players: new Map([[1, owner]]), creatures: new Map([[34, c]]) },
        owner.pos,
        undefined,
      );
      g.net.store.tick++;
      store();
      g.remotes.ingest(new Map([[34, g.net.store.entities.get(34)]]), g.time, g.time, null);
      g.frame();
    },
  };
  const active = fixture('activeFollow', {
    online: {
      clock: {
        freeze: async () => {
          frozen = true;
        },
        thaw: async () => {
          frozen = false;
        },
      },
    },
    EntityState,
    expect,
    distance: (a: number[], b: number[]) => vec(a).distanceTo(vec(b)),
    lookAt: s.lookAt,
    until: async (_page: unknown, source: string) => expect(new Function(`return (${source})`)()).toBe(true),
    frameSubjects: s.frameSubjects,
    pixels: async () => {
      captures++;
      if (fault === 'capture') throw new Error('capture rejected');
      const endpoint = await view(s);
      return [{ before: endpoint, after: endpoint }];
    },
  });
  try {
    const result = await active({}, [page], 34, 1, 2, [ground.owner, ground.observer]);
    return { result, steps, captures, frozen };
  } finally {
    expect(s.input.keys.size).toBe(0);
    s.close();
  }
}

describe('bounded active-follow capture from the real motion producer', () => {
  it('gets newer moving follow samples before freezing and capturing', async () => {
    const out = await followControl();
    expect(out.steps).toBeGreaterThan(3);
    expect(out.steps).toBeLessThan(120);
    expect(out.captures).toBe(1);
    expect(out.frozen).toBe(false);
    expect(out.result.trail).toHaveLength(3);
  });
  it.each(['idle', 'stunned', 'owner'] as const)('rejects %s evidence with keys released and no capture', async (fault) => {
    await expect(followControl(fault)).rejects.toThrow('Active-follow capture window missed');
  });
  it('retains a screenshot failure instead of claiming an active follow picture', async () => {
    await expect(followControl('capture')).rejects.toThrow('capture rejected');
  });
});

it.each(['owner', 'observer'])('frames actual companion approach across the hostile lane for %s', async (role) => {
  const { newCreature, orientation } = await import('../../../server/src/fauna/ai.ts');
  const { companionStep } = await import('../../../server/src/fauna/symbiotic.ts');
  const { Ground } = await import('../../../server/src/fauna/terrain.ts');
  const frame = world.cityFrame(arena.city),
    origin = world.cityPoint(arena.city, frame, arena.radius, -arena.plaza * 0.65 - 20, -7, 0);
  const toward = vec(ground.east).multiplyScalar(8).addScaledVector(vec(ground.north), 3).normalize();
  const at = (direction: typeof toward, d: number) =>
    origin
      .clone()
      .addScaledVector(direction, d)
      .normalize()
      .multiplyScalar(arena.radius + arena.city.base)
      .toArray();
  const across = toward.clone().cross(origin.clone().normalize()).normalize();
  const cAt = at(toward, 3);
  const setup = scene(origin.toArray(), [{ id: 34, species: 0, pos: cAt }]);
  const ports = { a: { page: setup.page }, ground, companion: 34 };
  const eAt = await fixtureValue('enemyAt', ports),
    observer = await fixtureValue('observerMark', ports),
    combatMark = await fixtureValue('combatMark', ports);
  setup.close();
  const creature = (id: number, species: typeof arena.companion, pos: typeof cAt) =>
    newCreature({
      id,
      species,
      pos,
      heading: across.toArray(),
      slot: 0,
      scale: 1,
      rng: new world.Random(id),
      herd: { id, species, home: pos, level: 2, members: [], apex: false, intrusion: new Map() },
    });
  const c = creature(34, arena.companion, cAt),
    e = creature(35, arena.enemy, eAt);
  let hit = false;
  const terrain = new Ground(params, plan.pads),
    owner = { id: 1, pos: origin.toArray(), onFoot: true, hidden: false, veiled: false, phase: null };
  for (let i = 0; i < 100 && !hit; i++)
    companionStep(
      c,
      {
        dt: 0.05,
        now: 100 + i * 0.05,
        ground: terrain,
        rng: new world.Random(3),
        players: new Map([[1, owner]]),
        creatures: new Map([
          [34, c],
          [35, e],
        ]),
        strike: () => {
          hit = true;
        },
      },
      owner.pos,
      e,
    );
  expect(hit).toBe(true);
  const s = scene(role === 'owner' ? owner.pos : observer, [
    { id: 34, species: 0, pos: c.pos },
    { id: 35, species: 4, pos: e.pos },
  ]);
  try {
    if (role === 'owner') {
      const until = async (_page: unknown, source: string, timeout: number) => {
        for (let ms = 0; ms < timeout; ms += 50) {
          s.g.player.update(0.05, s.input);
          s.input.endFrame();
          s.g.net.store.entities.set(1, { id: 1, kind: 'player', frame: arena.frame, mode: 'foot', pos: s.g.player.state.pos.toArray(), hp: 1 });
          s.g.frame();
          if (new Function(`return (${source})`)()) return;
        }
        throw new Error('CPU walk did not reach its real movement predicate');
      };
      await fixture('walkTo', { lookAt: s.lookAt, until })(s.page, combatMark);
      expect(s.g.player.state.pos.distanceTo(origin)).toBeGreaterThan(2.5);
    }
    // Use the actual AI headings, not the default CPU model orientation.
    for (const body of [c, e]) {
      const wire = EntityState.parse(s.g.net.store.entities.get(body.id));
      s.g.net.store.entities.set(body.id, { ...wire, quat: orientation(body) });
    }
    s.g.remotes.ingest(
      new Map([
        [34, s.g.net.store.entities.get(34)],
        [35, s.g.net.store.entities.get(35)],
      ]),
      s.g.time,
      s.g.time,
      null,
    );
    s.g.frame();
    const framed = await s.frameSubjects(s.page, [34, 35], [ground.owner, ground.observer]);
    expect(framed.bounds).toHaveLength(2);
  } finally {
    s.close();
  }
});
