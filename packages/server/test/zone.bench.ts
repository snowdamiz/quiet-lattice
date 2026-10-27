// `pnpm --filter @astra/server bench`: five trials, each failing when the tick's p95 is over the budget of 10 ms
// (IMPLEMENTATION_PLAN 0.3).
//
// The station trial: one zone with 200 entities (25 players, ships, mobs, NPCs, loot and pods, every one moving every
// tick) and 25 sessions, ticked 2000 times, once.
//
// The layout is the expensive case: everything is crowded round the home Waystation, so nearly every entity is in every
// session's interest set and every session gets a 150–200-entity delta every tick. Sessions acknowledge each snapshot 1–4
// ticks later (a 50–200 ms round trip), so deltas are diffed against several different baselines. Every mover keeps
// sending its pose in the frame it was placed in, so the zone re-expresses each one beyond that frame's sphere of
// influence (most ships, and the far ones) in the frame it belongs in, every tick. The zone holds its players to movement
// authority (P1.E03.T04), as the ZoneManager's zones do: the players fly honestly round the station's outside or walk its
// hangar floor, and every input is checked before it is applied. Their checks run outside the tick (on input, as the
// gateway's do), so they are timed apart from it and gated with it; then the cost of one check is measured where it is
// dearest: low over a world (a terrain sample each), on foot on a world, and on the pulse drive.
//
// The surface trials (P1.E08.T01): 25 sessions on foot on the home world, walking about a 1 km square of it at a Tier 3
// system's fauna, so herds spawn in the cells round them, wander, flee, charge and hunt them; then 50 spread over a 2 km
// square, who would wake far more herds than the zone may keep (MAX_CREATURES holds them). The zone's entities are the
// players and whatever creatures their cells hold. The world's ground is planned before they start.
//
// The arrival trial: 25 sessions waiting at the Waystation land together on a world nobody has walked on, spread over a
// 1 km square, and every tick from then on is measured: the world's ground is planned in the worker thread while they
// arrive (the loop yields between ticks, as the server's does), then their cells load under the per-tick budget.
//
// The nightfall trials (P1.E08.T03): 25 sessions on foot walking a 1 km square round a predator den near the home world's
// equator, at Tier 2 and at Tier 3, from shortly before night falls there: as it falls, every cell round them sends out
// its night herd of predators and the den its night pack, all of them hunting the walkers, and the zone stays within its
// creature cap. The world's ground and dens are planned before they start.
//
// The mining trial (P1.E13.T01): 25 sessions on foot among the ~480 resource nodes within 600 m of a spot of the home
// world, at a Tier 3 system's fauna, each beaming at a node (several at the same one at first) and sending a hit every
// quarter second, moving on to another standing node when theirs breaks; nodes grow back after 30 s, so the trial sees
// breaking, sharing and growing back throughout. Each tick's cost is the zone's step plus the hits that arrived for it
// and, every fifth tick, the resource sweep that brings every session up to date with the touched cells round it (its
// own share is reported as resourceCpu*).
//
// The combat trial (P1.E06.T02): 25 sessions in ships flying low over a 1 km square of the home world among its herds at
// a Tier 3 system's fauna, each turning its nose on the creature nearest it and firing its base gun at it every cooldown
// (8 shots a second each), so creatures are hit, die, lie for their death beat and go; herds are put down round the ships
// as they thin out. Each tick's cost is the zone's step (its combat's corpses and events included) plus the shots that
// arrived for it, each resolved by the combat service (its own share is reported as combatCpu*).
//
// The gate is the main thread's CPU time per tick: the tick's own cost, which preemption by other processes on a shared
// machine does not inflate (and in the station trial, the tick with its 25 players' input checks). Wall time per tick is
// printed beside it for information, with the load average.
import { cpus, loadavg } from 'node:os';
import { STATION_LAYOUT } from '@astra/shared/data';
import { encodeServerMessage, type ServerMessage } from '@astra/shared/protocol';
import { frameId, frameIdOf, nodeCellsNear, nodeKey, scatterNodes, Random, systemPoses, type PlanetParams, type Tier } from '@astra/shared/world';
import type { Vec3 as Dir } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { MAX_CREATURES } from '../src/fauna/sim.ts';
import { nextTime } from '../src/fauna/sky.ts';
import { densOf, Ground, groundOf, groundPlanner, planPads } from '../src/fauna/terrain.ts';
import { CombatService } from '../src/combat/service.ts';
import { InventoryService } from '../src/inventory/service.ts';
import { CharacterProgress } from '../src/persistence/components.ts';
import { nodeGroundsHere } from '../src/resources/ground.ts';
import { HIT_INTERVAL_S, ResourceService, SWEEP_MS } from '../src/resources/service.ts';
import { Harness, LARK } from '../src/sim/movement/testing.ts';
import { groundOf as movementGround, heightAt } from '../src/sim/movement/world.ts';
import { percentile } from '../src/zones/metrics.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { Zone, type EntityInit, type EntityKind, type ZoneViewer } from '../src/zones/zone.ts';
import { openGround } from './faunaWorld.ts';
import { miningWorld, type Vec3 as Point } from './resourceWorld.ts';

const ENTITIES = 200;
const SESSIONS = 25;
const WARMUP_TICKS = 300;
const TICKS = 2000;
const BUDGET_P95_MS = 10;
/** One input's check, where it is dearest, may cost this much CPU (its median over batches; its p95 is printed): 200
 * players' inputs a tick then take at most half the tick's budget. */
const CHECK_BUDGET_US = 25;
const DT = 0.05;
const H = STATION_LAYOUT.hangar;

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

