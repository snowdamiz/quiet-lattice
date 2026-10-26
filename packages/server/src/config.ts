// Server configuration from the environment, validated with zod (docs/ARCHITECTURE.md §2). Every value has a default that
// matches .env.example, so `pnpm dev:server` and the tests run against the local docker infra with no .env at all.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const DEV_JWT_SECRET = 'dev-only-change-me';

const port = z.coerce.number().int().min(0).max(65535);
const positiveInt = z.coerce.number().int().positive();

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: port.default(8787),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL')
      .default('postgres://astra:astra@127.0.0.1:55432/astra'),
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, 'must be a redis:// URL')
      .default('redis://127.0.0.1:56379'),
    JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
    TICK_HZ: positiveInt.max(120).default(20),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** How long a new socket has to send a valid `hello` before it is refused. */
    HELLO_TIMEOUT_MS: positiveInt.default(5000),
    /** Token bucket per client IP on /auth/*: burst size and steady refill. */
    AUTH_RATE_BURST: positiveInt.default(10),
    AUTH_RATE_PER_MINUTE: positiveInt.default(20),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && (c.JWT_SECRET === DEV_JWT_SECRET || c.JWT_SECRET.length < 32)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'production needs a JWT_SECRET of at least 32 characters, not the dev default' });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
export type Env = Record<string, string | undefined>;

/** Parses the environment; throws one readable error listing every bad variable. Empty strings count as unset. */
export function parseConfig(env: Env): Config {
  const cleaned: Env = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== '') cleaned[k] = v;
  const r = ConfigSchema.safeParse(cleaned);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`invalid server configuration:\n${lines.join('\n')}`);
  }
  return r.data;
}

/** Loads the repository's .env (the one docker compose reads) into process.env, never overriding variables already set. */
export function loadDotEnv(): void {
  const file = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}
