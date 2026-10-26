// Pure, deterministic inventory operations. Each takes an inventory and returns a result: `{ ok: true, inv, ... }` with a
// new value (the input is never mutated; untouched slots and stacks are shared), or `{ ok: false, error }` with the input
// unchanged. The server applies them as the authority; the client applies the same functions to predict (ARCHITECTURE §7).
import {
  checkItem,
  inventoryOpSchema,
  inventorySchema,
  MAX_ADD,
  MAX_UNITS,
  stackCap,
  type Container,
  type Inventory,
  type InventoryError,
  type InventoryErrorCode,
  type InventoryOp,
  type Slot,
  type SlotRef,
  type Stack,
} from './schema.ts';

export type Failure = { ok: false; error: InventoryError };
export type Result<T extends object = object> = ({ ok: true; inv: Inventory } & T) | Failure;
/** Where an add goes ('auto': the suit, then the cargo pods) or a take comes from ('auto': the suit first). */
export type Where = Container | 'auto';

export function fail(code: InventoryErrorCode, message: string): Failure {
  return { ok: false, error: { code, message } };
}

function badCount(n: unknown, max: number): Failure | null {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return fail('bad_count', `count must be a whole number of at least 1`);
  if (n > max) return fail('bad_count', `count ${n} is more than ${max}`);
  return null;
}

function clone(inv: Inventory): Inventory {
  return { ...inv, suit: inv.suit.slice(), pods: inv.pods.map((p) => p.slice()) };
}

/** The slot `ref` names: a stack, null for an empty slot, undefined when there is no such slot. */
export function slotAt(inv: Inventory, ref: SlotRef): Slot | undefined {
  if (ref.c === 'suit') return ref.i < inv.suit.length ? inv.suit[ref.i] : undefined;
  const pod = inv.pods[ref.p];
  return pod && ref.i < pod.length ? pod[ref.i] : undefined;
}

function put(inv: Inventory, ref: SlotRef, s: Slot): void {
  if (ref.c === 'suit') inv.suit[ref.i] = s;
  else inv.pods[ref.p]![ref.i] = s;
}

function sameRef(a: SlotRef, b: SlotRef): boolean {
  return a.c === b.c && a.i === b.i && (a.c === 'suit' || a.p === (b as Extract<SlotRef, { c: 'pod' }>).p);
}

/** Every slot of a container, in order (the cargo pods one after another). */
export function slotRefs(inv: Inventory, c: Container): SlotRef[] {
  if (c === 'suit') return inv.suit.map((_, i) => ({ c: 'suit', i }));
  return inv.pods.flatMap((pod, p) => pod.map((_, i) => ({ c: 'pod' as const, p, i })));
}

/** The container a slot belongs to. */
export function containerOf(ref: SlotRef): Container {
  return ref.c === 'suit' ? 'suit' : 'cargo';
}

function containers(where: Where): Container[] {
  return where === 'auto' ? ['suit', 'cargo'] : [where];
}

// ---------- queries ----------

/** Units of `item` held in the suit, the cargo, or both ('auto'). */
export function countOf(inv: Inventory, item: string, where: Where = 'auto'): number {
  let n = 0;
  for (const c of containers(where)) for (const r of slotRefs(inv, c)) if (slotAt(inv, r)?.item === item) n += slotAt(inv, r)!.count;
  return n;
}

/** Units per item across the suit, the cargo, or both, in the order the items first appear. */
export function totals(inv: Inventory, where: Where = 'auto'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of containers(where))
    for (const r of slotRefs(inv, c)) {
      const s = slotAt(inv, r);
      if (s) out[s.item] = (out[s.item] ?? 0) + s.count;
    }
  return out;
}

/** How many more units of `item` would fit in the suit, the cargo, or both. 0 for an item that cannot be held. */
export function roomFor(inv: Inventory, item: string, where: Where = 'auto'): number {
  if (checkItem(item)) return 0;
  const cap = stackCap(item, inv.stackMax);
  let n = 0;
  for (const c of containers(where))
    for (const r of slotRefs(inv, c)) {
      const s = slotAt(inv, r);
      if (!s) n += cap;
      else if (s.item === item) n += cap - s.count;
    }
  return n;
}

