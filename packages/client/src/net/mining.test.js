// The client's mining (P1.E13.T06): the nodes the server says are gone, hurt hits it is asked for, and what it hides of its own
// flora. Nothing is hidden by the client's own say-so: not by a hit sent, not by a beam that ran long enough.
import { encodeServerMessage } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { FLORA_REMEMBERED, HIT_INTERVAL_S, Mining } from './mining.js';
import { Net } from './Net.js';

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
  pose: { frame: '1:1', pos: [30, 2.4, 22], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
  mode: 'foot',
};

const FRAME = '1:1';
const NODE = '2_10_11_copper_3';

function joined() {
  const net = new Net({
    url: 'ws://test/ws',
    token: 'tok',
    characterId: 'c1',
    WebSocket: FakeSocket,
    now: () => 10_000,
    random: () => 1,
    timers: { setTimeout: () => {}, clearTimeout: () => {} },
  });
  net.connect();
  FakeSocket.last.open();
  FakeSocket.last.push(WELCOME);
  const socket = FakeSocket.last;
  const hits = () => socket.sent.filter((m) => m.t === 'mine');
  return { net, mining: net.mining, socket, hits };
}

const cellOf = (cell, gone = [], hurt = []) => ({ cell, gone, hurt });
const nodes = (cells, extra = {}) => ({ t: 'nodes', frame: FRAME, cells, ...extra });

describe('the nodes the server says are gone', () => {
  it('holds a cell as the server sent it, replaces it whole, and forgets an empty one', () => {
    const { mining, socket } = joined();
    socket.push(nodes([cellOf('2_10_11', ['copper_3', 'sodium_0'], [['gold_1', 0.4]]), cellOf('2_10_12', ['copper_0'])], { reset: true }));
    expect(mining.gone(FRAME, '2_10_11', 'copper_3')).toBe(true);
    expect(mining.gone(FRAME, '2_10_11', 'copper_4')).toBe(false);
    expect(mining.left(FRAME, '2_10_11', 'gold_1')).toBe(0.4);
    expect(mining.left(FRAME, '2_10_11', 'gold_2')).toBe(1);
    socket.push(nodes([cellOf('2_10_11', ['copper_4']), cellOf('2_10_12')]));
    expect(mining.gone(FRAME, '2_10_11', 'copper_3')).toBe(false);
    expect(mining.gone(FRAME, '2_10_11', 'copper_4')).toBe(true);
    expect(mining.cell(FRAME, '2_10_12')).toBeUndefined();
  });

  it('starts a world over on `reset`, and keeps other worlds apart', () => {
    const { mining, socket } = joined();
    socket.push(nodes([cellOf('2_10_11', ['copper_3'])], { reset: true }));
    socket.push({ ...nodes([cellOf('0_0_0', ['sodium_1'])]), frame: '1:2' });
    socket.push(nodes([cellOf('0_1_1', ['oxygen_2'])], { reset: true }));
    expect(mining.cell(FRAME, '2_10_11')).toBeUndefined();
    expect(mining.gone(FRAME, '0_1_1', 'oxygen_2')).toBe(true);
    expect(mining.gone('1:2', '0_0_0', 'sodium_1')).toBe(true);
  });

  it('forgets everything on a new session', () => {
    const { net, mining, socket } = joined();
    socket.push(nodes([cellOf('2_10_11', ['copper_3'])]));
    socket.push({ t: 'mine', seq: 1, frame: FRAME, flora: 'f1', result: 'depleted', item: 'carbon', count: 5, added: 5 });
    net.emit('welcome', WELCOME, false);
    expect(mining.cell(FRAME, '2_10_11')).toBeUndefined();
    expect(mining.floraGone(FRAME)).toBeUndefined();
  });

  it('counts a change of what is drawn, so the flora redraws', () => {
    const { mining, socket } = joined();
    const rev = mining.rev;
    socket.push(nodes([cellOf('2_10_11', ['copper_3'])]));
    expect(mining.rev).toBeGreaterThan(rev);
  });
});

