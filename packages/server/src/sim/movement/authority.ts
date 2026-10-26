// Movement authority (P1.E03.T04, ARCHITECTURE §7): every player's input carries its predicted pose and mode; before a zone
// applies it, this checks it and either accepts it (with the mode the server now believes, which picks the entity's interest
// class) or refuses it with a `correction` to the last pose it can vouch for. One per zone.
//
// For each input, in order:
// 1. Time. The input's time is when it arrives at the server (MOVEMENT.short explains bunched inputs); the client's own
//    `time` is never read.
// 2. The pose. Its frame must be one the shared frame rule allows there; a ship may not be below the ground (the shared
//    terrain sampler, levelled under cities and sites as the client levels it), in a gas giant's depths or inside the
//    Waystation's hangar shell; a walker may not be below the ground, outside the hangar, or higher than anything it could
//    stand on for longer than a fall from there takes. Its mode must be legal there: the pulse drive only outside the air,
//    clear of what is ahead and high enough over a world to engage; landed only on dry ground on a world; docked only on a
//    Waystation pad no other ship holds; on foot only on a world's ground or in a hangar, set down beside the ship it got
//    out of, and boarding only the ship it is beside.
// 3. Anti-teleport. It may not lie further from the last valid pose than its allowance covers in the time since (a little
//    more for the network); a jump beyond that is refused outright.
// 4. Speed windows, the flight contract (FLIGHT_TOLERANCE in @astra/shared/ships): displacement in the pose's frame over at
//    least `windowS` of credited time, judged against the larger of the allowances at the window's two end poses. Windows
//    split where the frame changes and where the mode changes between the engines, the pulse drive, resting (landed or
//    docked) and walking; a stretch still under `windowS` is judged from its start. A walker's window is judged across the
//    ground, upward (plus the ground's own rise under it) and downward (no faster than a fall: `walkerFall`).
//
// Changes among the engine modes (space, boost, atmo) do not split a window: each end pose still takes its own mode's
// allowance with the contract's decay after a change (allowanceAfterChange), but the boost button is free, so a window
// across a change can only be judged more leniently than at boost, and splitting there would let a client tapping boost
// make every stretch a short one.
//
// A refused input is not applied. The correction rewinds to the last valid pose, or for a window that is too fast, to the
// window's start (every pose after it is part of what was too fast). Inputs already on their way from the old trajectory
// are refused quietly for MOVEMENT.correction.graceS, or until one fits the corrected pose; so corrections are rate-limited
// and in-flight inputs are not counted against the client. Each correction is logged with the account, character, rule and
// the measured and allowed values; MOVEMENT.kick.count of them within kick.withinS and the session is kicked.
import { STATION_LAYOUT, WALKER, type PeopleId } from '@astra/shared/data';
import { Buttons, type ClientMessage, type Pose } from '@astra/shared/protocol';
import {
  AIR,
  allowanceAfterChange,
  flightCaps,
  PULSE_DRIVE,
  SHIP_GEAR_HEIGHT,
  shipStats,
  walkerCaps,
  walkerFall,
  walkerStats,
  WALKER_TOLERANCE,
  type FlightCaps,
  type FlightMode,
  type ShipLoadout,
  type ShipStats,
  type WalkerCaps,
  type WalkerStats,
} from '@astra/shared/ships';
import { frameIdOf, frameKeyOf, type FrameKey, type SystemDescription, type SystemPoses } from '@astra/shared/world';
import { MOVEMENT, type MovementRule, type Violation } from './rules.ts';
import { dist, heightAt, insideHangar, insideHangarShell, len, MovementWorld, type Quat, type Vec3 } from './world.ts';

type InputMessage = Extract<ClientMessage, { t: 'input' }>;
/** The protocol's movement mode (ship, pulse, landed, docked, foot). */
export type MoveMode = InputMessage['mode'];

