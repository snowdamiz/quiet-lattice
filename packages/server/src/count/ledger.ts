// One meter day's votes (DESIGN 16.2): one vote per account per action type per day, so nobody grinds the lean. The
// first vote an account casts on an action type that day is the one that counts, whatever it was tagged; repeating the
// action, or doing it the other way, changes nothing until the next day.
import { addVote, checkVote, EMPTY_TALLY, type CountedAction, type CountVote, type Tally } from './meter.ts';

function voteKey(accountId: string, action: CountedAction): string {
  return `${accountId} ${action}`;
}

export class DayLedger {
  private readonly voted = new Set<string>();
  private sum: Tally = EMPTY_TALLY;

  /** The ledger of meter day `day`, holding `votes` (a log; repeats are dropped as they would have been live). */
  constructor(
    readonly day: number,
    votes: Iterable<CountVote> = [],
  ) {
    for (const v of votes) this.vote(v);
  }

  /**
   * Counts `v` unless its account has already voted on its action type today. Returns whether it counted. Throws
   * RangeError for an action that does not exist or cannot carry the tag.
   */
  vote(v: CountVote): boolean {
    checkVote(v.action, v.tag);
    const key = voteKey(v.accountId, v.action);
    if (this.voted.has(key)) return false;
    this.sum = addVote(this.sum, v.action, v.tag);
    this.voted.add(key);
    return true;
  }

  /** Whether `accountId` has voted on `action` today. */
  has(accountId: string, action: CountedAction): boolean {
    return this.voted.has(voteKey(accountId, action));
  }

  /** The day's votes so far. */
  tally(): Tally {
    return this.sum;
  }
}
