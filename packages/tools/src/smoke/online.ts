// The game as players run it, for the online smoke specs: a scratch database on the docker Postgres (the shared `astra`
// database is only connected to, to create and later drop the scratch one), the server on a free port against it and the
// docker Redis (on a logical database of its own, so its world mirror never overwrites a dev server's), and a Vite dev
// server for the client whose proxies point at that server (ASTRA_SERVER, read by packages/client/vite.config.js).
// `pnpm db:up` must be running. stop() takes it all down and drops the scratch database.
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

/** Runs one statement against the docker Postgres with the server's own driver (resolved from packages/server). */
function adminSql(statement: string): void {
  const script = [
    "import postgres from 'postgres';",
    'const sql = postgres(process.env.ADMIN_URL, { max: 1, onnotice: () => {} });',
    'try { await sql.unsafe(process.env.STATEMENT); } finally { await sql.end({ timeout: 5 }); }',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: SERVER_DIR,
    env: { ...process.env, ADMIN_URL, STATEMENT: statement },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`${statement} failed (is \`pnpm db:up\` running?): ${r.stderr || r.stdout}`);
}

function databaseUrl(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

async function healthy(url: string, server: ChildProcess, output: () => string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the server exited (${server.exitCode}):\n${output()}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the server did not become healthy within ${timeoutMs / 1000} s:\n${output()}`);
}

export async function startOnline(): Promise<Online> {
  const name = `astra_smoke_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  if (!SCRATCH.test(name)) throw new Error(`not a scratch database name: ${name}`);
  adminSql(`CREATE DATABASE "${name}"`);
  const dbUrl = databaseUrl(name);
  let server: ChildProcess | null = null;
  let vite: { close(): Promise<void> } | null = null;
  let out = '';

  const stop = async () => {
    await vite?.close();
    if (server && server.exitCode === null) {
      const exited = new Promise((r) => server!.once('exit', r));
      server.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    // (only ever the scratch database this run made)
    if (SCRATCH.test(name)) adminSql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  };

  try {
    const env = { ...process.env, DATABASE_URL: dbUrl, REDIS_URL, HOST: '127.0.0.1', LOG_LEVEL: 'warn', NODE_ENV: 'development' };
    const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], { cwd: SERVER_DIR, env, encoding: 'utf8' });
    if (migrated.status !== 0) throw new Error(`db:migrate failed: ${migrated.stderr || migrated.stdout}`);

    const port = await freePort();
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: SERVER_DIR,
      env: { ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout!.on('data', (d) => (out += d));
    server.stderr!.on('data', (d) => (out += d));
    const serverUrl = `http://127.0.0.1:${port}`;
    await healthy(serverUrl, server, () => out);

    process.env.ASTRA_SERVER = serverUrl;
    const { createServer: createVite } = await import('vite');
    const vitePort = await freePort();
    const v = await createVite({
      root: CLIENT_DIR,
      configFile: join(CLIENT_DIR, 'vite.config.js'),
      logLevel: 'error',
      server: { port: vitePort, strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
    });
    await v.listen();
    vite = v;
    return { url: `http://127.0.0.1:${vitePort}`, serverUrl, serverOutput: () => out, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
