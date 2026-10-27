// Fauna on a zone's worlds (DESIGN 12.2, P1.E08.T01): the server owns every herd and its AI, and creatures reach clients
// as zone entities (kind `mob`) in their world's frame, carrying their species (index into the world's faunaSpecies
// list), level, behaviour state (`mode`) and attack phase (`attack`).
//
// The server cannot simulate every world, so herds live only in cells (cells.ts) around players near a world's surface
// (within 1,500 m of its ground, as the demo spawned herds round its camera). Each tick the sim finds the players in
// its worlds' frames. A world's ground is asked for (and planned off the tick, terrain.ts) as soon as a player is in its
// frame; until it is ready the world keeps no cells. Every quarter second the cells within ACTIVE_M of a player wake; a
// new cell (a few a tick, under a time budget) spawns the herd planned for it from the world's seed (herds.ts), so the
// same herd appears in the same cell for everyone. A cell with no player within SLEEP_M sleeps: its creatures stand
// still, unsimulated; it wakes if one comes back, and after UNLOAD_S asleep its creatures are despawned and the cell
// forgotten. A world with no cells and no players is dropped.
//
// Bounds, whatever the players do (a pose is a client's claim until movement authority, P1.E03.T04, and fauna must hold
// its own limits anyway): a player wakes at most WAKE_PER_S new cells a second (WAKE_BURST at once, on arrival); a world
// keeps at most MAX_CELLS cells and a zone at most MAX_CREATURES creatures, the oldest asleep cells unloading first to make
// room. Past that, waiting cells load as room is made, nearest first.
//
// Players a shared-world entity cannot see (sealed in a bay, event or raid phase, §6.1) still wake cells (they see the
// herds) but are nobody's prey, intruder or threat.
//
// Night and dens (P1.E08.T03). At each scan the active cells also send out what night and their dens hold: at night
// (the star below the cell's horizon, sky.ts) a cell may add its night herd of predators (herds.ts), and each den in an
// active cell keeps its occupants out, respawns them on its timer and brings the apex out at night (dens.ts). These
// spawn under the same time budget as loading cells, never within SPAWN_CLEAR_M of a player, and only when the zone has
// room; a world's dens are planned off the tick with its ground (terrain.ts) and wait for it.
//
// Seams for the tasks that follow: spawnHerd places a herd anywhere (the dev CLI, P1.E03.T07); hurt adds threat
// (combat, P1.E06.T02); setTier follows the Edge (the zone manager calls it).
import { performance } from 'node:perf_hooks';
import { addThreat } from '@astra/shared/combat';
import { PACK_RULES } from '@astra/shared/data';
import type { EntityField } from '@astra/shared/protocol';
import {
  faunaSpecies,
  frameId,
  hashInts,
  hasFauna,
  Random,
  tierOfGalaxySystem,
  type BodySpec,
  type Den,
  type FaunaSpecies,
  type PlanetParams,
  type SystemDescription,
  type Tier,
} from '@astra/shared/world';
import type { InterestClass } from '../zones/interest.ts';
import type { EntityFields, EntityInit, ZoneEntity } from '../zones/zone.ts';
import { groundDistance, herdTick, move, newCreature, orientation, settle, think, velocity, type Actor, type Creature, type Ctx, type Herd } from './ai.ts';
import type { Vec3 } from './cells.ts';
import {
  APEX_RESPAWN_S,
  DEN_RESPAWN_S,
  denRandom,
  denSites,
  idleDen,
  LAIR_M,
  newDenState,
  NIGHT_ONLY,
  occupantOf,
  planDenHerd,
  SPAWN_CLEAR_M,
  type DenInfo,
  type DenSite,
  type DenState,
} from './dens.ts';
import { animal, HERD_SPREAD_M, levelFor, offsetDir, planCellHerd, planNightHerd, tangents, type HerdPlan } from './herds.ts';
import { isNight, starsAt } from './sky.ts';
import { groundOf, groundPlanner, type Ground, type GroundSource } from './terrain.ts';

/** Players within this height above a world's ground keep herds about them, m (the demo's 1,500 m, which it measured
 * from sea level: a mountain top kept none); a pose more than SURFACE_DEPTH_M below sea level is inside the world, not
 * on it, and counts for nothing. */
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
/** A player's nearby cells are worked out again once it has moved this far, m. */
export const RESCAN_M = 25;
/** Time a tick may spend loading new cells (planning their herds samples the ground), ms; at least one always loads. */
export const LOAD_BUDGET_MS = 1.5;
/** New cells a player may wake a second, and at once (arriving wakes 10–15). A walker wakes one every few seconds and a
 * ship skimming the ground at 200 m/s about three a second. */
