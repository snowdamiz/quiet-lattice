// The combat messages (protocol 10, P1.E06.T02): a shot of the base gun and its answer, combat events with the target's
// health, XP events. A shot carries no amount: one with any field it does not define is refused whole, and nothing a client
// sends can be a combat event.
import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeMessage,
  encodeServerMessage,
  FireRefusal,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './index.ts';

const shot = { t: 'fire', seq: 3, time: 3600.25, frame: '424242:3', aim: [0, -0.5, -0.8] } as const satisfies ClientMessage;

describe('combat messages', () => {
  it('arrived with protocol 10', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(10);
  });

  it('round-trip a shot in a body’s frame, the Waystation’s or the inertial one', () => {
    for (const frame of ['424242:3', '424242:station', null]) {
      const m = { ...shot, frame };
      expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
      expect(decodeClientMessage(encodeMessage(m))).toEqual(m);
    }
  });

  it('refuse a shot that says what it did, or is malformed', () => {
    for (const bad of [
      // a client never says what its shot did, nor at whom
      { ...shot, damage: 9999 },
      { ...shot, amount: 50 },
      { ...shot, target: 12 },
      { ...shot, killed: true },
      { ...shot, seq: 0 },
      { ...shot, time: -1 },
      { ...shot, aim: [0, 0, 0] },
      { ...shot, aim: [0, 0, Number.NaN] },
      { ...shot, frame: '424242:01' },
      { t: 'fire', seq: 1, time: 1, aim: [0, 0, 1] },
    ])
      expect(decodeClientMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    expect(() => encodeClientMessage({ ...shot, damage: 1 } as unknown as ClientMessage)).toThrow();
  });

  it('never take a combat, loot or XP event, nor a shot’s answer, from a client', () => {
    for (const event of [
      { kind: 'combat', source: 1, target: 9, amount: 1e5, damageType: 'weapon', killed: true },
      { kind: 'loot', item: 'units', count: 1e6, from: 9 },
      { kind: 'xp', amount: 1e6, from: 9, level: 50 },
    ])
      expect(decodeClientMessage(JSON.stringify({ t: 'event', event }))).toBeNull();
    expect(decodeClientMessage(JSON.stringify({ t: 'fire', seq: 1, result: 'hit', target: 9 }))).toBeNull();
  });

  it('round-trip each answer, and keep a hit, a miss, a blocked shot and a refusal apart', () => {
    const answers: ServerMessage[] = [
      { t: 'fire', seq: 3, result: 'hit', target: 41 },
      { t: 'fire', seq: 3, result: 'miss' },
      { t: 'fire', seq: 3, result: 'blocked' },
      ...FireRefusal.options.map((reason) => ({ t: 'fire' as const, seq: 3, result: 'refused' as const, reason })),
    ];
    for (const m of answers) {
      expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
      expect(decodeServerMessage(encodeMessage(m))).toEqual(m);
      expect(decodeClientMessage(encodeServerMessage(m))).toBeNull();
    }
    for (const bad of [
      { t: 'fire', seq: 3, result: 'hit' },
      { t: 'fire', seq: 3, result: 'miss', target: 4 },
      { t: 'fire', seq: 3, result: 'refused' },
      { t: 'fire', seq: 3, result: 'hit', target: 4, reason: 'rate' },
      { t: 'fire', seq: 3, result: 'refused', reason: 'nope' },
    ])
      expect(decodeServerMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
  });

  it('carry the target’s health on a combat event, and XP with the level it reached', () => {
    const hit = {
      t: 'event',
      event: { kind: 'combat', source: 5, target: 9, amount: 11, damageType: 'weapon', ability: 'pulse_lasers', killed: false, hp: 0.25 },
    } as const;
    expect(decodeServerMessage(encodeServerMessage(hit))).toEqual(hit);
    expect(decodeServerMessage(JSON.stringify({ ...hit, event: { ...hit.event, hp: 1.5 } }))).toBeNull();
    const xp = { t: 'event', event: { kind: 'xp', amount: 42, from: 9, level: 3 } } as const;
    expect(decodeServerMessage(encodeServerMessage(xp))).toEqual(xp);
    for (const bad of [{ amount: 0 }, { amount: 1.5 }, { level: 51 }])
      expect(decodeServerMessage(JSON.stringify({ ...xp, event: { ...xp.event, ...bad } }))).toBeNull();
  });
});
