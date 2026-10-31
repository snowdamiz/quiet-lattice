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
  maxTierOf,
  recipesFrom,
  fabricatorOfPlace,
  fabricatorPlace,
  placeIdSchema,
  waystationPlace,
  FABRICATOR_KINDS,
  materialsOf,
  recipeById,
  reconcileRecipes,
  RECIPE_TABLE,
  startingStored,
  storedRecipesSchema,
  refillOf,
  STARTING_RECIPES,
  startingKnowledge,
} from '../src/crafting/index.ts';
import { getItem, getRecipe, ITEMS, RECIPES, recipeItemId, recipeOfItem, RECIPE_TABLE_VERSION, STATION_FABRICATOR, STATION_HANGAR, STATION_LAYOUT } from '../src/data/index.ts';
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
    const stored = { table: RECIPE_TABLE.version, known: ['warp_cell', 'old_recipe', 'torpedo', 'gone_too'] };
    expect(reconcileRecipes(stored)).toEqual({
      stored: { table: RECIPE_TABLE.version, known: ['warp_cell', 'torpedo'] },
      dropped: ['old_recipe', 'gone_too'],
      heldOver: [],
      rolledBack: false,
    });
    const fine = startingStored();
    expect(reconcileRecipes(fine).stored).toBe(fine);
    expect(inTableOrder(['flak_ammo', 'torpedo', 'warp_cell']).map((r) => r.id)).toEqual(['warp_cell', 'flak_ammo', 'torpedo']);
  });

  it('an older stored table is reconciled up to this one', () => {
    const r = reconcileRecipes({ table: 0, known: ['warp_cell'] });
    expect(r.stored).toEqual({ table: RECIPE_TABLE.version, known: ['warp_cell'] });
    expect(r.rolledBack).toBe(false);
  });

  it('a rolled-back table keeps every learned recipe and the newer version (the version guard)', () => {
    const rolledBack = { version: RECIPE_TABLE.version - 1, has: (id: string) => id !== 'torpedo' && id !== 'old_recipe' };
    const stored = { table: RECIPE_TABLE.version, known: ['warp_cell', 'torpedo', 'old_recipe'] };
    const r = reconcileRecipes(stored, rolledBack);
    expect(r).toEqual({ stored, dropped: [], heldOver: ['torpedo', 'old_recipe'], rolledBack: true });
    expect(r.stored).toBe(stored);
    expect(reconcileRecipes(stored, { version: RECIPE_TABLE.version, has: rolledBack.has }).dropped).toEqual(['torpedo', 'old_recipe']);
  });

  it('stores the table version with the recipes, from 0', () => {
    expect(storedRecipesSchema.safeParse({ table: 0, known: [] }).success).toBe(true);
    expect(storedRecipesSchema.safeParse({ table: -1, known: [] }).success).toBe(false);
    expect(storedRecipesSchema.safeParse({ known: [] }).success).toBe(false);
    expect(storedRecipesSchema.safeParse({ table: 1, known: [], extra: 1 }).success).toBe(false);
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
    expect(maxTierOf('waystation')).toBe(2);
    const station = RECIPES.filter((r) => makesAt(r, 'waystation', 0)).map((r) => r.id);
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
    expect(makeProblem(inv, known, 'warp_cell', 1, 'waystation', 0)).toBeNull();
    expect(makeProblem(inv, known, 'warp_cell', 2, 'waystation', 0)).toBe('materials');
    expect(makeProblem(inv, known, 'warp_cell', 1, 'ship', 0)).toBe('fabricator');
    expect(makeProblem(inv, known, 'torpedo', 1, 'waystation', 0)).toBe('not_known');
    expect(makeProblem(inv, known, 'nope', 1, 'waystation', 0)).toBe('unknown');
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

  it('makes no more than CRAFT_MAX crafts at once, and only a whole number of at least one, whatever is held', () => {
    const plenty = holding([
      ['ferrite', 50000],
      ['carbon', 50000],
    ]);
    const flak = getRecipe('flak_ammo');
    expect(craft(plenty, flak, CRAFT_MAX)).toMatchObject({ ok: true, made: 50 * CRAFT_MAX });
    for (const n of [CRAFT_MAX + 1, 0, -1, 1.5, Number.NaN]) expect(craft(plenty, flak, n), String(n)).toEqual({ ok: false, reason: 'materials' });
    expect(totals(plenty)).toEqual({ ferrite: 50000, carbon: 50000 });
  });
});

