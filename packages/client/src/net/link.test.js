// The bad network on demand (net/link.js): messages held each way and delivered in order once due by the page's clock,
// a share lost each way from the welcome on, a chosen one lost, and what went onto the wire and came back over it counted.
import { encodeClientMessage, encodeServerMessage, encodeSnapshot } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { linkConditioner } from './link.js';
import { Net } from './Net.js';

function fakeSocketClass() {
  const made = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      made.push(this);
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
  }
  return { FakeSocket, made };
}

function setup(opts = {}) {
  const clock = { ms: 0 };
  const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  const { FakeSocket, made } = fakeSocketClass();
  const link = linkConditioner({ latencyMs: 100, loss: 0, seed: 3, now: () => clock.ms, timers, WebSocket: FakeSocket, ...opts });
  const ws = new link.WebSocket('ws://test');
  const got = [];
  ws.onmessage = (e) => got.push(e.data);
  ws.onclose = () => got.push('closed');
  const at = (ms) => {
    clock.ms = ms;
    link.pump();
  };
  return { link, ws, wire: made[0], got, at };
}

const pose = { frame: null, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
const input = (seq) => encodeClientMessage({ t: 'input', seq, time: seq, mode: 'ship', pose, buttons: 0 });
// (the link reads only its type)
const welcome = JSON.stringify({ t: 'welcome', entityId: 1 });
const pong = (id) => encodeServerMessage({ t: 'pong', id, clientTime: 0, serverTime: 0 });

describe('linkConditioner', () => {
  it('holds every message its latency each way and delivers them in order once due', () => {
    const { ws, wire, got, at, link } = setup();
    ws.send(input(1));
    at(50);
    ws.send(input(2));
    at(99);
    expect(wire.sent).toEqual([]);
    at(100);
    expect(wire.sent).toEqual([input(1)]);
    expect(link.stats.released).toBe(1);
    at(150);
    expect(wire.sent).toEqual([input(1), input(2)]);
    wire.onmessage({ data: pong(1) });
    wire.onmessage({ data: pong(2) });
    wire.close();
    at(249);
    expect(got).toEqual([]);
    at(250);
    expect(got).toEqual([pong(1), pong(2), 'closed']);
  });

  it('counts actual zone-tagged Net inputs and reordered fields only once they reach the wire', () => {
    const { ws, wire, at, link } = setup();
    const net = new Net({ url: 'ws://test', token: 'tok', characterId: 'c1' });
    net.ws = ws;
    net.state = 'joined';
    net.zone = { id: 'sys:0', systemSeed: 1 };
    net.input = () => ({ mode: 'ship', pose, buttons: 0, time: 1 });
    expect(net.sendInput(0)).toBe(true);
    expect(link.stats.released).toBe(0);
    at(100);
    expect(JSON.parse(wire.sent[0])).toMatchObject({ t: 'input', zone: 'sys:0', seq: 1 });
    expect(link.stats.released).toBe(1);
    const { t, ...rest } = net.lastInput;
    ws.send(JSON.stringify({ ...rest, seq: 2, t }));
    at(200);
    expect(link.stats.released).toBe(2);
    const snap = encodeSnapshot({ tick: 1, time: 1, ack: 2, full: true, entities: [], removed: [] });
    wire.onmessage({ data: snap });
    expect(link.stats.answered).toBe(link.stats.released);
  });

  it('counts the newest input a snapshot answers as it comes over the wire, before it is held', () => {
    const { wire, got, link } = setup();
    const snap = encodeSnapshot({ tick: 4, time: 1, ack: 17, full: true, entities: [], removed: [] });
    wire.onmessage({ data: snap.buffer.slice(snap.byteOffset, snap.byteOffset + snap.byteLength) });
    expect(link.stats.answered).toBe(17);
    expect(got).toEqual([]);
  });

  it('loses its share of messages each way from the welcome on, never before', () => {
    const { ws, wire, got, at, link } = setup({ loss: 0.02 });
    for (let i = 1; i <= 200; i++) ws.send(input(i));
    for (let i = 1; i <= 200; i++) wire.onmessage({ data: pong(i) });
    at(100);
    expect(wire.sent).toHaveLength(200);
    expect(got).toHaveLength(200);
    wire.onmessage({ data: welcome });
    for (let i = 201; i <= 5200; i++) ws.send(input(i));
    for (let i = 201; i <= 5200; i++) wire.onmessage({ data: pong(i) });
    at(200);
    expect(got[200]).toBe(welcome);
    expect(link.stats.lostOut / 5000).toBeGreaterThan(0.015);
    expect(link.stats.lostOut / 5000).toBeLessThan(0.025);
    expect(link.stats.lostIn / 5000).toBeGreaterThan(0.015);
    expect(link.stats.lostIn / 5000).toBeLessThan(0.025);
    expect(wire.sent).toHaveLength(5200 - link.stats.lostOut);
  });

  it('loses the next server message of a type when told to', () => {
    const { wire, got, at, link } = setup();
    link.dropNext('pong');
    wire.onmessage({ data: pong(1) });
    wire.onmessage({ data: pong(2) });
    at(100);
    expect(got).toEqual([pong(2)]);
    expect(link.stats.lostIn).toBe(1);
  });
});