export const WAKE_PER_S = 4;
export const WAKE_BURST = 40;
/** Cells a world keeps, any state (a player wakes about 13 within ACTIVE_M; 50 players in a 2 km square about 100). */
export const MAX_CELLS = 256;
/** Creatures a zone keeps, over all its worlds: with 50 players on foot among them the zone stays within its 200-entity
 * budget, and the bench's surface trials (25 and 50 players spread out) within 10 ms p95. */
export const MAX_CREATURES = 150;
/** Height caches kept for cells not loaded (a herd strays a little past its cell) before they are cleared. */
export const STRAY_CACHES = 32;
/** Longest step simulated at once, s (a zone waking after a sleep does not leap). */
const MAX_DT = 0.25;

/** The zone, as the sim uses it. */
export interface FaunaZone {
  readonly systemIndex: number;
  readonly system: SystemDescription;
  readonly phases: { hiddenFromShared(id: number): boolean };
  spawn(init: EntityInit): number;
  patch(id: number, set: Partial<EntityFields>, clear?: readonly EntityField[]): void;
  despawn(id: number): boolean;
  entity(id: number): ZoneEntity | undefined;
  entityIds(): IterableIterator<number>;
}

export interface FaunaOptions {
  /** the system's tier; by default its tier with the Edge where it stands in Phase 1 (the zone manager passes the world
   * service's) */
  tier?: Tier;
  /** false: cells hold no planned herds (by day or night), only those spawnHerd places (tests and dev scenes) */
  spawner?: boolean;
  /** whether dens send out their occupants (dens.ts); as `spawner` by default */
  dens?: boolean;
  /** where worlds' grounds come from: the server's worker planner by default; tests plan on their own thread */
  grounds?: GroundSource;
  /** LOAD_BUDGET_MS, for tests */
  loadBudgetMs?: number;
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

export type CellState = 'loading' | 'active' | 'asleep';

/** A loaded cell as tests and tools see it. */
export interface CellInfo {
  key: number;
  state: CellState;
  /** distance from its centre to the nearest player at the last scan, m */
  dist: number;
  creatures: number;
}

/** The fauna's numbers, for the zone's metrics. */
export interface FaunaStats {
  worlds: number;
  creatures: number;
  cells: Record<CellState, number>;
  /** herds out at dens (packs, night packs, ambushers, the apex) */
  denHerds: number;
}

/** How small a creature is seen from 500 m only (the loot radius), and how the apex is seen from 2 km (the walker
 * radius); every other creature is a mob (1.5 km). */
export function interestFor(sp: FaunaSpecies): InterestClass {
  if (sp.temperament === 'apex') return 'walker';
  return sp.size < 1 ? 'loot' : 'mob';
}

interface Cell {
  readonly key: number;
  state: CellState;
  /** when it last changed state */
  since: number;
  /** distance to the nearest player at the last scan, m */
  dist: number;
  readonly herds: Herd[];
  /** its planned herd, once worked out (null: none); a cell waiting for room keeps it */
  plan?: HerdPlan | null;
  /** its night herd's plan, once worked out at night (null: none) */
  nightPlan?: HerdPlan | null;
  /** its night herd while out */
  nightHerd: Herd | null;
  /** it has sent out its night herd this night */
  nightDone: boolean;
  /** its centre, once asked for */
  center?: Vec3;
}

const newCell = (key: number, now: number, dist: number): Cell => ({ key, state: 'loading', since: now, dist, herds: [], nightHerd: null, nightDone: false });

/** What was last sent of a creature. */
interface Sent {
  pos: Vec3;
  quat: [number, number, number, number];
  vel: Vec3;
  mode: string;
  attack: number | null;
}

/** A player's view of a world's cells: the cells near where it was last worked out, nearest first. */
interface Watch {
  dir: Vec3;
  near: [key: number, dist: number][];
}

/** A player's allowance of new cells (a token bucket: WAKE_BURST deep, refilled at WAKE_PER_S). */
interface Allowance {
  tokens: number;
  at: number;
}

/** Den state keys: body × DEN_KEY + the den's index (a world plans a few thousand dens at most). */
const DEN_KEY = 1 << 20;
const changed = (a: readonly number[], b: readonly number[], eps: number) => a.some((x, i) => Math.abs(x - b[i]!) > eps);
const creaturesIn = (cell: Cell) => cell.herds.reduce((n, h) => n + h.members.length, 0);

/** One world's fauna. */
class WorldFauna {
  readonly frame: string;
  /** null until it is planned */
  ground: Ground | null = null;
  species: FaunaSpecies[];
  readonly cells = new Map<number, Cell>();
  /** cells waiting to load */
  private readonly loading = new Set<Cell>();
  /** every creature on the world, by entity id */
  readonly creatures = new Map<number, Creature>();
  private readonly sent = new Map<number, Sent>();
  private readonly watches = new Map<number, Watch>();
  private scanIn = 0;
  /** when a load that found the zone full may be tried again */
  private waitForRoomUntil = -Infinity;
  /** the highest the ground rises above sea level, about (the client's bound on its terrain, and its volcanoes) */
  private readonly peak: number;
  /** its dens at `densTier` (null until planned), and those in each cell */
  private dens: DenSite[] | null = null;
  private densTier = -1;
  private densByCell = new Map<number, DenSite[]>();
  /** the star in the world's frame at the last scan (sky.ts) */
  private star: Vec3 = [0, 0, 0];
  /** the zone had no room for what this scan would spawn */
  private full = false;

