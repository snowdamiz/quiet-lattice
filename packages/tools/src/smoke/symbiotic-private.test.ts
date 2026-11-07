import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { EntityState } from '@astra/shared/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import {
  createSourceFile,
  isClassDeclaration,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isMethodDeclaration,
  ScriptTarget,
  transpileModule,
} from 'typescript';
import { AdminCommand } from '../../../server/src/admin/commands.ts';
import { resolvePlacement } from '../../../server/src/admin/place.ts';
import { planHere } from '../../../server/src/fauna/terrain.ts';
import { poseProblem as savedPoseProblem } from '../../../server/src/persistence/components.ts';
import { MovementAuthority } from '../../../server/src/sim/movement/authority.ts';
import { exitFeet, LARK } from '../../../server/src/sim/movement/testing.ts';
import { groundOf, heightAt } from '../../../server/src/sim/movement/world.ts';
import { describeZoneSystem } from '../../../server/src/zones/system.ts';
import { symbioticRoutes } from './symbiotic-private.ts';

const claim = '20261107_2a0b7521';
const env = {
  SYMBIOTIC_QA_CLAIM: claim,
  DATABASE_URL: `postgres://astra:astra@127.0.0.1:53055/astra_symbiotic_smoke_${claim}`,
  REDIS_URL: 'redis://127.0.0.1:53058/8',
};

describe('Symbiotic smoke private routes (no connections)', () => {
  it('keeps the exact preclaimed namespace and Redis8', () => {
    expect(symbioticRoutes(env)).toMatchObject({ claimedDatabaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL, marker: `qa:owner:${claim}` });
  });
  it.each([
    {},
    { ...env, SYMBIOTIC_QA_CLAIM: '' },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace('53055', '55432') },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace(`astra_symbiotic_smoke_${claim}`, 'astra') },
    { ...env, DATABASE_URL: `${env.DATABASE_URL}?host=elsewhere` },
    { ...env, REDIS_URL: 'redis://127.0.0.1:53058/7' },
    { ...env, REDIS_URL: 'redis://127.0.0.1:56379/8' },
  ])('refuses missing, default or differently owned routes: %j', (candidate) => {
    expect(() => symbioticRoutes(candidate)).toThrow();
  });
});

// Exercise the actual online.ts ownership paths with inert external ports. These tests never bind a socket,
// spawn an application process, import Vite's runtime, or connect to SQL/Redis.
const lifecycle = vi.hoisted(() => ({
  calls: [] as string[],
  sql: [] as string[],
  routes: [] as { DATABASE_URL: string; REDIS_URL: string }[],
  createError: null as Error | null,
  listenError: null as Error | null,
  closeError: null as Error | null,
  killError: null as Error | null,
  dropError: null as Error | null,
  migrateError: false,
  syncClose: false,
  hangClose: false,
  hangTerm: false,
  hangKill: false,
  nextPort: 31000,
}));
vi.mock('node:net', () => ({
  createServer: () => ({
    once() {},
    listen(_port: number, _host: string, ready: () => void) {
      ready();
    },
    address: () => ({ port: lifecycle.nextPort++ }),
    close: (done: () => void) => done(),
  }),
}));
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    spawnSync(_exe: string, _args: string[], options: { env: { STATEMENT?: string; DATABASE_URL: string; REDIS_URL: string } }) {
      const statement = options.env.STATEMENT;
      if (statement) {
        lifecycle.sql.push(statement);
        if (statement.startsWith('DROP') && lifecycle.dropError) throw lifecycle.dropError;
      } else {
        lifecycle.routes.push({ DATABASE_URL: options.env.DATABASE_URL, REDIS_URL: options.env.REDIS_URL });
        if (lifecycle.migrateError) return { status: 1, stderr: 'migration failed', stdout: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    spawn() {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        exitCode: null,
        signalCode: null as string | null,
        kill(signal: string) {
          lifecycle.calls.push(signal);
          if (lifecycle.killError) throw lifecycle.killError;
          if ((signal === 'SIGTERM' && lifecycle.hangTerm) || (signal === 'SIGKILL' && lifecycle.hangKill)) return true;
          queueMicrotask(() => {
            child.signalCode = signal;
            child.emit('exit', null, signal);
          });
          return true;
        },
      });
      return child;
    },
  };
});
vi.mock('vite', () => ({
  createLogger: () => ({ error() {} }),
  createServer: async () => {
    lifecycle.calls.push('createVite');
    if (lifecycle.createError) throw lifecycle.createError;
    return {
      listen: async () => {
        lifecycle.calls.push('listenVite');
        if (lifecycle.listenError) throw lifecycle.listenError;
      },
      close: () => {
        lifecycle.calls.push('closeVite');
        if (lifecycle.syncClose) throw lifecycle.closeError;
        if (lifecycle.hangClose) return new Promise<void>(() => {});
        return lifecycle.closeError ? Promise.reject(lifecycle.closeError) : Promise.resolve();
      },
    };
  },
}));

