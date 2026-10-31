// Every character in play's season awards (DESIGN 16.4; ARCHITECTURE §26): the titles and glyphs seasons gave its
// account's winning philosophy. Persistence opens a character's on join (the `seasonAwards` component), saves and closes
// them; the gateway merges in what the account earned (`season_awards`) as the character enters the world, and what a
// season gives while it is in play. Nothing a client sends reaches it.
//
// Subscribers hear each award a character in play is given: the gateway tells its client; the server takes each title
// into the character's reputation through its `earnTitle` (P2.E18.T01).
import { AWARDS_MAX, type SeasonAward, type StoredSeasonAwards } from '@astra/shared/seasons';

/** `added`: the awards just given to character `characterId`; `all`: everything it now holds, oldest season first. */
export type AwardListener = (characterId: string, added: readonly SeasonAward[], all: readonly SeasonAward[]) => void;

export class SeasonAwards {
  private readonly held = new Map<string, SeasonAward[]>();
  private readonly listeners = new Set<AwardListener>();

  constructor(private readonly onError: (err: unknown) => void = () => {}) {}

  /** Puts a character's awards in play (persistence, on join). */
  open(characterId: string, stored: StoredSeasonAwards = { awards: [] }): void {
    this.held.set(
      characterId,
      stored.awards.map((a) => ({ ...a })),
    );
  }

  /** Forgets a character (persistence, once its last save is captured); true when it was held. */
  close(characterId: string): boolean {
    return this.held.delete(characterId);
  }

  holds(characterId: string): boolean {
    return this.held.has(characterId);
  }

  /** The awards of a character in play, oldest season first, or undefined out of play. */
  get(characterId: string): readonly SeasonAward[] | undefined {
    return this.held.get(characterId);
  }

  /**
   * Gives a character in play the awards it does not hold yet (one a season: a season it holds one for already keeps
   * it), keeping them in season order, and tells the subscribers. Returns the ones added, or null when the character is
   * not in play (its account's awards reach it when it next enters the world).
   */
  grant(characterId: string, awards: readonly SeasonAward[]): SeasonAward[] | null {
    const mine = this.held.get(characterId);
    if (!mine) return null;
    const added: SeasonAward[] = [];
    for (const a of awards) {
      if (mine.some((m) => m.season === a.season) || added.some((m) => m.season === a.season)) continue;
      if (mine.length + added.length >= AWARDS_MAX) break;
      added.push({ ...a });
    }
    if (added.length === 0) return added;
    mine.push(...added);
    mine.sort((a, b) => a.season - b.season);
    for (const listener of [...this.listeners]) {
      try {
        listener(characterId, added, mine);
      } catch (err) {
        this.onError(err);
      }
    }
    return added;
  }

  /** Calls `listener` for each award given to a character in play until the returned function is called. */
  subscribe(listener: AwardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
