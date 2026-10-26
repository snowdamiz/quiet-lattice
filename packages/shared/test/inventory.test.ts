// The inventory model (P1.E06.T04, DESIGN 10.1): every operation and its edge cases, the layout from hulls and Pack Mule, and
// a seeded fuzz that checks every client op conserves what is held and leaves a value the schema accepts.
import { describe, expect, it } from 'vitest';
import { deepFreeze, getHull, HULLS, ITEMS, RESOURCES, type HullId } from '../src/data/index.ts';
import { LoadoutError } from '../src/ships/index.ts';
import {
  addItem,
  addUnits,
  applyLayout,
  applyOp,
  BASE_STACK_MAX,
  capacity,
  checkItem,
  compact,
  countOf,
  dropCargo,
  emptyInventory,
  freeSlots,
  INVENTORY_ITEM_IDS,
  inventorySchema,
  itemInfo,
  layoutFor,
  layoutOf,
  mergeStack,
  moveStack,
  parseInventory,
  parseOp,
  POD_STACKS,
  roomFor,
  slotAt,
  spendUnits,
  splitStack,
  stackCap,
  SUIT_STACKS,
  takeItem,
  totals,
  transferStack,
  usedSlots,
  type Inventory,
  type InventoryLoadout,
  type InventoryOp,
  type Result,
  type SlotRef,
} from '../src/inventory/index.ts';

/** A ship of this hull carrying every pod its bays take (Pack Mule adds a bay), and the skills. */
const at = (hull: HullId | null, skills: string[] = []): InventoryLoadout => ({
  ship: hull && { hull, modules: {}, cargoPods: getHull(hull).cargoPods + (skills.includes('pack_mule') ? 1 : 0), livery: 0 },
  skills,
});

const suit = (i: number): SlotRef => ({ c: 'suit', i });
const pod = (p: number, i: number): SlotRef => ({ c: 'pod', p, i });

/** Unwraps a result that must have succeeded. */
function ok<T extends object>(r: Result<T>): Extract<Result<T>, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r;
}
function code(r: Result<object>): string {
  return r.ok ? 'ok' : r.error.code;
}

const lark = () => emptyInventory(layoutFor(at('lark')), 2500);
const mule = () => emptyInventory(layoutFor(at('mule')));
/** A frozen inventory built by adds, so any mutation by an op throws. */
function filled(base: Inventory, adds: [string, number][]): Inventory {
  let inv = base;
  for (const [item, n] of adds) inv = ok(addItem(inv, item, n)).inv;
  return deepFreeze(inv);
}

describe('inventory: items and the value', () => {
  it('holds every resource and item of the tables, and nothing else', () => {
    expect(INVENTORY_ITEM_IDS).toEqual([...RESOURCES.map((r) => r.id), ...ITEMS.map((i) => i.id)]);
    expect(checkItem('count_residue')).toBeNull(); // DESIGN 15.2: a material, tradeable
    expect(checkItem('warp_cell')).toBeNull();
    for (const id of ['fragment', 'fragments', 'skill_point', 'reputation']) expect(checkItem(id)?.code, id).toBe('non_tradeable');
    for (const id of ['units', 'unobtainium', '', 42, null]) expect(checkItem(id)?.code, String(id)).toBe('unknown_item');
  });

  it('stacks resources and consumables to the cap; modules, cosmetics and components one per slot', () => {
    expect(stackCap('ferrite', BASE_STACK_MAX)).toBe(9999);
    expect(stackCap('warp_cell', 15000)).toBe(15000);
    for (const id of ['pulse_lasers', 'cargo_pod', 'sarelun_livery', 'hive_heart_core']) expect(stackCap(id, 9999), id).toBe(1);
    expect(itemInfo('gold')).toMatchObject({ name: 'Gold', kind: 'resource', single: false });
    expect(itemInfo('nope')).toBeNull();
  });

  it('accepts an empty and a filled inventory, and keeps non-tradeable fields and bad stacks out', () => {
    const inv = filled(lark(), [
      ['ferrite', 120],
      ['pulse_lasers', 1],
    ]);
    expect(inventorySchema.parse(inv)).toEqual(inv);
    expect(ok(parseInventory(JSON.parse(JSON.stringify(inv)))).inv).toEqual(inv);
    const bad: [string, unknown][] = [
      ['fragments field', { ...inv, fragments: 3 }],
      ['reputation field', { ...inv, reputation: { compact: 200 } }],
      ['fragment item', { ...inv, suit: [{ item: 'fragment', count: 1 }, ...inv.suit.slice(1)] }],
      ['unknown item', { ...inv, suit: [{ item: 'unobtainium', count: 1 }, ...inv.suit.slice(1)] }],
      ['stack over cap', { ...inv, suit: [{ item: 'ferrite', count: 10000 }, ...inv.suit.slice(1)] }],
      ['two modules in a slot', { ...inv, suit: [{ item: 'pulse_lasers', count: 2 }, ...inv.suit.slice(1)] }],
      ['zero count', { ...inv, suit: [{ item: 'ferrite', count: 0 }, ...inv.suit.slice(1)] }],
      ['negative units', { ...inv, units: -1 }],
      ['fractional units', { ...inv, units: 1.5 }],
      ['too many pods', { ...inv, pods: Array.from({ length: 33 }, () => []) }],
    ];
    for (const [what, v] of bad) expect(code(parseInventory(v)), what).toBe('invalid_inventory');
  });
});