class Sink implements ZoneViewer {
  bytes = 0;
  constructor(readonly id: number) {}
  sendBinary(data: Uint8Array): void {
    this.bytes += data.length;
  }
}

interface Mover {
  id: number;
  frame: string;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  viewer?: Sink;
  /** a player's mode: flying round the station, or walking its hangar floor */
  mode?: 'ship' | 'foot';
  seq: number;
}

interface TrialResult {
  wall: Float64Array;
  cpu: Float64Array;
  /** main-thread CPU of each measured tick's players' input checks, ms (with movement authority) */
  inputs?: Float64Array;
  /** honest inputs movement authority corrected (a bench bug if any) */
  corrections?: number;
  /** the first of them, as movement authority recorded them */
  corrected?: readonly object[];
  avgInterest: number;
  avgSnapshotBytes: number;
  /** entities in the zone, averaged over the measured ticks */
  avgEntities: number;
  sessions: number;
  ticks: number;
  /** anything else the trial reports */
  extra?: Record<string, number>;
}

/** Lets the event loop run (a worker's reply, timers), as the server's loop does between ticks. */
const yieldLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Ticks a zone, feeding acks back 1–4 ticks late, and measures each tick after the warm-up (with `during`, work the
 * tick's cost includes beside the zone's step). */
async function measure(
  zone: Zone,
  sinks: Sink[],
  rng: Random,
  beforeTick: (time: number, tick: number) => void,
  {
    warmup = WARMUP_TICKS,
    ticks = TICKS,
    afterTick,
    start = 2.3e7,
    during,
  }: {
    warmup?: number;
    ticks?: number;
    afterTick?: (tick: number, time: number) => void;
    start?: number;
    during?: (time: number, tick: number) => void;
  } = {},
): Promise<TrialResult> {
  /** acks in flight: delivered at tick `at` */
  const acks: { at: number; viewer: Sink; tick: number }[] = [];
  let time = start;
  let n = 0;

  /** One tick: wall ms (measured by the zone) and main-thread CPU ms. */
  function tick(): [number, number] {
    beforeTick(time, n);
    time += DT;
    const cpu0 = process.threadCpuUsage();
    let wall = zone.step(time);
    if (during) {
      const t0 = performance.now();
      during(time, n);
      wall += performance.now() - t0;
    }
    n++;
    const cpu = process.threadCpuUsage(cpu0);
    for (const s of sinks) acks.push({ at: zone.tick + 1 + rng.int(0, 3), viewer: s, tick: zone.tick });
    for (let i = acks.length - 1; i >= 0; i--) {
      const a = acks[i]!;
      if (a.at > zone.tick) continue;
      zone.ack(a.viewer, a.tick);
      acks.splice(i, 1);
    }
    return [wall, (cpu.user + cpu.system) / 1000];
  }

  for (let i = 0; i < warmup; i++) {
    tick();
    await yieldLoop();
  }
  const bytesBefore = sinks.reduce((s, x) => s + x.bytes, 0);
  let interest = 0;
  let entities = 0;
  const wall = new Float64Array(ticks);
  const cpu = new Float64Array(ticks);
  for (let i = 0; i < ticks; i++) {
    [wall[i], cpu[i]] = tick();
    entities += zone.entityCount;
    for (const s of sinks) interest += zone.interestOf(s).size;
    afterTick?.(i, time);
    await yieldLoop();
  }
  const bytes = sinks.reduce((s, x) => s + x.bytes, 0) - bytesBefore;
  return {
    wall,
    cpu,
    avgInterest: Math.round(interest / (ticks * sinks.length)),
    avgSnapshotBytes: Math.round(bytes / (ticks * sinks.length)),
    avgEntities: Math.round(entities / ticks),
    sessions: sinks.length,
    ticks,
  };
}

