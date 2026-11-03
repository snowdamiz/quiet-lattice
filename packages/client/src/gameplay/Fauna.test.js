// The server's herds drawn from replicated state (P1.E08.T09): what the instanced rig shows for the creatures the remote
// layer follows, that two clients build the same animals, that the gait comes off the drawn motion, and that the client
// keeps no herd of its own.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FAUNA_MAX_TIER, createPlanetParams, faunaSpecies } from '@astra/shared/world';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Body } from '../universe/Body.js';
import { framePoseAt } from '../remote/frames.js';
import { RemoteEntities } from '../remote/RemoteEntities.js';
import * as combat from '@astra/shared/combat';
import { FALL_S, Fauna } from './Fauna.js';
import { HUD } from '../ui/HUD.js';
import { CombatFeed } from '../net/combat.js';
import { play as replayHerd } from '../remote/replay.js';
import { faunaFlyerKillPose } from '../../../tools/src/capture/screens.ts';

vi.mock('@astra/shared/combat', async (original) => {
  const real = await original();
  return { ...real, creatureSphere: vi.fn(real.creatureSphere) };
});

const SEED = 7;
const Q = [0, 0, 0, 1];
const DT = 1 / 60;
const PARAMS = createPlanetParams(11, 'lush', 60000);
const SPECIES = faunaSpecies(PARAMS, FAUNA_MAX_TIER);
const GROUND = 60000;

/** A rocky world with fauna spinning on its orbit, and a game with the parts the layers read. */
function world() {
  const star = new Body({ name: 'star', kind: 'star' });
  const planet = new Body({ name: 'planet', parent: star, orbitRadius: 6e6, orbitPeriod: 15548, rotationPeriod: 3080, radius: GROUND, soi: 1.2e6 });
  planet.params = PARAMS;
  planet.surfaceRadius = () => GROUND;
  const station = new Body({ name: 'station', kind: 'station', parent: planet, orbitRadius: 155000, orbitPeriod: 2400, soi: 4500 });
  const game = {
    time: 0,
    mode: 'title',
    system: { seed: SEED, planets: [planet] },
    station,
    camWorld: new THREE.Vector3(),
    audio: { creature: vi.fn() },
    place(t) {
      this.time = t;
      for (const b of [star, planet, station]) {
        framePoseAt(b, t, b);
        b.quaternionInv.copy(b.quaternion).invert();
      }
    },
  };
  game.fauna = new Fauna(game);
  const remotes = new RemoteEntities(game, { view: { group: new THREE.Group(), draws: () => false, update: () => {} }, fauna: game.fauna });
  return { game, planet, remotes, fauna: game.fauna };
}

const frameId = `${SEED}:0`;
/** The planet-local position `h` m over the ground at colatitude 0 (the pole), shifted `x` m along x. */
const at = (x, h = 0) => [x, GROUND + h, 0];
const mob = (id, species, extra = {}) => ({ id, kind: 'mob', frame: frameId, pos: at(id), quat: Q, vel: [0, 0, 0], mode: 'idle', species, level: 2, hp: 1, ...extra });

/** Plays the entities `at(t)` gives into the layer at the zone's 20 Hz, each snapshot arriving 30 ms late, and runs frames
 * at 60 Hz to `to`, calling `each(now)` after each frame. */
function play(game, remotes, entities, to, from = 100, each = null) {
  const due = [];
  // (the offline store takes ticks in order, whichever play they belong to)
  let tick = remotes.offline?.tick ?? 0;
  for (let t = from; t <= to + 1e-9; t += 0.05) due.push({ arrival: t + 0.03, snap: { tick: ++tick, time: t, ack: 0, full: true, entities: entities(t), removed: [] } });
  let i = 0;
  for (let now = from; now <= to + 1e-9; now += DT) {
    while (i < due.length && due[i].arrival <= now) remotes.feed(due[i].snap, due[i++].arrival);
    game.place(now);
    remotes.update(DT);
    each?.(now);
  }
}

