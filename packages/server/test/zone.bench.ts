// `pnpm --filter @astra/server bench`: four trials, each failing when the tick's p95 is over the budget of 10 ms
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
// The gate is the main thread's CPU time per tick: the tick's own cost, which preemption by other processes on a shared
// machine does not inflate (and in the station trial, the tick with its 25 players' input checks). Wall time per tick is
// printed beside it for information, with the load average.
import { cpus, loadavg } from 'node:os';
import { STATION_LAYOUT } from '@astra/shared/data';
import { frameId, frameIdOf, Random, systemPoses, type PlanetParams } from '@astra/shared/world';
import type { Vec3 as Dir } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { MAX_CREATURES } from '../src/fauna/sim.ts';
import { Ground, groundOf, groundPlanner, planPads } from '../src/fauna/terrain.ts';
import { Harness, LARK } from '../src/sim/movement/testing.ts';
import { groundOf as movementGround, heightAt } from '../src/sim/movement/world.ts';
import { percentile } from '../src/zones/metrics.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { Zone, type EntityInit, type EntityKind, type ZoneViewer } from '../src/zones/zone.ts';
import { openGround } from './faunaWorld.ts';

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

/** Ticks a zone, feeding acks back 1–4 ticks late, and measures each tick after the warm-up. */
async function measure(
  zone: Zone,
  sinks: Sink[],
  rng: Random,
  beforeTick: (time: number, tick: number) => void,
  { warmup = WARMUP_TICKS, ticks = TICKS, afterTick }: { warmup?: number; ticks?: number; afterTick?: (tick: number) => void } = {},
): Promise<TrialResult> {
  /** acks in flight: delivered at tick `at` */
  const acks: { at: number; viewer: Sink; tick: number }[] = [];
  let time = 2.3e7;
  let n = 0;

  /** One tick: wall ms (measured by the zone) and main-thread CPU ms. */
  function tick(): [number, number] {
    beforeTick(time, n++);
    time += DT;
    const cpu0 = process.threadCpuUsage();
    const wall = zone.step(time);
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
    afterTick?.(i);
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
 * system 0, else its first lush planet), at Tier 3. `planned`: the world's ground is planned (and kept) before they
 * start; otherwise the zone's planner is left to plan it when they arrive.
 */
function surfaceWalk(systemIndex: number, players: number, side: number, seed: number, planned: boolean) {
  const rng = new Random(seed);
  const system = describeZoneSystem(systemIndex);
  const zone = new Zone({ id: `bench-${systemIndex}-${players}`, systemIndex, system, fauna: { tier: 3 } });
  const body = systemIndex === 0 ? system.bodies[system.home]! : system.bodies.find((x) => x.type === 'lush' && x.kind === 'planet')!;
  const params = body.params as PlanetParams;
  const frame = frameId(system.seed, body.index);
  // (to find open ground; a ground that is not kept, when the zone must plan its own)
  const ground = planned ? groundOf(params) : new Ground(params, planPads(params));
  const center = openGround(ground);
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

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

let failed = false;
for (const [name, run] of [
  ['station', stationTrial],
  ['surface: 25 players in 1 km²', surfaceTrial(25, 1000)],
  ['surface: 50 players in 4 km²', surfaceTrial(50, 2000)],
  ['arrival: 25 players on an unplanned world', arrivalTrial],
] as const) {
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