  constructor(
    private readonly sim: FaunaSim,
    readonly body: BodySpec,
    readonly params: PlanetParams,
  ) {
    this.frame = frameId(sim.zone.system.seed, body.index);
    this.species = faunaSpecies(params, sim.tier);
    this.ground = sim.grounds.ground(params, sim.tier);
    const volcano = Math.max(0, ...(params.volcanoes ?? []).map((v) => v[4]));
    this.peak = params.mountainHeight + params.landHeight * 2.5 + params.hillHeight + volcano + 50;
  }

  get empty(): boolean {
    return this.cells.size === 0;
  }

  /** The ground now, planned on this thread if it is not ready (for spawnHerd). */
  groundNow(): Ground {
    return (this.ground ??= groundOf(this.params, this.sim.tier));
  }

  /** Steps the world with the players in its frame; those within SURFACE_ALT_M of its ground keep herds about them. */
  step(dt: number, now: number, inFrame: readonly Actor[]): void {
    this.ground ??= this.sim.grounds.ground(this.params, this.sim.tier);
    // (its dens are asked for with its ground, and planned after it)
    const dens =
      this.sim.densOn && this.densTier !== this.sim.tier ? (this.sim.grounds.dens?.(this.params, this.sim.tier) ?? (this.sim.grounds.dens ? null : [])) : null;
    if (!this.ground) return;
    if (dens) this.setDens(dens);
    const players = inFrame.filter((p) => this.nearGround(p.pos));
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scan(now, players);
      this.spawnAtNightAndDens(now, players);
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

  /** Whether a position is within SURFACE_ALT_M of the ground (far above the highest peak, without sampling it). */
  private nearGround(pos: Readonly<Vec3>): boolean {
    const g = this.ground!;
    const r = Math.hypot(pos[0], pos[1], pos[2]);
    if (r - g.radius > SURFACE_ALT_M + this.peak) return false;
    return r - g.surfaceRadius(pos) <= SURFACE_ALT_M;
  }

  /** The cells within SLEEP_M of a surface direction, nearest first. */
  private nearCells(dir: Readonly<Vec3>): [number, number][] {
    const grid = this.ground!.cells;
    const out: [number, number][] = [];
    grid.cellsNear(dir, SLEEP_M, (key) => {
      const c = grid.center(key);
      const d = Math.hypot(c[0] - dir[0], c[1] - dir[1], c[2] - dir[2]) * grid.radius;
      if (d <= SLEEP_M) out.push([key, d]);
    });
    return out.sort((a, b) => a[1] - b[1]);
  }

  /** Wakes the cells near players, creating those not yet loaded (within each player's allowance and the world's cap);
   * sleeps and unloads the rest. */
  private scan(now: number, players: readonly Actor[]): void {
    const near = new Map<number, number>();
    const radius = this.ground!.radius;
    for (const p of players) {
      const l = Math.hypot(p.pos[0], p.pos[1], p.pos[2]);
      const dir: Vec3 = [p.pos[0] / l, p.pos[1] / l, p.pos[2] / l];
      let w = this.watches.get(p.id);
      if (!w) this.watches.set(p.id, (w = { dir, near: this.nearCells(dir) }));
      else if (Math.hypot(dir[0] - w.dir[0], dir[1] - w.dir[1], dir[2] - w.dir[2]) * radius > RESCAN_M) {
        w.dir = dir;
        w.near = this.nearCells(dir);
      }
      const allowance = this.sim.allowance(p.id, now);
      for (const [key, d] of w.near) {
        if (d < (near.get(key) ?? Infinity)) near.set(key, d);
        if (d > ACTIVE_M || this.cells.has(key) || allowance.tokens < 1 || !this.roomForCell()) continue;
        const cell = newCell(key, now, d);
        this.cells.set(key, cell);
        this.loading.add(cell);
        allowance.tokens -= 1;
      }
    }
    if (this.watches.size > players.length) {
      const here = new Set(players.map((p) => p.id));
      for (const id of this.watches.keys()) if (!here.has(id)) this.watches.delete(id);
    }
    for (const [key, d] of near) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      cell.dist = d;
      if (cell.state === 'asleep' && d <= ACTIVE_M) this.setState(cell, 'active', now);
    }
    for (const cell of this.cells.values()) {
      if (near.has(cell.key)) continue;
      if (cell.state === 'loading') this.forgetCell(cell);
      else if (cell.state === 'active') this.setState(cell, 'asleep', now);
      else if (now - cell.since >= UNLOAD_S) this.unload(cell);
    }
    // height caches outside loaded cells (creatures straying, players hovering) go once there are more than a few
    if (this.ground!.cachedCells > this.cells.size + STRAY_CACHES) this.ground!.retain(this.cells);
  }

