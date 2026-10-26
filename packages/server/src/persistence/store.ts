// Where characters are stored (docs/ARCHITECTURE.md §8): their rows in Postgres. A write is a batch of saves, one statement
// for the whole batch. Each save merges its changed `state` entries into the row's (entries it does not carry, including
// keys this server does not know, stay as they are), sets the columns it carries and raises the row's revision, but only
// when its revision is above the row's: a stale save (an older capture arriving late, or a process that lost the
// character) never overwrites a newer one.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import type { CharacterColumns, StoredState } from './registry.ts';

/** One character's save: the state entries and columns that changed since its last one, at a new revision. */
export interface SaveRow {
  id: string;
  revision: number;
  state: StoredState;
  columns: Partial<CharacterColumns>;
}

export interface CharacterStore {
  /** Writes a batch; resolves with the ids written (the rest were stale or are gone). Rejects when nothing was written. */
  write(rows: readonly SaveRow[]): Promise<Set<string>>;
}

export function pgCharacterStore(db: Db): CharacterStore {
  return {
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