/** A pino-shaped logger (the zone's). */
export interface MovementLog {
  warn(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

/** What movement authority needs of a player: who it is (for the log), its ship and its skills. */
export interface MoverProfile {
  characterId?: string;
  accountId?: string;
  people?: PeopleId;
  /** The ship it flies (the server's default is the Lark until P1.E12.T05 gives characters their own). */
  ship: ShipLoadout;
  skills?: readonly string[];
}

/** How a pose moves: on the engines, on the pulse drive, at rest (landed or docked), or on foot. Speed windows split
 * between them. */
export type MoverClass = 'engine' | 'pulse' | 'rest' | 'foot';

export interface Correction {
  seq: number;
  pose: Pose;
  mode: MoveMode;
}

export interface MovementRefusal {
  ok: false;
  /** The correction to send; null when the input is refused quietly (it left before the last correction arrived). */
  correction: Correction | null;
  violation: Violation | null;
  /** Corrected too often: refuse the session with `kicked`. */
  kick: boolean;
}

export type MovementVerdict = { ok: true; mode: MoveMode; vel: Vec3 } | MovementRefusal;

/** A correction, as the authority keeps it for the dev tools and tests (the log has the same). */
export interface ViolationRecord extends Violation {
  entity: number;
  characterId?: string;
  accountId?: string;
  seq: number;
  /** server world time */
  at: number;
  mode: MoveMode;
  kicked: boolean;
}

/** A validated pose. */
interface Sample {
  seq: number;
  /** server world time it arrived at, s */
  t: number;
  /** how many inputs the mover had had accepted by then (windows under `windowS` read the 20 Hz spacing from it) */
  n: number;
  key: FrameKey;
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  mode: MoveMode;
  flight: FlightMode | 'foot';
  cls: MoverClass;
  /** a ship's caps here, and its allowance (m/s) with the decay after its last change of mode; null and 0 on foot */
  caps: FlightCaps | null;
  allowed: number;
  /** a ship's pulse clearance here (to the nearest anything, and ahead of it) */
  clearMin: number;
  clearAhead: number;
  /** a walker's height along its up (from the world's centre, or over the hangar floor), the ground's under it, the highest
   * it has been since it last stood on something, and since when it has been higher than anything to stand on */
  h: number;
  ground: number;
  peak: number;
  highSince: number | null;
  /** docked: its pad */
  pad: number | null;
}

interface Change {
  /** the caps before, with the allowance they had at the change */
  prev: FlightCaps;
  at: number;
}

class Mover {
  readonly ship: ShipStats;
  readonly walker: WalkerStats;
  readonly walkerCaps: WalkerCaps;
  last: Sample;
  /** the current window segment, oldest first; seg[0] is the previous segment's last pose when `boundary` is set */
  seg: Sample[];
  /** seg[0]'s allowance in this segment's terms, when it is the boundary */
  boundary: number | null = null;
  /** the last change between ship modes, for the decay after it */
  change: Change | null = null;
  /** where it left its ship (landed or docked), while on foot */
  parked: Sample | null;
  /** inputs accepted */
  count = 0;
  /** quiet refusals until then (server time) */
  graceUntil = -Infinity;
  /** server times of its corrections */
  readonly corrections: number[] = [];

  constructor(
    readonly id: number,
    readonly profile: MoverProfile,
    first: Sample,
  ) {
    this.ship = shipStats(profile.ship, { skills: profile.skills });
    this.walker = walkerStats({ skills: profile.skills, people: profile.people });
    this.walkerCaps = walkerCaps(this.walker);
    this.last = first;
    this.seg = [first];
    this.parked = first.cls === 'rest' ? first : null;
  }
}

const SHIP_CLASSES: ReadonlySet<MoverClass> = new Set(['engine', 'pulse', 'rest']);
const isShip = (c: MoverClass) => SHIP_CLASSES.has(c);
const RECENT_MAX = 64;

/** The docked pose on pad `i` of a Waystation, nose to the hangar's mouth. */
export function padPose(stationFrame: string, i: number): Pose {
  const pad = STATION_LAYOUT.pads[i]!;
  return { frame: stationFrame, pos: [pad.x, STATION_LAYOUT.padTop + SHIP_GEAR_HEIGHT, pad.z], quat: [0, 1, 0, 0], vel: [0, 0, 0] };
}

export interface MovementAuthorityOptions {
  /** the zone's id, for the log */
  zone: string;
  system: SystemDescription;
  log?: MovementLog;
}

/**
 * `MovementAuthority.poseProblem` for a system with no zone open: whether a saved pose and mode may be restored at server
 * world time `now` (character persistence calls this before putting a character back where it was saved). Null when it may.
 */
export function poseProblem(system: SystemDescription, pose: Pose, mode: MoveMode, now: number, profile: MoverProfile): Violation | null {
  return new MovementAuthority({ zone: 'restore', system }).poseProblem(pose, mode, profile, now);
}

export class MovementAuthority {
  readonly world: MovementWorld;
  /** corrections sent, inputs refused quietly, sessions kicked */
  corrections = 0;
  quiet = 0;
  kicks = 0;
  private readonly zone: string;
  private readonly log?: MovementLog;
  private readonly movers = new Map<number, Mover>();
  /** the movers holding each pad (a joining player is put on a pad even when all four are held) */
  private readonly pads: Set<number>[] = STATION_LAYOUT.pads.map(() => new Set<number>());
  private readonly recentLog: ViolationRecord[] = [];

  constructor(opts: MovementAuthorityOptions) {
    this.zone = opts.zone;
    this.log = opts.log;
    this.world = new MovementWorld(opts.system);
  }

  /** The zone's body poses at its tick's world time. */
  setPoses(poses: SystemPoses, time: number): void {
    this.world.setPoses(poses, time);
  }

  /** The most recent corrections, oldest first. */
  get recent(): readonly ViolationRecord[] {
    return this.recentLog;
  }

  has(id: number): boolean {
    return this.movers.has(id);
  }

  /** The pad a joining ship docks on: the first no ship holds, else the least held. */
  freePad(): number {
    let best = 0;
    for (let i = 1; i < this.pads.length; i++) if (this.pads[i]!.size < this.pads[best]!.size) best = i;
    return best;
  }

  /**
   * Starts holding a player entity to its moves from a pose the server gave it (its join). A player joining on foot boards
   * only the ship at `parked` (where its ship rests: landed on a world, docked in a Waystation); without one it has no
   * ship beside it to board.
   */
  add(id: number, pose: Pose, mode: MoveMode, profile: MoverProfile, now: number, parked?: Pose): void {
    this.world.at(now);
    const key = this.keyOf(pose.frame);
    if (key === undefined) throw new RangeError(`frame ${pose.frame} is not in system ${this.world.system.seed}`);
    const stub = { cls: 'engine', flight: 'space', allowed: 0, caps: null, peak: 0, highSince: null, h: 0, key } as unknown as Sample;
    const m = new Mover(id, profile, stub);
    const first = this.sample(m, stub, 0, { pose, mode, buttons: 0 }, now);
    m.last = first;
    m.seg = [first];
    m.parked = first.cls === 'rest' ? first : null;
    if (first.cls === 'foot' && parked && this.keyOf(parked.frame) !== undefined) {
      m.parked = this.sample(m, stub, 0, { pose: parked, mode: parked.frame?.endsWith(':station') ? 'docked' : 'landed', buttons: 0 }, now);
    }
    m.count = first.n;
    this.movers.set(id, m);
    const pad = first.pad ?? (first.cls === 'foot' ? (m.parked?.pad ?? null) : null);
    if (pad !== null) this.holdPad(id, pad);
  }

  remove(id: number): void {
    this.movers.delete(id);
    this.releasePad(id);
  }

  /**
   * Whether a pose and mode the server did not watch arrive (a saved one, loaded at login) is somewhere that mode may be,
   * at server world time `now`: the rules every input's pose meets (its frame, the ground, the hangar shell, a gas
   * giant's depths, and the mode's own: the pulse drive out of the air and clear of what is ahead, landed on dry ground,
   * docked on a pad no other ship holds, on foot on ground or in the hangar), with nothing before it to compare it with.
   * Null when it may be there.
   */
  poseProblem(pose: Pose, mode: MoveMode, profile: MoverProfile, now: number): Violation | null {
    this.world.at(now);
    const key = this.keyOf(pose.frame);
    if (key === undefined)
      return { rule: 'frame', measured: 0, allowed: 0, unit: 'm', detail: `frame ${pose.frame} is not in system ${this.world.system.seed}` };
    const stub = { cls: 'engine', flight: 'space', allowed: 0, caps: null, peak: 0, highSince: null, h: 0, key, pos: pose.pos } as unknown as Sample;
    const m = new Mover(-1, profile, stub);
    const s = this.sample(m, stub, 0, { pose, mode, buttons: 0 }, now);
    // as if it had been there a moment: on foot already, cruising if on the pulse drive, coming to rest if landed or docked
    const before: Sample = { ...s, cls: s.cls === 'rest' ? 'engine' : s.cls, flight: s.cls === 'rest' ? 'space' : s.flight, pad: null };
    return this.legality(m, before, s);
  }

  /** Checks an input from entity `id`'s client, arriving at server world time `now`. */
  check(id: number, msg: InputMessage, now: number): MovementVerdict {
    const m = this.movers.get(id);
    if (!m) throw new Error(`entity ${id} is not a mover in zone ${this.zone}`);
    this.world.at(now);
    const L = m.last;
    const s = this.sample(m, L, msg.seq, msg, now);
    const judged = this.judge(m, L, s);
    if (judged) return this.refuse(m, msg.seq, judged.violation, judged.rewind, now);
    m.graceUntil = -Infinity;
    this.accept(m, L, s);
    return { ok: true, mode: s.mode, vel: s.vel };
  }

  // ---------- samples ----------

  private keyOf(frame: string | null): FrameKey | undefined {
    return frameKeyOf(this.world.system, frame);
  }

  /** A pose as a sample, after `L`: its class and mode, a ship's caps and allowance, a walker's height and ground. */
  private sample(m: Mover, L: Sample, seq: number, msg: Pick<InputMessage, 'pose' | 'mode' | 'buttons'>, t: number): Sample {
    const key = this.keyOf(msg.pose.frame);
    if (key === undefined) throw new RangeError(`frame ${msg.pose.frame} is not in system ${this.world.system.seed}`);
    const pos: Vec3 = [...msg.pose.pos];
    const q = msg.pose.quat;
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    const quat: Quat = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
    const mode = msg.mode;
    const cls: MoverClass = mode === 'ship' ? 'engine' : mode === 'pulse' ? 'pulse' : mode === 'foot' ? 'foot' : 'rest';
    const s: Sample = {
      seq,
      t,
      n: m.count + 1,
      key,
      pos,
      quat,
      vel: [...msg.pose.vel],
      mode,
      flight: 'foot',
      cls,
      caps: null,
      allowed: 0,
      clearMin: Infinity,
      clearAhead: Infinity,
      h: 0,
      ground: 0,
      peak: 0,
      highSince: null,
      pad: null,
    };
    if (cls === 'foot') {
      this.walkerFields(m, L, s);
      const fall = Math.sqrt(2 * this.gravity(key) * Math.max(0, s.peak - s.h));
      clampLength(s.vel, m.walkerCaps.across + m.walkerCaps.climb + fall);
      return s;
    }
    const world = this.world.toWorld(key, pos);
    const clear = this.world.clearance(key, world, rotateNose(quat));
    s.clearMin = clear.min;
    s.clearAhead = clear.ahead;
    s.flight =
      mode === 'ship'
        ? msg.buttons & Buttons.boost
          ? 'boost'
          : this.world.airAt(key, pos, world) >= AIR.flightModelFrom
            ? 'atmo'
            : 'space'
        : (mode as FlightMode);
    s.caps = flightCaps(m.ship, s.flight, s.clearMin);
    const change = this.changeFor(m, L, s);
    s.allowed = change ? allowanceAfterChange(change.prev, s.caps, s.t - change.at) : s.caps.allowed;
    if (mode === 'docked') s.pad = nearestPad(pos);
    clampLength(s.vel, s.allowed);
    return s;
  }

  /** The change of ship mode in force at `s`: a new one at `s` when its mode differs from `L`'s, else the mover's last. */
  private changeFor(m: Mover, L: Sample, s: Sample): Change | null {
    if (!isShip(L.cls) || !L.caps) return null;
    if (s.flight !== L.flight) return { prev: { ...L.caps, allowed: L.allowed }, at: s.t };
    return m.change;
  }

  private gravity(key: FrameKey): number {
    if (key === 'station') return WALKER.stationGravity;
    if (key === null) return WALKER.defaultGravity;
    return this.world.system.bodies[key]!.gravity || WALKER.defaultGravity;
  }

  private walkerFields(m: Mover, L: Sample, s: Sample): void {
    const { key, pos } = s;
    let supported: boolean;
    if (key === 'station') {
      s.h = pos[1];
      s.ground = STATION_LAYOUT.hangar.y0;
      supported = s.h - s.ground <= MOVEMENT.terrain.standM;
    } else if (typeof key === 'number' && this.world.ground(key)) {
      const g = this.world.ground(key)!;
      s.h = len(pos);
      const up: Vec3 = [pos[0] / s.h, pos[1] / s.h, pos[2] / s.h];
      s.ground = g.radius + heightAt(g, up);
      // standing, or in water (at or under the sea's surface)
      supported = s.h - s.ground <= MOVEMENT.terrain.standM || (g.ocean && s.h <= g.radius + 0.5);
    } else {
      // (no ground here: the pose is refused as foot_frame)
      s.h = 0;
      s.ground = 0;
      supported = true;
    }
    const before = L.cls === 'foot' && L.key === s.key;
    s.peak = supported ? s.h : Math.max(before ? L.peak : s.h, s.h);
    s.highSince = s.h - s.ground > MOVEMENT.foot.supportM ? (before && L.highSince !== null ? L.highSince : s.t) : null;
  }

  // ---------- judging ----------

  /** Why `s` cannot follow `L`, and the pose to correct to; null when it may. */
  private judge(m: Mover, L: Sample, s: Sample): { violation: Violation; rewind: Sample } | null {
    const fail = (rule: MovementRule, measured: number, allowed: number, unit: Violation['unit'], detail?: string) => ({
      violation: { rule, measured, allowed, unit, ...(detail ? { detail } : {}) },
      rewind: L,
    });
    const v = this.legality(m, L, s);
    if (v) return { violation: v, rewind: L };

    const sameFrame = s.key === L.key;
    const intoFoot = s.cls === 'foot' && L.cls !== 'foot';
    const outOfFoot = s.cls !== 'foot' && L.cls === 'foot';
    if (intoFoot || outOfFoot) return null; // set down beside the ship or boarded it: legality judged the jump

    // anti-teleport: one input's move from the last valid pose
    const dt = s.t - L.t;
    const T = MOVEMENT.teleport;
    let from = L.pos;
    let slack = s.cls === 'rest' && L.cls === 'rest' ? T.restSlackM : s.cls === 'foot' ? T.walkerSlackM : T.slackM;
    if (!sameFrame) {
      from = this.world.toLocal(s.key, this.world.toWorld(L.key, L.pos));
      slack += (this.world.pointSpeed(L.key, L.pos) + this.world.pointSpeed(s.key, s.pos)) * MOVEMENT.frame.skewS;
    }
    const d = dist(from, s.pos);
    if (s.cls === 'foot') {
      const over = this.walkerExcess(m, L, s, from, dt + T.lagS, slack);
      if (over) return fail('teleport', over.measured, over.allowed, 'm', over.detail);
    } else {
      const allowed = Math.max(sameFrame && s.cls !== L.cls ? this.boundaryAllowance(m, L, s) : L.allowed, s.allowed);
      const limit = allowed * (dt + T.lagS) + slack;
      if (d > limit) return fail('teleport', d, limit, 'm');
    }

    // speed windows within the segment `s` continues or starts; none across a change of frame
    let win: readonly Sample[];
    let startAllowed: number | null;
    if (sameFrame && s.cls === L.cls) {
      win = m.seg;
      startAllowed = m.boundary;
    } else if (sameFrame) {
      win = [L];
      startAllowed = this.boundaryAllowance(m, L, s);
    } else return null;
    const W = MOVEMENT.windowS;
    let ai = 0;
    let full = false;
    for (let i = win.length - 1; i >= 0; i--) {
      if (win[i]!.t <= s.t - W) {
        ai = i;
        full = true;
        break;
      }
    }
    const A = win[ai]!;
    const E = s.t - A.t;
    const S = MOVEMENT.short;
    const span = full ? E : Math.max(E, Math.min((s.n - A.n) * S.intervalS, E + S.lagS));
    const extra = full ? 0 : S.slackM;
    // a too-fast window rewinds to its start (never to the boundary: the first pose of this segment's own mode instead)
    const rewindTo = ai === 0 && startAllowed !== null ? (win.length > 1 ? win[1]! : L) : A;
    if (s.cls === 'foot') {
      const over = this.walkerExcess(m, A, s, A.pos, span, extra);
      return over ? { violation: { rule: 'speed', measured: over.measured, allowed: over.allowed, unit: 'm', detail: over.detail }, rewind: rewindTo } : null;
    }
    const allowed = Math.max(ai === 0 && startAllowed !== null ? startAllowed : A.allowed, s.allowed);
    const dw = dist(A.pos, s.pos);
    if (dw > allowed * span + extra) {
      return { violation: { rule: 'speed', measured: (dw - extra) / span, allowed, unit: 'm/s', detail: `${s.flight} over ${round(E)} s` }, rewind: rewindTo };
    }
    return null;
  }

  /** The allowance of `L`, the last pose before a change of class to `s`'s, in the new segment's terms: the new mode's caps
   * at L's clearance, after the change (allowanceAfterChange at the change itself). Coming to rest, L keeps its own: the
   * contract's rest allowance is for a ship already down, and a window from the last flying pose holds the final approach
   * (a network stall at touchdown makes that window a whole second of it). */
  private boundaryAllowance(m: Mover, L: Sample, s: Sample): number {
    if (!isShip(L.cls) || !L.caps || s.flight === 'foot') return s.allowed;
    const caps = flightCaps(m.ship, s.flight, L.clearMin);
    const after = allowanceAfterChange({ ...L.caps, allowed: L.allowed }, caps, 0);
    return s.cls === 'rest' ? Math.max(after, L.allowed) : after;
  }

  /**
   * How far a walker's move from `A` (at `from`, in `s`'s frame) over `span` seconds goes past what it can do: across the
   * ground, up (with the ground's rise under it) and down (a fall from its peak since it last stood), each with `extra`
   * metres. Null within all three.
   */
  private walkerExcess(
    m: Mover,
    A: Sample,
    s: Sample,
    from: Readonly<Vec3>,
    span: number,
    extra: number,
  ): { measured: number; allowed: number; detail: string } | null {
    const step = WALKER_TOLERANCE.stepM + extra;
    const dh = s.h - A.h;
    const d = dist(from, s.pos);
    const across = Math.sqrt(Math.max(0, d * d - dh * dh));
    const caps = m.walkerCaps;
    const acrossMax = caps.across * span + step;
    if (across > acrossMax) return { measured: across, allowed: acrossMax, detail: 'across' };
    if (dh > 0) {
      const up = caps.climb * span + Math.max(0, s.ground - A.ground) + step;
      if (dh > up) return { measured: dh, allowed: up, detail: 'up' };
    } else {
      const down = walkerFall(this.gravity(s.key), A.peak - A.h, span) + step;
      if (-dh > down) return { measured: -dh, allowed: down, detail: 'down' };
    }
    return null;
  }

  /** Whether a pose is somewhere its mode may be, and its mode may follow L's. */
  private legality(m: Mover, L: Sample, s: Sample): Violation | null {
    const fail = (rule: MovementRule, measured: number, allowed: number, unit: Violation['unit'], detail?: string): Violation => ({
      rule,
      measured,
      allowed,
      unit,
      ...(detail ? { detail } : {}),
    });
    const { key, pos } = s;
    const world = this.world.toWorld(key, pos);
    const frame = this.world.frameProblem(key, pos, world, s.cls === 'foot' ? m.walkerCaps.across : s.allowed);
    if (frame) return fail('frame', frame.measured, frame.allowed, 'm', `${frameName(key)} where the rule picks ${frameName(frame.expected)}`);

    if (s.cls === 'foot') return this.footLegality(m, L, s, fail);

    // a ship: never inside the ground, a gas giant's depths or the hangar's shell
    const body = typeof key === 'number' ? this.world.system.bodies[key]! : null;
    const ground = this.world.ground(key);
    const r = len(pos);
    let groundR: number | null = null;
    let landH = 0;
    if (ground && r < ground.radius + ground.ceiling + PULSE_DRIVE.engageAltitudeM) {
      landH = heightAt(ground, [pos[0] / r, pos[1] / r, pos[2] / r]);
      groundR = ground.radius + (ground.ocean ? Math.max(landH, 0) : landH);
      const floor = groundR + SHIP_GEAR_HEIGHT * 0.6 - MOVEMENT.terrain.shipBelowM;
      if (r < floor) return fail('terrain', r - groundR, floor - groundR, 'm', 'below the ground');
    }
    if (body && body.type === 'gas') {
      const floor = body.radius * MOVEMENT.gas.floor - MOVEMENT.gas.belowM;
      if (r < floor) return fail('gas_depth', r - body.radius, floor - body.radius, 'm');
    }
    if (key === 'station' && insideHangarShell(pos)) return fail('station_hull', 0, 0, 'm', `inside the hangar shell at ${pos.map(round).join(', ')}`);

    // out of the walker into the ship: only the ship it is beside, where it left it
    if (L.cls === 'foot') {
      const p = m.parked;
      if (!p || p.key !== key) return fail('board_range', Infinity, 0, 'm', 'no ship of its own here');
      const reach = WALKER.boardRangeM + MOVEMENT.foot.boardSlackM + m.walkerCaps.across * (s.t - L.t);
      const walker = dist(L.pos, p.pos);
      if (walker > reach) return fail('board_range', walker, reach, 'm', 'walker to ship');
      const moved = dist(s.pos, p.pos);
      const may = MOVEMENT.foot.parkedM + (s.cls === 'rest' ? 0 : s.allowed * (s.t - L.t + MOVEMENT.teleport.lagS));
      if (moved > may) return fail('board_range', moved, may, 'm', 'ship from where it was left');
    }

    switch (s.cls) {
      case 'pulse': {
        const air = this.world.airAt(key, pos, world);
        if (air > AIR.pulseCeiling) return fail('pulse_air', air, AIR.pulseCeiling, 'density');
        const engaging = L.cls !== 'pulse';
        const path = L.key === key ? dist(L.pos, pos) : 0;
        const need = (engaging ? PULSE_DRIVE.engageClearM : PULSE_DRIVE.dropOutM) - MOVEMENT.pulse.clearanceM;
        if (s.clearAhead + path < need) return fail('pulse_clearance', s.clearAhead, need, 'm', engaging ? 'engaging' : 'cruising');
        if (engaging && groundR !== null) {
          const alt = r - groundR - SHIP_GEAR_HEIGHT;
          const min = PULSE_DRIVE.engageAltitudeM - MOVEMENT.pulse.altitudeM;
          if (alt + path < min) return fail('pulse_altitude', alt, min, 'm');
        }
        return null;
      }
      case 'rest':
        return s.mode === 'docked' ? this.dockedLegality(m, L, s, fail) : this.landedLegality(s, body, groundR, landH, ground?.ocean ?? false, fail);
      default:
        return null;
    }
  }

  private landedLegality(
    s: Sample,
    body: SystemDescription['bodies'][number] | null,
    groundR: number | null,
    landH: number,
    ocean: boolean,
    fail: FailFn,
  ): Violation | null {
    if (!body || body.type === 'gas' || groundR === null) return fail('landed', Infinity, 0, 'm', `not on a world's ground (${frameName(s.key)})`);
    const L = MOVEMENT.landed;
    const gear = len(s.pos) - groundR - SHIP_GEAR_HEIGHT;
    if (gear < -L.belowM || gear > L.aboveM) return fail('landed', gear, gear < 0 ? -L.belowM : L.aboveM, 'm', 'gear off the ground');
    if (ocean && landH < 0.5 - L.waterM) return fail('landed', landH, 0.5 - L.waterM, 'm', 'on water');
    return null;
  }

  private dockedLegality(m: Mover, L: Sample, s: Sample, fail: FailFn): Violation | null {
    if (s.key !== 'station' || s.pad === null) return fail('docked', Infinity, 0, 'm', `not on a pad (${frameName(s.key)})`);
    const pad = STATION_LAYOUT.pads[s.pad]!;
    const D = MOVEMENT.docked;
    const across = Math.hypot(s.pos[0] - pad.x, s.pos[2] - pad.z);
    if (across > STATION_LAYOUT.padRadius) return fail('docked', across, STATION_LAYOUT.padRadius, 'm', 'off the pad');
    const gear = s.pos[1] - STATION_LAYOUT.padTop - SHIP_GEAR_HEIGHT;
    if (gear < -D.belowM || gear > D.aboveM) return fail('docked', gear, gear < 0 ? -D.belowM : D.aboveM, 'm', 'gear off the pad');
    const holds = (L.cls === 'rest' && L.pad === s.pad) || (L.cls === 'foot' && m.parked?.pad === s.pad);
    if (!holds) {
      const others = [...this.pads[s.pad]!].filter((id) => id !== m.id).length;
      if (others > 0) return fail('pad_taken', others, 0, 'm', `pad ${s.pad}`);
    }
    return null;
  }

  private footLegality(m: Mover, L: Sample, s: Sample, fail: FailFn): Violation | null {
    const { key, pos } = s;
    const F = MOVEMENT.foot;
    if (key === 'station') {
      if (insideHangarShell(pos)) return fail('station_hull', 0, 0, 'm', `inside the hangar shell at ${pos.map(round).join(', ')}`);
      if (!insideHangar(pos, F.hangarM) && !m.walker.flags.includes('walk_station_exterior')) {
        return fail('walker_hangar', 0, F.hangarM, 'm', `outside the hangar at ${pos.map(round).join(', ')}`);
      }
    } else if (typeof key !== 'number' || !this.world.ground(key)) {
      return fail('foot_frame', 0, 0, 'm', `no ground in ${frameName(key)}`);
    }
    if (s.h < s.ground - MOVEMENT.terrain.walkerBelowM) return fail('terrain', s.h - s.ground, -MOVEMENT.terrain.walkerBelowM, 'm', 'below the ground');
    if (s.highSince !== null && s.t - s.highSince > F.airMaxS) {
      return fail('walker_hover', s.t - s.highSince, F.airMaxS, 's', `${round(s.h - s.ground)} m over the ground`);
    }
    // out of the ship: set down beside it, where it rests
    if (L.cls !== 'foot') {
      const parked = this.parkedAt(m, L);
      if (!parked) return fail('exit_range', Infinity, 0, 'm', `out of a ship that is not landed or docked (${L.mode})`);
      if (parked.key !== key) return fail('exit_range', Infinity, 0, 'm', 'in another frame than its ship');
      const d = dist(pos, parked.pos);
      const may = F.exitM + m.walkerCaps.across * (s.t - L.t);
      if (d > may) return fail('exit_range', d, may, 'm');
    }
    return null;
  }

  /**
   * Where a ship last at `L` rests once its pilot is out: L itself when landed or docked; L flying when it is where a ship
   * lands or docks (the client can touch down and get out between two inputs); else null.
   */
  private parkedAt(m: Mover, L: Sample): Sample | null {
    if (L.cls === 'rest') return L;
    if (L.cls !== 'engine') return null;
    const noop: FailFn = (rule, measured, allowed, unit) => ({ rule, measured, allowed, unit });
    if (L.key === 'station') {
      const rest: Sample = { ...L, cls: 'rest', mode: 'docked', flight: 'docked', pad: nearestPad(L.pos) };
      return this.dockedLegality(m, L, rest, noop) ? null : rest;
    }
    const ground = this.world.ground(L.key);
    if (!ground || typeof L.key !== 'number') return null;
    const r = len(L.pos);
    const landH = heightAt(ground, [L.pos[0] / r, L.pos[1] / r, L.pos[2] / r]);
    const groundR = ground.radius + (ground.ocean ? Math.max(landH, 0) : landH);
    const rest: Sample = { ...L, cls: 'rest', mode: 'landed', flight: 'landed' };
    return this.landedLegality(rest, this.world.system.bodies[L.key]!, groundR, landH, ground.ocean, noop) ? null : rest;
  }

  // ---------- outcomes ----------

  private accept(m: Mover, L: Sample, s: Sample): void {
    if (s.key === L.key && s.cls === L.cls) {
      m.seg.push(s);
      // keep the latest pose at least a window old (the next window's start) and everything since, within reason
      const old = s.t - MOVEMENT.windowS;
      let drop = 0;
      while (drop < m.seg.length - 2 && m.seg[drop + 1]!.t <= old) drop++;
      drop = Math.max(drop, m.seg.length - MOVEMENT.historyMax);
      if (drop > 0) {
        m.seg.splice(0, drop);
        m.boundary = null;
      }
    } else if (s.key === L.key && isShip(s.cls) && isShip(L.cls)) {
      m.boundary = this.boundaryAllowance(m, L, s);
      m.seg = [L, s];
    } else {
      m.boundary = null;
      m.seg = [s];
    }
    m.change = isShip(s.cls) ? this.changeFor(m, L, s) : null;
    if (s.cls === 'rest') m.parked = s;
    else if (s.cls === 'foot' && L.cls !== 'foot') m.parked = this.parkedAt(m, L);
    else if (s.cls !== 'foot') m.parked = null;
    const pad = s.cls === 'foot' ? (m.parked?.pad ?? null) : s.pad;
    if (pad !== null) this.holdPad(m.id, pad);
    else this.releasePad(m.id);
    m.count = s.n;
    m.last = s;
  }

  private refuse(m: Mover, seq: number, violation: Violation, rewind: Sample, now: number): MovementRefusal {
    if (now < m.graceUntil) {
      this.quiet++;
      this.log?.debug({ zone: this.zone, entity: m.id, seq, rule: violation.rule }, 'movement: input from before the correction refused');
      return { ok: false, correction: null, violation: null, kick: false };
    }
    // the pose corrected to is the authoritative state as of now
    const to: Sample = { ...rewind, t: now, n: m.count };
    if (rewind !== m.last) {
      const i = m.seg.indexOf(rewind);
      if (i >= 0) m.seg.length = i;
      if (m.seg.length === 0) m.boundary = null;
      m.change = isShip(to.cls) ? m.change : null;
    } else if (m.seg.at(-1) === rewind) m.seg.pop();
    m.seg.push(to);
    m.last = to;
    if (to.cls === 'rest') m.parked = to;
    m.graceUntil = now + MOVEMENT.correction.graceS;
    const K = MOVEMENT.kick;
    while (m.corrections.length && m.corrections[0]! < now - K.withinS) m.corrections.shift();
    m.corrections.push(now);
    const kick = m.corrections.length >= K.count;
    this.corrections++;
    if (kick) this.kicks++;
    const record: ViolationRecord = {
      ...violation,
      measured: round(violation.measured),
      allowed: round(violation.allowed),
      entity: m.id,
      characterId: m.profile.characterId,
      accountId: m.profile.accountId,
      seq,
      at: now,
      mode: to.mode,
      kicked: kick,
    };
    this.recentLog.push(record);
    if (this.recentLog.length > RECENT_MAX) this.recentLog.shift();
    const who = { zone: this.zone, entity: m.id, account: m.profile.accountId, character: m.profile.characterId, seq };
    this.log?.warn(
      {
        ...who,
        rule: violation.rule,
        measured: record.measured,
        allowed: record.allowed,
        unit: violation.unit,
        detail: violation.detail,
        corrections: m.corrections.length,
      },
      'movement corrected',
    );
    if (kick) this.log?.warn({ ...who, corrections: m.corrections.length, withinS: K.withinS }, 'movement: session kicked after repeated corrections');
    return { ok: false, correction: { seq, pose: poseOf(this.world.system.seed, to), mode: to.mode }, violation, kick };
  }

  private holdPad(id: number, pad: number): void {
    this.pads.forEach((holders, i) => {
      if (i !== pad) holders.delete(id);
    });
    this.pads[pad]!.add(id);
  }

  private releasePad(id: number): void {
    for (const holders of this.pads) holders.delete(id);
  }
}

type FailFn = (rule: MovementRule, measured: number, allowed: number, unit: Violation['unit'], detail?: string) => Violation;

function poseOf(seed: number, s: Sample): Pose {
  return { frame: frameIdOf(seed, s.key), pos: [...s.pos], quat: [...s.quat], vel: [...s.vel] };
}

/** The pad whose centre is nearest a point on the hangar floor. */
function nearestPad(pos: Readonly<Vec3>): number {
  let best = 0;
  let bestD = Infinity;
  STATION_LAYOUT.pads.forEach((p, i) => {
    const d = Math.hypot(pos[0] - p.x, pos[2] - p.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The ship's nose, (0, 0, −1) in its own axes, turned by its orientation `q`. */
function rotateNose(q: Readonly<Quat>): Vec3 {
  const [x, y, z, w] = q;
  return [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
}

function clampLength(v: Vec3, max: number): void {
  const l = len(v);
  if (l > max && l > 0) {
    const k = max / l;
    v[0] *= k;
    v[1] *= k;
    v[2] *= k;
  }
}

function frameName(key: FrameKey): string {
  return key === null ? 'the inertial frame' : key === 'station' ? 'the Waystation' : `body ${key}`;
}

function round(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : x;
}
