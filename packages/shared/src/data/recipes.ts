// Crafting (DESIGN 15.7): consumables, modules, cosmetics and the Husk hull, the fabricators that make them, and salvage.
// A range DESIGN gives for a recipe's tier ("2–3") resolves to the tier where its rarest input is common.
import { z } from 'zod';
import { countSchema, deepFreeze, hullIdSchema, idSchema, lookup, table, tierSchema } from './common.ts';
import { resourceIdSchema } from './resources.ts';
import type { ResourceId } from './resources.ts';

export const fabricatorIdSchema = z.enum(['waystation', 'capital', 'sanctuary', 'scrapyard', 'ship']);
export type FabricatorId = z.infer<typeof fabricatorIdSchema>;

export const fabricatorSchema = z.strictObject({
  id: fabricatorIdSchema,
  name: z.string().min(1),
  text: z.string().min(1),
  /** Highest recipe tier it crafts, or null where it crafts a named line instead of a tier band. */
  maxTier: tierSchema.nullable(),
});
export type Fabricator = z.infer<typeof fabricatorSchema>;

export const FABRICATORS = table<Fabricator>([
  { id: 'waystation', name: 'Waystation fabricator', text: 'Tier 1 stations craft Tier 0–2 recipes', maxTier: 2 },
  { id: 'capital', name: 'Capital fabricator', text: 'capitals craft everything up to Tier 3', maxTier: 3 },
  { id: 'sanctuary', name: 'Sanctuary fabricator', text: 'Chorus sanctuaries craft the catalysts', maxTier: null },
  { id: 'scrapyard', name: 'Scrapyard fabricator', text: 'the Scrapyard crafts the Void recipes and assembles the Husk', maxTier: null },
  { id: 'ship', name: 'Ship fabricator', text: 'a small fabricator for ammo and cartridges only, so you can rearm in the field', maxTier: null },
]);

export const recipeSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  line: z.enum(['consumable', 'catalyst', 'module', 'cosmetic', 'endgame']),
  inputs: z.array(z.strictObject({ resource: resourceIdSchema, amount: countSchema })).min(1),
  /** Non-resource inputs (the Hive Heart's core). */
  components: z.array(z.strictObject({ item: idSchema, count: countSchema })),
  output: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('item'), item: idSchema, count: countSchema }),
    z.strictObject({ kind: z.literal('hull'), hull: hullIdSchema }),
  ]),
  tier: tierSchema,
  fabricators: z.array(fabricatorIdSchema.exclude(['ship'])).min(1),
  /** Craftable in the ship's own fabricator, from this system tier up; null if not. */
  field: z.strictObject({ minTier: tierSchema }).nullable(),
  /** How the recipe itself is learned (recipes are items, learned once, kept forever). */
  learnedFrom: z.enum(['vendor', 'faction', 'boss', 'vault']),
  boss: idSchema.optional(),
  notes: z.string().min(1).optional(),
});
export type Recipe = z.infer<typeof recipeSchema>;

const atStations = ['waystation', 'capital'] as const;
const item = (id: string, count = 1) => ({ kind: 'item' as const, item: id, count });
const inputs = (...pairs: [ResourceId, number][]) => pairs.map(([resource, amount]) => ({ resource, amount }));

