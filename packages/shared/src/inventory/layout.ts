// An inventory's shape: suit stacks, cargo pods and the stack cap. The pods are the ship's own: its loadout says how many it
// carries and `shipStats` how many bays the hull and Pack Mule give (DESIGN 10.2, 9.8: +1 cargo pod), so the inventory never
// counts pods itself. Pack Mule's stack cap (9999 → 15000) is a suit stat, read from the skill node's modifier.
import { getSkillNode } from '../data/index.ts';
import { applyMods, shipStats, type ShipLoadout } from '../ships/index.ts';
import { addItem, fail, type Result } from './ops.ts';
import { BASE_STACK_MAX, POD_STACKS, stackCap, SUIT_STACKS, type Container, type Inventory, type Slot, type Stack } from './schema.ts';

export interface InventoryLayout {
  suitStacks: number;
  pods: number;
  podStacks: number;
  stackMax: number;
}

/** What an inventory's layout follows: the ship flown and the character's skills. */
export interface InventoryLoadout {
  /** The ship (null: none, so no cargo pods). Its `cargoPods` are the pods aboard. */
  ship: ShipLoadout | null;
  /** Skill nodes the character owns. */
  skills?: Iterable<string>;
}

/**
 * The layout for a loadout: one cargo pod in the inventory per pod aboard the ship, which `shipStats` checks against the
 * bays (it throws a LoadoutError for a ship carrying more pods than it has bays, or one that cannot fly). Only a skill's
 * unconditional modifiers count for the stack cap (Pack Mule's are).
 */
export function layoutFor({ ship, skills = [] }: InventoryLoadout): InventoryLayout {
  const owned = [...skills];
  if (ship) shipStats(ship, { skills: owned });
  const mods = owned.flatMap((id) => getSkillNode(id).mods).filter((m) => !m.when && !m.branch && !m.nodes);
  const stackMax = Math.round(applyMods(BASE_STACK_MAX, 'suit.stack_max', mods));
  return { suitStacks: SUIT_STACKS, pods: ship ? ship.cargoPods : 0, podStacks: POD_STACKS, stackMax };
}

/** An empty inventory of this layout. */
export function emptyInventory(layout: InventoryLayout, units = 0): Inventory {
  return {
    stackMax: layout.stackMax,
    units,
    suit: Array.from({ length: layout.suitStacks }, () => null),
    pods: Array.from({ length: layout.pods }, () => Array.from({ length: layout.podStacks }, () => null)),
  };
}

/** What a new character carries (a choice, logged in DECISIONS: the demo's opening balance and one warp cell, in the suit). */
export const STARTING_KIT: { units: number; stacks: readonly Stack[] } = { units: 2500, stacks: [{ item: 'warp_cell', count: 1 }] };

/** A new character's inventory in this layout. */
export function startingInventory(layout: InventoryLayout): Inventory {
  let inv = emptyInventory(layout, STARTING_KIT.units);
  for (const s of STARTING_KIT.stacks) {
    const r = addItem(inv, s.item, s.count, { to: 'suit', partial: false });
    if (r.ok) inv = r.inv;
  }
  return inv;
}

/** The layout an inventory has now. */
export function layoutOf(inv: Inventory): InventoryLayout {
  return { suitStacks: inv.suit.length, pods: inv.pods.length, podStacks: inv.pods[0]?.length ?? POD_STACKS, stackMax: inv.stackMax };
}

/**
 * Reshapes an inventory to a new layout: another hull's pod count, Pack Mule bought or respecced away. Stacks keep their
 * slots where those still exist and fit under the new cap; whatever is displaced (a removed pod's stacks, units over a
 * lowered cap) is added back to the container it came from first, then the other. When it cannot all fit, nothing changes
 * and the result is `no_room`, so the caller decides (sell the cargo first, or refuse the swap). Units are untouched.
 */
export function applyLayout(inv: Inventory, layout: InventoryLayout): Result {
  const displaced: { stack: Stack; from: Container }[] = [];
  const keep = (s: Slot | undefined, from: Container): Slot => {
    if (!s) return null;
    const cap = stackCap(s.item, layout.stackMax);
    if (s.count <= cap) return s;
    displaced.push({ stack: { item: s.item, count: s.count - cap }, from });
    return { item: s.item, count: cap };
  };
  const out: Inventory = {
    stackMax: layout.stackMax,
    units: inv.units,
    suit: Array.from({ length: layout.suitStacks }, (_, i) => keep(inv.suit[i], 'suit')),
    pods: Array.from({ length: layout.pods }, (_, p) => Array.from({ length: layout.podStacks }, (_, i) => keep(inv.pods[p]?.[i], 'cargo'))),
  };
  inv.suit.slice(layout.suitStacks).forEach((s) => s && displaced.push({ stack: s, from: 'suit' }));
  inv.pods.forEach((pod, p) => pod.forEach((s, i) => s && (p >= layout.pods || i >= layout.podStacks) && displaced.push({ stack: s, from: 'cargo' })));
  let next = out;
  for (const { stack, from } of displaced) {
    let left = stack.count;
    for (const to of [from, from === 'suit' ? 'cargo' : 'suit'] as const) {
      if (!left) break;
      const r = addItem(next, stack.item, left, { to });
      if (!r.ok) return r;
      next = r.inv;
      left = r.remainder;
    }
    if (left) return fail('no_room', 'the new layout cannot hold everything');
  }
  return { ok: true, inv: next };
}
