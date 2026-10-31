// Helpers for integration tests (*.int.test.ts): a real server on a free port against the dockerised Postgres and Redis,
// unique names per run (the database is disposable and never cleaned), a JSON HTTP client and a scripted socket.
import { randomBytes, randomInt } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { AuthResponse, CharacterSummary, decodeServerMessage, type CharacterCreate, type ClientMessage, type ServerMessage } from '@astra/shared/protocol';
import { WebSocket } from 'ws';
import { parseConfig, type Config } from '../src/config.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { startServer, type RunningServer, type StartOptions } from '../src/server.ts';

/** A server on a free port. `shard` runs a shard of its own (uniqueShard()) for tests that change the world or its clock;
 * `persistence` tunes character saving (a short interval); `tooling` turns developer tools on (the dev login, off unless
 * asked for here; the admin channel); `movement: false` lets players be put anywhere with raw poses. First finds are off
 * unless `discovery` is true (on a shard of the test's own): a first find on the shared shard pays its finder XP on a
 * database's first run and not on the next, which no other test's XP should depend on. */
export async function startTestServer(
  config: Partial<Config> = {},
  opts: Pick<StartOptions, 'shard' | 'persistence' | 'tooling' | 'movement' | 'discovery'> = {},
): Promise<RunningServer> {
  await runMigrations(parseConfig(process.env).DATABASE_URL);
  return startServer({
    port: 0,
    host: '127.0.0.1',
    config: { LOG_LEVEL: 'silent', AUTH_RATE_BURST: 1000, ...config },
    ...opts,
    discovery: opts.discovery ?? false,
    // (an admin channel, if the environment opens one, goes on a free port)
    tooling: { ASTRA_DEV_LOGIN: false, ASTRA_ADMIN_PORT: 0, ...opts.tooling },
  });
}

function letters(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(97 + randomInt(26));
  return s;
}

/** A username no earlier run has taken: 3–24 of [A-Za-z0-9_-]. */
export function uniqueUsername(prefix = 't'): string {
  return `${prefix}_${Date.now().toString(36)}${letters(6)}`.slice(0, 24);
}

/** A shard id no earlier run has taken. */
export function uniqueShard(): string {
  return `test_${Date.now().toString(36)}${letters(8)}`;
}

/** A character name no earlier run has taken: letters only, two words. */
export function uniqueCharacterName(): string {
  return `Tes ${letters(1).toUpperCase()}${letters(11)}`;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

export async function api<T = Record<string, unknown>>(
  server: RunningServer,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(server.url + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : undefined) as T };
}

export const DEFAULT_LOOK = { palette: 3, pattern: 1, head: 2, suit: 0 };

/** Registers a fresh account and returns its credentials and session. */
export async function newAccount(server: RunningServer) {
  const creds = { username: uniqueUsername(), password: `pw-${letters(12)}` };
  const res = await api(server, 'POST', '/auth/register', { body: creds });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...creds, ...AuthResponse.parse(res.body) };
}

export async function newCharacter(server: RunningServer, token: string, input: Partial<CharacterCreate> = {}) {
  const body = { name: uniqueCharacterName(), people: 'thalune', look: DEFAULT_LOOK, ...input };
  const res = await api(server, 'POST', '/characters', { body, token });
  if (res.status !== 201) throw new Error(`create character failed: ${res.status} ${JSON.stringify(res.body)}`);
  return CharacterSummary.parse(res.body);
}

/** A scripted client socket that records every server message in order. */
export class TestSocket {
  readonly received: ServerMessage[] = [];
  readonly undecodable: string[] = [];
  /** Socket errors after open (e.g. writes to a connection the server cut), kept so they never go unhandled. */
  readonly errors: Error[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: Array<() => void> = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = (data as Buffer).toString('utf8');
      const m = decodeServerMessage(text);
      if (m) this.received.push(m);
      else this.undecodable.push(text);
      for (const w of this.waiters.splice(0)) w();
    });
    ws.on('error', (err) => this.errors.push(err));
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') })));
    void this.closed.then(() => {
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static open(url: string): Promise<TestSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const s = new TestSocket(ws);
      ws.once('open', () => resolve(s));
      ws.once('error', reject);
    });
  }

  send(m: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(m));
  }

  sendRaw(data: string | Buffer): void {
    this.ws.send(data);
  }

  /** Resolves with the first received message of type `t` (past or future), or rejects after `timeoutMs`. */
  async next<K extends ServerMessage['t']>(t: K, timeoutMs = 5000): Promise<Extract<ServerMessage, { t: K }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.received.findIndex((m) => m.t === t);
      if (i >= 0) return this.received.splice(i, 1)[0] as Extract<ServerMessage, { t: K }>;
      const left = deadline - Date.now();
      if (left <= 0 || this.ws.readyState === WebSocket.CLOSED) {
        throw new Error(`no ${t} within ${timeoutMs} ms; got ${JSON.stringify(this.received)}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Stops reading from the socket (the server's sends pile up), as a client that has hung or is hostile would. */
  pause(): void {
    this.ws.pause();
  }

  resume(): void {
    this.ws.resume();
  }

  close(): void {
    this.ws.close();
  }
}

// ---------- raw sockets, for frames a WebSocket library will not send the way an attacker would ----------

/** A masked client → server WebSocket frame (payload under 64 KiB). */
export function clientFrame(opcode: number, payload: Buffer | string): Buffer {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const head = p.length < 126 ? Buffer.from([0x80 | opcode, 0x80 | p.length]) : Buffer.from([0x80 | opcode, 0x80 | 126, p.length >> 8, p.length & 0xff]);
  const mask = randomBytes(4);
  const body = Buffer.alloc(p.length);
  for (let i = 0; i < p.length; i++) body[i] = p[i]! ^ mask[i & 3]!;
  return Buffer.concat([head, mask, body]);
}

export const OPCODE = { text: 0x1, binary: 0x2, ping: 0x9, pong: 0xa } as const;

/** Opens a TCP connection and completes a WebSocket upgrade on it; resolves once the server answers 101. */
export function rawUpgrade(wsUrl: string): Promise<Socket> {
  const u = new URL(wsUrl);
  return new Promise((resolve, reject) => {
    const sock = connect(Number(u.port), u.hostname);
    sock.on('error', () => {}); // writes after the server cuts the connection fail; the test watches 'close'
    sock.once('connect', () =>
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      ),
    );
    let head = '';
    const onData = (d: Buffer) => {
      head += d.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      sock.off('data', onData);
      if (head.startsWith('HTTP/1.1 101')) resolve(sock);
      else reject(new Error(head.split('\r\n')[0]));
    };
    sock.on('data', onData);
  });
}

/** Writes `chunk` over and over for up to `ms`, waiting on the client's own drain so only the server buffers. Stops
 * when the socket closes. Resolves with the bytes written. */
export async function pump(sock: Socket, chunk: Buffer, ms: number): Promise<number> {
  const end = Date.now() + ms;
  let bytes = 0;
  while (Date.now() < end && !sock.destroyed && !sock.writableEnded) {
    const ok = sock.write(chunk);
    bytes += chunk.length;
    if (!ok) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 50);
        sock.once('drain', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
  return bytes;
}

/** Polls `cond` until it holds, or throws after `timeoutMs`. */
export async function waitFor(cond: () => boolean, timeoutMs = 5000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
