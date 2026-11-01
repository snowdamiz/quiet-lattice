// The finds a season's chronicle names (ARCHITECTURE §25, §27): the names finders gave during it.
import { CHRONICLE_FINDS_MAX } from '@astra/shared/seasons';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { discoveries } from '../db/schema.ts';
import type { FirstFinds } from '../seasons/store.ts';

/**
 * Season `[start, end)`'s named finds, earliest first, read in the transaction that writes its chronicle. Windowed by the
 * world time a name was given, not the find's: a find made in a season's last minutes and named in the next belongs to the
 * next, so a chronicle never misses a name its season's end could not yet have seen. Only a finder's own name counts
 * (`named`): a moderator's rename or clear takes the find out, since the chronicle says who named what.
 */
export const seasonFinds: FirstFinds = async (tx, { shardId, start, end }) => {
  const rows = await tx
    .select({ kind: discoveries.kind, name: discoveries.name, by: discoveries.finderName, at: discoveries.namedAt })
    .from(discoveries)
    .where(and(eq(discoveries.shardId, shardId), eq(discoveries.nameState, 'named'), gte(discoveries.namedAt, start), lt(discoveries.namedAt, end)))
    .orderBy(asc(discoveries.namedAt), asc(discoveries.kind), asc(discoveries.key))
    // a few spare, so one a chronicle cannot hold does not take the place of one it can
    .limit(CHRONICLE_FINDS_MAX * 2);
  return rows.map((r) => ({ kind: r.kind, name: r.name ?? '', by: r.by, at: r.at ?? start }));
};
