// One Session per WebSocket (docs/ARCHITECTURE.md §2): the account it signed in as, the character in play and the zone
// it is in. Zones (P1.E03.T02) hold sessions to send snapshots and events through.
import { encodeMessage, type ServerMessage } from '@astra/shared/protocol';
import { WebSocket } from 'ws';

export type SessionState = 'hello' | 'authed' | 'joined' | 'closed';
type RefusedCode = Extract<ServerMessage, { t: 'refused' }>['code'];

/** WebSocket close codes the gateway uses. */
export const CloseCode = { refused: 4000, goingAway: 1001 } as const;

export class Session {
  state: SessionState = 'hello';
  accountId: string | null = null;
  characterId: string | null = null;
  entityId: number | null = null;
  zoneId: string | null = null;
  /** Messages that failed validation or arrived out of place, and were dropped. */
  invalidMessages = 0;
  /** Answered the last heartbeat ping. */
  alive = true;

  constructor(
    readonly id: number,
    readonly socket: WebSocket,
    readonly remote: string,
  ) {}

  send(m: ServerMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(encodeMessage(m));
  }

  /** Sends `refused` and closes the socket; the session takes no further messages. */
  refuse(code: RefusedCode, reason: string): void {
    if (this.state === 'closed') return;
    this.send({ t: 'refused', code, reason });
    this.state = 'closed';
    this.socket.close(CloseCode.refused, code);
  }
}

/** Every live session, and which one holds each character in play. */
export class SessionRegistry {
  readonly sessions = new Set<Session>();
  private readonly byCharacter = new Map<string, Session>();
  private nextEntityId = 1;

  add(s: Session): void {
    this.sessions.add(s);
  }

  remove(s: Session): void {
    this.sessions.delete(s);
    if (s.characterId && this.byCharacter.get(s.characterId) === s) this.byCharacter.delete(s.characterId);
  }

  /** Puts the session's character in play and returns the session that held it before, if any. */
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