/** Empty slots in a container. */
export function freeSlots(inv: Inventory, c: Container): number {
  return slotRefs(inv, c).filter((r) => !slotAt(inv, r)).length;
}

/** Slots holding a stack in a container. */
export function usedSlots(inv: Inventory, c: Container): number {
  return slotRefs(inv, c).length - freeSlots(inv, c);
}

/** Capacity in stacks of the suit and of the cargo pods together. */
export function capacity(inv: Inventory): { suit: number; cargo: number } {
  return { suit: inv.suit.length, cargo: inv.pods.reduce((n, p) => n + p.length, 0) };
}

// ---------- adding and taking ----------

/** Fills `container` with up to `count` of `item`: tops up the item's partial stacks, then takes empty slots, in slot order.
 * Mutates `inv` (a working copy) and returns how many went in. */
function fill(inv: Inventory, c: Container, item: string, count: number): number {
  const cap = stackCap(item, inv.stackMax);
  let left = count;
  const refs = slotRefs(inv, c);
  for (const r of refs) {
    if (!left) break;
    const s = slotAt(inv, r);
    if (s && s.item === item && s.count < cap) {
      const n = Math.min(cap - s.count, left);
      put(inv, r, { item, count: s.count + n });
      left -= n;
    }
  }
  for (const r of refs) {
    if (!left) break;
    if (!slotAt(inv, r)) {
      const n = Math.min(cap, left);
      put(inv, r, { item, count: n });
      left -= n;
    }
  }
  return count - left;
}

/**
 * Adds `count` of `item`. 'auto' fills the suit first and overflows into the cargo pods. What does not fit is reported as
 * `remainder` (the caller decides: leave it in the world, or refuse); with `partial: false` an add that does not fit
 * entirely fails with `no_room` instead.
 */
export function addItem(
  inv: Inventory,
  item: string,
  count: number,
  opts: { to?: Where; partial?: boolean } = {},
): Result<{ added: number; remainder: number }> {
  const bad = checkItem(item);
  if (bad) return { ok: false, error: bad };
  const badN = badCount(count, MAX_ADD);
  if (badN) return badN;
  const out = clone(inv);
  let added = 0;
  for (const c of containers(opts.to ?? 'auto')) added += fill(out, c, item, count - added);
  if (added < count && opts.partial === false) return fail('no_room', `room for ${added} of ${count}`);
  return { ok: true, inv: added ? out : inv, added, remainder: count - added };
}

/** Takes exactly `count` of `item` ('auto': the suit first, then the cargo; within a container, the last stack first). All or
 * nothing: `not_enough` when fewer are held. */
export function takeItem(inv: Inventory, item: string, count: number, opts: { from?: Where } = {}): Result<{ taken: number }> {
  const bad = checkItem(item);
  if (bad) return { ok: false, error: bad };
  const badN = badCount(count, MAX_ADD);
  if (badN) return badN;
  const from = opts.from ?? 'auto';
  const have = countOf(inv, item, from);
  if (have < count) return fail('not_enough', `${have} of ${count} held`);
  const out = clone(inv);
  let left = count;
  for (const c of containers(from)) {
    const refs = slotRefs(out, c);
    for (let k = refs.length - 1; k >= 0 && left; k--) {
      const s = slotAt(out, refs[k]!);
      if (s?.item !== item) continue;
      const n = Math.min(s.count, left);
      put(out, refs[k]!, s.count - n ? { item, count: s.count - n } : null);
      left -= n;
    }
  }
  return { ok: true, inv: out, taken: count };
}

// ---------- moving stacks ----------

/** Both slots exist and differ, and `from` holds a stack. */
function endpoints(inv: Inventory, from: SlotRef, to: SlotRef): Failure | { a: Stack; b: Slot } {
  const a = slotAt(inv, from);
  const b = slotAt(inv, to);
  if (a === undefined || b === undefined) return fail('bad_slot', 'no such slot');
  if (sameRef(from, to)) return fail('same_slot', 'a stack cannot move onto itself');
  if (!a) return fail('empty_slot', 'nothing in that slot');
  return { a, b };
}

