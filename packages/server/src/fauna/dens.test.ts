// Dens and night in a zone (P1.E08.T03), with a forced clock: the zone is stepped at world times chosen to be day or
// night where the test stands (sky.ts), so the same place is tried by day and by night.
import { PACK_RULES } from '@astra/shared/data';
import { APEX_FOOTPRINT, denKindFor, type FaunaSpecies, type PlanetParams, type Tier } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { along, faunaWorld, openGround, type FaunaWorld } from '../../test/faunaWorld.ts';
import { groundDistance, RULES } from './ai.ts';
import type { Vec3 } from './cells.ts';
import { APEX_RESPAWN_S, DEN_RESPAWN_S, LAIR_M, SPAWN_CLEAR_M, type DenInfo } from './dens.ts';
import { HERD_SPREAD_M, planNightHerd, tangents, type HerdPlan } from './herds.ts';
import { MAX_CREATURES, UNLOAD_S, type CreatureInfo } from './sim.ts';
import { nextTime, starsAt } from './sky.ts';
import { densOf, groundOf } from './terrain.ts';

type Want = (s: readonly FaunaSpecies[]) => boolean;
const walkingPredator: Want = (s) => s.some((x) => x.temperament === 'predator' && x.kind !== 'flyer');

/** A world whose species at `tier` pass `want`, its dens sending out their occupants and the herd spawner off, so every
 * creature is a den's. */
const denWorld = (tier: Tier, want: Want) => faunaWorld({ tier, spawner: false, fauna: { dens: true }, want });

const creature = (w: FaunaWorld, id: number): CreatureInfo => w.zone.fauna!.creatures().find((c) => c.id === id)!;

/** The time from now on at which it is night (or day) at a place on the test's world for at least `margin` seconds. */
function forceClock(w: FaunaWorld, dir: Readonly<Vec3>, night: boolean, margin = 900, from = w.time) {
  w.time = nextTime(w.zone.system, w.body.index, dir, w.ground.radius, night, from, { margin })!;
}

/** A den of `role` on the test's world with someone living in it (passing `ok`), and points on the ground round it. */
function denOf(w: FaunaWorld, role: DenInfo['den']['role'], ok: (d: DenInfo) => boolean = () => true) {
  const info = w.zone.fauna!.dens(w.body.index).find((d) => d.den.role === role && d.species !== null && ok(d));
  if (!info) throw new Error(`no ${role} den with an occupant on ${w.body.name}`);
  const dir = info.den.dir;
  const [t, b] = tangents(dir);
  const r = w.ground.radius;
  return {
    info,
    dir,
    pos: w.onGround(dir),
    /** a point on the ground `east` and `north` metres from it */
    at: (east: number, north: number): Vec3 =>
      w.onGround([dir[0] * r + t[0] * east + b[0] * north, dir[1] * r + t[1] * east + b[1] * north, dir[2] * r + t[2] * east + b[2] * north]),
    /** what it has out now */
    now: () => w.zone.fauna!.dens(w.body.index)[info.index]!,
  };
}