function errorTree(error: unknown): unknown[] {
  return [
    error,
    ...(error instanceof AggregateError ? error.errors.flatMap(errorTree) : []),
    ...(error instanceof Error && error.cause ? errorTree(error.cause) : []),
  ];
}
const borrowed = { claimedDatabaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL };
const start = async (options = borrowed) => (await import('./online.ts')).startOnline(options);

describe('R1 online lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(lifecycle, {
      calls: [],
      sql: [],
      routes: [],
      createError: null,
      listenError: null,
      closeError: null,
      killError: null,
      dropError: null,
      migrateError: false,
      syncClose: false,
      hangClose: false,
      hangTerm: false,
      hangKill: false,
    });
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('REDIS_URL', undefined);
    vi.stubEnv('ASTRA_SERVER', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('passes borrowed routes to migration and never creates/drops them', async () => {
    const fixture = await start();
    await fixture.stop();
    expect(lifecycle.routes).toEqual([{ DATABASE_URL: borrowed.claimedDatabaseUrl, REDIS_URL: borrowed.redisUrl }]);
    expect(lifecycle.sql).toEqual([]);
    expect(lifecycle.calls).toContain('closeVite');
    expect(lifecycle.calls).toContain('SIGTERM');
  });
  it('preserves the primary setup failure when server termination fails', async () => {
    lifecycle.createError = Error('create Vite failed');
    lifecycle.killError = Error('TERM failed');
    const error = await start().catch((e: unknown) => e);
    expect(errorTree(error)).toContain(lifecycle.createError);
    expect(errorTree(error)).toContain(lifecycle.killError);
  });
  it('closes the created handle after listen fails and preserves listen error identity', async () => {
    lifecycle.listenError = Error('listen EADDRINUSE');
    await expect(start()).rejects.toBe(lifecycle.listenError);
    expect(lifecycle.calls).toContain('closeVite');
    expect(lifecycle.calls).toContain('SIGTERM');
  });
  it('retains listen failure plus both owned stop errors', async () => {
    lifecycle.listenError = Error('listen EADDRINUSE');
    lifecycle.closeError = Error('close failed');
    lifecycle.killError = Error('TERM failed');
    const error = await start().catch((e: unknown) => e);
    for (const expected of [lifecycle.listenError, lifecycle.closeError, lifecycle.killError]) expect(errorTree(error)).toContain(expected);
    expect(lifecycle.calls).toContain('closeVite');
    expect(lifecycle.calls).toContain('SIGTERM');
  });
  it.each([false, true])('attempts all owned cleanup after Vite close fails (synchronous=%s)', async (syncClose) => {
    const fixture = await (await import('./online.ts')).startOnline();
    lifecycle.closeError = Error('close failed');
    lifecycle.killError = Error('TERM failed');
    lifecycle.dropError = Error('DROP failed');
    lifecycle.syncClose = syncClose;
    const error = await fixture.stop().catch((e: unknown) => e);
    for (const expected of [lifecycle.closeError, lifecycle.killError, lifecycle.dropError]) expect(errorTree(error)).toContain(expected);
    expect(lifecycle.calls).toContain('SIGTERM');
    expect(lifecycle.sql.some((s) => s.startsWith('DROP DATABASE IF EXISTS "astra_smoke_'))).toBe(true);
  });
  it('cleans only its own scratch database after migration fails', async () => {
    lifecycle.migrateError = true;
    await expect((await import('./online.ts')).startOnline()).rejects.toThrow('migration failed');
    expect(lifecycle.sql).toHaveLength(2);
    expect(lifecycle.sql[0]).toMatch(/^CREATE DATABASE "astra_smoke_/);
    expect(lifecycle.sql[1]).toMatch(/^DROP DATABASE IF EXISTS "astra_smoke_/);
    expect(lifecycle.routes[0]?.REDIS_URL).toBe('redis://127.0.0.1:56379/7');
  });
  it('retains both bounded close failures and attempts KILL after TERM timeout', async () => {
    const fixture = await start();
    vi.useFakeTimers();
    lifecycle.hangClose = true;
    lifecycle.hangTerm = true;
    lifecycle.hangKill = true;
    const outcome = fixture.stop().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_001);
    const messages = errorTree(await outcome)
      .filter((e): e is Error => e instanceof Error)
      .map((e) => e.message);
    expect(messages).toContain('Vite close timed out');
    expect(messages).toContain('server SIGTERM timed out');
    expect(messages).toContain('server SIGKILL timed out');
    expect(lifecycle.calls).toContain('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Evaluate the literal used by waitForFunction, not a copy of the intended condition. The objects here falsify
// the oracle only; they are not gameplay evidence or replay snapshots used in the live fixture.
const spec = readFileSync(new URL('./symbiotic-online.spec.ts', import.meta.url), 'utf8');
function predicate(marker: string) {
  const source = [...spec.matchAll(/`([^`]+)`/gs)].map((m) => m[1]!).find((s) => s.startsWith(marker));
  if (!source) throw new Error(`Live predicate missing: ${marker}`);
  const render = new Function('enemy', 'owner', 'companion', 'observer', 'arena', 'release', 'beforeHp', 'i', 'return `' + source + '`;');
  return new Function('window', 'return !!(' + render(33, 11, 22, 44, { frame: '123:4', enemy: { index: 7 } }, { tick: 30 }, [1, 1], 0) + ');');
}
const retirement = predicate('window.game.net.joined && window.game.net.entityId ===');
const combat = predicate("window.symbioticQa.messages.some(m => m.t === 'event'");
function world() {
  return {
    game: {
      net: {
        joined: true,
        entityId: 44,
        store: {
          tick: 31,
          entities: new Map<number, EntityState>([
            [33, { id: 33, kind: 'mob', species: 7, frame: '123:4', hp: 0.8, mode: 'idle' }],
            [44, { id: 44, kind: 'player', frame: '123:4', mode: 'foot', hp: 1 }],
          ]),
        },
      },
      remotes: { get: (_id: number): object | undefined => undefined },
      fauna: { shown: [] as { id: number }[] },
    },
    symbioticQa: { messages: [{ t: 'event', event: { kind: 'combat', source: 22, target: 33, amount: 12 } }] },
  };
}
describe('R1 live lifecycle predicates', () => {
  it('accepts only the fresh identified live observer/enemy control', () => expect(retirement(world())).toBe(true));
  it.each([
    {
      name: 'corpse plus missing observer',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.set(33, { id: 33, kind: 'mob', hp: 0, mode: 'dead' });
        w.game.net.store.entities.delete(44);
      },
    },
    {
      name: 'missing observer',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.delete(44);
      },
    },
    {
      name: 'dead observer',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(44)!.hp = 0;
      },
    },
    {
      name: 'different observer identity',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.entityId = 45;
      },
    },
    {
      name: 'different observer frame',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(44)!.frame = '123:5';
      },
    },
    {
      name: 'different observer kind',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(44)!.kind = 'mob';
      },
    },
    {
      name: 'dead enemy',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.hp = 0;
      },
    },
    {
      name: 'enemy corpse mode',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.mode = 'dead';
      },
    },
    {
      name: 'different enemy species',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.species = 9;
      },
    },
    {
      name: 'different enemy frame',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.frame = '123:5';
      },
    },
    {
      name: 'different enemy kind',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.kind = 'player';
      },
    },
    {
      name: 'stale snapshot',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.tick = 30;
      },
    },
    {
      name: 'disconnected observer',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.joined = false;
      },
    },
    {
      name: 'owner retained',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.set(11, { id: 11 });
      },
    },
    {
      name: 'companion snapshot retained',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.set(22, { id: 22 });
      },
    },
    {
      name: 'companion remote retained',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.remotes.get = () => ({ id: 22 });
      },
    },
    {
      name: 'companion instance retained',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.fauna.shown.push({ id: 22 });
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const w = world();
    mutate(w);
    expect(retirement(w)).toBe(false);
  });
  it('accepts a living target with actual source-attributed health loss', () => expect(combat(world())).toBe(true));
  it('rejects health loss with no companion hit', () => {
    const w = world();
    w.symbioticQa.messages = [];
    expect(combat(w)).toBe(false);
  });
  it('rejects attack phase without health loss', () => {
    const w = world();
    w.game.net.store.entities.get(33)!.hp = 1;
    expect(combat(w)).toBe(false);
  });
  it('rejects a corpse after a credited killing hit', () => {
    const w = world();
    w.game.net.store.entities.get(33)!.hp = 0;
    expect(combat(w)).toBe(false);
  });
});

// The live fixture's actual command builder, checked at the same placement/persistence boundary that rejected
// the cross-system teleport. Only the transport is collected here; production pose/ship authority runs below.
function fixturePlace(admin: (command: unknown) => Promise<unknown>) {
  const source = createSourceFile('symbiotic-online.spec.ts', spec, ScriptTarget.Latest, true);
  const declaration = source.statements.find((s) => isFunctionDeclaration(s) && s.name?.text === 'place');
  if (!declaration) throw new Error('Live place function missing');
  const code = transpileModule(declaration.getText(source), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  return new Function('online', 'expect', `${code}; return place;`)({ admin }, expect);
}
async function placement(character: string, system: number, body: number, pose: string, frame = String(body)) {
  const admin = vi.fn(async (_command: unknown) => ({ ok: true }));
  await fixturePlace(admin)(character, { system, body }, pose, frame);
  expect(admin).toHaveBeenCalledTimes(1);
  const command = AdminCommand.parse(admin.mock.calls[0]?.[0]);
  if (command.cmd !== 'teleport') throw new Error('Setup must use the existing teleport API');
  expect(command.character).toBe(character);
  return resolvePlacement(command);
}

describe('live arena setup respects owned ship authority', () => {
  it('reproduces the live cross-system foot rejection at the real persistence pose check', () => {
    const at = resolvePlacement({ system: 31, frame: 'station', pose: 'docked', mode: 'foot' });
    expect(savedPoseProblem(at, 1e6)).toBe('board_range: on foot with no ship of its own here');
  });
  it.each(['owner', 'observer'])('moves %s across systems in a restorable ship pose', async (character) => {
    const at = await placement(character, 31, 7, 'docked', 'station');
    expect(savedPoseProblem(at, 1e6)).toBeNull();
    expect(at).toMatchObject({ system: 31, mode: 'docked' });
  });
  it.each(['owner', 'observer'])('lands %s with an owned ship that remains restorable after disembarking', async (character) => {
    const system = describeZoneSystem(0);
    const ground = groundOf(system, system.home)!;
    const at = await placement(character, 0, system.home, `0,0,${-(ground.radius + heightAt(ground, [0, 0, -1]) + SHIP_GEAR_HEIGHT)}`);
    const movement = new MovementAuthority({ zone: 'setup-cpu', system, grounds: planHere });
    const profile = { ship: LARK, characterId: character, accountId: character };
    expect(movement.poseProblem(at.pose, at.mode, profile, 1e6)).toBeNull();
    movement.add(1, at.pose, at.mode, profile, 1e6);
    expect(movement.parkedOf(1)).toEqual(at.pose);
    const feet = { ...at.pose, pos: exitFeet(system, at.pose) };
    expect(movement.check(1, { t: 'input', seq: 1, time: 1e6 + 0.05, pose: feet, mode: 'foot', buttons: 0 }, 1e6 + 0.05)).toMatchObject({
      ok: true,
      mode: 'foot',
    });
    const parked = movement.parkedOf(1);
    expect(parked).toEqual(at.pose);
    expect(movement.poseProblem(feet, 'foot', profile, 1e6 + 0.05, parked ?? undefined)).toBeNull();
  });
  it('does not hide a refused admin placement', async () => {
    const reply = { ok: false, error: 'invalid', message: 'pose: board_range: on foot with no ship of its own here' };
    await expect(fixturePlace(async () => reply)('owner', { system: 31, body: 7 }, 'docked', 'station')).rejects.toThrow('board_range');
  });
});

// Real Input/UI callbacks and the Game input consumer, with only DOM/Playwright/render services replaced by CPU ports.
// This proves source ordering and refusal behavior, not native user activation, focus, or pointer-lock acceptance.
const clientFile = (path: string) =>
  createSourceFile(path, readFileSync(new URL(`../../../client/src/${path}`, import.meta.url), 'utf8'), ScriptTarget.Latest, true);
function method(path: string, name: string) {
  const source = clientFile(path);
  const cls = source.statements.filter(isClassDeclaration).find((c) => c.name?.text === path.split('/').at(-1)?.replace('.js', ''));
  const member = cls?.members.find((m) => isMethodDeclaration(m) && m.name.getText(source) === name);
  if (!member || !isMethodDeclaration(member) || !member.body) throw new Error(`Missing real method ${path}:${name}`);
  return { source, member, text: member.getText(source) };
}
const inputFile = clientFile('core/Input.js');
const InputClass = new Function(inputFile.text.replace('export class Input', 'class Input') + ';return Input;')();
const threeUrl = pathToFileURL(
  createRequire(new URL('../../../client/package.json', import.meta.url))
    .resolve('three')
    .replace(/three\.cjs$/, 'three.module.js'),
).href;
const three = await import(/* @vite-ignore */ threeUrl);
const gameMethods = new Function('_v1', '_v2', '_aim', `return {${['exitShip', 'handleInteractions'].map((n) => method('Game.js', n).text).join(',')}}`)(
  new three.Vector3(),
  new three.Vector3(),
  new three.Vector3(),
);
const playerMethods = new Function('_v', `return {${['spawn', 'up'].map((n) => method('entities/Player.js', n).text).join(',')}}`)(new three.Vector3());
const frameMethod = method('Game.js', 'frame');
const inputGate = new Function(
  frameMethod.member
    .body!.statements.slice(0, 3)
    .map((s) => s.getText(frameMethod.source))
    .join('\n'),
);
const menusFile = clientFile('ui/Menus.js');
const menuHTML = menusFile.statements.find((s) => isFunctionDeclaration(s) && s.name?.text === 'menuHTML');
if (!menuHTML) throw new Error('Missing real menuHTML');
const menuMethods = new Function(
  `${menuHTML.getText(menusFile)};return {${['buildPause', 'updatePauseHint'].map((n) => method('ui/Menus.js', n).text).join(',')}}`,
)();

class UiElement extends EventTarget {
  innerHTML = '';
  className = '';
  readonly classes = new Set<string>();
  readonly classList = {
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, show: boolean) => (show ? this.classes.add(name) : this.classes.delete(name)),
  };
  private readonly children = new Map<string, UiElement>();
  querySelector(selector: string): UiElement {
    const attribute = selector.slice(1, -1);
    if (!this.innerHTML.includes(attribute)) throw new Error(`UI does not contain ${selector}`);
    let child = this.children.get(selector);
    if (!child) {
      child = new UiElement();
      this.children.set(selector, child);
    }
    return child;
  }
}

function inputClients() {
  let active: ReturnType<typeof client> | undefined;
  function client(name: string) {
    const calls: string[] = [];
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), {
      pointerLockElement: null as object | null,
      hasFocus: () => active === result,
      querySelector: (selector: string) => {
        if (selector !== '.pause-menu.show') throw new Error(`Unexpected query ${selector}`);
        return pause.classList.contains('show') ? pause : null;
      },
    });
    const pause = new UiElement();
    const behavior = { grant: true, focus: true, clickError: false, freezeMode: false };
    let gesture = false;
    const canvas = {
      requestPointerLock() {
        calls.push('requestPointerLock');
        expect(gesture).toBe(true);
        expect(doc.hasFocus()).toBe(true);
        if (behavior.grant) {
          doc.pointerLockElement = canvas;
          doc.dispatchEvent(new Event('pointerlockchange'));
        }
        return Promise.resolve();
      },
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    const input = new InputClass(canvas);
    const frame = { kind: 'station', terminals: [] };
    const state = () => ({ frame, pos: new three.Vector3(0, 1.95, 0), vel: new three.Vector3(), quat: new three.Quaternion() });
    const player = { ...playerMethods, state: state(), heading: new three.Vector3(0, 0, -1), blend: { clear() {} } };
    const game = {
      ...gameMethods,
      mode: 'ship',
      overlay: null as string | null,
      input,
      player,
      net: { joined: true },
      ship: { mode: 'landed', state: state(), setCockpit() {} },
      director: { startPoseBlend() {} },
      audio: { play() {} },
      cam: { pos: new three.Vector3(), quat: new three.Quaternion() },
      castKeys() {},
      cities: { planet: null },
      structures: { nearestInteract: () => null },
      fauna: { pick: () => null },
      multitool: { target: null },
      frame() {
        inputGate.call(game);
        if (!behavior.freezeMode) gameMethods.handleInteractions.call(game);
        menuMethods.updatePauseHint.call(menus);
        input.endFrame();
      },
    };
    const menus = { ...menuMethods, game, pauseHint: pause, sheetsHTML: () => '', bindSheets() {}, bindSettings() {}, refreshPause() {} };
    menuMethods.buildPause.call(menus);
    menuMethods.updatePauseHint.call(menus);
    // The selector's root class comes from the actual UI constructor, not a duplicate assumed selector.
    const cls = menusFile.statements.find(isClassDeclaration);
    const constructor = cls?.members.find(isConstructorDeclaration);
    const root = constructor?.body?.statements.find((s) => s.getText(menusFile).includes('this.pauseHint = el('));
    if (!root) throw new Error('Missing pause element creation');
    new Function('el', root.getText(menusFile)).call(menus, (_tag: string, classes: string) => {
      pause.className = classes;
      return pause;
    });
    Object.assign(win, { game });
    const activate = () => {
      vi.stubGlobal('window', win);
      vi.stubGlobal('document', doc);
    };
    const page = {
      async bringToFront() {
        calls.push('front');
        if (active && active !== result) active.blur();
        if (behavior.focus) active = result;
        activate();
      },
      async evaluate(fn: () => unknown) {
        activate();
        return fn();
      },
      locator(selector: string) {
        return {
          async click() {
            calls.push('resume');
            if (behavior.clickError) throw new Error('Resume click refused');
            const [root, button] = selector.split(' ');
            for (const cls of root!.split('.').filter(Boolean)) expect([...pause.className.split(' '), ...pause.classes]).toContain(cls);
            gesture = true;
            try {
              pause.querySelector(button!).dispatchEvent(new Event('click'));
            } finally {
              gesture = false;
            }
          },
        };
      },
      keyboard: {
        async down(code: string) {
          activate();
          calls.push(`down:${code}:${input.enabled}`);
          win.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
        },
        async up(code: string) {
          activate();
          calls.push(`up:${code}`);
          win.dispatchEvent(Object.assign(new Event('keyup'), { code }));
        },
      },
      async waitForFunction(fn: (source: string) => unknown, source: string) {
        activate();
        if (source.startsWith('Math.hypot(')) {
          // The authoritative follow predicate is retained. This CPU port proves admitted held input and
          // deliberately refuses to invent a server movement result, exercising the real finally key-up.
          expect(input.down('KeyS')).toBe(true);
          throw new Error('CPU port has no authoritative follow snapshot');
        }
        for (let i = 0; i < 4; i++) if (fn(source)) return;
        throw new Error('CPU bounded wait: predicate never became true');
      },
    };
    const result = {
      name,
      calls,
      behavior,
      game,
      input,
      page,
      blur() {
        win.dispatchEvent(new Event('blur'));
        doc.pointerLockElement = null;
        doc.dispatchEvent(new Event('pointerlockchange'));
        menuMethods.updatePauseHint.call(menus);
      },
    };
    return result;
  }
  return { client };
}

function inputBlock(key: 'KeyF' | 'KeyS') {
  const down = spec.indexOf(`await ${key === 'KeyF' ? 'page' : 'a.page'}.keyboard.down('${key}')`);
  const begin = key === 'KeyF' ? spec.lastIndexOf('      // Real F interaction', down) : spec.lastIndexOf('\n', spec.lastIndexOf('\n', down) - 1);
  const end = spec.indexOf(key === 'KeyF' ? '\n      await until(' : '\n    for (const page of pages)', down);
  if (down < 0 || begin < 0 || end < 0) throw new Error(`Missing actual ${key} block`);
  const source = createSourceFile('spec.ts', spec, ScriptTarget.Latest, true);
  const declarations = source.statements
    .filter((s) => isFunctionDeclaration(s) && ['until', 'acquireInput'].includes(s.name?.text ?? ''))
    .map((s) => s.getText(source))
    .join('\n');
  const code = transpileModule(`${declarations}\nreturn (async()=>{${spec.slice(begin, end)}})();`, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  return new Function('page', 'a', 'initialOwner', code);
}
const runF = (client: ReturnType<ReturnType<typeof inputClients>['client']>) => inputBlock('KeyF')(client.page);

describe('real UI admission before fixture keyboard input', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['owner', 'observer'])('resumes initially unlocked %s through the actual UI before F', async (role) => {
    const c = inputClients().client(role);
    expect(c.input.locked).toBe(false);
    await runF(c);
    expect(c.game.mode).toBe('foot');
    expect(c.calls).toEqual(['front', 'resume', 'requestPointerLock', 'down:KeyF:true', 'up:KeyF']);
    expect(c.input.keys.size).toBe(0);
  });
  it('still rejects a failed gesture without sending F', async () => {
    const c = inputClients().client('owner');
    c.behavior.clickError = true;
    await expect(runF(c)).rejects.toThrow('Resume click refused');
    expect(c.calls.some((s) => s.startsWith('down:'))).toBe(false);
    expect(c.game.mode).toBe('ship');
  });
  it('still rejects missing focus or a lock event without sending F', async () => {
    for (const failure of ['focus', 'grant'] as const) {
      const c = inputClients().client('owner');
      c.behavior[failure] = false;
      await expect(runF(c)).rejects.toThrow('predicate never became true');
      expect(c.calls.some((s) => s.startsWith('down:'))).toBe(false);
      expect(c.game.mode).toBe('ship');
    }
  });
  it('releases F and rejects if admitted input never reaches foot', async () => {
    const c = inputClients().client('owner');
    c.behavior.freezeMode = true;
    await expect(runF(c)).rejects.toThrow('predicate never became true');
    expect(c.calls.at(-1)).toBe('up:KeyF');
    expect(c.input.keys.size).toBe(0);
  });
  it('reacquires owner input after observer F, sends S, and still rejects missing server movement', async () => {
    const clients = inputClients();
    const owner = clients.client('owner'),
      observer = clients.client('observer');
    await runF(owner);
    await runF(observer);
    expect(owner.input.locked).toBe(false);
    expect(observer.input.locked).toBe(true);
    owner.calls.length = 0;
    await expect(inputBlock('KeyS')(undefined, owner, [0, 0, 0])).rejects.toThrow('no authoritative follow snapshot');
    expect(owner.calls).toEqual(['front', 'resume', 'requestPointerLock', 'down:KeyS:true', 'up:KeyS']);
    expect(owner.input.keys.size).toBe(0);
    expect(observer.input.locked).toBe(false);
  });
  it('rejects failed owner reacquisition before sending S', async () => {
    const clients = inputClients();
    const owner = clients.client('owner'),
      observer = clients.client('observer');
    await runF(owner);
    await runF(observer);
    owner.calls.length = 0;
    owner.behavior.grant = false;
    await expect(inputBlock('KeyS')(undefined, owner, [0, 0, 0])).rejects.toThrow('predicate never became true');
    expect(owner.calls).toEqual(['front', 'resume', 'requestPointerLock']);
    expect(owner.input.keys.size).toBe(0);
  });
});

// The frozen combat sample in space-symbiotic-live-9848d004-487f1c39cc4d57f9bced/playwright.json.
// These are diagnostic CPU inputs, never live fixture state or a replacement for native picking assertions.
const combatGeometry = [
  {
    id: 34,
    species: 0,
    mode: 'attack',
    hp: 1,
    owner: 1,
    rendered: [90457.03809262079, 8199.367566916892, -24253.958297447407],
    wire: [90457.03297558716, 8199.376903541552, -24253.98479883791],
    quat: [0.14048591137210042, 0.33486291991414313, -0.6607986374984974, 0.6568680950180591],
  },
  {
    id: 35,
    species: 4,
    mode: 'attack',
    hp: 0.7000000000000001,
    rendered: [90457.82516529005, 8198.049426978165, -24252.514899896356],
    wire: [90457.73960799232, 8198.124450097484, -24252.54537550884],
    quat: [0.6608023407141798, 0.6568665413412355, 0.14049317568162029, -0.3348556121076031],
  },
];
const { Fauna } = await import(/* @vite-ignore */ new URL('../../../client/src/gameplay/Fauna.js', import.meta.url).href);
const { RemoteEntities } = await import(/* @vite-ignore */ new URL('../../../client/src/remote/RemoteEntities.js', import.meta.url).href);
const { Player } = await import(/* @vite-ignore */ new URL('../../../client/src/entities/Player.js', import.meta.url).href);
const { Body, FrameState } = await import(/* @vite-ignore */ new URL('../../../client/src/universe/Body.js', import.meta.url).href);

async function pickingScene(positions: 'rendered' | 'wire', historicalObserver: boolean) {
  const system = describeZoneSystem(31),
    body = system.bodies[7]!;
  const terrain = groundOf(system, 7, 1)!.terrain;
  const planet = new Body({ kind: 'planet', radius: body.radius });
  Object.assign(planet, {
    params: body.params,
    sampler: terrain,
    surfaceRadius(dir: { x: number; y: number; z: number }) {
      return body.radius + terrain.sample([dir.x, dir.y, dir.z]);
    },
  });
  const game = {
    time: 26816794.463613212,
    mode: 'foot',
    system: { seed: system.seed, planets: system.bodies.map((_, i) => (i === 7 ? planet : null)) },
    cam: new FrameState(),
    camWorld: new three.Vector3(),
    audio: { creature() {} },
    player: new Player({}),
  };
  const fauna = new Fauna(game);
  const remotes = new RemoteEntities(game, { view: { group: new three.Group(), draws: () => false, update() {} }, fauna });
  const g = {
    ...game,
    fauna,
    remotes,
    frame() {
      game.player.cameraState(game.cam, game.time);
      game.cam.worldPosition(game.camWorld);
      remotes.update(0);
    },
  };
  vi.stubGlobal('window', { game: g });
  // Historical R4 geometry, paired with the actual corrected R5 parked pose. The new plaza is tested separately.
  const historical = JSON.parse(
    readFileSync(new URL('../../../../docs/review-records/p1-e07-t07-t09-close-fix/evidence/retained-gameplay-evidence.json', import.meta.url), 'utf8'),
  );
  const ground = { observer: EntityState.parse(historical.arrivals[1].landed).pos! };
  const at = await placement('observer', 31, 7, ground.observer.join(','));
  const shipState = new FrameState();
  shipState.frame = planet;
  shipState.pos.fromArray(at.pose.pos);
  shipState.quat.fromArray(at.pose.quat);
  gameMethods.exitShip.call({ player: game.player, ship: { state: shipState, setCockpit() {} }, director: { startPoseBlend() {} }, audio: { play() {} } });
  const movement = new MovementAuthority({ zone: 'picker-cpu', system, grounds: planHere, tier: () => 1 });
  movement.add(2, at.pose, at.mode, { ship: LARK, characterId: 'observer', accountId: 'observer' }, 1e6);
  const feet = { ...at.pose, pos: game.player.state.pos.toArray() };
  expect(movement.check(2, { t: 'input', seq: 1, time: 1e6 + 0.05, pose: feet, mode: 'foot', buttons: 0 }, 1e6 + 0.05)).toMatchObject({
    ok: true,
    mode: 'foot',
  });
  expect(movement.parkedOf(2)).toEqual(at.pose);
  if (historicalObserver) game.player.state.pos.fromArray([90459.63067075181, 8182.309815300965, -24244.532920952992]);
  game.player.grounded = true;
  const entities = combatGeometry.map((e) => ({
    id: e.id,
    kind: 'mob',
    species: e.species,
    mode: e.mode,
    hp: e.hp,
    owner: e.owner,
    frame: '1262081916:7',
    pos: e[positions],
    quat: e.quat,
    vel: [0, 0, 0],
  }));
  remotes.ingest(new Map(entities.map((e) => [e.id, e])), game.time, game.time, null);
  g.frame();
  const source = createSourceFile('spec.ts', spec, ScriptTarget.Latest, true);
  const aimSource = source.statements.find((s) => isFunctionDeclaration(s) && s.name?.text === 'aim');
  if (!aimSource) throw new Error('Missing real aim');
  const aim = new Function(
    'until',
    transpileModule(aimSource.getText(source), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText + ';return aim;',
  )(async () => {});
  const positionsBefore = remotes.list.map((r: { pos: { toArray(): number[] } }) => r.pos.toArray());
  await aim({ evaluate: async (fn: (id: number) => unknown, id: number) => fn(id) }, 34);
  return { g, positionsBefore, dispose: () => fauna.reset() };
}

describe('companion picker sightline through real camera and instances', () => {
  afterEach(() => vi.unstubAllGlobals());
  for (const positions of ['rendered', 'wire'] as const) {
    it(`reproduces the historical nearer enemy using ${positions} positions`, async () => {
      const s = await pickingScene(positions, true);
      try {
        const dir = new three.Vector3(0, 0, -1).applyQuaternion(s.g.cam.quat);
        expect(s.g.fauna.pick(s.g.cam.frame, s.g.cam.pos, dir, 70)?.id).toBe(35);
      } finally {
        s.dispose();
      }
    });
    it(`places the observer with a clear companion sightline using ${positions} positions`, async () => {
      const s = await pickingScene(positions, false);
      try {
        const dir = new three.Vector3(0, 0, -1).applyQuaternion(s.g.cam.quat);
        expect(s.g.fauna.pick(s.g.cam.frame, s.g.cam.pos, dir, 70)?.id, JSON.stringify({ eye: s.g.cam.pos.toArray(), ray: dir.toArray() })).toBe(34);
        expect(s.g.remotes.list.map((r: { pos: { toArray(): number[] } }) => r.pos.toArray())).toEqual(s.positionsBefore);
        for (const r of s.g.remotes.list) {
          expect(r.drawn).toBe(true);
          const d = s.g.fauna.worlds.get(r.frame).drawn.get(r.species);
          expect(d.mesh.isInstancedMesh).toBe(true);
          expect(d.mesh.count).toBe(1);
          const matrix = new three.Matrix4();
          d.mesh.getMatrixAt(0, matrix);
          expect(new three.Vector3().setFromMatrixPosition(matrix).distanceTo(r.world.clone().sub(s.g.camWorld))).toBeLessThan(1e-4);
          expect(new three.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(d.sp.size, 5);
        }
      } finally {
        s.dispose();
      }
    });
  }
});
