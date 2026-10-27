// What a ship's surroundings mean for how it may fly (P1.E03.T04): how thick the air is where it is, and how far it is clear
// of everything the pulse drive slows for. Today's client computes both in its Ship (computeEnvironment, pulseLimit); these
// are the same rules on plain data (a SystemDescription and the poses of its bodies at a time), so the server reaches the
// same numbers from a pose.
import type { BodySpec, SystemDescription } from '../world/system.ts';
import type { SystemPoses, Vec3 } from '../world/kinematics.ts';
import type { PlanetParams } from '../world/planetgen.ts';

/** A landed ship's centre sits this far above the ground (its gear), m; flying, the ground pushes it out at 0.6 of it. */
export const SHIP_GEAR_HEIGHT = 1.95;

/** The air, as the flight model reads it. */
export const AIR = {
  /** Below this density the ship flies its space model alone; from it the air model blends in (`atmo` caps). */
  flightModelFrom: 0.004,
  /** The pulse drive will not run in air thicker than this. */
  pulseCeiling: 0.001,
  /** A rocky world's air thins as exp(−falloff·h)·(1 − h), h being the height over its sea through the air's depth. */
  falloff: 4,
  /** A gas giant's air is its cloud deck: everything below this fraction of its radius over its surface. */
  gasDeck: 0.05,
} as const;

type AirBody = Pick<BodySpec, 'radius' | 'type'> & { params: { atmosphere: { height: number } | null } };

/** How thick a world's air is at `seaAltitude` metres over its sea level (0 outside it). */
export function airDensity(body: AirBody, seaAltitude: number): number {
  if (body.type === 'gas') return seaAltitude < body.radius * AIR.gasDeck ? 1 : 0;
  const a = body.params.atmosphere;
  if (!a) return 0;
  // (as the client: the air's top as a fraction of the radius, then back to metres)
  const H = (1 + a.height / body.radius - 1) * body.radius;
  const h = Math.max(0, seaAltitude) / H;
  return h < 1 ? Math.exp(-h * AIR.falloff) * (1 - h) : 0;
}

/** What the pulse drive keeps clear of (the client's Ship.pulseLimit). */
export const PULSE_CLEAR = {
  /** A star: this many of its radii. */
  starRadii: 3,
  /** A world without air: this far over its highest terrain. */
  terrainM: 2500,
  /** A world with a hazardous layer: this many times the layer's ceiling over its surface. */
  hazardFactor: 1.3,
  /** The Waystation: this far from its centre. */
  stationM: 3000,
} as const;

/** The client's reckoning of a rocky world's highest terrain over its sea (Planet.maxTerrain); 0 for a gas giant. It is an
 * estimate (volcanoes and landforms can top it), used only where the client uses it: the pulse drive's clearance. */
export function terrainReach(params: BodySpec['params']): number {
  if (params.type === 'gas') return 0;
  const p = params as PlanetParams;
  return p.mountainHeight + p.landHeight * 2.5 + p.hillHeight + 50;
}

/** How far from a body's centre the pulse drive's clearance is measured: its air's top, else its terrain plus a margin, and
 * never inside a hazardous layer. */
export function pulseClearRadius(body: Pick<BodySpec, 'radius' | 'params'>): number {
  const { radius, params } = body;
  const a = params.atmosphere;
  let clear = a ? radius * (1 + a.height / radius) : radius + terrainReach(params) + PULSE_CLEAR.terrainM;
  if (params.hazard) clear = Math.max(clear, radius + params.hazard.ceiling * PULSE_CLEAR.hazardFactor);
  return clear;
}

export interface PulseClearance {
  /** To the nearest of the star, the bodies and the Waystation, m (what the drive's speed limit reads). */
  min: number;
  /** The same, counting the Waystation only when the ship is heading for it (what engaging and dropping out read). */
  ahead: number;
}

const clearRadii = new WeakMap<SystemDescription, number[]>();

/**
 * The pulse drive's clearance at world position `world` (the system's inertial frame), with the system's bodies where
 * `poses` has them: the distance to the nearest star's, body's or the Waystation's clear sphere. `forward` is the ship's
 * nose as a world direction; without it the Waystation counts as ahead. Unlike the client, other stars, galaxies and the
 * Edge are not counted: inside a system its star is always nearer.
 */
export function pulseClearance(d: SystemDescription, poses: SystemPoses, world: Readonly<Vec3>, forward?: Readonly<Vec3>): PulseClearance {
  let radii = clearRadii.get(d);
  if (!radii) clearRadii.set(d, (radii = d.bodies.map(pulseClearRadius)));
  const dist = (p: Readonly<Vec3>) => Math.hypot(world[0] - p[0], world[1] - p[1], world[2] - p[2]);
  let min = dist(poses.star.position) - d.star.radius * PULSE_CLEAR.starRadii;
  for (let i = 0; i < d.bodies.length; i++) min = Math.min(min, dist(poses.bodies[i]!.position) - radii[i]!);
  let ahead = min;
  const s = poses.station.position;
  const station = dist(s) - PULSE_CLEAR.stationM;
  min = Math.min(min, station);
  const toward = !forward || (s[0] - world[0]) * forward[0] + (s[1] - world[1]) * forward[1] + (s[2] - world[2]) * forward[2] > 0;
  if (toward) ahead = Math.min(ahead, station);
  return { min, ahead };
}
