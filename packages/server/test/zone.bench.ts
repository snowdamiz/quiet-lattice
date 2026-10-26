// `pnpm --filter @astra/server bench`: one zone with 200 entities (25 players, ships, mobs, NPCs, loot and pods, every
// one moving every tick) and 25 sessions, ticked 2000 times, once. Fails when the tick's p95 is over the budget of
// 10 ms (IMPLEMENTATION_PLAN 0.3).
//
// The layout is the expensive case: everything is crowded round the home Waystation, so nearly every entity is in every
// session's interest set and every session gets a 150–200-entity delta every tick. Sessions acknowledge each snapshot 1–4
// ticks later (a 50–200 ms round trip), so deltas are diffed against several different baselines. Every mover keeps
// sending its pose in the frame it was placed in, so the zone re-expresses each one beyond that frame's sphere of
// influence (most ships, and the far ones) in the frame it belongs in, every tick.
//
// The zone holds its players to movement authority (P1.E03.T04), as the ZoneManager's zones do: the players fly honestly
// round the station's outside or walk its hangar floor, and every input is checked before it is applied. Their checks
// run outside the tick (on input, as the gateway's do), so they are timed apart from it; then the cost of one check is
// measured where it is dearest: low over a world (a terrain sample each), on foot on a world, and on the pulse drive.
//
// The gate is the main thread's CPU time per tick: the tick's own cost, which preemption by other processes on a shared
// machine does not inflate, and the tick with its 25 players' input checks. Wall time per tick is printed beside it for
// information, with the load average.
import { cpus, loadavg } from 'node:os';
import { STATION_LAYOUT } from '@astra/shared/data';
import { frameIdOf, Random, systemPoses } from '@astra/shared/world';
import { Harness, LARK } from '../src/sim/movement/testing.ts';
import { groundOf, heightAt } from '../src/sim/movement/world.ts';
import { percentile } from '../src/zones/metrics.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { Zone, type EntityInit, type EntityKind, type ZoneViewer } from '../src/zones/zone.ts';

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
  /** main-thread CPU of the tick's 25 input checks, ms */
  inputs: Float64Array;
  avgInterest: number;
  avgSnapshotBytes: number;
  corrections: number;
}

/** Outside the hangar block with room to spare (a flying player never touches its shell). */
const clearOfHangar = (p: Vec3) => !(p[0] > H.x0 - 20 && p[0] < H.x1 + 20 && p[1] > H.y0 - 20 && p[1] < H.y1 + 20 && p[2] > H.z0 - 20 && p[2] < H.z1 + 20);

function trial(): TrialResult {
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
  let time = 2.3e7;
  zone.step(time);

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
    const id = zone.join(sink, init, { profile: { ship: LARK, people: 'thalune' }, now: time });
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

  /** acks in flight: delivered at tick `at` */
  const acks: { at: number; viewer: Sink; tick: number }[] = [];
  let inputCpu = 0;

  function moveEverything(): void {
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
        const cpu0 = process.threadCpuUsage();
        zone.input(
          m.viewer,
          { t: 'input', seq: ++m.seq, time, mode: m.mode!, pose: { frame: m.frame, pos: m.pos, quat: m.quat, vel: m.vel }, buttons: 0 },
          time,
        );
        const cpu = process.threadCpuUsage(cpu0);
        inputCpu += (cpu.user + cpu.system) / 1000;
      } else {
        // an occasional hp change, as combat will make
        const extra = rng.next() < 0.02 ? { hp: rng.next() } : {};
        zone.patch(m.id, { frame: m.frame, pos: m.pos, quat: m.quat, vel: m.vel, ...extra });
      }
    }
  }

  /** One tick: wall ms (measured by the zone), main-thread CPU ms, and the CPU ms of its players' input checks. */
  function tick(): [number, number, number] {
    time += DT;
    inputCpu = 0;
    moveEverything();
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
    return [wall, (cpu.user + cpu.system) / 1000, inputCpu];
  }

  for (let i = 0; i < WARMUP_TICKS; i++) tick();
  const bytesBefore = sinks.reduce((n, s) => n + s.bytes, 0);
  let interest = 0;
  const wall = new Float64Array(TICKS);
  const cpu = new Float64Array(TICKS);
  const inputs = new Float64Array(TICKS);
  for (let i = 0; i < TICKS; i++) {
    [wall[i], cpu[i], inputs[i]] = tick();
    for (const s of sinks) interest += zone.interestOf(s).size;
  }
  const bytes = sinks.reduce((n, s) => n + s.bytes, 0) - bytesBefore;
  return {
    wall,
    cpu,
    inputs,
    avgInterest: Math.round(interest / (TICKS * SESSIONS)),
    avgSnapshotBytes: Math.round(bytes / (TICKS * SESSIONS)),
    corrections: zone.movement!.corrections,
  };
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
  const g = groundOf(d, d.home)!;
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

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
const r = trial();
const cpuP95 = percentile(r.cpu, 95);
const withInputs = r.cpu.map((c, i) => c + r.inputs[i]!);
const withInputsP95 = percentile(withInputs, 95);
const checks = checkCost();
const dearest = Math.max(...Object.values(checks).map((c) => c.p50));
console.log(
  JSON.stringify(
    {
      entities: ENTITIES,
      sessions: SESSIONS,
      ticks: TICKS,
      cpuP50Ms: round(percentile(r.cpu, 50)),
      cpuP95Ms: round(cpuP95),
      cpuP99Ms: round(percentile(r.cpu, 99)),
      wallP50Ms: round(percentile(r.wall, 50)),
      wallP95Ms: round(percentile(r.wall, 95)),
      wallP99Ms: round(percentile(r.wall, 99)),
      wallMaxMs: round(percentile(r.wall, 100)),
      inputChecksCpuP50Ms: round(percentile(r.inputs, 50)),
      inputChecksCpuP95Ms: round(percentile(r.inputs, 95)),
      tickWithInputChecksCpuP95Ms: round(withInputsP95),
      corrections: r.corrections,
      checkCostUs: checks,
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
const failures: string[] = [];
if (cpuP95 >= BUDGET_P95_MS) failures.push(`tick CPU p95 ${round(cpuP95)} ms is over the ${BUDGET_P95_MS} ms budget`);
if (withInputsP95 >= BUDGET_P95_MS) failures.push(`tick CPU p95 with its input checks ${round(withInputsP95)} ms is over the ${BUDGET_P95_MS} ms budget`);
if (dearest >= CHECK_BUDGET_US) failures.push(`an input check's CPU median ${dearest} µs is over ${CHECK_BUDGET_US} µs`);
const corrected = r.corrections + Object.values(checks).reduce((n, c) => n + c.corrections, 0);
if (corrected > 0) failures.push(`${corrected} honest inputs were corrected`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log(
  `PASS: tick CPU p95 ${round(cpuP95)} ms (${round(withInputsP95)} ms with its input checks) < ${BUDGET_P95_MS} ms at ${ENTITIES} entities and ${SESSIONS} sessions; an input check ${dearest} µs at its dearest (median)`,
);
