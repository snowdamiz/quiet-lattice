// Postgres schema (docs/ARCHITECTURE.md §3, §8). Migrations are generated from this file with `pnpm --filter @astra/server
// db:generate` and committed under packages/server/drizzle/. A character's state beyond its columns (pose, frame, ship,
// inventory, and skills, quests and flags as their tasks arrive) lives in its `state` jsonb, one versioned entry per
// component of the persistence registry (src/persistence/registry.ts), so a new component needs no migration.
import type { CharacterLook, PeopleId } from '@astra/shared/protocol';
import type { ChronicleFind, Philosophy, SeasonBucket, SeasonOpening } from '@astra/shared/seasons';
import type { StoredState } from '../persistence/registry.ts';
import { sql } from 'drizzle-orm';
import { bigint, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** As the player typed it; uniqueness ignores case. */
    username: text('username').notNull(),
    /** argon2id PHC string. */
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('accounts_username_lower_key').on(sql`lower(${t.username})`)],
);

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** As the player typed it; uniqueness ignores case across the shard. */
    name: text('name').notNull(),
    people: text('people').$type<PeopleId>().notNull(),
    look: jsonb('look').$type<CharacterLook>().notNull(),
    level: integer('level').notNull().default(1),
    xp: bigint('xp', { mode: 'number' }).notNull().default(0),
    /** Galaxy system index of the character's home system (DESIGN 5.1). */
    homeSystem: integer('home_system').notNull(),
    /** Each persistence component's `{v, data}` by key (pose, ship, inventory…); `{}` until the first save. */
    state: jsonb('state').$type<StoredState>().notNull().default({}),
    /** Raised by every save; a save carrying a revision not above it is stale and skipped (src/persistence/store.ts). */
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    /** When the character was last saved; null before its first save. */
    savedAt: timestamp('saved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('characters_name_lower_key').on(sql`lower(${t.name})`),
    index('characters_account_id_idx').on(t.accountId),
    check('characters_people_check', sql`${t.people} in ('thalune', 'ixari', 'ulgani')`),
    check('characters_level_check', sql`${t.level} between 1 and 50`),
    check('characters_revision_check', sql`${t.revision} >= 0`),
  ],
);

/**
 * One row per world shard, created on its server's first boot (docs/ARCHITECTURE.md §3, DESIGN 16.4): the epoch its
 * world time counts from, the latest world time its server saved (so the clock never starts below it after a restart)
 * and its season: its number, start and length, the mean daily actives its length was chosen from and the map it opened
 * with (§25). World times are seconds since the epoch.
 */
export const shards = pgTable(
  'shards',
  {
    id: text('id').primaryKey(),
    /** World time 0. */
    epoch: timestamp('epoch', { withTimezone: true, mode: 'date' }).notNull(),
    /** The latest world time (s) the shard's server saved; only ever raised. */
    lastTime: doublePrecision('last_time').notNull().default(0),
    season: integer('season').notNull().default(1),
    /** World time (s) the season began. */
    seasonStart: doublePrecision('season_start').notNull(),
    /** The season's length (s). */
    seasonLength: integer('season_length').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** The Count, in whole measures (DESIGN 16.1); a new shard's starts at COUNT_START (count/meter.ts). */
    count: integer('count').notNull().default(500),
    /** The last meter day (world time ÷ 86,400 s, floored) rolled into the Count; null until the meter first runs. */
    countDay: integer('count_day'),
    /** The last burn tick (world time ÷ 17,280 s, floored) burned into the Count; null until the meter first runs. */
    burnStep: integer('burn_step'),
    /** The mean daily actives of the month before the season, its length chosen from (§25); null for the first season,
     * which took the default length. */
    seasonActives: doublePrecision('season_actives'),
    /** The map the season opened with (DESIGN 16.4, §25): how the season before ended, the Edge's shift (ly) and the
     * systems dark this season; the baseline for the first. P2.E22.T02 applies it. */
    seasonOpening: jsonb('season_opening').$type<SeasonOpening>().notNull().default({ from: null, edgeShiftLy: 0, dark: [] }),
  },
  (t) => [
    check('shards_season_check', sql`${t.season} >= 1`),
    check('shards_season_length_check', sql`${t.seasonLength} > 0`),
    check('shards_count_check', sql`${t.count} between 0 and 1000`),
  ],
);

/**
 * The Count meter's votes (DESIGN 16.2): one row per account per counted action per meter day, the first vote it cast,
 * kept after the day rolls for the season chronicle. No foreign key to `accounts`: a vote is history.
 */
