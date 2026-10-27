// Crafting's shared rules (P1.E13.T05, DESIGN 15.7): what a new character knows, which fabricator makes what, a craft as
// one all-or-nothing change to the inventory (never using up what it does not make), learning a recipe from its item,
// and a stored knowledge brought in line with the recipe table.
import { describe, expect, it } from 'vitest';
import {
  craft,
  craftableCount,
  CRAFT_MAX,
  inTableOrder,
  knownRecipesSchema,
  learn,
  makeProblem,
  makesAt,
  materialsOf,
  recipeById,
  reconcileKnown,
  refillOf,
  STARTING_RECIPES,
  startingKnowledge,
  STATION_MAX_TIER,
} from '../src/crafting/index.ts';
import { getItem, getRecipe, ITEMS, RECIPES, recipeItemId, recipeOfItem, STATION_FABRICATOR, STATION_HANGAR } from '../src/data/index.ts';
import { addItem, countOf, emptyInventory, layoutFor, totals, type Inventory } from '../src/inventory/index.ts';

const LARK = { hull: 'lark' as const, modules: {}, cargoPods: 1, livery: 0 };
/** An empty inventory with the Lark's one pod (16 suit stacks, 8 in the pod). */
const empty = (): Inventory => emptyInventory(layoutFor({ ship: LARK }));
function holding(items: [string, number][], inv = empty()): Inventory {
  for (const [item, n] of items) {
    const r = addItem(inv, item, n, { partial: false });
    if (!r.ok) throw new Error(r.error.message);
    inv = r.inv;
  }
  return inv;
}

const PHASE_1 = ['warp_cell', 'pulse_fuel_cell', 'oxygen_cartridge', 'sodium_cartridge', 'flak_ammo'];

describe('recipe items', () => {
  it('every recipe has an item that teaches it, and only recipe items name a recipe', () => {
    for (const r of RECIPES) {
      const item = getItem(recipeItemId(r.id));
      expect(item).toMatchObject({ kind: 'recipe', recipe: r.id, name: `${r.name} recipe` });
      expect(recipeOfItem(item.id)).toBe(r.id);
    }
    expect(ITEMS.filter((i) => i.kind === 'recipe')).toHaveLength(RECIPES.length);
    for (const i of ITEMS) expect(i.recipe !== undefined, i.id).toBe(i.kind === 'recipe');
    expect(recipeOfItem('warp_cell')).toBeNull();
    expect(recipeOfItem('recipe_no_such_thing')).toBeNull();
    expect(getItem('recipe_torpedo').text).toBe(
      "Teaches the Torpedo recipe for good, crafted at Waystation and capital fabricators, and the ship's own fabricator from Tier 2.",
    );
    expect(getItem('recipe_warp_cell').text).toBe('Teaches the Warp cell recipe for good, crafted at Waystation and capital fabricators.');
  });

  it('recipe items stack, so a vendor or the market can sell several', () => {
    const inv = holding([['recipe_torpedo', 3]]);
    expect(countOf(inv, 'recipe_torpedo')).toBe(3);
    expect(inv.suit.filter(Boolean)).toHaveLength(1);
  });
});