describe('inventory: layout from the hull and Pack Mule', () => {
  it('gives every hull its cargo pods from the table (DESIGN 10.2)', () => {
    for (const h of HULLS) {
      const l = layoutFor(at(h.id));
      expect(l, h.id).toEqual({ suitStacks: SUIT_STACKS, pods: h.cargoPods, podStacks: POD_STACKS, stackMax: 9999 });
    }
    expect(layoutFor(at('lark')).pods).toBe(1);
    expect(layoutFor(at('mule')).pods).toBe(4);
    expect(layoutFor(at('longhaul')).pods).toBe(16);
    expect(layoutFor(at(null)).pods).toBe(0);
  });

  it('reads Pack Mule from the skill node: stacks 9999 → 15000 and +1 pod on the ship (DESIGN 9.8)', () => {
    expect(layoutFor(at('lark', ['pack_mule']))).toMatchObject({ pods: 2, stackMax: 15000 });
    expect(layoutFor(at('dart', ['pack_mule'])).pods).toBe(1);
    expect(layoutFor(at(null, ['pack_mule']))).toMatchObject({ pods: 0, stackMax: 15000 });
    expect(layoutFor(at('mule', ['long_jump']))).toMatchObject({ pods: 4, stackMax: 9999 });
    expect(() => layoutFor(at('zeppelin' as HullId))).toThrow();
  });

  it('takes the pods aboard from the ship loadout, held to the bays shipStats gives', () => {
    const ship = (hull: HullId, cargoPods: number) => ({ hull, modules: {}, cargoPods, livery: 0 });
    expect(layoutFor({ ship: ship('mule', 2) }).pods).toBe(2); // two of four bays fitted
    expect(layoutFor({ ship: ship('lark', 0) }).pods).toBe(0);
    expect(() => layoutFor({ ship: ship('lark', 2) })).toThrow(LoadoutError); // a second pod needs Pack Mule's bay
    expect(layoutFor({ ship: ship('lark', 2), skills: ['pack_mule'] }).pods).toBe(2);
    expect(() => layoutFor({ ship: { ...ship('lark', 1), modules: { s1: 'railgun' } } })).toThrow(LoadoutError);
    expect(() => layoutFor({ ship: null, skills: ['no_such_node'] })).toThrow();
  });

  it('builds the empty layout and reads it back', () => {
    const inv = mule();
    expect(inv.suit).toHaveLength(SUIT_STACKS);
    expect(inv.pods).toHaveLength(4);
    expect(inv.pods.every((p) => p.length === POD_STACKS && p.every((s) => s === null))).toBe(true);
    expect(layoutOf(inv)).toEqual(layoutFor(at('mule')));
    expect(capacity(inv)).toEqual({ suit: 16, cargo: 32 });
  });
});

