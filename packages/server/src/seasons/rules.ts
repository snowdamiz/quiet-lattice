// A season's roll as the server decides it (DESIGN 16.4; P2.E22.T03; ARCHITECTURE §26). Pure: the world service ends a
// season with endSeason() on its shard clock, and the meter's store picks the winning philosophy's players with
// seasonWinners() from the season's stored votes, in the transaction that writes the season's chronicle.
//
// The winners: the accounts whose own counted actions this season, read as the meter reads a day's (DESIGN 16.2: their
// lean, Feed's share of their vote weight, and the target that lean pulls toward), land in the bucket the season ended
// in. So an account that fed all season is the Patient's, one that only chose Hold, or fed and broke alike, is the long
// middle's (its target is 383, or 500), and one that broke is the Reaches'. An account needs at least one full vote's
// weight to be counted (a monolith touch alone is a tenth of one).
import { bucketOf, seasonEndOf, seasonLengthFor, seasonOpening, type SeasonBucket, type SeasonOpening } from '@astra/shared/seasons';
import { addVote, EMPTY_TALLY, isCountedAction, leanOf, targetOf, type CountVote, type Tally } from '../count/meter.ts';

/** The least vote weight (in thirtieths, count/meter.ts) an account's season needs for its philosophy to count: one full
 * counted action. */
export const TITLE_MIN_WEIGHT = 30;

/** The season a shard is in: its number, start (world time, s) and length (s), the mean daily actives its length was
 * chosen from (null: the default, for the first season) and the map it opened with. */
export interface SeasonPosition {
  readonly season: number;
  readonly start: number;
  readonly length: number;
  readonly actives: number | null;
  readonly opening: SeasonOpening;
}

/** A season that ended: what it was, when it ended, the Count it ended at, its bucket, and the season it handed on to. */
export interface SeasonEnd extends SeasonPosition {
  readonly end: number;
  readonly count: number;
  readonly bucket: SeasonBucket;
  readonly next: SeasonPosition;
}

/**
 * Ends season `s` with the Count at `count` (DESIGN 16.4): its bucket, and the next season, starting where it ended
 * (seasonEndOf) with the length `meanActives` chooses (seasonLengthFor) and the map its bucket leaves (seasonOpening).
 * The Count itself goes back to COUNT_START: that is the world service's.
 */
export function endSeason(s: SeasonPosition, count: number, meanActives: number): SeasonEnd {
  const end = seasonEndOf(s.start, s.length);
  const bucket = bucketOf(count);
  const season = s.season + 1;
  return {
    ...s,
    end,
    count,
    bucket,
    next: { season, start: end, length: seasonLengthFor(meanActives), actives: meanActives, opening: seasonOpening(bucket, season) },
  };
}

/** One account's season tally, its lean and the bucket its target lands in. */
export interface AccountLean {
  readonly accountId: string;
  readonly tally: Tally;
  readonly lean: number | null;
  /** null: under TITLE_MIN_WEIGHT, so its philosophy does not count */
  readonly bucket: SeasonBucket | null;
}

/** Each account's lean over `votes` (a season's stored votes: one per account per action type per day). A vote whose
 * action or tag the meter no longer knows is skipped. */
export function accountLeans(votes: Iterable<CountVote>): AccountLean[] {
  const tallies = new Map<string, Tally>();
  for (const v of votes) {
    if (!isCountedAction(v.action)) continue;
    let t = tallies.get(v.accountId) ?? EMPTY_TALLY;
    try {
      t = addVote(t, v.action, v.tag);
    } catch {
      continue;
    }
    tallies.set(v.accountId, t);
  }
  return [...tallies].map(([accountId, tally]) => {
    const lean = leanOf(tally);
    const counted = lean !== null && tally.weight >= TITLE_MIN_WEIGHT;
    return { accountId, tally, lean, bucket: counted ? bucketOf(targetOf(lean)) : null };
  });
}

/** The accounts of the winning philosophy of a season that ended in `bucket`: those whose own lean lands in it. Sorted. */
export function seasonWinners(votes: Iterable<CountVote>, bucket: SeasonBucket): string[] {
  return accountLeans(votes)
    .filter((a) => a.bucket === bucket)
    .map((a) => a.accountId)
    .sort();
}
