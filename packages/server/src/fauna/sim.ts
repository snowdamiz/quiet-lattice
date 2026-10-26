// Fauna on a zone's worlds (DESIGN 12.2, P1.E08.T01): the server owns every herd and its AI, and creatures reach clients
// as zone entities (kind `mob`) in their world's frame, carrying their species (index into the world's faunaSpecies
// list), level, behaviour state (`mode`) and attack phase (`attack`).
//
// The server cannot simulate every world, so herds live only in cells (cells.ts) around players near a world's surface
// (within 1,500 m of it, as the demo spawned herds round its camera). Each tick the sim looks for players by their
// entities; every quarter second it wakes the cells within ACTIVE_M of one. A new cell (a few a tick, under a time
// budget) spawns the herd planned for it from the world's seed (herds.ts), so the same herd appears in the same cell for
// everyone. A cell with no player within SLEEP_M sleeps: its creatures stand still, unsimulated; it
// wakes if one comes back, and after UNLOAD_S asleep its creatures are despawned and the cell forgotten. A world with no
// cells and no players is dropped.
//
// Seams for the tasks that follow: spawnHerd places a herd anywhere (den packs, ambushers and the apex, P1.E08.T03; the
// dev CLI, P1.E03.T07); hurt adds threat (combat, P1.E06.T02); setTier follows the Edge (P2.E22.T02).
import { performance } from 'node:perf_hooks';
import type { EntityField } from '@astra/shared/protocol';
import {
  faunaSpecies,
  frameId,
  hashInts,
  hasFauna,
  Random,
  tierOfGalaxySystem,
  type BodySpec,
  type FaunaSpecies,
  type PlanetParams,
  type SystemDescription,
  type Tier,
} from '@astra/shared/world';
import { PACK_RULES } from '@astra/shared/data';
import { addThreat } from '@astra/shared/combat';
import type { InterestClass } from '../zones/interest.ts';
import type { EntityFields, EntityInit, ZoneEntity } from '../zones/zone.ts';
import { herdTick, move, newCreature, orientation, settle, think, velocity, type Actor, type Creature, type Ctx, type Herd } from './ai.ts';
import type { Vec3 } from './cells.ts';
import { animal, HERD_SPREAD_M, levelFor, offsetDir, planCellHerd, tangents, type HerdPlan } from './herds.ts';
import { groundOf, type Ground } from './terrain.ts';

/** Players within this height above a world's sea level keep herds about them, m (the demo's 1,500 m); a pose deeper
 * than SURFACE_DEPTH_M below it is inside the world, not on it, and keeps none. */
export const SURFACE_ALT_M = 1500;
export const SURFACE_DEPTH_M = 10_000;
/** A cell wakes when a player comes within this of its centre, m. */
export const ACTIVE_M = 400;
/** A cell sleeps when no player is within this of its centre, m. */
export const SLEEP_M = 500;
/** A cell asleep this long unloads, s. */
export const UNLOAD_S = 30;
/** How often cells are woken and put to sleep, s. */
export const SCAN_S = 0.25;
/** Time a tick may spend loading new cells (planning their herds samples the ground), ms; at least one always loads. */
export const LOAD_BUDGET_MS = 1.5;
/** Longest step simulated at once, s (a zone waking after a sleep does not leap). */
const MAX_DT = 0.25;

/** The zone, as the sim uses it. */
export interface FaunaZone {
  readonly systemIndex: number;
  readonly system: SystemDescription;
  spawn(init: EntityInit): number;
  patch(id: number, set: Partial<EntityFields>, clear?: readonly EntityField[]): void;
  despawn(id: number): boolean;
  entity(id: number): ZoneEntity | undefined;
  entityIds(): IterableIterator<number>;
}

export interface FaunaOptions {
  /** the system's tier; by default its tier with the Edge where it stands in Phase 1 */
  tier?: Tier;
  /** false: cells hold no planned herds, only those spawnHerd places (tests and dev scenes) */
  spawner?: boolean;
}

/** What spawnHerd places. */
export interface HerdRequest {
  /** the world: its body index in the system */
  body: number;
  /** the species, by index in the world's list (it must exist at the zone's tier) */
  species: number;
  /** where: a position (or any direction) in the world's frame; the herd stands on the ground below it */
  at: Readonly<Vec3>;
  /** animals (by default as the species' herd size), and their level (by default drawn for the tier) */
  count?: number;
  level?: number;
}

