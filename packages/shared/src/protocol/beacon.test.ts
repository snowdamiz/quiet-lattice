// The call-for-aid beacon messages (protocol 11, P1.E15.T02): a client raises, lowers, watches, unwatches or answers;
// the server sends the shard's list (whole, then changes), news to whom a beacon concerns, and refusals as `denied`. One
// `beacon` type serves both directions, told apart by its fields.
import { describe, expect, it } from 'vitest';
import {
  BEACON_MAX,
  BeaconView,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeMessage,
  encodeServerMessage,
  InvalidMessageError,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './index.ts';

const listed: BeaconView = {
  id: 7,
  kind: 'story',
  system: 0,
  frame: '424242:2',
  center: [1200.5, -40, 3e6],
  radius: 250,
  place: 'First Jobs',
  quest: 'first_jobs',
  from: "Ana Vel'ka",
  open: 4,
  cap: 6,
  at: 3600.25,
  until: 4200.25,
};

describe('beacon messages', () => {
  it('arrived with protocol 11', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(11);
  });

  it('round-trips every request, and refuses malformed ones', () => {
    const ops = [{ op: 'raise' }, { op: 'lower' }, { op: 'watch' }, { op: 'unwatch' }, { op: 'answer', id: 0xffffffff }] as const;
    for (const op of ops) {
      const m = { t: 'beacon', op } satisfies ClientMessage;
      expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
    }
    for (const bad of [
      { t: 'beacon', op: { op: 'answer' } },
      { t: 'beacon', op: { op: 'answer', id: 0 } },
      { t: 'beacon', op: { op: 'answer', id: 1.5 } },
      { t: 'beacon', op: { op: 'answer', id: 2 ** 32 } },
      { t: 'beacon', op: { op: 'answer', id: '7' } },
      { t: 'beacon', op: { op: 'claim', id: 7 } },
      { t: 'beacon', op: 'raise' },
      { t: 'beacon' },
    ]) {
      expect(decodeClientMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('round-trips the list and every piece of news, and tells the two beacon messages apart', () => {
    const server: ServerMessage[] = [
      { t: 'beacons', reset: true, beacons: [listed, { ...listed, id: 8, kind: 'raid', quest: undefined, place: 'Vault', cap: 12, open: 11 }], gone: [] },
      { t: 'beacons', beacons: [], gone: [3, 4] },
      { t: 'beacon', op: 'raised', id: 7, beacon: listed },
      { t: 'beacon', op: 'answered', id: 7, name: 'Bo Tran' },
      { t: 'beacon', op: 'joined', id: 7, phase: 12 },
      ...(['lowered', 'full', 'closed', 'left', 'expired'] as const).map((why) => ({ t: 'beacon' as const, op: 'ended' as const, id: 7, why })),
    ];
    for (const m of server) {
      const text = encodeMessage(m);
      expect(decodeServerMessage(text)).toEqual(JSON.parse(JSON.stringify(m)));
      expect(decodeClientMessage(text)).toBeNull();
    }
    expect(decodeServerMessage(encodeMessage({ t: 'beacon', op: { op: 'raise' } }))).toBeNull();
    // the list is bounded on both of its arrays
    const many = Array.from({ length: BEACON_MAX }, (_, i) => ({ ...listed, id: i + 1 }));
    expect(decodeServerMessage(encodeServerMessage({ t: 'beacons', reset: true, beacons: many, gone: [] }))).not.toBeNull();
    expect(decodeServerMessage(JSON.stringify({ t: 'beacons', beacons: [...many, { ...listed, id: 999 }], gone: [] }))).toBeNull();
    expect(decodeServerMessage(JSON.stringify({ t: 'beacons', beacons: [], gone: Array.from({ length: BEACON_MAX + 1 }, (_, i) => i + 1) }))).toBeNull();
  });

  it('refuses a beacon that could not be: no slot open, more open than its cap allows, a lapse before its raise, a place not plain text', () => {
    for (const bad of [
      { ...listed, open: 0 },
      { ...listed, open: 6 },
      { ...listed, cap: 1, open: 1 },
      { ...listed, cap: 65 },
      { ...listed, until: listed.at },
      { ...listed, place: '   ' },
      { ...listed, place: 'First‮Jobs' },
      { ...listed, place: 'x'.repeat(65) },
      { ...listed, from: 'SYSTEM:' },
      { ...listed, kind: 'bay' },
      { ...listed, system: 1024 },
      { ...listed, quest: 'First Jobs' },
      { ...listed, radius: 0 },
      { ...listed, frame: '424242:01' },
      { ...listed, center: [Number.NaN, 0, 0] },
    ]) {
      expect(BeaconView.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
      expect(() => encodeServerMessage({ t: 'beacons', beacons: [bad as BeaconView], gone: [] })).toThrow(InvalidMessageError);
    }
    expect(BeaconView.safeParse({ ...listed, frame: null }).success).toBe(true);
  });

  it('carries each piece of news with its own field only', () => {
    for (const bad of [
      { t: 'beacon', op: 'raised', id: 7 },
      { t: 'beacon', op: 'raised', id: 8, beacon: listed },
      { t: 'beacon', op: 'answered', id: 7 },
      { t: 'beacon', op: 'answered', id: 7, name: 'Bo', why: 'full' },
      { t: 'beacon', op: 'joined', id: 7 },
      { t: 'beacon', op: 'joined', id: 7, phase: 0 },
      { t: 'beacon', op: 'ended', id: 7 },
      { t: 'beacon', op: 'ended', id: 7, why: 'kicked' },
      { t: 'beacon', op: 'ended', id: 7, why: 'full', phase: 3 },
      { t: 'beacon', op: 'lowered', id: 7 },
    ]) {
      expect(decodeServerMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('refuses beacon requests with the social refusals and its own', () => {
    for (const [of, code] of [
      ['raise', 'no_phase'],
      ['raise', 'kind'],
      ['raise', 'raised'],
      ['raise', 'full'],
      ['raise', 'busy'],
      ['lower', 'unknown'],
      ['answer', 'unknown'],
      ['answer', 'self'],
      ['answer', 'elsewhere'],
      ['answer', 'far'],
      ['answer', 'in_phase'],
      ['answer', 'full'],
      ['answer', 'in_party'],
      ['answer', 'gone'],
    ] as const) {
      const m = { t: 'denied', of, code } satisfies ServerMessage;
      expect(decodeServerMessage(encodeMessage(m))).toEqual(m);
    }
    const rate = { t: 'denied', of: 'raise', code: 'rate', retryS: 30 } satisfies ServerMessage;
    expect(decodeServerMessage(encodeMessage(rate))).toEqual(rate);
    expect(decodeServerMessage('{"t":"denied","of":"watch","code":"unknown"}')).toBeNull();
  });
});