  /** Whether the world may take one more cell, unloading its oldest asleep cell if it must. */
  private roomForCell(): boolean {
    if (this.cells.size < MAX_CELLS) return true;
    const oldest = this.oldestAsleep(false);
    return oldest !== null && this.unload(oldest);
  }

  /** The cell asleep the longest (with creatures in it, if `withCreatures`), or null. */
  oldestAsleep(withCreatures: boolean): Cell | null {
    let oldest: Cell | null = null;
    for (const c of this.cells.values()) {
      if (c.state !== 'asleep' || (withCreatures && creaturesIn(c) === 0)) continue;
      if (!oldest || c.since < oldest.since) oldest = c;
    }
    return oldest;
  }

  private setState(cell: Cell, state: CellState, now: number): void {
    cell.state = state;
    cell.since = now;
    this.loading.delete(cell);
    if (state !== 'asleep') return;
    for (const h of cell.herds) {
      h.intrusion.clear();
      for (const m of h.members) {
        settle(m);
        this.sync(m);
      }
    }
  }

  /** Loads waiting cells, nearest first, while the tick's budget lasts (always one) and the zone has room for their
   * herds. */
  private load(now: number): void {
    if (!this.loading.size || now < this.waitForRoomUntil) return;
    const waiting = [...this.loading].sort((a, b) => a.dist - b.dist);
    const started = performance.now();
    for (const cell of waiting) {
      if (!this.open(cell, now)) {
        // the zone is full: try again at the next scan, when cells may have fallen asleep
        this.waitForRoomUntil = now + SCAN_S;
        break;
      }
      if (performance.now() - started > this.sim.loadBudgetMs) break;
    }
  }

  /** Spawns a cell's planned herd, if the zone has (or can make) room for it. False when it has to wait. */
  private open(cell: Cell, now: number): boolean {
    if (cell.plan === undefined) cell.plan = this.sim.spawner ? planCellHerd(this.params.seed, cell.key, this.species, this.sim.tier, this.ground!) : null;
    if (cell.plan) {
      if (!this.sim.makeRoom(cell.plan.animals.length)) return false;
      cell.herds.push(this.spawnPlan(cell.plan, this.sim.rng));
    }
    this.setState(cell, 'active', now);
    return true;
  }

  /** Despawns a cell's creatures and forgets it. False when it was not loaded. Its dens' occupants go with it (to come
   * out again when it next loads), but their respawn timers stay. */
  unload(cell: Cell): boolean {
    if (this.cells.get(cell.key) !== cell) return false;
    for (const h of cell.herds) {
      for (const m of h.members) {
        this.sim.zone.despawn(m.id);
        this.forget(m);
      }
    }
    for (const site of this.densByCell.get(cell.key) ?? []) {
      const st = this.sim.denState(this.body.index, site.index, false);
      if (!st) continue;
      // (a pack lost meanwhile still starts its timer; a night pack comes out again, as a cell's herds come back)
      if (st.pack && !st.pack.members.length) st.respawnAt = this.respawnAt(site, this.sim.now);
      st.pack = null;
      st.night = null;
      st.nightDone = false;
      if (idleDen(st, this.sim.now)) this.sim.forgetDen(this.body.index, site.index);
    }
    this.ground?.drop(cell.key);
    this.forgetCell(cell);
    return true;
  }