const meshOf = (fauna, planet, species) => fauna.worlds.get(planet)?.drawn.get(species);
/** The translation of instance `k` of a species mesh, camera-relative. */
const instanceAt = (d, k) => new THREE.Vector3().setFromMatrixPosition(d.mesh.getMatrixAt(k, new THREE.Matrix4()));

describe('Fauna: the server’s herds, drawn', () => {
  it('draws each creature the snapshots name as an instance of its species’ rig, where it is placed through its frame', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    game.camWorld.copy(planet.localToWorld(new THREE.Vector3(...at(0, 50)), new THREE.Vector3()));
    const herd = [mob(1, 0), mob(2, 0), mob(3, 1)];
    play(game, remotes, () => herd, 101);
    expect(meshOf(fauna, planet, 0).mesh.count).toBe(2);
    expect(meshOf(fauna, planet, 1).mesh.count).toBe(1);
    // (camera-relative, as the ships are: its world position less the camera's)
    const r = remotes.get(1);
    expect(r).toMatchObject({ kind: 'mob', species: 0, level: 2, shown: true, drawn: true });
    const want = r.world.clone().sub(game.camWorld);
    expect(instanceAt(meshOf(fauna, planet, 0), 0).distanceTo(want)).toBeLessThan(1e-3);
    // a species the world does not carry is followed but not drawn
    play(game, remotes, () => [mob(9, SPECIES.length + 3)], 101.5, 101);
    expect(remotes.get(9)).toMatchObject({ shown: false, drawn: false });
  });

  it('builds the same animals on every client: a species’ body comes from the shared list, not from anything local', () => {
    const a = world();
    const b = world();
    for (const w of [a, b]) {
      w.game.place(100);
      play(w.game, w.remotes, () => [mob(1, 2 % SPECIES.length)], 100.6);
    }
    const index = 2 % SPECIES.length;
    const [da, db] = [a, b].map((w) => meshOf(w.fauna, w.planet, index));
    expect(da.sp).toEqual(SPECIES[index]);
    for (const key of ['position', 'color', 'aLimb', 'aPivot']) expect(Array.from(da.geo.attributes[key].array)).toEqual(Array.from(db.geo.attributes[key].array));
    expect(da.mat.customProgramCacheKey()).toBe(db.mat.customProgramCacheKey());
  });

  it('shows a creature only while the snapshots name it, and not one from another world', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    // (the creature is in two snapshots, then gone from the next; it leaves once the render time reaches the first without it)
    const tick = (t) => (t < 100.1 ? [mob(1, 0)] : []);
    play(game, remotes, tick, 101);
    expect(remotes.get(1)).toBeUndefined();
    expect(meshOf(fauna, planet, 0).mesh.count).toBe(0);
    // a frame the system has no body for holds nothing to draw
    play(game, remotes, () => [mob(5, 0, { frame: `${SEED}:5` })], 102, 101.5);
    expect(remotes.get(5)).toMatchObject({ shown: false });
  });

  it('reads the gait off how fast the creature is drawn moving: standing, walking and running, and flapping always', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    const walker = SPECIES.findIndex((s) => s.kind !== 'flyer');
    const flyer = SPECIES.findIndex((s) => s.kind === 'flyer');
    const sp = SPECIES[walker];
    const ents = (t) => [
      mob(1, walker),
      // walking along x at the species' pace
      mob(2, walker, { pos: at(10 + sp.walk * (t - 100)), vel: [sp.walk, 0, 0], mode: 'wander' }),
      mob(3, walker, { pos: at(20 + sp.run * (t - 100)), vel: [sp.run, 0, 0], mode: 'flee' }),
      ...(flyer >= 0 ? [mob(4, flyer, { pos: at(30, 20), mode: 'fly' })] : []),
    ];
    play(game, remotes, ents, 103);
    const d = meshOf(fauna, planet, walker);
    const gaits = Array.from(d.gait.array.slice(0, 3));
    expect(gaits[0]).toBeCloseTo(0, 2);
    expect(gaits[1]).toBeGreaterThan(0.9);
    expect(gaits[1]).toBeLessThan(1.1);
    expect(gaits[2]).toBeGreaterThan(1.3);
    // a walker that moves keeps stepping; one that stands does not
    const phases = Array.from(d.phase.array.slice(0, 3));
    expect(phases[1]).toBeGreaterThan(phases[0]);
    if (flyer >= 0) expect(meshOf(fauna, planet, flyer).gait.array[0]).toBe(1);
  });

  it('puts a creature the server calls dead on its side where it fell, and a flyer’s down to the ground', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    game.camWorld.copy(planet.localToWorld(new THREE.Vector3(...at(0, 30)), new THREE.Vector3()));
    const walker = SPECIES.findIndex((s) => s.kind !== 'flyer');
    const alive = (t) => [mob(1, walker, { mode: 'idle' })];
    play(game, remotes, alive, 101);
    const up = (k) => new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(meshOf(fauna, planet, walker).mesh.getMatrixAt(k, new THREE.Matrix4()))).normalize();
    const standing = up(0);
    const lying = (t) => [mob(1, walker, { mode: 'dead', hp: 0 })];
    play(game, remotes, lying, 103, 101.05);
    // its up is turned a quarter over about its forward axis by the end of the fall
    const down = up(0);
    expect(standing.angleTo(down)).toBeGreaterThan(Math.PI / 2 - 0.05);
    expect(FALL_S).toBeLessThan(1);
  });

  it('drops a flyer the server calls dead from where it flew to the ground, turned over', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    game.camWorld.copy(planet.localToWorld(new THREE.Vector3(...at(0, 30)), new THREE.Vector3()));
    const flyer = SPECIES.findIndex((s) => s.kind === 'flyer');
    expect(flyer).toBeGreaterThanOrEqual(0);
    const height = (k) => {
      // (the creature's height over the ground, along the world's up at the pole)
      const want = remotes.get(1).world.clone().sub(game.camWorld);
      return instanceAt(meshOf(fauna, planet, flyer), k).y - want.y;
    };
    play(game, remotes, () => [mob(1, flyer, { pos: at(0, 20), mode: 'fly' })], 101);
    expect(height(0)).toBeCloseTo(0, 3);
    play(game, remotes, () => [mob(1, flyer, { pos: at(0, 20), mode: 'dead', hp: 0 })], 103, 101.05);
    // (it fell 4.9·t²: a second on, it has dropped to the ground it flew over, never through it)
    const fell = height(0);
    expect(fell).toBeLessThan(-10);
    expect(fell).toBeGreaterThanOrEqual(-20.001);
  });

  it('lays a creature first seen already dead on its side at once, without playing its fall', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    game.camWorld.copy(planet.localToWorld(new THREE.Vector3(...at(0, 30)), new THREE.Vector3()));
    const walker = SPECIES.findIndex((s) => s.kind !== 'flyer');
    const rolls = [];
    play(game, remotes, () => [mob(1, walker, { mode: 'dead', hp: 0 })], 101, 100, () => {
      const d = meshOf(fauna, planet, walker);
      if (d?.mesh.count) rolls.push(new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(d.mesh.getMatrixAt(0, new THREE.Matrix4()))).angleTo(new THREE.Vector3(0, 1, 0)));
    });
    expect(rolls.length).toBeGreaterThan(5);
    // (from the first frame it is drawn, it is down)
    for (const roll of rolls) expect(roll).toBeGreaterThan(Math.PI / 2 - 0.05);
  });

  it('keeps no herd of its own: with no snapshots about, a camera on a world with fauna draws nothing', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    game.mode = 'foot';
    game.player = { state: { worldPosition: (out) => planet.localToWorld(out.set(...at(0, 2)), out) } };
    game.camWorld.copy(planet.localToWorld(new THREE.Vector3(...at(0, 2)), new THREE.Vector3()));
    play(game, remotes, () => [], 160, 100);
    expect(fauna.shown).toEqual([]);
    for (const w of fauna.worlds.values()) for (const d of w.drawn.values()) expect(d.mesh.count).toBe(0);
    expect(fauna.group.children.every((c) => c.count === 0)).toBe(true);
    // (nothing in it spawns, thinks or rolls dice for a herd)
    for (const name of ['spawnHerd', 'think', 'move', 'setPlanet', 'scare']) expect(fauna[name], name).toBeUndefined();
    const source = readFileSync(new URL('./Fauna.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Math\.random\(/);
    expect(source).not.toMatch(/\b(spawnHerd|think)\s*\(/);
  });

  it('is solid to a walking player, and picks the creature in the crosshair by the hit sphere the server tests by', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    const walker = SPECIES.findIndex((s) => s.kind !== 'flyer');
    const sp = SPECIES[walker];
    play(game, remotes, () => [mob(1, walker, { pos: at(0) }), mob(2, walker, { pos: at(30), mode: 'dead', hp: 0 })], 101);
    // (in the world's own coordinates, where the camera is: the ray and the creatures never disagree by a frame's motion)
    const eye = new THREE.Vector3(...at(-20, 0.5 * sp.size));
    const dir = new THREE.Vector3(1, 0, 0);
    const hit = fauna.pick(planet, eye, dir, 70);
    expect(hit).toMatchObject({ id: 1, sp: SPECIES[walker] });
    expect(hit.t).toBeGreaterThan(15);
    expect(hit.t).toBeLessThan(25);
    // (not past its reach, nor the corpse behind it, nor from another frame)
    expect(fauna.pick(planet, eye, dir, 10)).toBeNull();
    expect(fauna.pick(game.station, eye, dir, 70)).toBeNull();
    expect(fauna.targets(planet).map((c) => c.id)).toEqual([1]);
    // a walker on foot beside it is pushed out of its body
    const player = { state: { frame: planet, pos: new THREE.Vector3(...at(0.1, 0)) } };
    fauna.collidePlayer(player);
    expect(player.state.pos.distanceTo(remotes.get(1).pos)).toBeGreaterThan(sp.size * 0.5);
  });

  it('keeps the creatures already written when a species outgrows its room partway through a frame', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    game.camWorld.copy(planet.localToWorld(new THREE.Vector3(...at(0, 50)), new THREE.Vector3()));
    const herd = Array.from({ length: 40 }, (_, i) => mob(i + 1, 0, { pos: at(i * 3) }));
    let checked = 0;
    let room = 0;
    play(game, remotes, () => herd, 100.6, 100, () => {
      const d = meshOf(fauna, planet, 0);
      // (the frame the herd was first drawn in is the frame its species' room doubled: read it before the next frame rewrites it)
      if (!d || checked || d.mesh.count < 40) return;
      room = d.max;
      for (let k = 0; k < 40; k++) {
        const r = remotes.get(k + 1);
        expect(instanceAt(d, k).distanceTo(r.world.clone().sub(game.camWorld)), `instance ${k}`).toBeLessThan(1e-3);
        expect(d.seed.array[k], `seed ${k}`).toBeCloseTo(r.vis.seed, 5);
        expect(d.phase.array[k], `phase ${k}`).toBeCloseTo(r.vis.phase, 5);
      }
      checked++;
    });
    expect(checked).toBe(1);
    expect(room).toBeGreaterThan(32);
    // the room it left is let go, not left behind in the group
    expect(fauna.group.children.filter((c) => c.isInstancedMesh)).toHaveLength(1);
  });

  it('turns a creature toward the heading the server gives, never faster than 270°/s, and keeps its heading once it is dead', () => {
    const { game, planet, remotes } = world();
    game.place(100);
    game.camWorld.copy(planet.localToWorld(new THREE.Vector3(...at(0, 30)), new THREE.Vector3()));
    const walker = SPECIES.findIndex((s) => s.kind !== 'flyer');
    const yaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
    const heading = () => remotes.get(1)?.vis.heading.clone();
    const rates = [];
    let last = null;
    const track = () => {
      const h = heading();
      if (h && last) rates.push(h.angleTo(last) / DT);
      last = h;
    };
    // facing one way; at 101 the server has it facing a quarter turn round
    play(game, remotes, (t) => [mob(1, walker, { quat: t < 101 ? Q : yaw(Math.PI / 2) })], 101.4, 100, track);
    expect(Math.max(...rates)).toBeLessThanOrEqual(((270 * Math.PI) / 180) * 1.001);
    // (a quarter turn at the cap takes a third of a second, and is not done a frame after the server's word)
    expect(heading().angleTo(remotes.get(1).worldQuat)).toBeGreaterThan(0.05);
    play(game, remotes, () => [mob(1, walker, { quat: yaw(Math.PI / 2) })], 103, 101.45, track);
    expect(heading().angleTo(remotes.get(1).worldQuat)).toBeLessThan(0.01);

    // a creature that goes down while the server swings its heading round keeps the heading the player last saw
    const b = world();
    b.game.place(100);
    b.game.camWorld.copy(b.planet.localToWorld(new THREE.Vector3(...at(0, 30)), new THREE.Vector3()));
    let seen = null;
    let started = null;
    const after = [];
    play(b.game, b.remotes, (t) => [mob(1, walker, t < 101 ? { quat: Q } : { quat: yaw(Math.PI / 2), mode: 'dead', hp: 0 })], 102, 100, () => {
      const r = b.remotes.get(1);
      if (!r) return;
      started ??= r.worldQuat.clone();
      if (r.pose.mode !== 'dead') seen = r.vis.heading.clone();
      else after.push(r.vis.heading.clone());
    });
    expect(after.length).toBeGreaterThan(30);
    for (const h of after) expect(h.angleTo(seen), 'heading once dead').toBe(0);
    // (not swung round to the server's)
    expect(seen.angleTo(started)).toBeLessThan(0.5);
  });

  it('passes over a creature plainly off the ray without making its sphere', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    const walker = SPECIES.findIndex((s) => s.kind !== 'flyer');
    const herd = [mob(1, walker, { pos: at(0, 0) }), ...Array.from({ length: 10 }, (_, i) => mob(i + 2, walker, { pos: at(10 + i * 5, 60) }))];
    play(game, remotes, () => herd, 101);
    const eye = new THREE.Vector3(...at(-20, 0.5));
    vi.mocked(combat.creatureSphere).mockClear();
    const hit = fauna.pick(planet, eye, new THREE.Vector3(1, 0, 0), 70);
    expect(hit).toMatchObject({ id: 1 });
    // (the one in the ray's way only: the ten 60 m over it were never tested)
    expect(vi.mocked(combat.creatureSphere)).toHaveBeenCalledTimes(1);
  });

  it('grows its instances past their first capacity as the herds grow', () => {
    const { game, planet, remotes, fauna } = world();
    game.place(100);
    const herd = Array.from({ length: 80 }, (_, i) => mob(i + 1, 0, { pos: at(i * 3) }));
    play(game, remotes, () => herd, 101);
    const d = meshOf(fauna, planet, 0);
    expect(d.mesh.count).toBe(80);
    expect(d.max).toBeGreaterThanOrEqual(80);
    expect(d.phase.array.length).toBe(d.max);
    // (one mesh in the group, not the first one left behind)
    expect(fauna.group.children.filter((c) => c.isInstancedMesh)).toHaveLength(1);
  });
});

