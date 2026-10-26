// Flight caps: the fastest a ship can legitimately move in each movement mode. The client's flight model clamps to them and
// the server holds predicted poses to them (IMPLEMENTATION_PLAN 0.3, ARCHITECTURE §7), so both read one table per hull.
import type { ShipStats } from './stats.ts';

/** How a ship is moving, as the server classifies an `input` (the protocol's MoveMode, refined): mode `ship` is `boost` while
 * the boost button is held, else `atmo` wherever a world's air reaches the flight model at all (the client blends its air
 * model in from density 0.004) and `space` outside it; `pulse`, `landed` and `docked` carry over. (`foot` is the walker's,
 * capped elsewhere.) */
export const FLIGHT_MODES = ['space', 'boost', 'atmo', 'pulse', 'landed', 'docked'] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

/** Modes in which the ship flies on its engines: between these the cap can drop faster than the ship can slow. */
const ENGINE_MODES: ReadonlySet<FlightMode> = new Set(['space', 'boost', 'atmo']);

/** The pulse drive (the demo's supercruise, which DESIGN 20.1 keeps). Its speed limit grows with the clearance: close in, a
 * short time constant keeps arrival controllable; in open space the limit grows with the distance to anything, `cruiseS`
 * seconds to cover it, so between the stars it climbs to thousands of times light speed. */
export const PULSE_DRIVE = {
  /** Never slower than this, m/s. */
  minSpeed: 300,
  /** Near bodies the limit is this fraction of the clearance per second (× `ShipStats.pulse.nearLimit`). */
  nearRate: 0.55,
  /** In open space at least this, m/s… */
  openSpeed: 280000,
  /** …or the clearance covered in this many seconds. Inside `openSpeed × cruiseS` of anything the drive burns Charge. */
  cruiseS: 40,
  /** Above its target the drive eases down toward it at this rate, per second (exponentially): it lags a falling limit. */
  easeRate: 4,
  /** Dropping out of the drive leaves the ship at this speed at most, m/s. */
  exitSpeedMax: 400,
} as const;

/** The pulse drive's speed limit, m/s, at a clearance in metres: the distance to the nearest body's sky (or peaks, or hazard
 * layer), the station, or the next star, galaxy or the Edge. */
export function pulseSpeedLimit(stats: ShipStats, clearanceM: number): number {
  const { minSpeed, nearRate, openSpeed, cruiseS } = PULSE_DRIVE;
  return Math.max(minSpeed, Math.min(clearanceM * nearRate * stats.pulse.nearLimit, Math.max(openSpeed, clearanceM / cruiseS)));
}

/** The client clamps a flying ship's speed at the boost cap × this: room for gravity against the controller at the cap. */
export const CLIENT_SPEED_HEADROOM = 1.05;

/**
 * How P1.E03.T04's movement validation reads the caps. The server never trusts the client's `vel` or `time`:
 * - It measures speed itself: displacement in the pose's frame over server-measured elapsed time, across at least `windowS`
 *   of inputs (one packet's spacing jitters with the network). A window is split where the mode or the frame changes; a
 *   stretch shorter than `windowS` between two changes (a one-tick pulse) is judged on its own, against its own mode's
 *   allowance, and never merged into a window of another mode.
 * - A window passes when its speed is within the larger of the allowances at its two end poses (its first and last), never
 *   at a pose in between, which a cheat could fake:
 *   - in flight `max × factor + slackMps`, landed or docked `restSlackMps` (`FlightCaps.allowed`);
 *   - on the pulse drive, the caps at each end pose's clearance, which the server computes from that pose and the bodies'
 *     poses at its own time (the protocol carries no clearance). The drive eases down to a falling limit on approach to a
 *     body, so judged at the clearance it ends at alone, an honest pilot would be corrected; the start's covers it;
 *   - after a change of mode, `allowanceAfterChange` at each end's server time since the change: when the cap drops in
 *     flight (boost released, the ship climbs out of the air) the previous allowance falls at `decelMps2`, slower than the
 *     client sheds speed with its nose turned across its path; on entering the pulse drive the previous allowance fades as
 *     the drive eases down from the entry speed. Other changes are immediate: the drive drops out at
 *     `PULSE_DRIVE.exitSpeedMax` at most, under every hull's space cap, and a ship lands or docks at rest.
 * - A window over its allowance is corrected to the last valid pose.
 * - Speed only. Whether the pulse drive may be engaged at all (outside the air, 600 m clear of anything ahead), its spool-up
 *   and its fuel are not checked here: Charge is P1.E07.T02's, mode legality P1.E03.T04's.
 */