/** A creature as tests and tools see it. */
export interface CreatureInfo {
  id: number;
  body: number;
  herd: number;
  species: FaunaSpecies;
  state: string;
  pos: Vec3;
  target: number | null;
  attack: number | null;
}

/** How small a creature is seen from 500 m only (the loot radius), and how the apex is seen from 2 km (the walker
 * radius); every other creature is a mob (1.5 km). */
export function interestFor(sp: FaunaSpecies): InterestClass {
  if (sp.temperament === 'apex') return 'walker';
  return sp.size < 1 ? 'loot' : 'mob';
}

type CellState = 'loading' | 'active' | 'asleep';

interface Cell {
  readonly key: number;
  state: CellState;
  /** when it last changed state */
  since: number;
  /** distance to the nearest player at the last scan, m */
  dist: number;
  readonly herds: Herd[];
}

/** What was last sent of a creature. */
interface Sent {
  pos: Vec3;
  quat: [number, number, number, number];
  vel: Vec3;
  mode: string;
  attack: number | null;
}

const changed = (a: readonly number[], b: readonly number[], eps: number) => a.some((x, i) => Math.abs(x - b[i]!) > eps);

/** One world's fauna. */
class WorldFauna {
  readonly frame: string;
  readonly ground: Ground;
  species: FaunaSpecies[];
  readonly cells = new Map<number, Cell>();
  /** every creature on the world, by entity id */
  readonly creatures = new Map<number, Creature>();
  private readonly sent = new Map<number, Sent>();
  private scanIn = 0;

  constructor(
    private readonly sim: FaunaSim,
    readonly body: BodySpec,
    readonly params: PlanetParams,
  ) {
    this.frame = frameId(sim.zone.system.seed, body.index);
    this.ground = groundOf(params);
    this.species = faunaSpecies(params, sim.tier);
  }

  get empty(): boolean {
    return this.cells.size === 0;
  }

  step(dt: number, now: number, players: readonly Actor[]): void {
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scan(now, players);
      this.scanIn = SCAN_S;
    }
    this.load(now);

