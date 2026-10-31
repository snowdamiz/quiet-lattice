// The crafting messages (protocol 13, P1.E13.T05): a fabricator request (make a recipe at the station's or the ship's
// fabricator, or learn one from its item), its answer (made with what it made, learned, refused with why), and the
// recipes a character knows. One `craft` type serves both directions, told apart by its fields.
import { describe, expect, it } from 'vitest';
import { CRAFT_MAX, CRAFT_REFUSALS, KNOWN_MAX } from '../crafting/index.ts';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './index.ts';

const make = { t: 'craft', seq: 1, op: { op: 'make', recipe: 'warp_cell', count: 2, at: 'station' } } as const satisfies ClientMessage;
const learn = { t: 'craft', seq: 2, op: { op: 'learn', recipe: 'torpedo' } } as const satisfies ClientMessage;

describe('crafting messages', () => {
  it('arrived with protocol 13', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(13);
  });

  it('round-trips make and learn requests, and refuses malformed ones', () => {
    for (const m of [make, learn, { ...make, op: { ...make.op, at: 'ship', count: CRAFT_MAX } }] satisfies ClientMessage[])
      expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
    for (const bad of [
      { ...make, seq: 0 },
      { ...make, seq: 1.5 },
      { ...make, op: { ...make.op, count: 0 } },
      { ...make, op: { ...make.op, count: CRAFT_MAX + 1 } },
      { ...make, op: { ...make.op, count: 1.5 } },
      { ...make, op: { ...make.op, at: 'capital' } },
      { ...make, op: { ...make.op, recipe: 'Warp Cell' } },
      { ...make, op: { ...make.op, recipe: 'x'.repeat(49) } },
      { ...make, op: { ...make.op, recipe: '' } },
      // no client says what a craft uses or makes
      { ...make, op: { ...make.op, output: 99 } },
      { ...make, op: { op: 'make', recipe: 'warp_cell', count: 1 } },
      { ...learn, op: { op: 'learn', recipe: 'torpedo', item: 'recipe_torpedo' } },
      { ...learn, op: { op: 'forget', recipe: 'torpedo' } },
      { t: 'craft', seq: 3 },
    ]) {
      expect(decodeClientMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('round-trips the answers: made with what it made, learned, refused with every reason', () => {
    const answers = [
      { t: 'craft', seq: 1, op: 'make', recipe: 'flak_ammo', result: 'made', item: 'flak_ammo', count: 100 },
      { t: 'craft', seq: 2, op: 'learn', recipe: 'torpedo', result: 'learned' },
      ...CRAFT_REFUSALS.map((reason) => ({ t: 'craft' as const, seq: 3, op: 'make' as const, recipe: 'warp_cell', result: 'refused' as const, reason })),
    ] satisfies ServerMessage[];
    for (const m of answers) expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    const base = { t: 'craft', seq: 3, op: 'make', recipe: 'warp_cell' } as const;
    for (const bad of [
      { ...base, result: 'made' },
      { ...base, result: 'made', item: 'warp_cell' },
      { ...base, result: 'made', item: 'warp_cell', count: 0 },
      { ...base, result: 'refused' },
      { ...base, result: 'refused', reason: 'range' },
      { ...base, result: 'refused', reason: 'materials', item: 'warp_cell', count: 1 },
      { ...base, result: 'learned' },
      { ...base, op: 'learn', result: 'made', item: 'warp_cell', count: 1 },
      { ...base, seq: 0, result: 'refused', reason: 'rate' },
    ]) {
      expect(decodeServerMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('round-trips the known recipes, each once and bounded', () => {
    const m = { t: 'recipes', known: ['warp_cell', 'torpedo'] } as const satisfies ServerMessage;
    expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    expect(decodeServerMessage(encodeServerMessage({ t: 'recipes', known: [] }))).toEqual({ t: 'recipes', known: [] });
    for (const bad of [
      { t: 'recipes', known: ['warp_cell', 'warp_cell'] },
      { t: 'recipes', known: ['Warp'] },
      { t: 'recipes', known: Array.from({ length: KNOWN_MAX + 1 }, (_, i) => `r${i}`) },
    ]) {
      expect(decodeServerMessage(JSON.stringify(bad))).toBeNull();
    }
  });

  it('tells the request from the answer', () => {
    expect(decodeServerMessage(encodeMessage(make))).toBeNull();
    const answer = { t: 'craft', seq: 2, op: 'learn', recipe: 'torpedo', result: 'learned' } as const satisfies ServerMessage;
    const text = encodeMessage(answer);
    expect(decodeServerMessage(text)).toEqual(answer);
    expect(decodeClientMessage(text)).toBeNull();
  });
});