describe('dens', () => {
  it('are planned off the tick at the zone’s tier, each naming who lives there, a predator den the kind its predator lives in', () => {
    const w = denWorld(3, walkingPredator);
    expect(w.zone.fauna!.densReady(w.body.index)).toBe(true);
    const dens = w.zone.fauna!.dens(w.body.index);
    expect(dens.length).toBeGreaterThan(10);
    for (const d of dens) {
      expect(d.species, `den ${d.index}`).not.toBeNull();
      expect(d.species!.temperament).toBe(d.den.role);
      if (d.den.role === 'predator') expect(d.den.kind).toBe(denKindFor(d.species!.bodyPlan));
      if (d.den.role === 'ambusher') expect(d.den.kind).toBe('burrow');
      if (d.den.role === 'apex') expect(d.den.footprint).toBe(APEX_FOOTPRINT);
    }
    // only dens in loaded cells have anything out
    const loaded = new Set(w.zone.fauna!.cells(w.body.index).map((c) => c.key));
    for (const d of dens) if (d.pack.length) expect(loaded.has(w.ground.cells.keyOf(...d.den.dir))).toBe(true);
  });

  it('anchor a pack at a predator den, which comes back after its timer once wiped out, even if its cell unloads', () => {
    const w = denWorld(3, walkingPredator);
    const d = denOf(w, 'predator', (x) => x.species!.kind !== 'flyer');
    forceClock(w, d.dir, false);
    // in a ship: the pack has no prey and stays at home
    w.movePlayer(d.at(120, 0), 'ship');
    w.run(2);
    const first = d.now().pack;
    expect(first.length).toBeGreaterThanOrEqual(d.info.species!.herd.min);
    expect(first.length).toBeLessThanOrEqual(d.info.species!.herd.max);
    for (const id of first) {
      const c = creature(w, id);
      expect(c.species.index).toBe(d.info.species!.index);
      expect(groundDistance(c.pos, d.pos)).toBeLessThan(HERD_SPREAD_M * Math.SQRT2 + 3);
    }
    // by day, no night pack
    expect(d.now().night).toEqual([]);

    // wiped out (as combat will): the den waits out its timer, which outlives its cell
    for (const id of first) w.zone.despawn(id);
    w.run(1);
    expect(d.now().pack).toEqual([]);
    const at = d.now().respawnAt;
    expect(Math.abs(at - (w.time + DEN_RESPAWN_S))).toBeLessThan(1.5);
    w.movePlayer(d.at(3000, 0), 'ship');
    w.run(UNLOAD_S + 2);
    expect(w.zone.fauna!.cells(w.body.index).some((c) => c.key === w.ground.cells.keyOf(...d.dir))).toBe(false);
    w.movePlayer(d.at(120, 0), 'ship');
    w.run(2);
    expect(d.now().pack).toEqual([]);
    w.time = at - 5;
    w.run(1);
    expect(d.now().pack).toEqual([]);
    w.time = at + 1;
    w.run(1);
    const second = d.now().pack;
    // the same pack (planned from the den), new animals
    expect(second.length).toBe(first.length);
    expect(second.some((id) => first.includes(id))).toBe(false);
    expect(d.now().respawnAt).toBe(at);
  });

  it('send a predator den’s second pack out at night, once a night', () => {
    const w = denWorld(3, walkingPredator);
    const d = denOf(w, 'predator', (x) => x.species!.kind !== 'flyer');
    forceClock(w, d.dir, true);
    w.movePlayer(d.at(120, 0), 'ship');
    w.run(2);
    expect(d.now().pack.length).toBeGreaterThan(0);
    const night = d.now().night;
    expect(night.length).toBeGreaterThanOrEqual(d.info.species!.herd.min);
    for (const id of night) expect(creature(w, id).species.index).toBe(d.info.species!.index);
    // lost, it is not replaced that night
    for (const id of night) w.zone.despawn(id);
    w.run(5);
    expect(d.now().night).toEqual([]);
    // by day it is not out; the next night it is again
    forceClock(w, d.dir, false, 300);
    w.run(1);
    expect(d.now().night).toEqual([]);
    forceClock(w, d.dir, true, 300);
    w.run(1);
    expect(d.now().night.length).toBe(night.length);
  });

  it('bring the apex out at night at its lair in the landmark grove, never by day, and take it home at dawn', () => {
    const w = denWorld(2, (s) => s.some((x) => x.temperament === 'apex'));
    const d = denOf(w, 'apex');
    expect(d.info.den.kind).toBe('nest');
    const apexes = () => w.zone.fauna!.creatures().filter((c) => c.species.temperament === 'apex');
    // a player nearby in a ship (no prey, so the apex has no one to fight)
    forceClock(w, d.dir, false);
    w.movePlayer(d.at(120, 0), 'ship');
    w.run(4);
    expect(apexes()).toEqual([]);
    expect(d.now().pack).toEqual([]);

    forceClock(w, d.dir, true);
    w.run(2);
    const out = d.now().pack;
    expect(apexes().length).toBe(1);
    const apex = apexes()[0]!;
    expect(out[0]).toBe(apex.id);
    expect(groundDistance(apex.pos, d.pos)).toBeLessThan(3);
    expect(w.zone.entity(apex.id)!.cls).toBe('walker');
    // its pack: the world's walking predators, if it has any (PACK_RULES)
    const pack = out.slice(1).map((id) => creature(w, id));
    const walker = w.species.some((s) => s.temperament === 'predator' && s.kind !== 'flyer');
    if (walker) expect(pack.length).toBeGreaterThanOrEqual(PACK_RULES.size.min);
    for (const c of pack) expect(c.species.temperament).toBe('predator');

    // dawn: home to the lair, and in
    forceClock(w, d.dir, false, 600);
    for (let i = 0; i < 60 && d.now().pack.length; i++) w.run(0.5);
    expect(d.now().pack).toEqual([]);
    for (const id of out) expect(w.zone.entity(id)).toBeUndefined();
    expect(d.now().respawnAt).toBe(-Infinity);
    w.run(3);
    expect(apexes()).toEqual([]);

    // killed, it comes out again only after APEX_RESPAWN_S, and at night
    forceClock(w, d.dir, true);
    w.run(2);
    const again = d.now().pack;
    expect(again[0]).toBeDefined();
    for (const id of again) w.zone.despawn(id);
    w.run(1);
    const at = d.now().respawnAt;
    expect(Math.abs(at - (w.time + APEX_RESPAWN_S))).toBeLessThan(1.5);
    w.run(5);
    expect(apexes()).toEqual([]);
    forceClock(w, d.dir, true, 300, at);
    w.run(2);
    expect(apexes().length).toBe(1);
  });

  it('keep ambushers lying still at their burrow beside a site until a player comes within 8 m', () => {
    const w = denWorld(2, (s) => s.some((x) => x.temperament === 'ambusher'));
    const d = denOf(w, 'ambusher');
    expect(d.info.den.kind).toBe('burrow');
    expect(d.info.den.site).toBeGreaterThanOrEqual(0);
    // on foot, out of the spawn clearance: the burrow sends its ambushers out to lie in wait
    w.movePlayer(d.at(100, 0));
    w.run(2);
    const ids = d.now().pack;
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const start = ids.map((id) => creature(w, id));
    for (const c of start) {
      expect(c.state).toBe('lurk');
      expect(groundDistance(c.pos, d.pos)).toBeLessThanOrEqual(d.info.den.footprint * Math.SQRT2 + 0.5);
    }
    // a player 20 m off is let pass
    w.movePlayer(d.at(20, 0));
    w.run(3);
    for (const c of start) {
      expect(creature(w, c.id).state).toBe('lurk');
      expect(creature(w, c.id).pos).toEqual(c.pos);
    }
    // within 8 m, they strike
    w.movePlayer(d.at(RULES.ambushM - 3, 0));
    const seen = new Set<string>();
    w.run(1.5, () => ids.forEach((id) => seen.add(creature(w, id).state)));
    expect([...seen].some((s) => s === 'rush' || s === 'attack')).toBe(true);
    // the player gone, they go back to the burrow and lie in wait again
    w.movePlayer(d.at(150, 0));
    w.run(20);
    for (const id of ids) {
      expect(creature(w, id).state).toBe('lurk');
      expect(groundDistance(creature(w, id).pos, d.pos)).toBeLessThan(3);
    }
  });

  it('send nothing out within 70 m of a player, with room to spare, and send it once the player is further off', () => {
    const w = denWorld(3, walkingPredator);
    const d = denOf(w, 'predator', (x) => x.species!.kind !== 'flyer');
    forceClock(w, d.dir, false);
    w.movePlayer(d.at(SPAWN_CLEAR_M - 20, 0), 'ship');
    w.run(3);
    expect(w.zone.fauna!.cells(w.body.index).some((c) => c.key === w.ground.cells.keyOf(...d.dir) && c.state === 'active')).toBe(true);
    expect(w.zone.fauna!.creatureCount + PACK_RULES.size.max).toBeLessThan(MAX_CREATURES);
    expect(d.now().pack).toEqual([]);
    w.movePlayer(d.at(SPAWN_CLEAR_M + 30, 0), 'ship');
    w.run(1);
    expect(d.now().pack.length).toBeGreaterThan(0);
  });

  it('send nothing out while the zone is full, and send it once there is room', () => {
    const w = denWorld(3, walkingPredator);
    const d = denOf(w, 'predator', (x) => x.species!.kind !== 'flyer');
    forceClock(w, d.dir, false);
    // the zone filled with a herd awake round the test's player, where it stands
    const filler = w.species.find((s) => s.temperament === 'docile' || s.temperament === 'skittish')!;
    const fill = w.spawn({ body: w.body.index, species: filler.index, at: w.at(30, 0), count: MAX_CREATURES });
    // a second player beside the den, out of the clearance
    const v2 = { id: 2, sendBinary: () => {} };
    w.zone.join(v2, { kind: 'player', frame: w.frame, pos: d.at(SPAWN_CLEAR_M + 30, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' });
    w.run(2);
    // full, with nothing asleep to make room from
    expect(w.zone.fauna!.creatureCount).toBe(MAX_CREATURES);
    expect(d.now().pack).toEqual([]);
    for (const id of fill.creatures.slice(0, 10)) w.zone.despawn(id);
    w.run(1);
    expect(d.now().pack.length).toBeGreaterThan(0);
    expect(w.zone.fauna!.creatureCount).toBeLessThanOrEqual(MAX_CREATURES);
  });

  it('count the apex lost once it is killed, though its pack lives on, and bring it back only after its timer', () => {
    const w = denWorld(2, (s) => s.some((x) => x.temperament === 'apex') && walkingPredator(s));
    const d = denOf(w, 'apex');
    forceClock(w, d.dir, true);
    w.movePlayer(d.at(120, 0), 'ship');
    w.run(2);
    const out = d.now().pack;
    expect(out.length).toBeGreaterThan(1);
    expect(creature(w, out[0]!).species.temperament).toBe('apex');
    // the apex alone is killed
    w.zone.despawn(out[0]!);
    w.run(1);
    expect(d.now().pack).toEqual([]);
    const at = d.now().respawnAt;
    expect(Math.abs(at - (w.time + APEX_RESPAWN_S))).toBeLessThan(1.5);
    // its pack hunts on, an ordinary herd of the cell
    for (const id of out.slice(1)) expect(w.zone.entity(id)).toBeDefined();
    // later that night: no apex
    const apexes = () => w.zone.fauna!.creatures().filter((c) => c.species.temperament === 'apex');
    w.time += 600;
    w.run(2);
    expect(apexes()).toEqual([]);
    // dawn: the pack is not taken into the lair, nor the timer forgotten
    forceClock(w, d.dir, false, 300);
    w.run(10);
    expect(d.now().respawnAt).toBe(at);
    for (const id of out.slice(1)) expect(w.zone.entity(id)).toBeDefined();
    // the first night after it: the apex again
    forceClock(w, d.dir, true, 300, at);
    w.run(2);
    expect(apexes().length).toBe(1);
  });

  it('wait for the world’s den plan, and follow the zone’s tier', () => {
    let ready = false;
    const asked: number[] = [];
    const grounds = {
      ground: (p: PlanetParams) => groundOf(p),
      dens: (p: PlanetParams, tier: number) => (asked.push(tier), ready ? densOf(p, tier) : null),
    };
    const w = faunaWorld({ tier: 2, spawner: false, fauna: { dens: true, grounds }, want: walkingPredator });
    w.run(1);
    expect(w.zone.fauna!.densReady(w.body.index)).toBe(false);
    expect(w.zone.fauna!.dens(w.body.index)).toEqual([]);
    ready = true;
    w.run(0.5);
    expect(w.zone.fauna!.densReady(w.body.index)).toBe(true);
    const tier2 = w.zone.fauna!.dens(w.body.index);
    w.zone.fauna!.setTier(3);
    w.run(0.5);
    const tier3 = w.zone.fauna!.dens(w.body.index);
    expect(asked).toContain(3);
    // raising the tier adds dens without moving one
    expect(tier3.length).toBeGreaterThan(tier2.length);
    expect(tier3.slice(0, tier2.length).map((d) => d.den)).toEqual(tier2.map((d) => d.den));
    // the apex goes into its lair from within the lair's own ground
    expect(LAIR_M).toBeLessThanOrEqual(APEX_FOOTPRINT);
  });
});

describe('night', () => {
  const spawnerPredators: Want = (s) => s.some((x) => x.spawn === 'herd' && x.temperament === 'predator');
  /** A world whose herd spawner places predators, the spawner on and the dens off, and a spot on open ground near its
   * equator (where night falls every turn, whatever the season) with points round it. */
  function herdWorld() {
    // (with no time budget, every cell a player wakes loads on the tick it is woken, however busy the machine)
    const w = faunaWorld({ tier: 3, spawner: true, fauna: { dens: false, loadBudgetMs: Infinity }, want: spawnerPredators });
    const spot = openGround(w.ground, 0.3);
    const [t, b] = tangents(spot);
    return { w, spot, at: (east: number, north: number) => w.onGround(along(spot, t, b, east, north, w.ground.radius)) };
  }
  /** The time, within two turns of now, deepest in the day (or night) at a place: the star highest above (or lowest
   * below) its horizon. */
  function deepest(w: FaunaWorld, dir: Readonly<Vec3>, night: boolean): number {
    let best = w.time;
    let bestUp = night ? Infinity : -Infinity;
    for (let t = w.time; t < w.time + 2 * w.body.rotationPeriod; t += 20) {
      const s = starsAt(w.zone.system, t)[w.body.index]!;
      const up = (dir[0] * s[0] + dir[1] * s[1] + dir[2] * s[2]) / Math.hypot(...s);
      if (night ? up < bestUp : up > bestUp) [best, bestUp] = [t, up];
    }
    return best;
  }

  /** The herds a player in a ship meets hopping over 16 spots 1 km apart, at the deepest of the day or of the night
   * there: the predators' and the rest. */
  function herdsMet(night: boolean) {
    const { w, spot, at } = herdWorld();
    w.time = deepest(w, spot, night);
    const herds = new Map<number, string>();
    for (let k = 0; k < 16; k++) {
      w.movePlayer(at((k % 4) * 1000, Math.floor(k / 4) * 1000), 'ship');
      w.run(4);
      expect(w.zone.fauna!.isNight(w.body.index, spot)).toBe(night);
      for (const c of w.zone.fauna!.creatures()) herds.set(c.herd, c.species.temperament);
    }
    const predators = [...herds.values()].filter((t) => t === 'predator').length;
    return { others: herds.size - predators, predators };
  }

  it('doubles the predators the herd spawner places, and nothing else', () => {
    const day = herdsMet(false);
    const night = herdsMet(true);
    expect(night.others).toBe(day.others);
    expect(day.predators).toBeGreaterThanOrEqual(5);
    expect(night.predators / day.predators).toBeGreaterThan(1.5);
    expect(night.predators / day.predators).toBeLessThan(2.6);
  });

  it('sends a cell’s night herd out as night falls on it, once a night, never within 70 m of a player', () => {
    const { w, spot, at } = herdWorld();
    // four players in ships 1 km apart, from 30 s before night falls where the first stands until a minute after
    const spots = [at(0, 0), at(1000, 0), at(0, 1000), at(1000, 1000)];
    const dusk = nextTime(w.zone.system, w.body.index, spot, w.ground.radius, true, w.time, { margin: 900 })!;
    w.time = dusk - 30;
    w.movePlayer(spots[0]!, 'ship');
    spots
      .slice(1)
      .forEach((pos, k) =>
        w.zone.join({ id: 10 + k, sendBinary: () => {} }, { kind: 'player', frame: w.frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' }),
      );
    w.run(10);
    const byDay = new Set(w.zone.fauna!.creatures().map((c) => c.herd));
    const nightHerds = new Map<number, CreatureInfo[]>();
    w.run(80, () => {
      for (const c of w.zone.fauna!.creatures()) {
        if (byDay.has(c.herd) || nightHerds.get(c.herd)?.some((x) => x.id === c.id)) continue;
        if (!nightHerds.has(c.herd)) nightHerds.set(c.herd, []);
        nightHerds.get(c.herd)!.push(c);
      }
    });
    expect(nightHerds.size).toBeGreaterThan(0);
    for (const herd of nightHerds.values()) {
      for (const c of herd) {
        expect(c.species.temperament).toBe('predator');
        // as first seen: out of the spawn clearance (less a herd's spread and a tick's move)
        for (const p of spots) expect(groundDistance(c.pos, p)).toBeGreaterThan(SPAWN_CLEAR_M - HERD_SPREAD_M * Math.SQRT2 - 2);
      }
    }
    // lost, they are not replaced that night
    for (const herd of nightHerds.values()) for (const c of herd) w.zone.despawn(c.id);
    w.run(10);
    const after = w.zone.fauna!.creatures().filter((c) => !byDay.has(c.herd));
    expect(after).toEqual([]);
  });

  it('holds a cell’s night herd back while a player stands within 70 m of where it would come out', () => {
    const { w, spot } = herdWorld();
    w.time = deepest(w, spot, true);
    const seed = (w.body.params as PlanetParams).seed;
    // a cell near the spot that plans a night herd
    let found: { key: number; plan: HerdPlan } | null = null;
    w.ground.cells.cellsNear(spot, 3000, (key) => {
      const plan = found ? null : planNightHerd(seed, key, w.species, 3, w.ground);
      if (plan && w.ground.sample(plan.center) > 2) found = { key, plan };
    });
    const { key, plan } = found!;
    const [t, b] = tangents(plan.center);
    const from = (m: number) => w.onGround(along(plan.center, t, b, m, 0, w.ground.radius));
    const cell = () => w.zone.fauna!.cells(w.body.index).find((c) => c.key === key);
    w.movePlayer(from(SPAWN_CLEAR_M - 30), 'ship');
    w.run(3);
    expect(cell()?.state).toBe('active');
    expect(w.zone.fauna!.creatureCount + plan.animals.length).toBeLessThan(MAX_CREATURES);
    expect(cell()!.night).toBe(0);
    w.movePlayer(from(SPAWN_CLEAR_M + 30), 'ship');
    w.run(1);
    expect(cell()!.night).toBe(plan.animals.length);
  });

  it('sends no night herd out at nightfall while the zone is full, and sends it once there is room', () => {
    const { w, spot, at } = herdWorld();
    const spots = [at(0, 0), at(1000, 0), at(0, 1000), at(1000, 1000)];
    const dusk = nextTime(w.zone.system, w.body.index, spot, w.ground.radius, true, w.time, { margin: 900 })!;
    w.time = dusk - 60;
    w.movePlayer(spots[0]!, 'ship');
    spots
      .slice(1)
      .forEach((pos, k) =>
        w.zone.join({ id: 10 + k, sendBinary: () => {} }, { kind: 'player', frame: w.frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' }),
      );
    // (the cells round where the test's player started unload: nothing is left asleep to make room from)
    w.run(UNLOAD_S + 2);
    expect(w.zone.fauna!.cells(w.body.index).every((c) => c.state === 'active')).toBe(true);
    // by day, the zone filled to its cap with a herd awake by the first player
    const filler = w.species.find((s) => s.temperament === 'docile' || s.temperament === 'skittish')!;
    const fill = w.spawn({ body: w.body.index, species: filler.index, at: at(30, 0), count: MAX_CREATURES - w.zone.fauna!.creatureCount });
    expect(w.zone.fauna!.creatureCount).toBe(MAX_CREATURES);
    // night falls on cells that plan night herds out of every player's clearance, and none comes out
    w.run(40);
    expect(w.zone.fauna!.isNight(w.body.index, spot)).toBe(true);
    const seed = (w.body.params as PlanetParams).seed;
    const due = w.zone.fauna!.cells(w.body.index).filter((c) => {
      const plan = c.state === 'active' ? planNightHerd(seed, c.key, w.species, 3, w.ground) : null;
      return plan && spots.every((p) => groundDistance(w.onGround(plan.center), p) > SPAWN_CLEAR_M);
    });
    expect(due.length).toBeGreaterThan(0);
    expect(w.zone.fauna!.cells(w.body.index).every((c) => c.night === 0)).toBe(true);
    expect(w.zone.fauna!.creatureCount).toBe(MAX_CREATURES);
    // room is made: they come out, within the cap
    for (const id of fill.creatures.slice(0, 40)) w.zone.despawn(id);
    w.run(2);
    expect(w.zone.fauna!.cells(w.body.index).some((c) => c.night > 0)).toBe(true);
    expect(w.zone.fauna!.creatureCount).toBeLessThanOrEqual(MAX_CREATURES);
  });
});
