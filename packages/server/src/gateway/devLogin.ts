// The dev login bypass (P1.E03.T07, docs/ARCHITECTURE.md §16): `POST /auth/dev {name, people?}` signs in to the dev
// account `dev-<name>` without a password, making it (with a password nobody knows) and a character for it on first
// use, and answers `{token, accountId, character, created}`, so the client's dev scenarios (`#foot`, `#fly`, …) go
// through the real server in one request (P1.E04.T05 calls it). server.ts registers it only when ASTRA_DEV_LOGIN is set
// outside production (admin/config.ts refuses the flag in production); without it the path does not exist (404). Only
// `dev-` accounts are reachable this way, and registration refuses `dev-` usernames (gateway/http.ts), so no player's
// account is; every dev login is logged at warn.
import { randomBytes, randomInt } from 'node:crypto';
import { CharacterSummary, DEV_USERNAME_PREFIX, isDevUsername, PeopleId, type CharacterLook } from '@astra/shared/protocol';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../accounts/password.ts';
import type { TokenService } from '../accounts/tokens.ts';
import { createCharacter, listCharacters, MAX_CHARACTERS_PER_ACCOUNT } from '../characters/characters.ts';
import { PG_UNIQUE_VIOLATION, pgErrorCode, type Db } from '../db/client.ts';
import { accounts } from '../db/schema.ts';
import { clientKey, type RateLimiter } from './rateLimit.ts';

/** `name`: the dev account's name after `dev-` (the scenario's, say `foot`); `people`: whose character to sign in as. */
export const DevLoginRequest = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/, '1–20 letters, digits, - or _'),
  people: PeopleId.optional(),
});
export const DevLoginResponse = z.object({
  token: z.string(),
  accountId: z.string(),
  character: CharacterSummary,
  /** the account was made by this request */
  created: z.boolean(),
});
export type DevLoginResponse = z.infer<typeof DevLoginResponse>;

export interface DevLoginDeps {
  db: Db;
  tokens: TokenService;
  authLimiter: RateLimiter;
  log: FastifyBaseLogger;
}

const DEV_LOOK: CharacterLook = { palette: 0, pattern: 0, head: 0, suit: 0 };

export function registerDevLogin(app: FastifyInstance, deps: DevLoginDeps): void {
  const fail = (reply: FastifyReply, status: number, error: string, message: string) => reply.code(status).send({ error, message });
  app.register(
    async (auth) => {
      auth.addHook('onRequest', async (req, reply) => {
        const r = deps.authLimiter.take(clientKey(req.ip));
        if (!r.ok) {
          reply.header('retry-after', String(r.retryAfterSeconds));
          return fail(reply, 429, 'rate_limited', 'Too many attempts. Try again in a moment.');
        }
      });

      auth.post('/dev', async (req, reply) => {
        const body = DevLoginRequest.safeParse(req.body ?? {});
        if (!body.success) return fail(reply, 400, 'invalid', 'A dev login names its account: 1–20 letters, digits, - or _.');
        const username = `${DEV_USERNAME_PREFIX}${body.data.name.toLowerCase()}`;
        const { accountId, created } = await devAccount(deps.db, username);
        const people = body.data.people;
        const owned = await listCharacters(deps.db, accountId);
        let character = owned.find((c) => people === undefined || c.people === people);
        if (!character) {
          if (owned.length >= MAX_CHARACTERS_PER_ACCOUNT)
            return fail(reply, 409, 'character_limit', `${username} holds ${MAX_CHARACTERS_PER_ACCOUNT} characters, none of them ${people}.`);
          character = await devCharacter(deps.db, accountId, body.data.name, people ?? 'thalune');
        }
        const res: DevLoginResponse = { token: await deps.tokens.sign(accountId), accountId, character, created };
        deps.log.warn({ account: accountId, username, character: character.id, created, remote: req.ip }, 'dev login');
        return reply.send(DevLoginResponse.parse(res));
      });
    },
    { prefix: '/auth' },
  );
}

/** The dev account of that name, made with a password nobody knows when there is none. */
async function devAccount(db: Db, username: string): Promise<{ accountId: string; created: boolean }> {
  if (!isDevUsername(username)) throw new Error(`the dev login reaches dev accounts only, not ${username}`);
  const find = async () => {
    const [row] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(sql`lower(${accounts.username}) = ${username}`)
      .limit(1);
    return row?.id;
  };
  const existing = await find();
  if (existing) return { accountId: existing, created: false };
  try {
    const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
    const [row] = await db.insert(accounts).values({ username, passwordHash }).returning({ id: accounts.id });
    return { accountId: row!.id, created: true };
  } catch (err) {
    // two first logins at once: the other made it
    const raced = pgErrorCode(err) === PG_UNIQUE_VIOLATION ? await find() : undefined;
    if (raced) return { accountId: raced, created: false };
    throw err;
  }
}

/**
 * A character for a dev account, named "Dev <Name>" (the reserved word "dev" keeps it from passing for a player's;
 * only this route bypasses the name rules), with three letters added when another character has the name.
 */
async function devCharacter(db: Db, accountId: string, name: string, people: PeopleId): Promise<CharacterSummary> {
  const letters = name.replace(/[^A-Za-z]/g, '').toLowerCase();
  const word = letters ? letters[0]!.toUpperCase() + letters.slice(1, 12) : 'Pilot';
  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = attempt === 0 ? '' : ` ${randomLetters(3)}`;
    const r = await createCharacter(db, accountId, { name: `Dev ${word}${suffix}`, people, look: DEV_LOOK });
    if (r.ok) return r.character;
    if (r.reason !== 'name_taken') throw new Error(`dev character not created: ${r.reason}`);
  }
  throw new Error('dev character not created: every name tried was taken');
}

function randomLetters(n: number): string {
  let s = String.fromCharCode(65 + randomInt(26));
  for (let i = 1; i < n; i++) s += String.fromCharCode(97 + randomInt(26));
  return s;
}