describe('fabricator tiers (P2.E20.T01, DESIGN 15.7)', () => {
  const made = (at: Parameters<typeof makesAt>[1]) => RECIPES.filter((r) => makesAt(r, at, 5)).map((r) => r.id);

  it('each fabricator has a tier band or a line, from the table', () => {
    expect(FABRICATOR_KINDS).toEqual(['waystation', 'capital', 'sanctuary', 'scrapyard', 'ship']);
    expect([maxTierOf('waystation'), maxTierOf('capital'), maxTierOf('sanctuary'), maxTierOf('scrapyard'), maxTierOf('ship')]).toEqual([
      2,
      3,
      null,
      null,
      null,
    ]);
  });

  it('the tier gate: a recipe above a fabricator’s band is not made there, one at the band is', () => {
    for (const at of ['waystation', 'capital'] as const) {
      const top = maxTierOf(at)!;
      for (const r of RECIPES.filter((x) => x.output.kind === 'item' && x.fabricators.includes(at)))
        expect(makesAt(r, at, 0), `${at} ${r.id}`).toBe(r.tier <= top);
    }
    expect(makesAt(getRecipe('railgun'), 'waystation', 5)).toBe(false);
    expect(makesAt(getRecipe('railgun'), 'capital', 0)).toBe(true);
    expect(makesAt(getRecipe('beam_lance'), 'waystation', 0)).toBe(true);
    expect(makesAt(getRecipe('beam_lance'), 'capital', 0)).toBe(true);
    // the gate reads the band in the data, not a constant: a recipe over it at a banded fabricator is refused
    const tooHigh = { ...getRecipe('beam_lance'), tier: 4 as const };
    expect(makesAt(tooHigh, 'capital', 0)).toBe(false);
  });

  it('a capital makes the item recipes of its line up to Tier 3, a sanctuary the catalysts, the Scrapyard the Void recipes', () => {
    expect(made('capital')).toEqual(RECIPES.filter((r) => r.fabricators.includes('capital') && r.tier <= 3 && r.output.kind === 'item').map((r) => r.id));
    expect(made('capital')).toEqual(
      expect.arrayContaining(['warp_cell', 'beam_lance', 'emp_pod', 'railgun', 'torpedo_rack', 'suit_glyph', 'hull_glyph_seams']),
    );
    expect(made('capital')).not.toContain('frostglass_catalyst');
    expect(made('capital')).not.toContain('husk_plating');
    expect(made('sanctuary')).toEqual(['frostglass_catalyst', 'stormquartz_catalyst', 'gamma_catalyst', 'acidsalt_catalyst']);
    expect(made('scrapyard')).toEqual(['pressure_hull_module', 'husk_plating']);
  });

  it('no fabricator assembles a hull yet, and every item recipe is made somewhere', () => {
    for (const at of FABRICATOR_KINDS) expect(made(at), at).not.toContain('husk_hull');
    const everywhere = new Set(FABRICATOR_KINDS.flatMap((at) => made(at)));
    for (const r of RECIPES.filter((x) => x.output.kind === 'item')) expect(everywhere.has(r.id), r.id).toBe(true);
  });

  it('the starting recipes are made at every Waystation and every capital', () => {
    for (const id of STARTING_RECIPES) {
      expect(makesAt(getRecipe(id), 'waystation', 0), id).toBe(true);
      expect(makesAt(getRecipe(id), 'capital', 0), id).toBe(true);
    }
  });

  it('place ids name the fabricator, and a Waystation’s terminal is the station’s', () => {
    expect(fabricatorOfPlace('waystation')).toBe('waystation');
    expect(fabricatorOfPlace('capital:thalune')).toBe('capital');
    expect(fabricatorOfPlace('sanctuary:chorus-1')).toBe('sanctuary');
    expect(fabricatorOfPlace('scrapyard')).toBe('scrapyard');
    for (const bad of ['ship', 'capital', 'capital:', 'Capital:x', 'harbour:x', '', 'scrapyard:2']) expect(fabricatorOfPlace(bad), bad).toBeNull();
    expect(placeIdSchema.safeParse('capital:thalune').success).toBe(true);
    expect(() => fabricatorPlace('ship', { frame: 'f', use: [0, 0, 0], reachM: 1, dockedReachM: null })).toThrow(RangeError);
    const w = waystationPlace(77);
    expect(w).toEqual({
      id: 'waystation',
      fabricator: 'waystation',
      frame: '77:station',
      use: [STATION_FABRICATOR.use.x, STATION_FABRICATOR.use.y, STATION_FABRICATOR.use.z],
      reachM: STATION_FABRICATOR.reachM,
      dockedReachM: w.dockedReachM,
    });
    // a ship docked on any of the four pads is within the Waystation's docked reach, and a mile off is not
    const farthest = Math.max(...STATION_LAYOUT.pads.map((p) => Math.hypot(p.x - STATION_FABRICATOR.use.x, p.z - STATION_FABRICATOR.use.z)));
    expect(w.dockedReachM).toBeGreaterThanOrEqual(farthest);
    expect(w.dockedReachM).toBeLessThan(farthest + 40);
    expect(fabricatorPlace('capital:x', { ...w, fabricator: 'scrapyard' } as never).fabricator).toBe('capital');
  });

  it('every recipe names how its item is found, and every source has recipes', () => {
    for (const source of ['vendor', 'faction', 'boss', 'vault'] as const) expect(recipesFrom(source).every((r) => r.learnedFrom === source)).toBe(true);
    expect(recipesFrom('vendor').length + recipesFrom('faction').length + recipesFrom('boss').length + recipesFrom('vault').length).toBe(RECIPES.length);
  });
});

/** The recipe table as a stored book reads it, as a short hash: the ids of its recipes. */
function recipeFingerprint(ids: readonly string[]): string {
  const text = [...ids].sort().join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** The fingerprint of each table version: a new version adds its own. */
const RECIPE_FINGERPRINTS: Record<number, string> = { 1: '43ae41af' };

describe('the recipe table’s version', () => {
  it('names the table as it is: a recipe added or removed raises RECIPE_TABLE_VERSION', () => {
    // When this fails, the recipe ids changed: raise RECIPE_TABLE_VERSION in packages/shared/src/data/recipes.ts and add the
    // new fingerprint above, so a server rolled back keeps the recipes this one saved instead of dropping what it does not know.
    expect(recipeFingerprint(RECIPES.map((r) => r.id)), `recipe table ${RECIPE_TABLE_VERSION}`).toBe(RECIPE_FINGERPRINTS[RECIPE_TABLE_VERSION]);
    const base = recipeFingerprint(['a', 'b']);
    expect(recipeFingerprint(['a', 'b', 'c'])).not.toBe(base);
    expect(recipeFingerprint(['a'])).not.toBe(base);
    expect(recipeFingerprint(['a', 'c'])).not.toBe(base);
    expect(recipeFingerprint(['b', 'a'])).toBe(base);
  });
});
