// Where a character is, as the two meters read it (DESIGN 9.1): the world it is on and that world's hazards, day or night
// there, whether its head is under the sea, and for Charge whether the sun reaches it, whether it is inside its system's
// habitable band, near the star or out in deep space, and whether the pulse drive burns there. One pure function over a
// system's description and its bodies' poses at a moment, so the client predicts with what the server decides by.
//
// The client passes its own bodies (three's Vector3 positions), the server the poses of its zone's tick (plain arrays); both
// come from the shared kinematics, so the two agree but for the moment each samples.
import { PULSE_DRIVE } from '../ships/flight.ts';
import { CONDITIONS, type Condition } from '../data/modifiers.ts';
import type { Hazard, WorldType } from '../data/common.ts';
import type { SystemDescription } from '../world/system.ts';

/** A position as plain [x, y, z] or a three.js Vector3. */
export type Vec3Like = readonly [number, number, number] | { readonly x: number; readonly y: number; readonly z: number };

/** A body's pose as either end holds it: only its position is read. */
export interface BodyAt {
  readonly position: Vec3Like;
}

/** Feet this far under the sea put a walker's head under it: today's `Player.headUnderwater` (eye height 1.7 m, less a
 * tenth). */
export const UNDERWATER_DEPTH = 1.6;
/** The habitable band (DESIGN 9.1, Charge) is the shell of space round the star from the home world's orbit divided by this
 * to its orbit times this: about one planet's spacing either side (orbits grow 1.45–1.75× outward), so the Waystation, the
 * home world and its moons are always in it and its neighbours sit on its edges. */
export const HABITABLE_BAND = 1.6;
/** "Near stars" (Solar Kin): within this many of the star's radii, inside every system's innermost orbit. */
export const NEAR_STAR_RADII = 25;
/** The pulse drive burns Charge within this distance of a body's surface or the star (the drive's own rule: inside
 * `openSpeed × cruiseS` of anything it slows for; the client's Ship.pulseLimit). */
export const PULSE_BURN_REACH = PULSE_DRIVE.openSpeed * PULSE_DRIVE.cruiseS;

/** What the meters know of a place. */
export interface MeterEnvironment {
  /** The world whose frame the character is in (a planet or moon; null at the Waystation or in open space). */
  world: WorldType | null;
  /** That world's ship hazard, if it has one. */
  hazards: Hazard[];
  /** Day or night on that world where the character is: the star above or below its horizon; null off a world. */
  time: 'day' | 'night' | null;
  /** On foot with its head under the sea (never under a lava sea: that kills). */
  underwater: boolean;
  /** Nothing (no planet, no moon) stands between the character and its star. */
  sunlight: boolean;
  /** Inside its system's habitable band (HABITABLE_BAND). */
  habitableBand: boolean;
  /** Beyond its system's reach (the description's `outerOrbit`), or between the stars. */
  deepSpace: boolean;
  /** Within NEAR_STAR_RADII of its star. */
  nearStar: boolean;
  /** Where the pulse drive burns Charge (PULSE_BURN_REACH). */
  nearBodies: boolean;
}

/** Where the character is: the frame it is in (a body's index in the description, the Waystation, or the inertial frame),
 * its world position (the system's inertial frame, metres from the star), whether it is on foot, and whether it is known to
 * be between the stars (the client's deep space; the server's deep-space zones). */
export interface MeterPlace {
  frame: number | 'station' | null;
  world: Vec3Like;
  foot?: boolean;
  deepSpace?: boolean;
}

/** Nowhere in particular: no world, no sun, no band. What a character out of any zone (or between saves) is taken to be
 * in, so the meters neither gain nor lose by where it is. */
export const NOWHERE: Readonly<MeterEnvironment> = Object.freeze({
  world: null,
  hazards: [],
  time: null,
  underwater: false,
  sunlight: false,
  habitableBand: false,
  deepSpace: false,
  nearStar: false,
  nearBodies: false,
});

function xyz(p: Vec3Like): [number, number, number] {
  return Array.isArray(p) ? [p[0], p[1], p[2]] : [(p as { x: number }).x, (p as { y: number }).y, (p as { z: number }).z];
}

type EnvSystem = Pick<SystemDescription, 'star' | 'bodies' | 'home' | 'outerOrbit'>;

