// Where the Count meter persists (docs/ARCHITECTURE.md §11): the Count and how far the meter has run (the last day rolled,
// the last burn tick) on the shard's row, each vote in `count_votes`, each day's roll in `count_days`. The world service
// gathers what changed and writes it in one transaction per save, so a burst of votes is one batch and a boot that catches
// up on missed days is one write. A restart reloads the votes of the days not yet rolled, so the open day's ledger and its
// one-vote rule carry on.
//
// The seasons the meter runs in persist with it (§25): the accounts active each day, each season that ended (its winners'
// awards and its chronicle, seasons/store.ts) and the season the shard moved on to, in the same transaction, after that
// save's votes and rolls, so a season's end reads every vote it had and lands with the Count's return to 500 or not at all.
import { seasonOpeningSchema } from '@astra/shared/seasons';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { countDays, countVotes, shards } from '../db/schema.ts';
import type { SeasonEnd, SeasonPosition } from '../seasons/rules.ts';
import { insertActives, readActives, writeSeasonEnd, type FirstFinds, type SeasonAwarded, type StoredActive } from '../seasons/store.ts';
import type { CountVote, MeterPosition, RolledDay } from './meter.ts';

/** A vote as stored: the meter day it counts for and the world time (s) it was cast. */
export interface StoredVote extends CountVote {
  day: number;
  at: number;
}

/** A day's roll as stored. */
export interface StoredRoll extends RolledDay {
  season: number;
}

/** One save: new votes, rolls and daily actives, the seasons that ended and, when they moved, where the meter stands and
 * the season the shard is in. */
export interface MeterWrite {
  votes: readonly StoredVote[];
  rolls: readonly StoredRoll[];
  /** Accounts newly active on a meter day. */
  actives?: readonly StoredActive[];
  /** Seasons that ended, oldest first. */
  seasons?: readonly SeasonEnd[];
  /** The shard's Count, its last burn tick, and its open day (every day before it has rolled). */
  position?: MeterPosition;
  /** The season the shard is in now. */
  season?: SeasonPosition;
}

/** What a save did beyond storing: what each season that ended awarded, oldest first. */
export interface MeterSaved {
  awarded: readonly SeasonAwarded[];
}

export interface CountStore {
  /** Every vote of the days after `day`, oldest first. */
  votesAfter(day: number): Promise<StoredVote[]>;
  /** How many accounts were active on each meter day from `from` on, and which accounts on day `today`. */
  actives(from: number, today: number): Promise<{ counts: [number, number][]; today: string[] }>;
  /**
   * Writes a save in one transaction: votes (one an account already cast on that action that day is ignored), rolls (a
   * day already stored is ignored), daily actives (likewise), each season that ended (its awards and chronicle: one
   * stored already is left), then the meter's position and the season on the shard's row.
   */
  save(write: MeterWrite): Promise<MeterSaved>;
}

/** Rows per INSERT: at 6 parameters a vote and 9 a roll, far under Postgres's 65,535. */
const VOTE_CHUNK = 1000;

/** Shard `shardId`'s meter in Postgres. `firstFinds` names a season's notable first finds in its chronicle (P2.E29.T01). */
export function pgCountStore(db: Db, shardId: string, opts: { firstFinds?: FirstFinds } = {}): CountStore {
  return {
    actives: (from, today) => readActives(db, shardId, from, today),
    async votesAfter(day) {
      const rows = await db
        .select()
        .from(countVotes)
        .where(and(eq(countVotes.shardId, shardId), gt(countVotes.day, day)))
        .orderBy(asc(countVotes.day), asc(countVotes.at));
      return rows.map((r) => ({ day: r.day, at: r.at, accountId: r.accountId, action: r.action as CountVote['action'], tag: r.tag }));
    },
    async save({ votes, rolls, actives = [], seasons = [], position, season }) {
      return db.transaction(async (tx) => {
        for (let i = 0; i < votes.length; i += VOTE_CHUNK) {
          const rows = votes.slice(i, i + VOTE_CHUNK).map((v) => ({ shardId, day: v.day, accountId: v.accountId, action: v.action, tag: v.tag, at: v.at }));
          await tx.insert(countVotes).values(rows).onConflictDoNothing();
        }
        for (let i = 0; i < rolls.length; i += VOTE_CHUNK) {
          const rows = rolls.slice(i, i + VOTE_CHUNK).map((r) => ({
            shardId,
            day: r.day,
            season: r.season,
            votes: r.votes,
            lean: r.lean,
            target: r.target,
            countFrom: r.from,
            drift: r.drift,
            count: r.count,
          }));
          await tx.insert(countDays).values(rows).onConflictDoNothing();
        }
        await insertActives(tx, shardId, actives);
        const awarded: SeasonAwarded[] = [];
        for (const e of seasons) awarded.push(await writeSeasonEnd(tx, shardId, e, opts.firstFinds));
        if (position || season) {
          await tx
            .update(shards)
            .set({
              ...(position ? { count: position.count, burnStep: position.burnStep, countDay: position.day - 1 } : {}),
              ...(season
                ? {
                    season: season.season,
                    seasonStart: season.start,
                    seasonLength: season.length,
                    seasonActives: season.actives,
                    seasonOpening: seasonOpeningSchema.parse(season.opening),
                  }
                : {}),
            })
            .where(eq(shards.id, shardId));
        }
        return { awarded };
      });
    },
  };
}
