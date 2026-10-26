// Where the Count meter persists (docs/ARCHITECTURE.md §11): the Count and the last day rolled into it on the shard's
// row, each vote in `count_votes` as it is cast, and each day's roll in `count_days`. A restart mid-day reloads the open
// day's votes, so the ledger and its one-vote rule carry on; days that ended while the server was down roll on boot.
import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { countDays, countVotes, shards } from '../db/schema.ts';
import type { CountVote, DayRoll } from './meter.ts';

/** A vote as stored: the meter day it counts for and the world time (s) it was cast. */
export interface StoredVote extends CountVote {
  day: number;
  at: number;
}

/** A day's roll as stored. */
export interface StoredRoll extends DayRoll {
  day: number;
  season: number;
}

export interface CountStore {
  /** Every vote of the days after `day`, oldest first. */
  votesAfter(day: number): Promise<StoredVote[]>;
  /** Stores a vote; one the account already cast on that action that day is ignored. */
  addVote(vote: StoredVote): Promise<void>;
  /** Stores a day's roll and sets the shard's Count and last rolled day to it, together. A day already rolled is ignored. */
  saveRoll(roll: StoredRoll): Promise<void>;
  /** Sets the shard's Count outside a roll (dev tooling), and its last rolled day when given (the meter's first run). */
  saveCount(count: number, day?: number): Promise<void>;
}

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
    async addVote(v) {
      await db.insert(countVotes).values({ shardId, day: v.day, accountId: v.accountId, action: v.action, tag: v.tag, at: v.at }).onConflictDoNothing();
    },
    async saveRoll(r) {
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(countDays)
          .values({
            shardId,
            day: r.day,
            season: r.season,
            votes: r.votes,
            lean: r.lean,
            target: r.target,
            countFrom: r.from,
            drift: r.drift,
            burn: r.burn,
            count: r.count,
          })
          .onConflictDoNothing()
          .returning({ day: countDays.day });
        if (inserted.length === 0) return;
        await tx
          .update(shards)
          .set({ count: r.count, countDay: r.day })
          .where(and(eq(shards.id, shardId), or(isNull(shards.countDay), lt(shards.countDay, r.day))));
      });
    },
    async saveCount(count, day) {
      await db
        .update(shards)
        .set(day === undefined ? { count } : { count, countDay: day })
        .where(eq(shards.id, shardId));
    },
  };
}
