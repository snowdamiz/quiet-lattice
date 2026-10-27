// Crafting (`@astra/shared/crafting`, DESIGN 15.7; P1.E13.T05; ARCHITECTURE §23): what a character knows, which
// fabricator makes what, and a craft as one all-or-nothing change to an inventory. The server decides every craft with
// these rules (its crafting service adds where the player is and how often it asks); the client reads them to show what
// it can make, and the dev sandbox crafts with them offline.
//
// Recipes are items (data/items.ts: `recipe_<id>`): using one teaches its recipe for good, and what a character knows
// is kept by persistence (the `recipes` component). There is no crafting skill tree: the gate is recipes and materials.
import { z } from 'zod';
import { FABRICATORS, getItem, RECIPES, recipeItemId, type Recipe } from '../data/index.ts';
import { addItem, countOf, itemInfo, takeItem, type Inventory } from '../inventory/index.ts';

/** The fabricators Phase 1 has: a Waystation's (its terminal on the trade deck, or docked there) and the ship's own. */
export const FABRICATOR_KINDS = ['station', 'ship'] as const;
export const fabricatorKindSchema = z.enum(FABRICATOR_KINDS);
export type FabricatorKind = z.infer<typeof fabricatorKindSchema>;

/** The most crafts one request makes (a stack of 50 warp cells is 2,500 di-hydrogen already). */
export const CRAFT_MAX = 100;
/** The most recipes a character can know: every recipe there is, with room for the table to grow. */
export const KNOWN_MAX = 256;

/**
 * The recipes a new character knows (a choice, DECISIONS P1.E13.T05): Phase 1's consumables, so the warp cell that
 * replaces the demo's 1,800-unit purchase is craftable from the first Waystation. Every other recipe is learned from its
 * item; vendors, chains, drops and vaults hand those out (P2.E20.T01).
 */
export const STARTING_RECIPES: readonly string[] = Object.freeze(['warp_cell', 'pulse_fuel_cell', 'oxygen_cartridge', 'sodium_cartridge', 'flak_ammo']);

/** A recipe's id on the wire: a table id's shape, bounded; one the table lacks is answered `unknown`, not dropped. */
export const recipeIdSchema = z
  .string()
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/);

/** What a character knows (the `recipes` component, v1): recipe ids, each once. */
export const knownRecipesSchema = z.strictObject({
  known: z
    .array(recipeIdSchema)
    .max(KNOWN_MAX)
    .refine((ids) => new Set(ids).size === ids.length, 'a recipe is known once'),
});
export type KnownRecipes = z.infer<typeof knownRecipesSchema>;

/** A new character's knowledge. */
export function startingKnowledge(): KnownRecipes {
  return { known: [...STARTING_RECIPES] };
}

/**
 * What a client asks of a fabricator (ARCHITECTURE §23): `make` `count` crafts of `recipe` at the fabricator `at` (the
 * station's or the ship's); or `learn` a recipe from its item, which is used up.
 */
export const craftOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('make'), recipe: recipeIdSchema, count: z.int().min(1).max(CRAFT_MAX), at: fabricatorKindSchema }),
  z.strictObject({ op: z.literal('learn'), recipe: recipeIdSchema }),
]);
export type CraftOp = z.infer<typeof craftOpSchema>;

/**
 * Why a craft or a lesson did nothing: `stale_seq` (its number is not above the last), `rate` (asked too fast), `zone`
 * (the character is not in play), `unknown` (no such recipe), `not_known` (the character has not learned it), `known`
 * (learning one it knows: the item is kept), `no_item` (learning without the recipe's item), `place` (not at that
 * fabricator: a station's needs the player docked at the Waystation or at its fabricator terminal; the ship's, the
 * player aboard or beside its ship), `fabricator` (that fabricator cannot make it: the ship's makes ammo and cartridges
 * only, a Waystation's Tier 0–2 recipes of its line), `materials` (not enough in the suit and cargo), `no_room` (what it
 * makes would not fit: nothing is used up).
 */
export const CRAFT_REFUSALS = ['stale_seq', 'rate', 'zone', 'unknown', 'not_known', 'known', 'no_item', 'place', 'fabricator', 'materials', 'no_room'] as const;
export const craftRefusalSchema = z.enum(CRAFT_REFUSALS);
export type CraftRefusal = z.infer<typeof craftRefusalSchema>;

const byId: ReadonlyMap<string, Recipe> = new Map(RECIPES.map((r) => [r.id, r]));

/** A recipe by id, or undefined for one the table lacks. */
export function recipeById(id: string): Recipe | undefined {
  return byId.get(id);
}

/** The item a recipe makes and how many one craft makes, or null for a recipe that assembles a hull. */
export function outputOf(recipe: Recipe): { item: string; count: number } | null {
  return recipe.output.kind === 'item' ? { item: recipe.output.item, count: recipe.output.count } : null;
}

/** The tier band a Waystation's fabricator crafts (DESIGN 15.7: "Tier 1 stations craft Tier 0–2 recipes"). */
export const STATION_MAX_TIER: number = FABRICATORS.find((f) => f.id === 'waystation')!.maxTier!;

/**
 * Whether a fabricator makes a recipe, in a system of tier `tier`: a Waystation's makes the item recipes of its line up
 * to its tier band; the ship's only the field-craftable ones (ammo and cartridges, DESIGN 15.7), each from its system
 * tier (torpedoes from Tier 2). Neither assembles a hull.
 */
