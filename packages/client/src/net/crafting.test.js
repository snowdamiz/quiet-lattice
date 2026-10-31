// The client's side of the fabricators (P1.E13.T05, ARCHITECTURE §23): it keeps the recipes the server says the character
// knows, asks for crafts and lessons numbered from 1 each session, says at once what the shared rules refuse (sending
// nothing), hears only the answers to its own requests, and in the dev sandbox (no server) crafts on its own inventory.
import { STARTING_RECIPES } from '@astra/shared/crafting';
import { countOf, totals } from '@astra/shared/inventory';
import { describe, expect, it } from 'vitest';
import { Inventory } from '../gameplay/Inventory.js';
import { Crafting } from './crafting.js';

/** A connection standing in for Net: its handlers by type, what it sent, and whether it is joined. */
function fakeNet() {
  const handlers = new Map();
  return {
    sent: [],
    joined: true,
    on(t, fn) {
      handlers.set(t, [...(handlers.get(t) ?? []), fn]);
    },
    push(m) {
      for (const fn of handlers.get(m.t) ?? []) fn(m);
    },
    send(m) {
      if (!this.joined) return false;
      this.sent.push(m);
      return true;
    },
  };
}

function stocked(items) {
  const inventory = new Inventory();
  inventory.restore({ ...inventory.state, suit: inventory.state.suit.map((_, i) => (items[i] ? { item: items[i][0], count: items[i][1] } : null)) });
  return inventory;
}

const WARP = [
  ['dihydrogen', 60],
  ['tritium', 25],
  ['cobalt', 5],
];

describe('the client’s crafting', () => {
  it('knows the starting recipes until the server says otherwise, then what it says', () => {
    const c = new Crafting({ inventory: new Inventory() });
    expect(c.known).toEqual([...STARTING_RECIPES]);
    const net = fakeNet();
    c.link(net);
    net.push({ t: 'recipes', known: ['warp_cell', 'torpedo'] });
    expect(c.known).toEqual(['warp_cell', 'torpedo']);
    expect(c.knows('torpedo')).toBe(true);
    expect(c.rev).toBe(1);
  });

  it('asks the server, numbering from 1 each session; a refusal the shared rules predict is never sent', () => {
    const c = new Crafting({ inventory: stocked(WARP) });
    const net = fakeNet();
    c.link(net);
    expect(c.make('warp_cell', 1, 'station', 0)).toBeNull();
    expect(c.waiting).toBe(true);
    expect(c.make('warp_cell', 2, 'station', 0)).toBe('materials');
    expect(c.make('warp_cell', 1, 'ship', 0)).toBe('fabricator');
    expect(c.make('torpedo', 1, 'station', 0)).toBe('not_known');
    expect(c.make('no_such', 1, 'station', 0)).toBe('unknown');
    expect(c.learn('torpedo')).toBe('no_item');
    expect(c.learn('warp_cell')).toBe('known');
    expect(net.sent).toEqual([{ t: 'craft', seq: 1, op: { op: 'make', recipe: 'warp_cell', count: 1, at: 'station' } }]);
    // (the client's inventory is the server's to change: asking changes nothing here)
    expect(totals(c.game.inventory.state)).toEqual({ dihydrogen: 60, tritium: 25, cobalt: 5 });
    net.push({ t: 'welcome' });
    expect(c.waiting).toBe(false);
    expect(c.make('warp_cell', 1, 'station', 0)).toBeNull();
    expect(net.sent.at(-1)).toMatchObject({ seq: 1 });
    net.joined = false;
    expect(c.make('warp_cell', 1, 'station', 0)).toBe('zone');
  });

  it('hears the answers to its own requests only', () => {
    const c = new Crafting({ inventory: stocked(WARP) });
    const net = fakeNet();
    c.link(net);
    const heard = [];
    c.on((m) => heard.push(m));
    c.make('warp_cell', 1, 'station', 0);
    const answer = { t: 'craft', seq: 1, op: 'make', recipe: 'warp_cell', result: 'made', item: 'warp_cell', count: 1 };
    net.push({ t: 'craft', seq: 7, op: 'make', recipe: 'warp_cell', result: 'refused', reason: 'stale_seq' });
    net.push(answer);
    net.push(answer);
    expect(heard).toEqual([answer]);
    expect(c.waiting).toBe(false);
  });

  it('in the dev sandbox, crafts and learns on its own inventory with the shared rules', () => {
    const c = new Crafting({ inventory: stocked([...WARP, ['recipe_torpedo', 1]]) });
    const heard = [];
    c.on((m) => heard.push(m));
    expect(c.make('warp_cell', 1, 'station', 0)).toBeNull();
    expect(heard).toEqual([{ t: 'craft', seq: 1, op: 'make', recipe: 'warp_cell', result: 'made', item: 'warp_cell', count: 1 }]);
    expect(totals(c.game.inventory.state)).toEqual({ dihydrogen: 10, tritium: 5, warp_cell: 1, recipe_torpedo: 1 });
    expect(c.learn('torpedo')).toBeNull();
    expect(heard.at(-1)).toEqual({ t: 'craft', seq: 2, op: 'learn', recipe: 'torpedo', result: 'learned' });
    expect(c.knows('torpedo')).toBe(true);
    expect(countOf(c.game.inventory.state, 'recipe_torpedo')).toBe(0);
  });
});
