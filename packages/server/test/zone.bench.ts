// `pnpm --filter @astra/server bench`: two trials, each failing when the tick's p95 is over the budget of 10 ms
// (IMPLEMENTATION_PLAN 0.3).
//
// The station trial: one zone with 200 entities (25 players, ships, mobs, NPCs, loot and pods, every one moving every
// tick) and 25 sessions, ticked 2000 times, once.
//
// The layout is the expensive case: everything is crowded round the home Waystation, so nearly every entity is in every
// session's interest set and every session gets a 150–200-entity delta every tick. Sessions acknowledge each snapshot 1–4
// ticks later (a 50–200 ms round trip), so deltas are diffed against several different baselines. Every mover keeps
// sending its pose in the frame it was placed in, so the zone re-expresses each one beyond that frame's sphere of
// influence (most ships, and the far ones) in the frame it belongs in, every tick.
//
// The surface trial (P1.E08.T01): the same 25 sessions on foot on the home world, walking about a 1 km square of it at a
// Tier 3 system's fauna, so herds spawn in the cells round them, wander, flee, charge and hunt them; the zone's
// entities are the players and whatever creatures their cells hold.
//
// The gate is the main thread's CPU time per tick: the tick's own cost, which preemption by other processes on a shared
// machine does not inflate. Wall time per tick is printed beside it for information, with the load average.
import { cpus, loadavg } from 'node:os';
import { frameId, Random, type PlanetParams } from '@astra/shared/world';
import type { Vec3 as Dir } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import { percentile } from '../src/zones/metrics.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { Zone, type EntityInit, type EntityKind, type ZoneViewer } from '../src/zones/zone.ts';
import { openGround } from './faunaWorld.ts';

const ENTITIES = 200;
const SESSIONS = 25;
const WARMUP_TICKS = 300;
const TICKS = 2000;
const BUDGET_P95_MS = 10;
const DT = 0.05;

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
  seq: number;
}

interface TrialResult {
  wall: Float64Array;
  cpu: Float64Array;
  avgInterest: number;
  avgSnapshotBytes: number;
  /** entities in the zone, averaged over the measured ticks */
  avgEntities: number;
}

