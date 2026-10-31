// The analysis messages (protocol 12, P1.E08.T04): a request to analyze a creature, and its answer (new with the codex
// entry and the XP it earned, known with the entry, refused with why). One `analyze` type serves both directions, told
// apart by its fields.
import { describe, expect, it } from 'vitest';
import {
  AnalyzeRefusal,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './index.ts';

const ask = { t: 'analyze', seq: 1, time: 3600.5, target: 42 } as const satisfies ClientMessage;
const species = {
  key: '424242:3/5',
  world: '424242:3',
  index: 5,
  name: 'Horned Velar Bull',
  temperament: 'territorial',
  threat: 2,
  bodyPlan: 'quad_heavy',
  bond: 'big_game',
  at: 3600.5,
} as const;

describe('analysis messages', () => {
  it('arrived with protocol 12', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(12);
  });

  it('round-trips a request, and refuses malformed ones', () => {
    expect(decodeClientMessage(encodeClientMessage(ask))).toEqual(ask);
    for (const bad of [
      { ...ask, seq: 0 },
      { ...ask, seq: 1.5 },
      { ...ask, target: -1 },
      { ...ask, target: 2 ** 32 },
      { ...ask, target: '42' },
      { ...ask, time: -1 },
      { ...ask, time: Number.NaN },
      { t: 'analyze', seq: 1, target: 42 },
      { t: 'analyze', seq: 1, time: 0 },
    ]) {
      expect(decodeClientMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('round-trips the answers: new with the entry and the XP, known with the entry, refused with why', () => {
    const base = { t: 'analyze', seq: 3, target: 42 } as const;
    const answers = [
      { ...base, result: 'new', species, xp: 300 },
      { ...base, result: 'known', species },
      ...AnalyzeRefusal.options.map((reason) => ({ ...base, result: 'refused' as const, reason })),
    ] satisfies ServerMessage[];
    for (const m of answers) expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    for (const bad of [
      { ...base, result: 'new', species },
      { ...base, result: 'known', species, xp: 300 },
      { ...base, result: 'known' },
      { ...base, result: 'refused' },
      { ...base, result: 'refused', reason: 'range', species },
      { ...base, result: 'refused', reason: 'far' },
      { ...base, result: 'new', species: { ...species, threat: 6 }, xp: 300 },
      { ...base, result: 'new', species: { ...species, bond: 'never' }, xp: 300 },
      { ...base, result: 'new', species: { ...species, key: '424242:station/5' }, xp: 300 },
      { ...base, result: 'new', species: { ...species, world: '424242:station' }, xp: 300 },
      { ...base, result: 'new', species: { ...species, index: 64 }, xp: 300 },
      { ...base, result: 'new', species: { ...species, secret: 1 }, xp: 300 },
      { ...base, result: 'new', species, xp: -1 },
    ]) {
      expect(decodeServerMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('tells the request from the answer', () => {
    expect(decodeServerMessage(encodeMessage(ask))).toBeNull();
    const answer = { t: 'analyze', seq: 3, target: 42, result: 'known', species } as const satisfies ServerMessage;
    const text = encodeMessage(answer);
    expect(decodeServerMessage(text)).toEqual(answer);
    expect(decodeClientMessage(text)).toBeNull();
  });
});
