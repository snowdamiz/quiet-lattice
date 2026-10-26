// The client inventory (P1.E06.T04): the demo's flat API over the shared suit-and-cargo model, and prediction with
// reconciliation against the server's state.
import { getHull } from '@astra/shared/data';
import { addItem, countOf, emptyInventory, layoutFor, slotAt } from '@astra/shared/inventory';
import { describe, expect, it } from 'vitest';
import { Inventory, PENDING_MS } from './Inventory.js';

/** A ship of this hull carrying every pod its bays take (Pack Mule adds a bay), and the skills. */
const at = (hull, skills = []) => ({
  ship: hull && { hull, modules: {}, cargoPods: getHull(hull).cargoPods + (skills.includes('pack_mule') ? 1 : 0), livery: 0 },
  skills,
});

const suit = (i) => ({ c: 'suit', i });
const pod = (p, i) => ({ c: 'pod', p, i });

describe('client Inventory: the demo API', () => {
  it('starts on the Lark with the starting kit: 2500 units and a warp cell in the suit', () => {
    const inv = new Inventory();
    expect(inv.units).toBe(2500);
    expect(inv.warpCells).toBe(1);
    expect(inv.items).toEqual({});
    expect(inv.state.suit).toHaveLength(16);
    expect(inv.state.pods).toHaveLength(1);
    expect(inv.capacity).toBe(9999);
  });

  it('adds mined resources to the suit, then the cargo pod, and reports what fit', () => {
    const inv = new Inventory();
    expect(inv.add('ferrite', 9999 * 15)).toBe(9999 * 15);
    expect(countOf(inv.state, 'ferrite', 'suit')).toBe(9999 * 15);
    expect(inv.add('ferrite', 30)).toBe(30);
    expect(slotAt(inv.state, pod(0, 0))).toEqual({ item: 'ferrite', count: 30 });
    expect(inv.add('carbon', 9999 * 8)).toBe(9999 * 7);
    expect(inv.items).toEqual({ ferrite: 9999 * 15 + 30, carbon: 9999 * 7 });
    expect(inv.add('unobtainium', 3)).toBe(0);
    expect(inv.room('carbon')).toBe(0);
  });

  it('takes from the suit first, all or nothing, and tells what it has', () => {
    const inv = new Inventory();
    inv.add('oxygen', 25);
    expect(inv.has('oxygen', 25)).toBe(true);
    expect(inv.take('oxygen', 10)).toBe(true);
    expect(inv.take('oxygen', 16)).toBe(false);
    expect(inv.items.oxygen).toBe(15);
  });

  it('keeps units, warp cells and resource counts behind the old fields', () => {
    const inv = new Inventory();
    const k0 = inv.key();
    inv.units += 400;
    inv.units -= Math.floor(inv.units * 0.2);
    expect(inv.units).toBe(2320);
    inv.warpCells++;
    expect(inv.warpCells).toBe(2);
    inv.warpCells--;
    inv.warpCells--;
    expect(inv.warpCells).toBe(0);
    expect(inv.key()).not.toBe(k0);
    inv.items = { carbon: 120, gold: 7, nonsense: 5 };
    expect(inv.items).toEqual({ carbon: 120, gold: 7 });
    inv.add('gold', 3);
    expect(inv.sellAll('gold')).toBe(10 * 202);
    expect(inv.units).toBe(2320 + 2020);
    expect(inv.sellAll('gold')).toBe(0);
  });

  it('saves and restores the whole layout, refusing an invalid save', () => {
    const inv = new Inventory();
    inv.add('copper', 50);
    inv.request({ op: 'transfer', from: suit(1) });
    const copy = new Inventory();
    expect(copy.restore(JSON.parse(JSON.stringify(inv.snapshot())))).toBe(true);
    expect(copy.state).toEqual(inv.state);
    expect(copy.restore({ ...inv.snapshot(), fragments: 3 })).toBe(false);
    expect(copy.state).toEqual(inv.state);
  });

  it('reshapes to another hull, refusing one that cannot hold the cargo', () => {
    const inv = new Inventory();
    expect(inv.setLoadout(at('mule', ['pack_mule']))).toBe(true);
    expect(inv.hull).toBe('mule');
    expect(inv.state.pods).toHaveLength(5);
    expect(inv.capacity).toBe(15000);
    inv.add('tritium', 15000 * 20);
    expect(inv.setLoadout(at('lark'))).toBe(false);
    expect(inv.hull).toBe('mule');
    expect(inv.state.pods).toHaveLength(5);
    const shipless = new Inventory();
    shipless.add('gold', 40);
    shipless.request({ op: 'transfer', from: suit(1) });
    expect(shipless.setLoadout(at(null))).toBe(true);
    expect(shipless.state.pods).toEqual([]);
    expect(shipless.items).toEqual({ gold: 40 });
  });
});

