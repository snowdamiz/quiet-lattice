// Movement authority (P1.E03.T04, ARCHITECTURE §7): every player's input carries its predicted pose and mode; before a zone
// applies it, this checks it and either accepts it (with the mode the server now believes, which picks the entity's interest
// class) or refuses it with a `correction` to the last pose it can vouch for. One per zone.
//
// For each input, in order:
// 1. Time. The pose is judged at the time its client says it sampled it (MOVEMENT.time): an honest client's poses and
//    times are its own trajectory, whatever the network does to them on the way. The time credited between two inputs is
//    the client's, held to the real time that passed (the arrival gap, a small bank, a stall's own length), so a clock
//    run fast, frozen or lagging gains nothing; one stepped forward past that re-syncs with no credit for the step and a
//    fresh window; an input with no time is judged on its arrival.
// 2. The pose, with the bodies where they were then. Its frame must be one the shared frame rule allows there; a ship may
//    not be below the ground (the shared terrain sampler, levelled under cities and sites as the client levels it), in a
//    gas giant's depths or inside the Waystation's hangar shell; a walker may not be below the ground, outside the hangar,
//    or higher than anything it could stand on for longer than a fall from there takes. Its mode must be legal there: the
//    pulse drive only with Charge in the character's meters (P1.E07.T02: to engage, and to cruise on past a moment's grace
//    after it runs out), outside the air, clear of what is ahead and high enough over a world to engage; landed only on dry
//    ground on a world; docked only on a Waystation pad no other ship holds; on foot only on a world's ground or in a
//    hangar, and only after getting out of a landed or docked ship; boarding only the ship it is beside.
// 3. The move from the last valid pose. A jump beyond the allowance in the time since (at most a second of it: no input
//    carries more, whatever silence came before) is refused outright (anti-teleport); so is a step through the ground,
//    or a flying ship's centre through the hangar's shell, further than the client's own once-a-frame collisions could
//    miss.
// 4. Speed windows, the flight contract (FLIGHT_TOLERANCE in @astra/shared/ships): displacement over at least `windowS` of
//    the client's time, judged against the larger of the allowances at the window's two end poses; a window not yet that
//    long is judged from its start. A window carries on across a change of frame (its poses re-expressed in the new frame,
//    each at its own time) and across changes among the engine modes (space, boost, atmo: each end takes its own mode's
//    allowance, with the contract's decay after a change; the boost button is free, so nothing is gained by switching).
//    Between the engines, the pulse drive and rest it splits, the new stretch starting from the old one's last pose in the
//    new mode's terms, so a one-tick mode never lends its allowance to another's window. Getting out and boarding do not
//    reset it either: the walker's first pose is judged as a walker's move from where the client sets it down
//    (Game.exitShip), and the boarded ship's first pose as a ship's move from where it was left. A walker's window is
//    judged across the ground, upward (plus the rise of the ground along its path) and downward (no faster than a fall:
//    `walkerFall`).
//
// The ground is planned in the server's worker thread (fauna's GroundPlanner) once a player comes near a world. A pose
// judged before its world's ground is ready is accepted provisionally: it and every input after it are judged again as
// soon as the ground is, and refused (back to the last pose judged without that need) if it is not ready within
// MOVEMENT.ground.holdS.
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
import { groundPlanner, type GroundSource } from '../../fauna/terrain.ts';
import { MOVEMENT, type MovementRule, type Violation } from './rules.ts';
import {
  dist,
  groundRun,
  hangarShellRun,
  heightAt,
  insideHangar,
  insideHangarShell,
  len,
  lerp3,
  MovementWorld,
  rotate,
  shipGroundAt,
  surfaceAt,
  type Ground,
  type Quat,
  type Vec3,
} from './world.ts';

type InputMessage = Extract<ClientMessage, { t: 'input' }>;
/** The protocol's movement mode (ship, pulse, landed, docked, foot). */
export type MoveMode = InputMessage['mode'];

