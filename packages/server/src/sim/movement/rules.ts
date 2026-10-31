// Movement authority's tolerances and the rules it names when it refuses an input (P1.E03.T04, ARCHITECTURE §7). The
// speeds themselves are shared: `flightCaps` and FLIGHT_TOLERANCE for a ship, `walkerCaps` for a walker
// (@astra/shared/ships). What lives here is how the server measures, how far it lets an honest client's network and clock
// stray, and when it gives up on a client. ARCHITECTURE §7 sets out the rules these feed.
import { FLIGHT_TOLERANCE } from '@astra/shared/ships';

export const MOVEMENT = {
  /** Speed windows: at least this long (FLIGHT_TOLERANCE.windowS). */
  windowS: FLIGHT_TOLERANCE.windowS,
  /**
   * Time. Each pose is judged at the time its client says it sampled it (the input's `time`, its estimate of server time):
   * an honest client's poses and times are its own trajectory, so the network's delays cancel, within these bounds. The
   * time credited between two inputs, which speed is judged on, never runs ahead of the real time that passed by more than
   * a small fixed slack:
   * - an input is credited with the time its client says passed since the previous one (or, catching up a stamp an earlier
   *   input was held behind, since the time credited then); never less than none (a clock stepped back costs that one
   *   input's time, and nothing runs backwards);
   * - and no more than its arrival gap, plus at most `perInputS` out of a bank of `bankS` that refills only with real time
   *   no input claimed, plus at most `drainInputS` of the real time its running clock left unclaimed (a latency rise, a
   *   stall: its inputs arrived later than they were sent) in the last `drainS`. So a backlog drains however it arrives
   *   (bunched, or over seconds), and a latency spike falls back, while what is owed is claimed back only within `drainS`
   *   of when it was owed; a clock standing still while time passes is owed nothing (it banks no more than `bankS`), and
   *   one run fast is held to real time once the bank is spent. The envelope, as measured: the total credited is at most
   *   real time + `bankS` + `aheadS`; at 60 Hz within the message budget, up to 3.9 times real time for 3.4 s; after 6 to
   *   10 s standing still with a trickling clock, about 6 s of allowance in one tick (some 10 km at the boost cap): the
   *   envelope of an honest stall's backlog arriving at once, which is accepted;
   * - and never ahead of the input's arrival by more than `aheadS` (a client's estimate of server time errs by about half
   *   a round trip's asymmetry).
   * A stamp more than `resyncS` past what it can be credited, from a client no longer `behindS` behind (a clock stepped
   * forward, as the client steps one that has fallen behind after a hidden tab's pause; or a lagging one caught up), is not
   * cashed in: the credited time re-syncs to it with no movement credit for the step (the input is held to the
   * anti-teleport bound alone), and judging windows start afresh there. At most once in `resyncEveryS`; a step within
   * that is held to the bank like any other.
   * The bodies are placed at the credited time, trailing the input's arrival by no more than `behindS` and what is still
   * owed. A stamp lagging its arrival by more than `behindS` is a backlog only while that lag drains (by `drainingS` within
   * every `staleS`); one that does not is stale: placed at its arrival (the game's client steps its clock forward whenever
   * it is more than `behindS` behind, so its lag never stays). An input with no usable time (none, or 0) is judged and
   * placed on its arrival: the time between such inputs is their arrival gap, so no jitter is cancelled for them (the
   * game's client stamps `time`).
   */
  time: {
    aheadS: 0.3,
    perInputS: 0.05,
    bankS: 0.5,
    drainInputS: 0.05,
    drainS: 10,
    behindS: 1,
    drainingS: 0.5,
    staleS: 3,
    resyncS: 1,
    resyncEveryS: 10,
  },
  /** A world's ground is planned off the input path (in the worker thread) once a player comes near it. A pose that needs
   * it before it is ready is accepted provisionally and judged again, with everything since, as soon as it is; one still
   * waiting `holdS` later is refused, back to the last pose judged without that need. */
  ground: { holdS: 5 },
  /** A ship coming to rest settles onto its gear: a window from its last flying pose takes this much more distance (half a
   * metre down after up to 50 ms at the 5 m/s a hovering ship may touch down at), at most once a `windowS`. */
  settleM: 1,
  /** Anti-teleport: one input may not move further from the last valid pose than its allowance covers in the time since
   * (at most `maxS` of it: the client moves its ship a clamped frame at a time, so no single input carries more, whatever
   * silence came before it), plus `lagS` of it and `slackM` (collision push-outs). Beyond that it is refused outright. */
  teleport: { lagS: 0.1, maxS: 1, slackM: 25, restSlackM: 1, walkerSlackM: 3 },
  /** Frames: a sphere a client should be inside counts only this far inside its edge (plus their relative motion over the
   * poses' time step). A pose in a new frame is compared with the last in the old one carried along by its own frame to
   * the new pose's time; the frames drift apart over no more than `switchS` of the step between them (the client changes
   * frame at one of its own frames, and sends every 50 ms; one whose page stalled changes frame on its way back). */
  frame: { marginM: 50, switchS: 0.1 },
  /**
   * Collisions between poses. The client collides once a frame (its frames are at most `frameS` long), so it can pass
   * through anything thinner than one frame's flight; a step that passes further through the ground, or a ship's centre
   * through the hangar's shell, than one frame at its own speed (no faster than its allowance) and `slackM` cannot be
   * the client's. Steps are sampled against the ground at most `samples` times, at least `spacingM` apart, and only when
   * long enough to matter.
   */
  sweep: { frameS: 0.066, slackM: 5, samples: 32, spacingM: 4 },
  /** The client keeps a flying ship's centre this far off the station's colliders. */
  shipRadiusM: 6,
  /** Float noise in a pose that has not moved, m. */
  floatM: 0.01,
  terrain: {
    /** A ship's centre stays 0.6 of its gear over the ground (sea level over water); this much lower is inside it. */
    shipBelowM: 5,
    /** A walker's feet stay on the ground (the sea floor under water); this much lower is inside it. */
    walkerBelowM: 3,
    /** A walker within this of the ground is on it: the client sets a walker that reaches the ground exactly on it (stopping
     * its fall), so one sampled a little above is still falling. Its fall allowance starts again from there. */
    standM: 0.005,
  },
  /** Inside the Waystation's hangar shell (STATION_LAYOUT), this far from its faces. */
  hullM: 1,
  /** A gas giant's ship-crushing depths start at this fraction of its radius (the client's floor); this much lower. */
  gas: { floor: 1.004, belowM: 50 },
  pulse: {
    /** Below PULSE_DRIVE's engage and drop-out clearances by this much (the drive moves between the client's check and
     * its sample). */
    clearanceM: 25,
    /** Below PULSE_DRIVE.engageAltitudeM by this much. */
    altitudeM: 50,
    /** Cruising on as Charge runs out (Heat and Charge, P1.E07.T02): the client drops out of the drive when its own
     * predicted meter empties, which may trail the server's a little; inputs on the drive are taken until this much of the
     * client's credited time past the moment the server's burn (on that same credited time) emptied it. Engaging takes
     * none: the drive needs Charge to engage. */
    chargeGraceS: 1,
  },
  landed: {
    /** A landed ship rests on its gear over dry ground: its gear this much into the ground or this much above it. */
    belowM: 2,
    aboveM: 8,
    /** Not over open water: the ground under a landed ship is at least the client's 0.5 m over the sea, less this. */
    waterM: 1.5,
  },
  docked: {
    /** On a pad: its gear within this of the pad's top, below or above. */
    belowM: 1.5,
    aboveM: 3,
  },
  foot: {
    /** Getting out sets the walker down where the client's Game.exitShip does (beside the ship, on the ground there); its
     * first pose is judged as a walker's move from there, with this much more. */
    exitM: 2,
    /** Boarding: the walker within the client's 9 m of its ship (WALKER.boardRangeM) plus this; the ship then moves on from
     * where it was left, judged as a ship's move. */
    boardSlackM: 3,
    /** Higher than this over the ground (no city tower reaches it) the walker cannot be standing on anything… */
    supportM: 400,
    /** …and may not stay there longer than this (a fall off the highest cliff on the lightest moon takes less). */
    airMaxS: 45,
    /** A walker in a Waystation stays inside its hangar, this much outside its walls at most (Grav Boots aside). */
    hangarM: 2,
  },
  /** After a correction, inputs already on their way from the old trajectory are refused without another correction for
   * this long, or until one fits the corrected pose. This also rate-limits corrections. */
  correction: { graceS: 1 },
  /** This many corrections within `withinS` and the session is refused with `kicked`. Each correction is at least
   * `correction.graceS` from the last, so a client is kicked after at least ~8 s of moving the server cannot accept; an
   * honest one, on any network, is not corrected at all. */
  kick: { count: 8, withinS: 30 },
  /** Validated poses kept per mover at most: a window's worth at the most inputs the message budget lets through, with
   * room to spare (only the latest pose at least `windowS` old and those since are kept). */
  historyMax: 256,
  /** Inputs held per mover while its world's ground is planned, at most (`ground.holdS` at the message budget's rate). */
  heldMax: 256,
} as const;

