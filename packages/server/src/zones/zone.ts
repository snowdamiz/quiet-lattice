// A zone (docs/ARCHITECTURE.md §6): one star system and every entity in it, ticked at a fixed step by the ZoneManager.
// Each tick takes the system's body poses at the tick's time (systemPoses, so they match every client's), puts every
// entity's world position into a spatial hash per interest class, then for each session works out its interest set and
// sends it a snapshot: a delta against the state it last acknowledged, or a full one when there is none (delta.ts).
//
// Entities keep their pose as it travels on the wire (§4): a frame id, a position, quaternion and velocity in that
// frame. Their world position comes from the frame's pose at the tick's time. An entity's wire state is rebuilt once per
// tick when it changed, sanitising only the fields that changed (sanitizeEntity checks each field on its own, so the
// rest stay as they were sanitised before), then encoded per session with `sanitized: true`. A wire state is never
// mutated afterwards: snapshot histories share it.
import { performance } from 'node:perf_hooks';
import {
  encodeSnapshot,
  ENTITY_FIELDS,
  sanitizeEntity,
  type ClientMessage,
  type EntityField,
  type EntityState,
  type FrameId,
  type Snapshot,
} from '@astra/shared/protocol';
import { frameId, localToWorld, systemPoses, type Frame, type SystemDescription } from '@astra/shared/world';
import { diffAgainstSent, SnapshotHistory, type EntityDiff } from './delta.ts';
import { INTEREST_CLASSES, INTEREST_HYSTERESIS, INTEREST_RADIUS, interestClass, type InterestClass } from './interest.ts';
import { TickTimes } from './metrics.ts';
import { SpatialHash } from './spatialHash.ts';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
export type EntityKind = NonNullable<EntityState['kind']>;
type InputMessage = Extract<ClientMessage, { t: 'input' }>;

/** An entity's wire fields: everything an EntityState carries but its id and `clear`. */
export type EntityFields = Omit<EntityState, 'id' | 'clear'>;

/** A new entity: its kind and pose, any other wire fields, and its party (members always see each other). */
export interface EntityInit extends EntityFields {
  kind: EntityKind;
  frame: FrameId;
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  party?: string | null;
}

/** Fields every zone entity has: they place it in the world and may not be cleared. */
const REQUIRED: ReadonlySet<EntityField> = new Set<EntityField>(['kind', 'frame', 'pos', 'quat', 'vel']);
/** Fields an input sets. */
const INPUT_FIELDS: readonly EntityField[] = ['frame', 'pos', 'quat', 'vel', 'mode'];

/**
 * Until movement authority (P1.E03.T04) a client's pose is taken as sent, clamped only to magnitudes no honest client
 * reaches: 1e11 m from its frame's origin (a thousand times a system's reach; deep space is another zone, P1.E04.T04) and
 * 1e9 m/s. The entity is marked unvalidated.
 */
export const INPUT_LIMITS = { maxDistance: 1e11, maxSpeed: 1e9 } as const;

/** Where a zone sends a session's snapshots: the gateway's Session, or a stand-in in tests and the bench. */
export interface ZoneViewer {
  readonly id: number;
  sendBinary(data: Uint8Array): void;
}

/** A pino-shaped logger (Fastify's). */
export interface ZoneLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

/** What an input did: applied, refused as older than the last one, or refused for a frame outside this system. */
export type InputResult = 'ok' | 'stale' | 'frame' | 'unknown';

/** A read-only look at an entity. */
export interface ZoneEntity {
  readonly id: number;
  readonly fields: Readonly<EntityInit>;
  /** world position (the system's inertial frame) at the last tick's time */
  readonly world: Readonly<Vec3>;
  readonly cls: InterestClass;
  readonly party: string | null;
  /** its pose is a client's claim that nothing has checked yet */
  readonly unvalidated: boolean;
  /** the last input applied to it */
  readonly input: { seq: number; buttons: number; aim?: Quat } | null;
}

class Entity implements ZoneEntity {
  world: Vec3 = [0, 0, 0];
  unvalidated = false;
  input: ZoneEntity['input'] = null;
  /** sanitised wire state; null until first built */
  wire: EntityState | null = null;
  /** fields set or cleared since the wire state was built */
  readonly changed = new Set<EntityField>();
  /** this tick's diffs against each baseline state seen (a handful), so sessions sharing a baseline share the work */
  readonly diffFrom: EntityState[] = [];
  readonly diffs: EntityDiff[] = [];
  diffTick = -1;

