// Movement authority's tolerances and the rules it names when it refuses an input (P1.E03.T04, ARCHITECTURE §7). The
// speeds themselves are shared: `flightCaps` and FLIGHT_TOLERANCE for a ship, `walkerCaps` for a walker
// (@astra/shared/ships). What lives here is how the server measures, how far it lets an honest client's network and clock
// stray, and when it gives up on a client.
import { FLIGHT_TOLERANCE } from '@astra/shared/ships';

export const MOVEMENT = {
  /** Speed windows: at least this long, measured on the server (FLIGHT_TOLERANCE.windowS). */
  windowS: FLIGHT_TOLERANCE.windowS,
  /**
   * Time is the server's: when each input arrives (the client's `time` is never read). Inputs that arrive bunched after a
   * network stall share one arrival time, so a window starts at the *latest* pose that arrived at least `windowS` before
   * its end: the last of a bunch, sent last, and never one delayed more than the window's end. A full window is never
   * measured faster than the client flew it.
   *
   * A window still under `windowS` (a segment just begun, or a short stretch between two changes) has no such pose to
   * start from, so it is judged from its start over the longer of its arrival time and the inputs' own 20 Hz spacing
   * (`intervalS` each), but no more than `lagS` beyond its arrival time; and with `slackM` more distance (a touchdown's
   * settle onto the gear: up to half a metre down, after up to 50 ms at the 5 m/s a hovering ship may touch down at).
   */
  short: { intervalS: 0.05, lagS: 0.25, slackM: 1 },
  /** Anti-teleport: one input may not move further from the last valid pose than its allowance covers in the time since,
   * plus `lagS` of it (inputs bunched by a stall arrive together) and `slackM` (collision push-outs). Beyond that it is
   * refused outright. */
  teleport: { lagS: 0.25, slackM: 25, restSlackM: 1, walkerSlackM: 3 },
  /** Frames. A client picks its frame by the shared rule on its own clock; the server checks it on the zone's last tick. A
   * sphere it should be inside counts only `skewS` of their relative motion plus `marginM` inside the edge. A step across a
   * change of frame is re-expressed on the server's poses, with the same allowance for the clocks' difference. */
  frame: { skewS: 0.5, marginM: 50 },
  terrain: {
    /** A ship's centre stays 0.6 of its gear over the ground (sea level over water); this much lower is inside it. */
    shipBelowM: 5,
    /** A walker's feet stay on the ground (the sea floor under water); this much lower is inside it. */
    walkerBelowM: 3,
    /** A walker within this of the ground (or in water) is standing; its fall allowance starts again from there. */
    standM: 1.2,
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
    /** Getting out sets the walker down within this of its ship (11.4 m out, and a slope's rise), plus its own walk since. */
    exitM: 25,
    /** Boarding: the walker within the client's 9 m of its ship (WALKER.boardRangeM) plus this. */
    boardSlackM: 3,
    /** Boarded: the ship's pose within this of where it was left. */
    parkedM: 1.5,
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
