// The game as players run it, for the online smoke specs: a scratch database on the docker Postgres (the shared `astra`
// database is only connected to, to create and later drop the scratch one), the server on a free port against it and the
// docker Redis (on a logical database of its own, so its world mirror never overwrites a dev server's), and a Vite dev
// server for the client whose proxies point at that server (ASTRA_SERVER, read by packages/client/vite.config.js).
// The server's admin channel (ARCHITECTURE §16) is open on a free loopback port with a secret made per run, for
// `admin(command)`. `pnpm db:up` must be running. stop() takes it all down and drops the scratch database.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SERVER_DIR = join(ROOT, 'packages/server');
const CLIENT_DIR = join(ROOT, 'packages/client');
/** The docker Postgres (`pnpm db:up`), as the server's own default reaches it. */
const ADMIN_URL = process.env.DATABASE_URL || 'postgres://astra:astra@127.0.0.1:55432/astra';
const REDIS_URL = `${(process.env.REDIS_URL || 'redis://127.0.0.1:56379').replace(/\/\d*$/, '')}/7`;
const SCRATCH = /^astra_smoke_[a-z0-9_]+$/;

export interface Online {
  /** The client, e.g. http://127.0.0.1:61234 */
  url: string;
  /** The game server, e.g. http://127.0.0.1:61235 */
  serverUrl: string;
  /** What the server has printed (warnings and errors), for a failure's report. */
  serverOutput(): string;
  /** With `stepped`: the server's clock. It runs on real time until `freeze`d, then moves only by `advance`, until `thaw`
   * lets it run on with real time from there. */
  clock?: { freeze(): Promise<void>; advance(ms: number): Promise<void>; thaw(): Promise<void> };
  /** Stops the server gracefully (it saves everyone in play), waits `downMs`, and starts it again on the same port and
   * database: a restart as players live through it. */
  restartServer(downMs?: number): Promise<void>;
  /** Runs one SQL statement against the scratch database (to stage a character's stored state before it enters). */
  sql(statement: string): void;
  /** Runs an admin command (`{cmd: 'teleport', …}`, the server's admin/commands.ts) over the server's admin channel. */
  admin(command: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string; message?: string }>;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** Runs one statement against the docker Postgres (the `astra` database, or `url`) with the server's own driver (resolved
 * from packages/server). */
function adminSql(statement: string, url = ADMIN_URL): void {
  const script = [
    "import postgres from 'postgres';",
    'const sql = postgres(process.env.ADMIN_URL, { max: 1, onnotice: () => {} });',
    'try { await sql.unsafe(process.env.STATEMENT); } finally { await sql.end({ timeout: 5 }); }',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: SERVER_DIR,
    env: { ...process.env, ADMIN_URL: url, STATEMENT: statement },
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });
  if (r.status !== 0) throw new Error(`${statement} failed (is \`pnpm db:up\` running?): ${r.stderr || r.stdout}`);
}

function databaseUrl(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

async function within<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${operation} timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function healthy(url: string, server: ChildProcess, output: () => string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the server exited (${server.exitCode}):\n${output()}`);
    try {
      if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the server did not become healthy within ${timeoutMs / 1000} s:\n${output()}`);
}

