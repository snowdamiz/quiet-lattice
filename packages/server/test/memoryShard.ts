// A shard's row, its meter and its seasons in memory, for unit tests of the world service: pgShardStore's rules
// (count/store.ts, seasons/store.ts) without Postgres. One vote per account per action per day, a day's roll, a daily
// active, a season's awards and its chronicle each stored once; a season's winners picked from every vote cast in it.
import { seasonAward, type SeasonAward } from '@astra/shared/seasons';
import type { CountStore, MeterWrite, StoredRoll, StoredVote } from '../src/count/store.ts';
import { seasonWinners, type SeasonEnd } from '../src/seasons/rules.ts';
import type { StoredActive } from '../src/seasons/store.ts';
import { DEFAULT_SHARD_EPOCH_MS } from '../src/world/clock.ts';
import { newShardRecord, type ShardRecord, type ShardStore } from '../src/world/shard.ts';

export class MemoryShard implements ShardStore {
  record: ShardRecord | null = null;
  votes: StoredVote[] = [];
  rolls: StoredRoll[] = [];
  actives: StoredActive[] = [];
  /** Each season that ended, as written, with how many accounts it awarded. */
  chronicles: (SeasonEnd & { awarded: number })[] = [];
  awards: { accountId: string; award: SeasonAward }[] = [];
  /** Every meter save, as asked. */
  saves: MeterWrite[] = [];
  /** While true, a meter save fails. */
  fail = false;
  readonly count: CountStore;

  constructor(
    readonly id: string,
    private readonly wallMs: number,
    private readonly epochMs = DEFAULT_SHARD_EPOCH_MS,
  ) {
    this.count = {
      votesAfter: async (day) => this.votes.filter((v) => v.day > day).sort((a, b) => a.day - b.day || a.at - b.at),
      actives: async (from, today) => {
        const counts = new Map<number, number>();
        for (const a of this.actives) if (a.day >= from) counts.set(a.day, (counts.get(a.day) ?? 0) + 1);
        return { counts: [...counts], today: this.actives.filter((a) => a.day === today).map((a) => a.accountId) };
      },
      save: async (write) => {
        if (this.fail) throw new Error('postgres is down');
        this.saves.push(write);
        for (const v of write.votes) {
          if (!this.votes.some((o) => o.day === v.day && o.accountId === v.accountId && o.action === v.action)) this.votes.push({ ...v });
        }
        for (const r of write.rolls) if (!this.rolls.some((o) => o.day === r.day)) this.rolls.push(r);
        for (const a of write.actives ?? []) if (!this.actives.some((o) => o.day === a.day && o.accountId === a.accountId)) this.actives.push({ ...a });
        const awarded = [];
        for (const e of write.seasons ?? []) {
          const award = seasonAward(e.season, e.bucket);
          const accounts = seasonWinners(
            this.votes.filter((v) => v.at >= e.start && v.at < e.end),
            e.bucket,
          );
          for (const accountId of accounts) {
            if (!this.awards.some((a) => a.award.season === e.season && a.accountId === accountId)) this.awards.push({ accountId, award });
          }
          if (!this.chronicles.some((c) => c.season === e.season)) this.chronicles.push({ ...e, awarded: accounts.length });
          awarded.push({ season: e.season, award, accounts });
        }
        if (write.position) Object.assign(this.record!, { count: write.position.count, burnStep: write.position.burnStep, countDay: write.position.day - 1 });
        if (write.season) {
          const s = write.season;
          Object.assign(this.record!, { season: s.season, seasonStart: s.start, seasonLength: s.length, seasonActives: s.actives, seasonOpening: s.opening });
        }
        return { awarded };
      },
    };
  }

  async load(): Promise<ShardRecord> {
    this.record ??= newShardRecord(this.id, this.epochMs, this.wallMs);
    return structuredClone(this.record);
  }

  async saveTime(time: number): Promise<void> {
    if (this.record) this.record.lastTime = Math.max(this.record.lastTime, time);
  }
}
