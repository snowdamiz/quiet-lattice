// The game's online half (P1.E04.T01), on a Game with only the parts each method reads (no renderer): where a closed
// connection sends the player, how a correction is taken, the world clock, where a reconnect places the character, and
// leaving the world.
import * as THREE from 'three';
import { encodeServerMessage } from '@astra/shared/protocol';
import { QuestBook } from '@astra/shared/quests';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from './Game.js';
import { Inventory } from './gameplay/Inventory.js';
import { walkerQuat } from './net/pose.js';
import { FrameState } from './universe/Body.js';

/** A Game object with no constructor run: just `parts`. */
function fake(parts = {}) {
  return Object.assign(Object.create(Game.prototype), { time: 0, timeBase: 0, net: null, ...parts });
}

/** sessionStorage and localStorage as the browser keeps them. */
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
  };
}

/** The server's side of the game socket. */
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.all.push(this);
  }

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  push(m) {
    this.onmessage?.({ data: encodeServerMessage(m) });
  }

  refuse(code, reason) {
    this.push({ t: 'refused', code, reason });
    this.close(4000, code);
  }
}
FakeSocket.all = [];

const POSE = { frame: '1:station', pos: [30, 2.4, 22], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
const WELCOME = {
  t: 'welcome',
  accountId: 'a1',
  character: { id: 'c1', name: 'Tess Arlo', people: 'thalune', look: { palette: 0, pattern: 0, head: 0, suit: 0 }, level: 1, homeSystem: 0 },
  entityId: 7,
  serverTime: 1000,
  zone: { id: 'sys:0', systemSeed: 1 },
  pose: POSE,
  mode: 'docked',
};

describe('Game: where a closed connection sends the player', () => {
  let session;
  let location;

  beforeEach(() => {
    FakeSocket.all = [];
    session = memoryStorage();
    location = { protocol: 'http:', host: 'play.test', reload: vi.fn() };
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('location', location);
    vi.stubGlobal('window', { sessionStorage: session, localStorage: memoryStorage() });
  });

  afterEach(() => vi.unstubAllGlobals());

  /** A game entering the world; its welcome handling is stubbed (this is about the connection). */
  function entering() {
    const onFail = vi.fn();
    const g = fake({
      inventory: new Inventory(),
      hud: { toast: vi.fn(), social: { attach: vi.fn() } },
      menus: { setConnection: vi.fn(), showMessage: vi.fn() },
      overlay: null,
      onWelcome: vi.fn(),
    });
    session.setItem('astra-session', JSON.stringify({ token: 'tok', accountId: 'a1', username: 'pilot' }));
    g.enterWorld({ token: 'tok' }, { id: 'c1' }, onFail);
    const socket = FakeSocket.all.at(-1);
    socket.open();
    return { g, onFail, socket, net: g.net };
  }

  it('before the welcome: the sign-in hears why, and the game lets the connection go', () => {
    const { g, onFail, socket, net } = entering();
    expect(socket.url).toBe('ws://play.test/ws');
    expect(g.inventory.send).toBeTypeOf('function');
    // (chat and the party listen to the connection from the start)
    expect(g.hud.social.attach).toHaveBeenLastCalledWith(net);
    socket.refuse('character', 'That character does not exist on this account.');
    expect(onFail).toHaveBeenCalledWith('That character does not exist on this account.', 'character');
    expect(g.net).toBeNull();
    expect(g.inventory.send).toBeNull();
    expect(g.hud.social.attach).toHaveBeenLastCalledWith(null);
    expect(location.reload).not.toHaveBeenCalled();
    // the sign-in itself still stands
    expect(session.getItem('astra-session')).not.toBeNull();
  });

  it('a refused session token is forgotten', () => {
    const { onFail, socket } = entering();
    socket.refuse('auth', 'Your session is invalid or has expired. Sign in again.');
    expect(onFail).toHaveBeenCalledWith('Your session is invalid or has expired. Sign in again.', 'auth');
    expect(session.getItem('astra-session')).toBeNull();
  });

  it('after the welcome: back to the title, which shows why', () => {
    const { g, onFail, socket, net } = entering();
    socket.push(WELCOME);
    expect(g.onWelcome).toHaveBeenCalledWith(WELCOME, true);
    socket.refuse('kicked', 'This character entered the world from another connection.');
    expect(onFail).not.toHaveBeenCalled();
    expect(location.reload).toHaveBeenCalledOnce();
    expect(session.getItem('astra-notice')).toBe('This character entered the world from another connection.');
    expect(g.net).toBeNull();
    expect(net.state).toBe('closed');
  });

  it('says the connection is down for as long as it is, once in the world', () => {
    const { g, socket } = entering();
    socket.push(WELCOME);
    socket.close(1006);
    expect(g.net.state).toBe('reconnecting');
    expect(g.menus.setConnection).toHaveBeenLastCalledWith('Connection lost · reconnecting…');
    expect(g.hud.toast).toHaveBeenCalledWith('Connection lost · reconnecting', 'warn');
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('ignores the closing of a connection it has replaced', () => {
    const { g, onFail, net } = entering();
    g.enterWorld({ token: 'tok' }, { id: 'c2' }, onFail);
    expect(net.state).toBe('closed');
    expect(onFail).not.toHaveBeenCalled();
    expect(g.net).not.toBe(net);
    expect(g.net.characterId).toBe('c2');
  });

  it('leaves the world: the socket closes and the page starts over, with the notice for the title', () => {
    const close = vi.fn();
    const g = fake({ net: { close }, inventory: { send: () => {} } });
    g.leaveWorld('Signed out.');
    expect(close).toHaveBeenCalledOnce();
    expect(g.net).toBeNull();
    expect(g.inventory.send).toBeNull();
    expect(session.getItem('astra-notice')).toBe('Signed out.');
    expect(location.reload).toHaveBeenCalledOnce();
  });
});

describe('Game: a correction', () => {
  // a planet turned about y, and its Waystation off to one side, turned about x
  const planet = { kind: 'planet', position: new THREE.Vector3(1e7, 0, 0), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7) };
  const station = { kind: 'station', position: new THREE.Vector3(1e7 + 5000, 300, -200), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3) };
  const system = { seed: 1, planets: [planet] };

  /** A station-local pose expressed in the planet's frame, as the server might send it near the edge of the sphere. */
  function inPlanetFrame(pos, quat, vel) {
    const world = pos.clone().applyQuaternion(station.quaternion).add(station.position);
    const inv = planet.quaternion.clone().invert();
    return {
      frame: '1:0',
      pos: world.sub(planet.position).applyQuaternion(inv).toArray(),
      quat: inv.clone().multiply(station.quaternion).multiply(quat).toArray(),
      vel: vel.clone().applyQuaternion(station.quaternion).applyQuaternion(inv).toArray(),
    };
  }

  it("is taken re-expressed in the frame the client is in, never in the server's", () => {
    const state = new FrameState();
    state.frame = station;
    state.pos.set(30, 2.4, 22);
    const g = fake({ mode: 'ship', system, station, ship: { state, speed: 0 } });
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    g.onCorrection({ t: 'correction', seq: 3, mode: 'ship', pose: inPlanetFrame(new THREE.Vector3(30, 12.4, 22), yaw, new THREE.Vector3(0, 0, -5)) });
    expect(state.frame).toBe(station);
    expect(state.pos.distanceTo(new THREE.Vector3(30, 12.4, 22))).toBeLessThan(1e-6);
    expect(state.quat.angleTo(yaw)).toBeLessThan(1e-6);
    expect(state.vel.distanceTo(new THREE.Vector3(0, 0, -5))).toBeLessThan(1e-9);
    // its speed along the nose (−z turned by the yaw)
    expect(g.ship.speed).toBeCloseTo(5 * Math.cos(0.4), 9);
  });

  it("turns a walker to the heading the server's pose faces", () => {
    const state = new FrameState();
    state.frame = station;
    const heading = new THREE.Vector3(0, 0, -1);
    const up = new THREE.Vector3(0, 1, 0);
    const g = fake({ mode: 'foot', system, station, player: { state, heading, up: (out) => out.set(0, 1, 0) } });
    const facing = new THREE.Vector3(1, 0, 0);
    g.onCorrection({ t: 'correction', seq: 9, mode: 'foot', pose: inPlanetFrame(new THREE.Vector3(4, 0, 6), walkerQuat(up, facing), new THREE.Vector3()) });
    expect(state.frame).toBe(station);
    expect(state.pos.distanceTo(new THREE.Vector3(4, 0, 6))).toBeLessThan(1e-6);
    expect(heading.distanceTo(facing)).toBeLessThan(1e-9);
  });

  it('ignores one in a frame this system does not have, and one on the title', () => {
    const state = new FrameState();
    state.frame = station;
    state.pos.set(30, 2.4, 22);
    const g = fake({ mode: 'ship', system, station, ship: { state, speed: 0 } });
    g.onCorrection({ t: 'correction', seq: 3, mode: 'ship', pose: { ...POSE, frame: '2:station', pos: [0, 0, 0] } });
    g.mode = 'title';
    g.onCorrection({ t: 'correction', seq: 4, mode: 'ship', pose: { ...POSE, pos: [0, 0, 0] } });
    expect(state.pos.toArray()).toEqual([30, 2.4, 22]);
  });
});

describe('Game: the world clock', () => {
  /** What Game.frame does with the clock, for `n` frames of `dt` while the server's clock runs at its own pace. */
  function run(g, clock, n, dt = 1 / 60, serverRate = 1, leads = []) {
    const times = [];
    for (let i = 0; i < n; i++) {
      clock.t += dt * serverRate;
      g.advanceClock(dt);
      times.push(g.time);
      leads.push(g.time - clock.t);
    }
    return times;
  }

  function joined(serverT) {
    const clock = { t: serverT };
    const g = fake({ time: 12.5, net: { joined: true, serverTime: () => clock.t } });
    g.setWorldTime(clock.t);
    return { g, clock };
  }

  it('starts at the server time on the first welcome, the render clock carrying on where it was', () => {
    const g = fake({ time: 12.5 });
    g.setWorldTime(2.6e7);
    expect(g.time).toBe(2.6e7);
    expect(g.renderTime).toBeCloseTo(12.5, 9);
    g.setWorldTime(null);
    expect(g.time).toBe(2.6e7);
  });

  it('runs with the frames on the title and in the sandbox (no server)', () => {
    const g = fake({ time: 3 });
    g.advanceClock(0.5);
    expect([g.time, g.renderTime]).toEqual([3.5, 3.5]);
    // joined, its welcome not yet taken (the account screens hold it while the screen goes dark): still the title's
    const held = fake({ time: 3, mode: 'title', net: { joined: true, serverTime: () => 2.6e7 } });
    held.advanceClock(0.5);
    expect([held.time, held.renderTime]).toEqual([3.5, 3.5]);
  });

  it('eases toward the server clock, the render clock advancing by the frames alone', () => {
    const { g, clock } = joined(1000);
    clock.t += 0.2; // the estimate moved (a better round trip)
    run(g, clock, 600);
    expect(Math.abs(clock.t - g.time)).toBeLessThan(0.01);
    expect(g.renderTime).toBeCloseTo(12.5 + 600 / 60, 6);
  });

  it('catches up up to a second behind at no more than twice the pace, never in a step', () => {
    const { g, clock } = joined(1000);
    clock.t += 0.9; // a short stall: frames are clamped, the server's clock is not
    const before = g.time;
    const times = run(g, clock, 1200);
    const steps = times.map((t, i) => t - (i ? times[i - 1] : before));
    expect(Math.max(...steps)).toBeLessThanOrEqual((2 / 60) * (1 + 1e-9));
    expect(Math.min(...steps)).toBeGreaterThan(0);
    expect(Math.abs(clock.t - g.time)).toBeLessThan(0.05);
  });

  it('steps forward to the server clock after the frame loop stopped for a minute, and inputs carry the stepped time', () => {
    const { g, clock } = joined(1000);
    run(g, clock, 60);
    // the frame loop stops for 60 s (a hidden tab), the server's clock does not
    clock.t += 60;
    const renderBefore = g.renderTime;
    run(g, clock, 1);
    expect(g.time).toBe(clock.t);
    expect(g.renderTime).toBeCloseTo(renderBefore + 1 / 60, 9);
    // the next input is stamped with it
    const state = new FrameState();
    const station = { kind: 'station' };
    state.frame = station;
    Object.assign(g, {
      mode: 'ship',
      universe: { deep: false },
      system: { seed: 1, planets: [] },
      station,
      ship: { state, mode: 'flying', boosting: false },
      player: { jetting: false, sprinting: false },
      multitool: { firing: false },
      input: { mouse: () => false, down: () => false },
    });
    g.net.zone = { systemSeed: 1 };
    expect(g.inputSample()).toMatchObject({ time: clock.t, mode: 'ship', pose: { frame: '1:station' } });
    // and from there it eases and caps as before, never going back
    const after = run(g, clock, 120);
    expect(after.every((t, i) => t >= (i ? after[i - 1] : clock.t - 2))).toBe(true);
    expect(Math.abs(clock.t - g.time)).toBeLessThan(0.05);
  });

  it('never steps back: an estimate a second or more behind the world clock only holds it still', () => {
    const { g, clock } = joined(1000);
    clock.t -= 3;
    const before = g.time;
    run(g, clock, 60);
    expect(g.time).toBe(before);
  });

  it('never goes back and never runs more than 0.25 s ahead, however fast frames are stepped', () => {
    const { g, clock } = joined(1000);
    // frames ten times faster than the server's clock (window.step), then the estimate drops back 0.3 s
    const leads = [];
    const fast = run(g, clock, 300, 1 / 60, 0.1, leads);
    expect(Math.max(...leads)).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(Math.max(...leads)).toBeGreaterThan(0.2);
    clock.t -= 0.3;
    const after = run(g, clock, 120, 1 / 60, 1, leads);
    const all = [...fast, ...after];
    for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThanOrEqual(all[i - 1]);
    // it stood still while the server's clock caught up, and was never further ahead than that
    expect(Math.max(...leads.slice(300))).toBeLessThanOrEqual(0.25 + 0.3 + 1e-9);
    expect(g.time - clock.t).toBeLessThanOrEqual(0.25 + 1e-9);
  });
});

describe('Game: where a welcome places the character', () => {
  function world({ deep = false } = {}) {
    const systems = [
      { seed: 1, visited: true },
      { seed: 2, visited: false },
    ];
    const station = { kind: 'station' };
    const g = fake({
      galaxy: { systems, current: systems[0], setCurrent: vi.fn((s) => ((g.galaxy.current = s), (s.visited = true))) },
      system: { seed: 1, info: systems[0], planets: [{ kind: 'planet' }], star: { position: new THREE.Vector3(5, 5, 5) } },
      station,
      universe: { deep, reset: vi.fn() },
      sky: { reset: vi.fn() },
      discovered: new Set(['x']),
      net: { serverTime: () => 2000 },
      hud: { toast: vi.fn() },
      loadSystem: vi.fn(),
      placeFromServer: vi.fn(),
      startGame: vi.fn(),
    });
    return g;
  }

  it('first join: the zone system, the pose and play begin; only that system is visited', () => {
    const g = world();
    const m = { ...WELCOME, zone: { id: 'sys:1', systemSeed: 2 }, pose: { ...POSE, frame: '2:station' } };
    g.onWelcome(m, true);
    expect(g.time).toBe(2000);
    expect(g.loadSystem).toHaveBeenCalledWith(g.galaxy.systems[1]);
    expect(g.galaxy.systems.map((s) => s.visited)).toEqual([false, true]);
    expect(g.placeFromServer).toHaveBeenCalledWith(m.pose, 'docked');
    expect(g.startGame).toHaveBeenCalledOnce();
  });

  it('a reconnect in the same system and one of its frames keeps the pose the client has, and its clock', () => {
    const g = world();
    g.time = 1999;
    g.onWelcome(WELCOME, false);
    expect(g.placeFromServer).not.toHaveBeenCalled();
    expect(g.loadSystem).not.toHaveBeenCalled();
    expect(g.time).toBe(1999);
    expect(g.hud.toast).toHaveBeenCalledWith('Reconnected', 'good');
  });

  it("a reconnect in another system's zone goes there, as on a first join", () => {
    const g = world();
    const m = { ...WELCOME, zone: { id: 'sys:1', systemSeed: 2 }, pose: { ...POSE, frame: '2:0' } };
    g.onWelcome(m, false);
    expect(g.loadSystem).toHaveBeenCalledWith(g.galaxy.systems[1]);
    expect(g.placeFromServer).toHaveBeenCalledWith(m.pose, 'docked');
    expect(g.startGame).not.toHaveBeenCalled();
  });

  it('a reconnect with a pose in none of the client’s frames is placed from the server', () => {
    const g = world();
    const m = { ...WELCOME, pose: { ...POSE, frame: '1:7' } };
    g.onWelcome(m, false);
    expect(g.placeFromServer).toHaveBeenCalledWith(m.pose, 'docked');
    expect(g.loadSystem).not.toHaveBeenCalled();
  });

  it('a reconnect while out between the stars brings the system back first', () => {
    const g = world({ deep: true });
    g.onWelcome(WELCOME, false);
    expect(g.universe.reset).toHaveBeenCalledWith(g.galaxy.systems[0]);
    expect(g.system.star.position.toArray()).toEqual([0, 0, 0]);
    expect(g.sky.reset).toHaveBeenCalled();
    expect(g.placeFromServer).toHaveBeenCalledWith(POSE, 'docked');
  });
});

describe('Game: the online objective line', () => {
  it('announces a new step from the server, not a count moving on the same step', () => {
    const toasts = [];
    const book = new QuestBook();
    const objectives = {
      book,
      get current() {
        const o = book.objective();
        return o && (o.of > 1 ? `${o.text} · ${o.n}/${o.of}` : o.text);
      },
    };
    const g = fake({ objectives, hud: { toast: (t) => toasts.push(t) }, audio: { play() {} } });
    const view = (step, n) => ({ active: { first_jobs: { step, counters: { gather: n }, seen: {}, started: 0, since: 0 } }, done: {}, flags: [], offered: [] });
    g.onQuests({ t: 'quests', seq: 0, quests: view('land', 0) });
    g.onQuests({ t: 'quests', seq: 0, quests: view('gather', 0) });
    g.onQuests({ t: 'quests', seq: 0, quests: view('gather', 5) });
    g.onQuests({ t: 'quests', seq: 0, quests: view('gather', 12) });
    expect(toasts).toEqual(['Next: Gather resources · 0/25']);
    expect(objectives.current).toBe('Gather resources · 12/25');
  });
});

describe('Game: analysis (P1.E08.T04)', () => {
  const SPECIES = { key: '1:2/0', world: '1:2', index: 0, name: 'Horned Velar Bull', temperament: 'territorial', threat: 2, bodyPlan: 'quad_heavy', bond: 'big_game', at: 1000 };

  beforeEach(() => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('location', { protocol: 'http:', host: 'play.test', reload: vi.fn() });
    vi.stubGlobal('window', { sessionStorage: memoryStorage(), localStorage: memoryStorage() });
  });

  afterEach(() => vi.unstubAllGlobals());

  function online() {
    const banners = [];
    const toasts = [];
    const g = fake({
      inventory: new Inventory(),
      hud: { toast: (text, tone) => toasts.push([text, tone]), showBanner: (...b) => banners.push(b), social: { attach: vi.fn() } },
      audio: { play: vi.fn() },
      menus: { setConnection: vi.fn(), showMessage: vi.fn() },
      overlay: null,
      onWelcome: vi.fn(),
    });
    g.enterWorld({ token: 'tok' }, { id: 'c1' }, vi.fn());
    const socket = FakeSocket.all.at(-1);
    socket.open();
    return { g, socket, banners, toasts };
  }

  it('asks the server, numbering the session’s requests from 1 and stamping its world time; nothing before the welcome', () => {
    const { g, socket } = online();
    expect(g.analyze(42)).toBe(false);
    socket.push(WELCOME);
    g.time = 1000.5;
    expect(g.analyze(42)).toBe(true);
    expect(g.analyze(43)).toBe(true);
    expect(socket.sent.filter((m) => m.t === 'analyze')).toEqual([
      { t: 'analyze', seq: 1, time: 1000.5, target: 42 },
      { t: 'analyze', seq: 2, time: 1000.5, target: 43 },
    ]);
    // a new session (a reconnect's welcome) numbers from 1 again
    socket.push(WELCOME);
    g.analyze(44);
    expect(socket.sent.filter((m) => m.t === 'analyze').at(-1)).toMatchObject({ seq: 1, target: 44 });
    expect(fake({ net: null }).analyze(42)).toBe(false);
  });

  it('shows the server’s answer: the species as the codex holds it and the XP, known, or why not', () => {
    const { socket, banners, toasts } = online();
    socket.push(WELCOME);
    socket.push({ t: 'analyze', seq: 1, target: 42, result: 'new', species: SPECIES, xp: 300 });
    expect(banners).toEqual([['HORNED VELAR BULL', 'New Species Analyzed', ['Heavy quadruped · Territorial · ★★☆☆☆', 'Bond: with Big Game', '+300 XP']]]);
    socket.push({ t: 'analyze', seq: 2, target: 42, result: 'known', species: SPECIES });
    socket.push({ t: 'analyze', seq: 3, target: 42, result: 'refused', reason: 'los' });
    socket.push({ t: 'analyze', seq: 4, target: 42, result: 'refused', reason: 'stale_seq' });
    expect(toasts).toEqual([
      ['Horned Velar Bull · in your codex', undefined],
      ['No clear line to it', 'warn'],
      ['Analysis failed', 'warn'],
    ]);
    expect(banners).toHaveLength(1);
  });

  it('calls the species by the name its first finder gave it, when it has one', () => {
    const { socket, banners, toasts } = online();
    socket.push(WELCOME);
    socket.push({ t: 'discoveries', system: 0, reset: true, entries: [{ kind: 'species', key: SPECIES.key, finder: 'Bo Tran', at: 5, name: 'Velar Prime' }] });
    socket.push({ t: 'analyze', seq: 1, target: 42, result: 'new', species: SPECIES, xp: 300 });
    socket.push({ t: 'analyze', seq: 2, target: 42, result: 'known', species: SPECIES });
    expect(banners.map((b) => b[0])).toEqual(['VELAR PRIME']);
    expect(toasts).toEqual([['Velar Prime · in your codex', undefined]]);
  });

  /** A game with a walker on a world, a creature of the client's own herds in its sights, and E pressed. */
  function aiming(net) {
    const sp = { name: 'Ambling Tovar Grazer', kind: 'quad', skittish: true, size: 1.5 };
    const banners = [];
    const world = { sampler: {}, kind: 'planet' };
    const g = fake({
      net,
      mode: 'foot',
      input: { hit: (k) => k === 'KeyE', down: () => false },
      ship: { state: { frame: null, pos: new THREE.Vector3() } },
      player: { state: { frame: world, pos: new THREE.Vector3(0, 100, 0) } },
      cities: { planet: null },
      structures: { nearestInteract: () => null },
      fauna: { pick: () => ({ c: { sp }, t: 12 }), scanned: new Set(), scannedNames: new Set(), scare: vi.fn() },
      multitool: { target: null, firing: false },
      cam: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
      inventory: new Inventory(),
      hud: { showBanner: (...b) => banners.push(b) },
      audio: { play: vi.fn() },
    });
    return { g, sp, banners };
  }

  it('in the dev sandbox analyzes the client’s own creature for its quest book, and pays nothing for it', () => {
    const { g, sp, banners } = aiming(null);
    const units = g.inventory.units;
    g.handleInteractions();
    expect(g.fauna.scannedNames.has(sp.name)).toBe(true);
    expect(g.inventory.units).toBe(units);
    expect(banners).toEqual([['AMBLING TOVAR GRAZER', 'New Species Discovered', ['Quadruped · Skittish · 1.8 m']]]);
    // known now: its name only
    g.handleInteractions();
    expect(g.currentPrompt).toBe(sp.name);
    expect(banners).toHaveLength(1);
  });

  it('online leaves the client’s own creatures alone: their name, no analysis, no reward', () => {
    const net = { joined: true, send: vi.fn() };
    const { g, sp, banners } = aiming(net);
    const units = g.inventory.units;
    g.handleInteractions();
    expect(g.currentPrompt).toBe(sp.name);
    expect(g.fauna.scannedNames.size).toBe(0);
    expect(g.inventory.units).toBe(units);
    expect(banners).toEqual([]);
    expect(net.send).not.toHaveBeenCalled();
  });
});