describe('inventory: add', () => {
  it('fills the suit first, topping up stacks before empty slots, then overflows into the cargo pods', () => {
    let inv = filled(lark(), [['ferrite', 50]]);
    inv = ok(addItem(inv, 'carbon', 10)).inv;
    const r = ok(addItem(inv, 'ferrite', 9999 + 9999 * 15 + 30));
    expect(r.added).toBe(9999 + 9999 * 15 + 30);
    expect(r.remainder).toBe(0);
    expect(slotAt(r.inv, suit(0))).toEqual({ item: 'ferrite', count: 9999 });
    expect(slotAt(r.inv, suit(1))).toEqual({ item: 'carbon', count: 10 });
    expect(r.inv.suit.slice(2).every((s) => s?.item === 'ferrite' && s.count === 9999)).toBe(true);
    // the suit holds 15 full stacks of it beside the carbon; the rest, 50 more than 9999 + 30, spills into the pod
    expect(countOf(r.inv, 'ferrite', 'suit')).toBe(9999 * 15);
    expect(countOf(r.inv, 'ferrite', 'cargo')).toBe(9999 + 80);
    expect(r.inv.pods[0]!.slice(0, 3)).toEqual([{ item: 'ferrite', count: 9999 }, { item: 'ferrite', count: 80 }, null]);
  });

  it('reports what does not fit, or refuses it whole with partial: false', () => {
    const full = filled(lark(), [['tritium', 9999 * (SUIT_STACKS + POD_STACKS) - 5]]);
    const r = ok(addItem(full, 'tritium', 12));
    expect([r.added, r.remainder]).toEqual([5, 7]);
    expect(countOf(r.inv, 'tritium')).toBe(9999 * 24);
    const none = ok(addItem(r.inv, 'carbon', 3));
    expect([none.added, none.remainder]).toEqual([0, 3]);
    expect(none.inv).toBe(r.inv);
    expect(code(addItem(full, 'tritium', 12, { partial: false }))).toBe('no_room');
  });

  it('adds only to the suit or only to the cargo when asked', () => {
    const r = ok(addItem(lark(), 'gold', 20, { to: 'cargo' }));
    expect(countOf(r.inv, 'gold', 'suit')).toBe(0);
    expect(slotAt(r.inv, pod(0, 0))).toEqual({ item: 'gold', count: 20 });
    const s = ok(addItem(filled(lark(), [['carbon', 9999 * SUIT_STACKS]]), 'carbon', 4, { to: 'suit' }));
    expect(s.remainder).toBe(4);
    expect(code(addItem(emptyInventory(layoutFor(at(null))), 'gold', 1, { to: 'cargo', partial: false }))).toBe('no_room');
  });

  it('puts one module per slot', () => {
    const r = ok(addItem(lark(), 'pulse_lasers', 3));
    expect(r.inv.suit.slice(0, 3)).toEqual([1, 1, 1].map((count) => ({ item: 'pulse_lasers', count })));
  });

  it('validates the item and the count', () => {
    const inv = lark();
    expect(code(addItem(inv, 'unobtainium', 1))).toBe('unknown_item');
    expect(code(addItem(inv, 'fragment', 1))).toBe('non_tradeable');
    for (const n of [0, -1, 1.5, NaN, Infinity, 2e9]) expect(code(addItem(inv, 'ferrite', n)), String(n)).toBe('bad_count');
  });

  it('honours Pack Mule stacks', () => {
    const inv = emptyInventory(layoutFor(at('lark', ['pack_mule'])));
    expect(slotAt(ok(addItem(inv, 'ferrite', 15000)).inv, suit(0))).toEqual({ item: 'ferrite', count: 15000 });
  });
});

describe('inventory: take', () => {
  const inv = filled(lark(), [
    ['oxygen', 9999 + 40],
    ['carbon', 5],
  ]);
  const withCargo = deepFreeze(ok(addItem(inv, 'oxygen', 100, { to: 'cargo' })).inv);

  it('takes from the suit first, the last stack first, then the cargo', () => {
    const r = ok(takeItem(withCargo, 'oxygen', 30));
    expect(slotAt(r.inv, suit(0))).toEqual({ item: 'oxygen', count: 9999 });
    expect(slotAt(r.inv, suit(1))).toEqual({ item: 'oxygen', count: 10 });
    const all = ok(takeItem(withCargo, 'oxygen', 9999 + 40 + 60));
    expect(countOf(all.inv, 'oxygen', 'suit')).toBe(0);
    expect(slotAt(all.inv, pod(0, 0))).toEqual({ item: 'oxygen', count: 40 });
    expect(slotAt(all.inv, suit(2))).toEqual({ item: 'carbon', count: 5 });
  });

  it('takes from one container when asked, all or nothing', () => {
    expect(ok(takeItem(withCargo, 'oxygen', 100, { from: 'cargo' })).inv.pods[0]![0]).toBeNull();
    expect(code(takeItem(withCargo, 'oxygen', 101, { from: 'cargo' }))).toBe('not_enough');
    expect(code(takeItem(withCargo, 'carbon', 6))).toBe('not_enough');
    expect(code(takeItem(withCargo, 'gold', 1))).toBe('not_enough');
    expect(code(takeItem(withCargo, 'fragments', 1))).toBe('non_tradeable');
    expect(code(takeItem(withCargo, 'carbon', -2))).toBe('bad_count');
  });
});