export const FLIGHT_TOLERANCE = {
  windowS: 1,
  /** The client clamps at `CLIENT_SPEED_HEADROOM` (5%); the rest absorbs timing noise. Kept tight: between the stars this is
   * how much faster than the drive a cheat could cruise. */
  factor: 1.1,
  /** m/s. Terrain push-out (up to 30 m/s near the ground), collision bounce and storm gusts act after the client's clamp. */
  slackMps: 50,
  /** m/s. A landed or docked ship does not move in its frame; this is float noise. */
  restSlackMps: 1,
  /** m/s². Released from boost with the nose turned 90° across its path, the ship sheds speed only as its thrusters trim the
   * drift (140 m/s²) while the main engine pushes it along the new heading. */
  decelMps2: 60,
} as const;

export interface FlightCaps {
  mode: FlightMode;
  /** The fastest a legitimate client moves relative to its pose's frame in this mode, m/s. */
  max: number;
  /** What the server accepts: `max` under FLIGHT_TOLERANCE. */
  allowed: number;
}

/**
 * The speed caps for a ship in a mode. `clearanceM` is for the pulse drive (see `pulseSpeedLimit`): the clearance at one of
 * the judged window's end poses, as the server computes it. Without it the pulse cap is unbounded, as between the stars.
 *
 * The air has no cap of its own: the demo's air model has no fixed top speed (drag sets it, and it rises as the air thins;
 * DESIGN's 240 is where it settles at sea level), boost thrust outruns the drag cap at any density, and a ship arriving
 * from orbit keeps its speed for seconds. So `atmo` is held to the boost cap until a per-hull air model replaces it.
 */
export function flightCaps(stats: ShipStats, mode: FlightMode, clearanceM = Infinity): FlightCaps {
  const T = FLIGHT_TOLERANCE;
  const flying = (max: number): FlightCaps => ({ mode, max, allowed: max * T.factor + T.slackMps });
  switch (mode) {
    case 'space':
      return flying(stats.speed.space);
    case 'boost':
    case 'atmo':
      return flying(stats.speed.space * stats.boost);
    case 'pulse':
      return flying(pulseSpeedLimit(stats, clearanceM));
    case 'landed':
    case 'docked':
      return { mode, max: 0, allowed: T.restSlackMps };
  }
}

/** The allowance `sinceS` seconds after the caps changed from `previous` to `next`:
 * - between engine modes (space, boost, atmo), a drop falls at `FLIGHT_TOLERANCE.decelMps2` until it meets the new allowance;
 * - from an engine mode into the pulse drive, the previous allowance carries over and fades at `PULSE_DRIVE.easeRate` on top
 *   of the new one (the drive eases down from the entry speed toward its limit);
 * - anything else takes the new allowance at once. */
export function allowanceAfterChange(previous: FlightCaps, next: FlightCaps, sinceS: number): number {
  const t = Math.max(0, sinceS);
  if (!ENGINE_MODES.has(previous.mode)) return next.allowed;
  if (ENGINE_MODES.has(next.mode)) return Math.max(next.allowed, previous.allowed - FLIGHT_TOLERANCE.decelMps2 * t);
  if (next.mode === 'pulse') return next.allowed + previous.allowed * Math.exp(-PULSE_DRIVE.easeRate * t);
  return next.allowed;
}