describe('what a character knows', () => {
  it('starts with Phase 1’s consumables, each a recipe of the table', () => {
    expect([...STARTING_RECIPES]).toEqual(PHASE_1);
    expect(startingKnowledge()).toEqual({ known: PHASE_1 });
    expect(knownRecipesSchema.parse(startingKnowledge())).toEqual({ known: PHASE_1 });
    for (const id of STARTING_RECIPES) expect(getRecipe(id).line).toBe('consumable');
    expect(knownRecipesSchema.safeParse({ known: ['warp_cell', 'warp_cell'] }).success).toBe(false);
    expect(knownRecipesSchema.safeParse({ known: ['warp_cell'], extra: 1 }).success).toBe(false);
  });

  it('learns a recipe from its item, used up from the suit first; refuses one it knows (keeping the item), an unknown one, and none held', () => {
    const inv = holding([['recipe_torpedo', 2]]);
    const r = learn(inv, startingKnowledge(), 'torpedo');
    expect(r.ok && r.known).toEqual({ known: [...PHASE_1, 'torpedo'] });
    expect(r.ok && countOf(r.inv, 'recipe_torpedo')).toBe(1);
    expect(countOf(inv, 'recipe_torpedo')).toBe(2);
    expect(learn(inv, { known: [...PHASE_1, 'torpedo'] }, 'torpedo')).toEqual({ ok: false, reason: 'known' });
    expect(learn(inv, startingKnowledge(), 'warp_cell')).toEqual({ ok: false, reason: 'known' });
    expect(learn(inv, startingKnowledge(), 'cargo_pod')).toEqual({ ok: false, reason: 'no_item' });
    expect(learn(inv, startingKnowledge(), 'no_such_recipe')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('drops recipes the table no longer has, keeping the order of the rest', () => {
    const stored = { known: ['warp_cell', 'old_recipe', 'torpedo', 'gone_too'] };
    expect(reconcileKnown(stored)).toEqual({ knowledge: { known: ['warp_cell', 'torpedo'] }, dropped: ['old_recipe', 'gone_too'] });
    const fine = startingKnowledge();
    expect(reconcileKnown(fine).knowledge).toBe(fine);
    expect(inTableOrder(['flak_ammo', 'torpedo', 'warp_cell']).map((r) => r.id)).toEqual(['warp_cell', 'flak_ammo', 'torpedo']);
  });
});

describe('what the consumables restore (the meters’ hook)', () => {
  it('a pulse fuel cell refills Charge; the cartridges restore 60, not the raw resource’s 40; nothing else refills', () => {
    expect(refillOf('pulse_fuel_cell')).toEqual({ meter: 'charge', amount: 100 });
    expect(refillOf('oxygen_cartridge')).toEqual({ meter: 'life_support', amount: 60 });
    expect(refillOf('sodium_cartridge')).toEqual({ meter: 'hazard_protection', amount: 60 });
    for (const id of ['warp_cell', 'flak_ammo', 'oxygen', 'recipe_oxygen_cartridge', 'frostglass_catalyst', 'nothing']) expect(refillOf(id), id).toBeNull();
  });
});

describe('fabricators', () => {
  it('a Waystation makes the item recipes of its line up to Tier 2; the ship only ammo and cartridges', () => {
    expect(STATION_MAX_TIER).toBe(2);
    const station = RECIPES.filter((r) => makesAt(r, 'station', 0)).map((r) => r.id);
    expect(station).toEqual(RECIPES.filter((r) => r.fabricators.includes('waystation') && r.tier <= 2 && r.output.kind === 'item').map((r) => r.id));
    for (const id of PHASE_1) expect(station, id).toContain(id);
    // catalysts are the sanctuaries', the Tier 3 modules and cosmetics the capitals', the Husk the Scrapyard's
    for (const id of ['frostglass_catalyst', 'railgun', 'suit_glyph', 'husk_hull', 'pressure_hull_module']) expect(station, id).not.toContain(id);
    // the ship's: pulse fuel, both cartridges and flak ammo anywhere, torpedoes from Tier 2, never a warp cell
    expect(RECIPES.filter((r) => makesAt(r, 'ship', 0)).map((r) => r.id)).toEqual(['pulse_fuel_cell', 'oxygen_cartridge', 'sodium_cartridge', 'flak_ammo']);
    expect(RECIPES.filter((r) => makesAt(r, 'ship', 2)).map((r) => r.id)).toEqual([
      'pulse_fuel_cell',
      'oxygen_cartridge',
      'sodium_cartridge',
      'flak_ammo',
      'torpedo',
    ]);
    expect(makesAt(getRecipe('warp_cell'), 'ship', 5)).toBe(false);
    expect(makesAt(getRecipe('husk_hull'), 'ship', 5)).toBe(false);
  });

  it('the Waystation’s fabricator terminal stands on the trade deck inside the hangar, its user in front of it', () => {
    const { kiosk, use, reachM } = STATION_FABRICATOR;
    for (const p of [kiosk, use]) {
      expect(p.x).toBeGreaterThan(STATION_HANGAR.x0);
      expect(p.x).toBeLessThan(STATION_HANGAR.x1);
      expect(p.z).toBeGreaterThan(STATION_HANGAR.z0);
      expect(p.z).toBeLessThan(-68);
      expect(p.y).toBe(7);
    }
    expect(Math.hypot(use.x - kiosk.x, use.z - kiosk.z)).toBeCloseTo(1.2);
    expect(reachM).toBeGreaterThan(3.2);
  });
});

describe('a craft', () => {
  const warp = getRecipe('warp_cell');

  it('uses up every material, suit and cargo together, and adds what it makes', () => {
    // di-hydrogen split between the suit and the pod: the suit's is used first
    let inv = holding([
      ['dihydrogen', 60],
      ['tritium', 45],
      ['cobalt', 12],
    ]);
    const pod = addItem(inv, 'dihydrogen', 50, { to: 'cargo' });
    inv = pod.ok ? pod.inv : inv;
    expect(materialsOf(warp, 2)).toEqual([
      { item: 'dihydrogen', count: 100 },
      { item: 'tritium', count: 40 },
      { item: 'cobalt', count: 10 },
    ]);
    expect(craftableCount(inv, warp)).toBe(2);
    const r = craft(inv, warp, 2);
    expect(r).toMatchObject({ ok: true, item: 'warp_cell', made: 2 });
    if (!r.ok) return;
    expect(totals(r.inv)).toEqual({ dihydrogen: 10, tritium: 5, cobalt: 2, warp_cell: 2 });
    expect(countOf(r.inv, 'dihydrogen', 'suit')).toBe(0);
    expect(countOf(r.inv, 'dihydrogen', 'cargo')).toBe(10);
    // fifty rounds of flak a craft
    const flak = craft(
      holding([
        ['ferrite', 60],
        ['carbon', 30],
      ]),
      getRecipe('flak_ammo'),
      3,
    );
    expect(flak.ok && totals(flak.inv)).toEqual({ flak_ammo: 150 });
  });

  it('is refused, the inventory untouched, when a material is short', () => {
    const inv = holding([
      ['dihydrogen', 99],
      ['tritium', 40],
      ['cobalt', 10],
    ]);
    expect(craftableCount(inv, warp)).toBe(1);
    expect(craft(inv, warp, 2)).toEqual({ ok: false, reason: 'materials' });
    expect(totals(inv)).toEqual({ dihydrogen: 99, tritium: 40, cobalt: 10 });
  });

  it('is refused, nothing used up, when what it makes does not fit even in the room its materials leave', () => {
    // every slot full: the materials in stacks a craft does not empty, so no slot frees up, and carbon in the rest
    const full = (materials: [string, number][]): Inventory => {
      const inv = empty();
      const all = [
        ...materials.map(([item, count]) => ({ item, count })),
        ...Array.from({ length: 24 - materials.length }, () => ({ item: 'carbon', count: 1 })),
      ];
      return { ...inv, suit: all.slice(0, 16), pods: [all.slice(16)] };
    };
    const inv = full([
      ['dihydrogen', 500],
      ['tritium', 500],
      ['cobalt', 500],
    ]);
    expect(craft(inv, warp, 1)).toEqual({ ok: false, reason: 'no_room' });
    expect(totals(inv)).toEqual({ dihydrogen: 500, tritium: 500, cobalt: 500, carbon: 21 });
    // a material stack the craft empties frees its slot for what it makes
    const tight = full([
      ['dihydrogen', 50],
      ['tritium', 500],
      ['cobalt', 500],
    ]);
    const made = craft(tight, warp, 1);
    expect(made.ok && made.inv.suit[0]).toEqual({ item: 'warp_cell', count: 1 });
    // and a stack of what it makes takes more, slots or none
    const topped = craft({ ...inv, pods: [[{ item: 'warp_cell', count: 3 }, ...inv.pods[0]!.slice(1)]] }, warp, 2);
    expect(topped.ok && countOf(topped.inv, 'warp_cell')).toBe(5);
  });

  it('says why a fabricator cannot make one: unknown, not known, the wrong fabricator, then materials or room', () => {
    const inv = holding([
      ['dihydrogen', 50],
      ['tritium', 20],
      ['cobalt', 5],
    ]);
    const known = [...STARTING_RECIPES];
    expect(makeProblem(inv, known, 'warp_cell', 1, 'station', 0)).toBeNull();
    expect(makeProblem(inv, known, 'warp_cell', 2, 'station', 0)).toBe('materials');
    expect(makeProblem(inv, known, 'warp_cell', 1, 'ship', 0)).toBe('fabricator');
    expect(makeProblem(inv, known, 'torpedo', 1, 'station', 0)).toBe('not_known');
    expect(makeProblem(inv, known, 'nope', 1, 'station', 0)).toBe('unknown');
    expect(makeProblem(inv, [...known, 'torpedo'], 'torpedo', 1, 'ship', 1)).toBe('fabricator');
    expect(makeProblem(inv, [...known, 'torpedo'], 'torpedo', 1, 'ship', 2)).toBe('materials');
    expect(recipeById('warp_cell')).toBe(warp);
    expect(recipeById('nope')).toBeUndefined();
    expect(
      craftableCount(
        holding([
          ['ferrite', 50000],
          ['carbon', 50000],
        ]),
        getRecipe('flak_ammo'),
      ),
    ).toBe(CRAFT_MAX);
  });
});
