// What chat and parties share: who is online, where each session's entity is, the limits, the clocks, the log, and the
// one way they write to sessions. A message for many sessions (a shard-wide chat line, a party's state) is validated
// and serialised once, then the same text is written to each (sendEncoded), never encoded per recipient.
import type { DeniedCode, ServerMessage } from '@astra/shared/protocol';
import { WebSocket } from 'ws';
import { MAX_BUFFERED_BYTES, type Session } from '../session/session.ts';
import type { ServerClock } from '../world/clock.ts';
import type { ZoneManager } from '../zones/manager.ts';
import type { SocialLimits } from './limits.ts';
import type { Online, Roster } from './roster.ts';

/** What social needs of the zones: which zone a session's entity is in. */
export type SocialZones = Pick<ZoneManager, 'zoneOf'>;

/** A pino-shaped logger (Fastify's). */
export interface SocialLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export type DeniedOf = Extract<ServerMessage, { t: 'denied' }>['of'];

export interface SocialContext {
  readonly roster: Roster;
  readonly zones: SocialZones;
  readonly limits: SocialLimits;
  /** world time, seconds (chat lines carry it) */
  readonly clock: ServerClock;
  /** monotonic milliseconds: rate limits, invite lifetimes and graces */
  readonly mono: () => number;
  readonly log?: SocialLog;
  /** validates and serialises a server message (encodeServerMessage) */
  readonly encode: (m: ServerMessage) => string;
}

/**
 * Writes an encoded control message to the session under the same outbound cap as Session.send (a client that has
 * stopped reading is dropped rather than buffered for), so a message fanned out to many sessions is encoded once.
 */
export function sendEncoded(s: Session, text: string): void {
  const sock = s.socket;
  if (sock.readyState !== WebSocket.OPEN) return;
  if (sock.bufferedAmount > MAX_BUFFERED_BYTES) {
    s.drop('outbound buffer full');
    return;
  }
  sock.send(text);
}

/** Encodes `m` once and writes it to every session in `to`; returns how many it went to. */
export function fanOut(ctx: SocialContext, to: Iterable<Online>, m: ServerMessage): number {
  const text = ctx.encode(m);
  let n = 0;
  for (const o of to) {
    sendEncoded(o.session, text);
    n++;
  }
  return n;
}

/** Tells the sender why its chat message or party request was not carried out (it alone hears of it). */
export function deny(o: Online, of: DeniedOf, code: DeniedCode, extra: { retryS?: number; name?: string } = {}): void {
  const retryS = extra.retryS === undefined ? undefined : Math.min(7 * 86400, Math.max(1, Math.ceil(extra.retryS)));
  o.session.send({ t: 'denied', of, code, ...(retryS === undefined ? {} : { retryS }), ...(extra.name === undefined ? {} : { name: extra.name }) });
}
