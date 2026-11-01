// Seasons in Postgres (ARCHITECTURE §27): each account active on each meter day (`daily_actives`), each finished season's
// chronicle (`season_chronicles`) and the titles and glyphs it awarded (`season_awards`). A season's end is written in the
// Count meter's save transaction (count/store.ts), after the votes and rolls of that save, so its winners are read from
// every vote it had and its chronicle lands with the shard row's move to the next season, or not at all.
import {
  BUCKET_PHILOSOPHY,
  CHRONICLE_FINDS_MAX,
  chronicleFindSchema,
  seasonAward,
  seasonAwardSchema,
  seasonChronicleSchema,
  seasonOpeningSchema,
  type ChronicleFind,
  type SeasonAward,
  type SeasonChronicle,
} from '@astra/shared/seasons';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { dayOf, type CountVote } from '../count/meter.ts';
import type { Db } from '../db/client.ts';
import { countDays, countVotes, dailyActives, seasonAwards, seasonChronicles } from '../db/schema.ts';
import { seasonWinners, type SeasonEnd } from './rules.ts';

/** A transaction, or the database itself. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

/** An account active on a meter day. */
export interface StoredActive {
  day: number;
  accountId: string;
}

/** What a season's end awarded: the award, and the accounts that earned it. */
export interface SeasonAwarded {
  season: number;
  award: SeasonAward;
  accounts: readonly string[];
}

/** Where a season's notable first finds come from: the discovery service's names (`seasonFinds`, discovery/chronicle.ts),
 * read in the transaction that writes its chronicle. Without one, a chronicle names none. */
export type FirstFinds = (tx: Tx, window: { shardId: string; season: number; start: number; end: number }) => Promise<ChronicleFind[]>;

/** Where a find the chronicle cannot hold is reported. */
export interface FindsLog {
  warn(obj: object, msg: string): void;
}

/** Rows per INSERT: at 6 parameters an award, far under Postgres's 65,535. */
const CHUNK = 1000;

/** Writes new daily actives (one already stored is ignored). */
export async function insertActives(tx: Tx, shardId: string, actives: readonly StoredActive[]): Promise<void> {
  for (let i = 0; i < actives.length; i += CHUNK) {
    const rows = actives.slice(i, i + CHUNK).map((a) => ({ shardId, day: a.day, accountId: a.accountId }));
    await tx.insert(dailyActives).values(rows).onConflictDoNothing();
  }
}

/** How many accounts were active on each day from `from` on, and which accounts on day `today`. */
export async function readActives(db: Db, shardId: string, from: number, today: number): Promise<{ counts: [number, number][]; today: string[] }> {
  const counts = await db
    .select({ day: dailyActives.day, n: sql<number>`count(*)::int` })
    .from(dailyActives)
    .where(and(eq(dailyActives.shardId, shardId), gte(dailyActives.day, from)))
    .groupBy(dailyActives.day);
  const accounts = await db
    .select({ accountId: dailyActives.accountId })
    .from(dailyActives)
    .where(and(eq(dailyActives.shardId, shardId), eq(dailyActives.day, today)));
  return { counts: counts.map((c) => [c.day, c.n]), today: accounts.map((a) => a.accountId) };
}

/**
 * Writes a season's end: picks its winners from every vote cast in it (seasonWinners), stores their awards and the
 * chronicle (a season stored already is left as it is) and returns what it awarded.
 */
export async function writeSeasonEnd(tx: Tx, shardId: string, e: SeasonEnd, firstFinds?: FirstFinds, log?: FindsLog): Promise<SeasonAwarded> {
  const rows = await tx
    .select({ accountId: countVotes.accountId, action: countVotes.action, tag: countVotes.tag, at: countVotes.at })
    .from(countVotes)
    .where(and(eq(countVotes.shardId, shardId), gte(countVotes.day, dayOf(e.start)), lte(countVotes.day, dayOf(e.end))));
  const votes = rows.filter((v) => v.at >= e.start && v.at < e.end) as (CountVote & { at: number })[];
  const award = seasonAward(e.season, e.bucket);
  const accounts = seasonWinners(votes, e.bucket);
  for (let i = 0; i < accounts.length; i += CHUNK) {
    const chunk = accounts
      .slice(i, i + CHUNK)
      .map((accountId) => ({ shardId, season: e.season, accountId, bucket: award.bucket, title: award.title, glyph: award.glyph }));
    await tx.insert(seasonAwards).values(chunk).onConflictDoNothing();
  }
  const named = firstFinds ? await firstFinds(tx, { shardId, season: e.season, start: e.start, end: e.end }) : [];
  // A find that does not fit is dropped, not thrown: this runs inside the meter's save, which a bad name must not fail.
  const finds: ChronicleFind[] = [];
  for (const f of named) {
    if (finds.length >= CHRONICLE_FINDS_MAX) break;
    const parsed = chronicleFindSchema.safeParse(f);
    if (parsed.success) finds.push(parsed.data);
    else
      log?.warn(
        { shard: shardId, season: e.season, find: f, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        'dropped a first find from the season chronicle',
      );
  }
  await tx
    .insert(seasonChronicles)
    .values({
      shardId,
      season: e.season,
      seasonStart: e.start,
      seasonEnd: e.end,
      seasonLength: e.length,
      actives: e.actives,
      opening: e.opening,
      count: e.count,
      bucket: e.bucket,
      philosophy: BUCKET_PHILOSOPHY[e.bucket],
      title: award.title,
      glyph: award.glyph,
      awarded: accounts.length,
      next: e.next.opening,
      finds,
    })
    .onConflictDoNothing();
  return { season: e.season, award, accounts };
}

/** The titles and glyphs account `accountId` earned on the shard, oldest season first. */
export async function readAwards(db: Db, shardId: string, accountId: string): Promise<SeasonAward[]> {
  const rows = await db
    .select({ season: seasonAwards.season, bucket: seasonAwards.bucket, title: seasonAwards.title, glyph: seasonAwards.glyph })
    .from(seasonAwards)
    .where(and(eq(seasonAwards.shardId, shardId), eq(seasonAwards.accountId, accountId)))
    .orderBy(asc(seasonAwards.season));
  return rows.map((r) => seasonAwardSchema.parse(r));
}

/** Season `season`'s chronicle with its meter path (the season's rolled days), or null before it has ended. */
export async function readChronicle(db: Db, shardId: string, season: number): Promise<SeasonChronicle | null> {
  const [row] = await db
    .select()
    .from(seasonChronicles)
    .where(and(eq(seasonChronicles.shardId, shardId), eq(seasonChronicles.season, season)));
  if (!row) return null;
  const days = await db
    .select({ day: countDays.day, count: countDays.count, drift: countDays.drift, lean: countDays.lean, votes: countDays.votes })
    .from(countDays)
    .where(
      and(eq(countDays.shardId, shardId), eq(countDays.season, season), gte(countDays.day, dayOf(row.seasonStart)), lte(countDays.day, dayOf(row.seasonEnd))),
    )
    .orderBy(asc(countDays.day));
  return seasonChronicleSchema.parse({
    season: row.season,
    start: row.seasonStart,
    end: row.seasonEnd,
    length: row.seasonLength,
    actives: row.actives,
    opening: seasonOpeningSchema.parse(row.opening),
    path: days,
    count: row.count,
    bucket: row.bucket,
    philosophy: row.philosophy,
    title: row.title,
    glyph: row.glyph,
    awarded: row.awarded,
    next: seasonOpeningSchema.parse(row.next),
    finds: row.finds,
  });
}
