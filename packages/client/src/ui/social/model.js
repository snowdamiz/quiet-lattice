// What the chat and party UI holds (P1.E15.T03, docs/ARCHITECTURE.md §13, §21), kept apart from the page so it can be
// tested without one: the log (chat lines from the server, party and beacon news, refusals and local notes), the party
// as the server last sent it, the invites waiting for an answer, a mute the server imposed, and the requests the player
// makes (chat, party, beacons), sent through the connection (Net). The server decides everything: this keeps what it was
// told and what it refused. Chat is paced here as the server paces it (5 at once, then 1 a second) so a player typing
// fast is told to slow down before the server would count it towards a mute.
import { parseLine } from './commands.js';
import { HELP, beaconCallText, beaconNewsText, deniedText, partyNewsText } from './words.js';

/** The server's chat allowance per account (ARCHITECTURE §13): this many at once, then this many a second. */
export const CHAT_PACE = { burst: 5, perSecond: 1 };
/** Lines the log keeps. */
export const LOG_MAX = 200;
/** An invite lapses this long after it was sent (ARCHITECTURE §13). */
export const INVITE_MS = 60_000;
/** Party requests the server refuses with `denied {of}`. */
const PARTY_OPS = new Set(['invite', 'accept', 'decline', 'leave', 'kick', 'promote']);
/** Beacon requests whose refusals the beacon list shows where they were asked. */
const BEACON_OPS = new Set(['raise', 'lower', 'answer']);

/** A token bucket: `burst` at once, refilled at `perSecond`. */
class Pace {
  constructor({ burst, perSecond }, now) {
    this.burst = burst;
    this.perSecond = perSecond;
    this.level = burst;
    this.at = now;
  }

  fill(now) {
    this.level = Math.min(this.burst, this.level + ((now - this.at) / 1000) * this.perSecond);
    this.at = now;
  }

  take(now) {
    this.fill(now);
    if (this.level < 1) return false;
    this.level -= 1;
    return true;
  }

  /** Seconds until one may be taken. */
  wait(now) {
    this.fill(now);
    return this.level >= 1 ? 0 : (1 - this.level) / this.perSecond;
  }
}

export class SocialModel {
  /**
   * `now` the clock (ms) lines and invites are stamped with (the HUD's, which a capture runs on its own); `system()` the
   * galaxy index of the star system the player is in, for the beacons called there.
   */
  constructor({ now = () => performance.now(), system = () => null } = {}) {
    this.now = now;
    this.system = system;
    this.net = null;
    this.offs = [];
    /** the log, oldest first: `{id, kind: 'chat'|'note'|'refusal', channel, from?, text, at, mine?, tone?}`; `channel`
     * null for notes and refusals, which every tab shows; `tone` what a note is about ('party', 'beacon') */
    this.lines = [];
    this.lineId = 0;
    /** the channel a plain line goes to */
    this.channel = 'shard';
    /** the party as the server last sent it (PartyView), or null */
    this.party = null;
    /** invites waiting for an answer, newest last: `{from, at, until}` */
    this.invites = [];
    /** the clock time a server mute ends (0: not muted) */
    this.mutedUntil = 0;
    this.pace = new Pace(CHAT_PACE, now());
    /** the beacon last answered and, if the server refused it, why: `{id, text}` */
    this.answering = null;
    this.answerRefusal = null;
    /** the last raise or lower the server refused, and why */
    this.beaconRefusal = null;
    /** the beacons this client has heard of while watching (null before the first whole list) */
    this.seen = null;
    /** the id of the player's own beacon, once told it is up */
    this.ownId = null;
    this.listeners = new Set();
  }

  /** The player's character name, as the server welcomed it. */
  get me() {
    return this.net?.welcome?.character?.name ?? null;
  }

  /** Whether the player leads its party. */
  get leads() {
    return !!this.party && this.party.leader === this.me;
  }

  /** Listens to `net` (and stops listening to the one before); null for none. Watches the shard's beacons from its
   * first welcome on (beacons.js asks again after every reconnect). */
  attach(net) {
    for (const off of this.offs) off();
    this.offs = [];
    this.net = net;
    this.party = null;
    this.invites = [];
    this.seen = null;
    this.ownId = null;
    if (net) {
      this.offs.push(
        net.on('welcome', () => this.welcomed()),
        net.on('event', ({ event }) => this.event(event)),
        net.on('party', (m) => this.partyState(m.party)),
        net.on('denied', (m) => this.denied(m)),
        net.on('beacon', (m) => this.beaconNews(m)),
        net.on('beacons', (m) => this.beaconsListed(m)),
        net.beacons.subscribe(() => this.changed()),
      );
      net.beacons.watch();
    }
    this.changed();
  }

