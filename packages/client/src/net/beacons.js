// The call-for-aid beacons as the client holds them (P1.E15.T02, docs/ARCHITECTURE.md §21): while it watches, the shard's
// beacons as the server lists them (the whole list as it starts watching, then each change); the character's own beacon,
// from the news the server sends it; the last refusal; and the requests (raise, lower, watch, unwatch, answer), which the
// server carries out or refuses. The server decides everything (who may raise, who may join, the slots): this keeps only
// what it was told. A new connection starts unwatched on the server, so a client that was watching asks again on every
// welcome, and a watch the server refused for its rate (an account is sent the whole list a few times at once, then once
// every ten seconds) is asked again once it may succeed.
//
// The chat and party UI (ui/social, P1.E15.T03) shows it as the chat panel's beacon tab; from the dev console it is
// `game.net.beacons`: `watch()`, `list()`, `answer(id)`, `raise()`, `lower()`, `own`, `refusal`.

/** Beacon requests the server refuses with `denied` (of one of these). */
const REQUESTS = new Set(['raise', 'lower', 'answer', 'watch']);

export class Beacons {
  /** `net`: the connection (Net), whose messages this listens to and sends its requests through. */
  constructor(net) {
    this.net = net;
    /** the shard's beacons by id, while watching */
    this.byId = new Map();
    /** whether this client watches the list */
    this.watching = false;
    /** the character's own beacon while it is up (as the server last sent it), else null */
    this.own = null;
    /** the phase the last answer put the player in: `{ id, phase }` (the beacon and the phase), else null */
    this.joined = null;
    /** the last beacon request the server refused: `{ of, code, retryS? }`, else null */
    this.refusal = null;
    /** the timer asking again for a watch refused for its rate */
    this.retry = null;
    this.listeners = new Set();
    net.on('welcome', () => this.welcomed());
    net.on('beacons', (m) => this.listed(m));
    net.on('beacon', (m) => this.news(m));
    net.on('denied', (m) => this.denied(m));
  }

  /** The shard's beacons this client holds, the newest first. */
  list() {
    return [...this.byId.values()].sort((a, b) => b.at - a.at || b.id - a.id);
  }

  /** Starts watching: the server sends the whole list, then its changes. False when it could not be sent. */
  watch() {
    this.watching = true;
    return this.net.send({ t: 'beacon', op: { op: 'watch' } });
  }

  /** Stops watching, and forgets the list. */
  unwatch() {
    this.watching = false;
    this.cancelRetry();
    this.byId.clear();
    this.changed();
    return this.net.send({ t: 'beacon', op: { op: 'unwatch' } });
  }

  /** Asks to raise a beacon for the instance the player is in. */
  raise() {
    return this.request({ op: 'raise' });
  }

  /** Asks to lower the player's beacon. */
  lower() {
    return this.request({ op: 'lower' });
  }

  /** Asks to join beacon `id`'s instance (the player must be at its place, in its system). */
  answer(id) {
    return this.request({ op: 'answer', id });
  }

  /** Calls `fn(this)` whenever what it holds changes; returns the unsubscribe. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- from the server ----------

  request(op) {
    this.refusal = null;
    return this.net.send({ t: 'beacon', op });
  }

  welcomed() {
    // a new connection: the server holds no watch for it and sends the character's own beacon again if it is still up
    this.byId.clear();
    this.own = null;
    this.joined = null;
    this.cancelRetry();
    if (this.watching) this.net.send({ t: 'beacon', op: { op: 'watch' } });
    this.changed();
  }

  listed(m) {
    if (m.reset) this.byId.clear();
    for (const id of m.gone) this.byId.delete(id);
    for (const b of m.beacons) this.byId.set(b.id, b);
    if (this.own && this.byId.has(this.own.id)) this.own = this.byId.get(this.own.id);
    this.changed();
  }

  news(m) {
    if (m.op === 'raised') this.own = m.beacon;
    else if (m.op === 'ended' && this.own?.id === m.id) this.own = null;
    else if (m.op === 'joined') this.joined = { id: m.id, phase: m.phase };
    this.changed();
  }

  denied(m) {
    if (!REQUESTS.has(m.of)) return;
    this.refusal = { of: m.of, code: m.code, ...(m.retryS === undefined ? {} : { retryS: m.retryS }) };
    if (m.of === 'watch' && this.watching) this.retryWatch(m.retryS ?? 10);
    this.changed();
  }

  /** Asks to watch again in `seconds`, unless the client stops watching (or reconnects) first. */
  retryWatch(seconds) {
    this.cancelRetry();
    this.retry = this.net.timers.setTimeout(() => {
      this.retry = null;
      if (this.watching) this.net.send({ t: 'beacon', op: { op: 'watch' } });
    }, seconds * 1000);
  }

  cancelRetry() {
    if (this.retry !== null) this.net.timers.clearTimeout(this.retry);
    this.retry = null;
  }

  changed() {
    for (const fn of [...this.listeners]) fn(this);
  }
}
