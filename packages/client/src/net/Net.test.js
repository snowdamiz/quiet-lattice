// The client net layer (P1.E04.T01): the socket's lifecycle against a scripted server, snapshot baselines and acks, the
// server clock, input pacing, and reconnecting with backoff.
import { PROTOCOL_VERSION, encodeServerMessage, encodeSnapshot } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { ClockSync } from './clock.js';
import { FINAL_REFUSALS, INPUT_INTERVAL_MS, Net, PING_INTERVAL_MS, RECONNECT } from './Net.js';
import { SnapshotStore } from './snapshots.js';

/** A WebSocket the test plays the server for. */
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.all.push(this);
  }

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  // ---- the server's side ----
  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  push(m) {
    this.onmessage?.({ data: encodeServerMessage(m) });
  }

  pushBinary(bytes) {
    // (as the browser hands it over with binaryType 'arraybuffer')
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }

  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }

  types() {
    return this.sent.map((m) => m.t);
  }
}
FakeSocket.all = [];

const POSE = { frame: '1:station', pos: [30, 2.4, 22], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
const CHARACTER = { id: 'c1', name: 'Tess Arlo', people: 'thalune', look: { palette: 0, pattern: 0, head: 0, suit: 0 }, level: 1, homeSystem: 0 };
const welcome = (serverTime = 1000) => ({
  t: 'welcome',
  accountId: 'a1',
  character: CHARACTER,
  entityId: 7,
  serverTime,
  zone: { id: 'sys:0', systemSeed: 1 },
  pose: POSE,
  mode: 'docked',
});
const INVENTORY = { stackMax: 9999, units: 2500, suit: [{ item: 'warp_cell', count: 1 }, null], pods: [[null, null]] };

function harness() {
  FakeSocket.all = [];
  let t = 10_000;
  const timers = [];
  const net = new Net({
    url: 'ws://test/ws',
    token: 'tok',
    characterId: 'c1',
    WebSocket: FakeSocket,
    now: () => t,
    random: () => 1,
    timers: {
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      clearTimeout: () => {},
    },
  });
  const events = [];
  for (const type of ['state', 'welcome', 'inventory', 'world', 'refused', 'snapshot', 'lost', 'closed', 'correction']) net.on(type, (...a) => events.push([type, ...a]));
  return {
    net,
    timers,
    events,
    advance: (ms) => (t += ms),
    socket: () => FakeSocket.all.at(-1),
  };
}

/** Connected, welcomed and handed its inventory. */
function joined() {
  const h = harness();
  h.net.connect();
  h.socket().open();
  h.advance(40);
  h.socket().push(welcome());
  h.socket().push({ t: 'world', season: 1, count: 500, edgeX: 50, tiers: [0, 1], serverTime: 1000 });
  h.socket().push({ t: 'inventory', seq: 0, inventory: INVENTORY });
  return h;
}

const entity = (id, x) => ({ id, kind: 'player', frame: '1:station', pos: [x, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'docked' });

describe('Net: joining', () => {
  it('sends hello with the protocol version and the token, then join, as soon as the socket opens', () => {
    const h = harness();
    h.net.connect();
    expect(h.net.state).toBe('connecting');
    expect(h.socket().url).toBe('ws://test/ws');
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open();
    expect(h.socket().sent).toEqual([
      { t: 'hello', version: PROTOCOL_VERSION, token: 'tok' },
      { t: 'join', characterId: 'c1' },
    ]);
    expect(h.net.state).toBe('joining');
  });

  it('is in the world on welcome: the entity, the zone, a ping, and the inventory after it marked as the first', () => {
    const h = joined();
    expect(h.net.state).toBe('joined');
    expect(h.net.entityId).toBe(7);
    expect(h.net.zone).toEqual({ id: 'sys:0', systemSeed: 1 });
    expect(h.events.find((e) => e[0] === 'welcome')).toEqual(['welcome', welcome(), true]);
    expect(h.socket().types().slice(2)).toEqual(['ping']);
    expect(h.net.world.count).toBe(500);
    h.socket().push({ t: 'inventory', seq: 0, inventory: INVENTORY });
    expect(h.events.filter((e) => e[0] === 'inventory').map((e) => e[2])).toEqual([true, false]);
  });

  it('estimates the server clock from welcome, then from pongs, the shortest round trip winning', () => {
    const h = joined();
    // welcome: joined 40 ms after the join left, server time 1000 → about 1000.02 at that moment
    expect(h.net.serverTime()).toBeCloseTo(1000.02, 6);
    const ping = h.socket().sent.find((m) => m.t === 'ping');
    h.advance(10);
    h.socket().push({ t: 'pong', id: ping.id, clientTime: ping.clientTime, serverTime: 2000 });
    expect(h.net.clock.rtt).toBe(10);
    expect(h.net.serverTime()).toBeCloseTo(2000.005, 6);
    h.advance(1000);
    expect(h.net.serverTime()).toBeCloseTo(2001.005, 6);
  });
});

describe('Net: input', () => {
  it('sends input at most every 50 ms of real time, numbered from 1 and stamped with the server time', () => {
    const h = joined();
    const pose = { ...POSE, pos: [30, 2.4, 22] };
    h.net.input = () => ({ mode: 'docked', pose, buttons: 0 });
    for (let i = 0; i < 10; i++) h.net.update();
    h.advance(INPUT_INTERVAL_MS - 1);
    h.net.update();
    h.advance(1);
    h.net.update();
    const inputs = h.socket().sent.filter((m) => m.t === 'input');
    expect(inputs.map((m) => m.seq)).toEqual([1, 2]);
    expect(inputs[0]).toMatchObject({ mode: 'docked', pose, buttons: 0 });
    expect(inputs[0].time).toBeCloseTo(h.net.serverTime() - INPUT_INTERVAL_MS / 1000, 6);
  });

  it('pings every 2 s of real time', () => {
    const h = joined();
    h.advance(PING_INTERVAL_MS - 1);
    h.net.update();
    h.advance(1);
    h.net.update();
    expect(h.socket().types().filter((t) => t === 'ping')).toHaveLength(2);
  });

  it('sends nothing the schema refuses, and nothing at all until joined', () => {
    const h = harness();
    h.net.connect();
    h.socket().open();
    expect(h.net.send({ t: 'inventory', seq: 1, op: { op: 'compact', c: 'suit' } })).toBe(false);
    h.socket().push(welcome());
    h.net.input = () => ({ mode: 'ship', pose: { ...POSE, quat: [0, 0, 0, 0] }, buttons: 0 });
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(h.net.sendInput()).toBe(false);
    } finally {
      console.warn = warn;
    }
    expect(h.net.stats.unsendable).toBe(1);
    expect(h.socket().types()).not.toContain('input');
    expect(h.net.send({ t: 'inventory', seq: 1, op: { op: 'compact', c: 'suit' } })).toBe(true);
  });

  it('has no input to send when the game gives none (out of the zone, on the title)', () => {
    const h = joined();
    h.net.input = () => null;
    h.net.update();
    expect(h.socket().types()).not.toContain('input');
  });
});

describe('Net: snapshots', () => {
  it('applies a full snapshot and deltas on their baselines, acknowledging each tick it applies', () => {
    const h = joined();
    h.socket().pushBinary(encodeSnapshot({ tick: 5, time: 1000.25, ack: 0, full: true, entities: [entity(7, 30), entity(9, 0)], removed: [] }));
    h.socket().pushBinary(encodeSnapshot({ tick: 6, time: 1000.3, ack: 1, full: false, base: 5, entities: [{ id: 7, pos: [31, 0, 0] }], removed: [9] }));
    expect(h.socket().sent.filter((m) => m.t === 'ack')).toEqual([
      { t: 'ack', tick: 5 },
      { t: 'ack', tick: 6 },
    ]);
    expect(h.net.store.tick).toBe(6);
    expect(h.net.store.ack).toBe(1);
    expect([...h.net.store.entities.keys()]).toEqual([7]);
    expect(h.net.store.entities.get(7).pos).toEqual([31, 0, 0]);
    expect(h.net.store.entities.get(7).mode).toBe('docked');
    expect(h.events.filter((e) => e[0] === 'snapshot')).toHaveLength(2);
  });

  it('neither stores nor acknowledges a delta whose baseline it does not hold, nor a tick with an entity it refused', () => {
    const h = joined();
    h.socket().pushBinary(encodeSnapshot({ tick: 5, time: 1, ack: 0, full: true, entities: [entity(7, 30)], removed: [] }));
    h.socket().pushBinary(encodeSnapshot({ tick: 7, time: 1, ack: 0, full: false, base: 6, entities: [{ id: 7, pos: [32, 0, 0] }], removed: [] }));
    // an entity that fails the schema (a quaternion far from unit length), sent unsanitised: the encoder would drop the field
    const bad = { tick: 8, time: 1, ack: 0, full: false, base: 5, entities: [{ id: 7, pos: [33, 0, 0] }, { id: 11, quat: [0, 0, 0, 3] }], removed: [] };
    h.socket().pushBinary(encodeSnapshot(bad, [], { sanitized: true }));
    expect(h.socket().sent.filter((m) => m.t === 'ack').map((m) => m.tick)).toEqual([5]);
    expect(h.net.store.tick).toBe(5);
    expect(h.net.stats).toMatchObject({ unappliedTicks: 1, rejectedTicks: 1 });
    // the next delta on the acknowledged tick goes through
    h.socket().pushBinary(encodeSnapshot({ tick: 9, time: 1, ack: 0, full: false, base: 5, entities: [{ id: 7, pos: [34, 0, 0] }], removed: [] }));
    expect(h.net.store.entities.get(7).pos).toEqual([34, 0, 0]);
  });
});

describe('Net: losing the connection', () => {
  it('reconnects with a doubling backoff after a drop, and rejoins as the same session would', () => {
    const h = joined();
    h.socket().drop();
    expect(h.net.state).toBe('reconnecting');
    expect(h.timers.map((t) => t.ms)).toEqual([RECONNECT.firstMs]);
    h.timers.shift().fn();
    expect(FakeSocket.all).toHaveLength(2);
    h.socket().drop();
    expect(h.timers.map((t) => t.ms)).toEqual([RECONNECT.firstMs * 2]);
    h.timers.shift().fn();
    h.socket().open();
    h.socket().push(welcome(1500));
    expect(h.net.state).toBe('joined');
    expect(h.events.filter((e) => e[0] === 'welcome').map((e) => e[2])).toEqual([true, false]);
    // numbering starts over, and the backoff with it
    h.net.input = () => ({ mode: 'docked', pose: POSE, buttons: 0 });
    h.net.update();
    expect(h.socket().sent.find((m) => m.t === 'input').seq).toBe(1);
    h.socket().drop();
    expect(h.timers.map((t) => t.ms)).toEqual([RECONNECT.firstMs]);
  });

  it('caps the backoff at 30 s', () => {
    const h = joined();
    for (let i = 0; i < 10; i++) {
      h.socket().drop();
      h.timers.shift().fn();
    }
    h.socket().drop();
    expect(h.timers[0].ms).toBe(RECONNECT.maxMs);
  });

  it('gives up on a refusal another try would repeat, and says why', () => {
    for (const code of FINAL_REFUSALS) {
      const h = joined();
      h.socket().push({ t: 'refused', code, reason: 'no' });
      h.socket().close(4000, code);
      expect(h.net.state).toBe('closed');
      expect(h.timers).toEqual([]);
      expect(h.events.find((e) => e[0] === 'closed')[1].refusal).toEqual({ t: 'refused', code, reason: 'no' });
    }
    // 'full' is worth another try
    const h = joined();
    h.socket().push({ t: 'refused', code: 'full', reason: 'busy' });
    h.socket().close(4000, 'full');
    expect(h.net.state).toBe('reconnecting');
  });

  it('does not retry a connection that never got in: the player is still at the door', () => {
    const h = harness();
    h.net.connect();
    h.socket().drop();
    expect(h.net.state).toBe('closed');
    expect(h.timers).toEqual([]);
  });

  it('closes for good on close(), even while waiting to reconnect', () => {
    const h = joined();
    h.net.close();
    expect(h.net.state).toBe('closed');
    const g = joined();
    g.socket().drop();
    g.net.close();
    expect(g.net.state).toBe('closed');
    expect(FakeSocket.all).toHaveLength(1);
  });
});

describe('ClockSync', () => {
  it('keeps the offset of the shortest of its recent round trips', () => {
    const c = new ClockSync(3);
    expect(c.now(5000)).toBeNull();
    c.sample(0, 100, 200); // rtt 200 ms: offset 100.1 − 0.2
    c.sample(1000, 101, 1020); // rtt 20 ms: offset 101.01 − 1.02
    c.sample(2000, 102, 2300);
    expect(c.rtt).toBe(20);
    expect(c.now(1020)).toBeCloseTo(101.01, 9);
    // the short sample ages out
    c.sample(3000, 103, 3100);
    c.sample(4000, 104, 4100);
    expect(c.rtt).toBe(100);
  });
});

describe('SnapshotStore', () => {
  it('drops ticks older than it keeps, and ignores a repeated or old tick', () => {
    const s = new SnapshotStore(4);
    expect(s.apply({ tick: 1, time: 0, ack: 0, full: true, entities: [entity(1, 0)], removed: [] })).toBe(true);
    for (let t = 2; t <= 6; t++) expect(s.apply({ tick: t, time: 0, ack: 0, full: false, base: t - 1, entities: [], removed: [] })).toBe(true);
    expect([...s.ticks.keys()]).toEqual([3, 4, 5, 6]);
    expect(s.apply({ tick: 6, time: 0, ack: 0, full: true, entities: [], removed: [] })).toBe(false);
    expect(s.apply({ tick: 7, time: 0, ack: 0, full: false, base: 2, entities: [], removed: [] })).toBe(false);
  });

  it('refuses a delta that names an entity it never sent whole, and strips clear from a new one', () => {
    const s = new SnapshotStore();
    s.apply({ tick: 1, time: 0, ack: 0, full: true, entities: [], removed: [] });
    expect(s.apply({ tick: 2, time: 0, ack: 0, full: false, base: 1, entities: [{ id: 4, pos: [1, 2, 3] }], removed: [] })).toBe(false);
    expect(s.apply({ tick: 2, time: 0, ack: 0, full: false, base: 1, entities: [{ ...entity(4, 1), clear: ['hp'] }], removed: [] })).toBe(true);
    expect(s.entities.get(4)).toEqual(entity(4, 1));
    // a later delta clears a field
    s.apply({ tick: 3, time: 0, ack: 0, full: false, base: 2, entities: [{ id: 4, clear: ['mode'] }], removed: [] });
    expect(s.entities.get(4).mode).toBeUndefined();
    // the stored tick it was applied onto is untouched
    expect(s.ticks.get(2).get(4).mode).toBe('docked');
  });
});
