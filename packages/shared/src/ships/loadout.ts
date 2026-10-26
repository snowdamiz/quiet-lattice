// A ship as the server keeps it (DESIGN 10.1): a hull from the roster, the modules fitted to its hardpoints, the cargo pods
// it carries and its livery. Plain JSON checked by zod, so it travels in protocol messages and sits in a Postgres JSON column
// as it is. Everything it implies (speeds, health, signature, slots) is computed from the data tables by `shipStats`.
import { z } from 'zod';
import { WEAPON_SIZES, hullIdSchema, idSchema } from '../data/common.ts';
import type { HullId, WeaponSize } from '../data/common.ts';
import { getHull } from '../data/hulls.ts';

/** Liveries each hull ships with (DESIGN 19.3: "13 hulls, each with 3 liveries"). */
export const LIVERIES_PER_HULL = 3;

/** A hardpoint: its size and its number among the hull's hardpoints of that size, as the model's `HP_<size>_<n>` markers name
 * them (P1.E14.T01): a Kestrel's 2S 1M are `s1`, `s2` and `m1`. */
export const hardpointIdSchema = z.string().regex(/^[sml][1-9]$/, 'hardpoint ids are a size letter and a number: s1, m2');

export const shipLoadoutSchema = z.strictObject({
  hull: hullIdSchema,
  /** The module item fitted to each hardpoint, by hardpoint id. An empty hardpoint has no entry. */
  modules: z.record(hardpointIdSchema, idSchema.max(64)),
  /** Cargo pods aboard. The hull (and Pack Mule) give the bays (`ShipStats.cargoPods`); the pods drop where the ship dies. */
  cargoPods: z.int().nonnegative(),
  /** Which of the hull's liveries it wears. */
  livery: z.int().nonnegative().lt(LIVERIES_PER_HULL),
});
export type ShipLoadout = z.infer<typeof shipLoadoutSchema>;

export interface Hardpoint {
  id: string;
  size: WeaponSize;
}

/** A hull's hardpoints in the roster's order, with their ids. */
export function hardpointsOf(hull: HullId): Hardpoint[] {
  const count: Record<WeaponSize, number> = { S: 0, M: 0, L: 0 };
  return getHull(hull).hardpoints.map((size) => ({ id: `${size.toLowerCase()}${++count[size]}`, size }));
}

/** Whether a weapon of one size fits a hardpoint of another: its own size or larger, never smaller. */
export function fitsHardpoint(weapon: WeaponSize, hardpoint: WeaponSize): boolean {
  return WEAPON_SIZES.indexOf(weapon) <= WEAPON_SIZES.indexOf(hardpoint);
}
