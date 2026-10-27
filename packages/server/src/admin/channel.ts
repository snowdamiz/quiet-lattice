// The admin channel (P1.E03.T07, docs/ARCHITECTURE.md §16): how the developer CLI reaches a running server. An HTTP
// listener of its own, bound to 127.0.0.1 only and apart from the game's port, taking one request, `POST /admin/command`
// with `{command}` (commands.ts) and `Authorization: Bearer <ASTRA_ADMIN_SECRET>`, answering `{ok, result}` or `{ok:
// false, error, message}`. Requests from anywhere but loopback, from a browser (an Origin header) or without the secret
// are refused and logged; every command is logged with who ran it (the CLI's `x-astra-operator`) by the admin service.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ADMIN_ERROR_STATUS, AdminCommand, AdminError, describeIssues, type AdminReply } from './commands.ts';
import type { AdminLog, AdminService } from './service.ts';

export const ADMIN_PATH = '/admin/command';
const MAX_BODY_BYTES = 16 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface AdminChannelOptions {
  admin: AdminService;
  secret: string;
  /** 0 picks a free port. */
  port: number;
  log?: AdminLog;
}

export interface AdminChannel {
  /** e.g. http://127.0.0.1:8788 */
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

export async function openAdminChannel(opts: AdminChannelOptions): Promise<AdminChannel> {
  const { admin, log } = opts;
  const secret = digest(opts.secret);
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log?.error({ err }, 'admin request failed');
      if (!res.headersSent) reply(res, 500, { ok: false, error: 'failed', message: 'Internal error.' });
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remote = req.socket.remoteAddress ?? 'unknown';
    if (!LOOPBACK.has(remote) || req.headers.origin !== undefined) {
      log?.warn({ remote, origin: req.headers.origin }, 'admin request refused: not a local tool');
      return reply(res, 403, { ok: false, error: 'refused', message: 'The admin channel takes requests from local tools only.' });
    }
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== ADMIN_PATH)
      return reply(res, 404, { ok: false, error: 'not_found', message: 'No such path.' });
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'usage', message: 'POST a command.' });
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!m || !timingSafeEqual(digest(m[1]!), secret)) {
      log?.warn({ remote }, 'admin request refused: wrong or missing secret');
      return reply(res, 401, { ok: false, error: 'refused', message: 'Wrong or missing admin secret (ASTRA_ADMIN_SECRET).' });
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return reply(res, 400, { ok: false, error: 'usage', message: err instanceof Error ? err.message : 'The body is not JSON.' });
    }
    const parsed = AdminCommand.safeParse((body as { command?: unknown } | null)?.command);
    if (!parsed.success) return reply(res, 400, { ok: false, error: 'usage', message: describeIssues(parsed.error) });
    const operator = String(req.headers['x-astra-operator'] ?? 'unknown')
      .replace(/[^\w@.:+-]/g, '')
      .slice(0, 64);
    try {
      const result = await admin.run(parsed.data, { name: operator || 'unknown', via: 'channel', remote });
      return reply(res, 200, { ok: true, result });
    } catch (err) {
      if (!(err instanceof AdminError)) throw err;
      return reply(res, ADMIN_ERROR_STATUS[err.code], { ok: false, error: err.code, message: err.message });
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  let closed: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      (closed ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      })),
  };
}

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

function reply(res: ServerResponse, status: number, body: AdminReply): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('The body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
