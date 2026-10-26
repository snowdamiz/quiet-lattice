// The inventory message path against the dockerised Postgres and Redis (P1.E06.T04): join sends the character's
// inventory; requests are applied or refused by the server and answered with its state; server-side grants are pushed;
// malformed requests are dropped and counted; the inventory outlives a reconnect.
import { countOf, slotAt } from '@astra/shared/inventory';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

type InventoryState = Extract<ServerMessage, { t: 'inventory' }>;

async function joined(token: string, characterId: string): Promise<{ s: TestSocket; state: InventoryState }> {
  const s = await TestSocket.open(server.wsUrl);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  s.send({ t: 'join', characterId });
  await s.next('welcome');
  return { s, state: await s.next('inventory') };
}

describe('inventory over the socket', () => {
  it('sends the starting inventory on join: the suit, one Lark cargo pod, units and a warp cell', async () => {
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const { s, state } = await joined(acct.token, character.id);
    expect(state.seq).toBe(0);
    expect(state.error).toBeUndefined();
    expect(state.inventory.suit).toHaveLength(16);
    expect(state.inventory.pods).toEqual([Array(8).fill(null)]);
    expect(state.inventory.units).toBe(2500);
    expect(countOf(state.inventory, 'warp_cell')).toBe(1);
    expect(state.inventory).toEqual(server.ws.inventory.get(character.id));
    s.close();
  });

  it('applies requests on the server, refuses invalid ones, and pushes server-side grants', async () => {
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const { s } = await joined(acct.token, character.id);

    // loot is the server's to give: it arrives as pushed state
    expect(server.ws.inventory.grant(character.id, 'ferrite', 120).ok).toBe(true);
    const pushed = await s.next('inventory');
    expect(pushed.seq).toBe(0);
    expect(slotAt(pushed.inventory, { c: 'suit', i: 1 })).toEqual({ item: 'ferrite', count: 120 });

    s.send({ t: 'inventory', seq: 1, op: { op: 'split', from: { c: 'suit', i: 1 }, count: 20 } });
    const split = await s.next('inventory');
    expect(split).toMatchObject({ seq: 1 });
    expect(split.error).toBeUndefined();
    expect(slotAt(split.inventory, { c: 'suit', i: 2 })).toEqual({ item: 'ferrite', count: 20 });

    s.send({ t: 'inventory', seq: 2, op: { op: 'transfer', from: { c: 'suit', i: 2 } } });
    const moved = await s.next('inventory');
    expect(slotAt(moved.inventory, { c: 'pod', p: 0, i: 0 })).toEqual({ item: 'ferrite', count: 20 });

    // a well-formed request the rules refuse: answered with the unchanged state and the reason
    s.send({ t: 'inventory', seq: 3, op: { op: 'move', from: { c: 'suit', i: 9 }, to: { c: 'suit', i: 10 } } });
    const refused = await s.next('inventory');
    expect(refused).toMatchObject({ seq: 3, error: 'empty_slot' });
    expect(refused.inventory).toEqual(moved.inventory);
    s.send({ t: 'inventory', seq: 4, op: { op: 'move', from: { c: 'suit', i: 1 }, to: { c: 'pod', p: 1, i: 0 } } });
    expect(await s.next('inventory')).toMatchObject({ seq: 4, error: 'bad_slot' });
    s.send({ t: 'inventory', seq: 4, op: { op: 'compact', c: 'suit' } });
    expect(await s.next('inventory')).toMatchObject({ seq: 4, error: 'stale_seq' });

    expect(server.ws.inventory.get(character.id)).toEqual(moved.inventory);
    s.close();
  });

  it('drops and counts requests a client may not make, and inventory before join', async () => {
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const s = await TestSocket.open(server.wsUrl);
    s.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
    s.send({ t: 'inventory', seq: 1, op: { op: 'compact', c: 'suit' } }); // before join
    s.send({ t: 'join', characterId: character.id });
    await s.next('welcome');
    const start = await s.next('inventory');
    s.send({ t: 'inventory', seq: 1, op: { op: 'add', item: 'gold', count: 9999 } }); // clients never add
    s.send({ t: 'inventory', seq: 2, op: { op: 'move', from: { c: 'suit', i: 0 }, to: { c: 'suit', i: 99 } } });
    s.send({ t: 'inventory', seq: 3, op: { op: 'transfer', from: { c: 'suit', i: 0 }, count: 0 } });
    s.send({ t: 'inventory', seq: 0, op: { op: 'compact', c: 'suit' } });
    s.send({ t: 'ping', id: 1, clientTime: 0 });
    await s.next('pong');
    const session = [...server.ws.registry.sessions].find((x) => x.characterId === character.id)!;
    expect(session.invalidMessages).toBe(5);
    expect(s.received.filter((m) => m.t === 'inventory' || m.t === 'refused')).toEqual([]);
    expect(server.ws.inventory.get(character.id)).toEqual(start.inventory);
    s.close();
  });

  it('keeps the inventory across a reconnect and numbers requests afresh', async () => {
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const first = await joined(acct.token, character.id);
    server.ws.inventory.grant(character.id, 'gold', 30, { to: 'cargo' });
    await first.s.next('inventory');
    first.s.send({ t: 'inventory', seq: 7, op: { op: 'transfer', from: { c: 'pod', p: 0, i: 0 } } });
    const last = await first.s.next('inventory');
    first.s.close();
    await waitFor(() => ![...server.ws.registry.sessions].some((x) => x.characterId === character.id), 5000, 'the first socket to close');

    const again = await joined(acct.token, character.id);
    expect(again.state).toEqual({ t: 'inventory', seq: 0, inventory: last.inventory });
    again.s.send({ t: 'inventory', seq: 1, op: { op: 'compact', c: 'suit' } });
    expect((await again.s.next('inventory')).error).toBeUndefined();

    // another character's inventory is its own
    const other = await newCharacter(server, acct.token);
    expect(countOf(server.ws.inventory.get(character.id)!, 'gold')).toBe(30);
    const o = await joined(acct.token, other.id);
    expect(countOf(o.state.inventory, 'gold')).toBe(0);
    again.s.close();
    o.s.close();
  });
});
