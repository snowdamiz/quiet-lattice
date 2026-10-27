// The client's connection to the game server (docs/ARCHITECTURE.md §5, §9): the WebSocket's lifecycle (hello and join,
// then reconnecting with backoff when the connection drops), routing the server's control messages to whoever listens,
// decoding zone snapshots onto their baselines into the entity store and acknowledging them, the server clock from
// ping/pong, and the player's input at 20 Hz. Gameplay reads remote state from `store`, never from the socket. Shots go
// to the server as `fire` intents (`fire`), and what they did comes back as events, kept by `combat` for the HUD.
//
// States: idle → connecting → joining (hello and join sent) → joined (welcome received) → closed; from joined a dropped
// connection goes to reconnecting and back to connecting after a backoff. A refusal another try would only repeat (and a
// second `invalid` within a minute), a failure before the first welcome, and close() end in closed, with 'closed' saying
// why.
import { PROTOCOL_VERSION, decodeServerMessage, decodeSnapshot, encodeClientMessage } from '@astra/shared/protocol';
import { Beacons } from './beacons.js';
import { ClockSync } from './clock.js';
import { CombatFeed } from './combat.js';
import { SnapshotStore } from './snapshots.js';

/** Input goes out at 20 Hz (the zone's tick) of real time, however fast frames run. */
export const INPUT_INTERVAL_MS = 50;
/** Acknowledgements go out at most once a tick, for the newest applied tick: a backlog of snapshots (after a stall of the
 * page) is acknowledged once, never snapshot by snapshot, which would spend the socket's message budget in one burst. */
export const ACK_INTERVAL_MS = 50;
/** A ping every 2 s keeps the clock estimate fresh (the server pushes no time of its own, ARCHITECTURE §3). */
export const PING_INTERVAL_MS = 2000;
/** Reconnect delays: 0.5 s doubling to 30 s, each scaled by a random 50–100% so a server restart is not hit by every client at once. */
export const RECONNECT = { firstMs: 500, maxMs: 30_000 };
/** Refusals another try would only repeat: the player has to act (reload, sign in again, pick a character). `full` (the
 * server could not take the character just now) is worth retrying. */
export const FINAL_REFUSALS = new Set(['version', 'auth', 'character', 'kicked']);
/** `invalid` is also how the gateway closes a socket that flooded it (a stalled page catching up), which an honest client
 * can do once: it is retried, unless the last `invalid` was less than this long ago (then the client is at fault). */
export const INVALID_RETRY_MS = 60_000;

const OPEN = 1;

export class Net {
  /**
   * `url` the game socket (gameSocketUrl), `token` the session token, `characterId` the character to join. The rest stand
   * in for the browser in tests: the WebSocket class, the clock (ms), timers and the random source of the backoff.
   */
  constructor({ url, token, characterId, WebSocket = globalThis.WebSocket, now = () => performance.now(), timers = globalThis, random = Math.random }) {
    this.url = url;
    this.token = token;
    this.characterId = characterId;
    this.WS = WebSocket;
    this.now = now;
    this.timers = timers;
    this.random = random;
    this.state = 'idle';
    this.ws = null;
    this.handlers = new Map();
    this.clock = new ClockSync();
    this.store = new SnapshotStore();
    /** The last `welcome`, `world` and the refusal the server closed with, as received. */
    this.welcome = null;
    this.world = null;
    this.refusal = null;
    /** The player's entity in its zone, and the zone. */
    this.entityId = null;
    this.zone = null;
    /** Set by the game: () => ({ mode, pose, buttons }) for the input to send, or null when there is none to send. */
    this.input = null;
    this.inputSeq = 0;
    this.lastInput = null;
    this.lastInputAt = -Infinity;
    /** the newest applied tick not yet acknowledged (null: none), when the last ack went, and the timer for a deferred one */
    this.ackDue = null;
    this.lastAckAt = -Infinity;
    this.ackTimer = null;
    this.pingId = 0;
    this.lastPingAt = -Infinity;
    this.attempt = 0;
    this.retryTimer = null;
    this.everJoined = false;
    this.closing = false;
    /** when the server last closed the socket as `invalid` (client time, ms) */
    this.lastInvalidAt = null;
    this.inventoryAfterWelcome = false;
    /** dropped: messages that did not decode; unsendable: messages that failed the schema here; rejected/unapplied:
     * snapshots neither stored nor acknowledged */
    this.stats = { dropped: 0, unsendable: 0, rejectedTicks: 0, unappliedTicks: 0 };
    /** shots sent this session (numbered from 1), and what the server says they and others' did (ARCHITECTURE §20) */
    this.fireSeq = 0;
    this.combat = new CombatFeed(this);
    /** The call-for-aid beacons (beacons.js): the shard's list while watching, the character's own, and the requests. */
    this.beacons = new Beacons(this);
  }