  /** Calls `fn()` whenever what it holds changes; returns the unsubscribe. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of [...this.listeners]) fn(this);
  }

  // ---------- the log ----------

  push(line) {
    this.lines.push({ id: ++this.lineId, at: this.now(), channel: null, ...line });
    if (this.lines.length > LOG_MAX) this.lines.splice(0, this.lines.length - LOG_MAX);
    this.changed();
  }

  /** A line of the UI's own (help, a hint) in every tab. */
  note(text) {
    this.push({ kind: 'note', text });
  }

  /** Something refused, here or by the server, in every tab. */
  refuse(text) {
    this.push({ kind: 'refusal', text });
  }

  // ---------- what the player asks ----------

  /**
   * A line the player typed: chat, a command, or a channel word. Returns `{ok, keep, stay, channel}`: whether it went (or
   * was done here), whether the input should keep the text to try again, whether the panel should stay open for more (a
   * channel word, /help), and the channel now in use when it changed.
   */
  submit(raw) {
    const cmd = parseLine(raw, this.channel);
    if (!cmd) return { ok: true, keep: false };
    switch (cmd.t) {
      case 'channel':
        this.channel = cmd.channel;
        this.changed();
        return { ok: true, keep: false, stay: true, channel: cmd.channel };
      case 'help':
        for (const line of HELP) this.note(line);
        return { ok: true, keep: false, stay: true };
      case 'error':
        this.refuse(cmd.text);
        return { ok: false, keep: true };
      case 'party':
        return { ok: this.partyOp(cmd.op), keep: false };
      case 'chat':
        if (cmd.switched) this.channel = cmd.channel;
        return { ...this.say(cmd.channel, cmd.text), ...(cmd.switched ? { channel: cmd.channel } : {}) };
    }
    return { ok: false, keep: true };
  }

  /** Sends a chat line, paced as the server paces it; a muted player is told for how long. */
  say(channel, text) {
    const now = this.now();
    if (this.mutedUntil > now) {
      this.refuse(deniedText({ of: 'chat', code: 'muted', retryS: (this.mutedUntil - now) / 1000 }));
      return { ok: false, keep: true };
    }
    if (!this.pace.take(now)) {
      this.refuse(deniedText({ of: 'chat', code: 'rate', retryS: this.pace.wait(now) }));
      return { ok: false, keep: true };
    }
    if (!this.net?.send({ t: 'chat', channel, text })) {
      this.refuse('Not connected');
      return { ok: false, keep: true };
    }
    return { ok: true, keep: false };
  }

  /** A party request (`{op, name?}`); `accept` and `decline` without a name answer the newest invite. False when it did
   * not go. */
  partyOp(op) {
    if ((op.op === 'accept' || op.op === 'decline') && !op.name) {
      const newest = this.invites.at(-1);
      if (!newest) {
        this.refuse('No invite is waiting');
        return false;
      }
      op = { op: op.op, name: newest.from };
    }
    if (op.op === 'accept' || op.op === 'decline') this.dropInvite(op.name);
    if (!this.net?.send({ t: 'party', op })) {
      this.refuse('Not connected');
      return false;
    }
    return true;
  }

  /** Asks to raise a beacon for the instance the player is in. */
  raise() {
    this.beaconRefusal = null;
    return this.net?.beacons.raise() ?? false;
  }

  /** Asks to lower the player's beacon. */
  lower() {
    this.beaconRefusal = null;
    return this.net?.beacons.lower() ?? false;
  }

  /** Asks to join beacon `id`'s instance; a refusal is kept against it. */
  answer(id) {
    this.answering = id;
    this.answerRefusal = null;
    this.changed();
    return this.net?.beacons.answer(id) ?? false;
  }

  // ---------- what the server says ----------

  welcomed() {
    // the invites a character held lapse when its connection drops; its party comes after the welcome
    this.invites = [];
    this.answering = null;
    this.answerRefusal = null;
    this.beaconRefusal = null;
    this.seen = null;
    this.changed();
  }

