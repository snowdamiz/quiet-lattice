// The daily actives tally (ARCHITECTURE §26): how many distinct accounts entered the world on each meter day, kept in
// memory by the world service so a season's end can choose the next season's length (DESIGN 16.4: four weeks while the
// last month's daily actives are few) without waiting on the database. The open day keeps its accounts, so an account is
// counted once a day; closed days keep only their count, and only as far back as a season's choice reads. Each account
// newly active on a day is saved with the meter (`daily_actives`), and a restart loads the counts and the open day's
// accounts back.
import { ACTIVES_WINDOW_DAYS, meanDailyActives } from '@astra/shared/seasons';

export class DailyActives {
  private readonly counts = new Map<number, number>();
  private today = new Set<string>();

  /** The tally on meter day `day`: `counts` gives earlier days' counts, `today` the accounts active on `day` so far. */
  constructor(
    private day: number,
    opts: { counts?: Iterable<readonly [number, number]>; today?: Iterable<string> } = {},
  ) {
    for (const [d, n] of opts.counts ?? []) if (d < day) this.counts.set(d, n);
    for (const a of opts.today ?? []) this.today.add(a);
  }

  /**
   * Counts `accountId` active on meter day `day`, the open day or a later one (a later day closes the open one): true
   * when it is the account's first time that day. Throws RangeError for a day before the open one.
   */
  mark(accountId: string, day: number): boolean {
    if (day < this.day) throw new RangeError(`day ${day} is closed: the tally is on day ${this.day}`);
    if (day > this.day) {
      if (this.today.size > 0) this.counts.set(this.day, this.today.size);
      this.today = new Set();
      this.day = day;
      // (a season's choice reads the month before the season's end, which is never before today)
      for (const d of this.counts.keys()) if (d < day - ACTIVES_WINDOW_DAYS) this.counts.delete(d);
    }
    if (this.today.has(accountId)) return false;
    this.today.add(accountId);
    return true;
  }

  /** Distinct accounts active on meter day `day`. */
  on(day: number): number {
    return day === this.day ? this.today.size : (this.counts.get(day) ?? 0);
  }

  /** The mean daily actives of the month of meter days before `day` (meanDailyActives). */
  meanBefore(day: number): number {
    return meanDailyActives((d) => this.on(d), day);
  }
}