  get joined() {
    return this.state === 'joined';
  }

  /** Listens for a server message type ('welcome', 'world', 'inventory', 'pong', 'refused', 'correction', 'zone', 'event'),
   * a decoded 'snapshot', or the connection's 'state', 'lost' and 'closed'. Returns the unsubscribe. */
  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, (list = []));
    list.push(fn);
    return () => list.splice(list.indexOf(fn), 1);
  }

  emit(type, ...args) {
    for (const fn of [...(this.handlers.get(type) || [])]) fn(...args);
  }

  setState(state) {
    const prev = this.state;
    if (prev === state) return;
    this.state = state;
    this.emit('state', state, prev);
  }

  /** The server's world time now (s), or null before the first sample. */
  serverTime() {
    return this.clock.now(this.now());
  }

  // ---------- the connection ----------

  connect() {
    if (this.state !== 'idle' && this.state !== 'reconnecting') return;
    this.refusal = null;
    this.setState('connecting');
    let ws;
    try {
      ws = new this.WS(this.url);
    } catch {
      return this.lost(1006, 'the socket could not be opened');
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws === this.ws && this.opened();
    ws.onmessage = (e) => ws === this.ws && this.received(e.data);
    ws.onclose = (e) => ws === this.ws && this.lost(e.code, e.reason);
    // (a close always follows an error, and says why)
    ws.onerror = () => {};
    this.ws = ws;
  }

  /** Leaves for good: the server saves the character as its socket closes (ARCHITECTURE §8). */
  close() {
    this.closing = true;
    if (this.retryTimer !== null) {
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.cancelAck();
    const ws = this.ws;
    if (ws && ws.readyState <= OPEN) ws.close(1000, 'leaving');
    else if (this.state !== 'closed') this.lost(1000, 'leaving');
  }

  opened() {
    this.setState('joining');
    this.joinSentAt = this.now();
    // hello and join go together: the gateway handles a socket's messages in order, the join once the hello is through
    this.raw({ t: 'hello', version: PROTOCOL_VERSION, token: this.token });
    this.raw({ t: 'join', characterId: this.characterId });
  }

  lost(code, reason) {
    this.ws = null;
    this.cancelAck();
    const why = { code, reason, refusal: this.refusal };
    if (this.closing || !this.everJoined || this.refusedForGood()) {
      this.setState('closed');
      this.emit('closed', why);
      return;
    }
    const delay = Math.min(RECONNECT.maxMs, RECONNECT.firstMs * 2 ** this.attempt) * (0.5 + 0.5 * this.random());
    this.attempt++;
    this.setState('reconnecting');
    this.emit('lost', why);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** Whether the refusal the socket closed with ends the session: a final one, or an `invalid` soon after another. */
  refusedForGood() {
    const code = this.refusal?.code;
    if (!code) return false;
    if (FINAL_REFUSALS.has(code)) return true;
    if (code !== 'invalid') return false;
    const t = this.now();
    const again = this.lastInvalidAt !== null && t - this.lastInvalidAt < INVALID_RETRY_MS;
    this.lastInvalidAt = t;
    return again;
  }

  // ---------- receiving ----------

  received(data) {
    if (typeof data !== 'string') return this.snapshot(data);
    const m = decodeServerMessage(data);
    if (!m) {
      this.stats.dropped++;
      return;
    }
    switch (m.t) {
      case 'welcome':
        return this.welcomed(m);
      case 'inventory': {
        // the state sent right after welcome starts the session's requests over (Inventory.reset)
        const first = this.inventoryAfterWelcome;
        this.inventoryAfterWelcome = false;
        return this.emit('inventory', m, first);
      }
      case 'pong':
        this.clock.sample(m.clientTime, m.serverTime, this.now());
        break;
      case 'world':
        this.world = m;
        break;
      case 'refused':
        this.refusal = m;
        break;
    }
    this.emit(m.t, m);
  }

  welcomed(m) {
    const first = !this.everJoined;
    this.everJoined = true;
    this.attempt = 0;
    this.welcome = m;
    this.entityId = m.entityId;
    this.zone = m.zone;
    // a first, coarse sample (the join's round trip includes the database); the ping sent now refines it
    this.clock.sample(this.joinSentAt, m.serverTime, this.now());
    // a new session: its snapshots start over with a full one, and its inputs from 1
    this.store.reset();
    this.inputSeq = 0;
    this.fireSeq = 0;
    this.lastInput = null;
    this.lastInputAt = -Infinity;
    this.cancelAck();
    this.lastAckAt = -Infinity;
    this.inventoryAfterWelcome = true;
    this.setState('joined');
    this.ping();
    this.emit('welcome', m, first);
  }

  snapshot(data) {
    if (this.state !== 'joined') return;
    const rejected = [];
    const snap = decodeSnapshot(data instanceof Uint8Array ? data : new Uint8Array(data), rejected);
    if (!snap) {
      this.stats.dropped++;
      return;
    }
    // an entity the decoder refused leaves the tick incomplete: it is neither stored nor acknowledged
    if (rejected.length) {
      this.stats.rejectedTicks++;
      return;
    }
    if (!this.store.apply(snap)) {
      this.stats.unappliedTicks++;
      return;
    }
    this.ackDue = snap.tick;
    this.flushAck();
    this.emit('snapshot', snap);
  }

  /** Acknowledges the newest applied tick, at most once every ACK_INTERVAL_MS: one sooner waits for a timer, and ticks
   * applied meanwhile only move what it will acknowledge. */
  flushAck() {
    if (this.ackDue === null || this.state !== 'joined') return;
    const t = this.now();
    const wait = this.lastAckAt + ACK_INTERVAL_MS - t;
    if (wait > 0) {
      this.ackTimer ??= this.timers.setTimeout(() => {
        this.ackTimer = null;
        this.flushAck();
      }, wait);
      return;
    }
    if (this.raw({ t: 'ack', tick: this.ackDue })) this.lastAckAt = t;
    this.ackDue = null;
  }

  cancelAck() {
    if (this.ackTimer !== null) this.timers.clearTimeout(this.ackTimer);
    this.ackTimer = null;
    this.ackDue = null;
  }

  // ---------- sending ----------

  /** Sends a control message for the character in play (an inventory request …). False when it could not go: not joined,
   * or a message the schema refuses (which never leaves the client). */
  send(m) {
    return this.state === 'joined' && this.raw(m);
  }

  raw(m) {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return false;
    let text;
    try {
      text = encodeClientMessage(m);
    } catch (err) {
      if (this.stats.unsendable++ === 0) console.warn(`net: a message was not sent: ${err.message}`);
      return false;
    }
    ws.send(text);
    return true;
  }

  /** Called every frame: a ping every 2 s and the player's input at 20 Hz, both by real time, never faster however fast
   * frames are stepped (the gateway's message budget counts real seconds). */
  update() {
    if (this.state !== 'joined') return;
    const t = this.now();
    if (t - this.lastPingAt >= PING_INTERVAL_MS) this.ping(t);
    if (t - this.lastInputAt >= INPUT_INTERVAL_MS) this.sendInput(t);
  }

  ping(t = this.now()) {
    this.lastPingAt = t;
    this.raw({ t: 'ping', id: ++this.pingId, clientTime: t });
  }

  /** Asks the server to resolve a shot of the ship's guns (`fireIntent`: where they point, in which frame, when), numbered
   * from 1 on each connection. The tracers are the game's own; what the shot did comes back as events. False when it did
   * not go (no shot to send, not joined, or a shot the schema refuses). */
  fire(intent) {
    if (!intent || this.state !== 'joined') return false;
    const msg = { t: 'fire', seq: this.fireSeq + 1, ...intent };
    if (!this.raw(msg)) return false;
    this.fireSeq = msg.seq;
    return true;
  }

  /** Sends the player's input now: its predicted pose and mode, numbered from 1, and stamped with the time the game sampled
   * it at (its world clock, which follows the server's; the server clock's estimate when the sample has none), never
   * going back: movement authority judges the pose at that time, not at its arrival (ARCHITECTURE §7). */
  sendInput(t = this.now()) {
    if (this.state !== 'joined' || !this.input) return false;
    const sample = this.input();
    if (!sample) return false;
    const time = Math.max(this.lastInput?.time ?? 0, sample.time ?? this.clock.now(t) ?? 0);
    const msg = { t: 'input', seq: this.inputSeq + 1, ...sample, time };
    if (!this.raw(msg)) return false;
    this.inputSeq = msg.seq;
    this.lastInput = msg;
    this.lastInputAt = t;
    return true;
  }
}