describe('inventory: moving stacks', () => {
  const inv = filled(lark(), [
    ['ferrite', 9000],
    ['carbon', 300],
    ['ferrite', 1500],
  ]); // suit 0: ferrite 9999, 1: carbon 300, 2: ferrite 501

  it('moves a stack or part of one into an empty slot', () => {
    const r = ok(moveStack(inv, suit(1), pod(0, 3)));
    expect([slotAt(r.inv, suit(1)), slotAt(r.inv, pod(0, 3))]).toEqual([null, { item: 'carbon', count: 300 }]);
    const p = ok(moveStack(inv, suit(1), suit(9), 120));
    expect([slotAt(p.inv, suit(1)), slotAt(p.inv, suit(9))]).toEqual([
      { item: 'carbon', count: 180 },
      { item: 'carbon', count: 120 },
    ]);
  });

  it('merges partially and refuses a full stack', () => {
    const half = filled(lark(), [
      ['ferrite', 9990],
      ['carbon', 1],
    ]);
    const two = ok(addItem(half, 'ferrite', 30, { to: 'cargo' })).inv;
    const r = ok(moveStack(two, pod(0, 0), suit(0)));
    expect(r.moved).toBe(9);
    expect([slotAt(r.inv, suit(0)), slotAt(r.inv, pod(0, 0))]).toEqual([
      { item: 'ferrite', count: 9999 },
      { item: 'ferrite', count: 21 },
    ]);
    expect(code(moveStack(r.inv, pod(0, 0), suit(0)))).toBe('stack_full');
  });

  it('swaps whole stacks of different items, and refuses part of one', () => {
    const r = ok(moveStack(inv, suit(0), suit(1)));
    expect([slotAt(r.inv, suit(0)), slotAt(r.inv, suit(1))]).toEqual([
      { item: 'carbon', count: 300 },
      { item: 'ferrite', count: 9999 },
    ]);
    expect(code(moveStack(inv, suit(0), suit(1), 10))).toBe('item_mismatch');
  });

  it('refuses bad slots, the same slot, an empty source and bad counts', () => {
    expect(code(moveStack(inv, suit(16), suit(3)))).toBe('bad_slot');
    expect(code(moveStack(inv, suit(0), pod(1, 0)))).toBe('bad_slot'); // a Lark has one pod
    expect(code(moveStack(inv, suit(0), pod(0, 8)))).toBe('bad_slot');
    expect(code(moveStack(inv, suit(0), suit(0)))).toBe('same_slot');
    expect(code(moveStack(inv, suit(5), suit(6)))).toBe('empty_slot');
    expect(code(moveStack(inv, suit(1), suit(6), 301))).toBe('bad_count');
    expect(code(moveStack(inv, suit(1), suit(6), 0))).toBe('bad_count');
  });

  it('splits into the first empty slot of the same container, the same pod first', () => {
    const r = ok(splitStack(inv, suit(1), 100));
    expect(r.to).toEqual(suit(3));
    expect([slotAt(r.inv, suit(1)), slotAt(r.inv, suit(3))]).toEqual([
      { item: 'carbon', count: 200 },
      { item: 'carbon', count: 100 },
    ]);
    const m = deepFreeze(ok(addItem(mule(), 'gold', 40, { to: 'cargo' })).inv);
    const moved = ok(moveStack(m, pod(0, 0), pod(2, 5)));
    expect(ok(splitStack(moved.inv, pod(2, 5), 10)).to).toEqual(pod(2, 0));
  });

  it('splits into a named empty slot, and refuses what cannot split', () => {
    expect(slotAt(ok(splitStack(inv, suit(1), 1, pod(0, 7))).inv, pod(0, 7))).toEqual({ item: 'carbon', count: 1 });
    expect(code(splitStack(inv, suit(1), 1, suit(0)))).toBe('slot_occupied');
    expect(code(splitStack(inv, suit(1), 300))).toBe('bad_count');
    expect(code(splitStack(inv, suit(1), 0))).toBe('bad_count');
    expect(code(splitStack(filled(lark(), [['pulse_lasers', 1]]), suit(0), 1))).toBe('bad_count');
    expect(code(splitStack(inv, suit(9), 1))).toBe('empty_slot');
    expect(code(splitStack(inv, pod(3, 0), 1))).toBe('bad_slot');
    const full = filled(lark(), [['carbon', 9999 * SUIT_STACKS - 10]]);
    expect(code(splitStack(full, suit(15), 2))).toBe('no_room');
  });

  it('merges only the same item onto a stack, while it has room', () => {
    expect(code(mergeStack(inv, suit(2), suit(0)))).toBe('stack_full');
    const tops = filled(lark(), [['carbon', 10]]);
    const two = ok(splitStack(tops, suit(0), 4)).inv;
    expect(slotAt(ok(mergeStack(two, suit(1), suit(0))).inv, suit(0))).toEqual({ item: 'carbon', count: 10 });
    expect(code(mergeStack(inv, suit(1), suit(0)))).toBe('item_mismatch');
    expect(code(mergeStack(inv, suit(1), suit(7)))).toBe('empty_slot');
  });

  it('transfers across, topping up stacks of the item there first', () => {
    const base = deepFreeze(ok(addItem(inv, 'carbon', 50, { to: 'cargo' })).inv);
    const r = ok(transferStack(base, suit(1)));
    expect(r.moved).toBe(300);
    expect(slotAt(r.inv, suit(1))).toBeNull();
    expect(slotAt(r.inv, pod(0, 0))).toEqual({ item: 'carbon', count: 350 });
    const back = ok(transferStack(r.inv, pod(0, 0), 50));
    expect(slotAt(back.inv, suit(1))).toEqual({ item: 'carbon', count: 50 });
    expect(slotAt(back.inv, pod(0, 0))).toEqual({ item: 'carbon', count: 300 });
  });

  it('transfers as much as fits, and refuses when nothing does or there is no ship', () => {
    const cargoFull = deepFreeze(ok(addItem(filled(lark(), [['carbon', 7]]), 'tritium', 9999 * POD_STACKS, { to: 'cargo' })).inv);
    expect(code(transferStack(cargoFull, suit(0)))).toBe('no_room');
    // seven full pod stacks and one of 999 leave room for 9000 of a 9999 stack
    const nearly = deepFreeze(ok(addItem(filled(lark(), [['tritium', 9999]]), 'tritium', 9999 * POD_STACKS - 9000, { to: 'cargo' })).inv);
    const tri = ok(transferStack(nearly, suit(0)));
    expect(tri.moved).toBe(9000);
    expect(slotAt(tri.inv, suit(0))).toEqual({ item: 'tritium', count: 999 });
    expect(countOf(tri.inv, 'tritium', 'cargo')).toBe(9999 * POD_STACKS);
    const shipless = filled(emptyInventory(layoutFor(at(null))), [['carbon', 3]]);
    const nope = transferStack(shipless, suit(0));
    expect(code(nope)).toBe('no_room');
    expect(!nope.ok && nope.error.message).toMatch(/no ship/);
  });

  it('compacts partial stacks in first-appearance order and closes the gaps', () => {
    let m = mule();
    m = ok(addItem(m, 'gold', 30, { to: 'cargo' })).inv;
    m = ok(addItem(m, 'carbon', 30, { to: 'cargo' })).inv;
    m = ok(moveStack(m, pod(0, 1), pod(3, 7))).inv;
    m = ok(splitStack(m, pod(0, 0), 10, pod(2, 2))).inv;
    m = ok(addItem(m, 'pulse_lasers', 2, { to: 'cargo' })).inv;
    const r = ok(compact(deepFreeze(m), 'cargo'));
    expect(r.inv.pods[0]!.slice(0, 5)).toEqual([
      { item: 'gold', count: 30 },
      { item: 'pulse_lasers', count: 1 },
      { item: 'pulse_lasers', count: 1 },
      { item: 'carbon', count: 30 },
      null,
    ]);
    expect(usedSlots(r.inv, 'cargo')).toBe(4);
    expect(ok(compact(r.inv, 'suit')).inv.suit).toEqual(r.inv.suit);
  });
});