export const RECIPES = table<Recipe>([
  // consumables
  {
    id: 'warp_cell',
    name: 'Warp cell',
    line: 'consumable',
    inputs: inputs(['dihydrogen', 50], ['tritium', 20], ['cobalt', 5]),
    components: [],
    output: item('warp_cell'),
    tier: 1,
    fabricators: [...atStations],
    field: null,
    learnedFrom: 'vendor',
    notes: "replaces today's 1,800-unit purchase as the normal way to get one",
  },
  {
    id: 'pulse_fuel_cell',
    name: 'Pulse fuel cell',
    line: 'consumable',
    inputs: inputs(['tritium', 30], ['dihydrogen', 10]),
    components: [],
    output: item('pulse_fuel_cell'),
    tier: 0,
    fabricators: [...atStations],
    field: { minTier: 0 },
    learnedFrom: 'vendor',
  },
  {
    id: 'oxygen_cartridge',
    name: 'Oxygen cartridge',
    line: 'consumable',
    inputs: inputs(['oxygen', 20], ['ferrite', 5]),
    components: [],
    output: item('oxygen_cartridge'),
    tier: 0,
    fabricators: [...atStations],
    field: { minTier: 0 },
    learnedFrom: 'vendor',
    notes: 'refills restore 60 instead of 40 (stacks with Cartridge Recycler)',
  },
  {
    id: 'sodium_cartridge',
    name: 'Sodium cartridge',
    line: 'consumable',
    inputs: inputs(['sodium', 20], ['ferrite', 5]),
    components: [],
    output: item('sodium_cartridge'),
    tier: 0,
    fabricators: [...atStations],
    field: { minTier: 0 },
    learnedFrom: 'vendor',
    notes: 'refills restore 60 instead of 40 (stacks with Cartridge Recycler)',
  },
  {
    id: 'flak_ammo',
    name: 'Flak ammo (50)',
    line: 'consumable',
    inputs: inputs(['ferrite', 20], ['carbon', 10]),
    components: [],
    output: item('flak_ammo', 50),
    tier: 0,
    fabricators: [...atStations],
    field: { minTier: 0 },
    learnedFrom: 'vendor',
  },
  {
    id: 'torpedo',
    name: 'Torpedo',
    line: 'consumable',
    inputs: inputs(['cobalt', 5], ['tritium', 5], ['cinderglass', 2]),
    components: [],
    output: item('torpedo'),
    tier: 2,
    fabricators: [...atStations],
    field: { minTier: 2 },
    learnedFrom: 'vendor',
  },
  // catalysts: 30-minute buffs, sanctuary recipes
  {
    id: 'frostglass_catalyst',
    name: 'Frostglass catalyst',
    line: 'catalyst',
    inputs: inputs(['frostglass', 10]),
    components: [],
    output: item('frostglass_catalyst'),
    tier: 2,
    fabricators: ['sanctuary'],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'stormquartz_catalyst',
    name: 'Stormquartz catalyst',
    line: 'catalyst',
    inputs: inputs(['stormquartz', 10]),
    components: [],
    output: item('stormquartz_catalyst'),
    tier: 3,
    fabricators: ['sanctuary'],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'gamma_catalyst',
    name: 'Gamma catalyst',
    line: 'catalyst',
    inputs: inputs(['gamma_crystal', 10]),
    components: [],
    output: item('gamma_catalyst'),
    tier: 4,
    fabricators: ['sanctuary'],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'acidsalt_catalyst',
    name: 'Acidsalt catalyst',
    line: 'catalyst',
    inputs: inputs(['acidsalt', 10]),
    components: [],
    output: item('acidsalt_catalyst'),
    tier: 2,
    fabricators: ['sanctuary'],
    field: null,
    learnedFrom: 'vendor',
  },
  // modules
  {
    id: 'pulse_lasers',
    name: 'Pulse Lasers',
    line: 'module',
    inputs: inputs(['copper', 30], ['ferrite', 20]),
    components: [],
    output: item('pulse_lasers'),
    tier: 1,
    fabricators: [...atStations],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'mining_laser',
    name: 'Mining Laser',
    line: 'module',
    inputs: inputs(['copper', 20], ['ferrite', 20], ['dihydrogen', 10]),
    components: [],
    output: item('mining_laser'),
    tier: 1,
    fabricators: [...atStations],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'flak_cannon',
    name: 'Flak Cannon',
    line: 'module',
    inputs: inputs(['ferrite', 40], ['copper', 20], ['carbon', 10]),
    components: [],
    output: item('flak_cannon'),
    tier: 1,
    fabricators: [...atStations],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'beam_lance',
    name: 'Beam Lance',
    line: 'module',
    inputs: inputs(['gold', 20], ['copper', 20], ['cinderglass', 10]),
    components: [],
    output: item('beam_lance'),
    tier: 2,
    fabricators: [...atStations],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'emp_pod',
    name: 'EMP Pod',
    line: 'module',
    inputs: inputs(['cobalt', 20], ['stormquartz', 10]),
    components: [],
    output: item('emp_pod'),
    tier: 3,
    fabricators: ['capital'],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'railgun',
    name: 'Railgun',
    line: 'module',
    inputs: inputs(['iridium', 20], ['gold', 10], ['stormquartz', 10]),
    components: [],
    output: item('railgun'),
    tier: 3,
    fabricators: ['capital'],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'torpedo_rack',
    name: 'Torpedo Rack',
    line: 'module',
    inputs: inputs(['cobalt', 20], ['cinderglass', 10], ['iridium', 10]),
    components: [],
    output: item('torpedo_rack'),
    tier: 3,
    fabricators: ['capital'],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'thermal_plating_module',
    name: 'Thermal plating',
    line: 'module',
    inputs: inputs(['cinderglass', 30], ['ferrite', 20]),
    components: [],
    output: item('thermal_plating_module'),
    tier: 2,
    fabricators: [...atStations],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'pressure_hull_module',
    name: 'Pressure hull',
    line: 'module',
    inputs: inputs(['murkpearl', 20], ['ferrite', 20]),
    components: [],
    output: item('pressure_hull_module'),
    tier: 4,
    fabricators: ['scrapyard'],
    field: null,
    learnedFrom: 'vendor',
    notes: 'a Tier 4 recipe from a Void-world material (murkpearl, crushing worlds): crafted with the Void recipes at the Scrapyard',
  },
  {
    id: 'hazard_coating_module',
    name: 'Hazard coating',
    line: 'module',
    inputs: inputs(['acidsalt', 30], ['ferrite', 20]),
    components: [],
    output: item('hazard_coating_module'),
    tier: 2,
    fabricators: [...atStations],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'cargo_pod',
    name: 'Cargo pod',
    line: 'module',
    inputs: inputs(['ferrite', 40], ['copper', 10]),
    components: [],
    output: item('cargo_pod'),
    tier: 1,
    fabricators: [...atStations],
    field: null,
    learnedFrom: 'vendor',
  },
  {
    id: 'husk_plating',
    name: 'Husk plating',
    line: 'module',
    inputs: inputs(['husk_alloy', 20], ['count_residue', 10]),
    components: [],
    output: item('husk_plating'),
    tier: 5,
    fabricators: ['scrapyard'],
    field: null,
    learnedFrom: 'boss',
    boss: 'hive_heart',
  },
  // cosmetics and endgame
  {
    id: 'suit_glyph',
    name: 'Suit glyph',
    line: 'cosmetic',
    inputs: inputs(['count_residue', 10]),
    components: [],
    output: item('suit_glyph'),
    tier: 3,
    fabricators: ['capital'],
    field: null,
    learnedFrom: 'boss',
    notes: 'patterns from boss drops',
  },
  {
    id: 'hull_glyph_seams',
    name: 'Hull glyph seams',
    line: 'cosmetic',
    inputs: inputs(['count_residue', 40]),
    components: [],
    output: item('hull_glyph_seams'),
    tier: 3,
    fabricators: ['capital'],
    field: null,
    learnedFrom: 'boss',
    notes: 'patterns from boss drops',
  },
  {
    id: 'husk_hull',
    name: 'Husk hull',
    line: 'endgame',
    inputs: inputs(['husk_alloy', 60], ['glyphstone', 20]),
    components: [{ item: 'hive_heart_core', count: 1 }],
    output: { kind: 'hull', hull: 'husk' },
    tier: 5,
    fabricators: ['scrapyard'],
    field: null,
    learnedFrom: 'boss',
    boss: 'hive_heart',
    notes: "assembled at the Scrapyard from the Hive Heart's core",
  },
]);

