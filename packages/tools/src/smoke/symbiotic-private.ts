import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** No fallback to a developer database. The QA owner must claim both routes before invoking Playwright. */
export function symbioticRoutes(env: NodeJS.ProcessEnv) {
  const claim = env.SYMBIOTIC_QA_CLAIM;
  if (!claim || !/^[a-z0-9_]{12,32}$/.test(claim)) throw new Error('SYMBIOTIC_QA_CLAIM must name a fresh 12–32 character claim');
  const database = new URL(env.DATABASE_URL ?? 'invalid:');
  const redis = new URL(env.REDIS_URL ?? 'invalid:');
  const databaseName = `astra_symbiotic_smoke_${claim}`;
  if (
    database.protocol !== 'postgres:' ||
    database.hostname !== '127.0.0.1' ||
    database.port !== '53055' ||
    database.username !== 'astra' ||
    database.pathname !== `/${databaseName}` ||
    database.search ||
    database.hash
  )
    throw new Error(`DATABASE_URL must use the fresh ${databaseName} database at 127.0.0.1:53055 as astra`);
  if (redis.href !== 'redis://127.0.0.1:53058/8') throw new Error('REDIS_URL must be redis://127.0.0.1:53058/8');
  return { claimedDatabaseUrl: database.href, redisUrl: redis.href, databaseName, claim, marker: `qa:owner:${claim}` };
}

/** Actual SQL identity/emptiness and atomic Redis ownership check, before migration or application startup. */
export function verifySymbioticClaim(routes: ReturnType<typeof symbioticRoutes>): void {
  if (process.version !== 'v22.23.3') throw new Error('Private Symbiotic QA requires Node 22.23.3');
  const script = `
    import postgres from 'postgres';
    import Redis from 'ioredis';
    const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, idle_timeout: 1 });
    const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 0, retryStrategy: () => null });
    try {
      const [r] = await sql\`select current_database() as db, current_user as usr, inet_server_port() as port\`;
      if (r.db !== process.env.QA_DATABASE || r.usr !== 'astra' || r.port !== 5432) throw Error('SQL identity mismatch');
      const tables = await sql\`select tablename from pg_tables where schemaname = 'public'\`;
      if (tables.length) throw Error('Claimed database is not fresh');
      await redis.connect();
      const info = await redis.call('CLIENT', 'INFO');
      if (!/(?:^| )db=8(?: |$)/.test(info)) throw Error('Redis DB mismatch');
      const owned = await redis.eval("if redis.call('DBSIZE') == 1 and redis.call('GET', KEYS[1]) == ARGV[1] then return 1 else return 0 end", 1, process.env.QA_MARKER, process.env.QA_CLAIM);
      if (owned !== 1) throw Error('Redis8 is not exclusively freshly claimed');
    } finally { redis.disconnect(); await sql.end({ timeout: 2 }); }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../../../server/', import.meta.url)),
    env: {
      ...process.env,
      DATABASE_URL: routes.claimedDatabaseUrl,
      REDIS_URL: routes.redisUrl,
      QA_DATABASE: routes.databaseName,
      QA_MARKER: routes.marker,
      QA_CLAIM: routes.claim,
    },
    encoding: 'utf8',
    timeout: 15_000,
    killSignal: 'SIGKILL',
  });
  if (result.status !== 0) throw new Error(`Private fixture claim refused: ${result.error?.message ?? result.stderr}`);
}
