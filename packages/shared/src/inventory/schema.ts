// The inventory value (DESIGN 10.1): the suit's stacks stay with the character through the Recall; the ship's cargo pods go
// down with the ship and drop where it died. Only tradeable things live here: resources and items in stacks, and units.
// Fragments, skill points and reputation are never items (DESIGN 15.2, 15.5); they belong to the skill and faction state, so
// the schema is strict and has no field for them.
import { z } from 'zod';
import { ITEMS, RESOURCES, type ItemKind } from '../data/index.ts';

/** Stacks the suit holds. DESIGN gives no number; a choice (logged in DECISIONS): enough for a mining trip on foot, few
 * enough that hauling belongs to the ship. */
export const SUIT_STACKS = 16;
/** Stacks one cargo pod holds (a choice, as SUIT_STACKS). The pod count comes from the hull (DESIGN 10.2) and Pack Mule. */
export const POD_STACKS = 8;
/** Units of one item per stack before Pack Mule (DESIGN 9.8: 9999 → 15000; the skill node's `suit.stack_max` sets it). */
export const BASE_STACK_MAX = 9999;

/** Bounds any layout stays inside, so the wire and persistence schemas can cap every array and number. */
export const MAX_SUIT_STACKS = 64;
export const MAX_PODS = 32;
export const MAX_POD_STACKS = 64;
export const MAX_STACK = 1_000_000;
export const MAX_UNITS = Number.MAX_SAFE_INTEGER;
/** The most one add may ask for (it spills across stacks). */
export const MAX_ADD = 1_000_000_000;

/** Things that must never become inventory items (DESIGN 15.2, 15.5: fragments, skill points and reputation are never
 * tradeable), refused with their own error rather than as unknown ids. */
export const NON_TRADEABLE: readonly string[] = ['fragment', 'fragments', 'skill_point', 'skill_points', 'reputation'];

/** Item kinds that never stack: a module, a cosmetic or a component is one thing per slot. */
const SINGLE_KINDS: readonly ItemKind[] = ['module', 'cosmetic', 'component'];

export interface ItemInfo {
  id: string;
  name: string;
  kind: 'resource' | ItemKind;
  /** One per slot (modules, cosmetics, components) rather than a stack. */
  single: boolean;
}

const CATALOG: ReadonlyMap<string, ItemInfo> = new Map<string, ItemInfo>([
  ...RESOURCES.map((r) => [r.id, { id: r.id, name: r.name, kind: 'resource', single: false }] as const),
  ...ITEMS.map((i) => [i.id, { id: i.id, name: i.name, kind: i.kind, single: SINGLE_KINDS.includes(i.kind) }] as const),
]);

/** What an inventory knows about an item id (a resource or an entry of the item registry), or null for anything else. */
export function itemInfo(id: string): ItemInfo | null {
  return CATALOG.get(id) ?? null;
}

/** Every id an inventory may hold, resources first, in table order. */
export const INVENTORY_ITEM_IDS: readonly string[] = [...CATALOG.keys()];

/** Units of `item` one stack holds under `stackMax`. */
export function stackCap(item: string, stackMax: number): number {
  return itemInfo(item)?.single ? 1 : stackMax;
}

export const INVENTORY_ERROR_CODES = [
  'invalid_inventory',
  'invalid_op',
  'unknown_item',
  'non_tradeable',
  'bad_count',
  'bad_slot',
  'empty_slot',
  'same_slot',
  'slot_occupied',
  'item_mismatch',
  'stack_full',
  'no_room',
  'not_enough',
  'stale_seq',
] as const;
export const inventoryErrorCodeSchema = z.enum(INVENTORY_ERROR_CODES);
export type InventoryErrorCode = z.infer<typeof inventoryErrorCodeSchema>;
export interface InventoryError {
  code: InventoryErrorCode;
  message: string;
}

/** Why `id` cannot be an inventory item, or null when it can. */
export function checkItem(id: unknown): InventoryError | null {
  if (typeof id === 'string' && NON_TRADEABLE.includes(id)) return { code: 'non_tradeable', message: `${id} is never an item` };
  if (typeof id !== 'string' || !CATALOG.has(id)) return { code: 'unknown_item', message: `unknown item ${String(id).slice(0, 48)}` };
  return null;
}