export const getRecipe = lookup(RECIPES, 'recipe');

/** Recipe items (DESIGN 15.7: "recipes are items … learned once, kept forever"): the item that teaches a recipe is
 * `recipe_<recipe id>`, one per recipe in the item registry (items.ts). */
export const RECIPE_ITEM_PREFIX = 'recipe_';

/** The item that teaches `recipe`. */
export function recipeItemId(recipe: string): string {
  return `${RECIPE_ITEM_PREFIX}${recipe}`;
}

/** The recipe an item teaches, or null when it is not a recipe item of a recipe this table has. */
export function recipeOfItem(item: string): string | null {
  if (!item.startsWith(RECIPE_ITEM_PREFIX)) return null;
  const id = item.slice(RECIPE_ITEM_PREFIX.length);
  return RECIPES.some((r) => r.id === id) ? id : null;
}

/** Salvage (DESIGN 15.7): any module breaks down at a fabricator into a third of its materials, rounded down. */
export const SALVAGE = deepFreeze({ divisor: 3, lines: ['module'] as const });

/** What salvaging one of this recipe's outputs returns; empty for anything that is not a module. */
export function salvageYield(recipe: Recipe): { resource: ResourceId; amount: number }[] {
  if (recipe.line !== 'module') return [];
  return recipe.inputs.map((i) => ({ resource: i.resource, amount: Math.floor(i.amount / SALVAGE.divisor) })).filter((i) => i.amount > 0);
}
