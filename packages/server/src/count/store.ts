// Where the Count meter persists (docs/ARCHITECTURE.md §11): the Count and how far the meter has run (the last day rolled,
// the last burn tick) on the shard's row, each vote in `count_votes`, each day's roll in `count_days`. The world service
// gathers what changed and writes it in one transaction per save, so a burst of votes is one batch and a boot that catches
// up on missed days is one write. A restart reloads the votes of the days not yet rolled, so the open day's ledger and its
// one-vote rule carry on.
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { countDays, countVotes, shards } from '../db/schema.ts';
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

/** One save: new votes, new rolls and, when it moved, where the meter stands. */
export interface MeterWrite {
  votes: readonly StoredVote[];
  rolls: readonly StoredRoll[];
  /** The shard's Count, its last burn tick, and its open day (every day before it has rolled). */
  position?: MeterPosition;
}

export interface CountStore {
  /** Every vote of the days after `day`, oldest first. */
  votesAfter(day: number): Promise<StoredVote[]>;
  /**
   * Writes a save in one transaction: votes (one an account already cast on that action that day is ignored), rolls (a
   * day already stored is ignored) and the meter's position on the shard's row.
   */
  save(write: MeterWrite): Promise<void>;
}

/** Rows per INSERT: at 6 parameters a vote and 9 a roll, far under Postgres's 65,535. */
const VOTE_CHUNK = 1000;

/** Shard `shardId`'s meter in Postgres. */
export function pgCountStore(db: Db, shardId: string): CountStore {
  return {
    async votesAfter(day) {
      const rows = await db
        .select()
        .from(countVotes)
        .where(and(eq(countVotes.shardId, shardId), gt(countVotes.day, day)))
        .orderBy(asc(countVotes.day), asc(countVotes.at));
      return rows.map((r) => ({ day: r.day, at: r.at, accountId: r.accountId, action: r.action as CountVote['action'], tag: r.tag }));
    },
    async save({ votes, rolls, position }) {
      await db.transaction(async (tx) => {
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
        if (position) {
          await tx
            .update(shards)
            .set({ count: position.count, burnStep: position.burnStep, countDay: position.day - 1 })
            .where(eq(shards.id, shardId));
        }
      });
    },
  };
}
