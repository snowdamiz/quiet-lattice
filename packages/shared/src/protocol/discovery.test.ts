// The first finders' messages (protocol 16, P2.E29.T01): a request to name a find, its answer, and a system's finds with
// their names. A request's name is held to chat's text rules on the wire; the moderation filter's own rules are the
// server's to answer (`named` with a reason), so a name too long is answered rather than dropped.
import { describe, expect, it } from 'vitest';
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

const ask = { t: 'name', kind: 'body', key: '424242:3', name: 'Halcyon' } as const satisfies ClientMessage;

describe('first-finder messages', () => {
  it('arrived with protocol 16', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(16);
  });

  it('round-trips a request for every kind, and refuses malformed ones', () => {
    for (const m of [ask, { ...ask, kind: 'species', key: '424242:3/4' }, { ...ask, kind: 'site', key: '0:12#159' }] as const) {
      expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
    }
    // (a name the filter refuses still travels: the server says why)
    expect(decodeClientMessage(JSON.stringify({ ...ask, name: 'x'.repeat(64) }))).not.toBeNull();
    for (const bad of [
      { ...ask, key: '424242:station' },
      { ...ask, kind: 'site', key: '424242:3' },
      { ...ask, kind: 'species', key: '424242:3#2' },
      { ...ask, kind: 'body', key: '424242:3/4' },
      { ...ask, kind: 'city' },
      { ...ask, key: '99999999999:1' },
      { ...ask, name: '' },
      { ...ask, name: '   ' },
      { ...ask, name: 'x'.repeat(65) },
      { ...ask, name: 'Hal‮con' },
      { ...ask, name: 'Hal\ncyon' },
      { ...ask, seq: 1 },
      { t: 'name', kind: 'body', key: '424242:3' },
    ]) {
      expect(decodeClientMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('round-trips the answers and a system’s finds, and holds them to their shapes', () => {
    const named: ServerMessage = { t: 'named', kind: 'body', key: '424242:3', result: 'named', name: 'Halcyon' };
    const refused: ServerMessage = { t: 'named', kind: 'body', key: '424242:3', result: 'refused', reason: 'blocked' };
    const finds: ServerMessage = {
      t: 'discoveries',
      system: 3,
      entries: [{ kind: 'species', key: '424242:3/4', finder: 'Bo Tran', at: 10, until: 610 }],
    };
    for (const m of [named, refused, finds]) expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
    // (one type each way: a request is never taken for an answer)
    expect(JSON.parse(encodeMessage(ask))).toEqual(ask);
    for (const bad of [
      { ...named, name: undefined },
      { ...named, reason: 'blocked' },
      { ...refused, reason: undefined },
      { ...refused, name: 'Halcyon' },
      { ...finds, system: 1024 },
      { ...finds, entries: [{ kind: 'species', key: '424242:3', finder: 'Bo Tran', at: 10 }] },
      { ...finds, entries: [{ kind: 'body', key: '424242:3', finder: 'Bo Tran', at: 10, name: 'Halcyon', until: 20 }] },
      { ...finds, entries: [{ kind: 'body', key: '424242:3', finder: 'not a name!', at: 10 }] },
    ]) {
      expect(() => encodeServerMessage(bad as ServerMessage), JSON.stringify(bad)).toThrow();
    }
  });
});