export type MovementRules = typeof MOVEMENT;

/** What a refused input broke. */
export type MovementRule =
  /** a window (or a stretch under one) faster than its allowance */
  | 'speed'
  /** one input too far from the last valid pose */
  | 'teleport'
  /** a frame the shared rule would not put it in */
  | 'frame'
  /** a ship below the ground, or a walker */
  | 'terrain'
  /** inside a gas giant's depths */
  | 'gas_depth'
  /** inside the Waystation's hangar shell */
  | 'station_hull'
  /** the pulse drive in the air, too near something, or too low over a world */
  | 'pulse_air'
  | 'pulse_clearance'
  | 'pulse_altitude'
  /** the pulse drive with Charge empty (the character's meters, P1.E07.T02): engaging, or cruising on past the drop-out */
  | 'pulse_charge'
  /** landed off the ground, on water or not on a world */
  | 'landed'
  /** docked off a pad or outside a Waystation */
  | 'docked'
  /** docked on a pad another ship holds */
  | 'pad_taken'
  /** on foot where there is no ground (in space, on a gas giant) */
  | 'foot_frame'
  /** on foot, out of the ship but not beside it, or boarding a ship it is not beside */
  | 'exit_range'
  | 'board_range'
  /** on foot higher than anything to stand on, for too long */
  | 'walker_hover'
  /** on foot outside the Waystation's hangar */
  | 'walker_hangar';

export interface Violation {
  rule: MovementRule;
  /** what the server measured and what it allows, in `unit` */
  measured: number;
  allowed: number;
  unit: 'm/s' | 'm' | 's' | 'density' | 'charge';
  detail?: string;
}
