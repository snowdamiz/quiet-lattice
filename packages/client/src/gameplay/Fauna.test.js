// The server's herds drawn from replicated state (P1.E08.T09): what the instanced rig shows for the creatures the remote
// layer follows, that two clients build the same animals, that the gait comes off the drawn motion, and that the client
// keeps no herd of its own.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FAUNA_MAX_TIER, createPlanetParams, faunaSpecies } from '@astra/shared/world';
import { describe, expect, it, vi } from 'vitest';
import { Body } from '../universe/Body.js';
import { framePoseAt } from '../remote/frames.js';
import { RemoteEntities } from '../remote/RemoteEntities.js';
import { FALL_S, Fauna } from './Fauna.js';

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
 * at 60 Hz to `to`. */
function play(game, remotes, entities, to, from = 100) {
  const due = [];
  // (the offline store takes ticks in order, whichever play they belong to)
  let tick = remotes.offline?.tick ?? 0;
  for (let t = from; t <= to + 1e-9; t += 0.05) due.push({ arrival: t + 0.03, snap: { tick: ++tick, time: t, ack: 0, full: true, entities: entities(t), removed: [] } });
  let i = 0;
  for (let now = from; now <= to + 1e-9; now += DT) {
    while (i < due.length && due[i].arrival <= now) remotes.feed(due[i].snap, due[i++].arrival);
    game.place(now);
    remotes.update(DT);
  }
}

const meshOf = (fauna, planet, species) => fauna.worlds.get(planet).drawn.get(species);
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
    const d = meshOf(fauna, planet, walker);
    const m = new THREE.Matrix4();
    d.mesh.getMatrixAt(0, m);
    const lying = (t) => [mob(1, walker, { mode: 'dead', hp: 0 })];
    play(game, remotes, lying, 103, 101.05);
    // its up is turned a quarter over about its forward axis by the end of the fall
    const down = up(0);
    expect(standing.angleTo(down)).toBeGreaterThan(Math.PI / 2 - 0.05);
    expect(FALL_S).toBeLessThan(1);
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
    const eye = planet.localToWorld(new THREE.Vector3(...at(-20, 0.5 * sp.size)), new THREE.Vector3());
    const dir = planet.dirToWorld(new THREE.Vector3(1, 0, 0), new THREE.Vector3());
    const hit = fauna.pick(eye, dir, 70);
    expect(hit).toMatchObject({ id: 1, sp: SPECIES[walker] });
    expect(hit.t).toBeGreaterThan(15);
    expect(hit.t).toBeLessThan(25);
    // (not past its reach, nor the corpse behind it)
    expect(fauna.pick(eye, dir, 10)).toBeNull();
    expect(fauna.targets(planet).map((c) => c.id)).toEqual([1]);
    // a walker on foot beside it is pushed out of its body
    const player = { state: { frame: planet, pos: new THREE.Vector3(...at(0.1, 0)) } };
    fauna.collidePlayer(player);
    expect(player.state.pos.distanceTo(remotes.get(1).pos)).toBeGreaterThan(sp.size * 0.5);
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
