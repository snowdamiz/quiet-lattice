// Postgres schema (docs/ARCHITECTURE.md §3, §8). Migrations are generated from this file with `pnpm --filter @astra/server
// db:generate` and committed under packages/server/drizzle/. A character's state beyond its columns (pose, frame, ship,
// inventory, and skills, quests and flags as their tasks arrive) lives in its `state` jsonb, one versioned entry per
// component of the persistence registry (src/persistence/registry.ts), so a new component needs no migration.
import type { CharacterLook, PeopleId } from '@astra/shared/protocol';
import type { StoredState } from '../persistence/registry.ts';
import { sql } from 'drizzle-orm';
import { bigint, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
  },
  (t) => [check('shards_season_check', sql`${t.season} >= 1`), check('shards_season_length_check', sql`${t.seasonLength} > 0`)],
);

export type AccountRow = typeof accounts.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type ShardRow = typeof shards.$inferSelect;
