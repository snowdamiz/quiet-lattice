// Builds and starts the server (docs/ARCHITECTURE.md §2): config → db → redis → world clock → gateway. index.ts boots it
// for `pnpm dev:server`; integration tests call startServer({ port: 0 }) and close() it.
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { createTimingHash } from './accounts/password.ts';
import { createTokenService } from './accounts/tokens.ts';
import { parseConfig, type Config, type Env } from './config.ts';
import { createDatabase } from './db/client.ts';
import { connectRedis } from './db/redis.ts';
import { registerHttpRoutes } from './gateway/http.ts';
import { RateLimiter } from './gateway/rateLimit.ts';
import { attachWsGateway, WS_PATH, type WsGateway } from './gateway/ws.ts';
import { createServerClock } from './world/clock.ts';

export interface StartOptions {
  /** 0 picks a free port. Defaults to PORT. */
  port?: number;
  host?: string;
  /** Overrides applied after the environment is parsed (tests use LOG_LEVEL 'silent', short timeouts…). */
  config?: Partial<Config>;
  /** Environment to parse; defaults to process.env. */
  env?: Env;
}

export interface RunningServer {
  config: Config;
  host: string;
  port: number;
  /** e.g. http://127.0.0.1:8787 */
  url: string;
  /** e.g. ws://127.0.0.1:8787/ws */
  wsUrl: string;
  app: FastifyInstance;
  ws: WsGateway;
  /** Closes sockets, the HTTP server, Postgres and Redis. Safe to call twice. */
  close(): Promise<void>;
}

function redact(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//***@');
}

export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const config: Config = parseConfig(opts.env ?? process.env, { ...opts.config, PORT: opts.port ?? opts.config?.PORT, HOST: opts.host ?? opts.config?.HOST });

  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 16 * 1024,
    // Node's default gives a client 60 s to finish its headers and checks only every 30 s; a stalled request (or
    // half-sent upgrade, which the per-IP socket cap cannot count yet) is dropped after HEADERS_TIMEOUT_MS instead.
    http: { headersTimeout: config.HEADERS_TIMEOUT_MS, connectionsCheckingInterval: Math.max(100, Math.min(1000, Math.floor(config.HEADERS_TIMEOUT_MS / 4))) },
  });
  const log = app.log;

  const database = createDatabase(config.DATABASE_URL);
  if (!(await database.ping(5000))) {
    await database.close();
    await app.close();
    throw new Error(`Postgres is not reachable at ${redact(config.DATABASE_URL)} (is \`pnpm db:up\` running?)`);
  }
  let redis;
  try {
    redis = await connectRedis(config.REDIS_URL, (err) => log.warn({ err: err.message }, 'redis connection error'));
  } catch (err) {
    await database.close();
    await app.close();
    throw new Error(`Redis is not reachable at ${redact(config.REDIS_URL)} (is \`pnpm db:up\` running?)`, { cause: err });
  }

  const clock = createServerClock();
  const tokens = createTokenService(config.JWT_SECRET);
  const authLimiter = new RateLimiter({ burst: config.AUTH_RATE_BURST, refillPerSecond: config.AUTH_RATE_PER_MINUTE / 60 });
  // Computed now, not on the first unknown-user login, so that login is not the one that pays for it.
  const timingHash = await createTimingHash();
  const ws = attachWsGateway(app.server, {
    db: database.db,
    tokens,
    clock,
    log,
    limits: {
      helloTimeoutMs: config.HELLO_TIMEOUT_MS,
      joinTimeoutMs: config.JOIN_TIMEOUT_MS,
      maxPerIp: config.WS_MAX_PER_IP,
      maxPerAccount: config.WS_MAX_PER_ACCOUNT,
    },
  });

  registerHttpRoutes(app, {
    db: database.db,
    tokens,
    authLimiter,
    timingHash,
    pingDb: () => database.ping(),
    pingRedis: () => redis.ping(),
  });

  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= (async () => {
      await ws.close();
      await app.close();
      await Promise.allSettled([database.close(), redis.close()]);
    })());

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    await close();
    throw err;
  }
  const { port, address } = app.server.address() as AddressInfo;
  const urlHost = address.includes(':') ? `[${address}]` : address;
  log.info({ port, db: redact(config.DATABASE_URL), redis: redact(config.REDIS_URL), tickHz: config.TICK_HZ }, 'astra server ready');

  return {
    config,
    host: address,
    port,
    url: `http://${urlHost}:${port}`,
    wsUrl: `ws://${urlHost}:${port}${WS_PATH}`,
    app,
    ws,
    close,
  };
}