async function stationTrial(): Promise<TrialResult> {
  const rng = new Random(20261026);
  const around = (r: number): Vec3 => [rng.float(-r, r), rng.float(-r * 0.3, r * 0.3), rng.float(-r, r)];
  const randomQuat = (): Quat => {
    const q: Quat = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
    const n = Math.hypot(...q) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  };

  const zone = new Zone({ id: 'bench', systemIndex: 0, system: describeZoneSystem(0), movement: true });
  const station = zone.stationFrame;
  const home = `${zone.system.seed}:${zone.system.home}`;
  const movers: Mover[] = [];
  /** (measure's clock starts at 2.3e7: the players joined a tick before their first input) */
  const start = 2.3e7 - DT;

  /** a player's velocity: a ship's anywhere under 20 m/s, a walker's across the floor under 5 */
  function walk(mode: 'ship' | 'foot'): Vec3 {
    if (mode === 'ship') return around(10);
    const a = rng.float(0, Math.PI * 2);
    const v = rng.float(0, 5);
    return [Math.cos(a) * v, 0, Math.sin(a) * v];
  }

  // 25 players at the Waystation: flying round its outside, or on foot on its hangar floor
  const sinks: Sink[] = [];
  for (let i = 0; i < SESSIONS; i++) {
    const sink = new Sink(i + 1);
    sinks.push(sink);
    const mode = i % 3 ? 'ship' : 'foot';
    let pos: Vec3 = [rng.float(H.x0 + 10, H.x1 - 10), 0, rng.float(H.z0 + 10, H.z1 - 10)];
    while (mode === 'ship' && !clearOfHangar(pos)) pos = around(300);
    const quat = randomQuat();
    const init: EntityInit = { kind: 'player', frame: station, pos, quat, vel: [0, 0, 0], mode, name: `Pilot ${i}`, people: 'thalune', level: 5 };
    const id = zone.join(sink, init, { profile: { ship: LARK, people: 'thalune' }, now: start });
    movers.push({ id, frame: station, pos, quat, vel: walk(mode), viewer: sink, mode, seq: 0 });
  }

  // the rest: ships out to 30 km, NPCs, mobs and loot close in, a few pods; one in ten far away on the home world
  const mix: [EntityKind, number, number][] = [
    ['ship', 45, 30_000],
    ['npc', 30, 1_500],
    ['mob', 60, 1_200],
    ['loot', 25, 400],
    ['pod', 10, 400],
    ['prop', 5, 1_000],
  ];
  for (const [kind, n, r] of mix) {
    for (let i = 0; i < n && movers.length < ENTITIES; i++) {
      const far = i % 10 === 9;
      const pos = far ? ([rng.float(-1, 1) * 3e6, rng.float(-1, 1) * 3e6, rng.float(-1, 1) * 3e6] as Vec3) : around(r);
      const quat = randomQuat();
      const frame = far ? home : station;
      const init: EntityInit = { kind, frame, pos, quat, vel: [0, 0, 0], mode: kind === 'mob' ? 'idle' : 'ship' };
      if (kind === 'mob') Object.assign(init, { species: i, level: 3, hp: 1 });
      if (kind === 'ship') Object.assign(init, { hull: 'kestrel', hp: 1, shield: 1, heat: 0 });
      if (kind === 'npc') Object.assign(init, { name: `Crew ${i}`, people: 'ixari' });
      movers.push({ id: zone.spawn(init), frame, pos, quat, vel: around(kind === 'ship' ? 200 : 4), seq: 0 });
    }
  }
  if (zone.entityCount !== ENTITIES) throw new Error(`expected ${ENTITIES} entities, have ${zone.entityCount}`);

  /** main-thread CPU of each tick's input checks, ms, by tick (warm-up included) */
  const inputCpu: number[] = [];

  function moveEverything(time: number, tick: number): void {
    let used = 0;
    for (const m of movers) {
      let next: Vec3 = [m.pos[0] + m.vel[0] * DT, m.pos[1] + m.vel[1] * DT, m.pos[2] + m.vel[2] * DT];
      // players turn back off the hangar's shell (flying) or its walls (walking)
      const off =
        m.mode === 'ship' ? !clearOfHangar(next) : m.mode === 'foot' && (next[0] < H.x0 + 5 || next[0] > H.x1 - 5 || next[2] < H.z0 + 5 || next[2] > H.z1 - 5);
      if (off) {
        m.vel = [-m.vel[0], -m.vel[1], -m.vel[2]];
        next = [m.pos[0] + m.vel[0] * DT, m.pos[1] + m.vel[1] * DT, m.pos[2] + m.vel[2] * DT];
      }
      m.pos = next;
      if (rng.next() < 0.05) m.vel = m.mode ? walk(m.mode) : around(4);
      if (rng.next() < 0.3) m.quat = randomQuat();
      if (m.viewer) {
        // (arriving at the tick's time, stamped with it: a client with no latency)
        const cpu0 = process.threadCpuUsage();
        zone.input(
          m.viewer,
          { t: 'input', seq: ++m.seq, time, mode: m.mode!, pose: { frame: m.frame, pos: m.pos, quat: m.quat, vel: m.vel }, buttons: 0 },
          time,
        );
        const cpu = process.threadCpuUsage(cpu0);
        used += (cpu.user + cpu.system) / 1000;
      } else {
        // an occasional hp change, as combat will make
        const extra = rng.next() < 0.02 ? { hp: rng.next() } : {};
        zone.patch(m.id, { frame: m.frame, pos: m.pos, quat: m.quat, vel: m.vel, ...extra });
      }
    }
    inputCpu[tick] = used;
  }

  const r = await measure(zone, sinks, rng, moveEverything);
  return {
    ...r,
    inputs: Float64Array.from(inputCpu.slice(WARMUP_TICKS, WARMUP_TICKS + TICKS)),
    corrections: zone.movement!.corrections,
    corrected: zone.movement!.recent.slice(0, 3),
  };
}

/** Outside the hangar block with room to spare (a flying player never touches its shell). */
function clearOfHangar(p: Vec3): boolean {
  return !(p[0] > H.x0 - 20 && p[0] < H.x1 + 20 && p[1] > H.y0 - 20 && p[1] < H.y1 + 20 && p[2] > H.z0 - 20 && p[2] < H.z1 + 20);
}

interface CheckCost {
  p50: number;
  p95: number;
  corrections: number;
}

/**
 * The CPU cost of one input check, µs (p50 and p95 over batches of 100), where it is dearest: a ship flying low over the
 * home world (a terrain sample per input), a walker on it (the same), and a ship on the pulse drive in open space (its
 * clearance to every body). Each mover is honest; a correction would be a bench bug.
 */