/**
 * Moves a stack, or `count` of it, onto another slot: into an empty slot; onto a stack of the same item, as much as fits
 * (`stack_full` when nothing does); or, moving a whole stack onto a different item, swaps the two. Moving part of a stack
 * onto a different item fails with `item_mismatch`.
 */
export function moveStack(inv: Inventory, from: SlotRef, to: SlotRef, count?: number): Result<{ moved: number }> {
  const e = endpoints(inv, from, to);
  if ('ok' in e) return e;
  const { a, b } = e;
  const n = count ?? a.count;
  const badN = badCount(n, a.count);
  if (badN) return badN;
  const out = clone(inv);
  if (!b) {
    put(out, to, { item: a.item, count: n });
    put(out, from, a.count - n ? { item: a.item, count: a.count - n } : null);
    return { ok: true, inv: out, moved: n };
  }
  if (b.item === a.item) {
    const room = stackCap(a.item, inv.stackMax) - b.count;
    if (room <= 0) return fail('stack_full', 'that stack is full');
    const m = Math.min(n, room);
    put(out, to, { item: b.item, count: b.count + m });
    put(out, from, a.count - m ? { item: a.item, count: a.count - m } : null);
    return { ok: true, inv: out, moved: m };
  }
  if (n !== a.count) return fail('item_mismatch', 'part of a stack can only go onto an empty slot or the same item');
  put(out, to, a);
  put(out, from, b);
  return { ok: true, inv: out, moved: n };
}

/** Splits `count` off a stack into the empty slot `to`, or the first empty slot of the same container (for cargo, the same
 * pod first). Leaves at least one behind. */
export function splitStack(inv: Inventory, from: SlotRef, count: number, to?: SlotRef): Result<{ to: SlotRef }> {
  const a = slotAt(inv, from);
  if (a === undefined) return fail('bad_slot', 'no such slot');
  if (!a) return fail('empty_slot', 'nothing in that slot');
  const badN = badCount(count, a.count - 1);
  if (badN) return a.count === 1 ? fail('bad_count', 'a stack of one cannot split') : badN;
  let target = to;
  if (target) {
    const b = slotAt(inv, target);
    if (b === undefined) return fail('bad_slot', 'no such slot');
    if (b) return fail('slot_occupied', 'a stack splits only into an empty slot');
  } else {
    const refs = slotRefs(inv, containerOf(from));
    const samePod = (r: SlotRef) => r.c === 'suit' || (from.c === 'pod' && r.p === from.p);
    target = [...refs.filter(samePod), ...refs.filter((r) => !samePod(r))].find((r) => !slotAt(inv, r));
    if (!target) return fail('no_room', 'no empty slot to split into');
  }
  const out = clone(inv);
  put(out, target, { item: a.item, count });
  put(out, from, { item: a.item, count: a.count - count });
  return { ok: true, inv: out, to: target };
}

/** Merges a stack onto another stack of the same item, as much as fits. */
export function mergeStack(inv: Inventory, from: SlotRef, to: SlotRef): Result<{ moved: number }> {
  const e = endpoints(inv, from, to);
  if ('ok' in e) return e;
  if (!e.b) return fail('empty_slot', 'nothing to merge onto');
  if (e.b.item !== e.a.item) return fail('item_mismatch', 'only stacks of the same item merge');
  return moveStack(inv, from, to);
}

/** Moves a stack, or `count` of it, across to the other container (suit ↔ cargo): tops up stacks of the item there before
 * taking empty slots. Moves as much as fits; `no_room` when nothing does. */
