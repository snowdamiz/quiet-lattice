// Where an event runs (ARCHITECTURE §25): a spot on dry, open ground of the system's first world that carries the event's
// enemies at the zone's tier, drawn afresh for each window from the system's seed, the event and the window, so a restart
// finds the same spot. The place is a sphere round that spot in the world's frame (it turns with the world); its phase
// location's key is the event's name, which the call-for-aid listing shows as the place (§21).
import type { EventDef } from '@astra/shared/events';
import { frameId, type FaunaSpecies, type PlanetParams, type Random } from '@astra/shared/world';
import type { Vec3 } from '../fauna/cells.ts';
import { tangents } from '../fauna/herds.ts';
import type { Ground, GroundSource } from '../fauna/terrain.ts';
import type { PhaseLocation } from '../phases/manager.ts';
import type { Zone } from '../zones/zone.ts';

/** Directions tried for an open spot before settling for a merely dry one. */
const TRIES = 256;
/** A spot is dry ground at least this high over the sea, m, and so is the ground round it. */
const DRY_M = 4;
/** The ground round an open spot (at a third of the place's radius, four ways) differs from it by at most this, m. */
const OPEN_M = 40;

/** An event's place, resolved in a zone. */
export interface EventPlace {
  /** the world: its body index in the system, and its frame */
  body: number;
  frame: string;
  /** the spot: a unit direction from the world's centre, and the point on its ground there (the place's centre) */
  dir: Vec3;
  center: Vec3;
  radius: number;
  /** the world's radius (its sea level), m */
  worldRadius: number;
  /** what the phase manager opens the event's instances at */
  location: PhaseLocation;
}

/** What place resolution needs of a zone. */
export type PlaceZone = Pick<Zone, 'system' | 'fauna'>;

/** The species of a world an event may send: its own of the event's temperaments, at the zone's tier. */
export function enemySpecies(zone: PlaceZone, body: number, def: Pick<EventDef, 'enemies'>): FaunaSpecies[] {
  const temperaments: readonly string[] = def.enemies.temperaments;
  return (zone.fauna?.speciesOf(body) ?? []).filter((sp) => temperaments.includes(sp.temperament));
}

/**
 * The event's place in the zone: 'busy' while the world's ground is being planned (asking starts it), null when no world
 * of the system carries its enemies or has dry ground (it cannot run there).
 */
export function resolvePlace(zone: PlaceZone, def: Pick<EventDef, 'name' | 'place' | 'enemies'>, rng: Random): EventPlace | 'busy' | null {
  const fauna = zone.fauna;
  if (!fauna) return null;
  const grounds: GroundSource = fauna.grounds;
  for (const body of zone.system.bodies) {
    if (body.type === 'gas' || !enemySpecies(zone, body.index, def).length) continue;
    const ground = grounds.ground(body.params as PlanetParams, fauna.tier);
    if (!ground) return 'busy';
    const dir = openSpot(ground, def.place.radius, rng);
    if (!dir) continue;
    const r = ground.radius + Math.max(0, ground.sample(dir));
    const center: Vec3 = [dir[0] * r, dir[1] * r, dir[2] * r];
    const frame = frameId(zone.system.seed, body.index)!;
    const radius = def.place.radius;
    return { body: body.index, frame, dir, center, radius, worldRadius: ground.radius, location: { key: def.name, frame, center, radius } };
  }
  return null;
}

/** A direction to dry, open ground (or, failing that, any dry ground) drawn from `rng`; null on a world with none found. */
function openSpot(ground: Ground, radius: number, rng: Random): Vec3 | null {
  let dry: Vec3 | null = null;
  const d = Math.min(radius / 3, 400);
  for (let i = 0; i < TRIES; i++) {
    const z = rng.float(-1, 1);
    const a = rng.float(0, Math.PI * 2);
    const s = Math.sqrt(1 - z * z);
    const dir: Vec3 = [Math.cos(a) * s, z, Math.sin(a) * s];
    const h = ground.sample(dir);
    if (h < DRY_M) continue;
    dry ??= dir;
    const [t, b] = tangents(dir);
    let open = true;
    for (const [e, n] of [
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
    ] as const) {
      const p: Vec3 = [
        dir[0] * ground.radius + t[0] * e + b[0] * n,
        dir[1] * ground.radius + t[1] * e + b[1] * n,
        dir[2] * ground.radius + t[2] * e + b[2] * n,
      ];
      const hp = ground.sample(p);
      if (hp < DRY_M || Math.abs(hp - h) > OPEN_M) open = false;
    }
    if (open) return dir;
  }
  return dry;
}

/** A direction `east` and `north` metres along the ground from a spot (unit direction) on a world of `radius`. */
export function along(dir: Readonly<Vec3>, east: number, north: number, radius: number): Vec3 {
  const [t, b] = tangents(dir);
  const x = dir[0] * radius + t[0] * east + b[0] * north;
  const y = dir[1] * radius + t[1] * east + b[1] * north;
  const z = dir[2] * radius + t[2] * east + b[2] * north;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
