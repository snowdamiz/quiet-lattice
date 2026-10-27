// Where a shard's first finds persist (docs/ARCHITECTURE.md §26): the `discoveries` table, one row per find, keyed by
// shard, kind and key. Every change that decides something is one statement whose condition is the rule, so Postgres
// arbitrates between players (and, later, processes) racing:
// - a claim inserts the row unless one is there (ON CONFLICT DO NOTHING on the key): of two players finding the same
//   thing, one inserts it and is its finder, the other reads the finder's row back;
// - a finder's name is written only on its own find, still `open` (never named, never closed by a moderator) and still
//   within its window (`name_until` not past the server's clock): two names at once, or a name after the window, write
//   nothing;
// - a moderator's rename or clear writes whatever the row holds.
// Unit tests use memoryDiscoveryStore, which keeps the same rules in memory.
import type { DiscoveryKind } from '@astra/shared/discovery';
import { and, eq, gte, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { discoveries, type NameState } from '../db/schema.ts';

/** A find as the store holds it. World times in seconds. */
export interface DiscoveryRecord {
  kind: DiscoveryKind;
  key: string;
  systemSeed: number;
  /** null once the finder's character is gone */
  finderId: string | null;
  finderName: string;
  at: number;
  name: string | null;
  nameState: NameState;
  nameUntil: number;
}

/** A find to claim: its finder, when, and until when it may name it. */
export type DiscoveryClaim = Omit<DiscoveryRecord, 'name' | 'nameState'>;

/** A claim's outcome: `won` (this call inserted the row: the claimant is the finder) or not, with the row that stands
 * (null only when it could not be read back). */
export type ClaimResult = { won: true; record: DiscoveryRecord } | { won: false; record: DiscoveryRecord | null };

export interface DiscoveryStore {
  readonly shardId: string;
  /** Inserts the find unless the shard has it already. */
  claim(c: DiscoveryClaim): Promise<ClaimResult>;
  get(kind: DiscoveryKind, key: string): Promise<DiscoveryRecord | null>;
  /** Every find of a star system, by its seed. */
  forSystem(systemSeed: number): Promise<DiscoveryRecord[]>;
  /** Every find a character made. */
  byFinder(characterId: string): Promise<DiscoveryRecord[]>;
  /**
   * Gives a find its finder's name: only `finderId`'s own find, still open, at world time `now` no later than its window's
   * end. The row as named, or null when it wrote nothing (read the row to say why).
   */
  name(kind: DiscoveryKind, key: string, finderId: string, name: string, now: number): Promise<DiscoveryRecord | null>;
  /** A moderator's rename (`name`) or clear (null: the procedural name for good). The row as written, or null when there is
   * no such find. */
  rename(kind: DiscoveryKind, key: string, name: string | null, by: string, now: number): Promise<DiscoveryRecord | null>;
}

const COLUMNS = {
  kind: discoveries.kind,
  key: discoveries.key,
  systemSeed: discoveries.systemSeed,
  finderId: discoveries.finderId,
  finderName: discoveries.finderName,
  at: discoveries.at,
  name: discoveries.name,
  nameState: discoveries.nameState,
  nameUntil: discoveries.nameUntil,
};

/** Shard `shardId`'s finds in Postgres. */
export function pgDiscoveryStore(db: Db, shardId: string): DiscoveryStore {
  const at = (kind: DiscoveryKind, key: string) => and(eq(discoveries.shardId, shardId), eq(discoveries.kind, kind), eq(discoveries.key, key));
  const get = async (kind: DiscoveryKind, key: string): Promise<DiscoveryRecord | null> => {
    const [row] = await db.select(COLUMNS).from(discoveries).where(at(kind, key)).limit(1);
    return row ?? null;
  };
  return {
    shardId,
    async claim(c) {
      const [row] = await db
        .insert(discoveries)
        .values({ shardId, ...c, name: null, nameState: 'open' })
        .onConflictDoNothing()
        .returning(COLUMNS);
      return row ? { won: true, record: row } : { won: false, record: await get(c.kind, c.key) };
    },
    get,
    async forSystem(systemSeed) {
      return db
        .select(COLUMNS)
        .from(discoveries)
        .where(and(eq(discoveries.shardId, shardId), eq(discoveries.systemSeed, systemSeed)));
    },
    async byFinder(characterId) {
      return db
        .select(COLUMNS)
        .from(discoveries)
        .where(and(eq(discoveries.shardId, shardId), eq(discoveries.finderId, characterId)));
    },
    async name(kind, key, finderId, name, now) {
      const [row] = await db
        .update(discoveries)
        .set({ name, nameState: 'named', namedAt: now, namedBy: 'finder' })
        .where(and(at(kind, key), eq(discoveries.finderId, finderId), eq(discoveries.nameState, 'open'), isNull(discoveries.name), gte(discoveries.nameUntil, now)))
        .returning(COLUMNS);
      return row ?? null;
    },
    async rename(kind, key, name, by, now) {
      const [row] = await db
        .update(discoveries)
        .set({ name, nameState: name === null ? 'cleared' : 'renamed', namedAt: now, namedBy: by })
        .where(at(kind, key))
        .returning(COLUMNS);
      return row ?? null;
    },
  };
}

/** The same rules in memory, for unit tests: `delayMs` holds each call that long, so tests can race them. */
export function memoryDiscoveryStore(shardId = 'test', opts: { delayMs?: number } = {}): DiscoveryStore & { readonly rows: Map<string, DiscoveryRecord> } {
  const rows = new Map<string, DiscoveryRecord>();
  const id = (kind: DiscoveryKind, key: string) => `${kind}|${key}`;
  const wait = () => new Promise<void>((r) => setTimeout(r, opts.delayMs ?? 0));
  const copy = (r: DiscoveryRecord | undefined) => (r ? { ...r } : null);
  return {
    shardId,
    rows,
    async claim(c) {
      await wait();
      const have = rows.get(id(c.kind, c.key));
      if (have) return { won: false, record: { ...have } };
      const r: DiscoveryRecord = { ...c, name: null, nameState: 'open' };
      rows.set(id(c.kind, c.key), r);
      return { won: true, record: { ...r } };
    },
    async get(kind, key) {
      await wait();
      return copy(rows.get(id(kind, key)));
    },
    async forSystem(systemSeed) {
      await wait();
      return [...rows.values()].filter((r) => r.systemSeed === systemSeed).map((r) => ({ ...r }));
    },
    async byFinder(characterId) {
      await wait();
      return [...rows.values()].filter((r) => r.finderId === characterId).map((r) => ({ ...r }));
    },
    async name(kind, key, finderId, name, now) {
      await wait();
      const r = rows.get(id(kind, key));
      if (!r || r.finderId !== finderId || r.nameState !== 'open' || r.name !== null || !(r.nameUntil >= now)) return null;
      Object.assign(r, { name, nameState: 'named' as const });
      return { ...r };
    },
    async rename(kind, key, name) {
      await wait();
      const r = rows.get(id(kind, key));
      if (!r) return null;
      Object.assign(r, { name, nameState: name === null ? ('cleared' as const) : ('renamed' as const) });
      return { ...r };
    },
  };
}
