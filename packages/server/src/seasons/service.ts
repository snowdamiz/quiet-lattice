// The seasons as the gateway sees them (DESIGN 16.4; ARCHITECTURE §26): an account that enters the world is counted
// active for the day (the next season's length is chosen from that), what an account has earned is read as its character
// enters, each season's end reaches whoever listens once its awards are written, and a finished season's chronicle is
// served (cached: a finished season never changes). The seasons themselves roll in the world service, on its clock.
import type { SeasonAward, SeasonChronicle } from '@astra/shared/seasons';
import type { Db } from '../db/client.ts';
import type { SeasonListener, WorldService } from '../world/service.ts';
import { readAwards, readChronicle } from './store.ts';

/** What the gateway needs of the seasons (tests stand in for it). */
export interface SeasonGateway {
  /** Counts the account active today, for the next season's length. */
  markActive(accountId: string): void;
  /** The titles and glyphs the account has earned, oldest season first. */
  awardsOf(accountId: string): Promise<SeasonAward[]>;
  /** Calls `listener` after each season's end is written, until the returned function is called. */
  onSeasonEnded(listener: SeasonListener): () => void;
}

/** What the HTTP gateway serves of the seasons. */
export interface ChronicleSource {
  /** Season `season`'s chronicle, or null when it has not ended (or its end is not written yet). */
  chronicle(season: number): Promise<SeasonChronicle | null>;
}

/** A pino-shaped logger (Fastify's). */
export interface SeasonLog {
  warn(obj: object, msg: string): void;
}

export class SeasonService implements SeasonGateway, ChronicleSource {
  private readonly world: Pick<WorldService, 'shardId' | 'state' | 'markActive' | 'onSeasonEnded'>;
  private readonly db: Db;
  private readonly log?: SeasonLog;
  private readonly chronicles = new Map<number, SeasonChronicle>();

  constructor(opts: { world: Pick<WorldService, 'shardId' | 'state' | 'markActive' | 'onSeasonEnded'>; db: Db; log?: SeasonLog }) {
    this.world = opts.world;
    this.db = opts.db;
    this.log = opts.log;
  }

  markActive(accountId: string): void {
    try {
      this.world.markActive(accountId);
    } catch (err) {
      this.log?.warn({ account: accountId, err: err instanceof Error ? err.message : String(err) }, 'could not count an account active');
    }
  }

  awardsOf(accountId: string): Promise<SeasonAward[]> {
    return readAwards(this.db, this.world.shardId, accountId.toLowerCase());
  }

  onSeasonEnded(listener: SeasonListener): () => void {
    return this.world.onSeasonEnded(listener);
  }

  async chronicle(season: number): Promise<SeasonChronicle | null> {
    if (!Number.isInteger(season) || season < 1 || season >= this.world.state().season) return null;
    const cached = this.chronicles.get(season);
    if (cached) return cached;
    const c = await readChronicle(this.db, this.world.shardId, season);
    // (a season that ended moments ago may not be written yet: not cached, so the next ask reads it again)
    if (c) this.chronicles.set(season, c);
    return c;
  }
}
