// Characters: listing, creation (DESIGN 5.1: pick a people, a name and a look; no stat differences) and ownership checks.
import type { CharacterCreate, CharacterSummary } from '@astra/shared/protocol';
import { and, asc, count, eq } from 'drizzle-orm';
import { PG_UNIQUE_VIOLATION, pgErrorCode, type Db } from '../db/client.ts';
import { accounts, characters, type CharacterRow } from '../db/schema.ts';
import { homeSystemOf } from '../world/home.ts';

/** A choice, not from DESIGN: six slots covers one character per people twice over (logged in DECISIONS by the orchestrator). */
export const MAX_CHARACTERS_PER_ACCOUNT = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID.test(s);
}

export function toSummary(row: CharacterRow): CharacterSummary {
  return { id: row.id, name: row.name, people: row.people, look: row.look, level: row.level, homeSystem: row.homeSystem };
}

export async function listCharacters(db: Db, accountId: string): Promise<CharacterSummary[]> {
  const rows = await db.select().from(characters).where(eq(characters.accountId, accountId)).orderBy(asc(characters.createdAt), asc(characters.id));
  return rows.map(toSummary);
}

export type CreateCharacterResult = { ok: true; character: CharacterSummary } | { ok: false; reason: 'name_taken' | 'limit' | 'no_account' };

/** Creates a character; `input.name` must already have passed checkCharacterName. */
export async function createCharacter(db: Db, accountId: string, input: CharacterCreate): Promise<CreateCharacterResult> {
  try {
    return await db.transaction(async (tx): Promise<CreateCharacterResult> => {
      // Lock the account row so two concurrent creates cannot both pass the cap.
      const [account] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).for('update');
      if (!account) return { ok: false, reason: 'no_account' };
      const [owned] = await tx.select({ n: count() }).from(characters).where(eq(characters.accountId, accountId));
      if ((owned?.n ?? 0) >= MAX_CHARACTERS_PER_ACCOUNT) return { ok: false, reason: 'limit' };
      const [row] = await tx
        .insert(characters)
        .values({ accountId, name: input.name, people: input.people, look: input.look, homeSystem: homeSystemOf(input.people) })
        .returning();
      return { ok: true, character: toSummary(row!) };
    });
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) return { ok: false, reason: 'name_taken' };
    throw err;
  }
}

/** The character when it exists and belongs to the account, else null. */
export async function getOwnedCharacter(db: Db, accountId: string, characterId: string): Promise<CharacterRow | null> {
  if (!isUuid(characterId) || !isUuid(accountId)) return null;
  const [row] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
    .limit(1);
  return row ?? null;
}