/** Ticks a zone, feeding acks back 1–4 ticks late, and measures each tick. */
function measure(zone: Zone, sinks: Sink[], rng: Random, beforeTick: (time: number) => void): TrialResult {
  /** acks in flight: delivered at tick `at` */
  const acks: { at: number; viewer: Sink; tick: number }[] = [];
  let time = 2.3e7;

  /** One tick: wall ms (measured by the zone) and main-thread CPU ms. */
  function tick(): [number, number] {
    beforeTick(time);
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

  for (let i = 0; i < WARMUP_TICKS; i++) tick();
  const bytesBefore = sinks.reduce((n, s) => n + s.bytes, 0);
  let interest = 0;
  let entities = 0;
  const wall = new Float64Array(TICKS);
  const cpu = new Float64Array(TICKS);
  for (let i = 0; i < TICKS; i++) {
    [wall[i], cpu[i]] = tick();
    entities += zone.entityCount;
    for (const s of sinks) interest += zone.interestOf(s).size;
  }
  const bytes = sinks.reduce((n, s) => n + s.bytes, 0) - bytesBefore;
  return {
    wall,
    cpu,
    avgInterest: Math.round(interest / (TICKS * SESSIONS)),
    avgSnapshotBytes: Math.round(bytes / (TICKS * SESSIONS)),
    avgEntities: Math.round(entities / TICKS),
  };
}

function stationTrial(): TrialResult {
  const rng = new Random(20261026);
  const around = (r: number): Vec3 => [rng.float(-r, r), rng.float(-r * 0.3, r * 0.3), rng.float(-r, r)];
  const randomQuat = (): Quat => {
    const q: Quat = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
    const n = Math.hypot(...q) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  };

  const zone = new Zone({ id: 'bench', systemIndex: 0, system: describeZoneSystem(0) });
  const station = zone.stationFrame;
  const home = `${zone.system.seed}:${zone.system.home}`;
  const movers: Mover[] = [];

  // 25 players at the Waystation, in their ships or on foot
  const sinks: Sink[] = [];
  for (let i = 0; i < SESSIONS; i++) {
    const sink = new Sink(i + 1);
    sinks.push(sink);
    const pos = around(300);
    const quat = randomQuat();
    const mode = i % 3 ? 'ship' : 'foot';
    const id = zone.join(sink, { kind: 'player', frame: station, pos, quat, vel: [0, 0, 0], mode, name: `Pilot ${i}`, people: 'thalune', level: 5 });
    movers.push({ id, frame: station, pos, quat, vel: around(10), viewer: sink, seq: 0 });
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

  function moveEverything(time: number): void {
    for (const m of movers) {
      m.pos = [m.pos[0] + m.vel[0] * DT, m.pos[1] + m.vel[1] * DT, m.pos[2] + m.vel[2] * DT];
      if (rng.next() < 0.05) m.vel = around(m.viewer ? 10 : 4);
      if (rng.next() < 0.3) m.quat = randomQuat();
      if (m.viewer) {
        zone.input(m.viewer, { t: 'input', seq: ++m.seq, time, mode: 'ship', pose: { frame: m.frame, pos: m.pos, quat: m.quat, vel: m.vel }, buttons: 0 });
      } else {
        // an occasional hp change, as combat will make
        const extra = rng.next() < 0.02 ? { hp: rng.next() } : {};
        zone.patch(m.id, { frame: m.frame, pos: m.pos, quat: m.quat, vel: m.vel, ...extra });
      }
    }
  }

  return measure(zone, sinks, rng, moveEverything);
}

/** 25 players on foot walking about a square kilometre of the home world among its herds, at Tier 3. */
function surfaceTrial(): TrialResult {
  const rng = new Random(20261027);
  const system = describeZoneSystem(0);
  const zone = new Zone({ id: 'bench-surface', systemIndex: 0, system, fauna: { tier: 3 } });
  const body = system.bodies[system.home]!;
  const frame = frameId(system.seed, body.index);
  const ground = groundOf(body.params as PlanetParams);
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
  const sinks: Sink[] = [];
  const walkers: { sink: Sink; east: number; north: number; heading: number; seq: number }[] = [];
  for (let i = 0; i < SESSIONS; i++) {
    const sink = new Sink(i + 1);
    sinks.push(sink);
    const east = rng.float(-500, 500);
    const north = rng.float(-500, 500);
    zone.join(sink, {
      kind: 'player',
      frame,
      pos: onGround(dirAt(east, north)),
      quat: [0, 0, 0, 1],
      vel: [0, 0, 0],
      mode: 'foot',
      name: `Walker ${i}`,
      people: 'thalune',
      level: 5,
    });
    walkers.push({ sink, east, north, heading: rng.float(0, Math.PI * 2), seq: 0 });
  }
  const SPEED = 3;
  return measure(zone, sinks, rng, (time) => {
    for (const w of walkers) {
      if (rng.next() < 0.01) w.heading += rng.float(-1.5, 1.5);
      // turn back towards the middle at the edge of the square
      if (Math.abs(w.east) > 500 || Math.abs(w.north) > 500) w.heading = Math.atan2(-w.north, -w.east);
      w.east += Math.cos(w.heading) * SPEED * DT;
      w.north += Math.sin(w.heading) * SPEED * DT;
      const pos = onGround(dirAt(w.east, w.north));
      zone.input(w.sink, { t: 'input', seq: ++w.seq, time, mode: 'foot', pose: { frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
    }
  });
}

const round = (x: number) => Math.round(x * 1000) / 1000;
let failed = false;
for (const [name, run] of [
  ['station', stationTrial],
  ['surface', surfaceTrial],
] as const) {
  const r = run();
  const cpuP95 = percentile(r.cpu, 95);
  report(name, r, cpuP95);
  if (cpuP95 >= BUDGET_P95_MS) {
    console.error(`FAIL (${name}): tick CPU p95 ${round(cpuP95)} ms is over the ${BUDGET_P95_MS} ms budget`);
    failed = true;
  } else {
    console.log(`PASS (${name}): tick CPU p95 ${round(cpuP95)} ms < ${BUDGET_P95_MS} ms at ${r.avgEntities} entities and ${SESSIONS} sessions`);
  }
}
if (failed) process.exit(1);

function report(name: string, r: TrialResult, cpuP95: number): void {
  console.log(
    JSON.stringify(
      {
        trial: name,
        entities: r.avgEntities,
        sessions: SESSIONS,
        ticks: TICKS,
        cpuP50Ms: round(percentile(r.cpu, 50)),
        cpuP95Ms: round(cpuP95),
        cpuP99Ms: round(percentile(r.cpu, 99)),
        wallP50Ms: round(percentile(r.wall, 50)),
        wallP95Ms: round(percentile(r.wall, 95)),
        wallP99Ms: round(percentile(r.wall, 99)),
        wallMaxMs: round(percentile(r.wall, 100)),
        avgInterest: r.avgInterest,
        avgSnapshotBytes: r.avgSnapshotBytes,
        load1m: round(loadavg()[0]!),
        cpus: cpus().length,
        node: process.version,
      },
      null,
      2,
    ),
  );
}