  constructor(
    readonly id: number,
    public fields: EntityInit,
    public cls: InterestClass,
    public party: string | null,
  ) {}
}

interface View {
  readonly viewer: ZoneViewer;
  readonly entityId: number;
  readonly history: SnapshotHistory;
  /** entity ids in its interest set as of the last tick, ascending */
  interest: number[];
  /** last input seq applied, -1 before the first */
  lastInputSeq: number;
  bytesSent: number;
}

export interface ZoneMetrics {
  id: string;
  system: number;
  tick: number;
  entities: number;
  sessions: number;
  /** tick duration percentiles over the last 400 ticks, ms */
  p50: number;
  p95: number;
  max: number;
}

export interface ZoneOptions {
  id: string;
  /** galaxy system index */
  systemIndex: number;
  system: SystemDescription;
  log?: ZoneLog;
}

export class Zone {
  readonly id: string;
  readonly systemIndex: number;
  readonly system: SystemDescription;
  /** ticks run so far; snapshot `tick` */
  tick = 0;
  /** world time of the last tick */
  time = 0;
  readonly times = new TickTimes();
  /** wire fields dropped by sanitizeEntity, ever (each is a server bug) */
  droppedFields = 0;

  private readonly log?: ZoneLog;
  private readonly entities = new Map<number, Entity>();
  private readonly views = new Map<ZoneViewer, View>();
  private readonly parties = new Map<string, Set<number>>();
  /** one hash per interest class, its cells as large as the class's radius with the hysteresis margin */
  private readonly hashes = {} as Record<InterestClass, SpatialHash>;
  /** frame id → body index or 'station' */
  private readonly frames = new Map<string, number | 'station'>();
  /** frame id → its pose at the last tick's time */
  private readonly framePoses = new Map<string, Frame>();
  private nextEntityId = 1;
  private lastDropLog = -Infinity;
  /** scratch space for gathering interest sets */
  private scratch = new Uint32Array(1024);

  constructor(opts: ZoneOptions) {
    this.id = opts.id;
    this.systemIndex = opts.systemIndex;
    this.system = opts.system;
    this.log = opts.log;
    for (const c of INTEREST_CLASSES) this.hashes[c] = new SpatialHash(INTEREST_RADIUS[c] * INTEREST_HYSTERESIS);
    opts.system.bodies.forEach((_, i) => this.frames.set(frameId(opts.system.seed, i), i));
    this.frames.set(frameId(opts.system.seed, 'station'), 'station');
  }

  get entityCount(): number {
    return this.entities.size;
  }

  get sessionCount(): number {
    return this.views.size;
  }

  /** The Waystation's frame id. */
  get stationFrame(): NonNullable<FrameId> {
    return frameId(this.system.seed, 'station');
  }

  /** Whether `frame` is this system's inertial frame (null) or one of its bodies or its Waystation. */
  hasFrame(frame: FrameId): boolean {
    return frame === null || this.frames.has(frame);
  }

  // ---------- entities ----------

  /** Adds an entity and returns its id (unique in this zone, never reused). */
  spawn(init: EntityInit): number {
    if (!this.hasFrame(init.frame)) throw new RangeError(`frame ${init.frame} is not in system ${this.systemIndex}`);
    const id = this.nextEntityId++;
    const { party = null, ...fields } = init;
    const e = new Entity(id, copyFields(fields) as EntityInit, interestClass(init.kind, init.mode), party);
    this.entities.set(id, e);
    if (party !== null) this.joinParty(id, party);
    return id;
  }

  /** Removes an entity; a session whose own entity it was leaves the zone. */
  despawn(id: number): boolean {
    const e = this.entities.get(id);
    if (!e) return false;
    for (const v of this.views.values()) if (v.entityId === id) this.views.delete(v.viewer);
    this.hashes[e.cls].remove(id);
    if (e.party !== null) this.leaveParty(id, e.party);
    this.entities.delete(id);
    return true;
  }

  entity(id: number): ZoneEntity | undefined {
    return this.entities.get(id);
  }

