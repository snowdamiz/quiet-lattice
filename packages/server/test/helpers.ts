// Helpers for integration tests (*.int.test.ts): a real server on a free port against the dockerised Postgres and Redis,
// unique names per run (the database is disposable and never cleaned), a JSON HTTP client and a scripted socket.
import { randomInt } from 'node:crypto';
import { AuthResponse, CharacterSummary, decodeServerMessage, type CharacterCreate, type ClientMessage, type ServerMessage } from '@astra/shared/protocol';
import { WebSocket } from 'ws';
import { parseConfig, type Config } from '../src/config.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { startServer, type RunningServer } from '../src/server.ts';

export async function startTestServer(config: Partial<Config> = {}): Promise<RunningServer> {
  await runMigrations(parseConfig(process.env).DATABASE_URL);
  return startServer({ port: 0, host: '127.0.0.1', config: { LOG_LEVEL: 'silent', AUTH_RATE_BURST: 1000, ...config } });
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

  close(): void {
    this.ws.close();
  }
}
