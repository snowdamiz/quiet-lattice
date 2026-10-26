// A ship as the server keeps it (DESIGN 10.1): a hull from the roster, the modules fitted to its hardpoints, the cargo pods
// it carries and its livery. Plain JSON checked by zod, so it travels in protocol messages and sits in a Postgres JSON column
// as it is. Everything it implies (speeds, health, signature, slots) is computed from the data tables by `shipStats`.
import { z } from 'zod';
import { WEAPON_SIZES, hullIdSchema, idSchema } from '../data/common.ts';
import type { HullId, WeaponSize } from '../data/common.ts';
import { getHull } from '../data/hulls.ts';

/** Liveries each hull ships with (DESIGN 19.3: "13 hulls, each with 3 liveries"). */
export const LIVERIES_PER_HULL = 3;

/** A hardpoint: its size letter and its number among the hull's hardpoints of that size, a Kestrel's 2S 1M being `s1`, `s2`
 * and `m1`. `hardpointMarkers` says which of a model's markers each one is. */
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

const MARKER = /^HP_([SML])_(.+)$/i;
const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Which of a hull model's markers each hardpoint is. The art bible (P1.E14.T01) names hardpoint empties `HP_S_*`, `HP_M_*`
 * and `HP_L_*` with any suffix, prefix in any case (`HP_S_nose`, `hp_m_2`). Per size, the markers sorted by name (letters
 * without regard to case, digit runs as numbers: `HP_S_2` before `HP_S_10`; exact ties by code point) are that size's
 * hardpoints in order: `s1`, `s2`, … Other nodes are ignored. Throws when the model's count of a size differs from the hull's.
 */
export function hardpointMarkers(hull: HullId, nodeNames: Iterable<string>): Map<string, string> {
  const bySize: Record<WeaponSize, string[]> = { S: [], M: [], L: [] };
  for (const name of nodeNames) {
    const m = MARKER.exec(name);
    if (m) bySize[m[1].toUpperCase() as WeaponSize].push(name);
  }
  const out = new Map<string, string>();
  for (const size of WEAPON_SIZES) {
    const want = hardpointsOf(hull).filter((h) => h.size === size).length;
    const names = bySize[size].sort((a, b) => byName.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
    if (names.length !== want) throw new Error(`${hull} has ${want} ${size} hardpoints but its model marks ${names.length}: ${names.join(', ')}`);
    names.forEach((name, i) => out.set(`${size.toLowerCase()}${i + 1}`, name));
  }
  return out;
}

/** Whether a weapon of one size fits a hardpoint of another: its own size or larger, never smaller. */
export function fitsHardpoint(weapon: WeaponSize, hardpoint: WeaponSize): boolean {
  return WEAPON_SIZES.indexOf(weapon) <= WEAPON_SIZES.indexOf(hardpoint);
}