  entityIds(): IterableIterator<number> {
    return this.entities.keys();
  }

  /** Sets wire fields (undefined values are ignored) and removes those in `clear`; kind, frame and pose stay. */
  patch(id: number, set: Partial<EntityFields>, clear: readonly EntityField[] = []): void {
    const e = this.mustGet(id);
    if (set.frame !== undefined && !this.hasFrame(set.frame)) throw new RangeError(`frame ${set.frame} is not in system ${this.systemIndex}`);
    for (const k of clear) if (REQUIRED.has(k)) throw new Error(`cannot clear ${k}`);
    const fields = e.fields as unknown as Record<string, unknown>;
    for (const k in set) {
      const v = set[k as keyof EntityFields];
      if (v === undefined) continue;
      fields[k] = Array.isArray(v) ? [...v] : v;
      e.changed.add(k as EntityField);
    }
    for (const k of clear) {
      delete fields[k];
      e.changed.add(k);
    }
    this.touch(e);
  }

  /** Puts the entity in its party (members always see each other), or in none. */
  setParty(id: number, party: string | null): void {
    const e = this.mustGet(id);
    if (e.party === party) return;
    if (e.party !== null) this.leaveParty(id, e.party);
    e.party = party;
    if (party !== null) this.joinParty(id, party);
  }

  // ---------- sessions ----------

  /** Spawns the session's entity and starts sending it snapshots from the next tick. Returns the entity id. */
  join(viewer: ZoneViewer, init: EntityInit): number {
    if (this.views.has(viewer)) throw new Error(`session ${viewer.id} is already in zone ${this.id}`);
    const entityId = this.spawn(init);
    this.views.set(viewer, { viewer, entityId, history: new SnapshotHistory(), interest: [], lastInputSeq: -1, bytesSent: 0 });
    return entityId;
  }

  /** Removes the session and its entity. False when it was not here. */
  leave(viewer: ZoneViewer): boolean {
    const v = this.views.get(viewer);
    if (!v) return false;
    this.views.delete(viewer);
    this.despawn(v.entityId);
    return true;
  }

  has(viewer: ZoneViewer): boolean {
    return this.views.has(viewer);
  }

  /** The session's own entity id. */
  entityOf(viewer: ZoneViewer): number | undefined {
    return this.views.get(viewer)?.entityId;
  }

  /** The entity ids in the session's interest set as of the last tick. */
  interestOf(viewer: ZoneViewer): ReadonlySet<number> {
    return new Set(this.views.get(viewer)?.interest);
  }

  /** The session's snapshot history (what it holds per tick sent, and what it acknowledged). */
  historyOf(viewer: ZoneViewer): SnapshotHistory | undefined {
    return this.views.get(viewer)?.history;
  }

  bytesSentTo(viewer: ZoneViewer): number {
    return this.views.get(viewer)?.bytesSent ?? 0;
  }

  /**
   * Applies a client's input to its entity: its predicted pose and mode, taken as sent but clamped (INPUT_LIMITS) and
   * marked unvalidated; movement authority is P1.E03.T04. Inputs must come in seq order and in this system's frames.
   */
  input(viewer: ZoneViewer, msg: InputMessage): InputResult {
    const v = this.views.get(viewer);
    if (!v) return 'unknown';
    if (msg.seq <= v.lastInputSeq) return 'stale';
    if (!this.hasFrame(msg.pose.frame)) return 'frame';
    v.lastInputSeq = msg.seq;
    const e = this.mustGet(v.entityId);
    const f = e.fields;
    f.frame = msg.pose.frame;
    f.pos = clampLength(msg.pose.pos, INPUT_LIMITS.maxDistance);
    f.quat = normalised(msg.pose.quat);
    f.vel = clampLength(msg.pose.vel, INPUT_LIMITS.maxSpeed);
    f.mode = msg.mode;
    for (const k of INPUT_FIELDS) e.changed.add(k);
    e.unvalidated = true;
    e.input = { seq: msg.seq, buttons: msg.buttons, aim: msg.aim && normalised(msg.aim) };
    this.touch(e);
    return 'ok';
  }

