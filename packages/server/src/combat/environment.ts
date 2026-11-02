// Ship hazards read only the zone's accepted pose and its deterministic world. Ground comes from the existing worker
// planner, never a synchronous plan in the tick. Until ready, only the ground-dependent sky exposure waits.
import { airDensity, hazardDepth, reentryIntensity, SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import { STATION_LAYOUT } from '@astra/shared/data';
import { frameKeyOf, type Hazard, type SystemDescription } from '@astra/shared/world';
import type { GroundSource } from '../fauna/terrain.ts';
import type { EntityInit } from '../zones/zone.ts';
import { MOVEMENT } from '../sim/movement/rules.ts';

export interface ShipExposure {
  sky: { hazard: Hazard; depth: number } | null;
  docked: boolean;
  /** Still at a pad, even if the client toggles its mode; service rearms only once it actually leaves. */
  atPad: boolean;
}

/** Both altitude conventions match Ship.computeEnvironment: over terrain/sea minus gear height on rocky worlds, over
 * the cloud deck's radius on gas giants. Mode and frame have already passed movement authority. */
export function shipExposure(system: SystemDescription, fields: EntityInit, grounds: GroundSource, tier: number): ShipExposure {
  const key = frameKeyOf(system, fields.frame);
  const gear = fields.pos[1] - STATION_LAYOUT.padTop - SHIP_GEAR_HEIGHT;
  const atPad =
    key === 'station' &&
    gear >= -MOVEMENT.docked.belowM &&
    gear <= MOVEMENT.docked.aboveM &&
    STATION_LAYOUT.pads.some((pad) => Math.hypot(fields.pos[0] - pad.x, fields.pos[2] - pad.z) <= STATION_LAYOUT.padRadius);
  const docked = atPad && fields.mode === 'docked' && Math.hypot(...fields.vel) <= 1;
  const out: ShipExposure = { sky: null, docked, atPad };
  if (fields.mode === 'foot' || typeof key !== 'number') return out;
  const body = system.bodies[key]!;
  const params = body.params;
  const [x, y, z] = fields.pos;
  const radius = Math.hypot(x, y, z);
  const seaAltitude = radius - body.radius;
  if (!params.hazard) return out;
  let altitude = seaAltitude;
  if (params.type !== 'gas') {
    const ground = grounds.ground(params, tier);
    if (!ground || radius <= 0) return out;
    const height = ground.sample(fields.pos);
    altitude -= (params.hasOcean ? Math.max(0, height) : height) + SHIP_GEAR_HEIGHT;
  }
  out.sky = { hazard: params.hazard, depth: hazardDepth(params.hazard, altitude) };
  return out;
}

/** Re-entry intensity from authority-measured motion, never the client's reported velocity. A fixed authoritative pose
 * has no new motion, so silence accrues no re-entry damage (hostile skies still do). */
export function shipReentry(system: SystemDescription, fields: EntityInit, vel: readonly [number, number, number]): number {
  const key = frameKeyOf(system, fields.frame);
  if (fields.mode !== 'ship' || typeof key !== 'number') return 0;
  const body = system.bodies[key]!;
  if (body.params.type === 'gas') return 0;
  const [x, y, z] = fields.pos;
  const [vx, vy, vz] = vel;
  const radius = Math.hypot(x, y, z);
  const speed = Math.hypot(vx, vy, vz);
  const sink = radius > 0 && speed > 1 ? -(x * vx + y * vy + z * vz) / radius / speed : 0;
  return reentryIntensity(airDensity(body, radius - body.radius), speed, sink);
}
