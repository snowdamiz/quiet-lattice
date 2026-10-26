// Primitives every data table shares: ids, tiers, world types, hazards, the skill branches, the peoples and the factions.
// Sets that are small and fixed by DESIGN are zod enums, so a misspelt reference fails the type check as well as the data suite.
import { z } from 'zod';

/** Every table id: lower snake_case, starting with a letter. */
export const idSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'ids are lower snake_case');

/** System tier, DESIGN 11: 0 (home systems) to 5 (Edge-ward). */
export const tierSchema = z.int().min(0).max(5);
export type Tier = z.infer<typeof tierSchema>;

/** A tier band, inclusive at both ends ("Tier 1–2"; "3+" is 3–5). */
export const tierRangeSchema = z.strictObject({ min: tierSchema, max: tierSchema }).refine((r) => r.min <= r.max, 'tier range min > max');
export type TierRange = z.infer<typeof tierRangeSchema>;

/** Planet archetypes, using the world generator's own `type` ids: DESIGN's "exotic" is `alien`, a gas giant is `gas`. */
export const WORLD_TYPES = [
  'lush',
  'alien',
  'desert',
  'frozen',
  'toxic',
  'volcanic',
  'barren',
  'gas',
  'dead',
  'irradiated',
  'inferno',
  'storm',
  'corrosive',
  'crushing',
] as const;
export const worldTypeSchema = z.enum(WORLD_TYPES);
export type WorldType = z.infer<typeof worldTypeSchema>;

/** Worlds the species generator populates (DESIGN 1, 12.2); the others are lifeless (12.4) or have no surface (gas). */
export const LIVING_WORLDS: readonly WorldType[] = ['lush', 'alien', 'desert', 'frozen', 'toxic', 'volcanic', 'storm'];
/** The hostile archetypes with their own horrors (DESIGN 12.4), plus barren rock. */
export const LIFELESS_WORLDS: readonly WorldType[] = ['barren', 'dead', 'irradiated', 'inferno', 'corrosive', 'crushing'];
/** "Hot worlds" (Solar Kin, Heat Shroud, the heat meter's daylight penalty). */
export const HOT_WORLDS: readonly WorldType[] = ['desert', 'volcanic', 'inferno'];

/** Ship hazards (DESIGN 1), as the world generator names them. */
export const HAZARDS = ['heat', 'cryo', 'pressure', 'acid', 'radiation', 'storm'] as const;
export const hazardSchema = z.enum(HAZARDS);
export type Hazard = z.infer<typeof hazardSchema>;

/** The seven branches of the skill web (DESIGN 9). */
export const BRANCHES = ['gravitic', 'thermal', 'resonance', 'symbiotic', 'void', 'pilot', 'exosuit'] as const;
export const branchSchema = z.enum(BRANCHES);
export type Branch = z.infer<typeof branchSchema>;

/** The playable peoples (DESIGN 5). */
export const PEOPLE_IDS = ['thalune', 'ixari', 'ulgani'] as const;
export const peopleIdSchema = z.enum(PEOPLE_IDS);
export type PeopleId = z.infer<typeof peopleIdSchema>;

/** The three capitals, each also a faction (DESIGN 14.4). */
export const CAPITAL_IDS = ['sarelun', 'quavel', 'belost'] as const;
export const capitalIdSchema = z.enum(CAPITAL_IDS);
export type CapitalId = z.infer<typeof capitalIdSchema>;

/** Factions with reputation (DESIGN 4, 14.4). */
export const FACTION_IDS = ['compact', 'reaches', 'chorus', ...CAPITAL_IDS] as const;
export const factionIdSchema = z.enum(FACTION_IDS);
export type FactionId = z.infer<typeof factionIdSchema>;

/** Hull ids (DESIGN 10.2). */
export const HULL_IDS = [
  'lark',
  'swift',
  'kestrel',
  'mule',
  'dart',
  'wayfarer',
  'bulwark',
  'caravel',
  'ghost',
  'listener',
  'warden_breaker',
  'longhaul',
  'husk',
] as const;
export const hullIdSchema = z.enum(HULL_IDS);
export type HullId = z.infer<typeof hullIdSchema>;

/** Weapon module ids (DESIGN 10.3). */
export const WEAPON_IDS = ['pulse_lasers', 'mining_laser', 'tractor_mount', 'beam_lance', 'flak_cannon', 'emp_pod', 'railgun', 'torpedo_rack'] as const;
export const weaponIdSchema = z.enum(WEAPON_IDS);
export type WeaponId = z.infer<typeof weaponIdSchema>;

/** Hardpoint and weapon sizes. */
export const WEAPON_SIZES = ['S', 'M', 'L'] as const;
export const weaponSizeSchema = z.enum(WEAPON_SIZES);
export type WeaponSize = z.infer<typeof weaponSizeSchema>;

/** Story chapters are numbered 1–26 (DESIGN 8). */
export const chapterSchema = z.int().min(1).max(26);

/** A positive whole amount. */
export const countSchema = z.int().positive();

/** Deep-freezes a value in place and returns it, so tables cannot be mutated by their consumers. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Freezes a table's rows. */
export function table<T extends { id: string }>(rows: T[]): readonly T[] {
  return deepFreeze(rows);
}

/** A by-id index of a table. */
export function indexById<T extends { id: string }>(rows: readonly T[]): ReadonlyMap<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** A lookup that throws on an unknown id, naming the table. */
export function lookup<T extends { id: string }>(rows: readonly T[], label: string): (id: string) => T {
  const byId = indexById(rows);
  return (id: string) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Unknown ${label}: ${id}`);
    return row;
  };
}
