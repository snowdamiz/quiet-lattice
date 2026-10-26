// One Session per WebSocket (docs/ARCHITECTURE.md §2): the account it signed in as, the character in play and the zone
// it is in. Zones (P1.E03.T02) hold sessions to send snapshots and events through.
import { encodeServerMessage, type ServerMessage } from '@astra/shared/protocol';
import { WebSocket } from 'ws';

export type SessionState = 'hello' | 'authed' | 'joined' | 'closed';
type RefusedCode = Extract<ServerMessage, { t: 'refused' }>['code'];

/** WebSocket close codes the gateway uses. */
export const CloseCode = { refused: 4000, goingAway: 1001 } as const;

/** Outbound bytes a socket may have queued (the client is not reading) before the session is dropped. */
export const MAX_BUFFERED_BYTES = 1024 * 1024;
/** How long a refused client has to finish the close handshake before its socket is destroyed. */
export const REFUSE_GRACE_MS = 1000;

/** The parts of a `ws` socket a session uses (a narrow type, so tests can stand in for it). */
export type SessionSocket = Pick<WebSocket, 'readyState' | 'bufferedAmount' | 'send' | 'close' | 'terminate'>;

export class Session {
  state: SessionState = 'hello';
  accountId: string | null = null;
  characterId: string | null = null;
  entityId: number | null = null;
  zoneId: string | null = null;
  /** Messages that failed validation or arrived out of place, and were dropped. */
  invalidMessages = 0;
  /** Messages dropped because the client sent faster than its message budget. */
  rateLimited = 0;
  /** Answered the last heartbeat ping. */
  alive = true;
  /** Why the server ended the session, when it did. */
  endReason: string | null = null;

  constructor(
    readonly id: number,
    readonly socket: SessionSocket,
    /** The client's rate-limit key (IPv4 address or IPv6 /64). */
    readonly remote: string,
  ) {}

  /**
   * Sends a validated message (only the schema's fields). A client that has stopped reading is dropped once its
   * outbound queue passes MAX_BUFFERED_BYTES, so one socket cannot make the server hold unbounded memory.
   */
  send(m: ServerMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.drop('outbound buffer full');
      return;
    }
    this.socket.send(encodeServerMessage(m));
  }

  /**
   * Sends `refused` and closes the socket; the session takes no further messages. A client that does not complete the
   * close handshake within REFUSE_GRACE_MS (it may not be reading at all) is cut off.
   */
  refuse(code: RefusedCode, reason: string): void {
    if (this.state === 'closed') return;
    this.send({ t: 'refused', code, reason: reason.slice(0, 280) });
    if ((this.state as SessionState) === 'closed') return; // send() dropped a client that was not reading
    this.state = 'closed';
    this.endReason ??= `refused: ${code}`;
    this.socket.close(CloseCode.refused, code);
    setTimeout(() => this.socket.terminate(), REFUSE_GRACE_MS).unref();
  }

  /** Cuts the connection without a goodbye (nothing more can be queued for a client that is not reading). */
  drop(reason: string): void {
    this.state = 'closed';
    this.endReason ??= reason;
    this.socket.terminate();
  }
}

/** Every live session, by account and by the character each holds in play. */
export class SessionRegistry {
  readonly sessions = new Set<Session>();
  private readonly byAccount = new Map<string, Set<Session>>();
  private readonly byCharacter = new Map<string, Session>();
  private nextEntityId = 1;

  add(s: Session): void {
    this.sessions.add(s);
  }

  remove(s: Session): void {
    this.sessions.delete(s);
    if (s.accountId) {
      const set = this.byAccount.get(s.accountId);
      set?.delete(s);
      if (set?.size === 0) this.byAccount.delete(s.accountId);
    }
    if (s.characterId && this.byCharacter.get(s.characterId) === s) this.byCharacter.delete(s.characterId);
  }

  /** Open sessions signed in to the account. */
  countForAccount(accountId: string): number {
    return this.byAccount.get(accountId)?.size ?? 0;
  }

  bindAccount(s: Session, accountId: string): void {
    s.accountId = accountId;
    let set = this.byAccount.get(accountId);
    if (!set) this.byAccount.set(accountId, (set = new Set()));
    set.add(s);
  }

  /**
   * Puts the session's character in play and returns the session that held it before, if any. The caller kicks that
   * older session: a choice, so a reconnecting player never waits for a dead socket to time out (logged in DECISIONS).
   */
  bindCharacter(s: Session, characterId: string): Session | undefined {
    const previous = this.byCharacter.get(characterId);
    this.byCharacter.set(characterId, s);
    s.characterId = characterId;
    return previous && previous !== s ? previous : undefined;
  }

  /** Entity ids are per process until zones own them (P1.E03.T02). */
  allocateEntityId(): number {
    return this.nextEntityId++;
  }

  get size(): number {
    return this.sessions.size;
  }
}
