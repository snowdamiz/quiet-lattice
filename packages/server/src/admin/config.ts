// Developer tooling's configuration (P1.E03.T07, docs/ARCHITECTURE.md §16), read from the environment beside the server's
// own (config.ts) and validated with zod. Dev tools are unreachable in production (IMPLEMENTATION_PLAN 0.3): the dev login
// bypass refuses to start there at all, and the admin channel only with an explicit opt-in and a long secret.
//
//   ASTRA_DEV_LOGIN=1            POST /auth/dev issues a session for a dev account without a password (never in production)
//   ASTRA_ADMIN_SECRET=<16+>     opens the admin channel on 127.0.0.1, which the CLI calls with this secret
//   ASTRA_ADMIN_PORT=8788        its port (0 picks a free one)
//   ASTRA_ADMIN_IN_PRODUCTION=1  allows the admin channel in production (with a secret of 32+ characters)
//   ASTRA_METRICS_S=10           every zone's tick metrics are logged this often, s (0: never)
import { z } from 'zod';
import type { Config, Env } from '../config.ts';

export const DEFAULT_ADMIN_PORT = 8788;

const flag = z.union([
  z.boolean(),
  z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off']))
    .transform((s) => s === '1' || s === 'true' || s === 'yes' || s === 'on'),
]);

export const ToolingSchema = z.object({
  ASTRA_DEV_LOGIN: flag.default(false),
  ASTRA_ADMIN_SECRET: z.string().min(16, 'must be at least 16 characters').max(256).optional(),
  ASTRA_ADMIN_PORT: z.coerce.number().int().min(0).max(65535).default(DEFAULT_ADMIN_PORT),
  ASTRA_ADMIN_IN_PRODUCTION: flag.default(false),
  ASTRA_METRICS_S: z.coerce.number().min(0).max(3600).default(10),
});
export type ToolingInput = z.input<typeof ToolingSchema>;

export interface ToolingConfig {
  /** POST /auth/dev is served. */
  devLogin: boolean;
  /** The admin channel's port and secret, or null when it is off. */
  admin: { port: number; secret: string } | null;
  /** Zone metrics are logged this often, ms (0: never). */
  metricsMs: number;
}

/**
 * The tooling configuration for a server of `nodeEnv`: the environment's ASTRA_* variables, then `overrides` (typed
 * values, from tests). Throws one readable error when a dev tool is asked for where it is not allowed.
 */
export function parseTooling(env: Env, nodeEnv: Config['NODE_ENV'], overrides: Partial<ToolingInput> = {}): ToolingConfig {
  const cleaned: Record<string, unknown> = {};
  for (const k of Object.keys(ToolingSchema.shape)) {
    const v = env[k];
    if (v !== undefined && v !== '') cleaned[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) cleaned[k] = v;
  const r = ToolingSchema.safeParse(cleaned);
  const problems = r.success ? [] : r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  if (r.success) {
    const c = r.data;
    if (nodeEnv === 'production') {
      if (c.ASTRA_DEV_LOGIN) problems.push('  ASTRA_DEV_LOGIN: the dev login bypass is never allowed in production');
      if (c.ASTRA_ADMIN_SECRET !== undefined && !c.ASTRA_ADMIN_IN_PRODUCTION) {
        problems.push('  ASTRA_ADMIN_SECRET: the admin channel is refused in production unless ASTRA_ADMIN_IN_PRODUCTION=1');
      }
      if (c.ASTRA_ADMIN_IN_PRODUCTION && (c.ASTRA_ADMIN_SECRET?.length ?? 0) < 32) {
        problems.push('  ASTRA_ADMIN_SECRET: the admin channel in production needs a secret of at least 32 characters');
      }
    }
  }
  if (problems.length > 0 || !r.success) throw new Error(`invalid developer tooling configuration:\n${problems.join('\n')}`);
  const c = r.data;
  return {
    devLogin: c.ASTRA_DEV_LOGIN,
    admin: c.ASTRA_ADMIN_SECRET === undefined ? null : { port: c.ASTRA_ADMIN_PORT, secret: c.ASTRA_ADMIN_SECRET },
    metricsMs: Math.round(c.ASTRA_METRICS_S * 1000),
  };
}