const itemIdSchema = z.string().min(1).max(48);
export const stackSchema = z.strictObject({ item: itemIdSchema, count: z.int().min(1).max(MAX_STACK) });
export type Stack = z.infer<typeof stackSchema>;
/** A slot holds one stack or nothing. */
export const slotSchema = stackSchema.nullable();
export type Slot = z.infer<typeof slotSchema>;

export const inventorySchema = z
  .strictObject({
    /** Units per stack (Pack Mule raises it). */
    stackMax: z.int().min(1).max(MAX_STACK),
    /** Money (DESIGN 15.2). */
    units: z.int().min(0).max(MAX_UNITS),
    /** The suit's slots; its length is the suit's capacity in stacks. */
    suit: z.array(slotSchema).max(MAX_SUIT_STACKS),
    /** The ship's cargo pods (none without a ship), each an array of slots whose length is the pod's capacity in stacks. */
    pods: z.array(z.array(slotSchema).max(MAX_POD_STACKS)).max(MAX_PODS),
  })
  .superRefine((inv, ctx) => {
    const check = (s: Slot, path: (string | number)[]) => {
      if (!s) return;
      const bad = checkItem(s.item);
      if (bad) ctx.addIssue({ code: 'custom', message: bad.message, path: [...path, 'item'] });
      else if (s.count > stackCap(s.item, inv.stackMax)) ctx.addIssue({ code: 'custom', message: `stack over its cap`, path: [...path, 'count'] });
    };
    inv.suit.forEach((s, i) => check(s, ['suit', i]));
    inv.pods.forEach((pod, p) => pod.forEach((s, i) => check(s, ['pods', p, i])));
  });
export type Inventory = z.infer<typeof inventorySchema>;

/** A slot: one of the suit's, or one of a cargo pod's. */
export const slotRefSchema = z.discriminatedUnion('c', [
  z.strictObject({
    c: z.literal('suit'),
    i: z
      .int()
      .min(0)
      .max(MAX_SUIT_STACKS - 1),
  }),
  z.strictObject({
    c: z.literal('pod'),
    p: z
      .int()
      .min(0)
      .max(MAX_PODS - 1),
    i: z
      .int()
      .min(0)
      .max(MAX_POD_STACKS - 1),
  }),
]);
export type SlotRef = z.infer<typeof slotRefSchema>;
/** The suit, or every cargo pod together. */
export const containerSchema = z.enum(['suit', 'cargo']);
export type Container = z.infer<typeof containerSchema>;

const opCount = z.int().min(1).max(MAX_STACK);
/**
 * What a client may ask of its own inventory (ARCHITECTURE §7: requests the server re-evaluates). Adding, taking and units
 * are never requests: loot, mining, crafting, trade and the Recall change those on the server.
 * - move: a stack (or `count` of it) onto another slot: into an empty one, onto a stack of the same item up to its cap, or
 *   swapped with a different stack when the whole stack moves.
 * - split: `count` off a stack into an empty slot (`to`, or the first empty slot of the same container).
 * - merge: a stack onto another of the same item, as much as fits.
 * - transfer: a stack (or `count` of it) across to the other container, topping up stacks of the item before empty slots.
 * - compact: merges every partial stack of an item in the container and closes the gaps.
 */
export const inventoryOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('move'), from: slotRefSchema, to: slotRefSchema, count: opCount.optional() }),
  z.strictObject({ op: z.literal('split'), from: slotRefSchema, count: opCount, to: slotRefSchema.optional() }),
  z.strictObject({ op: z.literal('merge'), from: slotRefSchema, to: slotRefSchema }),
  z.strictObject({ op: z.literal('transfer'), from: slotRefSchema, count: opCount.optional() }),
  z.strictObject({ op: z.literal('compact'), c: containerSchema }),
]);
export type InventoryOp = z.infer<typeof inventoryOpSchema>;
