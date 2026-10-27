// The Waystation's hangar (DESIGN 4, "Station": a hangar with 4 pads), in the station's frame: metres, +y away from its
// world (the floor's up), the hangar's mouth open toward +z. The client's box-built station (universe/Station.js) builds its
// hangar shell and pads from these, and the server's movement authority (P1.E03.T04) keeps ships and walkers out of the
// shell's walls and docks ships on the pads.
//
// The rest of the station (the trade deck, the spine, rings, habitat pods, towers, the keel, props and the seeded hull
// greebles) is still laid out by the client alone; P1.E11.T02 (the station built from kits, with colliders from `COL_`
// meshes) moves the whole layout to shared, after which the server can hold ships to all of it.
import { z } from 'zod';
import { deepFreeze } from './common.ts';

const box = z
  .strictObject({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number(), z0: z.number(), z1: z.number() })
  .refine((b) => b.x0 < b.x1 && b.y0 < b.y1 && b.z0 < b.z1, 'a box runs from its low corner to its high one');
export type StationBox = z.infer<typeof box>;

export const stationLayoutSchema = z.strictObject({
  /** The hangar's open interior: floor (top) at y0, ceiling (underside) at y1, back wall at z0, the mouth at z1. */
  hangar: box,
  /** The thinnest solid around the interior: the floor is 4 m thick, the walls and ceiling 5 m, with armour beyond. */
  shellM: z.number().positive(),
  /** Landing pads: centres on the floor, the height of their tops, and their radius. */
  pads: z.array(z.strictObject({ x: z.number(), z: z.number() })).length(4),
  padTop: z.number().nonnegative(),
  padRadius: z.number().positive(),
});
export type StationLayout = z.infer<typeof stationLayoutSchema>;

export const STATION_LAYOUT: StationLayout = deepFreeze({
  hangar: { x0: -65, x1: 65, y0: 0, y1: 42, z0: -90, z1: 60 },
  shellM: 4,
  pads: [
    { x: -30, z: -22 },
    { x: 30, z: -22 },
    { x: -30, z: 22 },
    { x: 30, z: 22 },
  ],
  padTop: 0.45,
  padRadius: 12,
});

/** The hangar's interior bounds (the client's `HANGAR`). */
export const STATION_HANGAR: StationBox = STATION_LAYOUT.hangar;