  private forgetCell(cell: Cell): void {
    this.cells.delete(cell.key);
    this.loading.delete(cell);
  }

  private forget(c: Creature): void {
    if (this.creatures.delete(c.id)) this.sim.creatureCount--;
    this.sent.delete(c.id);
  }

  /** The cell a direction falls in, made active now if it was not loaded (its own herd too, room permitting). */
  cellAt(dir: Readonly<Vec3>, now: number): Cell {
    const key = this.groundNow().cells.keyOf(dir[0], dir[1], dir[2]);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = newCell(key, now, Infinity);
      this.cells.set(key, cell);
    }
    if (cell.state === 'loading' && !this.open(cell, now)) {
      cell.plan = null;
      this.setState(cell, 'active', now);
    }
    return cell;
  }

  /** Spawns a herd as planned: each animal on the ground (flyers at their height), facing the herd's way. An apex herd
   * brings a pack of the world's walking predators (PACK_RULES, DESIGN 12.2: "pack follows it"). */
  spawnPlan(plan: HerdPlan, rng: Random): Herd {
    const { species: sp, center } = plan;
    const g = this.groundNow();
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
      this.sim.creatureCount++;
    });
    return herd;
  }

  /** Takes the world's dens at the zone's tier (planned off the tick), indexed by the cell each stands in. */
  private setDens(dens: readonly Den[]): void {
    const { sites, byCell } = denSites(dens, this.ground!.cells);
    this.dens = sites;
    this.densByCell = byCell;
    this.densTier = this.sim.tier;
    // (dens past the end of a shorter list, the tier having fallen: what they have out stays, as ordinary herds)
    this.sim.forgetDensFrom(this.body.index, sites.length);
  }

  /** Whether its dens at the zone's tier are planned. */
  get densReady(): boolean {
    return this.densTier === this.sim.tier;
  }

  /** At each scan, what night and the dens of the active cells send out, under the cells' load budget (what is left
   * waits for the next scan): each cell's night herd, and each den's occupants. */
  private spawnAtNightAndDens(now: number, players: readonly Actor[]): void {
    const nightHerds = this.sim.spawner && this.species.some((s) => s.spawn === 'herd' && s.temperament === 'predator');
    if (!nightHerds && !this.dens?.length) return;
    this.star = this.sim.starIn(this.body.index, now);
    this.full = false;
    const started = performance.now();
    for (const cell of this.cells.values()) {
      if (cell.state !== 'active') continue;
      if (nightHerds) this.nightHerd(cell, players);
      const dens = this.densByCell.get(cell.key);
      if (dens) for (const site of dens) this.denTick(cell, site, now, players);
      if (performance.now() - started > this.sim.loadBudgetMs) break;
    }
  }

  /** Whether it is night at a surface direction (sky.ts), by the star at the last scan. */
  nightAt(dir: Readonly<Vec3>): boolean {
    return isNight(this.star, dir, this.ground!.radius);
  }

  /** Whether the zone has (or can make) room for `n` more creatures; once it has not, nothing more is tried this scan. */
  private room(n: number): boolean {
    if (!this.full && !this.sim.makeRoom(n)) this.full = true;
    return !this.full;
  }

  /** A cell at night sends out its night herd, once a night, if it plans one (herds.ts); a cell by day is ready to again. */
  private nightHerd(cell: Cell, players: readonly Actor[]): void {
    if (cell.nightHerd && !cell.nightHerd.members.length) cell.nightHerd = this.dropHerd(cell, cell.nightHerd);
    if (!this.nightAt((cell.center ??= this.ground!.cells.center(cell.key)))) {
      cell.nightDone = false;
      return;
    }
    if (cell.nightDone || cell.nightHerd) return;
    if (cell.nightPlan === undefined) cell.nightPlan = planNightHerd(this.params.seed, cell.key, this.species, this.sim.tier, this.ground!);
    const plan = cell.nightPlan;
    if (plan && (!this.clearOf(plan.center, players) || !this.room(plan.animals.length))) return;
    if (plan) cell.herds.push((cell.nightHerd = this.spawnPlan(plan, this.sim.rng)));
    cell.nightDone = true;
  }

  /** A den in an active cell (dens.ts): notes a pack lost, then sends out what it keeps out and is not out yet. */
  private denTick(cell: Cell, site: DenSite, now: number, players: readonly Actor[]): void {
    const sp = occupantOf(site.den, this.species);
    const st = this.sim.denState(this.body.index, site.index, sp !== null);
    if (!st) return;
    // a pack wiped out (killed: despawned by someone else): the den waits out its respawn
    if (st.pack && !st.pack.members.length) {
      st.pack = this.dropHerd(cell, st.pack);
      st.respawnAt = this.respawnAt(site, now);
    }
    if (st.night && !st.night.members.length) st.night = this.dropHerd(cell, st.night);
    const night = this.nightAt(site.dir);
    if (!night) st.nightDone = false;
    if (!sp) return;
    if (NIGHT_ONLY.has(sp.temperament) && !night) {
      if (st.pack) this.retire(cell, st);
      return;
    }
    const wantPack = !st.pack && now >= st.respawnAt;
    const wantNight = sp.temperament === 'predator' && night && !st.nightDone && !st.night;
    if ((!wantPack && !wantNight) || !this.clearOf(site.dir, players)) return;
    if (wantPack) st.pack = this.spawnDen(cell, site, sp, 0);
    if (wantNight) st.nightDone = (st.night = this.spawnDen(cell, site, sp, 1)) !== null;
  }

  /** When a den whose pack was lost at `now` sends it out again. */
  private respawnAt(site: DenSite, now: number): number {
    return now + (site.den.role === 'apex' ? APEX_RESPAWN_S : DEN_RESPAWN_S);
  }

  /** A night-only den's herd out by day (the apex at dawn): once none of it has anyone to fight, it heads home, and at its
   * lair it goes in (despawns), its pack with it. */
  private retire(cell: Cell, st: DenState): void {
    const herd = st.pack!;
    if (herd.members.some((m) => m.target !== null)) return;
    const lead = herd.members[0]!;
    if (groundDistance(lead.pos, herd.home) <= LAIR_M) st.pack = this.dropHerd(cell, herd);
    else if (lead.state !== 'return') lead.state = 'return';
  }

  /** Sends out a den's herd for `slot` (0 its pack, 1 its night pack) if the zone has room for it; null when not. */
  private spawnDen(cell: Cell, site: DenSite, sp: FaunaSpecies, slot: number): Herd | null {
    const plan = planDenHerd(this.params.seed, site, sp, this.sim.tier, slot);
    // (the apex brings its pack: PACK_RULES)
    if (!this.room(plan.animals.length + (sp.temperament === 'apex' ? PACK_RULES.size.max : 0))) return null;
    const herd = this.spawnPlan(plan, denRandom(this.params.seed, site, slot, 1));
    cell.herds.push(herd);
    return herd;
  }

  /** Takes a herd out of its cell, despawning whatever is left of it. Returns null (for the slot it held). */
  private dropHerd(cell: Cell, herd: Herd): null {
    for (const m of herd.members) {
      this.sim.zone.despawn(m.id);
      this.forget(m);
    }
    herd.members.length = 0;
    const i = cell.herds.indexOf(herd);
    if (i >= 0) cell.herds.splice(i, 1);
    return null;
  }

  /** Whether no player near the ground stands within SPAWN_CLEAR_M of a surface direction (along the ground, about). */
  private clearOf(dir: Readonly<Vec3>, players: readonly Actor[]): boolean {
    const r = this.ground!.radius;
    for (const { pos } of players) {
      const l = Math.hypot(pos[0], pos[1], pos[2]) || 1;
      if (Math.hypot(pos[0] / l - dir[0], pos[1] / l - dir[1], pos[2] / l - dir[2]) * r < SPAWN_CLEAR_M) return false;
    }
    return true;
  }

  denInfo(): DenInfo[] {
    return (this.dens ?? []).map((site) => {
      const st = this.sim.denState(this.body.index, site.index, false);
      return {
        index: site.index,
        den: site.den,
        species: occupantOf(site.den, this.species),
        pack: st?.pack?.members.map((m) => m.id) ?? [],
        night: st?.night?.members.map((m) => m.id) ?? [],
        respawnAt: st?.respawnAt ?? -Infinity,
      };
    });
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

  cellInfo(): CellInfo[] {
    return [...this.cells.values()].map((c) => ({ key: c.key, state: c.state, dist: c.dist, creatures: creaturesIn(c) }));
  }
}