describe('inventory: queries and units', () => {
  const inv = filled(lark(), [
    ['ferrite', 120],
    ['gold', 30],
    ['ferrite', 5],
  ]);

  it('counts, totals and measures room', () => {
    expect(countOf(inv, 'ferrite')).toBe(125);
    expect(totals(inv)).toEqual({ ferrite: 125, gold: 30 });
    expect(Object.keys(totals(inv))).toEqual(['ferrite', 'gold']);
    expect(totals(inv, 'cargo')).toEqual({});
    expect(roomFor(inv, 'ferrite', 'suit')).toBe(9999 - 125 + 14 * 9999);
    expect(roomFor(inv, 'ferrite')).toBe(9999 - 125 + 14 * 9999 + 8 * 9999);
    expect(roomFor(inv, 'pulse_lasers', 'cargo')).toBe(8);
    expect(roomFor(inv, 'fragment')).toBe(0);
    expect([freeSlots(inv, 'suit'), usedSlots(inv, 'suit'), freeSlots(inv, 'cargo')]).toEqual([14, 2, 8]);
  });

  it('adds and spends units', () => {
    expect(ok(addUnits(inv, 500)).inv.units).toBe(3000);
    expect(ok(spendUnits(inv, 2500)).inv.units).toBe(0);
    expect(code(spendUnits(inv, 2501))).toBe('not_enough');
    expect(code(addUnits(inv, -5))).toBe('bad_count');
    expect(code(spendUnits(inv, 0.5))).toBe('bad_count');
    expect(code(addUnits({ ...inv, units: Number.MAX_SAFE_INTEGER }, 1))).toBe('bad_count');
  });
});

