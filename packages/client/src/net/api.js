// The gateway's HTTP side (docs/ARCHITECTURE.md §2, §5): accounts and characters. The client talks to the server on its own
// origin, as it will when the gateway serves it; in development Vite proxies /auth, /characters, /health and /ws to the
// game server (vite.config.js). Bodies are checked with the shared protocol's schemas both ways.
import { AuthResponse, CharacterList, CharacterSummary } from '@astra/shared/protocol';

/** The dev login's answer (server gateway/devLogin.ts): a session and the character it signs in as. */
const DevLoginResponse = AuthResponse.extend({ character: CharacterSummary });

/** A refused or failed request: `code` is the server's stable error code (or 'network', 'bad_response'); `retryAfter`
 * the seconds a rate-limited one says to wait (null when it says nothing). */
export class ApiError extends Error {
  constructor(status, code, message, retryAfter = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** The WebSocket the game runs over, on this page's origin. */
export function gameSocketUrl(loc = location) {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`;
}

async function call(method, path, { body, token, schema, fetchImpl = fetch } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetchImpl(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network', 'The server cannot be reached. Is it running?');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body, or not JSON (a proxy's error page) */
  }
  if (!res.ok) {
    const message = typeof data?.message === 'string' ? data.message : res.status >= 500 ? 'The server cannot be reached. Is it running?' : `Request failed (${res.status}).`;
    const retry = Number(res.headers?.get?.('retry-after'));
    throw new ApiError(res.status, typeof data?.error === 'string' ? data.error : 'http', message, retry > 0 ? retry : null);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError(res.status, 'bad_response', 'The server sent something this client does not understand. Reload the page.');
  return parsed.data;
}

export function register(credentials, opts) {
  return call('POST', '/auth/register', { body: credentials, schema: AuthResponse, ...opts });
}

export function login(credentials, opts) {
  return call('POST', '/auth/login', { body: credentials, schema: AuthResponse, ...opts });
}

export function listCharacters(token, opts) {
  return call('GET', '/characters', { token, schema: CharacterList, ...opts });
}

export function createCharacter(token, character, opts) {
  return call('POST', '/characters', { token, body: character, schema: CharacterSummary, ...opts });
}

/** Dev builds: the server's dev login (`POST /auth/dev {name, people?}`, ARCHITECTURE §16) signs in to the account
 * `dev-<name>` with no password and answers its session and character. A server without ASTRA_DEV_LOGIN answers 404. */
export function devLogin(request, opts) {
  return call('POST', '/auth/dev', { body: request, schema: DevLoginResponse, ...opts });
}
