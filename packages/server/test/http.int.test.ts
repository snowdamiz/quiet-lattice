// HTTP gateway against the dockerised Postgres and Redis: accounts, characters, health and the /auth rate limit.
import { AuthResponse, CharacterList, CharacterSummary, PROTOCOL_VERSION } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { api, DEFAULT_LOOK, newAccount, newCharacter, startTestServer, uniqueCharacterName, uniqueUsername } from './helpers.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

describe('health', () => {
  it('reports Postgres and Redis up', async () => {
    const res = await api(server, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: 'ok', redis: 'ok', protocol: PROTOCOL_VERSION });
    expect(res.body).not.toHaveProperty('sessions');
  });
});

describe('accounts', () => {
  it('registers, logs in, creates a character and lists it', async () => {
    const creds = { username: uniqueUsername('Pilot'), password: 'tide-takes-tide-returns' };
    const reg = await api(server, 'POST', '/auth/register', { body: creds });
    expect(reg.status).toBe(201);
    const registered = AuthResponse.parse(reg.body);

    // Usernames match without regard to case.
    const login = await api(server, 'POST', '/auth/login', { body: { ...creds, username: creds.username.toUpperCase() } });
    expect(login.status).toBe(200);
    const session = AuthResponse.parse(login.body);
    expect(session.accountId).toBe(registered.accountId);

    const name = uniqueCharacterName();
    const created = await api(server, 'POST', '/characters', { token: session.token, body: { name, people: 'ixari', look: DEFAULT_LOOK } });
    expect(created.status).toBe(201);
    const character = CharacterSummary.parse(created.body);
    expect(character).toMatchObject({ name, people: 'ixari', look: DEFAULT_LOOK, level: 1, homeSystem: 1 });

    const list = await api(server, 'GET', '/characters', { token: session.token });
    expect(list.status).toBe(200);
    expect(CharacterList.parse(list.body)).toEqual({ characters: [character], max: 6 });
  });

  it('rejects a bad password with 401, and an unknown user with the same answer', async () => {
    const acct = await newAccount(server);
    const wrong = await api(server, 'POST', '/auth/login', { body: { username: acct.username, password: 'not-the-password' } });
    expect(wrong.status).toBe(401);
    const unknown = await api(server, 'POST', '/auth/login', { body: { username: uniqueUsername('ghost'), password: 'not-the-password' } });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    const short = await api(server, 'POST', '/auth/login', { body: { username: acct.username, password: 'short' } });
    expect(short.status).toBe(401);
    expect(short.body).toEqual(wrong.body);
    expect(wrong.body).not.toHaveProperty('token');
  });

  it('refuses a taken username with 409, in any case', async () => {
    const acct = await newAccount(server);
    const again = await api(server, 'POST', '/auth/register', { body: { username: acct.username, password: 'another-password' } });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'username_taken' });
    const upper = await api(server, 'POST', '/auth/register', { body: { username: acct.username.toUpperCase(), password: 'another-password' } });
    expect(upper.status).toBe(409);
  });

  it('validates credentials with the shared schema', async () => {
    for (const body of [
      { username: 'ab', password: 'long-enough' },
      { username: 'bad name!', password: 'long-enough' },
      { username: uniqueUsername(), password: 'short' },
      {},
    ]) {
      const res = await api(server, 'POST', '/auth/register', { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await api(server, 'POST', '/auth/login', { body: { username: 1 } })).status).toBe(400);
  });
});

describe('characters', () => {
  it('needs a valid session token', async () => {
    expect((await api(server, 'GET', '/characters')).status).toBe(401);
    expect((await api(server, 'GET', '/characters', { token: 'nonsense' })).status).toBe(401);
    const body = { name: uniqueCharacterName(), people: 'thalune', look: DEFAULT_LOOK };
    expect((await api(server, 'POST', '/characters', { body, token: 'nonsense' })).status).toBe(401);
  });

  it('places each people in its home system', async () => {
    const acct = await newAccount(server);
    const homes = [];
    for (const people of ['thalune', 'ixari', 'ulgani'] as const) homes.push((await newCharacter(server, acct.token, { people })).homeSystem);
    expect(homes).toEqual([0, 1, 2]);
  });

  it('refuses a taken name with 409, across accounts and in any case', async () => {
    const a = await newAccount(server);
    const b = await newAccount(server);
    const first = await newCharacter(server, a.token);
    const res = await api(server, 'POST', '/characters', { token: b.token, body: { name: first.name.toUpperCase(), people: 'ulgani', look: DEFAULT_LOOK } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'name_taken' });
  });

  it('holds at most six characters per account', async () => {
    const acct = await newAccount(server);
    await Promise.all(Array.from({ length: 6 }, () => newCharacter(server, acct.token)));
    const seventh = await api(server, 'POST', '/characters', {
      token: acct.token,
      body: { name: uniqueCharacterName(), people: 'thalune', look: DEFAULT_LOOK },
    });
    expect(seventh.status).toBe(409);
    expect(seventh.body).toMatchObject({ error: 'character_limit' });
    const list = await api(server, 'GET', '/characters', { token: acct.token });
    expect(CharacterList.parse(list.body).characters).toHaveLength(6);
  });

  it('keeps the cap under concurrent creates', async () => {
    const acct = await newAccount(server);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api(server, 'POST', '/characters', { token: acct.token, body: { name: uniqueCharacterName(), people: 'ixari', look: DEFAULT_LOOK } }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(6);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  it('only lists the caller’s characters', async () => {
    const a = await newAccount(server);
    const b = await newAccount(server);
    await newCharacter(server, a.token);
    const list = await api(server, 'GET', '/characters', { token: b.token });
    expect(CharacterList.parse(list.body).characters).toEqual([]);
  });

  it('validates the body and the name rules', async () => {
    const acct = await newAccount(server);
    const bad = [
      { name: 'Kara9', people: 'thalune', look: DEFAULT_LOOK },
      { name: uniqueCharacterName(), people: 'human', look: DEFAULT_LOOK },
      { name: uniqueCharacterName(), people: 'thalune', look: { ...DEFAULT_LOOK, head: 99 } },
      { name: uniqueCharacterName(), people: 'thalune' },
    ];
    for (const body of bad) expect((await api(server, 'POST', '/characters', { token: acct.token, body })).status, JSON.stringify(body)).toBe(400);
    const reserved = await api(server, 'POST', '/characters', { token: acct.token, body: { name: 'GM Kara', people: 'thalune', look: DEFAULT_LOOK } });
    expect(reserved.status).toBe(400);
    expect(reserved.body).toMatchObject({ error: 'invalid_name' });
  });
});

describe('/auth rate limit', () => {
  let limited: RunningServer;
  beforeAll(async () => {
    limited = await startTestServer({ AUTH_RATE_BURST: 3, AUTH_RATE_PER_MINUTE: 1 });
  });
  afterAll(async () => {
    await limited?.close();
  });

  it('answers 429 with Retry-After once a client IP spends its burst', async () => {
    const body = { username: uniqueUsername('rl'), password: 'whatever-password' };
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await api(limited, 'POST', '/auth/login', { body })).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
    const last = await api(limited, 'POST', '/auth/register', { body });
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    // Only /auth is limited.
    expect((await api(limited, 'GET', '/health')).status).toBe(200);
  });
});
