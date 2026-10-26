// Postgres schema (docs/ARCHITECTURE.md §8). Migrations are generated from this file with `pnpm --filter @astra/server
// db:generate` and committed under packages/server/drizzle/. Later tasks add pose, frame, ship, inventory, skills, quests
// and flags to `characters` (or child tables) with their own migrations.
import type { CharacterLook, PeopleId } from '@astra/shared/protocol';
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('characters_name_lower_key').on(sql`lower(${t.name})`),
    index('characters_account_id_idx').on(t.accountId),
    check('characters_people_check', sql`${t.people} in ('thalune', 'ixari', 'ulgani')`),
    check('characters_level_check', sql`${t.level} between 1 and 50`),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