function checkCost(): Record<string, CheckCost> {
  const d = describeZoneSystem(0);
  const homeFrame = frameIdOf(d.seed, d.home);
  const R = d.bodies[d.home]!.radius;
  const g = movementGround(d, d.home)!;
  const up: Vec3 = [0, 0, -1];
  const ground = R + heightAt(g, up);
  const east: Vec3 = [1, 0, 0];
  const at = (r: number): Vec3 => [up[0] * r, up[1] * r, up[2] * r];
  const scenarios: Record<string, { start: Vec3; frame: string | null; mode: 'ship' | 'foot' | 'pulse'; speed: number; dir: Vec3; follow?: boolean }> = {
    lowFlight: { start: at(ground + 300), frame: homeFrame, mode: 'ship', speed: 500, dir: east },
    walker: { start: at(ground), frame: homeFrame, mode: 'foot', speed: 5, dir: east, follow: true },
    pulse: { start: [0, 3e9, 0], frame: null, mode: 'pulse', speed: 20_000, dir: [0, 1, 0] },
  };
  const out: Record<string, CheckCost> = {};
  for (const [name, sc] of Object.entries(scenarios)) {
    const h = new Harness(d, { pose: { frame: sc.frame, pos: sc.start, quat: [0, 0, 0, 1], vel: [0, 0, 0] }, mode: sc.mode === 'pulse' ? 'ship' : sc.mode });
    let p = sc.start;
    const batches: number[] = [];
    for (let b = 0; b < 40; b++) {
      let used = 0;
      for (let k = 0; k < 100; k++) {
        // (a zone's tick sets the poses every 50 ms, outside the checks)
        h.now += DT;
        h.a.setPoses(systemPoses(d, h.now), h.now);
        p = [p[0] + sc.dir[0] * sc.speed * DT, p[1] + sc.dir[1] * sc.speed * DT, p[2] + sc.dir[2] * sc.speed * DT];
        if (sc.follow) {
          const r = Math.hypot(...p);
          const u: Vec3 = [p[0] / r, p[1] / r, p[2] / r];
          const gr = R + heightAt(g, u);
          p = [u[0] * gr, u[1] * gr, u[2] * gr];
        }
        const pose = { frame: sc.frame, pos: p, quat: [0, 0, 0, 1] as Quat, vel: [0, 0, 0] as Vec3 };
        const cpu0 = process.threadCpuUsage();
        h.a.check(h.id, { t: 'input', seq: ++h.seq, time: h.now, mode: sc.mode, pose, buttons: 0 }, h.now);
        const cpu = process.threadCpuUsage(cpu0);
        used += cpu.user + cpu.system;
      }
      if (b >= 5) batches.push(used / 100);
    }
    out[name] = {
      p50: round(percentile(Float64Array.from(batches), 50)),
      p95: round(percentile(Float64Array.from(batches), 95)),
      corrections: h.a.corrections,
    };
  }
  return out;
}

/**
 * `players` sessions on foot walking about a `side`-metre square of a world of system `systemIndex` (its home world for
 * system 0, else its first lush planet), at Tier 3 (or `tier`). `planned`: the world's ground is planned (and kept)
 * before they start; otherwise the zone's planner is left to plan it when they arrive. The square is round an open spot
 * of the world's, or round `center` (a unit direction).
 */
