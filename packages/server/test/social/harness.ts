// A social service over real zones and sessions on fake sockets, with a hand-driven monotonic clock, for the unit tests.
import { decodeServerMessage, encodeServerMessage, type BeaconOp, type PartyOp, type ServerMessage } from '@astra/shared/protocol';
import { WebSocket } from 'ws';
import { Session, type SessionSocket } from '../../src/session/session.ts';
import { ZoneManager } from '../../src/zones/manager.ts';
import type { Zone } from '../../src/zones/zone.ts';
import type { SocialLimits } from '../../src/social/limits.ts';
import { SocialService } from '../../src/social/service.ts';

class FakeSocket implements SessionSocket {
  readyState: SessionSocket['readyState'] = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: string[] = [];
  /** binary frames (zone snapshots, once a test ticks the zones), counted and otherwise ignored */
  snapshots = 0;
  send(data: unknown, opts?: unknown) {
    if (typeof opts === 'object' && opts !== null && (opts as { binary?: boolean }).binary) this.snapshots++;
    else this.sent.push(String(data));
  }
  pong() {}
  close() {
    this.readyState = WebSocket.CLOSING;
  }
  terminate() {
    this.readyState = WebSocket.CLOSED;
  }
}

export interface LogLine {
  level: string;
  obj: Record<string, unknown>;
  msg: string;
}

export interface Player {
  readonly name: string;
  readonly characterId: string;
  readonly accountId: string;
  session: Session;
  sock: FakeSocket;
  zone: Zone;
  entityId: number;
  /** every message sent to it since the last take(), decoded, and forgets them */
  take(): ServerMessage[];
  /** the party news it got since the last take() (`what:name`), and forgets every message */
  news(): string[];
  chat(channel: 'shard' | 'system' | 'party', text: string): void;
  party(op: PartyOp): void;
  beacon(op: BeaconOp): void;
}

/** `encode` wraps the service's encoder (which counts its calls), so a test can make it fail. */
export function harness(limits: Partial<SocialLimits> = {}, opts: { encode?: (m: ServerMessage, encode: (m: ServerMessage) => string) => string } = {}) {
  let mono = 1000;
  const lines: LogLine[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log = { info: at('info'), warn: at('warn'), debug: at('debug'), error: at('error') };
  const clock = { now: () => 5e6 + mono / 1000 };
  const zones = new ZoneManager({ clock, mono: () => mono, log });
  const encodes = { n: 0 };
  const social = new SocialService({
    zones,
    clock,
    mono: () => mono,
    log,
    limits,
    encode: (m) => {
      encodes.n++;
      return opts.encode ? opts.encode(m, encodeServerMessage) : encodeServerMessage(m);
    },
  });
  let nextSession = 1;

  /** A new connection for the character: its session joins its home zone and the social service. */
  function connect(
    p: { name: string; characterId: string; accountId: string },
    homeSystem: number,
  ): Omit<Player, 'take' | 'news' | 'chat' | 'party' | 'beacon'> {
    const sock = new FakeSocket();
    const session = new Session(nextSession++, sock, '127.0.0.1');
    session.accountId = p.accountId;
    session.characterId = p.characterId;
    session.state = 'joined';
    const joined = zones.join(session, { id: p.characterId, name: p.name, people: 'thalune', level: 1, homeSystem });
    session.entityId = joined.entityId;
    session.zoneId = joined.zone.id;
    social.joined(session, p.name);
    return { ...p, session, sock, zone: joined.zone, entityId: joined.entityId };
  }

  function player(name: string, opts: { system?: number; account?: string } = {}): Player {
    const c = connect({ name, characterId: `char-${name}`, accountId: opts.account ?? `acct-${name}` }, opts.system ?? 0);
    const p: Player = {
      ...c,
      take() {
        const out = p.sock.sent.map((t) => decodeServerMessage(t)!);
        p.sock.sent.length = 0;
        return out;
      },
      news() {
        return p
          .take()
          .flatMap((m) => (m.t === 'event' && m.event.kind === 'party' ? [m.event.name === undefined ? m.event.what : `${m.event.what}:${m.event.name}`] : []));
      },
      chat(channel, text) {
        social.chat(p.session, { t: 'chat', channel, text });
      },
      party(op) {
        social.party(p.session, op);
      },
      beacon(op) {
        social.beacon(p.session, op);
      },
    };
    p.take(); // its `party` state on joining
    return p;
  }

  /** The player's connection drops: out of its zone (keeping its phase place) and offline. */
  function drop(p: Player): void {
    zones.leave(p.session, 'disconnected');
    p.sock.readyState = WebSocket.CLOSED;
    p.session.state = 'closed';
    social.left(p.session);
  }

  /** The player's character enters again from a new connection, in `system` (its home by default). */
  function reconnect(p: Player, system = 0): void {
    const c = connect(p, system);
    p.session = c.session;
    p.sock = c.sock;
    p.zone = c.zone;
    p.entityId = c.entityId;
  }

  return {
    zones,
    social,
    lines,
    encodes,
    player,
    drop,
    reconnect,
    /** moves the monotonic clock on by `ms`, running the social tick every `tickMs` on the way, as its timer does */
    advance(ms: number) {
      for (let left = ms; left > 0; left -= social.limits.tickMs) {
        mono += Math.min(left, social.limits.tickMs);
        social.tick(mono);
      }
    },
    now: () => mono,
    clock,
    /** one zone tick at the clock's time: entities' world positions and phase volumes brought up to date */
    tick() {
      zones.runTick(clock.now(), mono);
    },
  };
}

/** The `party` states among the messages. */
export function partyStates(ms: ServerMessage[]) {
  return ms.flatMap((m) => (m.t === 'party' ? [m.party] : []));
}

/** The `denied` replies among the messages, as `of:code[:name]`. */
export function denials(ms: ServerMessage[]): string[] {
  return ms.flatMap((m) => (m.t === 'denied' ? [[m.of, m.code, ...(m.name ? [m.name] : [])].join(':')] : []));
}

/** The chat lines among the messages, as `channel:from:text`. */
export function chatLines(ms: ServerMessage[]): string[] {
  return ms.flatMap((m) => (m.t === 'event' && m.event.kind === 'chat' ? [`${m.event.channel}:${m.event.from}:${m.event.text}`] : []));
}
