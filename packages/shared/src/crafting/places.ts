// Where the fabricators of places stand (DESIGN 15.7; P2.E20.T01). A place's fabricator is data plus a rule keyed to the
// place's id: its terminal is a point in a frame and a reach around it, and which fabricator it is follows from the id.
// The Waystation's terminal exists (data/station.ts); the capitals' (P1.E10.T02), the sanctuaries' and the Scrapyard's
// (P1.E11.T05) are registered with the server by the task that places them, with no change to the crafting rules.
import { z } from 'zod';
import { STATION_FABRICATOR, STATION_LAYOUT } from '../data/station.ts';
import type { PlaceFabricatorKind } from './index.ts';

/**
 * A place's id and what it is: `waystation` (the zone's own station), `capital:<city>`, `sanctuary:<name>` or `scrapyard`.
 * The prefix names the fabricator class the place has.
 */
export const placeIdSchema = z
  .string()
  .max(64)
  .regex(/^(waystation|scrapyard|(capital|sanctuary):[a-z0-9][a-z0-9_-]*)$/);

/** The fabricator a place id has, or null for an id of no place kind. */
export function fabricatorOfPlace(placeId: string): PlaceFabricatorKind | null {
  if (!placeIdSchema.safeParse(placeId).success) return null;
  return placeId.split(':')[0] as PlaceFabricatorKind;
}

export interface FabricatorPlace {
  /** the place's id (`placeIdSchema`) */
  id: string;
  /** which fabricator the terminal is: always the one the id names */
  fabricator: PlaceFabricatorKind;
  /** the frame the terminal stands in (a body's, the station's) */
  frame: string;
  /** where a user stands, m in that frame */
  use: readonly [number, number, number];
  /** how far from `use` the server lets a walker work it, m */
  reachM: number;
  /** how far from `use` a ship docked at the place can use it without leaving the ship, m (a Waystation's pads), or null where
   * only a walker can */
  dockedReachM: number | null;
}

/** A place with its fabricator named from its id; throws for an id of no place kind. */
export function fabricatorPlace(id: string, spot: Omit<FabricatorPlace, 'id' | 'fabricator'>): FabricatorPlace {
  const fabricator = fabricatorOfPlace(id);
  if (!fabricator) throw new RangeError(`${id} is not a place id`);
  return { ...spot, id, fabricator };
}

/** The Waystation of the system whose seed this is: its terminal on the trade deck, and its pads. */
export function waystationPlace(systemSeed: number | string): FabricatorPlace {
  const u = STATION_FABRICATOR.use;
  // a docked ship sits on one of the pads, as far from the terminal as the farthest pad's edge
  const dockedReachM = Math.ceil(Math.max(...STATION_LAYOUT.pads.map((p) => Math.hypot(p.x - u.x, p.z - u.z))) + STATION_LAYOUT.padRadius);
  return fabricatorPlace('waystation', { frame: `${systemSeed}:station`, use: [u.x, u.y, u.z], reachM: STATION_FABRICATOR.reachM, dockedReachM });
}
