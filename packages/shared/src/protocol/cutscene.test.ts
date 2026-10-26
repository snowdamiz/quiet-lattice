// The cutscene messages (protocol 4): a client asks for one and says when it is done; the server answers play, ended
// or refused. One `cutscene` type serves both directions, told apart by its ops.
import { describe, expect, it } from 'vitest';
import { decodeClientMessage, decodeServerMessage, encodeClientMessage, encodeMessage, encodeServerMessage, PROTOCOL_VERSION } from './index.ts';

describe('cutscene messages', () => {
  it('arrived with protocol 4', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(4);
  });

  it('round-trips a request and a done, and refuses bad ids and ops', () => {
    for (const m of [
      { t: 'cutscene', op: 'request', id: 'test' },
      { t: 'cutscene', op: 'done', id: 'cold-open', skipped: true },
    ] as const) {
      expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
    }
    for (const bad of [
      { t: 'cutscene', op: 'request', id: '../etc' },
      { t: 'cutscene', op: 'request', id: '' },
      { t: 'cutscene', op: 'request', id: 'x'.repeat(49) },
      { t: 'cutscene', op: 'play', id: 'test' },
      { t: 'cutscene', op: 'done', id: 'test', skipped: 'yes' },
    ]) {
      expect(decodeClientMessage(JSON.stringify(bad))).toBeNull();
    }
  });

  it('round-trips the server’s answers, which name the phase', () => {
    for (const m of [
      { t: 'cutscene', op: 'play', id: 'test', phase: 4 },
      { t: 'cutscene', op: 'ended', id: 'test', phase: null },
      { t: 'cutscene', op: 'refused', id: 'nope', phase: null, reason: 'unknown' },
    ] as const) {
      expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    }
    expect(() => encodeServerMessage({ t: 'cutscene', op: 'play', id: 'test', phase: 0 })).toThrow();
  });

  it('encodes each direction by its ops (the phase is never stripped from an answer)', () => {
    expect(JSON.parse(encodeMessage({ t: 'cutscene', op: 'play', id: 'test', phase: 4 }))).toEqual({ t: 'cutscene', op: 'play', id: 'test', phase: 4 });
    expect(JSON.parse(encodeMessage({ t: 'cutscene', op: 'request', id: 'test' }))).toEqual({ t: 'cutscene', op: 'request', id: 'test' });
  });
});
