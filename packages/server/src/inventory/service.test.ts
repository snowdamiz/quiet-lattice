import { getHull, type HullId } from '@astra/shared/data';
import { countOf, emptyInventory, layoutFor, slotAt, startingInventory, type Inventory, type InventoryLoadout } from '@astra/shared/inventory';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT, InventoryNotHeldError, InventoryService, type InventoryReply } from './service.ts';

/** A ship of this hull carrying every pod its bays take (Pack Mule adds a bay), and the skills. */
const at = (hull: HullId | null, skills: string[] = []): InventoryLoadout => ({
  ship: hull && { hull, modules: {}, cargoPods: getHull(hull).cargoPods + (skills.includes('pack_mule') ? 1 : 0), livery: 0 },
  skills,
});

const ID = 'c0ffee00-0000-4000-8000-000000000001';

function service() {
  const svc = new InventoryService();
  const pushed: [string, InventoryReply][] = [];
  svc.subscribe((id, reply) => pushed.push([id, reply]));
  return { svc, pushed };
}

describe('InventoryService', () => {
  it('opens a new character with the starting kit on the Lark, and keeps it across sessions', () => {
    const { svc } = service();
    const first = svc.open(ID);
    expect(first).toEqual({ seq: 0, inventory: startingInventory(layoutFor(DEFAULT_LOADOUT)) });
    expect(first.inventory.pods).toHaveLength(1);
    expect(first.inventory.units).toBe(2500);
    expect(countOf(first.inventory, 'warp_cell', 'suit')).toBe(1);
    svc.grant(ID, 'ferrite', 40);
    expect(svc.open(ID, { loadout: at('mule', []) }).inventory).toBe(svc.get(ID));
    expect(svc.size).toBe(1);
  });

  it('loads a saved inventory, and refuses an invalid one rather than replacing it', () => {
    const { svc } = service();
    const saved = { ...emptyInventory(layoutFor(at('mule')), 7), suit: [{ item: 'gold', count: 3 }] };
    expect(svc.open(ID, { saved: JSON.parse(JSON.stringify(saved)) }).inventory).toEqual(saved);
    const other = 'c0ffee00-0000-4000-8000-000000000002';
    expect(() => svc.open(other, { saved: { ...saved, fragments: 2 } })).toThrow(/invalid/);
    expect(svc.get(other)).toBeNull();
  });

  it('applies valid requests, numbers them, and answers with the authoritative state', () => {
    const { svc, pushed } = service();
    svc.open(ID);
    svc.grant(ID, 'carbon', 30);
    pushed.length = 0;
    const r1 = svc.request(ID, 1, { op: 'split', from: { c: 'suit', i: 1 }, count: 10 });
    expect(r1.error).toBeUndefined();
    expect(r1.seq).toBe(1);
    expect(slotAt(r1.inventory, { c: 'suit', i: 2 })).toEqual({ item: 'carbon', count: 10 });
    const r2 = svc.request(ID, 2, { op: 'transfer', from: { c: 'suit', i: 2 } });
    expect(slotAt(r2.inventory, { c: 'pod', p: 0, i: 0 })).toEqual({ item: 'carbon', count: 10 });
    expect(svc.get(ID)).toBe(r2.inventory);
    expect(pushed).toEqual([]); // replies go to the requester, not to listeners
  });

  it('refuses invalid requests without changing anything, naming why', () => {
    const { svc } = service();
    const before = svc.open(ID).inventory;
    const cases: [unknown, string][] = [
      [{ op: 'move', from: { c: 'suit', i: 5 }, to: { c: 'suit', i: 6 } }, 'empty_slot'],
      [{ op: 'move', from: { c: 'suit', i: 0 }, to: { c: 'pod', p: 1, i: 0 } }, 'bad_slot'],
      [{ op: 'move', from: { c: 'suit', i: 0 }, to: { c: 'suit', i: 0 } }, 'same_slot'],
      [{ op: 'split', from: { c: 'suit', i: 0 }, count: 1 }, 'bad_count'],
      [{ op: 'add', item: 'gold', count: 1000 }, 'invalid_op'],
      [{ op: 'move', from: { c: 'suit', i: 0 }, to: { c: 'suit', i: 1 }, count: -4 }, 'invalid_op'],
      ['fragments', 'invalid_op'],
    ];
    cases.forEach(([op, code], k) => {
      const r = svc.request(ID, k + 1, op);
      expect(r.error, JSON.stringify(op)).toBe(code);
      expect(r.seq).toBe(k + 1);
      expect(r.inventory).toBe(before);
    });
  });

  it('refuses a replayed or reordered request, and numbers afresh each session', () => {
    const { svc } = service();
    svc.open(ID);
    svc.grant(ID, 'carbon', 30);
    const move = { op: 'move', from: { c: 'suit', i: 1 }, to: { c: 'suit', i: 4 } };
    expect(svc.request(ID, 5, move).error).toBeUndefined();
    const replay = svc.request(ID, 5, { op: 'move', from: { c: 'suit', i: 4 }, to: { c: 'suit', i: 9 } });
    expect(replay).toMatchObject({ seq: 5, error: 'stale_seq' });
    expect(slotAt(replay.inventory, { c: 'suit', i: 4 })).toEqual({ item: 'carbon', count: 30 });
    expect(svc.request(ID, 3, move).error).toBe('stale_seq');
    expect(svc.request(ID, 1.5, move).error).toBe('stale_seq');
    expect(svc.open(ID).seq).toBe(0);
    expect(svc.request(ID, 1, { op: 'move', from: { c: 'suit', i: 4 }, to: { c: 'suit', i: 1 } }).error).toBeUndefined();
  });

  it('grants into the suit then the cargo, and pushes every server-side change', () => {
    const { svc, pushed } = service();
    svc.open(ID);
    const r = svc.grant(ID, 'tritium', 9999 * 16);
    expect(r.ok && [r.added, r.remainder]).toEqual([9999 * 16, 0]);
    const inv = svc.get(ID)!;
    expect(countOf(inv, 'tritium', 'suit')).toBe(9999 * 15);
    expect(countOf(inv, 'tritium', 'cargo')).toBe(9999);
    const over = svc.grant(ID, 'tritium', 9999 * 8);
    expect(over.ok && over.remainder).toBe(9999);
    expect(svc.grant(ID, 'fragment', 1)).toMatchObject({ ok: false, error: { code: 'non_tradeable' } });
    expect(pushed.map(([id]) => id)).toEqual([ID, ID]);
    expect(pushed.at(-1)![1].inventory).toBe(svc.get(ID));
  });

  it('consumes, earns and spends, all or nothing', () => {
    const { svc, pushed } = service();
    svc.open(ID);
    svc.grant(ID, 'oxygen', 25);
    expect(svc.consume(ID, 'oxygen', 10).ok).toBe(true);
    expect(svc.consume(ID, 'oxygen', 16)).toMatchObject({ ok: false, error: { code: 'not_enough' } });
    expect(countOf(svc.get(ID)!, 'oxygen')).toBe(15);
    expect(svc.earn(ID, 500).ok).toBe(true);
    expect(svc.spend(ID, 3001)).toMatchObject({ ok: false, error: { code: 'not_enough' } });
    expect(svc.spend(ID, 3000).ok).toBe(true);
    expect(svc.get(ID)!.units).toBe(0);
    expect(pushed).toHaveLength(4);
  });

  it('drops the cargo for the Recall and loses the pods with the ship, keeping the suit', () => {
    const { svc } = service();
    svc.open(ID);
    svc.grant(ID, 'gold', 50, { to: 'cargo' });
    svc.grant(ID, 'carbon', 12);
    const suit = svc.get(ID)!.suit;
    expect(svc.dropCargo(ID)).toEqual({ stacks: [{ item: 'gold', count: 50 }] });
    expect(svc.dropCargo(ID)).toEqual({ stacks: [] });
    expect(svc.setLoadout(ID, at(null, [])).ok).toBe(true);
    const after: Inventory = svc.get(ID)!;
    expect(after.pods).toEqual([]);
    expect(after.suit).toEqual(suit);
  });

  it('reshapes to a new hull and Pack Mule, refusing a hull that cannot hold the cargo', () => {
    const { svc } = service();
    svc.open(ID, { loadout: at('mule', []) });
    expect(svc.get(ID)!.pods).toHaveLength(4);
    svc.grant(ID, 'ferrite', 9999 * (16 + 32));
    const before = svc.get(ID);
    expect(svc.setLoadout(ID, DEFAULT_LOADOUT)).toMatchObject({ ok: false, error: { code: 'no_room' } });
    expect(svc.get(ID)).toBe(before);
    expect(svc.setLoadout(ID, at('mule', ['pack_mule'])).ok).toBe(true);
    expect(svc.get(ID)).toMatchObject({ stackMax: 15000 });
    expect(svc.get(ID)!.pods).toHaveLength(5);
  });

  it('keeps a change and tells the other listeners when one listener throws', () => {
    const errors: unknown[] = [];
    const svc = new InventoryService((err) => errors.push(err));
    const heard: string[] = [];
    svc.subscribe(() => {
      throw new Error('socket gone');
    });
    svc.subscribe((id) => heard.push(id));
    svc.open(ID);
    expect(svc.grant(ID, 'carbon', 5).ok).toBe(true);
    expect(countOf(svc.get(ID)!, 'carbon')).toBe(5);
    expect(heard).toEqual([ID]);
    expect(errors).toHaveLength(1);
  });

  it('throws for a ship that cannot carry its pods, changing nothing', () => {
    const { svc } = service();
    svc.open(ID);
    const before = svc.get(ID);
    expect(() => svc.setLoadout(ID, { ship: { hull: 'lark', modules: {}, cargoPods: 3, livery: 0 } })).toThrow(/too_many_cargo_pods/);
    expect(svc.get(ID)).toBe(before);
  });

  it('forgets a closed character', () => {
    const { svc } = service();
    svc.open(ID);
    expect(svc.close(ID)).not.toBeNull();
    expect(svc.get(ID)).toBeNull();
    expect(svc.close(ID)).toBeNull();
  });

  it('refuses requests and changes for a character it does not hold, creating nothing', () => {
    const { svc, pushed } = service();
    const move = { op: 'compact', c: 'suit' };
    for (const call of [
      () => svc.request(ID, 1, move),
      () => svc.state(ID),
      () => svc.grant(ID, 'gold', 5),
      () => svc.consume(ID, 'gold', 5),
      () => svc.earn(ID, 5),
      () => svc.spend(ID, 5),
      () => svc.setLoadout(ID, DEFAULT_LOADOUT),
      () => svc.dropCargo(ID),
    ]) {
      expect(call).toThrow(InventoryNotHeldError);
    }
    expect(svc.size).toBe(0);
    expect(pushed).toEqual([]);
    svc.open(ID);
    expect(svc.state(ID)).toEqual({ seq: 0, inventory: svc.get(ID) });
  });
});