  /** The client applied the snapshot of `tick`; later deltas are diffed against it. False when it is not one we hold. */
  ack(viewer: ZoneViewer, tick: number): boolean {
    return this.views.get(viewer)?.history.ack(tick) ?? false;
  }

  // ---------- the tick ----------

  /** Runs one tick at world time `time` and sends every session its snapshot. Returns how long it took, in ms. */
  step(time: number): number {
    const started = performance.now();
    this.tick++;
    this.time = time;

    const poses = systemPoses(this.system, time);
    for (const [id, body] of this.frames) this.framePoses.set(id, body === 'station' ? poses.station : poses.bodies[body]!);

    const dropped: string[] = [];
    for (const e of this.entities.values()) {
      if (!e.wire || e.changed.size) e.wire = wireState(e, dropped);
      const frame = e.fields.frame === null ? null : (this.framePoses.get(e.fields.frame) ?? null);
      const w = (e.world = localToWorld(frame, e.fields.pos));
      this.hashes[e.cls].insert(e.id, w[0], w[1], w[2]);
    }
    if (dropped.length) this.reportDropped(dropped);

    for (const v of this.views.values()) {
      const snap = this.snapshotFor(v);
      try {
        const bytes = encodeSnapshot(snap, undefined, { sanitized: true });
        v.bytesSent += bytes.length;
        v.viewer.sendBinary(bytes);
      } catch (err) {
        this.log?.warn({ zone: this.id, session: v.viewer.id, tick: this.tick, err: String(err) }, 'snapshot not sent');
      }
    }

    const ms = performance.now() - started;
    this.times.record(ms);
    return ms;
  }

  metrics(): ZoneMetrics {
    return {
      id: this.id,
      system: this.systemIndex,
      tick: this.tick,
      entities: this.entities.size,
      sessions: this.views.size,
      p50: this.times.percentile(50),
      p95: this.times.percentile(95),
      max: this.times.max(),
    };
  }

  /**
   * The session's interest set this tick, as ascending entity ids: its own entity, its party, and every entity within
   * its class's radius (or, if already in view, within the hysteresis margin).
   */
  private updateInterest(v: View): number[] {
    const self = this.mustGet(v.entityId);
    const [x, y, z] = self.world;
    const prev = v.interest;
    // gathered and sorted in a reusable typed array (a native numeric sort), then copied out without duplicates
    let n = 0;
    const add = (id: number) => {
      if (n === this.scratch.length) {
        const grown = new Uint32Array(this.scratch.length * 2);
        grown.set(this.scratch);
        this.scratch = grown;
      }
      this.scratch[n++] = id;
    };
    add(self.id);
    for (const c of INTEREST_CLASSES) {
      const r2 = INTEREST_RADIUS[c] ** 2;
      this.hashes[c].forEachWithin(x, y, z, INTEREST_RADIUS[c] * INTEREST_HYSTERESIS, (id, d2) => {
        if (d2 <= r2 || sortedHas(prev, id)) add(id);
      });
    }
    if (self.party !== null) for (const id of this.parties.get(self.party) ?? []) add(id);
    const sorted = this.scratch.subarray(0, n).sort();
    const ids: number[] = [];
    for (let i = 0; i < n; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) ids.push(sorted[i]!);
    v.interest = ids;
    return ids;
  }

