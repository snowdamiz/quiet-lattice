// The mining messages (protocol 8, P1.E13.T01): a hit on a node or on the client's flora; its answer (hit, depleted with
// the share and what of it fitted, refused with why), or a share of a node someone else broke; and the nodes' state per
// cell. One `mine` type serves both directions, told apart by its fields.
import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeMessage,
  encodeServerMessage,
  MineRefusal,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './index.ts';

const hit = { t: 'mine', seq: 1, frame: '424242:3', node: '2_310_77_copper_4', tool: 'multitool', time: 12345.5 } as const;
const tree: { kind: 'tree'; ref: string; at: [number, number, number] } = { kind: 'tree', ref: 'c12:3:41', at: [1, 2, 3] };
const flora = { t: 'mine' as const, seq: 2, frame: '424242:3', flora: tree, tool: 'multitool' as const, time: 1 };

describe('mining messages', () => {
  it('arrived with protocol 8', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(8);
  });

  it('round-trips a hit on a node and on flora, and refuses malformed ones', () => {
    for (const m of [hit, flora] satisfies ClientMessage[]) expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
    for (const bad of [
      { ...hit, seq: 0 },
      { ...hit, frame: '424242:station' },
      { ...hit, frame: null },
      { ...hit, frame: '424242:01' },
      { ...hit, node: '2_310_77_Copper_4' },
      { ...hit, node: '7_0_0_copper_4' },
      { ...hit, node: `2_0_0_${'a'.repeat(41)}_4` },
      { ...hit, tool: 'mining_laser' },
      { ...hit, time: -1 },
      { ...hit, time: Number.NaN },
      { ...hit, flora: tree },
      { t: 'mine', seq: 3, frame: '1:1', tool: 'multitool', time: 0 },
      { ...flora, flora: { ...tree, kind: 'cactus' } },
      { ...flora, flora: { ...tree, ref: 'a b' } },
      { ...flora, flora: { ...tree, ref: 'x'.repeat(49) } },
      { ...flora, flora: { ...tree, at: [0, 0, Infinity] } },
    ]) {
      expect(decodeClientMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('round-trips the answers, which say what is left, what was shared and what fitted, or why not', () => {
    const base = { t: 'mine', seq: 4, frame: '424242:3', node: '2_310_77_copper_4' } as const;
    const answers = [
      { ...base, result: 'hit', hp: 0.35 },
      { ...base, result: 'depleted', item: 'copper', count: 22, added: 22 },
      { ...base, seq: 0, result: 'depleted', item: 'copper', count: 7, added: 3 },
      { t: 'mine', seq: 5, frame: '424242:3', flora: 'c12:3:41', result: 'depleted', item: 'carbon', count: 15, added: 15 },
      ...MineRefusal.options.map((reason) => ({ ...base, result: 'refused' as const, reason })),
    ] satisfies ServerMessage[];
    for (const m of answers) expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    for (const bad of [
      { ...base, result: 'hit' },
      { ...base, result: 'hit', hp: 1.5 },
      { ...base, result: 'refused' },
      { ...base, result: 'refused', reason: 'nope' },
      { ...base, result: 'hit', hp: 0.5, reason: 'range' },
      { ...base, result: 'depleted', item: 'copper', count: 2 },
      { ...base, result: 'depleted', item: 'copper', count: 2, added: 3 },
      { ...base, result: 'refused', reason: 'range', item: 'copper', count: 2, added: 2 },
      { t: 'mine', seq: 1, frame: '1:1', result: 'refused', reason: 'range' },
      { ...base, flora: 'x', result: 'refused', reason: 'range' },
    ]) {
      expect(() => encodeServerMessage(bad as ServerMessage), JSON.stringify(bad)).toThrow();
      expect(decodeServerMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('encodes each direction by its fields', () => {
    expect(JSON.parse(encodeMessage(hit))).toEqual(hit);
    const answer = { t: 'mine', seq: 1, frame: '1:2', node: '0_0_0_sodium_1', result: 'hit', hp: 0.5 } as const;
    expect(JSON.parse(encodeMessage(answer))).toEqual(answer);
  });

  it('round-trips the nodes’ state per cell, a reset, and an empty cell; bounds the lists', () => {
    const m = {
      t: 'nodes',
      frame: '424242:3',
      reset: true,
      cells: [
        { cell: '2_310_77', gone: ['copper_4', 'gamma_crystal_12'], hurt: [['sodium_0', 0.4]] },
        { cell: '2_311_77', gone: [], hurt: [] },
      ],
    } satisfies ServerMessage;
    expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    const { reset: _, ...plain } = m;
    expect(decodeServerMessage(encodeServerMessage(plain))).toEqual(plain);
    for (const bad of [
      { ...m, frame: '1:station' },
      { ...m, cells: [{ cell: '2_310', gone: [], hurt: [] }] },
      { ...m, cells: [{ cell: '2_310_77', gone: ['copper'], hurt: [] }] },
      { ...m, cells: [{ cell: '2_310_77', gone: [], hurt: [['sodium_0', 2]] }] },
      { ...m, cells: Array.from({ length: 129 }, () => ({ cell: '0_0_0', gone: [], hurt: [] })) },
    ]) {
      expect(decodeServerMessage(JSON.stringify(bad))).toBeNull();
    }
  });
});