describe('inventory: the death drop and new hulls', () => {
  const inv = deepFreeze(
    ok(
      addItem(
        filled(mule(), [
          ['oxygen', 40],
          ['warp_cell', 1],
        ]),
        'gold',
        9999 + 20,
        { to: 'cargo' },
      ),
    ).inv,
  );

  it('drops every pod’s stacks and keeps the suit (DESIGN 7, 10.1)', () => {
    const moved = ok(moveStack(inv, pod(0, 1), pod(3, 4))).inv;
    const r = dropCargo(moved);
    expect(r.drop.stacks).toEqual([
      { item: 'gold', count: 9999 },
      { item: 'gold', count: 20 },
    ]);
    expect(r.inv.suit).toEqual(inv.suit);
    expect(r.inv.pods).toHaveLength(4);
    expect(usedSlots(r.inv, 'cargo')).toBe(0);
    expect(r.inv.units).toBe(inv.units);
    const again = dropCargo(r.inv);
    expect(again.drop.stacks).toEqual([]);
    expect(again.inv).toBe(r.inv);
  });

  it('reshapes to a smaller hull, repacking stacks from removed pods', () => {
    const spread = ok(moveStack(inv, pod(0, 1), pod(3, 4))).inv;
    const r = ok(applyLayout(spread, layoutFor(at('lark'))));
    expect(r.inv.pods).toHaveLength(1);
    expect(countOf(r.inv, 'gold')).toBe(9999 + 20);
    expect(slotAt(r.inv, pod(0, 0))).toEqual({ item: 'gold', count: 9999 });
    expect(slotAt(r.inv, pod(0, 1))).toEqual({ item: 'gold', count: 20 });
    expect(ok(applyLayout(r.inv, layoutFor(at('mule')))).inv.pods).toHaveLength(4);
  });

  it('refuses a layout that cannot hold everything, and splits stacks over a lowered cap', () => {
    const packed = filled(emptyInventory(layoutFor(at('lark', ['pack_mule']))), [['ferrite', 15000 * 26]]);
    expect(code(applyLayout(packed, layoutFor(at('lark'))))).toBe('no_room');
    const light = filled(emptyInventory(layoutFor(at('lark', ['pack_mule']))), [['ferrite', 15000]]);
    const r = ok(applyLayout(light, layoutFor(at('lark'))));
    expect(r.inv.stackMax).toBe(9999);
    expect(r.inv.suit.slice(0, 2)).toEqual([
      { item: 'ferrite', count: 9999 },
      { item: 'ferrite', count: 5001 },
    ]);
    expect(inventorySchema.safeParse(r.inv).success).toBe(true);
  });

  it('loses the pods with the ship: no hull, no cargo', () => {
    const dropped = dropCargo(inv).inv;
    const r = ok(applyLayout(dropped, layoutFor(at(null))));
    expect(r.inv.pods).toEqual([]);
    expect(r.inv.suit).toEqual(inv.suit);
  });
});

