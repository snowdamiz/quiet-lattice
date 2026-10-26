// Movement authority's tolerances and the rules it names when it refuses an input (P1.E03.T04, ARCHITECTURE §7). The
// speeds themselves are shared: `flightCaps` and FLIGHT_TOLERANCE for a ship, `walkerCaps` for a walker
// (@astra/shared/ships). What lives here is how the server measures, how far it lets an honest client's network and clock
// stray, and when it gives up on a client. ARCHITECTURE §7 sets out the rules these feed.
import { FLIGHT_TOLERANCE } from '@astra/shared/ships';

export const MOVEMENT = {
  /** Speed windows: at least this long (FLIGHT_TOLERANCE.windowS). */
  windowS: FLIGHT_TOLERANCE.windowS,
  /**
   * Time. Each pose is judged at the time its client says it sampled it (the input's `time`, its estimate of server time),
   * so latency, jitter and stalls between client and server change nothing: an honest client's poses and times are its
   * own trajectory. The server bounds that clock by its own, so a client cannot fly faster by running it fast:
   * - it never runs backwards, and never lags the input's arrival by more than `maxLagS` (it is raised to that: a client
   *   that sends no time at all is judged on arrival times);
   * - it is never ahead of the input's arrival by more than `aheadS` (a client's estimate of server time errs by about half
   *   a round trip's asymmetry);
   * - its latency (arrival less its time) never falls more than `slackS` below the smallest latency among inputs at least
   *   `settleS` old in the last `horizonS`, eased by `rate` a second (a slewing clock): latency may fall at once by
   *   `slackS`, as when a 400 ms spike clears, and a stall's late arrivals have a large latency, so they never bind.
   * A client running its clock fast thus gains no more than `slackS` before it is held to the server's clock, and to bank
   * that again must first fall behind it.
   */
  time: { aheadS: 0.3, maxLagS: 30, slackS: 0.4, rate: 0.01, settleS: 1, horizonS: 30 },
  /** A ship coming to rest settles onto its gear: a window from its last flying pose takes this much more distance (half a
   * metre down after up to 50 ms at the 5 m/s a hovering ship may touch down at), at most once a `windowS`. */
  settleM: 1,
  /** Anti-teleport: one input may not move further from the last valid pose than its allowance covers in the time since,
   * plus `lagS` of it and `slackM` (collision push-outs). Beyond that it is refused outright. */
  teleport: { lagS: 0.1, slackM: 25, restSlackM: 1, walkerSlackM: 3 },
  /** Frames: a sphere a client should be inside counts only this far inside its edge (plus their relative motion over the
   * poses' time step). */
  frame: { marginM: 50 },
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
  /** Arrival times kept per mover for the clock's horizon, at most. */
  clockMax: 1024,
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
  unit: 'm/s' | 'm' | 's' | 'density';
  detail?: string;
}