/** `stepped`: the server's clock is the spec's to step (packages/server/test/steppedServer.ts), for specs that judge timing. */
export async function startOnline(opts: { stepped?: boolean; claimedDatabaseUrl?: string; redisUrl?: string } = {}): Promise<Online> {
  const name = `astra_smoke_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  if (!SCRATCH.test(name)) throw new Error(`not a scratch database name: ${name}`);
  // An externally claimed database stays with its caller, including cleanup. Ordinary smoke still owns its scratch DB.
  if (!opts.claimedDatabaseUrl) adminSql(`CREATE DATABASE "${name}"`);
  const dbUrl = opts.claimedDatabaseUrl ?? databaseUrl(name);
  let server: ChildProcess | null = null;
  let vite: { close(): Promise<void> } | null = null;
  let out = '';
  const adminPort = await freePort();
  const adminSecret = randomBytes(16).toString('hex');
  // (with the dev login on, which the dev scenarios' `?dev` signs in through: P1.E04.T05)
  const env = {
    ...process.env,
    DATABASE_URL: dbUrl,
    REDIS_URL: opts.redisUrl ?? REDIS_URL,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
    NODE_ENV: 'development',
    ASTRA_DEV_LOGIN: '1',
    ASTRA_ADMIN_PORT: String(adminPort),
    ASTRA_ADMIN_SECRET: adminSecret,
  };
  let port = 0;
  let clockPort = 0;

  const launchServer = async () => {
    const s = spawn(process.execPath, ['--import', 'tsx', opts.stepped ? 'test/steppedServer.ts' : 'src/index.ts'], {
      cwd: SERVER_DIR,
      env: { ...env, PORT: String(port), STEPPED_CLOCK_PORT: String(clockPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server = s;
    s.stdout!.on('data', (d) => (out += d));
    s.stderr!.on('data', (d) => (out += d));
    await healthy(`http://127.0.0.1:${port}`, s, () => out);
  };
  const stopServer = async () => {
    const s = server;
    if (!s || s.exitCode !== null || s.signalCode !== null) return;
    const exited = new Promise((r) => s.once('exit', r));
    s.kill('SIGTERM');
    try {
      await within(exited, 10_000, 'server SIGTERM');
    } catch {
      s.kill('SIGKILL');
      await within(exited, 5000, 'server SIGKILL');
    }
  };
  const stop = async () => {
    const closed = await Promise.allSettled([within(vite?.close() ?? Promise.resolve(), 10_000, 'Vite close'), stopServer()]);
    for (const result of closed) if (result.status === 'rejected') throw result.reason;
    // (only ever the scratch database this run made)
    if (!opts.claimedDatabaseUrl && SCRATCH.test(name)) adminSql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  };

  try {
    const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], {
      cwd: SERVER_DIR,
      env,
      encoding: 'utf8',
      timeout: 60_000,
      killSignal: 'SIGKILL',
    });
    if (migrated.status !== 0) throw new Error(`db:migrate failed: ${migrated.stderr || migrated.stdout}`);

    port = await freePort();
    clockPort = opts.stepped ? await freePort() : 0;
    await launchServer();
    const serverUrl = `http://127.0.0.1:${port}`;

    process.env.ASTRA_SERVER = serverUrl;
    const { createServer: createVite, createLogger } = await import('vite');
    // the proxy's complaints while the server is down (the restart) or as a page goes are expected; any other error shows
    const logger = createLogger('error');
    const logError = logger.error.bind(logger);
    logger.error = (msg, opts) => {
      if (!/proxy (socket )?error/.test(msg)) logError(msg, opts);
    };
    const vitePort = await freePort();
    const v = await createVite({
      root: CLIENT_DIR,
      configFile: join(CLIENT_DIR, 'vite.config.js'),
      customLogger: logger,
      server: { port: vitePort, strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
    });
    await v.listen();
    vite = v;
    const restartServer = async (downMs = 1000) => {
      await stopServer();
      await new Promise((r) => setTimeout(r, downMs));
      await launchServer();
    };
    const admin = async (command: Record<string, unknown>) => {
      const res = await fetch(`http://127.0.0.1:${adminPort}/admin/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${adminSecret}`, 'x-astra-operator': 'smoke' },
        body: JSON.stringify({ command }),
        signal: AbortSignal.timeout(10_000),
      });
      return (await res.json()) as { ok: boolean; result?: unknown; error?: string; message?: string };
    };
    const control = async (path: string) => {
      const r = await fetch(`http://127.0.0.1:${clockPort}${path}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`the server's clock control answered ${r.status}`);
    };
    const clock = opts.stepped
      ? { freeze: () => control('/freeze'), advance: (ms: number) => control(`/advance?ms=${ms}`), thaw: () => control('/thaw') }
      : undefined;
    const sql = (statement: string) => adminSql(statement, dbUrl);
    return { url: `http://127.0.0.1:${vitePort}`, serverUrl, serverOutput: () => out, clock, restartServer, sql, admin, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