function surfaceWalk(
  systemIndex: number,
  players: number,
  side: number,
  seed: number,
  planned: boolean,
  { tier = 3, center: at }: { tier?: Tier; center?: Dir } = {},
) {
  const rng = new Random(seed);
  const system = describeZoneSystem(systemIndex);
  const zone = new Zone({ id: `bench-${systemIndex}-${players}`, systemIndex, system, fauna: { tier } });
  const body = systemIndex === 0 ? system.bodies[system.home]! : system.bodies.find((x) => x.type === 'lush' && x.kind === 'planet')!;
  const params = body.params as PlanetParams;
  const frame = frameId(system.seed, body.index);
  // (to find open ground; a ground that is not kept, when the zone must plan its own)
  const ground = planned ? groundOf(params) : new Ground(params, planPads(params));
  const center = at ?? openGround(ground);
  const [t, b] = tangents(center);
  const onGround = (d: Dir): Vec3 => {
    const r = ground.radius + ground.sample(d);
    return [d[0] * r, d[1] * r, d[2] * r];
  };
  const dirAt = (east: number, north: number): Dir => {
    const x = center[0] * ground.radius + t[0] * east + b[0] * north;
    const y = center[1] * ground.radius + t[1] * east + b[1] * north;
    const z = center[2] * ground.radius + t[2] * east + b[2] * north;
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  const half = side / 2;
  const sinks: Sink[] = [];
  const walkers: { sink: Sink; east: number; north: number; heading: number; seq: number }[] = [];
  for (let i = 0; i < players; i++) {
    const sink = new Sink(i + 1);
    sinks.push(sink);
    walkers.push({ sink, east: rng.float(-half, half), north: rng.float(-half, half), heading: rng.float(0, Math.PI * 2), seq: 0 });
  }
  const SPEED = 3;
  return {
    zone,
    sinks,
    rng,
    body,
    /** joins every walker: where it stands on the world, or docked at the Waystation */
    join(onWorld: boolean) {
      walkers.forEach((w, i) => {
        const pos: Vec3 = onWorld ? onGround(dirAt(w.east, w.north)) : [0, 0, 0];
        const where = onWorld ? { frame, mode: 'foot' } : { frame: zone.stationFrame, mode: 'docked' };
        zone.join(w.sink, { kind: 'player', pos, quat: [0, 0, 0, 1], vel: [0, 0, 0], name: `Walker ${i}`, people: 'thalune', level: 5, ...where });
      });
    },
    /** every walker takes a step on the world */
    step(time: number) {
      for (const w of walkers) {
        if (rng.next() < 0.01) w.heading += rng.float(-1.5, 1.5);
        // turn back towards the middle at the edge of the square
        if (Math.abs(w.east) > half || Math.abs(w.north) > half) w.heading = Math.atan2(-w.north, -w.east);
        w.east += Math.cos(w.heading) * SPEED * DT;
        w.north += Math.sin(w.heading) * SPEED * DT;
        const pos = onGround(dirAt(w.east, w.north));
        zone.input(w.sink, { t: 'input', seq: ++w.seq, time, mode: 'foot', pose: { frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
      }
    },
  };
}

/** Sessions on foot walking about a square of the home world among its herds, at Tier 3. */
function surfaceTrial(players: number, side: number): () => Promise<TrialResult> {
  return async () => {
    const walk = surfaceWalk(0, players, side, 20261027, true);
    walk.join(true);
    const r = await measure(walk.zone, walk.sinks, walk.rng, (time) => walk.step(time));
    return { ...r, extra: { creatures: walk.zone.fauna!.creatureCount, creatureCap: MAX_CREATURES } };
  };
}

/** 25 sessions land together on a world nobody has walked on: every tick from their arrival is measured. */
async function arrivalTrial(): Promise<TrialResult> {
  const walk = surfaceWalk(5, SESSIONS, 1000, 20261028, false);
  const ARRIVE = 20;
  walk.join(false);
  let readyAt = -1;
  let herdsAt = -1;
  const r = await measure(walk.zone, walk.sinks, walk.rng, (time, tick) => tick >= ARRIVE && walk.step(time), {
    warmup: 0,
    ticks: 1200,
    afterTick: (i) => {
      if (readyAt < 0 && walk.zone.fauna!.groundReady(walk.body.index)) readyAt = i;
      if (herdsAt < 0 && walk.zone.fauna!.creatureCount > 0) herdsAt = i;
    },
  });
  return {
    ...r,
    extra: {
      arrivalTick: ARRIVE,
      groundReadyTick: readyAt,
      firstHerdTick: herdsAt,
      creatures: walk.zone.fauna!.creatureCount,
      cpuMaxMs: round(percentile(r.cpu, 100)),
    },
  };
}

/**
 * 25 sessions on foot walking a 1 km square round a predator den near the home world's equator at `tier`, from shortly
 * before night falls on the den (it falls about 20 s into the measured ticks): night herds and the den's night pack come
 * out round them as it does. The world's ground and its dens at the tier are planned (and kept) before they start.
 */
function nightfallTrial(tier: Tier): () => Promise<TrialResult> {
  return async () => {
    const system = describeZoneSystem(0);
    const body = system.bodies[system.home]!;
    const params = body.params as PlanetParams;
    const ground = groundOf(params);
    const dens = densOf(params, tier);
    const spot = openGround(ground, 0.3);
    const away = (d: Readonly<Dir>) => Math.hypot(d[0] - spot[0], d[1] - spot[1], d[2] - spot[2]);
    const den = dens.filter((d) => d.role === 'predator').sort((a, b) => away(a.dir) - away(b.dir))[0]!;
    const dusk = nextTime(system, body.index, den.dir, ground.radius, true, 2.3e7, { margin: 900 })!;
    const walk = surfaceWalk(0, SESSIONS, 1000, 20261029 + tier, true, { tier, center: den.dir });
    walk.join(true);
    let nightfallTick = -1;
    let creaturesAtNightfall = 0;
    let creaturesMax = 0;
    let denHerdsMax = 0;
    const r = await measure(walk.zone, walk.sinks, walk.rng, (time) => walk.step(time), {
      start: dusk - WARMUP_TICKS * DT - 20,
      afterTick: (i, time) => {
        const f = walk.zone.fauna!.stats();
        if (nightfallTick < 0 && time >= dusk) [nightfallTick, creaturesAtNightfall] = [i, f.creatures];
        creaturesMax = Math.max(creaturesMax, f.creatures);
        denHerdsMax = Math.max(denHerdsMax, f.denHerds);
      },
    });
    const extra = {
      tier,
      nightfallTick,
      creaturesAtNightfall,
      creatures: walk.zone.fauna!.creatureCount,
      creaturesMax,
      creatureCap: MAX_CREATURES,
      denHerdsMax,
    };
    return { ...r, extra };
  };
}

/** A session that also takes control messages (the resource service's), counting them. */
class MinerSink extends Sink {
  messages = 0;
  textBytes = 0;
  constructor(
    id: number,
    readonly characterId: string,
  ) {
    super(id);
  }
  send(m: ServerMessage): void {
    this.messages++;
    // (encoded and checked as Session.send does)
    this.textBytes += encodeServerMessage(m).length;
  }
  sendText(text: string): void {
    this.messages++;
    this.textBytes += text.length;
  }
}

/** 25 sessions on foot mining the nodes round a spot of the home world, among its herds at Tier 3. */
async function miningTrial(): Promise<TrialResult> {
  const rng = new Random(20261029);
  const world = miningWorld(0, 0);
  const system = world.system;
  const zone = new Zone({ id: 'bench-mining', systemIndex: 0, system, fauna: { tier: 3 } });
  // the world's fauna ground, planned before they start (as the surface trials do)
  groundOf(world.params);
  // every node within 600 m of an open spot with a place to stand 5 m off it in sight
  const first = world.findNode();
  const up = first.stand.map((x) => x / Math.hypot(...first.stand)) as Point;
  const spots: { id: string; stand: Point }[] = [];
  for (const cell of nodeCellsNear(up[0], up[1], up[2], 600, world.R, world.level)) {
    for (const node of scatterNodes(world.ground, world.layers, cell)) {
      const nd = [node.x, node.y, node.z].map((x) => x / Math.hypot(node.x, node.y, node.z)) as Point;
      for (let k = 0; k < 8; k++) {
        const stand = world.onGround(nd, Math.cos((k * Math.PI) / 4) * 5, Math.sin((k * Math.PI) / 4) * 5);
        const target = world.targetOf(node);
        if (world.height(stand.map((x) => x / Math.hypot(...stand)) as Point) < 2 || Math.hypot(...stand.map((x, i) => x - target[i]!)) > 12) continue;
        if (!world.clear(stand, target)) continue;
        spots.push({ id: nodeKey(cell, node.type, node.k), stand });
        break;
      }
    }
  }
  if (spots.length < 10) throw new Error(`only ${spots.length} nodes to mine`);
  let now = 0;
  const inventory = new InventoryService();
  const service = new ResourceService({
    zones: { zones: [zone], zoneOf: (v) => (zone.has(v) ? zone : undefined), tier: () => 0 },
    inventory,
    now: () => now,
    grounds: { ground: () => world.ground },
    seed: 7,
  });
  service.respawnSeconds = () => 30;
  const sinks: MinerSink[] = [];
  const miners: { sink: MinerSink; spot: number; seq: number; phase: number }[] = [];
  for (let i = 0; i < SESSIONS; i++) {
    const sink = new MinerSink(i + 1, `miner-${i}`);
    inventory.open(sink.characterId);
    sinks.push(sink);
    // two or three to a node
    const spot = Math.floor(i / 2.5) % spots.length;
    zone.join(sink, {
      kind: 'player',
      frame: world.frame,
      pos: [...spots[spot]!.stand],
      quat: [0, 0, 0, 1],
      vel: [0, 0, 0],
      mode: 'foot',
      name: `Miner ${i}`,
      people: 'thalune',
      level: 5,
    });
    miners.push({ sink, spot, seq: 0, phase: i % 5 });
  }
  const hitEvery = Math.round(HIT_INTERVAL_S / DT);
  const sweepEvery = Math.round(SWEEP_MS / 1000 / DT);
  /** the resource work's own CPU per tick (its share of each tick's cost) */
  const own: number[] = [];
  const r = await measure(zone, sinks, rng, () => {}, {
    during: (time, tick) => {
      const cpu0 = process.threadCpuUsage();
      now = time;
      for (const m of miners) {
        if ((tick + m.phase) % hitEvery) continue;
        const spot = spots[m.spot]!;
        const a = service.mine(m.sink, { t: 'mine', seq: ++m.seq, frame: world.frame, node: spot.id, tool: 'multitool', time });
        if (a.result === 'hit') continue;
        // broken: on to another node, one still standing as a client sees it (it hides those harvested)
        for (let k = 0; k < 8; k++) {
          m.spot = rng.int(0, spots.length - 1);
          if (service.nodeState(world.frame, spots[m.spot]!.id)?.respawnAt == null) break;
        }
        zone.patch(zone.entityOf(m.sink)!, { pos: [...spots[m.spot]!.stand] });
      }
      if (tick % sweepEvery === 0) service.sweep();
      const cpu = process.threadCpuUsage(cpu0);
      if (tick >= WARMUP_TICKS) own.push((cpu.user + cpu.system) / 1000);
    },
  });
  const st = service.stats();
  const refused = Object.values(st.refused).reduce((a, b) => a + b, 0);
  await service.close();
  return {
    ...r,
    extra: {
      nodes: spots.length,
      hits: st.hits,
      refused,
      ...Object.fromEntries(Object.entries(st.refused).map(([k, v]) => [`refused_${k}`, v])),
      broken: st.broken,
      touchedNodes: st.nodes,
      cellsScattered: st.scattered,
      nodesMessages: st.pushed,
      avgControlBytesPerSessionTick: Math.round(sinks.reduce((s, x) => s + x.textBytes, 0) / (sinks.length * (r.ticks + WARMUP_TICKS))),
      creatures: zone.fauna!.creatureCount,
      resourceCpuP50Ms: round(percentile(Float64Array.from(own), 50)),
      resourceCpuP95Ms: round(percentile(Float64Array.from(own), 95)),
      resourceCpuMaxMs: round(percentile(Float64Array.from(own), 100)),
    },
  };
}

/** A quaternion turning a ship's nose (0, 0, −1) to unit direction `dir` (as test/pilot.ts). */
function noseTo([x, y, z]: Readonly<Vec3>): Quat {
  if (-z < -0.999999) return [0, 1, 0, 0];
  const q: Quat = [y, -x, 0, 1 - z];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** 25 sessions in ships flying low over the home world among its herds at Tier 3, each firing at the creature nearest it. */
async function combatTrial(): Promise<TrialResult> {
  const rng = new Random(20261030);
  const system = describeZoneSystem(0);
  const body = system.bodies[system.home]!;
  const params = body.params as PlanetParams;
  const frame = frameId(system.seed, body.index);
  // the world's ground at the zone's tier, planned (and kept) before they start, as the surface trials do
  const ground = groundOf(params, 3);
  const center = openGround(ground);
  const [t, b] = tangents(center);
  const dirAt = (east: number, north: number): Dir => {
    const x = center[0] * ground.radius + t[0] * east + b[0] * north;
    const y = center[1] * ground.radius + t[1] * east + b[1] * north;
    const z = center[2] * ground.radius + t[2] * east + b[2] * north;
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  const over = (d: Dir, h: number): Vec3 => {
    const r = ground.radius + Math.max(0, ground.sample(d)) + h;
    return [d[0] * r, d[1] * r, d[2] * r];
  };
  let now = 0;
  // (the zone's combat calls the service's hooks, which is made over the zone)
  const made: { service: CombatService | null } = { service: null };
  const zone = new Zone({ id: 'bench-combat', systemIndex: 0, system, fauna: { tier: 3 }, combat: () => made.service?.hooks ?? null });
  const inventory = new InventoryService();
  const progress = new CharacterProgress();
  const service = (made.service = new CombatService({
    zones: { zone: (id) => (id === zone.id ? zone : undefined), zoneOf: (v) => (zone.has(v) ? zone : undefined), tier: () => 3 },
    inventory,
    progress,
    now: () => now,
    grounds: nodeGroundsHere,
    seed: 11,
  }));
  const walkers = zone.fauna!.speciesOf(body.index).filter((sp) => sp.kind !== 'flyer' && sp.spawn === 'herd');
  const SPEED = 40;
  const SIDE = 1000;
  const REACH = 600;
  const cooldown = 0.12;
  const sinks: MinerSink[] = [];
  const ships: { sink: MinerSink; east: number; north: number; heading: number; alt: number; seq: number; shot: number; pos: Vec3; target: number | null }[] =
    [];
  for (let i = 0; i < SESSIONS; i++) {
    const sink = new MinerSink(i + 1, `gunner-${i}`);
    sinks.push(sink);
    inventory.open(sink.characterId);
    progress.set(sink.characterId, { level: 20, xp: 0, homeSystem: 0 });
    const east = rng.float(-SIDE / 2, SIDE / 2);
    const north = rng.float(-SIDE / 2, SIDE / 2);
    const alt = rng.float(60, 150);
    const pos = over(dirAt(east, north), alt);
    zone.join(
      sink,
      { kind: 'player', frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship', name: `Gunner ${i}`, people: 'thalune', level: 20 },
      { profile: { characterId: sink.characterId, ship: LARK, skills: [] }, now: 2.3e7 },
    );
    ships.push({ sink, east, north, heading: rng.float(0, Math.PI * 2), alt, seq: 0, shot: 0, pos, target: null });
  }
  let spawned = 0;
  const step = (time: number, tick: number) => {
    now = time;
    // herds put down round the ships as they thin out (a respawn, outside the measure as the herd spawner's own is not)
    if (tick % 20 === 0 && zone.fauna!.creatureCount < 110 && walkers.length) {
      const s = ships[rng.int(0, ships.length - 1)]!;
      const a = rng.float(0, Math.PI * 2);
      const at = dirAt(s.east + Math.cos(a) * 150, s.north + Math.sin(a) * 150);
      if (zone.fauna!.spawnHerd({ body: body.index, species: walkers[rng.int(0, walkers.length - 1)]!.index, at, count: rng.int(2, 5) })) spawned++;
    }
    const creatures = [...zone.fauna!.creaturesIn(frame)];
    for (const s of ships) {
      if (Math.abs(s.east) > SIDE / 2 || Math.abs(s.north) > SIDE / 2) s.heading = Math.atan2(-s.north, -s.east);
      else if (rng.next() < 0.01) s.heading += rng.float(-1, 1);
      s.east += Math.cos(s.heading) * SPEED * DT;
      s.north += Math.sin(s.heading) * SPEED * DT;
      const prev = s.pos;
      s.pos = over(dirAt(s.east, s.north), s.alt);
      // the nearest creature in reach, nose on it
      let best: { id: number; d: number; at: Vec3 } | null = null;
      for (const c of creatures) {
        const d = Math.hypot(c.pos[0] - s.pos[0], c.pos[1] - s.pos[1], c.pos[2] - s.pos[2]);
        if (d < REACH && (!best || d < best.d)) best = { id: c.id, d, at: [c.pos[0], c.pos[1], c.pos[2]] };
      }
      s.target = best?.id ?? null;
      const ahead = best ? best.at : over(dirAt(s.east + Math.cos(s.heading) * 100, s.north + Math.sin(s.heading) * 100), s.alt);
      const aim = [ahead[0] - s.pos[0], ahead[1] - s.pos[1], ahead[2] - s.pos[2]];
      const l = Math.hypot(...aim);
      const vel: Vec3 = [(s.pos[0] - prev[0]) / DT, (s.pos[1] - prev[1]) / DT, (s.pos[2] - prev[2]) / DT];
      zone.input(s.sink, {
        t: 'input',
        seq: ++s.seq,
        time,
        mode: 'ship',
        pose: { frame, pos: s.pos, quat: noseTo([aim[0]! / l, aim[1]! / l, aim[2]! / l]), vel },
        buttons: 1,
      });
    }
  };
  /** the combat service's own CPU per tick */
  const own: number[] = [];
  let shotSeq = 0;
  const r = await measure(zone, sinks, rng, step, {
    during: (time, tick) => {
      const cpu0 = process.threadCpuUsage();
      now = time;
      for (const [i, s] of ships.entries()) {
        // every cooldown, phased over the ships
        if (s.target === null || time < s.shot) continue;
        s.shot = time + cooldown + (i % 3) * 1e-3;
        const c = zone.fauna!.creature(s.target);
        if (!c) continue;
        const aim = [c.pos[0] - s.pos[0], c.pos[1] - s.pos[1], c.pos[2] - s.pos[2]];
        const l = Math.hypot(...aim);
        service.fire(s.sink, { t: 'fire', seq: ++shotSeq, time, frame, aim: [aim[0]! / l, aim[1]! / l, aim[2]! / l] });
      }
      const cpu = process.threadCpuUsage(cpu0);
      if (tick >= WARMUP_TICKS) own.push((cpu.user + cpu.system) / 1000);
    },
  });
  const st = service.stats();
  const zs = zone.combat.stats();
  return {
    ...r,
    extra: {
      shots: st.shots,
      hits: st.hits,
      misses: st.misses,
      blocked: st.blocked,
      refused: Object.values(st.refused).reduce((a, x) => a + x, 0),
      ...Object.fromEntries(Object.entries(st.refused).map(([k, v]) => [`refused_${k}`, v])),
      kills: st.kills,
      herdsPutDown: spawned,
      creatures: zone.fauna!.creatureCount,
      eventsSent: zs.eventsSent,
      eventsDropped: zs.eventsDropped,
      sightSamples: st.sightSamples,
      avgControlBytesPerSessionTick: Math.round(sinks.reduce((s, x) => s + x.textBytes, 0) / (sinks.length * (r.ticks + WARMUP_TICKS))),
      combatCpuP50Ms: round(percentile(Float64Array.from(own), 50)),
      combatCpuP95Ms: round(percentile(Float64Array.from(own), 95)),
      combatCpuMaxMs: round(percentile(Float64Array.from(own), 100)),
    },
  };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

let failed = false;
/** `pnpm --filter @astra/server bench -- <words>` runs only the trials whose names hold them. */
const only = process.argv.slice(2).filter((a) => a !== '--');
for (const [name, run] of [
  ['station', stationTrial],
  ['surface: 25 players in 1 km²', surfaceTrial(25, 1000)],
  ['surface: 50 players in 4 km²', surfaceTrial(50, 2000)],
  ['arrival: 25 players on an unplanned world', arrivalTrial],
  ['nightfall: 25 players round a den at Tier 2', nightfallTrial(2)],
  ['nightfall: 25 players round a den at Tier 3', nightfallTrial(3)],
  ['mining: 25 players mining shared nodes', miningTrial],
  ['combat: 25 players in ships firing at herds', combatTrial],
] as const) {
  if (only.length && !only.some((w) => name.includes(w))) continue;
  const r = await run();
  const cpuP95 = percentile(r.cpu, 95);
  // with movement authority: the tick with its players' input checks
  const withInputsP95 = r.inputs
    ? percentile(
        r.cpu.map((c, i) => c + r.inputs![i]!),
        95,
      )
    : null;
  if (r.inputs)
    r.extra = {
      ...r.extra,
      inputChecksCpuP50Ms: round(percentile(r.inputs, 50)),
      inputChecksCpuP95Ms: round(percentile(r.inputs, 95)),
      tickWithInputChecksCpuP95Ms: round(withInputsP95!),
      corrections: r.corrections ?? 0,
    };
  report(name, r, cpuP95);
  const failures: string[] = [];
  if (cpuP95 >= BUDGET_P95_MS) failures.push(`tick CPU p95 ${round(cpuP95)} ms is over the ${BUDGET_P95_MS} ms budget`);
  if (withInputsP95 !== null && withInputsP95 >= BUDGET_P95_MS)
    failures.push(`tick CPU p95 with its input checks ${round(withInputsP95)} ms is over the ${BUDGET_P95_MS} ms budget`);
  if (r.corrections) failures.push(`${r.corrections} honest inputs were corrected, the first: ${JSON.stringify(r.corrected)}`);
  if (failures.length) {
    for (const f of failures) console.error(`FAIL (${name}): ${f}`);
    failed = true;
  } else {
    const inputs = withInputsP95 === null ? '' : ` (${round(withInputsP95)} ms with its input checks)`;
    console.log(`PASS (${name}): tick CPU p95 ${round(cpuP95)} ms${inputs} < ${BUDGET_P95_MS} ms at ${r.avgEntities} entities and ${r.sessions} sessions`);
  }
}

// one input check where it is dearest
const checks = checkCost();
const dearest = Math.max(...Object.values(checks).map((c) => c.p50));
const corrected = Object.values(checks).reduce((n, c) => n + c.corrections, 0);
console.log(JSON.stringify({ trial: 'input check cost, µs', ...checks }, null, 2));
if (dearest >= CHECK_BUDGET_US || corrected > 0) {
  if (dearest >= CHECK_BUDGET_US) console.error(`FAIL (input checks): an input check's CPU median ${dearest} µs is over ${CHECK_BUDGET_US} µs`);
  if (corrected > 0) console.error(`FAIL (input checks): ${corrected} honest inputs were corrected`);
  failed = true;
} else {
  console.log(`PASS (input checks): an input check ${dearest} µs at its dearest (median) < ${CHECK_BUDGET_US} µs`);
}
await groundPlanner.close();
if (failed) process.exit(1);

function report(name: string, r: TrialResult, cpuP95: number): void {
  console.log(
    JSON.stringify(
      {
        trial: name,
        entities: r.avgEntities,
        sessions: r.sessions,
        ticks: r.ticks,
        cpuP50Ms: round(percentile(r.cpu, 50)),
        cpuP95Ms: round(cpuP95),
        cpuP99Ms: round(percentile(r.cpu, 99)),
        wallP50Ms: round(percentile(r.wall, 50)),
        wallP95Ms: round(percentile(r.wall, 95)),
        wallP99Ms: round(percentile(r.wall, 99)),
        wallMaxMs: round(percentile(r.wall, 100)),
        avgInterest: r.avgInterest,
        avgSnapshotBytes: r.avgSnapshotBytes,
        ...r.extra,
        load1m: round(loadavg()[0]!),
        cpus: cpus().length,
        node: process.version,
      },
      null,
      2,
    ),
  );
}