export function makesAt(recipe: Recipe, at: FabricatorKind, tier: number): boolean {
  if (!outputOf(recipe)) return false;
  if (at === 'ship') return recipe.field !== null && tier >= recipe.field.minTier;
  return recipe.fabricators.includes('waystation') && recipe.tier <= STATION_MAX_TIER;
}

/** What `count` crafts use up: each input resource and component times `count`. */
export function materialsOf(recipe: Recipe, count = 1): { item: string; count: number }[] {
  return [
    ...recipe.inputs.map((i) => ({ item: i.resource, count: i.amount * count })),
    ...recipe.components.map((c) => ({ item: c.item, count: c.count * count })),
  ];
}

/** How many crafts of a recipe the suit and cargo together hold the materials for, at most CRAFT_MAX. */
export function craftableCount(inv: Inventory, recipe: Recipe): number {
  let n = CRAFT_MAX;
  for (const m of materialsOf(recipe)) n = Math.min(n, Math.floor(countOf(inv, m.item) / m.count));
  return n;
}

export type CraftOutcome = { ok: true; inv: Inventory; item: string; made: number } | { ok: false; reason: 'materials' | 'no_room' };

/**
 * `count` crafts of a recipe, all or nothing: every material is taken (the suit first, then the cargo pods) and the
 * output added (the suit first, then the cargo) to a new inventory. When a material is short (`materials`) or the
 * output does not fit even in the room the materials leave (`no_room`), the result says so and `inv` is untouched: a
 * craft never uses up anything it does not make.
 */
export function craft(inv: Inventory, recipe: Recipe, count: number): CraftOutcome {
  const output = outputOf(recipe);
  if (!output || !Number.isInteger(count) || count < 1 || count > CRAFT_MAX) return { ok: false, reason: 'materials' };
  let out = inv;
  for (const m of materialsOf(recipe, count)) {
    const r = takeItem(out, m.item, m.count);
    if (!r.ok) return { ok: false, reason: 'materials' };
    out = r.inv;
  }
  const made = output.count * count;
  const r = addItem(out, output.item, made, { partial: false });
  if (!r.ok) return { ok: false, reason: 'no_room' };
  return { ok: true, inv: r.inv, item: output.item, made };
}

/**
 * Why `count` crafts of `recipeId` cannot be made at fabricator `at` (system tier `tier`) from what a character knows and
 * holds, or null when they can: `unknown`, `not_known`, `fabricator`, then `materials` or `no_room` as `craft` finds
 * them. Where the player is (`place`) is the server's to judge, between `fabricator` and the materials.
 */
export function makeProblem(
  inv: Inventory,
  known: readonly string[],
  recipeId: string,
  count: number,
  at: FabricatorKind,
  tier: number,
): 'unknown' | 'not_known' | 'fabricator' | 'materials' | 'no_room' | null {
  const recipe = recipeById(recipeId);
  if (!recipe) return 'unknown';
  if (!known.includes(recipe.id)) return 'not_known';
  if (!makesAt(recipe, at, tier)) return 'fabricator';
  const r = craft(inv, recipe, count);
  return r.ok ? null : r.reason;
}

export type LessonOutcome = { ok: true; inv: Inventory; known: KnownRecipes } | { ok: false; reason: 'unknown' | 'known' | 'no_item' };

/**
 * Learning a recipe from its item: one `recipe_<id>` is used up (the suit first) and the recipe is known for good.
 * Refused, and nothing changed, for a recipe the table lacks (`unknown`), one already known (`known`: the item is kept,
 * to sell or give away) or without the item (`no_item`).
 */
export function learn(inv: Inventory, knowledge: KnownRecipes, recipeId: string): LessonOutcome {
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, reason: 'unknown' };
  if (knowledge.known.includes(recipe.id)) return { ok: false, reason: 'known' };
  const r = takeItem(inv, recipeItemId(recipe.id), 1);
  if (!r.ok) return { ok: false, reason: 'no_item' };
  return { ok: true, inv: r.inv, known: { known: [...knowledge.known, recipe.id] } };
}

/**
 * A stored knowledge brought in line with the recipe table as it is now (the persistence component's `reconcile`): a
 * recipe the table no longer has is dropped, and listed in `dropped`; the rest keep their order. Returns the stored value
 * itself when nothing changed.
 */
export function reconcileKnown(stored: KnownRecipes): { knowledge: KnownRecipes; dropped: string[] } {
  const dropped = stored.known.filter((id) => !byId.has(id));
  return dropped.length ? { knowledge: { known: stored.known.filter((id) => byId.has(id)) }, dropped } : { knowledge: stored, dropped };
}

/**
 * What using a crafted consumable restores (data/items.ts `restores`), or null: a pulse fuel cell 100 Charge, an oxygen
 * or sodium cartridge 60 life support or hazard protection (DESIGN 15.7: "refills restore 60 instead of 40"). The hook
 * for the meters: Heat and Charge's service (P1.E07.T02) refills Charge with `refillCharge(character, amount)` when a
 * pulse fuel cell is used (taken from the inventory with `InventoryService.consume`), and the suit's life support and
 * hazard protection do the same with cartridges once they are the server's.
 */
export function refillOf(item: string): { meter: 'charge' | 'life_support' | 'hazard_protection'; amount: number } | null {
  const info = itemInfo(item);
  if (!info || info.kind !== 'consumable') return null;
  return getItem(item).restores ?? null;
}

/** The recipes of a list in the table's order (consumables first), for a fabricator's screen. */
export function inTableOrder(ids: Iterable<string>): Recipe[] {
  const set = new Set(ids);
  return RECIPES.filter((r) => set.has(r.id));
}
