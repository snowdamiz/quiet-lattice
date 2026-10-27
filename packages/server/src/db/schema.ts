// Postgres schema (docs/ARCHITECTURE.md §3, §8). Migrations are generated from this file with `pnpm --filter @astra/server
// db:generate` and committed under packages/server/drizzle/. A character's state beyond its columns (pose, frame, ship,
// inventory, and skills, quests and flags as their tasks arrive) lives in its `state` jsonb, one versioned entry per
// component of the persistence registry (src/persistence/registry.ts), so a new component needs no migration.
import type { DiscoveryKind } from '@astra/shared/discovery';
import type { CharacterLook, PeopleId } from '@astra/shared/protocol';
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
 * and its season. World times are seconds since the epoch.
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

/** Where a find's name stands: its finder may still give one (`open`, until `name_until`), its finder gave one
 * (`named`), a moderator gave one (`renamed`) or took it away for good (`cleared`: the procedural name stays). */
export type NameState = 'open' | 'named' | 'renamed' | 'cleared';

/**
 * First finds (DESIGN 14.5, docs/ARCHITECTURE.md §26): one row per find of a shard, the first player to analyze a species,
 * land on a planet or moon, or reach a site. The key is unique per shard and kind, so of two players racing, one inserts
 * the row and is its finder, and the other finds it there. A find is history: its finder's character may go (its id goes
 * null, its name stays).
 */
export const discoveries = pgTable(
  'discoveries',
  {
    shardId: text('shard_id')
      .notNull()
      .references(() => shards.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<DiscoveryKind>().notNull(),
    /** A species key, a body's frame id or a site key (@astra/shared/discovery); it starts with its system's seed. */
    key: text('key').notNull(),
    /** The seed of the star system it is in: a joining player is sent its system's finds. */
    systemSeed: bigint('system_seed', { mode: 'number' }).notNull(),
    finderId: uuid('finder_id').references(() => characters.id, { onDelete: 'set null' }),
    /** The finder's character name, as everyone is shown it. */
    finderName: text('finder_name').notNull(),
    /** World time (s) it was found. */
    at: doublePrecision('at').notNull(),
    /** The name it was given; null while it keeps its procedural name. */
    name: text('name'),
    nameState: text('name_state').$type<NameState>().notNull().default('open'),
    /** World time (s) until which its finder may name it. */
    nameUntil: doublePrecision('name_until').notNull(),
    /** World time (s) it was named, or renamed or cleared by a moderator. */
    namedAt: doublePrecision('named_at'),
    /** Who named it last: `finder`, or `admin:<operator>`. */
    namedBy: text('named_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.shardId, t.kind, t.key] }),
    index('discoveries_system_idx').on(t.shardId, t.systemSeed),
    index('discoveries_finder_idx').on(t.shardId, t.finderId),
    check('discoveries_kind_check', sql`${t.kind} in ('species', 'body', 'site')`),
    check('discoveries_name_state_check', sql`${t.nameState} in ('open', 'named', 'renamed', 'cleared')`),
    check('discoveries_name_check', sql`(${t.name} is null) = (${t.nameState} in ('open', 'cleared'))`),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type ShardRow = typeof shards.$inferSelect;
export type CountVoteRow = typeof countVotes.$inferSelect;
export type CountDayRow = typeof countDays.$inferSelect;
export type DiscoveryRow = typeof discoveries.$inferSelect;