    const live = new Map<number, Creature>();
    const herds: Herd[] = [];
    for (const cell of this.cells.values()) {
      if (cell.state !== 'active') continue;
      for (const h of cell.herds) {
        // creatures despawned by someone else (combat, later) leave their herd
        for (let i = h.members.length - 1; i >= 0; i--) {
          const m = h.members[i]!;
          if (this.sim.zone.entity(m.id)) continue;
          h.members.splice(i, 1);
          this.forget(m);
        }
        herds.push(h);
        for (const m of h.members) live.set(m.id, m);
      }
    }
    const ctx: Ctx = { dt, now, ground: this.ground, rng: this.sim.rng, players: new Map(players.map((p) => [p.id, p])), creatures: live };
    for (const h of herds) {
      herdTick(h, ctx);
      for (const m of h.members) {
        think(m, ctx);
        move(m, ctx);
        this.sync(m);
      }
    }
  }

  /** Wakes the cells near players, creating those not yet loaded; sleeps and unloads the rest. */
  private scan(now: number, players: readonly Actor[]): void {
    const near = new Map<number, number>();
    const grid = this.ground.cells;
    for (const p of players) {
      const l = Math.hypot(p.pos[0], p.pos[1], p.pos[2]);
      const dir: Vec3 = [p.pos[0] / l, p.pos[1] / l, p.pos[2] / l];
      grid.cellsNear(dir, SLEEP_M, (key) => {
        const c = grid.center(key);
        const d = Math.hypot(c[0] - dir[0], c[1] - dir[1], c[2] - dir[2]) * grid.radius;
        if (d <= SLEEP_M && d < (near.get(key) ?? Infinity)) near.set(key, d);
      });
    }
    for (const [key, d] of near) {
      const cell = this.cells.get(key);
      if (cell) {
        cell.dist = d;
        if (cell.state === 'asleep' && d <= ACTIVE_M) this.setState(cell, 'active', now);
      } else if (d <= ACTIVE_M) {
        this.cells.set(key, { key, state: 'loading', since: now, dist: d, herds: [] });
      }
    }
    for (const cell of this.cells.values()) {
      if (near.has(cell.key)) continue;
      if (cell.state === 'loading') this.cells.delete(cell.key);
      else if (cell.state === 'active') this.setState(cell, 'asleep', now);
      else if (now - cell.since >= UNLOAD_S) this.unload(cell);
    }
  }

  private setState(cell: Cell, state: CellState, now: number): void {
    cell.state = state;
    cell.since = now;
    if (state !== 'asleep') return;
    for (const h of cell.herds) {
      h.intrusion.clear();
      for (const m of h.members) {
        settle(m);
        this.sync(m);
      }
    }
  }

  /** Loads waiting cells, nearest first, while the tick's budget lasts (always one). */
  private load(now: number): void {
    const waiting = [...this.cells.values()].filter((c) => c.state === 'loading');
    if (!waiting.length) return;
    waiting.sort((a, b) => a.dist - b.dist);
    const started = performance.now();
    for (const cell of waiting) {
      this.open(cell, now);
      if (performance.now() - started > LOAD_BUDGET_MS) break;
    }
  }

  /** Spawns a cell's planned herd. */
  private open(cell: Cell, now: number): void {
    const plan = this.sim.spawner ? planCellHerd(this.params.seed, cell.key, this.species, this.sim.tier, this.ground) : null;
    if (plan) cell.herds.push(this.spawnPlan(plan, this.sim.rng));
    this.setState(cell, 'active', now);
  }

  private unload(cell: Cell): void {
    for (const h of cell.herds) {
      for (const m of h.members) {
        this.sim.zone.despawn(m.id);
        this.forget(m);
      }
    }
    this.ground.drop(cell.key);
    this.cells.delete(cell.key);
  }

  private forget(c: Creature): void {
    this.creatures.delete(c.id);
    this.sent.delete(c.id);
  }

  /** The cell a direction falls in, loaded now if it was not. */
  cellAt(dir: Readonly<Vec3>, now: number): Cell {
    const key = this.ground.cells.keyOf(dir[0], dir[1], dir[2]);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { key, state: 'loading', since: now, dist: Infinity, herds: [] };
      this.cells.set(key, cell);
    }
    if (cell.state === 'loading') this.open(cell, now);
    return cell;
  }

  /** Spawns a herd as planned: each animal on the ground (flyers at their height), facing the herd's way. An apex herd
   * brings a pack of the world's walking predators (PACK_RULES, DESIGN 12.2: "pack follows it"). */
  spawnPlan(plan: HerdPlan, rng: Random): Herd {
    const { species: sp, center } = plan;
    const g = this.ground;
    const [t, b] = tangents(center);
    const c = Math.cos(plan.heading);
    const s = Math.sin(plan.heading);
    const heading: Vec3 = [t[0] * c + b[0] * s, t[1] * c + b[1] * s, t[2] * c + b[2] * s];
    const home: Vec3 = [center[0] * g.surfaceRadius(center), center[1] * g.surfaceRadius(center), center[2] * g.surfaceRadius(center)];
    const herd: Herd = { id: this.sim.nextHerdId++, species: sp, home, level: plan.level, members: [], apex: sp.temperament === 'apex', intrusion: new Map() };
    const animals: { species: FaunaSpecies; offset: [number, number]; scale: number }[] = plan.animals.map((a) => ({ species: sp, ...a }));
    if (herd.apex) {
      const pack = this.species.find((x) => x.temperament === 'predator' && x.kind !== 'flyer');
      const n = pack ? rng.int(PACK_RULES.size.min, PACK_RULES.size.max) : 0;
      for (let k = 0; k < n; k++) {
        animals.push({
          species: pack!,
          offset: [rng.float(-HERD_SPREAD_M, HERD_SPREAD_M), rng.float(-HERD_SPREAD_M, HERD_SPREAD_M)],
          scale: rng.float(0.85, 1.15),
        });
      }
    }
    animals.forEach((a, slot) => {
      const dir = offsetDir(center, t, b, a.offset[0], a.offset[1], g.radius);
      const ground = g.radius + (a.species.kind === 'flyer' && g.ocean ? Math.max(0, g.height(dir)) : g.height(dir));
      const m = newCreature({ id: 0, herd, species: a.species, slot, scale: a.scale, pos: [0, 0, 0], heading, rng });
      m.pos = [dir[0] * (ground + m.alt), dir[1] * (ground + m.alt), dir[2] * (ground + m.alt)];
      const quat = orientation(m);
      m.id = this.sim.zone.spawn({
        kind: 'mob',
        frame: this.frame,
        pos: m.pos,
        quat,
        vel: [0, 0, 0],
        mode: m.state,
        species: a.species.index,
        level: plan.level,
        hp: 1,
        interest: interestFor(a.species),
      });
      this.sent.set(m.id, { pos: [...m.pos], quat, vel: [0, 0, 0], mode: m.state, attack: null });
      herd.members.push(m);
      this.creatures.set(m.id, m);
    });
    return herd;
  }

  /** Sends what changed of a creature: its pose, its state, its attack phase. */
  private sync(m: Creature): void {
    const last = this.sent.get(m.id);
    if (!last || !this.sim.zone.entity(m.id)) return;
    const set: Partial<EntityFields> = {};
    const clear: EntityField[] = [];
    if (changed(m.pos, last.pos, 1e-3)) set.pos = last.pos = [...m.pos];
    const quat = orientation(m);
    if (changed(quat, last.quat, 1e-4)) set.quat = last.quat = quat;
    const vel = velocity(m);
    if (changed(vel, last.vel, 1e-3)) set.vel = last.vel = vel;
    if (m.state !== last.mode) set.mode = last.mode = m.state;
    if (m.attack !== last.attack) {
      if (m.attack === null) clear.push('attack');
      else set.attack = m.attack;
      last.attack = m.attack;
    }
    if (clear.length || Object.keys(set).length) this.sim.zone.patch(m.id, set, clear);
  }

  info(m: Creature): CreatureInfo {
    return { id: m.id, body: this.body.index, herd: m.herd.id, species: m.species, state: m.state, pos: [...m.pos], target: m.target, attack: m.attack };
  }
}

