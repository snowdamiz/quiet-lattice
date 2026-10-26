// Who is online, for chat and parties: the joined session holding each character, by character id and by name ignoring
// case (names are unique ignoring case: characters/names.ts). A character that enters again from a new connection
// replaces its old session here, so the old connection's close changes nothing.
import type { Session } from '../session/session.ts';

/** A character in play. */
export interface Online {
  readonly session: Session;
  readonly characterId: string;
  readonly accountId: string;
  /** its name as the server stores it */
  readonly name: string;
}

export class Roster {
  private readonly byCharacter = new Map<string, Online>();
  private readonly byName = new Map<string, Online>();

  get size(): number {
    return this.byCharacter.size;
  }

  /** Puts the session's character online under `name`, replacing whichever session held it before. */
  add(session: Session, name: string): Online {
    if (session.characterId === null || session.accountId === null) throw new Error(`session ${session.id} has no character in play`);
    const o: Online = { session, characterId: session.characterId, accountId: session.accountId, name };
    const before = this.byCharacter.get(o.characterId);
    if (before) this.byName.delete(key(before.name));
    this.byCharacter.set(o.characterId, o);
    this.byName.set(key(name), o);
    return o;
  }

  /** Takes the session's character offline, when this session is the one holding it; returns what it was. */
  remove(session: Session): Online | undefined {
    const o = this.of(session);
    if (!o) return undefined;
    this.byCharacter.delete(o.characterId);
    this.byName.delete(key(o.name));
    return o;
  }

  get(characterId: string): Online | undefined {
    return this.byCharacter.get(characterId);
  }

  /** The online character of that name, ignoring case. */
  named(name: string): Online | undefined {
    return this.byName.get(key(name));
  }

  /** The session's entry, when it is the session holding its character. */
  of(session: Session): Online | undefined {
    const o = session.characterId === null ? undefined : this.byCharacter.get(session.characterId);
    return o?.session === session ? o : undefined;
  }

  values(): IterableIterator<Online> {
    return this.byCharacter.values();
  }
}

/** A name as names compare: ignoring case. */
export function key(name: string): string {
  return name.toLowerCase();
}
