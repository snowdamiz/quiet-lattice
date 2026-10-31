// The gateway's HTTP side as the client calls it (P1.E04.T01): bodies checked both ways, the server's error codes kept.
import { describe, expect, it } from 'vitest';
import { ApiError, createCharacter, devLogin, gameSocketUrl, listCharacters, login, register } from './api.js';

/** A fetch that answers with `status` and `body`, recording what it was asked. */
function server(status, body) {
  const calls = [];
  const fetchImpl = async (path, init) => {
    calls.push({ path, ...init, body: init.body && JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => (body === undefined ? Promise.reject(new Error('no body')) : body) };
  };
  return { calls, fetchImpl };
}

const CHARACTER = { id: 'c1', name: 'Tess Arlo', people: 'ixari', look: { palette: 0, pattern: 0, head: 0, suit: 0 }, level: 1, homeSystem: 59 };

describe('api', () => {
  it('signs up and in on the page origin, and hands back the session', async () => {
    const s = server(201, { token: 't'.repeat(40), accountId: 'a1' });
    expect(await register({ username: 'pilot', password: 'long enough' }, s)).toEqual({ token: 't'.repeat(40), accountId: 'a1' });
    await login({ username: 'pilot', password: 'long enough' }, s);
    expect(s.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/auth/register', { username: 'pilot', password: 'long enough' }],
      ['POST', '/auth/login', { username: 'pilot', password: 'long enough' }],
    ]);
  });

  it('lists and makes characters with the session token', async () => {
    const s = server(200, { characters: [CHARACTER], max: 6 });
    expect(await listCharacters('tok', s)).toEqual({ characters: [CHARACTER], max: 6 });
    expect(s.calls[0].headers.authorization).toBe('Bearer tok');
    const c = server(201, CHARACTER);
    expect(await createCharacter('tok', { name: 'Tess Arlo', people: 'ixari', look: CHARACTER.look }, c)).toEqual(CHARACTER);
    expect(c.calls[0]).toMatchObject({ method: 'POST', path: '/characters', body: { name: 'Tess Arlo', people: 'ixari' } });
  });

  it("keeps the server's error code and message", async () => {
    const err = await login({ username: 'pilot', password: 'wrong one' }, server(401, { error: 'login_failed', message: 'Wrong username or password.' })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.code, err.message]).toEqual([401, 'login_failed', 'Wrong username or password.']);
  });

  it('says so when the server cannot be reached, or answers what this client cannot read', async () => {
    const down = await listCharacters('tok', { fetchImpl: async () => Promise.reject(new TypeError('Failed to fetch')) }).catch((e) => e);
    expect([down.status, down.code]).toEqual([0, 'network']);
    const proxyError = await listCharacters('tok', server(502)).catch((e) => e);
    expect([proxyError.status, proxyError.code]).toEqual([502, 'http']);
    expect(proxyError.message).toMatch(/cannot be reached/);
    const odd = await listCharacters('tok', server(200, { characters: 'none' })).catch((e) => e);
    expect(odd.code).toBe('bad_response');
  });

  it("keeps a rate limit's wait from its Retry-After header", async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '12' }), json: async () => ({ error: 'rate_limited', message: 'Too many attempts. Try again in a moment.' }) });
    const err = await login({ username: 'pilot', password: 'long enough' }, { fetchImpl }).catch((e) => e);
    expect([err.code, err.retryAfter]).toEqual(['rate_limited', 12]);
    const plain = await login({ username: 'pilot', password: 'long enough' }, server(401, { error: 'login_failed', message: 'Wrong username or password.' })).catch((e) => e);
    expect(plain.retryAfter).toBeNull();
  });

  it('signs in through the dev login, which answers the character too', async () => {
    const s = server(200, { token: 't'.repeat(40), accountId: 'a1', character: CHARACTER, created: true });
    expect(await devLogin({ name: 'foot', people: 'ixari' }, s)).toEqual({ token: 't'.repeat(40), accountId: 'a1', character: CHARACTER });
    expect(s.calls[0]).toMatchObject({ method: 'POST', path: '/auth/dev', body: { name: 'foot', people: 'ixari' } });
    const off = await devLogin({ name: 'foot' }, server(404, { error: 'not_found', message: 'No route for POST /auth/dev.' })).catch((e) => e);
    expect([off.status, off.code]).toEqual([404, 'not_found']);
  });

  it('finds the game socket on the page origin', () => {
    expect(gameSocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
    expect(gameSocketUrl({ protocol: 'https:', host: 'play.example' })).toBe('wss://play.example/ws');
  });
});
