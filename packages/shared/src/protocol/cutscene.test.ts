// The cutscene messages (protocol 6): a client asks for one and says when it is done; the server answers play, ended
// or refused, with the story phase it plays in. One `cutscene` type serves both directions, told apart by its ops.
import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from './index.ts';

describe('cutscene messages', () => {
  it('arrived with protocol 6', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(6);
  });

  it('round-trips a request and a done, and refuses bad ids, ops and a skipped request', () => {
    for (const m of [
      { t: 'cutscene', op: 'request', id: 'test' },
      { t: 'cutscene', op: 'done', id: 'cold_open', skipped: true },
      { t: 'cutscene', op: 'done', id: 'cold_open' },
      { t: 'cutscene', op: 'done', id: 'cold_open', skipped: false, reason: 'finished' },
      { t: 'cutscene', op: 'done', id: 'cold_open', skipped: true, reason: 'skipped' },
      { t: 'cutscene', op: 'done', id: 'cold_open', skipped: true, reason: 'returned' },
      { t: 'cutscene', op: 'done', id: 'cold_open', reason: 'returned' },
    ] as const) {
      expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
    }
    for (const bad of [
      { t: 'cutscene', op: 'request', id: '../etc' },
      { t: 'cutscene', op: 'request', id: 'cold-open' },
      { t: 'cutscene', op: 'request', id: 'Test' },
      { t: 'cutscene', op: 'request', id: '' },
      { t: 'cutscene', op: 'request', id: 'x'.repeat(49) },
      { t: 'cutscene', op: 'request', id: 'test', skipped: true },
      { t: 'cutscene', op: 'play', id: 'test' },
      { t: 'cutscene', op: 'done', id: 'test', skipped: 'yes' },
      { t: 'cutscene', op: 'done', id: 'test', reason: 'bored' },
      { t: 'cutscene', op: 'request', id: 'test', reason: 'returned' },
      { t: 'cutscene', op: 'done', id: 'test', skipped: false, reason: 'returned' },
      { t: 'cutscene', op: 'done', id: 'test', skipped: true, reason: 'finished' },
    ]) {
      expect(decodeClientMessage(JSON.stringify(bad))).toBeNull();
    }
  });

  it('round-trips the server’s answers, which name the phase and why it was refused', () => {
    for (const m of [
      { t: 'cutscene', op: 'play', id: 'test', phase: 4 },
      { t: 'cutscene', op: 'ended', id: 'test', phase: null },
      ...(['unknown', 'denied', 'cooldown', 'busy', 'place', 'phase', 'zone'] as const).map((reason) => ({
        t: 'cutscene' as const,
        op: 'refused' as const,
        id: 'test',
        phase: null,
        reason,
      })),
    ] satisfies ServerMessage[]) {
      expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    }
    expect(() => encodeServerMessage({ t: 'cutscene', op: 'play', id: 'test', phase: 0 })).toThrow();
  });

  it('encodes each direction by its ops (the phase is never stripped from an answer)', () => {
    expect(JSON.parse(encodeMessage({ t: 'cutscene', op: 'play', id: 'test', phase: 4 }))).toEqual({ t: 'cutscene', op: 'play', id: 'test', phase: 4 });
    expect(JSON.parse(encodeMessage({ t: 'cutscene', op: 'request', id: 'test' }))).toEqual({ t: 'cutscene', op: 'request', id: 'test' });
  });
});