  /**
   * The session's snapshot this tick: against its acknowledged baseline, the new entities in full, the changed ones as
   * deltas, and the ones gone from its interest set (or the zone) as removals; with no baseline, every entity in full.
   * Records what the client will hold once it applies it.
   */
  private snapshotFor(v: View): Snapshot {
    const ids = this.updateInterest(v);
    const base = v.history.baseline();
    const baseIds = base?.state.ids ?? [];
    const baseStates = base?.state.states ?? [];
    const states: EntityState[] = new Array<EntityState>(ids.length);
    const entities: EntityState[] = [];
    const removed: number[] = [];
    // both id lists ascend: walk them together
    let j = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      while (j < baseIds.length && baseIds[j]! < id) removed.push(baseIds[j++]!);
      const e = this.entities.get(id)!;
      const next = e.wire!;
      if (j < baseIds.length && baseIds[j] === id) {
        const prev = baseStates[j++]!;
        if (prev === next) {
          states[i] = next;
        } else {
          const d = this.diff(e, prev, next);
          if (d.delta) entities.push(d.delta);
          states[i] = d.sent;
        }
      } else {
        entities.push(next);
        states[i] = next;
      }
    }
    while (j < baseIds.length) removed.push(baseIds[j++]!);
    v.history.record(this.tick, { ids, states });
    const ack = Math.max(0, v.lastInputSeq);
    return base
      ? { tick: this.tick, time: this.time, ack, full: false, base: base.tick, entities, removed }
      : { tick: this.tick, time: this.time, ack, full: true, entities, removed };
  }

  private diff(e: Entity, prev: EntityState, next: EntityState): EntityDiff {
    if (e.diffTick !== this.tick) {
      e.diffFrom.length = 0;
      e.diffs.length = 0;
      e.diffTick = this.tick;
    }
    const i = e.diffFrom.indexOf(prev);
    if (i >= 0) return e.diffs[i]!;
    const d = diffAgainstSent(prev, next);
    e.diffFrom.push(prev);
    e.diffs.push(d);
    return d;
  }

  /** After a change: its interest class may have changed with its kind or mode. */
  private touch(e: Entity): void {
    const cls = interestClass(e.fields.kind, e.fields.mode);
    if (cls !== e.cls) {
      this.hashes[e.cls].remove(e.id);
      e.cls = cls;
    }
  }

  private mustGet(id: number): Entity {
    const e = this.entities.get(id);
    if (!e) throw new Error(`no entity ${id} in zone ${this.id}`);
    return e;
  }

  private joinParty(id: number, party: string): void {
    let set = this.parties.get(party);
    if (!set) this.parties.set(party, (set = new Set()));
    set.add(id);
  }

  private leaveParty(id: number, party: string): void {
    const set = this.parties.get(party);
    set?.delete(id);
    if (set?.size === 0) this.parties.delete(party);
  }

  private reportDropped(dropped: string[]): void {
    this.droppedFields += dropped.length;
    const now = performance.now();
    if (now - this.lastDropLog < 5000) return;
    this.lastDropLog = now;
    this.log?.warn(
      { zone: this.id, tick: this.tick, dropped: dropped.slice(0, 20), total: this.droppedFields },
      'invalid entity fields dropped from snapshots',
    );
  }
}

/** Whether ascending `ids` holds `id` (binary search). */
function sortedHas(ids: readonly number[], id: number): boolean {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = ids[mid]!;
    if (v === id) return true;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** A copy of the fields with fresh arrays, so nothing the caller keeps can change the zone's state. */
function copyFields<T extends object>(fields: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = Array.isArray(v) ? [...(v as unknown[])] : v;
  return out as T;
}

/**
 * The entity as it goes on the wire this tick: its last wire state with the fields changed since re-sanitised, or every
 * field sanitised when it has none yet. Numbers are copied with -0 turned into 0: msgpack writes -0 as the integer 0,
 * and the state the zone remembers sending must be exactly what the client decodes.
 */
function wireState(e: Entity, dropped: string[]): EntityState {
  const prev = e.wire;
  const fields = e.fields as unknown as Record<string, unknown>;
  const raw: Record<string, unknown> = { id: e.id };
  for (const k of ENTITY_FIELDS) {
    if (prev && !e.changed.has(k)) continue;
    const v = fields[k];
    if (typeof v === 'number') raw[k] = v + 0;
    else if (Array.isArray(v)) raw[k] = v.map((x: number) => x + 0);
    else if (v !== undefined) raw[k] = v;
  }
  const fresh = sanitizeEntity(raw as EntityState, dropped) as Record<string, unknown>;
  e.changed.clear();
  if (!prev) return fresh as EntityState;
  // the fields in their canonical order, the changed ones fresh
  const out: Record<string, unknown> = { id: e.id };
  for (const k of ENTITY_FIELDS) {
    const v = k in raw || fields[k] === undefined ? fresh[k] : prev[k];
    if (v !== undefined) out[k] = v;
  }
  return out as EntityState;
}

function clampLength<T extends number[]>(v: T, max: number): T {
  let len = 0;
  for (const x of v) len += x * x;
  len = Math.sqrt(len);
  return (len > max ? v.map((x) => (x / len) * max) : [...v]) as T;
}

function normalised(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}
