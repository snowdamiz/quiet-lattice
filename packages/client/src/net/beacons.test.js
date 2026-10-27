// The client's beacon list (P1.E15.T02): what the server lists while the client watches (the whole list, then changes),
// the character's own beacon from its news, refusals, the requests it sends, and watching again after a reconnect.
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
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: '' });
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

const beacon = (id, extra = {}) => ({
  id,
  kind: 'event',
  system: 0,
  frame: '1:station',
  center: [0, 0, 0],
  radius: 300,
  place: 'Wreck',
  from: 'Bo Tran',
  open: 5,
  cap: 12,
  at: 900 + id,
  until: 1500 + id,
  ...extra,
});

function joined() {
  const timers = [];
  const net = new Net({
    url: 'ws://test/ws',
    token: 'tok',
    characterId: 'c1',
    WebSocket: FakeSocket,
    now: () => 10_000,
    random: () => 1,
    timers: { setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => {} },
  });
  net.connect();
  FakeSocket.last.open();
  FakeSocket.last.push(WELCOME);
  const requests = () => FakeSocket.last.sent.filter((m) => m.t === 'beacon').map((m) => m.op);
  return { net, beacons: net.beacons, timers, requests, socket: () => FakeSocket.last };
}

describe('beacons on the client', () => {
  it('sends each request as the protocol has it, and nothing the schema refuses', () => {
    const { beacons, requests } = joined();
    expect([beacons.watch(), beacons.raise(), beacons.lower(), beacons.answer(4), beacons.unwatch()]).toEqual([true, true, true, true, true]);
    expect(beacons.answer(0)).toBe(false);
    expect(requests()).toEqual([{ op: 'watch' }, { op: 'raise' }, { op: 'lower' }, { op: 'answer', id: 4 }, { op: 'unwatch' }]);
  });

  it('holds the list as the server sends it: whole as it starts watching, then changes, newest first', () => {
    const { beacons, socket } = joined();
    const seen = [];
    beacons.subscribe((b) => seen.push(b.list().map((x) => x.id)));
    beacons.watch();
    socket().push({ t: 'beacons', reset: true, beacons: [beacon(1), beacon(2)], gone: [] });
    socket().push({ t: 'beacons', beacons: [beacon(3), beacon(1, { open: 4 })], gone: [2] });
    expect(beacons.list()).toEqual([beacon(3), beacon(1, { open: 4 })]);
    socket().push({ t: 'beacons', beacons: [], gone: [3, 99] });
    expect(seen).toEqual([[2, 1], [3, 1], [1]]);
    beacons.unwatch();
    expect(beacons.list()).toEqual([]);
  });

  it('keeps its own beacon from the news, and the last refusal of a request', () => {
    const { beacons, socket } = joined();
    socket().push({ t: 'denied', of: 'raise', code: 'rate', retryS: 30 });
    socket().push({ t: 'denied', of: 'chat', code: 'muted', retryS: 60 });
    expect(beacons.refusal).toEqual({ of: 'raise', code: 'rate', retryS: 30 });
    beacons.raise();
    expect(beacons.refusal).toBeNull();
    const mine = beacon(5, { from: 'Tess Arlo' });
    socket().push({ t: 'beacon', op: 'raised', id: 5, beacon: mine });
    expect(beacons.own).toEqual(mine);
    beacons.watch();
    socket().push({ t: 'beacons', beacons: [{ ...mine, open: 3 }], gone: [] });
    expect(beacons.own).toMatchObject({ id: 5, open: 3 });
    socket().push({ t: 'beacon', op: 'answered', id: 5, name: 'Bo Tran' });
    socket().push({ t: 'beacon', op: 'ended', id: 5, why: 'full' });
    expect(beacons.own).toBeNull();
    socket().push({ t: 'beacon', op: 'joined', id: 8, phase: 12 });
    expect(beacons.joined).toEqual({ id: 8, phase: 12 });
    socket().push({ t: 'denied', of: 'answer', code: 'far' });
    expect(beacons.refusal).toEqual({ of: 'answer', code: 'far' });
  });

  it('watches again after a reconnect (a new connection starts unwatched), the list starting over', () => {
    const { beacons, socket, timers, requests } = joined();
    beacons.watch();
    socket().push({ t: 'beacons', reset: true, beacons: [beacon(1)], gone: [] });
    socket().push({ t: 'beacon', op: 'raised', id: 1, beacon: beacon(1) });
    socket().drop();
    timers.at(-1).fn();
    socket().open();
    socket().push(WELCOME);
    expect(beacons.list()).toEqual([]);
    expect(beacons.own).toBeNull();
    expect(requests()).toEqual([{ op: 'watch' }]);
    // not watching, a reconnect asks for nothing
    beacons.unwatch();
    socket().drop();
    timers.at(-1).fn();
    socket().open();
    socket().push(WELCOME);
    expect(requests()).toEqual([]);
  });
});