describe('client Inventory: prediction', () => {
  it('applies a stack move at once offline, and refuses an invalid one without changing anything', () => {
    const inv = new Inventory();
    inv.add('carbon', 40);
    const r = inv.request({ op: 'split', from: suit(1), count: 15 });
    expect(r.ok).toBe(true);
    expect(slotAt(inv.state, suit(2))).toEqual({ item: 'carbon', count: 15 });
    const before = inv.state;
    expect(inv.request({ op: 'move', from: suit(9), to: suit(10) })).toMatchObject({ ok: false, error: { code: 'empty_slot' } });
    expect(inv.state).toBe(before);
  });

  it('sends requests when online and reconciles with the server, replaying what it has not handled', () => {
    const inv = new Inventory();
    const sent = [];
    inv.send = (m) => sent.push(m);
    const server = addItem(emptyInventory(layoutFor(at('lark')), 2500), 'gold', 30).inv;
    inv.receive({ t: 'inventory', seq: 0, inventory: server });
    expect(inv.state).toBe(server);

    inv.request({ op: 'transfer', from: suit(0), count: 10 });
    inv.request({ op: 'move', from: suit(0), to: suit(5) });
    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
    expect(slotAt(inv.state, suit(5))).toEqual({ item: 'gold', count: 20 });

    // the server has handled the first; the second is still in flight and stays predicted
    const afterFirst = addItem(addItem(emptyInventory(layoutFor(at('lark')), 2500), 'gold', 20).inv, 'gold', 10, { to: 'cargo' }).inv;
    inv.receive({ t: 'inventory', seq: 1, inventory: afterFirst });
    expect(inv.pending.map((p) => p.seq)).toEqual([2]);
    expect(slotAt(inv.state, suit(5))).toEqual({ item: 'gold', count: 20 });
    expect(slotAt(inv.state, pod(0, 0))).toEqual({ item: 'gold', count: 10 });

    // the server refused the second: its state stands
    expect(inv.receive({ t: 'inventory', seq: 2, inventory: afterFirst, error: 'empty_slot' })).toBe('empty_slot');
    expect(inv.pending).toEqual([]);
    expect(inv.state).toBe(afterFirst);
  });

  it('replays every pending request over a pushed change (loot arriving mid-drag)', () => {
    const inv = new Inventory();
    inv.send = () => {};
    inv.add('carbon', 10);
    inv.receive({ t: 'inventory', seq: 0, inventory: inv.state });
    inv.request({ op: 'move', from: suit(1), to: suit(8) });
    const looted = addItem(inv.confirmed, 'gold', 5).inv;
    inv.receive({ t: 'inventory', seq: 0, inventory: looted });
    expect(slotAt(inv.state, suit(8))).toEqual({ item: 'carbon', count: 10 });
    expect(countOf(inv.state, 'gold')).toBe(5);
  });

  it('never sends an op the server would not parse', () => {
    const inv = new Inventory();
    const sent = [];
    inv.send = (m) => sent.push(m);
    inv.add('carbon', 10);
    for (const op of [{ op: 'add', item: 'gold', count: 5 }, { op: 'move', from: suit(1), to: suit(99) }, { op: 'split', from: suit(1), count: 0 }]) {
      expect(inv.request(op)).toMatchObject({ ok: false, error: { code: 'invalid_op' } });
    }
    expect(sent).toEqual([]);
    expect(inv.pending).toEqual([]);
  });

  it('drops a prediction the server never answers, and starts over on a new session', () => {
    const inv = new Inventory();
    let t = 1000;
    inv.now = () => t;
    inv.send = () => {};
    inv.add('carbon', 10);
    inv.reset(inv.state);
    const base = inv.state;
    inv.request({ op: 'move', from: suit(1), to: suit(8) }); // dropped by the gateway, say: no answer ever comes
    expect(slotAt(inv.state, suit(8))).toEqual({ item: 'carbon', count: 10 });
    t += PENDING_MS - 1;
    inv.expire();
    expect(inv.pending).toHaveLength(1);
    t += 1;
    inv.expire();
    expect(inv.pending).toEqual([]);
    expect(inv.state).toBe(base);

    // a push after the timeout no longer replays the lost request either
    inv.request({ op: 'move', from: suit(1), to: suit(3) });
    t += PENDING_MS;
    const looted = addItem(base, 'gold', 5).inv;
    inv.receive({ t: 'inventory', seq: 0, inventory: looted });
    expect(inv.state).toBe(looted);

    // reconnect: the state after welcome replaces everything and request numbers start from 1 again
    inv.request({ op: 'move', from: suit(1), to: suit(4) });
    expect(inv.seq).toBe(3);
    inv.reset(base);
    expect([inv.seq, inv.pending.length, inv.state]).toEqual([0, 0, base]);
    const sent = [];
    inv.send = (m) => sent.push(m);
    inv.request({ op: 'move', from: suit(1), to: suit(4) });
    expect(sent.map((m) => m.seq)).toEqual([1]);
  });

  it('follows the ship it is given: one pod per pod aboard', () => {
    const inv = new Inventory();
    expect(inv.setLoadout({ ship: { hull: 'mule', modules: {}, cargoPods: 2, livery: 0 } })).toBe(true);
    expect(inv.state.pods).toHaveLength(2);
    expect(() => inv.setLoadout({ ship: { hull: 'lark', modules: {}, cargoPods: 2, livery: 0 } })).toThrow();
  });
});
