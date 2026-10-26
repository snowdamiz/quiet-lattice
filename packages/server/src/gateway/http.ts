// HTTP gateway (docs/ARCHITECTURE.md §2): accounts, characters and health. Bodies are validated with the shared protocol
// schemas; errors reply `{ error, message }` where `error` is a stable code the client can switch on.
import { CharacterCreate, CharacterList, CharacterSummary, Credentials, PROTOCOL_VERSION, type AuthResponse } from '@astra/shared/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate, registerAccount } from '../accounts/accounts.ts';
import type { TokenService } from '../accounts/tokens.ts';
import { createCharacter, isUuid, listCharacters, MAX_CHARACTERS_PER_ACCOUNT } from '../characters/characters.ts';
import { checkCharacterName } from '../characters/names.ts';
import type { Db } from '../db/client.ts';
import { clientKey, type RateLimiter } from './rateLimit.ts';

export interface HealthReport {
  ok: boolean;
  db: 'ok' | 'down';
  redis: 'ok' | 'down';
  protocol: number;
  uptimeSeconds: number;
}

export interface HttpGatewayDeps {
  db: Db;
  tokens: TokenService;
  authLimiter: RateLimiter;
  /** See createTimingHash: verified against when a username does not exist. */
  timingHash: string;
  pingDb(): Promise<boolean>;
  pingRedis(): Promise<boolean>;
}

const LOGIN_FAILED = 'Wrong username or password.';

function fail(reply: FastifyReply, status: number, error: string, message: string): FastifyReply {
  return reply.code(status).send({ error, message });
}

export function registerHttpRoutes(app: FastifyInstance, deps: HttpGatewayDeps): void {
  const startedAt = Date.now();

  app.setErrorHandler((err: { statusCode?: number; message?: string }, req, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, 'request failed');
      return fail(reply, status, 'internal', 'Internal server error.');
    }
    return fail(reply, status, 'bad_request', err.message ?? 'Bad request.');
  });
  app.setNotFoundHandler((req, reply) => fail(reply, 404, 'not_found', `No route for ${req.method} ${req.url.split('?')[0]}.`));

  app.get('/health', async (_req, reply) => {
    const [db, redis] = await Promise.all([deps.pingDb(), deps.pingRedis()]);
    const report: HealthReport = {
      ok: db && redis,
      db: db ? 'ok' : 'down',
      redis: redis ? 'ok' : 'down',
      protocol: PROTOCOL_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
    return reply.code(report.ok ? 200 : 503).send(report);
  });

  // ---------- /auth: rate limited per client IP ----------
  app.register(
    async (auth) => {
      auth.addHook('onRequest', async (req, reply) => {
        const r = deps.authLimiter.take(clientKey(req.ip));
        if (!r.ok) {
          reply.header('retry-after', String(r.retryAfterSeconds));
          return fail(reply, 429, 'rate_limited', 'Too many attempts. Try again in a moment.');
        }
      });

      auth.post('/register', async (req, reply) => {
        const body = Credentials.safeParse(req.body);
        if (!body.success) return fail(reply, 400, 'invalid', 'Usernames are 3–24 letters, digits, - or _; passwords are 8–128 characters.');
        const r = await registerAccount(deps.db, body.data);
        if (!r.ok) return fail(reply, 409, 'username_taken', 'That username is taken.');
        const res: AuthResponse = { token: await deps.tokens.sign(r.accountId), accountId: r.accountId };
        req.log.info({ account: r.accountId }, 'account registered');
        return reply.code(201).send(res);
      });

      auth.post('/login', async (req, reply) => {
        const raw = req.body as { username?: unknown; password?: unknown } | null;
        if (typeof raw?.username !== 'string' || typeof raw.password !== 'string') return fail(reply, 400, 'invalid', 'Username and password are required.');
        // Anything the register schema would reject cannot be an account: same answer as a wrong password.
        const body = Credentials.safeParse(raw);
        const accountId = body.success ? await authenticate(deps.db, body.data, deps.timingHash) : null;
        if (!accountId) return fail(reply, 401, 'login_failed', LOGIN_FAILED);
        const res: AuthResponse = { token: await deps.tokens.sign(accountId), accountId };
        return reply.send(res);
      });
    },
    { prefix: '/auth' },
  );

  // ---------- /characters: Bearer session token ----------
  async function requireAccount(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
    const accountId = m ? await deps.tokens.verify(m[1]!) : null;
    if (!accountId || !isUuid(accountId)) {
      void fail(reply, 401, 'unauthorized', 'Sign in first.');
      return null;
    }
    return accountId;
  }

  app.get('/characters', async (req, reply) => {
    const accountId = await requireAccount(req, reply);
    if (!accountId) return reply;
    const list: CharacterList = { characters: await listCharacters(deps.db, accountId), max: MAX_CHARACTERS_PER_ACCOUNT };
    return reply.send(CharacterList.parse(list));
  });

  app.post('/characters', async (req, reply) => {
    const accountId = await requireAccount(req, reply);
    if (!accountId) return reply;
    const body = CharacterCreate.safeParse(req.body);
    if (!body.success) return fail(reply, 400, 'invalid', body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const name = checkCharacterName(body.data.name);
    if (!name.ok) return fail(reply, 400, 'invalid_name', name.reason);
    const r = await createCharacter(deps.db, accountId, body.data);
    if (r.ok) {
      req.log.info({ account: accountId, character: r.character.id, people: r.character.people }, 'character created');
      return reply.code(201).send(CharacterSummary.parse(r.character));
    }
    switch (r.reason) {
      case 'name_taken':
        return fail(reply, 409, 'name_taken', 'That name is taken.');
      case 'limit':
        return fail(reply, 409, 'character_limit', `An account holds at most ${MAX_CHARACTERS_PER_ACCOUNT} characters.`);
      case 'no_account':
        return fail(reply, 401, 'unauthorized', 'This account no longer exists. Sign in again.');
    }
  });
}