describe('Fauna’s displayed hit anchor', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stage(width = 1920) {
    const planet = new Body({ name: 'planet', kind: 'planet', radius: GROUND });
    planet.params = PARAMS;
    planet.surfaceRadius = () => GROUND;
    const sp = SPECIES.find((s) => s.kind === 'flyer');
    const camera = new THREE.PerspectiveCamera(70, width / 1080, 0.1, 1e5);
    camera.updateMatrixWorld();
    const records = new Map();
    const game = {
      mode: 'title', engine: { camera },
      camWorld: new THREE.Vector3(0, GROUND + 18, 20), camWorldQuatInv: new THREE.Quaternion(),
      audio: { creature() {} }, remotes: { get: (id) => records.get(id) },
    };
    const fauna = (game.fauna = new Fauna(game));
    const r = {
      id: 7, kind: 'mob', frame: planet, species: sp.index, shown: true,
      world: new THREE.Vector3(...at(0, 20)), worldQuat: new THREE.Quaternion(),
      pos: new THREE.Vector3(...at(0, 20)), status: 'hold', hp: 1,
      pose: { mode: 'fly', vel: new THREE.Vector3() },
    };
    records.set(r.id, r);
    const element = () => ({
      children: [], style: {}, isConnected: true,
      appendChild(e) { e.parent = this; this.children.push(e); },
      remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((e) => e !== this); },
      animate() {},
      getAnimations() { return [{ pause() {}, currentTime: 0 }]; },
    });
    vi.stubGlobal('window', { innerWidth: width, innerHeight: 1080 });
    vi.stubGlobal('document', { createElement: element, querySelector: () => h.hitsEl.children[0] });
    const h = Object.create(HUD.prototype);
    Object.assign(h, { game, hitsEl: element(), t: 0, now: () => h.t, later: () => 0, toast: vi.fn() });
    game.hud = h;
    const feed = new CombatFeed({ on() {}, entityId: 1, now: () => h.t });
    // Read the actual displayed transform, without reproducing any fall-motion formula.
    const projected = (record = r) => {
      const p = instanceAt(meshOf(fauna, record.frame, record.species), 0);
      const up = record.world.clone().sub(record.frame.position).normalize();
      p.addScaledVector(up, sp.size * 0.5).applyQuaternion(game.camWorldQuatInv).applyMatrix4(camera.projectionMatrix);
      return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * 1080 };
    };
    return { game, fauna, planet, r, sp, h, feed, projected };
  }

  it.each([1920, 2520])('keeps a live killing blow on the actual falling flyer instance at %i×1080, with rewards and offscreen expiry', (width) => {
    const { game, fauna, planet, r, sp, h, feed, projected } = stage(width);
    fauna.update([r], DT);
    expect(h.hitAnchor(r).y).toBeCloseTo(projected().y, 3);
    const serverPos = r.pos.clone();
    const serverWorld = r.world.clone();
    r.pose.mode = 'dead';
    r.hp = 0;
    fauna.update([r], DT);
    const before = instanceAt(meshOf(fauna, planet, sp.index), 0);
    feed.event({ kind: 'combat', source: 1, target: r.id, amount: 26, killed: true, hp: 0 });
    feed.event({ kind: 'xp', amount: 30, level: 1 });
    feed.event({ kind: 'loot', item: 'units', count: 7 });
    h.updateHits(feed);
    const number = h.hitsEl.children[0];
    for (let i = 0; i < 42; i++) fauna.update([r], DT);
    h.t = 700;
    h.updateHits(feed);
    expect(instanceAt(meshOf(fauna, planet, sp.index), 0).y).toBeLessThan(before.y - 2);
    expect(h.hitAnchor(r).y).toBeCloseTo(projected().y, 3);
    expect(Number.parseFloat(number.style.top)).toBeCloseTo(projected().y, 3);
    expect(h.hitsEl.children).toEqual([number]);
    expect(number.textContent).toBe('26');
    expect(number.style.color).toBe('var(--accent-hi)');
    expect(number.style.fontSize).toBe('26px');
    expect(h.toast.mock.calls).toEqual([
      ['+30 XP', 'good', { repeat: true }],
      ['+7 units', 'good', { repeat: true }],
    ]);
    expect(r.pos.equals(serverPos)).toBe(true);
    expect(r.world.equals(serverWorld)).toBe(true);
    const published = fauna.hitAnchor(r).clone();
    h.hitAnchor(r);
    h.hitAnchor(r);
    expect(fauna.hitAnchor(r).equals(published)).toBe(true);
    game.camWorldQuatInv.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    h.t = 750;
    h.updateHits(feed);
    expect(h.hitsEl.children).toEqual([]);
    game.camWorldQuatInv.identity();
    h.t = 800;
    h.updateHits(feed);
    expect(h.hitsEl.children).toEqual([]);
    fauna.reset();
  });

  it('invalidates anchors when a record leaves, is culled, is replaced or reset, and republishes through its current frame', () => {
    const { game, fauna, r, h, projected } = stage();
    fauna.update([r], DT);
    expect(fauna.hitAnchor(r)).not.toBeNull();
    fauna.update([], DT);
    expect(fauna.hitAnchor(r)).toBeNull();
    fauna.update([r], DT);
    r.shown = false;
    fauna.update([r], DT);
    expect(fauna.hitAnchor(r)).toBeNull();
    r.shown = true;
    r.world.x = 400;
    fauna.update([r], DT);
    expect(fauna.hitAnchor(r)).toBeNull();
    r.world.x = 0;
    const replacement = { ...r, vis: null };
    fauna.update([replacement], DT);
    expect(fauna.hitAnchor(r)).toBeNull();
    expect(fauna.hitAnchor(replacement)).not.toBeNull();
    const frame = new Body({ name: 'other planet', kind: 'planet', radius: GROUND });
    frame.params = PARAMS;
    frame.surfaceRadius = () => GROUND;
    frame.position.set(5000, -5000, 9000);
    frame.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6);
    replacement.frame = frame;
    frame.localToWorld(replacement.pos, replacement.world);
    frame.localToWorld(new THREE.Vector3(0, GROUND + 18, 20), game.camWorld);
    game.camWorldQuatInv.copy(frame.quaternion).invert();
    game.remotes.get = () => replacement;
    fauna.update([replacement], DT);
    expect(h.hitAnchor(replacement).x).toBeCloseTo(projected(replacement).x, 3);
    expect(h.hitAnchor(replacement).y).toBeCloseTo(projected(replacement).y, 3);
    fauna.reset();
    expect(fauna.hitAnchor(replacement)).toBeNull();
    expect(h.hitAnchor(replacement)).toBeNull();
  });

  it.each(['session reset', 'record replacement'])('expires old feedback across a %s and same-ID redraw before the next HUD update', (change) => {
    const { game, fauna, planet, sp, h, feed, projected } = stage();
    game.system = { seed: SEED, planets: [planet] };
    game.station = new Body({ kind: 'station' });
    game.time = 100;
    const remotes = (game.remotes = new RemoteEntities(game, {
      view: { group: new THREE.Group(), draws: () => false, update() {} }, fauna,
    }));
    const snapshot = (tick, time, x) => ({ tick, time, ack: 0, full: true, removed: [], entities: [mob(7, sp.index, { pos: at(x, 20), mode: 'fly' })] });
    const initial = snapshot(1, 100, 0);
    expect(remotes.feed(initial, 100)).toBe(true);
    remotes.update(DT);
    const previous = remotes.get(7);
    feed.event({ kind: 'combat', source: 1, target: 7, amount: 17, killed: false, hp: 1 });
    h.updateHits(feed);
    const oldNumber = h.hitsEl.children[0];
    expect(oldNumber.textContent).toBe('17');
    expect(Number.parseFloat(oldNumber.style.left)).toBeCloseTo(projected(previous).x, 3);
    if (change === 'session reset') {
      remotes.reset();
      fauna.reset();
    } else remotes.remove(0);
    // Reset/removal and the new instance's draw both happen before any HUD update observes the gap.
    game.time = 100.05;
    expect(remotes.feed(snapshot(change === 'session reset' ? 1 : 2, 100.05, 8), 100.05)).toBe(true);
    remotes.update(DT);
    const current = remotes.get(7);
    expect(current).not.toBe(previous);
    expect(fauna.hitAnchor(previous)).toBeNull();
    expect(fauna.hitAnchor(current)).not.toBeNull();
    expect(projected(current).x).toBeGreaterThan(Number.parseFloat(oldNumber.style.left) + 300);
    h.t = 50;
    h.updateHits(feed);
    expect(h.hitsEl.children).toEqual([]);
    expect(oldNumber.isConnected).toBe(false);
    expect(h.hitLive).toEqual([]);
    feed.event({ kind: 'combat', source: 1, target: 7, amount: 23, killed: false, hp: 1 });
    h.updateHits(feed);
    const fresh = h.hitsEl.children[0];
    expect(fresh).not.toBe(oldNumber);
    expect(fresh.textContent).toBe('23');
    expect(Number.parseFloat(fresh.style.left)).toBeCloseTo(projected(current).x, 3);
    const startX = Number.parseFloat(fresh.style.left);
    expect(remotes.feed(snapshot(3, 100.1, 10), 100.1)).toBe(true);
    for (let i = 1; i <= 20; i++) {
      game.time = 100.1 + i * DT;
      remotes.update(DT);
      h.t = 50 + i * DT * 1000;
      h.updateHits(feed);
      expect(remotes.get(7)).toBe(current);
      expect(h.hitsEl.children).toEqual([fresh]);
      expect(Number.parseFloat(fresh.style.left)).toBeCloseTo(projected(current).x, 3);
    }
    expect(Number.parseFloat(fresh.style.left)).toBeGreaterThan(startX + 1);
    expect(initial.entities[0].pos).toEqual(at(0, 20));
    expect(remotes.offline.entities.get(7).pos).toEqual(at(10, 20));
    fauna.reset();
  });

  it.each([1920, 2520])('the new flyer still consumes a replay death and actual CombatFeed kill on the falling instance at %i×1080', async (width) => {
    const { game, fauna, planet, h, feed } = stage(width);
    game.time = 0;
    game.system = { seed: SEED, planets: [planet] };
    game.station = new Body({ kind: 'station' });
    game.player = { state: { frame: planet, pos: new THREE.Vector3(...at(0, 0.5)) }, heading: new THREE.Vector3(0, 0, -1) };
    const remotes = (game.remotes = new RemoteEntities(game, { view: { group: new THREE.Group(), draws: () => false, update() {} }, fauna }));
    replayHerd(game, 'herd', { seconds: 40, kills: { 601: 9, 603: 23.6, 606: 9 } });
    const event = vi.spyOn(feed, 'event');
    const step = async (n) => {
      for (let i = 0; i < n; i++) {
        game.time += DT;
        remotes.update(DT);
        h.updateHits(feed);
      }
    };
    const herd = {
      async stepTo(at) { await step(Math.max(0, Math.round((at - game.time) * 60))); },
      async aim(id, frames) {
        for (let i = 0; i < frames; i++) {
          const r = remotes.get(id);
          const mid = r.pos.clone().addScaledVector(r.pos.clone().normalize(), fauna.speciesOf(r).size * 0.55);
          game.engine.camera.lookAt(mid.sub(game.camWorld));
          game.engine.camera.updateMatrixWorld();
          game.camWorldQuatInv.copy(game.engine.camera.quaternion).invert();
          await step(1);
        }
      },
      hit(target, amount, killed) { feed.event({ kind: 'combat', source: 1, target, amount, killed, hp: killed ? 0 : 0.5 }); },
    };
    Object.assign(window, { game, __feed: feed, __herd: herd, step });
    await herd.stepTo(2.4);
    await faunaFlyerKillPose();
    const receipt = window.__flyerKill;
    expect(receipt).toMatchObject({ offlineReplay: true, target: 606, speciesKind: 'flyer', beforeMode: 'fly', mode: 'dead', viewport: [width, 1080] });
    expect(receipt.number).toMatchObject({ value: '26', fontSize: '26px', color: 'var(--accent-hi)', sameRecord: true });
    expect(receipt.number.ageMs).toBeCloseTo(700, 6);
    expect(receipt.fallAgeMs).toBeGreaterThanOrEqual(700);
    expect(receipt.fallAgeMs).toBeLessThan(750);
    expect(receipt.sourcePositionAfter).toEqual(receipt.sourcePosition);
    expect(receipt.number.left).toBeCloseTo(receipt.projectedAnchor.x, 3);
    expect(receipt.number.top).toBeCloseTo(receipt.projectedAnchor.y, 3);
    expect(event.mock.calls.map(([e]) => e)).toEqual([
      { kind: 'combat', source: 1, target: 606, amount: 26, killed: true, hp: 0 },
      { kind: 'xp', amount: 30, level: 1 },
      { kind: 'loot', item: 'units', count: 7 },
    ]);
    const wire = remotes.offline.entities.get(606);
    expect(wire).toMatchObject({ mode: 'dead', hp: 0 });
    expect(new THREE.Vector3(...wire.pos).distanceTo(new THREE.Vector3(...receipt.sourcePosition))).toBeLessThan(1e-8);
    expect(feed.dealt).toEqual([]);
    window.__restoreFaunaHudClock();
    fauna.reset();
  });
});