/** A zone's fauna: one WorldFauna per world with players in its frame (or herds still loaded). */
export class FaunaSim {
  /** the system's tier, which sets its worlds' species and their levels */
  tier: Tier;
  /** whether cells spawn their planned herds (and their night herds) */
  readonly spawner: boolean;
  /** whether dens send out their occupants */
  readonly densOn: boolean;
  readonly grounds: GroundSource;
  readonly loadBudgetMs: number;
  readonly rng: Random;
  nextHerdId = 1;
  /** creatures kept, over every world */
  creatureCount = 0;
  private readonly bodies = new Map<string, { body: BodySpec; params: PlanetParams }>();
  private readonly worlds = new Map<number, WorldFauna>();
  private readonly allowances = new Map<number, Allowance>();
  /** dens with something out or a timer running (the rest are as new), by body × DEN_KEY + den index: kept while the
   * zone runs, beyond their cells' and worlds' lives */
  private readonly denStates = new Map<number, DenState>();
  /** the star in each body's frame at a time (sky.ts), worked out once per scan */
  private stars: { time: number; at: Vec3[] } | null = null;
  private lastTime: number | null = null;

  constructor(
    readonly zone: FaunaZone,
    opts: FaunaOptions = {},
  ) {
    this.tier = opts.tier ?? tierOfGalaxySystem(zone.systemIndex);
    this.spawner = opts.spawner ?? true;
    this.densOn = opts.dens ?? this.spawner;
    this.grounds = opts.grounds ?? groundPlanner;
    this.loadBudgetMs = opts.loadBudgetMs ?? LOAD_BUDGET_MS;
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
    // the players in each world's frame: its ground is wanted, and those near it keep herds about them
    const byBody = new Map<number, Actor[]>();
    for (const id of this.zone.entityIds()) {
      const f = this.zone.entity(id)!.fields;
      if (f.kind !== 'player' || f.frame === null) continue;
      const world = this.bodies.get(f.frame);
      if (!world) continue;
      const alt = Math.hypot(f.pos[0], f.pos[1], f.pos[2]) - world.body.radius;
      if (!(alt >= -SURFACE_DEPTH_M)) continue;
      let list = byBody.get(world.body.index);
      if (!list) byBody.set(world.body.index, (list = []));
      list.push({ id, pos: [f.pos[0], f.pos[1], f.pos[2]], onFoot: f.mode === 'foot', hidden: this.zone.phases.hiddenFromShared(id) });
    }
    for (const index of byBody.keys()) if (!this.worlds.has(index)) this.world(index);
    for (const [index, w] of this.worlds) {
      w.step(dt, time, byBody.get(index) ?? []);
      if (w.empty && !byBody.has(index)) {
        w.ground?.retain(new Set());
        this.worlds.delete(index);
      }
    }
    // a full allowance is the same as none: forget those of players gone
    for (const [id, a] of this.allowances) {
      if (a.tokens + (time - a.at) * WAKE_PER_S >= WAKE_BURST && this.zone.entity(id)?.fields.kind !== 'player') this.allowances.delete(id);
    }
  }

