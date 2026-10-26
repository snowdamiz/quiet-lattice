// `pnpm --filter @astra/server bench`: one zone with 200 entities (25 players, ships, mobs, NPCs, loot and pods, every
// one moving every tick) and 25 sessions, ticked 2000 times. Reports p50/p95 tick ms; fails above the 10 ms p95 budget
// (IMPLEMENTATION_PLAN 0.3).
//
// The layout is the expensive case: everything is crowded round the home Waystation, so nearly every entity is in every
// session's interest set and every session gets a 150–200-entity delta every tick. Sessions acknowledge each snapshot 1–4
// ticks later (a 50–200 ms round trip), so deltas are diffed against several different baselines.
import { Random } from '@astra/shared/world';
import { describeZoneSystem } from '../src/zones/system.ts';
import { percentile } from '../src/zones/metrics.ts';
import { Zone, type EntityInit, type EntityKind, type ZoneViewer } from '../src/zones/zone.ts';

const ENTITIES = 200;
const SESSIONS = 25;
const WARMUP_TICKS = 300;
const TICKS = 2000;
const BUDGET_P95_MS = 10;
const DT = 0.05;

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

const rng = new Random(20261026);

class Sink implements ZoneViewer {
  bytes = 0;
  frames = 0;
  constructor(readonly id: number) {}
  sendBinary(data: Uint8Array): void {
    this.bytes += data.length;
    this.frames++;
  }
}

function around(r: number): Vec3 {
  return [rng.float(-r, r), rng.float(-r * 0.3, r * 0.3), rng.float(-r, r)];
}

function randomQuat(): Quat {
  const [x, y, z, w] = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

interface Mover {
  id: number;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  viewer?: Sink;
  seq: number;
}

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
  const id = zone.join(sink, {
    kind: 'player',
    frame: station,
    pos,
    quat,
    vel: [0, 0, 0],
    mode: i % 3 ? 'ship' : 'foot',
    name: `Pilot ${i}`,
    people: 'thalune',
    level: 5,
  });
  movers.push({ id, pos, quat, vel: around(10), viewer: sink, seq: 0 });
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
    const init: EntityInit = { kind, frame: far ? home : station, pos, quat, vel: [0, 0, 0], mode: kind === 'mob' ? 'idle' : 'ship' };
    if (kind === 'mob') Object.assign(init, { species: i, level: 3, hp: 1 });
    if (kind === 'ship') Object.assign(init, { hull: 'kestrel', hp: 1, shield: 1, heat: 0 });
    if (kind === 'npc') Object.assign(init, { name: `Crew ${i}`, people: 'ixari' });
    movers.push({ id: zone.spawn(init), pos, quat, vel: around(kind === 'ship' ? 200 : 4), seq: 0 });
  }
}
if (zone.entityCount !== ENTITIES) throw new Error(`expected ${ENTITIES} entities, have ${zone.entityCount}`);

/** acks in flight: delivered at tick `at` */
const acks: { at: number; viewer: Sink; tick: number }[] = [];
let time = 2.3e7;

function moveEverything(): void {
  for (const m of movers) {
    m.pos = [m.pos[0] + m.vel[0] * DT, m.pos[1] + m.vel[1] * DT, m.pos[2] + m.vel[2] * DT];
    if (rng.next() < 0.05) m.vel = around(m.viewer ? 10 : 4);
    if (rng.next() < 0.3) m.quat = randomQuat();
    if (m.viewer) {
      zone.input(m.viewer, { t: 'input', seq: ++m.seq, time, mode: 'ship', pose: { frame: station, pos: m.pos, quat: m.quat, vel: m.vel }, buttons: 0 });
    } else {
      // an occasional hp change, as combat will make
      const extra = rng.next() < 0.02 ? { hp: rng.next() } : {};
      zone.patch(m.id, { pos: m.pos, quat: m.quat, vel: m.vel, ...extra });
    }
  }
}

function tick(): number {
  moveEverything();
  time += DT;
  const ms = zone.step(time);
  for (const s of sinks) acks.push({ at: zone.tick + 1 + rng.int(0, 3), viewer: s, tick: zone.tick });
  for (let i = acks.length - 1; i >= 0; i--) {
    const a = acks[i]!;
    if (a.at > zone.tick) continue;
    zone.ack(a.viewer, a.tick);
    acks.splice(i, 1);
  }
  return ms;
}

for (let i = 0; i < WARMUP_TICKS; i++) tick();
const bytesBefore = sinks.reduce((n, s) => n + s.bytes, 0);
let interest = 0;
const samples = new Float64Array(TICKS);
for (let i = 0; i < TICKS; i++) {
  samples[i] = tick();
  for (const s of sinks) interest += zone.interestOf(s).size;
}
const bytes = sinks.reduce((n, s) => n + s.bytes, 0) - bytesBefore;

const p50 = percentile(samples, 50);
const p95 = percentile(samples, 95);
const p99 = percentile(samples, 99);
const max = percentile(samples, 100);
const round = (x: number) => Math.round(x * 1000) / 1000;
console.log(
  JSON.stringify(
    {
      entities: zone.entityCount,
      sessions: zone.sessionCount,
      ticks: TICKS,
      p50Ms: round(p50),
      p95Ms: round(p95),
      p99Ms: round(p99),
      maxMs: round(max),
      avgInterest: Math.round(interest / (TICKS * SESSIONS)),
      avgSnapshotBytes: Math.round(bytes / (TICKS * SESSIONS)),
      node: process.version,
    },
    null,
    2,
  ),
);
if (p95 >= BUDGET_P95_MS) {
  console.error(`FAIL: p95 ${round(p95)} ms is over the ${BUDGET_P95_MS} ms budget`);
  process.exit(1);
}
console.log(`PASS: p95 ${round(p95)} ms < ${BUDGET_P95_MS} ms at ${ENTITIES} entities and ${SESSIONS} sessions`);
