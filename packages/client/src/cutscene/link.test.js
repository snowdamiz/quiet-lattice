// The client's side of "always phased": online, a cutscene asks the server through Net and plays only on `play`; a
// refusal, a silence past the timeout, a dropped connection or not being joined plays nothing. A play that arrives too
// late is given back with `done`; the server ending the one playing reaches the player. The offline link (the dev
// sandbox's) answers for itself and keeps what it would have sent, checked against the protocol.
import { describe, expect, it } from 'vitest';
import { ANSWER_TIMEOUT_MS, NetCutsceneLink, OfflineCutsceneLink } from './link.js';

/** A stand-in for packages/client/src/net/Net.js: `joined`, `send` (false when it cannot go), `on` → unsubscribe. */
class FakeNet {
  constructor() {
    this.joined = true;
    this.sent = [];
    this.handlers = new Map();
    this.canSend = true;
  }
  send(m) {
    if (!this.joined || !this.canSend) return false;
    this.sent.push(m);
    return true;
  }
  on(type, fn) {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
    return () => list.splice(list.indexOf(fn), 1);
  }
  emit(type, m) {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(m);
  }
}

/** Timers run by hand. */
function fakeTimers() {
  let now = 0;
  let id = 0;
  const due = new Map();
  return {
    setTimeout: (fn, ms) => (due.set(++id, { fn, at: now + ms }), id),
    clearTimeout: (i) => due.delete(i),
    advance(ms) {
      now += ms;
      for (const [i, t] of [...due]) if (t.at <= now) (due.delete(i), t.fn());
    },
    get pending() {
      return due.size;
    },
  };
}

const setup = () => {
  const net = new FakeNet();
  const timers = fakeTimers();
  return { net, timers, link: new NetCutsceneLink(net, { timers }) };
};

describe('NetCutsceneLink', () => {
  it('asks the server and plays on its answer, in the phase it names', async () => {
    const { net, link, timers } = setup();
    const p = link.request('test');
    expect(net.sent).toEqual([{ t: 'cutscene', op: 'request', id: 'test' }]);
    net.emit('cutscene', { t: 'cutscene', op: 'play', id: 'test', phase: 7 });
    expect(await p).toEqual({ phase: 7 });
    expect(timers.pending).toBe(0);
    link.done('test', true);
    expect(net.sent.at(-1)).toEqual({ t: 'cutscene', op: 'done', id: 'test', skipped: true });
  });

  it('plays nothing on a refusal, a silence, a dropped connection, or when not joined', async () => {
    let { net, link, timers } = setup();
    let p = link.request('test');
    net.emit('cutscene', { t: 'cutscene', op: 'refused', id: 'test', phase: null, reason: 'denied' });
    expect(await p).toEqual({ refused: 'denied' });

    p = link.request('test');
    timers.advance(ANSWER_TIMEOUT_MS - 1);
    timers.advance(1);
    expect(await p).toEqual({ refused: 'timeout' });

    p = link.request('test');
    net.emit('lost', { code: 1006 });
    expect(await p).toEqual({ refused: 'lost' });

    ({ net, link } = setup());
    net.joined = false;
    expect(await link.request('test')).toEqual({ refused: 'offline' });
    expect(net.sent).toEqual([]);
    net.joined = true;
    net.canSend = false;
    expect(await link.request('test')).toEqual({ refused: 'offline' });
  });

  it('ignores answers for other cutscenes, gives a late play back, and passes on the server ending the one playing', async () => {
    const { net, link, timers } = setup();
    const p = link.request('test');
    net.emit('cutscene', { t: 'cutscene', op: 'play', id: 'other', phase: 2 });
    expect(net.sent.at(-1)).toEqual({ t: 'cutscene', op: 'done', id: 'other', skipped: true });
    timers.advance(ANSWER_TIMEOUT_MS);
    expect(await p).toEqual({ refused: 'timeout' });
    // the answer comes after the client gave up: nothing plays, and the server's placing is given back
    net.emit('cutscene', { t: 'cutscene', op: 'play', id: 'test', phase: 3 });
    expect(net.sent.at(-1)).toEqual({ t: 'cutscene', op: 'done', id: 'test', skipped: true });

    const ended = [];
    link.onEnded = (id) => ended.push(id);
    const q = link.request('test');
    net.emit('cutscene', { t: 'cutscene', op: 'play', id: 'test', phase: 4 });
    await q;
    net.emit('cutscene', { t: 'cutscene', op: 'ended', id: 'other', phase: null });
    net.emit('cutscene', { t: 'cutscene', op: 'ended', id: 'test', phase: 4 });
    expect(ended).toEqual(['test']);
    // (after its own done, an ended is only the answer to it)
    link.done('test', false);
    net.emit('cutscene', { t: 'cutscene', op: 'ended', id: 'test', phase: 4 });
    expect(ended).toEqual(['test']);
    link.dispose();
    expect(net.handlers.get('cutscene')).toEqual([]);
  });
});

describe('OfflineCutsceneLink', () => {
  it('answers for itself with no phase, and keeps the encoded messages it would have sent', async () => {
    const link = new OfflineCutsceneLink();
    expect(await link.request('test')).toEqual({ phase: null, offline: true });
    link.done('test', false);
    expect(link.sent.map((m) => JSON.parse(m))).toEqual([
      { t: 'cutscene', op: 'request', id: 'test' },
      { t: 'cutscene', op: 'done', id: 'test', skipped: false },
    ]);
    expect(() => link.send({ t: 'cutscene', op: 'request', id: 'Bad Id' })).toThrow();
  });
});