/** A pino-shaped logger (the zone's). */
export interface MovementLog {
  warn(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

/** The characters' meters (Heat and Charge, P1.E07.T02's MeterService): whether one may be in a mode at server world time
 * `now`. The pulse drive needs Charge; one that ran out of it within `graceS` may cruise on. */
export interface MoverMeters {
  allowsMode(characterId: string, mode: MoveMode, now: number, graceS?: number): boolean;
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

/** How a pose moves: on the engines, on the pulse drive, at rest (landed or docked), or on foot. */
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
  /** the client's time for it, as the server credits it (MOVEMENT.time), s: the time between two samples is what speed is
   * judged on */
  t: number;
  /** the world time its bodies are placed at: its credited time, or its arrival (MOVEMENT.time) */
  p: number;
  /** server world time it arrived at */
  r: number;
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
  /** a walker's height along its up (from the world's centre, or over the hangar floor), the ground's under it (NaN while
   * the ground is being planned), the highest it has been since it last stood on the ground, and since when (server time)
   * it has been higher than anything to stand on */
  h: number;
  ground: number;
  peak: number;
  highSince: number | null;
  /** docked: its pad */
  pad: number | null;
  /** its client's clock stepped forward here: no movement credit for the time since the last pose, and a fresh window */
  resync?: boolean;
}

interface Change {
  /** the caps before, with the allowance they had at the change */
  prev: FlightCaps;
  at: number;
}

/** The times an input is judged at (MOVEMENT.time). */
export interface Credit {
  /** its client's time, as credited: the time between two inputs, which speed is judged on, is the difference of theirs */
  t: number;
  /** the world time the bodies are placed at for it */
  p: number;
  /** it had no usable time, and is judged on its arrival */
  timeless: boolean;
  /** its clock stepped forward: the credited time re-synced to it with no movement credit, and judging starts afresh */
  resync: boolean;
  /** its stamps have lagged its arrival by more than MOVEMENT.time.behindS for too long without draining: judged and
   * placed on its arrival, as an input without a time */
  stale: boolean;
  /** the time since the input before it (or the join) arrived */
  gap: number;
}

/**
 * The client's clock, as the server credits it (MOVEMENT.time). Each input is credited with the time its client says
 * passed since the one before, held to the real time that passed: its arrival gap, plus a little of a small bank, plus a
 * little of the real time its running clock left unclaimed in the last `drainS` (a latency rise, a stall); and never
 * ahead of its arrival. A clock stepped forward re-syncs it, with no credit for the step. A stamp that lags its arrival
 * for good is placed on its arrival.
 */
export class ClientClock {
  /** the time credited to the last input, its stamp (null when it had none), and its arrival */
  private t = NaN;
  private raw: number | null = null;
  private a: number;
  /** real time no input has claimed, up to `bankS` */
  private bank: number = MOVEMENT.time.bankS;
  /** real time a running clock left unclaimed, oldest first: [seconds, server time it accrued]; each is claimable for
   * `drainS` */
  private readonly debt: [number, number][] = [];
  /** when it last re-synced (server time) */
  private resyncedAt = -Infinity;
  /** while its stamps lag its arrival by more than `behindS`: since when that lag has not drained, and the most it has
   * been since */
  private lagged: { since: number; most: number } | null = null;

  /** A clock for a mover that joined at server world time `joined`. */
  constructor(joined: number) {
    this.a = joined;
  }

  /** Real time it may still claim back (MOVEMENT.time.drainS). */
  get owed(): number {
    let n = 0;
    for (const d of this.debt) n += d[0];
    return n;
  }

  /** The times credited to an input stamped `raw` that arrived at server world time `now`. */
  credit(raw: number, now: number): Credit {
    const T = MOVEMENT.time;
    const gap = Math.max(0, now - this.a);
    this.a = now;
    const usable = Number.isFinite(raw) && raw > 0;
    let resync = false;
    while (this.debt.length && this.debt[0]![1] < now - T.drainS) this.debt.shift();
    if (Number.isNaN(this.t)) {
      // the first input: its own time (no later than `aheadS` past its arrival), or its arrival
      this.t = usable ? Math.min(raw, now + T.aheadS) : now;
    } else if (!usable) {
      this.t += gap;
    } else {
      // what its client says passed (or, to catch up a stamp held back before, since the time credited then)...
      const said = this.raw === null ? raw - this.t : Math.max(raw - this.raw, raw - this.t);
      // ...held to the real time that passed (its arrival gap, a little of the bank, a little of what is owed), and never
      // ahead of its arrival
      const owed = this.owed;
      let c = Math.min(Math.max(0, said), gap + Math.min(T.perInputS, this.bank) + Math.min(T.drainInputS, owed));
      c = Math.max(0, Math.min(c, now + T.aheadS - this.t));
      if (said - c > T.resyncS && raw >= now - T.behindS && now - this.resyncedAt >= T.resyncEveryS) {
        // a clock stepped forward past what it can be credited (or one that lagged, caught up): the credited time follows
        // it, with no credit for the step
        resync = true;
        this.resyncedAt = now;
        this.t = Math.max(this.t, Math.min(raw, now + T.aheadS));
        this.debt.length = 0;
        this.raw = raw;
        this.lagged = null;
        return { t: this.t, p: this.t, timeless: false, resync, stale: false, gap };
      }
      const over = c - gap;
      if (over > 0) {
        // what is owed first (it expires), then the bank
        let fromDebt = Math.min(over, T.drainInputS, owed);
        this.bank -= over - fromDebt;
        while (fromDebt > 0 && this.debt.length) {
          const d = this.debt[0]!;
          const take = Math.min(d[0], fromDebt);
          d[0] -= take;
          fromDebt -= take;
          if (d[0] <= 1e-12) this.debt.shift();
        }
      } else if (over < 0) {
        // real time it did not claim: banked, up to `bankS`; and owed, to claim back within `drainS`, if its clock ran (a
        // clock standing still while time passes is owed nothing)
        if (this.raw !== null && raw > this.raw) this.debt.push([-over, now]);
        this.bank = Math.min(T.bankS, this.bank - over);
      }
      this.t += c;
    }
    this.raw = usable ? raw : null;
    // a lag over `behindS` is a backlog only while it drains: one that has not drained by `drainingS` in `staleS` is stale
    const lag = usable ? now - raw : 0;
    if (lag <= T.behindS) this.lagged = null;
    else if (!this.lagged || lag <= this.lagged.most - T.drainingS) this.lagged = { since: now, most: lag };
    else this.lagged.most = Math.max(this.lagged.most, lag);
    const stale = this.lagged !== null && now - this.lagged.since > T.staleS;
    // placed at the credited time, trailing the arrival by no more than `behindS` and what is still owed; stale, or with no
    // time, at the arrival
    const p = !usable || stale ? now : Math.max(this.t, Math.min(now, now - T.behindS - this.owed));
    return { t: this.t, p, timeless: !usable, resync, stale, gap };
  }
}

/** Where a mover stood before the inputs a hold let through (see MOVEMENT.ground). */
interface MoverState {
  last: Sample;
  seg: Sample[];
  boundary: number | null;
  change: Change | null;
  parked: Sample | null;
  settledAt: number;
  switches: { t: number; slackM: number }[];
}

/** An input as it was judged, kept to judge again. */
interface HeldInput {
  seq: number;
  msg: Pick<InputMessage, 'pose' | 'mode' | 'buttons'>;
  credit: Credit;
  /** server time it arrived */
  r: number;
}

/** Inputs let through while world `key`'s ground was being planned, judged again when it is ready. */
interface Hold {
  key: number;
  /** server time it began */
  since: number;
  base: MoverState;
  inputs: HeldInput[];
}

class Mover {
  readonly ship: ShipStats;
  readonly walker: WalkerStats;
  readonly walkerCaps: WalkerCaps;
  readonly clock: ClientClock;
  last!: Sample;
  /** the current window segment, oldest first; seg[0] is the previous segment's last pose when `boundary` is set */
  seg: Sample[] = [];
  /** seg[0]'s allowance in this segment's terms, when it is the boundary */
  boundary: number | null = null;
  /** the last change between ship modes, for the decay after it */
  change: Change | null = null;
  /** where it left its ship (landed or docked), while on foot */
  parked: Sample | null = null;
  /** the client time it last settled onto its gear with MOVEMENT.settleM */
  settledAt = -Infinity;
  /** changes of frame within the current stretch: the client time of the last pose before each, and the distance the two
   * frames drift apart over the step that crossed (windows spanning one take it as slack) */
  switches: { t: number; slackM: number }[] = [];
  /** quiet refusals until then (server time) */
  graceUntil = -Infinity;
  /** server times of its corrections */
  readonly corrections: number[] = [];
  /** no input from its client yet: the pose it joined at is on the server's clock until the first one */
  fresh = true;
  /** its client has sent an input with no time (logged once) */
  timeless = false;
  /** inputs let through while a world's ground is planned */
  hold: Hold | null = null;

  /** A mover joining at server world time `joined`. */
  constructor(
    readonly id: number,
    readonly profile: MoverProfile,
    joined: number,
  ) {
    this.ship = shipStats(profile.ship, { skills: profile.skills });
    this.walker = walkerStats({ skills: profile.skills, people: profile.people });
    this.walkerCaps = walkerCaps(this.walker);
    this.clock = new ClientClock(joined);
  }
}

const SHIP_CLASSES: ReadonlySet<MoverClass> = new Set(['engine', 'pulse', 'rest']);
const isShip = (c: MoverClass) => SHIP_CLASSES.has(c);
const RECENT_MAX = 64;
const LEFT: Vec3 = [-1, 0, 0];
const NOSE: Vec3 = [0, 0, -1];

/** The docked pose on pad `i` of a Waystation, nose to the hangar's mouth. */
export function padPose(stationFrame: string, i: number): Pose {
  const pad = STATION_LAYOUT.pads[i]!;
  return { frame: stationFrame, pos: [pad.x, STATION_LAYOUT.padTop + SHIP_GEAR_HEIGHT, pad.z], quat: [0, 1, 0, 0], vel: [0, 0, 0] };
}

/** Where a ship joining docked waits when every pad is held: in the hangar, short of its mouth, nose in. */
export function hangarWaitPose(stationFrame: string): Pose {
  return { frame: stationFrame, pos: [0, 14, STATION_LAYOUT.hangar.z1 - 20], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
}

export interface MovementAuthorityOptions {
  /** the zone's id, for the log */
  zone: string;
  system: SystemDescription;
  log?: MovementLog;
  /** Where worlds' grounds come from: the server's worker planner (fauna's GroundPlanner) by default; tests plan on their
   * own thread. */
  grounds?: GroundSource;
  /** The system's tier now, which its worlds' ground is drawn for (0 by default). */
  tier?: () => number;
  /** The characters' meters: the pulse drive needs Charge. Without them (tests, a restore's check) it is not asked. */
  meters?: MoverMeters;
}

/**
 * `MovementAuthority.poseProblem` for a system with no zone open: whether a saved pose and mode may be restored at server
 * world time `now` (character persistence calls this before putting a character back where it was saved). `parked` is
 * where a character saved on foot left its ship. Null when it may; a pose whose world's ground is not planned yet cannot be
 * vouched for (planGround first).
 */
export function poseProblem(
  system: SystemDescription,
  pose: Pose,
  mode: MoveMode,
  now: number,
  profile: MoverProfile,
  parked?: Pose,
  opts: Pick<MovementAuthorityOptions, 'grounds' | 'tier'> = {},
): Violation | null {
  return new MovementAuthority({ zone: 'restore', system, ...opts }).poseProblem(pose, mode, profile, now, parked);
}

/**
 * Plans the ground of the world `frame` is on (if it is one) in the server's planner and resolves when it is ready, or
 * false after `timeoutMs`: so a saved pose there can be checked (poseProblem) without planning on the main thread.
 */
export async function planGround(
  system: SystemDescription,
  frame: string | null,
  tier = 0,
  timeoutMs = 5000,
  grounds: GroundSource = groundPlanner,
): Promise<boolean> {
  const key = frameKeyOf(system, frame);
  if (typeof key !== 'number' || system.bodies[key]!.type === 'gas') return true;
  const world = new MovementWorld(system, grounds, () => tier);
  const end = performance.now() + timeoutMs;
  while (!world.ground(key)) {
    if (performance.now() >= end) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

export class MovementAuthority {
  readonly world: MovementWorld;
  /** corrections sent, inputs refused quietly, sessions kicked */
  corrections = 0;
  quiet = 0;
  kicks = 0;
  private readonly zone: string;
  private readonly log?: MovementLog;
  private readonly meters?: MoverMeters;
  private readonly movers = new Map<number, Mover>();
  /** the movers holding each pad: its ship docked there, or left there while its pilot walks */
  private readonly pads: Set<number>[] = STATION_LAYOUT.pads.map(() => new Set<number>());
  private readonly recentLog: ViolationRecord[] = [];
  /** the world whose ground the input being judged needed but did not have (it is held, MOVEMENT.ground) */
  private skipped: number | null = null;

  constructor(opts: MovementAuthorityOptions) {
    this.zone = opts.zone;
    this.log = opts.log;
    this.meters = opts.meters;
    this.world = new MovementWorld(opts.system, opts.grounds ?? groundPlanner, opts.tier);
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

  /** The first pad no ship holds, or null when every pad is held. */
  freePad(): number | null {
    const i = this.pads.findIndex((holders) => holders.size === 0);
    return i < 0 ? null : i;
  }

  /** Where a mover on foot left its ship, if it did. */
  parkedOf(id: number): Pose | null {
    const p = this.movers.get(id)?.parked;
    return p ? poseOf(this.world.system.seed, p) : null;
  }

  /**
   * Starts holding a player entity to its moves from a pose the server gave it (its join), at server world time `now`. A
   * player joining on foot boards only the ship at `parked` (where its ship rests: landed on a world, docked in a
   * Waystation); without one it has no ship beside it to board.
   */
  add(id: number, pose: Pose, mode: MoveMode, profile: MoverProfile, now: number, parked?: Pose): void {
    if (this.keyOf(pose.frame) === undefined) throw new RangeError(`frame ${pose.frame} is not in system ${this.world.system.seed}`);
    const m = new Mover(id, profile, now);
    const first = this.sample(m, null, 0, { pose, mode, buttons: 0 }, now, now, now);
    m.last = first;
    m.seg = [first];
    if (first.cls === 'rest') m.parked = first;
    else if (first.cls === 'foot' && parked && this.keyOf(parked.frame) === first.key) m.parked = this.restSample(m, parked, now);
    this.movers.set(id, m);
    const pad = first.cls === 'foot' ? (m.parked?.pad ?? null) : first.pad;
    if (pad !== null) this.holdPad(id, pad);
  }

  /**
   * Refuses mover `id`'s inputs that do not fit its pose quietly for MOVEMENT.correction.graceS from server time `now`, as
   * after a correction: for a pose the server has just given it (an admin teleport), with inputs from its old trajectory
   * still on the way. Its first input that fits is accepted, and ends the grace.
   */
  graceFrom(id: number, now: number): void {
    const m = this.movers.get(id);
    if (m) m.graceUntil = now + MOVEMENT.correction.graceS;
  }

  /** Stops holding a mover (its pad, if it held one, is free again); returns its profile, to `add` it again elsewhere (an
   * admin teleport re-seats it so: its next input is judged from there, as at a join). */
  remove(id: number): MoverProfile | undefined {
    const profile = this.movers.get(id)?.profile;
    this.movers.delete(id);
    this.releasePad(id);
    return profile;
  }

  /**
   * Whether a pose and mode the server did not watch arrive (a saved one, loaded at login) is somewhere that mode may be,
   * at server world time `now`: the rules every input's pose meets (its frame, the ground, the hangar shell, a gas
   * giant's depths, and the mode's own: the pulse drive out of the air and clear of what is ahead, landed on dry ground,
   * docked on a pad no other ship holds, on foot on ground or in the hangar beside the ship it left at `parked`), with
   * nothing before it to compare it with. Null when it may be there; a pose on a world whose ground is not planned yet
   * cannot be vouched for.
   */
  poseProblem(pose: Pose, mode: MoveMode, profile: MoverProfile, now: number, parked?: Pose): Violation | null {
    const key = this.keyOf(pose.frame);
    if (key === undefined)
      return { rule: 'frame', measured: 0, allowed: 0, unit: 'm', detail: `frame ${pose.frame} is not in system ${this.world.system.seed}` };
    this.skipped = null;
    const m = new Mover(-1, profile, now);
    const s = this.sample(m, null, 0, { pose, mode, buttons: 0 }, now, now, now);
    // as if it had been there a moment: on foot already, cruising if on the pulse drive, coming to rest if landed or docked
    const before: Sample = { ...s, cls: s.cls === 'rest' ? 'engine' : s.cls, flight: s.cls === 'rest' ? 'space' : s.flight, pad: null };
    let problem = this.legality(m, before, s);
    if (!problem && mode === 'foot') {
      // on foot: with a ship of its own resting on this world or in this Waystation to board again
      if (!parked || this.keyOf(parked.frame) !== key)
        return { rule: 'board_range', measured: Infinity, allowed: 0, unit: 'm', detail: 'on foot with no ship of its own here' };
      const ship = this.restSample(m, parked, now);
      problem = this.legality(m, { ...ship, cls: 'engine', flight: 'space', pad: null }, ship);
    }
    if (!problem && this.skipped !== null)
      return { rule: 'terrain', measured: 0, allowed: 0, unit: 'm', detail: `${frameName(this.skipped)}'s ground is not planned yet` };
    return problem;
  }

  /** Checks an input from entity `id`'s client, arriving at server world time `now`. */
  check(id: number, msg: InputMessage, now: number): MovementVerdict {
    const m = this.movers.get(id);
    if (!m) throw new Error(`entity ${id} is not a mover in zone ${this.zone}`);
    const credit = m.clock.credit(msg.time, now);
    if (m.fresh) {
      // the pose it joined at, on the client's clock: as long before its first input as the server measured
      m.fresh = false;
      for (const x of m.seg) x.t = credit.t - credit.gap;
    }
    if (credit.timeless && !m.timeless) {
      m.timeless = true;
      this.log?.warn(
        { zone: this.zone, entity: m.id, account: m.profile.accountId, character: m.profile.characterId, seq: msg.seq },
        'movement: client sends no time; its inputs are judged on their arrival times, with no jitter cancelled',
      );
    }
    if (m.hold) {
      const refused = this.resolveHold(m, msg.seq, credit, now);
      if (refused) return refused;
    }
    const L = m.last;
    this.skipped = null;
    const s = this.sample(m, L, msg.seq, msg, credit.t, credit.p, now);
    s.resync = credit.resync;
    const judged = this.judge(m, L, s);
    if (judged) return this.refuse(m, msg.seq, judged.violation, judged.rewind, credit, now);
    this.holdIfSkipped(m, { seq: msg.seq, msg, credit, r: now });
    m.graceUntil = -Infinity;
    this.accept(m, L, s);
    return { ok: true, mode: s.mode, vel: s.vel };
  }

  // ---------- holding for the ground ----------

  /** An input judged without a world's ground it needed: hold it, with everything after it, until that ground is ready. */
  private holdIfSkipped(m: Mover, input: HeldInput): void {
    if (this.skipped !== null && !m.hold) m.hold = { key: this.skipped, since: input.r, base: this.snapshot(m), inputs: [] };
    m.hold?.inputs.push(input);
  }

  /**
   * A mover holding for world `hold.key`'s ground: once it is ready, its held inputs are judged again with it, and the first
   * that fails is refused (the input now is refused with its correction); while it is not, the hold goes on, for at most
   * MOVEMENT.ground.holdS, then the input now is refused back to where the hold began. Null when nothing is refused.
   */
  private resolveHold(m: Mover, seq: number, credit: Credit, now: number): MovementRefusal | null {
    const h = m.hold!;
    if (!this.world.ground(h.key)) {
      if (now - h.since <= MOVEMENT.ground.holdS && h.inputs.length < MOVEMENT.heldMax) return null;
      const waited = { rule: 'terrain', measured: now - h.since, allowed: MOVEMENT.ground.holdS, unit: 's' } as const;
      return this.refuse(m, seq, { ...waited, detail: `${frameName(h.key)}'s ground was not ready to judge` }, m.last, credit, now, true);
    }
    m.hold = null;
    this.restore(m, h.base);
    for (const x of h.inputs) {
      const L = m.last;
      this.skipped = null;
      const s = this.sample(m, L, x.seq, x.msg, x.credit.t, x.credit.p, x.r);
      s.resync = x.credit.resync;
      const judged = this.judge(m, L, s);
      if (judged) return this.refuse(m, seq, judged.violation, judged.rewind, credit, now, true);
      this.holdIfSkipped(m, x);
      this.accept(m, L, s);
    }
    return null;
  }

  private snapshot(m: Mover): MoverState {
    return { last: m.last, seg: [...m.seg], boundary: m.boundary, change: m.change, parked: m.parked, settledAt: m.settledAt, switches: [...m.switches] };
  }

  private restore(m: Mover, st: MoverState): void {
    m.last = st.last;
    m.seg = [...st.seg];
    m.boundary = st.boundary;
    m.change = st.change;
    m.parked = st.parked;
    m.settledAt = st.settledAt;
    m.switches = [...st.switches];
    const pad = m.last.cls === 'foot' ? (m.parked?.pad ?? null) : m.last.pad;
    if (pad !== null) this.holdPad(m.id, pad);
    else this.releasePad(m.id);
  }

  /** The ground under frame `key` for a check that needs it: null for none, or while it is planned (the input being judged
   * is then held: MOVEMENT.ground). */
  private groundFor(key: FrameKey): Ground | null {
    const g = this.world.ground(key);
    if (!g && this.world.rocky(key)) this.skipped = key;
    return g;
  }

  // ---------- samples ----------

  private keyOf(frame: string | null): FrameKey | undefined {
    return frameKeyOf(this.world.system, frame);
  }

  /** A pose as a sample at client time `t`, with the bodies placed at world time `p`, after `prev` (null at a join): its
   * class and mode, a ship's caps and allowance, a walker's height and ground. */
  private sample(m: Mover, prev: Sample | null, seq: number, msg: Pick<InputMessage, 'pose' | 'mode' | 'buttons'>, t: number, p: number, now: number): Sample {
    const key = this.keyOf(msg.pose.frame);
    if (key === undefined) throw new RangeError(`frame ${msg.pose.frame} is not in system ${this.world.system.seed}`);
    // (in a world's frame: its ground is planned from now on, long before it is landed on)
    if (this.world.rocky(key)) this.world.ground(key);
    const pos: Vec3 = [...msg.pose.pos];
    const q = msg.pose.quat;
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    const quat: Quat = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
    const mode = msg.mode;
    const cls: MoverClass = mode === 'ship' ? 'engine' : mode === 'pulse' ? 'pulse' : mode === 'foot' ? 'foot' : 'rest';
    const s: Sample = {
      seq,
      t,
      p,
      r: now,
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
      ground: NaN,
      peak: 0,
      highSince: null,
      pad: null,
    };
    if (cls === 'foot') {
      this.walkerFields(prev, s);
      const fall = Math.sqrt(2 * this.gravity(key) * Math.max(0, s.peak - s.h));
      clampLength(s.vel, m.walkerCaps.across + m.walkerCaps.climb + fall);
      return s;
    }
    const poses = this.world.posesAt(p);
    const frame = this.world.framePose(key, poses);
    const world = this.world.toWorld(frame, pos);
    const clear = this.world.clearance(frame, world, rotate(quat, NOSE), poses);
    s.clearMin = clear.min;
    s.clearAhead = clear.ahead;
    s.flight =
      mode === 'ship'
        ? msg.buttons & Buttons.boost
          ? 'boost'
          : this.world.airAt(key, pos, world, poses) >= AIR.flightModelFrom
            ? 'atmo'
            : 'space'
        : (mode as FlightMode);
    s.caps = flightCaps(m.ship, s.flight, s.clearMin);
    const change = prev ? this.changeFor(m, prev, s) : null;
    s.allowed = change ? allowanceAfterChange(change.prev, s.caps, s.t - change.at) : s.caps.allowed;
    if (mode === 'docked') s.pad = nearestPad(pos);
    clampLength(s.vel, s.allowed);
    return s;
  }

  /** A ship at rest at `pose` (landed on a world, docked in a Waystation) as of server time `t`. */
  private restSample(m: Mover, pose: Pose, t: number): Sample {
    const mode: MoveMode = this.keyOf(pose.frame) === 'station' ? 'docked' : 'landed';
    return this.sample(m, null, 0, { pose, mode, buttons: 0 }, t, t, t);
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

  /** A walker's height, ground, the peak of its fall and its time high up. It stands on the ground only touching it (the
   * client sets it exactly on it): a walker in water, or skimming the ground mid-fall, keeps falling from its peak. */
  private walkerFields(prev: Sample | null, s: Sample): void {
    const { key, pos } = s;
    const g = this.groundFor(key);
    if (key === 'station') {
      s.h = pos[1];
      s.ground = STATION_LAYOUT.hangar.y0;
    } else if (g) {
      s.h = len(pos);
      s.ground = surfaceAt(g, pos);
    } else s.h = len(pos);
    const standing = Number.isFinite(s.ground) && s.h - s.ground <= MOVEMENT.terrain.standM;
    const before = prev !== null && prev.cls === 'foot' && prev.key === s.key;
    s.peak = standing ? s.h : Math.max(before ? prev.peak : s.h, s.h);
    s.highSince = s.h - s.ground > MOVEMENT.foot.supportM ? (before && prev.highSince !== null ? prev.highSince : s.r) : null;
  }

  /**
   * `x` in frame `key`, its position re-expressed there with the bodies at world time `p`, the time of the first pose in
   * the new frame: where it is then, carried along by its own frame. The client changes frame at a frame of its own between
   * two inputs, turning its velocity into the new frame without the frames' relative motion; until then its old frame
   * carried it (however long that was: a page that stalled for seconds moves nothing, and its frames moved on). So only the
   * ship's own movement is judged, give or take the frames' drift over the step in which it changed (switchSlack).
   */
  private inFrame(x: Sample, key: FrameKey, p: number): Sample {
    return x.key === key ? x : { ...x, key, pos: this.world.reframe(x.pos, x.key, key, p) };
  }

  /** How far the frames of `L` and `s` drift apart between the client's change of frame and `s` (none in one frame): at
   * most the step between them, and no more than MOVEMENT.frame.switchS of it (a running client sends every 50 ms; a stalled
   * one changes frame on its way back). With a fifth to spare; none across a clock stepped forward. */
  private switchSlack(L: Sample, s: Sample): number {
    if (L.key === s.key || s.resync) return 0;
    const world = this.world.toWorld(this.world.framePoseExact(L.key, s.p), L.pos);
    return this.world.frameDrift(world, L.key, s.key, s.p) * Math.min(Math.max(0, s.t - L.t), MOVEMENT.frame.switchS) * 1.2;
  }

  // ---------- judging ----------

  /** Why `s` cannot follow `L`, and the pose to correct to; null when it may. */
  private judge(m: Mover, L: Sample, s: Sample): { violation: Violation; rewind: Sample } | null {
    const fail = (rule: MovementRule, measured: number, allowed: number, unit: Violation['unit'], detail?: string, rewind = L) => ({
      violation: { rule, measured, allowed, unit, ...(detail ? { detail } : {}) },
      rewind,
    });
    const v = this.legality(m, L, s);
    if (v) return { violation: v, rewind: L };

    // what s moves on from: the last pose, or across getting out or boarding, the walker set down beside its ship or the
    // ship where it was left; and the window it extends or begins
    let prev: Sample;
    let win: readonly Sample[];
    let startAllowed: number | null = null;
    let fromSeg = false;
    if (s.cls === 'foot' && L.cls !== 'foot') {
      const anchor = this.exitAnchor(m, this.parkedAt(m, L)!, L);
      if (!anchor) return null; // (its world's ground is still being planned: held)
      prev = anchor;
      win = [anchor];
    } else if (s.cls !== 'foot' && L.cls === 'foot') {
      prev = { ...m.parked!, t: L.t, p: L.p, r: L.r };
      win = [prev];
      if (s.cls !== prev.cls) startAllowed = this.boundaryAllowance(m, prev, s);
    } else if (s.cls === L.cls && (s.key === L.key || s.cls !== 'foot')) {
      prev = L;
      win = m.seg;
      startAllowed = m.boundary;
      fromSeg = true;
    } else if (s.cls !== L.cls) {
      prev = L;
      win = [L];
      startAllowed = this.boundaryAllowance(m, L, s);
    } else {
      // a walker in another frame: nothing to measure from (its frame was checked)
      return null;
    }

    // anti-teleport and collisions on the way: the step from prev, in s's frame, over the time since (none for a clock
    // stepped forward, and at most a second: no input carries more)
    const from = this.inFrame(prev, s.key, s.p);
    const drift = this.switchSlack(prev, s);
    const T = MOVEMENT.teleport;
    const dt = s.resync ? 0 : Math.min(s.t - prev.t, T.maxS);
    const step = Math.max(0, dist(from.pos, s.pos) - drift);
    // (getting out, the walker's move from where the client sets it down; boarding, the ship's from where it was left)
    const jump: MovementRule = prev === L ? 'teleport' : s.cls === 'foot' ? 'exit_range' : 'board_range';
    let speedCap: number;
    if (s.cls === 'foot') {
      const over = this.walkerExcess(m, from, s, dt + T.lagS, T.walkerSlackM + (prev === L ? 0 : MOVEMENT.foot.exitM));
      if (over) return fail(jump, over.measured, over.allowed, 'm', over.detail);
      speedCap = m.walkerCaps.across + m.walkerCaps.climb;
    } else {
      const allowed = Math.max(s.cls === prev.cls ? prev.allowed : this.boundaryAllowance(m, prev, s), s.allowed);
      const slack = s.cls === 'rest' && prev.cls === 'rest' ? T.restSlackM : T.slackM;
      const limit = allowed * (dt + T.lagS) + slack;
      if (step > limit) return fail(jump, step, limit, 'm', jump === 'board_range' ? 'ship from where it was left' : undefined);
      speedCap = allowed;
    }
    const through = this.sweep(s, from.pos, step, dt, speedCap);
    if (through) return fail(through.rule, through.measured, through.allowed, 'm', through.detail);

    // the window (none across a clock stepped forward: a fresh one starts at s)
    if (s.resync) return null;
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
    const A = this.inFrame(win[ai]!, s.key, s.p);
    // (no time may pass between two inputs, but then nothing may move: a client whose clock stands still is not let off)
    const E = Math.max(0, s.t - A.t);
    let settle = !full && s.cls === 'rest' && A.cls !== 'rest' && s.t - m.settledAt >= W ? MOVEMENT.settleM : 0;
    // frame changes the window spans: the frames' drift over each crossing step
    settle += drift;
    if (fromSeg) for (const sw of m.switches) if (sw.t >= A.t) settle += sw.slackM;
    // a too-fast window rewinds to its start (never to a boundary or an anchor: the first pose of this stretch instead)
    const rewind = !fromSeg ? L : ai === 0 && startAllowed !== null ? (win[1] ?? L) : win[ai]!;
    if (s.cls === 'foot') {
      const over = this.walkerExcess(m, A, s, E, prev === L ? 0 : MOVEMENT.foot.exitM);
      return over ? fail('speed', over.measured, over.allowed, 'm', over.detail, rewind) : null;
    }
    const allowed = Math.max(ai === 0 && startAllowed !== null ? startAllowed : A.allowed, s.allowed);
    const dw = dist(A.pos, s.pos);
    if (dw > allowed * E + settle + MOVEMENT.floatM) {
      return fail('speed', E > 0 ? (dw - settle) / E : Infinity, allowed, 'm/s', `${s.flight} over ${round(E)} s`, rewind);
    }
    return null;
  }

  /** The allowance of `L`, the last pose before a change of class to `s`'s, in the new stretch's terms: the new mode's caps
   * at L's clearance, after the change (allowanceAfterChange at the change itself). Coming to rest, L keeps its own: the
   * contract's rest allowance is for a ship already down, and the window from the last flying pose holds the final
   * approach. */
  private boundaryAllowance(m: Mover, L: Sample, s: Sample): number {
    if (!isShip(L.cls) || !L.caps || s.flight === 'foot') return s.allowed;
    const caps = flightCaps(m.ship, s.flight, L.clearMin);
    const after = allowanceAfterChange({ ...L.caps, allowed: L.allowed }, caps, 0);
    return s.cls === 'rest' ? Math.max(after, L.allowed) : after;
  }

  /**
   * How far a walker's move from `A` (in `s`'s frame) over `span` seconds goes past what it can do: across the ground, up
   * (from where A was or from the highest ground along the way, which it steps up onto) and down (a fall from its peak since
   * it last stood on the ground), each with `extra` metres. Null within all three.
   */
  private walkerExcess(m: Mover, A: Sample, s: Sample, span: number, extra: number): { measured: number; allowed: number; detail: string } | null {
    const step = WALKER_TOLERANCE.stepM + extra;
    const dh = s.h - A.h;
    const d = dist(A.pos, s.pos);
    const across = Math.sqrt(Math.max(0, d * d - dh * dh));
    const caps = m.walkerCaps;
    const acrossMax = caps.across * span + step;
    if (across > acrossMax) return { measured: across, allowed: acrossMax, detail: 'across' };
    if (dh > 0) {
      const climb = caps.climb * span + step;
      if (dh <= climb) return null;
      // the ground it walks over lifts it: the highest along the way (the client sets a walker on any ground it walks into)
      const top = this.groundTop(A, s);
      if (!Number.isFinite(top)) return null; // (the ground is still being planned)
      const up = climb + Math.max(0, top - A.h);
      if (dh > up) return { measured: dh, allowed: up, detail: 'up' };
    } else {
      const down = walkerFall(this.gravity(s.key), A.peak - A.h, span) + step;
      if (-dh > down) return { measured: -dh, allowed: down, detail: 'down' };
    }
    return null;
  }

  /** The highest ground radius (or hangar floor) under the path from A to s, sampled every few metres (NaN while its ground
   * is planned). */
  private groundTop(A: Sample, s: Sample): number {
    if (s.key === 'station') return Math.max(A.ground, s.ground);
    const g = this.groundFor(s.key);
    if (!g) return NaN;
    let top = Math.max(surfaceAt(g, A.pos), surfaceAt(g, s.pos));
    const n = Math.min(MOVEMENT.sweep.samples, Math.ceil(dist(A.pos, s.pos) / MOVEMENT.sweep.spacingM));
    for (let i = 1; i < n; i++) top = Math.max(top, surfaceAt(g, lerp3(A.pos, s.pos, i / n)));
    return top;
  }

  /**
   * A step from `from` to s that goes further through the ground, or a flying ship's centre through the hangar's shell,
   * than the client's once-a-frame collisions could have missed at its speed (no faster than `speedCap`): null when it
   * does not.
   */
  private sweep(
    s: Sample,
    from: Readonly<Vec3>,
    step: number,
    dt: number,
    speedCap: number,
  ): { rule: MovementRule; measured: number; allowed: number; detail: string } | null {
    const S = MOVEMENT.sweep;
    const speed = Math.min(speedCap, step / Math.max(dt, 1e-3));
    const missable = speed * S.frameS + S.slackM;
    if (step <= missable) return null;
    if (s.key === 'station') {
      if (s.cls === 'foot' || s.cls === 'rest') return null;
      const run = hangarShellRun(from, s.pos, true);
      const allowed = speed * S.frameS + MOVEMENT.hullM;
      return run > allowed ? { rule: 'station_hull', measured: run, allowed, detail: 'through the hangar shell' } : null;
    }
    if (!this.world.rocky(s.key) || !this.world.nearGround(s.key, Math.min(len(from), len(s.pos)))) return null;
    const g = this.groundFor(s.key);
    if (!g) return null;
    const run =
      s.cls === 'foot'
        ? groundRun(from, s.pos, (p) => surfaceAt(g, p), MOVEMENT.terrain.walkerBelowM)
        : groundRun(from, s.pos, (p) => shipGroundAt(g, p) + SHIP_GEAR_HEIGHT * 0.6, MOVEMENT.terrain.shipBelowM);
    return run > missable ? { rule: 'terrain', measured: run, allowed: missable, detail: 'through the ground' } : null;
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
    const poses = this.world.posesAt(s.p);
    const world = this.world.toWorld(this.world.framePose(key, poses), pos);
    const frame = this.world.frameProblem(key, pos, world, s.cls === 'foot' ? m.walkerCaps.across : s.allowed, poses);
    if (frame) return fail('frame', frame.measured, frame.allowed, 'm', `${frameName(key)} where the rule picks ${frameName(frame.expected)}`);
    if (L.key !== key) {
      // a change of frame only where the rule makes it (not back and forth inside a sphere's hysteresis)
      const step = dist(this.world.reframe(L.pos, L.key, key, s.p), pos);
      const change = this.world.frameChangeProblem(L.key, key, world, poses, step + MOVEMENT.frame.marginM);
      if (change)
        return fail('frame', change.measured, change.allowed, 'm', `from ${frameName(L.key)} to ${frameName(key)} short of where the rule changes it`);
    }

    if (s.cls === 'foot') return this.footLegality(m, L, s, fail);

    // a ship: never inside the ground, a gas giant's depths or the hangar's shell
    const body = typeof key === 'number' ? this.world.system.bodies[key]! : null;
    const r = len(pos);
    const near = this.world.rocky(key) && this.world.nearGround(key, r, PULSE_DRIVE.engageAltitudeM);
    const ground = near ? this.groundFor(key) : null;
    let groundR: number | null = null;
    let landH = 0;
    if (ground) {
      landH = heightAt(ground, [pos[0] / r, pos[1] / r, pos[2] / r]);
      groundR = ground.radius + (ground.ocean ? Math.max(landH, 0) : landH);
      const floor = groundR + SHIP_GEAR_HEIGHT * 0.6 - MOVEMENT.terrain.shipBelowM;
      if (r < floor) return fail('terrain', r - groundR, floor - groundR, 'm', 'below the ground');
    }
    if (body && body.type === 'gas') {
      const floor = body.radius * MOVEMENT.gas.floor - MOVEMENT.gas.belowM;
      if (r < floor) return fail('gas_depth', r - body.radius, floor - body.radius, 'm');
    }
    if (key === 'station' && insideHangarShell(pos, s.cls === 'engine' || s.cls === 'pulse')) {
      return fail('station_hull', 0, 0, 'm', `inside the hangar shell at ${pos.map(round).join(', ')}`);
    }

    // out of the walker into the ship: only the ship it is beside
    if (L.cls === 'foot') {
      const p = m.parked;
      if (!p || p.key !== key) return fail('board_range', Infinity, 0, 'm', 'no ship of its own here');
      const walked = s.resync ? 0 : Math.min(Math.max(0, s.t - L.t), MOVEMENT.teleport.maxS);
      const reach = WALKER.boardRangeM + MOVEMENT.foot.boardSlackM + m.walkerCaps.across * walked;
      const walker = dist(L.pos, p.pos);
      if (walker > reach) return fail('board_range', walker, reach, 'm', 'walker to ship');
    }

    switch (s.cls) {
      case 'pulse': {
        const engaging = L.cls !== 'pulse';
        // Charge, as the character's meters have it now (the gateway ran them to this input's arrival before the zone)
        const id = m.profile.characterId;
        if (this.meters && id !== undefined && !this.meters.allowsMode(id, 'pulse', s.r, engaging ? 0 : MOVEMENT.pulse.chargeGraceS)) {
          return fail('pulse_charge', 0, 0, 'charge', engaging ? 'engaging with Charge empty' : 'cruising on past the drop-out');
        }
        const air = this.world.airAt(key, pos, world, poses);
        if (air > AIR.pulseCeiling) return fail('pulse_air', air, AIR.pulseCeiling, 'density');
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
        return s.mode === 'docked'
          ? this.dockedLegality(m, L, s, fail)
          : this.landedLegality(s, body, groundR, landH, ground?.ocean ?? false, near && !ground, fail);
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
    pending: boolean,
    fail: FailFn,
  ): Violation | null {
    if (pending) return null; // (its ground is still being planned: held)
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
    } else if (typeof key !== 'number' || this.world.system.bodies[key]!.type === 'gas') {
      return fail('foot_frame', 0, 0, 'm', `no ground in ${frameName(key)}`);
    }
    if (s.h < s.ground - MOVEMENT.terrain.walkerBelowM) return fail('terrain', s.h - s.ground, -MOVEMENT.terrain.walkerBelowM, 'm', 'below the ground');
    if (s.highSince !== null && s.r - s.highSince > F.airMaxS) {
      return fail('walker_hover', s.r - s.highSince, F.airMaxS, 's', `${round(s.h - s.ground)} m over the ground`);
    }
    // out of the ship: only out of one that has landed or docked, in its own frame
    if (L.cls !== 'foot') {
      const parked = this.parkedAt(m, L);
      if (!parked) return fail('exit_range', Infinity, 0, 'm', `out of a ship that is not landed or docked (${L.mode})`);
      if (parked.key !== key) return fail('exit_range', Infinity, 0, 'm', 'in another frame than its ship');
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
    const r = len(L.pos);
    if (!this.world.rocky(L.key) || !this.world.nearGround(L.key, r)) return null;
    const rest: Sample = { ...L, cls: 'rest', mode: 'landed', flight: 'landed' };
    const ground = this.groundFor(L.key);
    // (while its ground is planned, taken as landed: held, and judged again with it)
    if (!ground) return rest;
    const landH = heightAt(ground, [L.pos[0] / r, L.pos[1] / r, L.pos[2] / r]);
    const groundR = ground.radius + (ground.ocean ? Math.max(landH, 0) : landH);
    return this.landedLegality(rest, this.world.system.bodies[L.key]!, groundR, landH, ground.ocean, false, noop) ? null : rest;
  }

  /** Where the client sets a walker down getting out of `ship` (Game.exitShip): 11 m to its left and 3 m ahead on a world,
   * on the ground there (the sea floor too) 0.3 m up; 8 m to its left in a Waystation, feet 2 m over the floor. As a walker
   * standing there at the time of `at` (the last pose before it got out); null while the world's ground is planned. */
  private exitAnchor(m: Mover, ship: Sample, at: Sample): Sample | null {
    const left = rotate(ship.quat, LEFT);
    const fwd = rotate(ship.quat, NOSE);
    const E = WALKER.exit;
    let feet: Vec3;
    if (ship.key === 'station') {
      feet = [ship.pos[0] + left[0] * E.station.leftM, E.station.feetY, ship.pos[2] + left[2] * E.station.leftM];
    } else {
      const g = this.groundFor(ship.key);
      if (!g) return null;
      const p: Vec3 = [
        ship.pos[0] + left[0] * E.planet.leftM + fwd[0] * E.planet.forwardM,
        ship.pos[1] + left[1] * E.planet.leftM + fwd[1] * E.planet.forwardM,
        ship.pos[2] + left[2] * E.planet.leftM + fwd[2] * E.planet.forwardM,
      ];
      const r = len(p);
      const dir: Vec3 = [p[0] / r, p[1] / r, p[2] / r];
      const h = g.radius + heightAt(g, dir) + E.planet.aboveGroundM;
      feet = [dir[0] * h, dir[1] * h, dir[2] * h];
    }
    return this.sample(
      m,
      null,
      ship.seq,
      { pose: { frame: frameIdOf(this.world.system.seed, ship.key), pos: feet, quat: ship.quat, vel: [0, 0, 0] }, mode: 'foot', buttons: 0 },
      at.t,
      at.p,
      ship.r,
    );
  }

  // ---------- outcomes ----------

  private accept(m: Mover, L: Sample, s: Sample): void {
    const intoFoot = s.cls === 'foot' && L.cls !== 'foot';
    const outOfFoot = s.cls !== 'foot' && L.cls === 'foot';
    if (s.cls === L.cls && !intoFoot && !outOfFoot && (s.key === L.key || s.cls !== 'foot')) {
      // the stretch goes on; across a change of frame, its poses are re-expressed in the new one as of the change
      if (s.key !== L.key) {
        m.switches.push({ t: L.t, slackM: this.switchSlack(L, s) });
        m.seg = m.seg.map((x) => this.inFrame(x, s.key, s.p));
      }
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
      const first = m.seg[0]!.t;
      m.switches = m.switches.filter((sw) => sw.t >= first);
    } else if (outOfFoot) {
      const from = { ...m.parked!, t: L.t, p: L.p, r: L.r };
      m.boundary = s.cls === from.cls ? null : this.boundaryAllowance(m, from, s);
      m.seg = [from, s];
      m.switches = [];
    } else if (isShip(s.cls) && isShip(L.cls)) {
      const from = this.inFrame(L, s.key, s.p);
      m.boundary = this.boundaryAllowance(m, from, s);
      m.seg = [from, s];
      m.switches = L.key === s.key ? [] : [{ t: L.t, slackM: this.switchSlack(L, s) }];
    } else {
      m.boundary = null;
      m.seg = [s];
      m.switches = [];
    }
    // (a clock stepped forward: windows start afresh here)
    if (s.resync) {
      m.seg = [s];
      m.boundary = null;
      m.switches = [];
    }
    if (s.cls === 'rest' && isShip(L.cls) && L.cls !== 'rest') m.settledAt = s.t;
    m.change = isShip(s.cls) ? (outOfFoot ? null : this.changeFor(m, L, s)) : null;
    if (s.cls === 'rest') m.parked = s;
    else if (intoFoot) m.parked = this.parkedAt(m, L);
    else if (s.cls !== 'foot') m.parked = null;
    const pad = s.cls === 'foot' ? (m.parked?.pad ?? null) : s.pad;
    if (pad !== null) this.holdPad(m.id, pad);
    else this.releasePad(m.id);
    m.last = s;
  }

  /**
   * Refuses input `seq` (credited `at`), correcting to `rewind`; quietly, within the grace after a correction, unless
   * `force` (the mover's state was rewound). Inputs a hold let through are not vouched for: a refusal during one corrects to
   * where it began.
   */
  private refuse(m: Mover, seq: number, violation: Violation, rewind: Sample, at: Credit, now: number, force = false): MovementRefusal {
    if (!force && now < m.graceUntil) {
      this.quiet++;
      this.log?.debug({ zone: this.zone, entity: m.id, seq, rule: violation.rule }, 'movement: input from before the correction refused');
      return { ok: false, correction: null, violation: null, kick: false };
    }
    if (m.hold) {
      this.restore(m, m.hold.base);
      m.hold = null;
      rewind = m.last;
    }
    // the pose corrected to is the authoritative state as of the refused input's time
    const to: Sample = { ...rewind, t: at.t, p: at.p, r: now };
    const i = m.seg.indexOf(rewind);
    if (i >= 0) m.seg.length = i;
    if (m.seg.length === 0) m.boundary = null;
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