describe('asking the server to mine', () => {
  const beam = (mining, seconds, target = { node: NODE }, ctx = 'ctx', time = 5) => {
    let sent = 0;
    for (let t = 0; t < seconds - 1e-9; t += 1 / 8) if (mining.beam(1 / 8, FRAME, target, ctx, time)) sent++;
    return sent;
  };

  it('sends a hit every quarter second the beam stays on its target, numbered from 1', () => {
    const { mining, hits } = joined();
    expect(beam(mining, 1)).toBe(4);
    expect(hits().map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(hits()[0]).toEqual({ t: 'mine', seq: 1, frame: FRAME, node: NODE, tool: 'multitool', time: 5 });
    expect(HIT_INTERVAL_S).toBe(0.25);
  });

  it('waits a full interval again after the beam goes off its target', () => {
    const { mining, hits } = joined();
    beam(mining, 0.1);
    mining.idle();
    beam(mining, 0.1);
    expect(hits()).toEqual([]);
    beam(mining, 0.1);
    expect(hits().length).toBe(1);
  });

  it('names a plant of the flora by its kind, its key and where it stands', () => {
    const { mining, hits } = joined();
    const target = { flora: { kind: 'rock', ref: '2_10_11_f4_17', at: [1, 2, 3] } };
    expect(beam(mining, 0.3, target)).toBe(1);
    expect(hits()[0]).toMatchObject({ seq: 1, frame: FRAME, flora: target.flora });
  });

  it('sends nothing before it has joined, and nothing the schema refuses', () => {
    const { mining, hits } = joined();
    expect(mining.beam(1, 'not a frame', { node: NODE }, null, 5)).toBe(false);
    expect(mining.beam(1, FRAME, { node: 'nonsense' }, null, 5)).toBe(false);
    expect(hits()).toEqual([]);
    const net = new Net({ url: 'ws://test/ws', token: 't', characterId: 'c', WebSocket: FakeSocket, timers: { setTimeout: () => {}, clearTimeout: () => {} } });
    expect(net.mining.beam(1, FRAME, { node: NODE }, null, 5)).toBe(false);
  });

  it('never asks for a node the server says is gone', () => {
    const { mining, socket, hits } = joined();
    socket.push(nodes([cellOf('2_10_11', ['copper_3'])]));
    expect(beam(mining, 2)).toBe(0);
    expect(hits()).toEqual([]);
    socket.push(nodes([cellOf('2_10_11')]));
    expect(beam(mining, 1)).toBe(4);
  });

  it('does not hide a node because it asked for hits on it, however many', () => {
    const { mining, hits } = joined();
    beam(mining, 30);
    expect(hits().length).toBe(120);
    expect(mining.gone(FRAME, '2_10_11', 'copper_3')).toBe(false);
    expect(mining.cell(FRAME, '2_10_11')).toBeUndefined();
    expect(mining.floraGone(FRAME)).toBeUndefined();
  });

  it('does not hide a plant because it asked for hits on it either', () => {
    const { mining } = joined();
    beam(mining, 30, { flora: { kind: 'bush', ref: 'k1', at: [0, 0, 0] } });
    expect(mining.floraGone(FRAME)).toBeUndefined();
  });
});

describe("the server's answers", () => {
  const answers = (mining) => {
    const seen = [];
    mining.on((m) => seen.push(m));
    return seen;
  };

  it('shows a node as hurt as the server says, and gone once it says it broke', () => {
    const { mining, socket } = joined();
    mining.beam(1, FRAME, { node: NODE }, 'inst', 5);
    socket.push({ t: 'mine', seq: 1, frame: FRAME, node: NODE, result: 'hit', hp: 0.6 });
    expect(mining.left(FRAME, '2_10_11', 'copper_3')).toBe(0.6);
    expect(mining.gone(FRAME, '2_10_11', 'copper_3')).toBe(false);
    mining.beam(1, FRAME, { node: NODE }, 'inst', 5);
    socket.push({ t: 'mine', seq: 2, frame: FRAME, node: NODE, result: 'depleted', item: 'copper', count: 8, added: 8 });
    expect(mining.gone(FRAME, '2_10_11', 'copper_3')).toBe(true);
  });

  it('gives the answer back with what the hit was sent with, and tells of a share of a node another player broke', () => {
    const { mining, socket } = joined();
    const seen = answers(mining);
    mining.beam(1, FRAME, { node: NODE }, 'my instance', 5);
    socket.push({ t: 'mine', seq: 1, frame: FRAME, node: NODE, result: 'depleted', item: 'copper', count: 8, added: 8 });
    socket.push({ t: 'mine', seq: 0, frame: FRAME, node: '2_10_11_gold_0', result: 'depleted', item: 'gold', count: 1, added: 1 });
    expect(seen.map((m) => [m.seq, m.ctx])).toEqual([[1, 'my instance'], [0, undefined]]);
    expect(mining.gone(FRAME, '2_10_11', 'gold_0')).toBe(true);
  });

  it('takes a refusal of a node that is waiting to grow back as gone, and counts every refusal', () => {
    const { mining, socket } = joined();
    mining.beam(1, FRAME, { node: NODE }, null, 5);
    socket.push({ t: 'mine', seq: 1, frame: FRAME, node: NODE, result: 'refused', reason: 'harvested' });
    socket.push({ t: 'mine', seq: 2, frame: FRAME, node: '2_10_11_gold_0', result: 'refused', reason: 'range' });
    expect(mining.gone(FRAME, '2_10_11', 'copper_3')).toBe(true);
    expect(mining.gone(FRAME, '2_10_11', 'gold_0')).toBe(false);
    expect(mining.refused).toEqual({ harvested: 1, range: 1 });
  });

  it('hides a plant of the flora only once the answer says it broke, or was broken already', () => {
    const { mining, socket } = joined();
    mining.beam(1, FRAME, { flora: { kind: 'rock', ref: 'r1', at: [0, 0, 0] } }, null, 5);
    socket.push({ t: 'mine', seq: 1, frame: FRAME, flora: 'r1', result: 'hit', hp: 0.5 });
    expect(mining.floraGone(FRAME)).toBeUndefined();
    socket.push({ t: 'mine', seq: 1, frame: FRAME, flora: 'r1', result: 'depleted', item: 'ferrite', count: 7, added: 7 });
    socket.push({ t: 'mine', seq: 2, frame: FRAME, flora: 'r2', result: 'refused', reason: 'harvested' });
    socket.push({ t: 'mine', seq: 3, frame: FRAME, flora: 'r3', result: 'refused', reason: 'range' });
    expect([...mining.floraGone(FRAME)]).toEqual(['r1', 'r2']);
  });

  it('never asks for a plant it hid', () => {
    const { mining, socket, hits } = joined();
    socket.push({ t: 'mine', seq: 1, frame: FRAME, flora: 'r1', result: 'depleted', item: 'ferrite', count: 7, added: 7 });
    expect(mining.beam(1, FRAME, { flora: { kind: 'rock', ref: 'r1', at: [0, 0, 0] } }, null, 5)).toBe(false);
    expect(hits()).toEqual([]);
  });

  it('hides as many plants as the server remembers, the oldest let go first', () => {
    const { mining, socket } = joined();
    for (let i = 0; i < FLORA_REMEMBERED + 5; i++) {
      socket.push({ t: 'mine', seq: i + 1, frame: FRAME, flora: `p${i}`, result: 'depleted', item: 'carbon', count: 1, added: 1 });
    }
    const gone = mining.floraGone(FRAME);
    expect(gone.size).toBe(FLORA_REMEMBERED);
    expect(gone.has('p0')).toBe(false);
    expect(gone.has(`p${FLORA_REMEMBERED + 4}`)).toBe(true);
  });

  it('forgets a hit that was never answered', () => {
    const times = [10_000, 30_000];
    const net = new Net({ url: 'ws://test/ws', token: 't', characterId: 'c', WebSocket: FakeSocket, now: () => times[0], timers: { setTimeout: () => {}, clearTimeout: () => {} } });
    net.connect();
    FakeSocket.last.open();
    FakeSocket.last.push(WELCOME);
    const mining = net.mining;
    mining.beam(1, FRAME, { node: NODE }, 'old', 5);
    times[0] = times[1];
    mining.beam(1, FRAME, { node: NODE }, 'new', 5);
    expect([...mining.pending.keys()]).toEqual([2]);
  });
});

describe('Mining.split', () => {
  it('splits a node id into its cell and the node within it, types with underscores included', () => {
    expect(Mining.split('2_10_11_copper_3')).toEqual(['2_10_11', 'copper_3']);
    expect(Mining.split('0_100_5_gamma_crystal_12')).toEqual(['0_100_5', 'gamma_crystal_12']);
  });
});
