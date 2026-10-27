// Where characters are stored (docs/ARCHITECTURE.md §8): their rows in Postgres. A write is a batch of saves, one statement
// for the whole batch. Each save merges its changed `state` entries into the row's (entries it does not carry, including
// keys this server does not know, stay as they are), sets the columns it carries and raises the row's revision, but only
// when its revision is above the row's: a save older than what the row already holds (a capture taken before a newer one
// was written) never overwrites it. A read loads one row, for an edit of a character out of play (service.ts `edit`),
// whose save at the row's revision + 1 is the same guard working as a compare-and-set.
//
// Revisions are counted by the process holding the character, starting from its row's revision on join, so the guard
// orders that process's saves; it does not fence two processes holding one character (each would count from the same
// row and could overwrite the other). The rule is that one process holds a character at a time; a real fence (a per-join
// epoch or a presence lock) arrives with P3.E37's split into several processes.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { characters } from '../db/schema.ts';
import type { CharacterColumns, StoredState } from './registry.ts';
import type { StoredCharacterRow } from './service.ts';

/** One character's save: the state entries and columns that changed since its last one, at a new revision. */
export interface SaveRow {
  id: string;
  revision: number;
  state: StoredState;
  columns: Partial<CharacterColumns>;
}

export interface CharacterStore {
  /**
   * Writes a batch in one statement; resolves with the ids written, the rest being stale or gone (an empty set when none
   * was). Rejects only on a database error, and then none of the batch was written.
   */
  write(rows: readonly SaveRow[]): Promise<Set<string>>;
  /** Reads one character's row by its canonical (lower-case) id, or null when there is none: an edit of a character out
   * of play loads from it (CharacterPersistence.edit). A store without it cannot edit characters out of play. */
  read?(id: string): Promise<StoredCharacterRow | null>;
}

export function pgCharacterStore(db: Db): CharacterStore {
  return {
    async read(id) {
      const [row] = await db
        .select({
          id: characters.id,
          name: characters.name,
          people: characters.people,
          homeSystem: characters.homeSystem,
          level: characters.level,
          xp: characters.xp,
          state: characters.state,
          revision: characters.revision,
        })
        .from(characters)
        .where(eq(characters.id, id))
        .limit(1);
      return row ?? null;
    },

    async write(rows) {
      if (rows.length === 0) return new Set();
      const values = sql.join(
        rows.map(
          (r) =>
            sql`(${r.id}::uuid, ${r.revision}::bigint, ${JSON.stringify(r.state)}::jsonb, ${r.columns.level ?? null}::integer, ${r.columns.xp ?? null}::bigint, ${r.columns.homeSystem ?? null}::integer)`,
        ),
        sql`, `,
      );
      const written = await db.execute<{ id: string }>(sql`
        update characters as c set
          state = c.state || v.state,
          level = coalesce(v.level, c.level),
          xp = coalesce(v.xp, c.xp),
          home_system = coalesce(v.home_system, c.home_system),
          revision = v.revision,
          saved_at = now()
        from (values ${values}) as v (id, revision, state, level, xp, home_system)
        where c.id = v.id and c.revision < v.revision
        returning c.id`);
      return new Set([...written].map((r) => r.id));
    },
  };
}
