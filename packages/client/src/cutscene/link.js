// The seam between a cutscene and the server (docs/ARCHITECTURE.md §14). Cutscenes are always phased and the server
// decides when one opens: before one plays, the client asks (`cutscene {op: 'request'}`), and the server places the
// player in a story phase at the cutscene's place and answers `cutscene {op: 'play', phase}`, or refuses. The client
// plays only on `play`, and says `done` when it ends or is skipped.
//
// NetCutsceneLink speaks to the server through the client's Net (packages/client/src/net/Net.js: `joined`, `send(m)`,
// `on(type, fn)` → unsubscribe, the server's `cutscene` answers routed by their type). OfflineCutsceneLink is the dev
// sandbox's (no server: a local layer of its own, the messages it would have sent checked against the protocol and
// kept); the player uses it only there.
import { encodeClientMessage } from '@astra/shared/protocol';

/** How long the server has to answer a request before the client gives up and plays nothing. */
export const ANSWER_TIMEOUT_MS = 5000;

export class NetCutsceneLink {
  /** `net` the client's Net; `timers` setTimeout/clearTimeout (tests pass fakes). */
  constructor(net, { timeoutMs = ANSWER_TIMEOUT_MS, timers = globalThis } = {}) {
    this.net = net;
    this.timeoutMs = timeoutMs;
    this.timers = timers;
    /** called with `id` when the server ends a cutscene the client did not (it took the player out of the phase) */
    this.onEnded = null;
    this.pending = null;
    this.playing = null;
    this.off = net.on('cutscene', (m) => this.answered(m));
  }

  /**
   * Asks to play cutscene `id` where the player is. Resolves to {phase} when the server says play, or {refused} with
   * its reason: the server's, 'offline' (not joined, or the message could not go), 'timeout' or 'lost' (the connection
   * dropped before the answer). Never plays on its own.
   */
  request(id) {
    if (this.pending) this.settle({ refused: 'busy' });
    if (!this.net.joined || !this.net.send({ t: 'cutscene', op: 'request', id })) return Promise.resolve({ refused: 'offline' });
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(() => this.settle({ refused: 'timeout' }), this.timeoutMs);
      const offLost = this.net.on('lost', () => this.settle({ refused: 'lost' }));
      const offClosed = this.net.on('closed', () => this.settle({ refused: 'lost' }));
      this.pending = { id, resolve, timer, offLost, offClosed };
    });
  }

  /** The cutscene ended, or was skipped. */
  done(id, skipped) {
    if (this.playing === id) this.playing = null;
    this.net.send({ t: 'cutscene', op: 'done', id, skipped: !!skipped });
  }

  /** Stops listening. */
  dispose() {
    if (this.pending) this.settle({ refused: 'lost' });
    this.off();
  }

  answered(m) {
    const p = this.pending;
    if (p && m.id === p.id && (m.op === 'play' || m.op === 'refused')) {
      if (m.op === 'play') this.playing = m.id;
      this.settle(m.op === 'play' ? { phase: m.phase } : { refused: m.reason ?? 'refused' });
      return;
    }
    // a play that came too late (the client gave up and played nothing): the server's placing is given back
    if (m.op === 'play' && m.id !== this.playing) {
      this.net.send({ t: 'cutscene', op: 'done', id: m.id, skipped: true });
      return;
    }
    // the server ended the one playing (the player left its place, the phase closed)
    if (m.op === 'ended' && m.id === this.playing) {
      this.playing = null;
      this.onEnded?.(m.id);
    }
  }

  settle(result) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.timers.clearTimeout(p.timer);
    p.offLost();
    p.offClosed();
    p.resolve(result);
  }
}

export class OfflineCutsceneLink {
  constructor() {
    /** the control messages a networked client would have sent, encoded (newest last, at most 16) */
    this.sent = [];
    this.onEnded = null;
  }

  /** Asks to play cutscene `id` where the player is; resolves to the phase it plays in (null: the local layer). */
  async request(id) {
    this.send({ t: 'cutscene', op: 'request', id });
    return { phase: null, offline: true };
  }

  /** The cutscene ended, or was skipped. */
  done(id, skipped) {
    this.send({ t: 'cutscene', op: 'done', id, skipped: !!skipped });
  }

  send(msg) {
    this.sent.push(encodeClientMessage(msg));
    if (this.sent.length > 16) this.sent.shift();
  }
}