/** A zone's fauna: one WorldFauna per world with players near it (or herds still loaded). */
export class FaunaSim {
  /** the system's tier, which sets its worlds' species and their levels */
  tier: Tier;
  /** whether cells spawn their planned herds */
  readonly spawner: boolean;
  readonly rng: Random;
  nextHerdId = 1;
  private readonly bodies = new Map<string, { body: BodySpec; params: PlanetParams }>();
  private readonly worlds = new Map<number, WorldFauna>();
  private lastTime: number | null = null;

  constructor(
    readonly zone: FaunaZone,
    opts: FaunaOptions = {},
  ) {
    this.tier = opts.tier ?? tierOfGalaxySystem(zone.systemIndex);
    this.spawner = opts.spawner ?? true;
    this.rng = new Random(hashInts(zone.system.seed, 0xfa11a));
    for (const body of zone.system.bodies) {
      if (body.type === 'gas') continue;
      const params = body.params as PlanetParams;
      if (hasFauna(params)) this.bodies.set(frameId(zone.system.seed, body.index), { body, params });
    }
  }

  /** Simulates every loaded world to world time `time`. The zone calls this at the start of each tick. */
  step(time: number): void {
    const dt = this.lastTime === null ? 0 : Math.min(MAX_DT, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const byBody = new Map<number, Actor[]>();
    for (const id of this.zone.entityIds()) {
      const f = this.zone.entity(id)!.fields;
      if (f.kind !== 'player' || f.frame === null) continue;
      const world = this.bodies.get(f.frame);
      if (!world) continue;
      const r = Math.hypot(f.pos[0], f.pos[1], f.pos[2]);
      const alt = r - world.body.radius;
      if (!(alt <= SURFACE_ALT_M && alt >= -SURFACE_DEPTH_M)) continue;
      let list = byBody.get(world.body.index);
      if (!list) byBody.set(world.body.index, (list = []));
      list.push({ id, pos: [f.pos[0], f.pos[1], f.pos[2]], onFoot: f.mode === 'foot' });
    }
    for (const index of byBody.keys()) if (!this.worlds.has(index)) this.world(index);
    for (const [index, w] of this.worlds) {
      w.step(dt, time, byBody.get(index) ?? []);
      if (w.empty && !byBody.has(index)) this.worlds.delete(index);
    }
  }

  /** The species of a world at the zone's tier (empty for a world without fauna). */
  speciesOf(body: number): readonly FaunaSpecies[] {
    const w = this.worlds.get(body);
    if (w) return w.species;
    const b = this.zone.system.bodies[body];
    return b && b.type !== 'gas' ? faunaSpecies(b.params as PlanetParams, this.tier) : [];
  }

  /** Changes the tier (the Edge moved): worlds take the new species list from their next cell on (lists only grow or
   * shrink at the end, so herds already out keep their species). */
  setTier(tier: Tier): void {
    this.tier = tier;
    for (const w of this.worlds.values()) w.species = faunaSpecies(w.params, tier);
  }

  /** Places a herd of a species on a world, on the ground below `at` (seam for dens, P1.E08.T03, and dev tools). Its
   * cell is loaded if it was not, and the herd lives and unloads with it. Returns the herd id and creature ids. */
  spawnHerd(req: HerdRequest): { herd: number; creatures: number[] } {
    const w = this.world(req.body);
    const sp = w.species[req.species];
    if (!sp) throw new RangeError(`world ${req.body} has no species ${req.species} at tier ${this.tier}`);
    const l = Math.hypot(req.at[0], req.at[1], req.at[2]);
    if (!(l > 0)) throw new RangeError('a herd needs a place');
    const center: Vec3 = [req.at[0] / l, req.at[1] / l, req.at[2] / l];
    const now = this.lastTime ?? 0;
    const cell = w.cellAt(center, now);
    const rng = this.rng;
    const count = req.count ?? rng.int(sp.herd.min, sp.herd.max);
    const plan: HerdPlan = {
      species: sp,
      center,
      heading: rng.float(0, Math.PI * 2),
      level: req.level ?? levelFor(rng, this.tier),
      animals: Array.from({ length: count }, (_, k) => animal(rng, k)),
    };
    const herd = w.spawnPlan(plan, rng);
    cell.herds.push(herd);
    return { herd: herd.id, creatures: herd.members.map((m) => m.id) };
  }

  /** Damage (or anything worth threat) done to a creature by an attacker (seam for combat, P1.E06.T02): hostile creatures
   * take the threat and turn on whoever hurts them most; grazers bolt. */
  hurt(creature: number, attacker: number, amount: number): boolean {
    const now = this.lastTime ?? 0;
    for (const w of this.worlds.values()) {
      const c = w.creatures.get(creature);
      if (!c) continue;
      c.threat = addThreat(c.threat, attacker, amount, now);
      if (c.species.tier === 0 && c.species.kind !== 'flyer') {
        const from = this.zone.entity(attacker)?.fields.pos;
        if (from) {
          c.state = 'flee';
          c.timer = this.rng.float(4, 6);
          const up = norm(c.pos);
          const away: Vec3 = [c.pos[0] - from[0], c.pos[1] - from[1], c.pos[2] - from[2]];
          const d = away[0] * up[0] + away[1] * up[1] + away[2] * up[2];
          c.heading = norm([away[0] - up[0] * d, away[1] - up[1] * d, away[2] - up[2] * d]);
        }
      }
      return true;
    }
    return false;
  }

  /** Every creature being kept, on every world. */
  creatures(): CreatureInfo[] {
    const out: CreatureInfo[] = [];
    for (const w of this.worlds.values()) for (const m of w.creatures.values()) out.push(w.info(m));
    return out;
  }

  /** Loaded cells per world, by state (for metrics and tests). */
  cellCounts(): Record<number, Record<CellState, number>> {
    const out: Record<number, Record<CellState, number>> = {};
    for (const [index, w] of this.worlds) {
      const n = { loading: 0, active: 0, asleep: 0 };
      for (const c of w.cells.values()) n[c.state]++;
      out[index] = n;
    }
    return out;
  }

  /** A world's fauna, made if it is not kept yet. */
  private world(body: number): WorldFauna {
    let w = this.worlds.get(body);
    if (w) return w;
    const b = this.zone.system.bodies[body];
    const entry = b && this.bodies.get(frameId(this.zone.system.seed, b.index));
    if (!entry) throw new RangeError(`body ${body} of system ${this.zone.systemIndex} has no fauna`);
    w = new WorldFauna(this, entry.body, entry.params);
    this.worlds.set(body, w);
    return w;
  }
}

function norm(v: Readonly<Vec3>): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