/**
 * The environment at `place` in the system `d`, its bodies where `bodies` has them (`bodies[i]` is the description's body
 * i at the moment asked about; the star rests at the origin).
 *
 * - Day and night are the frame body's: the star above the horizon of the point's own up. Sunlight is a clear line to
 *   the star: a body between blocks it, and the body underfoot blocks it at night.
 * - Underwater: on foot on a world with a sea of water, the feet UNDERWATER_DEPTH under its sea level (the body's radius).
 */
export function meterEnvironment(d: EnvSystem, bodies: readonly BodyAt[], place: MeterPlace): MeterEnvironment {
  const [x, y, z] = xyz(place.world);
  const r = Math.hypot(x, y, z);
  // the unit direction from the point to the star at the origin
  const sx = r > 0 ? -x / r : 0;
  const sy = r > 0 ? -y / r : 1;
  const sz = r > 0 ? -z / r : 0;
  let sunlight = true;
  let world: WorldType | null = null;
  let hazards: Hazard[] = [];
  let time: MeterEnvironment['time'] = null;
  let underwater = false;
  let nearest = r - d.star.radius;
  for (let i = 0; i < d.bodies.length; i++) {
    const b = d.bodies[i]!;
    const [bx, by, bz] = xyz(bodies[i]!.position);
    // from the point to the body's centre
    const rx = bx - x;
    const ry = by - y;
    const rz = bz - z;
    const dist = Math.hypot(rx, ry, rz);
    nearest = Math.min(nearest, dist - b.radius);
    // how far the body's centre lies toward the star from the point
    const along = rx * sx + ry * sy + rz * sz;
    if (place.frame === i) {
      world = b.type;
      hazards = b.params.hazard ? [b.params.hazard.kind] : [];
      // the point's own up is away from the body's centre: the star is above its horizon when up · toStar > 0
      time = along < 0 ? 'day' : 'night';
      const p = b.params;
      const water = p.type !== 'gas' && p.hasOcean && p.water.emissive === 0;
      underwater = !!place.foot && water && b.radius - dist > UNDERWATER_DEPTH;
    }
    // Under a body's surface (a valley below its radius) the body itself hides the star at night; above it, a body in front
    // of the point and nearer than the star hides it when the line to the star passes within its radius.
    const blocked = dist <= b.radius ? along >= 0 : along > 0 && along < r && dist * dist - along * along < b.radius * b.radius;
    if (blocked) sunlight = false;
  }
  const home = d.bodies[d.home];
  const band = home ? home.orbitRadius : 0;
  const deepSpace = !!place.deepSpace || r > d.outerOrbit;
  return {
    world,
    hazards,
    time,
    underwater,
    sunlight,
    habitableBand: !deepSpace && r >= band / HABITABLE_BAND && r <= band * HABITABLE_BAND,
    deepSpace,
    nearStar: r < d.star.radius * NEAR_STAR_RADII,
    nearBodies: !deepSpace && nearest < PULSE_BURN_REACH,
  };
}

/** Whether one clause of a condition holds in `env`. Clauses that ask what the meters do not know (combat, health, a
 * station's owner, docking) never hold here: those conditions are other systems' to judge. */
function clauseHolds(c: Condition['anyOf'][number], env: MeterEnvironment): boolean {
  if (c.inCombat !== undefined || c.healthBelow !== undefined || c.station !== undefined || c.docked !== undefined) return false;
  if (c.worlds && !(env.world && c.worlds.includes(env.world))) return false;
  if (c.hazards && !env.hazards.some((h) => c.hazards!.includes(h))) return false;
  if (c.time !== undefined && env.time !== c.time) return false;
  if (c.underwater !== undefined && env.underwater !== c.underwater) return false;
  if (c.nearStar !== undefined && env.nearStar !== c.nearStar) return false;
  if (c.sunlight !== undefined && env.sunlight !== c.sunlight) return false;
  if (c.habitableBand !== undefined && env.habitableBand !== c.habitableBand) return false;
  if (c.deepSpace !== undefined && env.deepSpace !== c.deepSpace) return false;
  return true;
}

/** The ids of the conditions (`CONDITIONS`) that hold in `env`: what the heat meter's world modifiers, the Charge regen table
 * and conditional stat modifiers (Solar Kin) are keyed by. */
export function meterConditions(env: MeterEnvironment): ReadonlySet<string> {
  const out = new Set<string>();
  for (const c of CONDITIONS) if (c.anyOf.some((clause) => clauseHolds(clause, env))) out.add(c.id);
  return out;
}