  event(e) {
    if (e.kind === 'chat') {
      this.push({ kind: 'chat', channel: e.channel, from: e.from, text: e.text, mine: e.from === this.me });
    } else if (e.kind === 'party') {
      const inviter = this.invites.some((i) => i.from === e.name);
      if (e.what === 'invite') {
        this.dropInvite(e.name);
        const at = this.now();
        this.invites.push({ from: e.name, at, until: at + INVITE_MS });
      } else if (e.what === 'expired') this.dropInvite(e.name);
      const text = partyNewsText(e, this.me, inviter);
      if (text) this.push({ kind: 'note', tone: 'party', text });
    }
  }

  partyState(party) {
    this.party = party;
    // joining a party spends the invites the player held
    if (party) this.invites = [];
    this.changed();
  }

  denied(m) {
    if (m.of === 'chat') {
      if (m.code === 'muted' && m.retryS) this.mutedUntil = this.now() + m.retryS * 1000;
      this.refuse(deniedText(m));
    } else if (PARTY_OPS.has(m.of)) {
      this.refuse(deniedText(m));
    } else if (m.of === 'answer') {
      this.answerRefusal = { id: this.answering, text: deniedText(m) };
      this.changed();
    } else if (BEACON_OPS.has(m.of)) {
      this.beaconRefusal = { of: m.of, text: deniedText(m) };
      this.changed();
    }
  }

  beaconNews(m) {
    if (m.op === 'raised' || m.op === 'ended') this.beaconRefusal = null;
    if (m.op === 'raised') {
      // (sent again on every welcome while it is up: news only the first time)
      if (m.id === this.ownId) return;
      this.ownId = m.id;
    }
    if (m.op === 'joined') {
      this.answering = null;
      this.answerRefusal = null;
    }
    const caller = m.op === 'joined' ? (this.net?.beacons.byId.get(m.id)?.from ?? null) : null;
    const text = beaconNewsText(m, caller);
    if (text) this.push({ kind: 'note', tone: 'beacon', text });
  }

  /** The shard's beacons as the server lists them: a beacon newly called in the player's own star system is news. */
  beaconsListed(m) {
    if (m.reset || this.seen === null) {
      this.seen = new Set(m.beacons.map((b) => b.id));
      return;
    }
    for (const id of m.gone) {
      this.seen.delete(id);
      if (this.answerRefusal?.id === id) this.answerRefusal = null;
    }
    const here = this.system();
    for (const b of m.beacons) {
      if (this.seen.has(b.id)) continue;
      this.seen.add(b.id);
      if (b.system === here && b.from !== this.me) this.push({ kind: 'note', tone: 'beacon', text: beaconCallText(b) });
    }
  }

  dropInvite(name) {
    const before = this.invites.length;
    this.invites = this.invites.filter((i) => i.from !== name);
    if (this.invites.length !== before) this.changed();
  }

  /** Invites past their minute (the server tells of each lapse; this covers a message lost with a connection). */
  expireInvites() {
    const now = this.now();
    const keep = this.invites.filter((i) => i.until > now);
    if (keep.length === this.invites.length) return;
    this.invites = keep;
    this.changed();
  }

  /**
   * The party's members for the frame, in join order: `{name, online, system, health, leader, me}`, `health` 0–1 (null
   * offline). Health is the entity's own `hp` while it is in this client's view (combat replicates it), else the party
   * state's tenths.
   */
  members() {
    if (!this.party) return [];
    const hp = new Map();
    const store = this.net?.store?.entities;
    if (store) {
      const names = new Set(this.party.members.map((m) => m.name));
      for (const e of store.values()) if (e.kind === 'player' && names.has(e.name) && typeof e.hp === 'number') hp.set(e.name, e.hp);
    }
    return this.party.members.map((m) => ({
      name: m.name,
      online: m.online,
      system: m.system,
      health: !m.online ? null : hp.has(m.name) ? hp.get(m.name) : m.health === null ? null : m.health / 10,
      leader: m.name === this.party.leader,
      me: m.name === this.me,
    }));
  }

  /** Seconds left of a server mute (0: none). */
  mutedFor() {
    return Math.max(0, (this.mutedUntil - this.now()) / 1000);
  }

  /** Seconds before the next chat line may go (0: now). */
  paceWait() {
    return this.pace.wait(this.now());
  }
}
