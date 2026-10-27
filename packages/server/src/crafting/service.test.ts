// Fabricators on the server (P1.E13.T05, ARCHITECTURE §23), against a zone standing in for one of the home system: each
// Phase 1 consumable is made at the station's fabricator (docked, or on foot at its terminal) and the ship's (aboard, or
// beside the ship it left), its materials taken from the suit and the cargo and its output added in one inventory change;
// and every check refuses as it should, changing nothing: a recipe not known or not in the table, the wrong fabricator
// (the ship's never makes a warp cell), the wrong place, short materials, no room for the output, too fast, a stale
// number, a character out of play. A recipe item teaches its recipe for good.
import { CRAFT_MAX, STARTING_RECIPES } from '@astra/shared/crafting';
import { STATION_FABRICATOR, WALKER } from '@astra/shared/data';
import { addItem, totals, type Inventory } from '@astra/shared/inventory';
import type { Pose, ServerMessage } from '@astra/shared/protocol';
import type { Tier } from '@astra/shared/world';
import { beforeEach, describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { padPose } from '../sim/movement/index.ts';
import { homeSystemOf, stationFrame } from '../world/home.ts';
import { describeZoneSystem } from '../zones/system.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { RecipeBook } from './book.ts';
import { CRAFT_BURST, CRAFT_PER_S, CraftingService, SHIP_FABRICATOR_SLACK_M, type CraftingZone } from './service.ts';

type Answer = Extract<ServerMessage, { t: 'craft' }>;
type Vec3 = [number, number, number];

const HOME = homeSystemOf('thalune');
const system = describeZoneSystem(HOME);
const STATION = stationFrame(HOME);
const WORLD = `${system.seed}:${system.bodies.find((b) => b.type !== 'gas')!.index}`;
const TERMINAL: Vec3 = [STATION_FABRICATOR.use.x, STATION_FABRICATOR.use.y, STATION_FABRICATOR.use.z];
const PLAYER = 7;

/** The player as the zone believes it (frame, position, mode), and where it left its ship. */
let fields: { frame: string | null; pos: Vec3; mode: string };
let parked: Pose | null;
let movement: boolean;
let tier: Tier;
const zone = {
  id: 'zone:home',
  systemIndex: HOME,
  system,
  entityOf: (v: ZoneViewer) => (v === viewer ? PLAYER : undefined),
  entity: (id: number) => (id === PLAYER ? { id, fields } : undefined),
  get movement() {
    return movement ? { parkedOf: (id: number) => (id === PLAYER ? parked : null) } : null;
  },
} as unknown as CraftingZone;
const viewer: ZoneViewer = { id: 1, characterId: 'c1', sendBinary: () => {} };

let inventory: InventoryService;
let book: RecipeBook;
let crafting: CraftingService;
let pushes: number;
let t: number;
let seq: number;

beforeEach(() => {
  inventory = new InventoryService();
  inventory.open('c1');
  // (the starting kit's one warp cell, out of the way)
  inventory.consume('c1', 'warp_cell', 1);
  book = new RecipeBook();
  book.open('c1');
  pushes = 0;
  inventory.subscribe(() => pushes++);
  crafting = new CraftingService({ zones: { zoneOf: (v) => (v === viewer ? zone : undefined), tier: () => tier }, inventory, book, now: () => t });
  fields = { frame: STATION, pos: padPose(STATION, 0).pos as Vec3, mode: 'docked' };
  parked = null;
  movement = true;
  tier = 0;
  t = 5000;
  seq = 0;
});

function give(items: [string, number][]): void {
  for (const [item, n] of items) expect(inventory.grant('c1', item, n, { partial: false }).ok, item).toBe(true);
}

const held = (): Record<string, number> => totals(inventory.get('c1')!);

/** Asks the fabricator, a second after the last ask (within the rate). */
function make(recipe: string, at: 'station' | 'ship' = 'station', count = 1, opts: { seq?: number; gap?: number } = {}): Answer {
  t += opts.gap ?? 1;
  return crafting.craft(viewer, { t: 'craft', seq: opts.seq ?? ++seq, op: { op: 'make', recipe, count, at } });
}

function study(recipe: string): Answer {
  t += 1;
  return crafting.craft(viewer, { t: 'craft', seq: ++seq, op: { op: 'learn', recipe } });
}

/** Everything for one craft of each Phase 1 consumable, and a little over. */
const MATERIALS: [string, number][] = [
  ['dihydrogen', 70],
  ['tritium', 60],
  ['cobalt', 6],
  ['oxygen', 25],
  ['sodium', 21],
  ['ferrite', 40],
  ['carbon', 12],
];

describe('the station’s fabricator', () => {
  it('makes each Phase 1 consumable docked at the Waystation, taking its materials and adding what it makes in one change', () => {
    give(MATERIALS);
    const before = pushes;
    expect(make('warp_cell')).toEqual({ t: 'craft', seq: 1, op: 'make', recipe: 'warp_cell', result: 'made', item: 'warp_cell', count: 1 });
    expect(pushes).toBe(before + 1);
    expect(make('pulse_fuel_cell')).toMatchObject({ result: 'made', item: 'pulse_fuel_cell', count: 1 });
    expect(make('oxygen_cartridge')).toMatchObject({ result: 'made', item: 'oxygen_cartridge', count: 1 });
    expect(make('sodium_cartridge')).toMatchObject({ result: 'made', item: 'sodium_cartridge', count: 1 });
    expect(make('flak_ammo')).toMatchObject({ result: 'made', item: 'flak_ammo', count: 50 });
    expect(held()).toEqual({
      dihydrogen: 10,
      tritium: 10,
      cobalt: 1,
      oxygen: 5,
      sodium: 1,
      ferrite: 10,
      carbon: 2,
      warp_cell: 1,
      pulse_fuel_cell: 1,
      oxygen_cartridge: 1,
      sodium_cartridge: 1,
      flak_ammo: 50,
    });
    expect(crafting.stats()).toMatchObject({ asked: 5, made: 5, refused: {} });
  });

  it('makes several at once, the materials coming from the cargo pod when the suit runs short', () => {
    give([
      ['ferrite', 30],
      ['carbon', 40],
    ]);
    expect(inventory.grant('c1', 'ferrite', 50, { to: 'cargo' }).ok).toBe(true);
    expect(make('flak_ammo', 'station', 4)).toMatchObject({ result: 'made', item: 'flak_ammo', count: 200 });
    expect(held()).toEqual({ flak_ammo: 200 });
  });

  it('works on foot at the fabricator terminal, and nowhere else on foot', () => {
    give(MATERIALS);
    fields = { frame: STATION, pos: TERMINAL, mode: 'foot' };
    expect(make('pulse_fuel_cell')).toMatchObject({ result: 'made' });
    fields = { frame: STATION, pos: [TERMINAL[0] + STATION_FABRICATOR.reachM - 0.1, TERMINAL[1], TERMINAL[2]], mode: 'foot' };
    expect(make('pulse_fuel_cell')).toMatchObject({ result: 'made' });
    fields = { frame: STATION, pos: [TERMINAL[0] + STATION_FABRICATOR.reachM + 0.5, TERMINAL[1], TERMINAL[2]], mode: 'foot' };
    expect(make('oxygen_cartridge')).toMatchObject({ result: 'refused', reason: 'place' });
    // on the hangar floor, flying in the hangar, out on a world, in another system's Waystation frame
    for (const f of [
      { frame: STATION, pos: [0, 0.2, 0] as Vec3, mode: 'foot' },
      { frame: STATION, pos: TERMINAL, mode: 'ship' },
      { frame: WORLD, pos: [1e6, 0, 0] as Vec3, mode: 'landed' },
      { frame: `${system.seed + 1}:station`, pos: TERMINAL, mode: 'foot' },
    ]) {
      fields = f;
      expect(make('oxygen_cartridge'), JSON.stringify(f)).toMatchObject({ result: 'refused', reason: 'place' });
    }
    expect(held()).toMatchObject({ oxygen: 25, dihydrogen: 50, pulse_fuel_cell: 2 });
  });

  it('makes only the recipes of its line up to its tier band, never a hull', () => {
    book.open('c1', { known: [...STARTING_RECIPES, 'frostglass_catalyst', 'railgun', 'husk_hull', 'torpedo'] });
    give([
      ['frostglass', 10],
      ['cobalt', 5],
      ['tritium', 5],
      ['cinderglass', 2],
    ]);
    for (const r of ['frostglass_catalyst', 'railgun', 'husk_hull']) expect(make(r), r).toMatchObject({ result: 'refused', reason: 'fabricator' });
    expect(make('torpedo')).toMatchObject({ result: 'made', item: 'torpedo', count: 1 });
  });
});

describe('the ship’s fabricator', () => {
  it('makes ammo and cartridges aboard in any mode, anywhere, and never a warp cell', () => {
    give([...MATERIALS, ['dihydrogen', 100], ['tritium', 100], ['cobalt', 10]]);
    fields = { frame: null, pos: [3e9, 1e7, -2e8], mode: 'ship' };
    expect(make('flak_ammo', 'ship')).toMatchObject({ result: 'made', item: 'flak_ammo', count: 50 });
    fields = { frame: WORLD, pos: [1e6, 0, 0], mode: 'landed' };
    expect(make('oxygen_cartridge', 'ship')).toMatchObject({ result: 'made' });
    fields = { frame: null, pos: [3e9, 0, 0], mode: 'pulse' };
    expect(make('sodium_cartridge', 'ship')).toMatchObject({ result: 'made' });
    fields = { frame: STATION, pos: padPose(STATION, 2).pos as Vec3, mode: 'docked' };
    expect(make('pulse_fuel_cell', 'ship')).toMatchObject({ result: 'made' });
    const before = held();
    for (const f of [fields, { frame: null, pos: [3e9, 0, 0] as Vec3, mode: 'ship' }]) {
      fields = f;
      expect(make('warp_cell', 'ship')).toMatchObject({ result: 'refused', reason: 'fabricator' });
    }
    expect(held()).toEqual(before);
    // away from a Waystation, the station's fabricator is not there
    fields = { frame: WORLD, pos: [1e6, 0, 0], mode: 'landed' };
    expect(make('warp_cell', 'station')).toMatchObject({ result: 'refused', reason: 'place' });
  });

  it('makes torpedoes only from Tier 2 (DESIGN 15.7: field-craftable at Tier 2+)', () => {
    book.open('c1', { known: [...STARTING_RECIPES, 'torpedo'] });
    give([
      ['cobalt', 10],
      ['tritium', 10],
      ['cinderglass', 4],
    ]);
    fields = { frame: null, pos: [3e9, 0, 0], mode: 'ship' };
    tier = 1;
    expect(make('torpedo', 'ship')).toMatchObject({ result: 'refused', reason: 'fabricator' });
    tier = 2;
    expect(make('torpedo', 'ship')).toMatchObject({ result: 'made', item: 'torpedo', count: 1 });
  });

  it('works on foot beside the ship it left, not far from it nor without one', () => {
    give(MATERIALS);
    const ship: Vec3 = [1e6, 0, 0];
    parked = { frame: WORLD, pos: ship, quat: [0, 0, 0, 1], vel: [0, 0, 0] };
    const reach = WALKER.boardRangeM + SHIP_FABRICATOR_SLACK_M;
    fields = { frame: WORLD, pos: [ship[0], ship[1] + reach - 0.5, ship[2]], mode: 'foot' };
    expect(make('flak_ammo', 'ship')).toMatchObject({ result: 'made' });
    fields = { frame: WORLD, pos: [ship[0], ship[1] + reach + 0.5, ship[2]], mode: 'foot' };
    expect(make('oxygen_cartridge', 'ship')).toMatchObject({ result: 'refused', reason: 'place' });
    // its ship in the Waystation, the walker on a world
    parked = padPose(STATION, 0);
    fields = { frame: WORLD, pos: padPose(STATION, 0).pos as Vec3, mode: 'foot' };
    expect(make('oxygen_cartridge', 'ship')).toMatchObject({ result: 'refused', reason: 'place' });
    // no ship of its own, and a zone with no movement authority to say where it is
    parked = null;
    fields = { frame: WORLD, pos: ship, mode: 'foot' };
    expect(make('oxygen_cartridge', 'ship')).toMatchObject({ result: 'refused', reason: 'place' });
    movement = false;
    expect(make('oxygen_cartridge', 'ship')).toMatchObject({ result: 'refused', reason: 'place' });
    expect(held()).toMatchObject({ oxygen: 25, flak_ammo: 50 });
  });
});

describe('a craft refused changes nothing', () => {
  it('a recipe the character has not learned, or one the table lacks', () => {
    give([
      ['cobalt', 5],
      ['tritium', 5],
      ['cinderglass', 2],
      ['copper', 30],
      ['ferrite', 20],
    ]);
    const before = held();
    const pushed = pushes;
    expect(make('torpedo')).toEqual({ t: 'craft', seq: 1, op: 'make', recipe: 'torpedo', result: 'refused', reason: 'not_known' });
    expect(make('pulse_lasers')).toMatchObject({ result: 'refused', reason: 'not_known' });
    expect(make('no_such_recipe')).toMatchObject({ result: 'refused', reason: 'unknown' });
    expect(held()).toEqual(before);
    expect(pushes).toBe(pushed);
  });

  it('short of a material: nothing is taken', () => {
    give([
      ['dihydrogen', 99],
      ['tritium', 40],
      ['cobalt', 10],
    ]);
    expect(make('warp_cell', 'station', 2)).toMatchObject({ result: 'refused', reason: 'materials' });
    expect(make('oxygen_cartridge')).toMatchObject({ result: 'refused', reason: 'materials' });
    expect(held()).toEqual({ dihydrogen: 99, tritium: 40, cobalt: 10 });
  });

  it('no room for what it makes: the materials stay where they were, every stack of them', () => {
    // the suit and the pod full, the materials in stacks no craft empties
    const inv = inventory.get('c1')!;
    const all = [
      { item: 'dihydrogen', count: 500 },
      { item: 'tritium', count: 500 },
      { item: 'cobalt', count: 500 },
      ...Array.from({ length: 21 }, () => ({ item: 'carbon', count: 1 })),
    ];
    const full: Inventory = { ...inv, suit: all.slice(0, 16), pods: [all.slice(16)] };
    inventory.close('c1');
    inventory.open('c1', { saved: full });
    expect(make('warp_cell')).toMatchObject({ result: 'refused', reason: 'no_room' });
    expect(inventory.get('c1')).toEqual(full);
    expect(addItem(full, 'warp_cell', 1)).toMatchObject({ ok: true, added: 0, remainder: 1 });
    // a craft that empties a material's stack makes room for what it makes in that slot
    inventory.close('c1');
    inventory.open('c1', { saved: { ...full, suit: [{ item: 'dihydrogen', count: 50 }, ...full.suit.slice(1)] } });
    expect(make('warp_cell')).toMatchObject({ result: 'made', item: 'warp_cell', count: 1 });
    expect(inventory.get('c1')!.suit[0]).toEqual({ item: 'warp_cell', count: 1 });
  });

  it('too fast: CRAFT_BURST at once, then CRAFT_PER_S a second; a refused ask spends it too', () => {
    give([
      ['ferrite', 1000],
      ['carbon', 1000],
    ]);
    const answers = Array.from({ length: CRAFT_BURST + 2 }, () => make('flak_ammo', 'station', 1, { gap: 0 }).result);
    expect(answers).toEqual([...Array(CRAFT_BURST).fill('made'), 'refused', 'refused']);
    expect(crafting.stats().refused).toEqual({ rate: 2 });
    expect(held()).toMatchObject({ flak_ammo: 50 * CRAFT_BURST });
    expect(make('flak_ammo', 'station', 1, { gap: 1 / CRAFT_PER_S }).result).toBe('made');
    expect(make('flak_ammo', 'station', 1, { gap: 0 }).result).toBe('refused');
    // a hundred crafts in one ask is one ask
    expect(make('flak_ammo', 'station', CRAFT_MAX, { gap: 5 })).toMatchObject({ result: 'refused', reason: 'materials' });
    expect(make('flak_ammo', 'station', 20, { gap: 1 })).toMatchObject({ result: 'made', count: 1000 });
  });

  it('a stale number, a character out of play', () => {
    give(MATERIALS);
    expect(make('flak_ammo', 'station', 1, { seq: 5 })).toMatchObject({ result: 'made' });
    expect(make('flak_ammo', 'station', 1, { seq: 5 })).toMatchObject({ result: 'refused', reason: 'stale_seq' });
    expect(make('flak_ammo', 'station', 1, { seq: 4 })).toMatchObject({ result: 'refused', reason: 'stale_seq' });
    book.close('c1');
    expect(make('flak_ammo', 'station', 1, { seq: 6 })).toMatchObject({ result: 'refused', reason: 'zone' });
    expect(crafting.craft({ id: 2, characterId: null, sendBinary: () => {} }, { t: 'craft', seq: 1, op: { op: 'learn', recipe: 'torpedo' } })).toMatchObject({
      result: 'refused',
      reason: 'zone',
    });
  });
});

describe('learning a recipe', () => {
  it('uses up its item and knows it for good; refuses one known (keeping the item), none held, or one the table lacks', () => {
    give([['recipe_torpedo', 2]]);
    expect(crafting.recipes('c1')).toEqual({ t: 'recipes', known: [...STARTING_RECIPES] });
    expect(make('torpedo')).toMatchObject({ result: 'refused', reason: 'not_known' });
    expect(study('torpedo')).toEqual({ t: 'craft', seq: 2, op: 'learn', recipe: 'torpedo', result: 'learned' });
    expect(book.knows('c1', 'torpedo')).toBe(true);
    expect(crafting.recipes('c1')).toEqual({ t: 'recipes', known: [...STARTING_RECIPES, 'torpedo'] });
    expect(held()).toEqual({ recipe_torpedo: 1 });
    expect(study('torpedo')).toMatchObject({ result: 'refused', reason: 'known' });
    expect(study('warp_cell')).toMatchObject({ result: 'refused', reason: 'known' });
    expect(held()).toEqual({ recipe_torpedo: 1 });
    expect(study('cargo_pod')).toMatchObject({ result: 'refused', reason: 'no_item' });
    expect(study('nothing_like_it')).toMatchObject({ result: 'refused', reason: 'unknown' });
    expect(crafting.stats()).toMatchObject({ learned: 1 });
    // and learned, it is made
    give([
      ['cobalt', 5],
      ['tritium', 5],
      ['cinderglass', 2],
    ]);
    expect(make('torpedo')).toMatchObject({ result: 'made', item: 'torpedo' });
    expect(crafting.recipes('nobody')).toBeNull();
  });
});

describe('the recipe book', () => {
  it('holds each character in play’s recipes, and refuses a change to one out of play or a recipe the table lacks', () => {
    const b = new RecipeBook();
    expect(b.holds('c2')).toBe(false);
    expect(() => b.learn('c2', 'torpedo')).toThrow(/not held/);
    b.open('c2', { known: ['warp_cell'] });
    expect(b.learn('c2', 'torpedo')).toBe(true);
    expect(b.learn('c2', 'torpedo')).toBe(false);
    expect(() => b.learn('c2', 'nope')).toThrow(RangeError);
    expect(b.get('c2')).toEqual({ known: ['warp_cell', 'torpedo'] });
    expect(b.knows('c2', 'warp_cell')).toBe(true);
    expect(b.close('c2')).toBe(true);
    expect(b.close('c2')).toBe(false);
    b.open('c3');
    expect(b.get('c3')).toEqual({ known: [...STARTING_RECIPES] });
  });
});