  /** A player's allowance of new cells, refilled to now. One per player across every world, so hopping between worlds
   * (or off and back onto one) earns nothing. */
  allowance(id: number, now: number): Allowance {
    let a = this.allowances.get(id);
    if (!a) this.allowances.set(id, (a = { tokens: WAKE_BURST, at: now }));
    a.tokens = Math.min(WAKE_BURST, a.tokens + Math.max(0, now - a.at) * WAKE_PER_S);
    a.at = now;
    return a;
  }

  /** The species of a world at the zone's tier (empty for a world without fauna). */
  speciesOf(body: number): readonly FaunaSpecies[] {
    const w = this.worlds.get(body);
    if (w) return w.species;
    const b = this.zone.system.bodies[body];
    return b && b.type !== 'gas' ? faunaSpecies(b.params as PlanetParams, this.tier) : [];
  }

  /** Changes the tier (the Edge moved): worlds take the new species list from their next cell on (lists only grow or
   * shrink at the end, so herds already out keep their species), and their dens at the new tier once planned (den lists
   * too only grow or shrink at the end, so a den keeps its index and what it has out). */
  setTier(tier: Tier): void {
    this.tier = tier;
    for (const w of this.worlds.values()) w.species = faunaSpecies(w.params, tier);
  }

  /** World time at the last step. */
  get now(): number {
    return this.lastTime ?? 0;
  }

