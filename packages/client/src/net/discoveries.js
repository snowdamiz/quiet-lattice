// First finds as the client holds them (P2.E29.T01, docs/ARCHITECTURE.md §25): the finds of the star system the player is
// in, as the server sends them (the whole system's after every welcome and whenever the player's zone becomes another
// system's, then each new find and each name given), the answer to the player's last name request, and the request
// itself. The server decides everything (who found what first, whether a name is taken): this keeps what it was told.
// Anything that shows a body's, a species' or a site's name asks `displayName(kind, key, procedural)`, which is the name
// its finder gave it, or the procedural name the client made for it (DESIGN 14.5: the fallback).
//
// A finder is told by a notice when it makes a find; until the codex UI (P2.E29.T03) gives it a field, it names one from
// the dev console: `game.net.discoveries.name('body', '<seed>:<body>', 'Halcyon')`, `mine()` listing what it may name.
import { displayName } from '@astra/shared/discovery';

export class Discoveries {
  /** `net`: the connection (Net), whose messages this listens to and sends its requests through. */
  constructor(net) {
    this.net = net;
    /** the galaxy index of the system whose finds these are, or null before the first */
    this.system = null;
    /** finds by `<kind>|<key>` */
    this.byId = new Map();
    /** the server's answer to the last name request: `{ kind, key, result, name? | reason? }`, else null */
    this.answer = null;
    this.listeners = new Set();
    net.on('welcome', () => this.welcomed());
    net.on('discoveries', (m) => this.received(m));
    net.on('named', (m) => this.named(m));
  }

  /** A find of the current system, as the server sent it (`{ kind, key, finder, at, name?, until? }`), or undefined. */
  entry(kind, key) {
    return this.byId.get(`${kind}|${key}`);
  }

  /** The name a find's finder gave it, or null (it keeps its procedural name). */
  nameOf(kind, key) {
    return this.entry(kind, key)?.name ?? null;
  }

  /** What to call a find: its finder's name for it, or `procedural`. */
  displayName(kind, key, procedural) {
    return displayName(this.entry(kind, key), procedural);
  }

  /** The finds of the current system that `finder` (a character's name) may still name at world time `now`. */
  mine(finder = this.net.welcome?.character.name, now = this.net.serverTime() ?? 0) {
    return [...this.byId.values()].filter((e) => e.finder === finder && e.name === undefined && e.until !== undefined && e.until >= now);
  }

  /** Asks the server to name a find (its finder only, once, within the window): false when it could not be sent. */
  name(kind, key, name) {
    this.answer = null;
    return this.net.send({ t: 'name', kind, key, name });
  }

  /** Calls `fn(this)` whenever what it holds changes; returns the unsubscribe. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- from the server ----------

  welcomed() {
    // a new connection: the server sends the system's finds again
    this.byId.clear();
    this.system = null;
    this.answer = null;
    this.changed();
  }

  received(m) {
    if (m.reset) {
      this.byId.clear();
      this.system = m.system;
    } else if (m.system !== this.system) {
      // (news of another system's find: its finder hears of it wherever it is, and holds only its own system's)
      return;
    }
    for (const e of m.entries) this.byId.set(`${e.kind}|${e.key}`, e);
    this.changed();
  }

  named(m) {
    this.answer = m;
    this.changed();
  }

  changed() {
    for (const fn of [...this.listeners]) fn(this);
  }
}
