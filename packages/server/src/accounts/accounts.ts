// Account registration and login against Postgres.
import type { Credentials } from '@astra/shared/protocol';
import { sql } from 'drizzle-orm';
import { PG_UNIQUE_VIOLATION, pgErrorCode, type Db } from '../db/client.ts';
import { accounts } from '../db/schema.ts';
import { hashPassword, verifyPassword } from './password.ts';

export type RegisterResult = { ok: true; accountId: string } | { ok: false; reason: 'taken' };

export async function registerAccount(db: Db, creds: Credentials): Promise<RegisterResult> {
  const passwordHash = await hashPassword(creds.password);
  try {
    const [row] = await db.insert(accounts).values({ username: creds.username, passwordHash }).returning({ id: accounts.id });
    return { ok: true, accountId: row!.id };
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) return { ok: false, reason: 'taken' };
    throw err;
  }
}

/**
 * The account id when the username exists (any case) and the password matches; otherwise null. An unknown username is
 * verified against `timingHash` (see createTimingHash) so it takes as long as a wrong password.
 */
export async function authenticate(db: Db, creds: Credentials, timingHash: string): Promise<string | null> {
  const [row] = await db
    .select({ id: accounts.id, passwordHash: accounts.passwordHash })
    .from(accounts)
    .where(sql`lower(${accounts.username}) = lower(${creds.username})`)
    .limit(1);
  if (!row) {
    await verifyPassword(timingHash, creds.password);
    return null;
  }
  return (await verifyPassword(row.passwordHash, creds.password)) ? row.id : null;
}