  /** The star in body `body`'s frame at world time `time` (sky.ts). */
  starIn(body: number, time: number): Vec3 {
    if (this.stars?.time !== time) this.stars = { time, at: starsAt(this.zone.system, time) };
    return this.stars.at[body]!;
  }

  /** Whether it is night at the zone's last step at a point on a world's surface (a position in its frame, or any
   * direction), by the star then (sky.ts). */
  isNight(body: number, at: Readonly<Vec3>): boolean {
    const l = Math.hypot(at[0], at[1], at[2]);
    const b = this.zone.system.bodies[body];
    if (!b || !(l > 0)) throw new RangeError('a place on a world is needed');
    return isNight(this.starIn(body, this.now), [at[0] / l, at[1] / l, at[2] / l], b.radius);
  }

  /** A den's state, made if `create` and it has none. */
  denState(body: number, index: number, create: boolean): DenState | undefined {
    const key = body * DEN_KEY + index;
    let st = this.denStates.get(key);
    if (!st && create) this.denStates.set(key, (st = newDenState()));
    return st;
  }

  /** Forgets a den's state (it has nothing out and no timer running). */
  forgetDen(body: number, index: number): void {
    this.denStates.delete(body * DEN_KEY + index);
  }

  /** Forgets the states of a world's dens from index `from` on. */
  forgetDensFrom(body: number, from: number): void {
    for (const key of this.denStates.keys()) if (Math.floor(key / DEN_KEY) === body && key % DEN_KEY >= from) this.denStates.delete(key);
  }

  /** A world's dens at the zone's tier, once planned (none before, or on a world nobody is on): who lives in each and what
   * it has out. */
  dens(body: number): DenInfo[] {
    return this.worlds.get(body)?.denInfo() ?? [];
  }

  /** Whether a world's dens at the zone's tier are planned (they spawn only then). */
  densReady(body: number): boolean {
    return !!this.worlds.get(body)?.densReady;
  }

  /**
   * Places a herd of a species on a world, on the ground below `at` (seam for dev tools and tests). Its cell
   * is loaded if it was not (planning the world's ground on this thread if it is not ready), and the herd lives and
   * unloads with it. Returns the herd id and creature ids, or null when the zone is full (MAX_CREATURES, after unloading
   * every asleep cell it could).
   */
  spawnHerd(req: HerdRequest): { herd: number; creatures: number[] } | null {
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
    if (!this.makeRoom(count)) return null;
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

  /** Makes room for `n` more creatures, unloading the cells asleep the longest; false when it cannot. */
  makeRoom(n: number): boolean {
    while (this.creatureCount + n > MAX_CREATURES) {
      let oldest: { w: WorldFauna; cell: NonNullable<ReturnType<WorldFauna['oldestAsleep']>> } | null = null;
      for (const w of this.worlds.values()) {
        const cell = w.oldestAsleep(true);
        if (cell && (!oldest || cell.since < oldest.cell.since)) oldest = { w, cell };
      }
      if (!oldest || !oldest.w.unload(oldest.cell)) return false;
    }
    return true;
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

  /** A world's loaded cells (none when it keeps none). */
  cells(body: number): CellInfo[] {
    return this.worlds.get(body)?.cellInfo() ?? [];
  }

  /** Whether a world's ground is ready (cells load only then). */
  groundReady(body: number): boolean {
    return !!this.worlds.get(body)?.ground;
  }

  /** Loaded cells per world, by state. */
  cellCounts(): Record<number, Record<CellState, number>> {
    const out: Record<number, Record<CellState, number>> = {};
    for (const [index, w] of this.worlds) {
      const n = { loading: 0, active: 0, asleep: 0 };
      for (const c of w.cells.values()) n[c.state]++;
      out[index] = n;
    }
    return out;
  }

  /** Worlds, creatures and cells by state, over every world: for the zone's metrics. */
  stats(): FaunaStats {
    const cells = { loading: 0, active: 0, asleep: 0 };
    for (const n of Object.values(this.cellCounts())) for (const k of Object.keys(cells) as CellState[]) cells[k] += n[k];
    let denHerds = 0;
    for (const st of this.denStates.values()) denHerds += (st.pack ? 1 : 0) + (st.night ? 1 : 0);
    return { worlds: this.worlds.size, creatures: this.creatureCount, cells, denHerds };
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