export function transferStack(inv: Inventory, from: SlotRef, count?: number): Result<{ moved: number }> {
  const a = slotAt(inv, from);
  if (a === undefined) return fail('bad_slot', 'no such slot');
  if (!a) return fail('empty_slot', 'nothing in that slot');
  const n = count ?? a.count;
  const badN = badCount(n, a.count);
  if (badN) return badN;
  const out = clone(inv);
  const there: Container = containerOf(from) === 'suit' ? 'cargo' : 'suit';
  const moved = fill(out, there, a.item, n);
  if (!moved) return fail('no_room', there === 'cargo' ? (inv.pods.length ? 'the cargo pods are full' : 'no ship, no cargo pods') : 'the suit is full');
  put(out, from, a.count - moved ? { item: a.item, count: a.count - moved } : null);
  return { ok: true, inv: out, moved };
}

/** Merges every partial stack of an item in a container into as few stacks as hold it, in the order the items first
 * appear, and closes the gaps. Never fails. */
export function compact(inv: Inventory, c: Container): Result {
  const refs = slotRefs(inv, c);
  const amounts = new Map<string, number>();
  for (const r of refs) {
    const s = slotAt(inv, r);
    if (s) amounts.set(s.item, (amounts.get(s.item) ?? 0) + s.count);
  }
  const out = clone(inv);
  for (const r of refs) put(out, r, null);
  let k = 0;
  for (const [item, total] of amounts) {
    const cap = stackCap(item, inv.stackMax);
    for (let left = total; left > 0; left -= cap) put(out, refs[k++]!, { item, count: Math.min(cap, left) });
  }
  return { ok: true, inv: out };
}

/** Validates an op a client sent (the trust boundary, ARCHITECTURE §5): the parsed op, or an `invalid_op` failure. */
export function parseOp(op: unknown): { ok: true; op: InventoryOp } | Failure {
  const r = inventoryOpSchema.safeParse(op);
  return r.success ? { ok: true, op: r.data } : fail('invalid_op', r.error.issues[0]?.message ?? 'invalid op');
}

/** Validates a stored or received inventory value: the parsed value, or an `invalid_inventory` failure. */
export function parseInventory(value: unknown): Result {
  const r = inventorySchema.safeParse(value);
  if (r.success) return { ok: true, inv: r.data };
  const issue = r.error.issues[0];
  return fail('invalid_inventory', issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid inventory');
}

/** Applies one client-requested op. */
export function applyOp(inv: Inventory, op: InventoryOp): Result {
  switch (op.op) {
    case 'move':
      return moveStack(inv, op.from, op.to, op.count);
    case 'split':
      return splitStack(inv, op.from, op.count, op.to);
    case 'merge':
      return mergeStack(inv, op.from, op.to);
    case 'transfer':
      return transferStack(inv, op.from, op.count);
    case 'compact':
      return compact(inv, op.c);
  }
}

// ---------- units ----------

export function addUnits(inv: Inventory, n: number): Result {
  const badN = badCount(n, MAX_UNITS - inv.units);
  if (badN) return badN;
  return { ok: true, inv: { ...inv, units: inv.units + n } };
}

/** Spends exactly `n` units, or fails with `not_enough`. */
export function spendUnits(inv: Inventory, n: number): Result {
  const badN = badCount(n, MAX_UNITS);
  if (badN) return badN;
  if (inv.units < n) return fail('not_enough', `${inv.units} of ${n} units`);
  return { ok: true, inv: { ...inv, units: inv.units - n } };
}

// ---------- the death drop ----------

/** What the ship's cargo pods held when it died: the lootable pod's contents (DESIGN 10.1; P1.E06.T03 spawns it). */
export interface CargoDrop {
  stacks: Stack[];
}

/** Empties every cargo pod and returns what they held, pod by pod in slot order. The suit is untouched: it stays with the
 * character through the Recall (DESIGN 7). The pods themselves stay until the hull changes (`applyLayout`). */
export function dropCargo(inv: Inventory): { ok: true; inv: Inventory; drop: CargoDrop } {
  const stacks = inv.pods.flatMap((pod) => pod.filter((s): s is Stack => !!s));
  if (!stacks.length) return { ok: true, inv, drop: { stacks } };
  return { ok: true, inv: { ...inv, pods: inv.pods.map((pod) => pod.map(() => null)) }, drop: { stacks } };
}