export const countVotes = pgTable(
  'count_votes',
  {
    shardId: text('shard_id')
      .notNull()
      .references(() => shards.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    accountId: uuid('account_id').notNull(),
    action: text('action').notNull(),
    tag: text('tag').$type<'feed' | 'hold' | 'break'>().notNull(),
    /** World time (s) the vote was cast. */
    at: doublePrecision('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.shardId, t.day, t.accountId, t.action] }), check('count_votes_tag_check', sql`${t.tag} in ('feed', 'hold', 'break')`)],
);

/**
 * Each meter day the Count rolled (DESIGN 16.2): its votes, lean and target, the Count at the day's end, the drift and the
 * Count after it. The burn is not here: it falls on its own clock, one measure every 17,280 s.
 */
export const countDays = pgTable(
  'count_days',
  {
    shardId: text('shard_id')
      .notNull()
      .references(() => shards.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    season: integer('season').notNull(),
    votes: integer('votes').notNull(),
    /** Feed's share of the day's weight; null on a day with no votes. */
    lean: doublePrecision('lean'),
    target: integer('target'),
    countFrom: integer('count_from').notNull(),
    drift: integer('drift').notNull(),
    count: integer('count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shardId, t.day] })],
);

/**
 * Each account active on each meter day (§25): an account that entered the world that day, once. A season's length is
 * chosen from the mean of the month before it (DESIGN 16.4). No foreign key to `accounts`: it is history.
 */
export const dailyActives = pgTable(
  'daily_actives',
  {
    shardId: text('shard_id')
      .notNull()
      .references(() => shards.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    accountId: uuid('account_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.shardId, t.day, t.accountId] })],
);

/**
 * Each finished season's chronicle (DESIGN 16.4, §25), written in the meter's transaction when the season ends: when it
 * ran, its length and the mean daily actives that chose it, the map it opened with, the Count it ended at and so its
 * bucket, the winning philosophy with its title and glyph and how many accounts earned them, the map the next season
 * opens with, and its notable first finds. Its meter path is the season's rows of `count_days`.
 */
export const seasonChronicles = pgTable(
  'season_chronicles',
  {
    shardId: text('shard_id')
      .notNull()
      .references(() => shards.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    /** World times (s) it began and ended. */
    seasonStart: doublePrecision('season_start').notNull(),
    seasonEnd: doublePrecision('season_end').notNull(),
    /** Its length (s), as chosen when it began. */
    seasonLength: integer('season_length').notNull(),
    actives: doublePrecision('actives'),
    opening: jsonb('opening').$type<SeasonOpening>().notNull(),
    /** The Count at its end. */
    count: integer('count').notNull(),
    bucket: text('bucket').$type<SeasonBucket>().notNull(),
    philosophy: text('philosophy').$type<Philosophy>().notNull(),
    title: text('title').notNull(),
    glyph: text('glyph').notNull(),
    /** Accounts that earned its title and glyph. */
    awarded: integer('awarded').notNull(),
    /** The map the next season opens with. */
    next: jsonb('next').$type<SeasonOpening>().notNull(),
    /** Notable first finds (P2.E29.T01 names them). */
    finds: jsonb('finds').$type<ChronicleFind[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.shardId, t.season] }),
    check('season_chronicles_bucket_check', sql`${t.bucket} in ('fed', 'held', 'broken')`),
    check('season_chronicles_count_check', sql`${t.count} between 0 and 1000`),
  ],
);

/**
 * The title and glyph each account of a season's winning philosophy earned (DESIGN 16.4, §25), written with the
 * season's chronicle. Its characters carry them in their `seasonAwards` component, merged in when they enter the world.
 * No foreign key to `accounts`: it is history.
 */
export const seasonAwards = pgTable(
  'season_awards',
  {
    shardId: text('shard_id')
      .notNull()
      .references(() => shards.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    accountId: uuid('account_id').notNull(),
    bucket: text('bucket').$type<SeasonBucket>().notNull(),
    title: text('title').notNull(),
    glyph: text('glyph').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.shardId, t.season, t.accountId] }),
    index('season_awards_account_idx').on(t.shardId, t.accountId),
    check('season_awards_bucket_check', sql`${t.bucket} in ('fed', 'held', 'broken')`),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type ShardRow = typeof shards.$inferSelect;
export type CountVoteRow = typeof countVotes.$inferSelect;
export type CountDayRow = typeof countDays.$inferSelect;
export type SeasonChronicleRow = typeof seasonChronicles.$inferSelect;
export type SeasonAwardRow = typeof seasonAwards.$inferSelect;
