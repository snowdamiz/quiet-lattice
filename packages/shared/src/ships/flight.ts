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

/** The pulse drive's speed limit by clearance (the demo's supercruise, which DESIGN 20.1 keeps). Close in, a short time
 * constant keeps arrival controllable; in open space the limit grows with the distance to anything, `cruiseS` seconds to
 * cover it, so between the stars it climbs to thousands of times light speed. */
export const PULSE_DRIVE = {
  /** Never slower than this, m/s. */
  minSpeed: 300,
  /** Near bodies the limit is this fraction of the clearance per second (× `ShipStats.pulse.nearLimit`). */
  nearRate: 0.55,
  /** In open space at least this, m/s… */
  openSpeed: 280000,
  /** …or the clearance covered in this many seconds. Inside `openSpeed × cruiseS` of anything the drive burns Charge. */
  cruiseS: 40,
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
 *   of inputs (one packet's spacing jitters with the network). A window is split where the mode or the frame changes.
 * - A window passes when its speed is within `FlightCaps.allowed`: `max × factor + slackMps` in flight (`pulseFactor` on the
 *   pulse drive), `restSlackMps` landed or docked.
 * - When the cap drops in flight (boost released, the ship climbs out of the air), the allowance falls from the previous one
 *   at `decelMps2`, slower than the client sheds speed out of the air (220 m/s²): see `allowanceAfterDrop`. Other drops are
 *   immediate: leaving the pulse drive puts the ship at 400 m/s at most, under every hull's space cap, and a ship lands or
 *   docks at rest.
 * - A window over its allowance is corrected to the last valid pose.
 */
export const FLIGHT_TOLERANCE = {
  windowS: 1,
  /** The client clamps at `CLIENT_SPEED_HEADROOM` (5%); the rest absorbs timing noise. */
  factor: 1.1,
  /** The pulse drive eases down to a falling limit (rate 4/s) on approach to a body, so it runs over it, and the server
   * measures the clearance at its own time. */
  pulseFactor: 1.5,
  /** m/s. Terrain push-out (up to 30 m/s near the ground), collision bounce and storm gusts act after the client's clamp. */
  slackMps: 50,
  /** m/s. A landed or docked ship does not move in its frame; this is float noise. */
  restSlackMps: 1,
  /** m/s². */
  decelMps2: 200,
} as const;

export interface FlightCaps {
  mode: FlightMode;
  /** The fastest a legitimate client moves relative to its pose's frame in this mode, m/s. */
  max: number;
  /** What the server accepts: `max` under FLIGHT_TOLERANCE. */
  allowed: number;
}

/**
 * The speed caps for a ship in a mode. `clearanceM` is for the pulse drive (see `pulseSpeedLimit`); without it the pulse cap
 * is unbounded, as it is between the stars.
 *
 * The air has no cap of its own: the demo's air model has no fixed top speed (drag sets it, and it rises as the air thins;
 * DESIGN's 240 is where it settles at sea level), boost thrust outruns the drag cap at any density, and a ship arriving
 * from orbit keeps its speed for seconds. So `atmo` is held to the boost cap until a per-hull air model replaces it.
 */
export function flightCaps(stats: ShipStats, mode: FlightMode, clearanceM = Infinity): FlightCaps {
  const T = FLIGHT_TOLERANCE;
  const boosted = stats.speed.space * stats.boost;
  switch (mode) {
    case 'space':
      return { mode, max: stats.speed.space, allowed: stats.speed.space * T.factor + T.slackMps };
    case 'boost':
    case 'atmo':
      return { mode, max: boosted, allowed: boosted * T.factor + T.slackMps };
    case 'pulse': {
      const max = pulseSpeedLimit(stats, clearanceM);
      return { mode, max, allowed: max * T.pulseFactor + T.slackMps };
    }
    case 'landed':
    case 'docked':
      return { mode, max: 0, allowed: T.restSlackMps };
  }
}

/** The allowance `sinceS` seconds after the caps changed from `previous` to `next`. Between engine modes (space, boost,
 * atmo) a drop falls at `FLIGHT_TOLERANCE.decelMps2` until it meets the new allowance; anything else takes the new one at once. */
export function allowanceAfterDrop(previous: FlightCaps, next: FlightCaps, sinceS: number): number {
  if (!ENGINE_MODES.has(previous.mode) || !ENGINE_MODES.has(next.mode)) return next.allowed;
  return Math.max(next.allowed, previous.allowed - FLIGHT_TOLERANCE.decelMps2 * Math.max(0, sinceS));
}