describe('inventory: client ops', () => {
  it('parses what a client may send and refuses anything else', () => {
    const good: InventoryOp[] = [
      { op: 'move', from: suit(0), to: pod(0, 1), count: 5 },
      { op: 'split', from: suit(0), count: 2 },
      { op: 'merge', from: pod(0, 1), to: suit(0) },
      { op: 'transfer', from: suit(3) },
      { op: 'compact', c: 'cargo' },
    ];
    for (const op of good) expect(parseOp(JSON.parse(JSON.stringify(op)))).toEqual({ ok: true, op });
    const bad = [
      { op: 'add', item: 'gold', count: 1 },
      { op: 'move', from: suit(-1), to: suit(1) },
      { op: 'move', from: suit(0), to: { c: 'pod', p: 40, i: 0 } },
      { op: 'move', from: suit(0), to: suit(1), count: 0 },
      { op: 'move', from: suit(0), to: suit(1), count: 1.5 },
      { op: 'split', from: suit(0) },
      { op: 'transfer', from: suit(0), units: 5 },
      { op: 'compact', c: 'ship' },
      'move',
      null,
    ];
    for (const b of bad) expect(code(parseOp(b) as Result), JSON.stringify(b)).toBe('invalid_op');
  });

  it('applies each op through its operation', () => {
    const inv = filled(lark(), [['carbon', 20]]);
    expect(applyOp(inv, { op: 'move', from: suit(0), to: suit(4) })).toEqual(moveStack(inv, suit(0), suit(4)));
    expect(applyOp(inv, { op: 'split', from: suit(0), count: 5 })).toEqual(splitStack(inv, suit(0), 5));
    expect(applyOp(inv, { op: 'transfer', from: suit(0) })).toEqual(transferStack(inv, suit(0)));
    expect(code(applyOp(inv, { op: 'merge', from: suit(0), to: suit(1) }))).toBe('empty_slot');
    expect(applyOp(inv, { op: 'compact', c: 'suit' })).toEqual(compact(inv, 'suit'));
  });

  it('conserves what is held and stays valid under a long seeded run of random ops, deterministically', () => {
    const run = (seed: number) => {
      let s = seed >>> 0;
      const rnd = (n: number) => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s % n;
      };
      let inv: Inventory = emptyInventory(layoutFor(at('mule')));
      for (const [item, n] of [
        ['ferrite', 23000],
        ['carbon', 700],
        ['gold', 31],
        ['pulse_lasers', 2],
        ['warp_cell', 3],
      ] as const)
        inv = ok(addItem(inv, item, n)).inv;
      const before = totals(inv);
      const ref = (): SlotRef => (rnd(2) ? suit(rnd(SUIT_STACKS + 1)) : pod(rnd(5), rnd(POD_STACKS + 1)));
      const codes: string[] = [];
      for (let k = 0; k < 2000; k++) {
        const ops: InventoryOp[] = [
          { op: 'move', from: ref(), to: ref(), ...(rnd(2) ? { count: 1 + rnd(4000) } : {}) },
          { op: 'split', from: ref(), count: 1 + rnd(3000), ...(rnd(2) ? { to: ref() } : {}) },
          { op: 'merge', from: ref(), to: ref() },
          { op: 'transfer', from: ref(), ...(rnd(2) ? { count: 1 + rnd(5000) } : {}) },
          { op: 'compact', c: rnd(2) ? 'suit' : 'cargo' },
        ];
        const r = applyOp(inv, ops[rnd(ops.length)]!);
        codes.push(code(r));
        if (r.ok) inv = r.inv;
      }
      expect(inventorySchema.safeParse(inv).success).toBe(true);
      const after = totals(inv);
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      for (const k of Object.keys(before)) expect(after[k], k).toBe(before[k]);
      return { inv, codes };
    };
    const a = run(42);
    expect(new Set(a.codes).size).toBeGreaterThan(5);
    expect(run(42)).toEqual(a);
  });
});
