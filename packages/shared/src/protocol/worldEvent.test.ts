// World event messages (protocol 17, P2.E21.T01): what the server may say of an event, and what a client refuses.
import { describe, expect, it } from 'vitest';
import { decodeServerMessage, encodeServerMessage, InvalidMessageError, type ServerMessage } from './index.ts';

const event = {
  id: 4,
  event: 'hollow_tide',
  name: 'Hollow tide',
  system: 600,
  frame: '424242:2',
  center: [10, 6.3e6, 4] as [number, number, number],
  radius: 600,
  starts: 7200,
  ends: 8400,
};
const status = {
  t: 'event_status' as const,
  id: 4,
  phase: 2,
  level: 3,
  players: 3,
  wave: 1,
  waves: 5,
  enemies: 6,
  damage: 120,
  objective: 0,
  presence: 33.5,
  share: 0.4,
};
const reward = { t: 'event_reward' as const, id: 4, outcome: 'expired' as const, share: 0, xp: 0, units: 0, items: [], rep: [] };

const encodes = (m: unknown) => {
  try {
    encodeServerMessage(m as ServerMessage);
    return true;
  } catch (err) {
    if (!(err instanceof InvalidMessageError)) throw err;
    return false;
  }
};

describe('protocol: world events', () => {
  it('round-trips news, status and rewards', () => {
    for (const m of [{ t: 'world_event', op: 'announced', event }, { t: 'world_event', op: 'started', event }, status, reward] as ServerMessage[]) {
      expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    }
  });

  it('says how an event ended on its end and only there', () => {
    expect(encodes({ t: 'world_event', op: 'ended', event, outcome: 'completed' })).toBe(true);
    expect(encodes({ t: 'world_event', op: 'ended', event })).toBe(false);
    expect(encodes({ t: 'world_event', op: 'started', event, outcome: 'expired' })).toBe(false);
  });

  it('refuses a level past 12, a share past 1, a name with markup or an event that ends before it starts', () => {
    expect(encodes({ ...status, level: 13 })).toBe(false);
    expect(encodes({ ...status, players: 13 })).toBe(false);
    expect(encodes({ ...status, level: 0 })).toBe(false);
    expect(encodes({ ...status, share: 1.01 })).toBe(false);
    expect(encodes({ ...status, damage: Number.NaN })).toBe(false);
    expect(encodes({ t: 'world_event', op: 'started', event: { ...event, name: 'Tide‮' } })).toBe(false);
    expect(encodes({ t: 'world_event', op: 'started', event: { ...event, ends: 7200 } })).toBe(false);
    expect(encodes({ ...reward, xp: -1 })).toBe(false);
    expect(encodes({ ...reward, items: [{ item: 'count_residue', count: 0 }] })).toBe(false);
  });
});
