// The client's first finds (P2.E29.T01): its system's finds as the server sends them (the whole system on a reset, then
// each new find and name), the name to show (its finder's, else the procedural one), what its own character may still
// name, the name request it sends and the answer it keeps, and starting over on every welcome.
import { encodeServerMessage } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { Net } from './Net.js';

/** A WebSocket the test plays the server for. */
class FakeSocket {
  constructor() {
    this.readyState = 0;
    this.sent = [];
    FakeSocket.last = this;
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(m) {
    this.onmessage?.({ data: encodeServerMessage(m) });
  }
}

const WELCOME = {
  t: 'welcome',
  accountId: 'a1',
  character: { id: 'c1', name: 'Tess Arlo', people: 'thalune', look: { palette: 0, pattern: 0, head: 0, suit: 0 }, level: 1, homeSystem: 0 },
  entityId: 7,
  serverTime: 1000,
  zone: { id: 'sys:0', systemSeed: 1 },
  pose: { frame: '1:station', pos: [30, 2.4, 22], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
  mode: 'docked',
};

function joined() {
  const net = new Net({ url: 'ws://x/ws', token: 't', characterId: 'c1', WebSocket: FakeSocket, now: () => 0, timers: { setTimeout, clearTimeout } });
  net.connect();
  const socket = FakeSocket.last;
  socket.open();
  socket.push(WELCOME);
  return { net, socket, d: net.discoveries };
}

const body = { kind: 'body', key: '1:2', finder: 'Bo Tran', at: 900, name: 'Halcyon' };
const species = { kind: 'species', key: '1:2/3', finder: 'Tess Arlo', at: 990, until: 1590 };
const site = { kind: 'site', key: '1:2#7', finder: 'Tess Arlo', at: 100 };

describe('first finds on the client', () => {
  it('holds its system’s finds and shows each by its finder’s name, else its procedural one', () => {
    const { socket, d } = joined();
    let heard = 0;
    d.subscribe(() => heard++);
    socket.push({ t: 'discoveries', system: 0, reset: true, entries: [body, species] });
    expect(d.system).toBe(0);
    expect(d.displayName('body', '1:2', 'Vexmir II')).toBe('Halcyon');
    expect(d.displayName('species', '1:2/3', 'Horned Velar Bull')).toBe('Horned Velar Bull');
    expect(d.nameOf('species', '1:2/3')).toBeNull();
    expect(d.entry('species', '1:2/3')).toEqual(species);
    // a name given, and a new find, arrive as updates
    socket.push({ t: 'discoveries', system: 0, entries: [{ ...species, name: 'Glass Velar', until: undefined }, site] });
    expect(d.displayName('species', '1:2/3', 'Horned Velar Bull')).toBe('Glass Velar');
    expect(d.entry('site', '1:2#7')).toEqual(site);
    // another system's news is not this system's; its reset replaces everything
    socket.push({ t: 'discoveries', system: 4, entries: [{ ...body, key: '9:1' }] });
    expect(d.entry('body', '9:1')).toBeUndefined();
    socket.push({ t: 'discoveries', system: 4, reset: true, entries: [] });
    expect(d.byId.size).toBe(0);
    expect(heard).toBe(3);
  });

  it('lists what its character may still name, sends the request and keeps the answer', () => {
    const { net, socket, d } = joined();
    socket.push({ t: 'discoveries', system: 0, reset: true, entries: [body, species, site, { ...species, key: '1:2/4', finder: 'Bo Tran' }] });
    expect(d.mine('Tess Arlo', 1000)).toEqual([species]);
    expect(d.mine('Tess Arlo', 1600)).toEqual([]);
    expect(d.name('species', '1:2/3', 'Glass Velar')).toBe(true);
    expect(socket.sent.at(-1)).toEqual({ t: 'name', kind: 'species', key: '1:2/3', name: 'Glass Velar' });
    socket.push({ t: 'named', kind: 'species', key: '1:2/3', result: 'refused', reason: 'blocked' });
    expect(d.answer).toEqual({ t: 'named', kind: 'species', key: '1:2/3', result: 'refused', reason: 'blocked' });
    // a request the schema refuses never leaves
    expect(d.name('species', '1:2/3', '')).toBe(false);
    expect(d.answer).toBeNull();
    net.close();
    expect(d.name('species', '1:2/3', 'Glass Velar')).toBe(false);
  });

  it('starts over on every welcome', () => {
    const { socket, d } = joined();
    socket.push({ t: 'discoveries', system: 0, reset: true, entries: [body] });
    socket.push(WELCOME);
    expect(d.byId.size).toBe(0);
    expect(d.system).toBeNull();
    expect(d.displayName('body', '1:2', 'Vexmir II')).toBe('Vexmir II');
  });
});
