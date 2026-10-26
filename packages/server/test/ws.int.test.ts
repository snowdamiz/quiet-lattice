// WebSocket gateway against the dockerised Postgres and Redis: hello, join, welcome and every way to be refused.
import { PROTOCOL_VERSION, Welcome } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenService } from '../src/accounts/tokens.ts';
import { MESSAGE_LIMITS } from '../src/gateway/ws.ts';
import type { RunningServer } from '../src/server.ts';
import { CloseCode } from '../src/session/session.ts';
import { systemSeed } from '../src/world/home.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer({ HELLO_TIMEOUT_MS: 500 });
});

afterAll(async () => {
  await server?.close();
});

async function signedIn(token: string, on: RunningServer = server): Promise<TestSocket> {
  const s = await TestSocket.open(on.wsUrl);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  return s;
}

describe('WebSocket gateway', () => {
  it('answers hello + join with welcome at the home Waystation', async () => {
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token, { people: 'ulgani' });
    const s = await signedIn(acct.token);
    s.send({ t: 'join', characterId: character.id }); // sent without waiting: the server handles messages in order
    const welcome = Welcome.parse(await s.next('welcome'));
    expect(welcome).toMatchObject({
      accountId: acct.accountId,
      character,
      zone: { id: 'sys:2', systemSeed: systemSeed(2) },
      pose: { frame: `${systemSeed(2)}:station`, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
      mode: 'docked',
    });
    expect(welcome.serverTime).toBeGreaterThan(0);

    s.send({ t: 'ping', id: 7, clientTime: 123.5 });
    const pong = await s.next('pong');
    expect(pong).toMatchObject({ id: 7, clientTime: 123.5 });
    expect(pong.serverTime).toBeGreaterThanOrEqual(welcome.serverTime);
    s.close();
  });

  it('refuses a bad token and closes', async () => {
    const s = await signedIn('not-a-token');
    expect(await s.next('refused')).toMatchObject({ code: 'auth' });
    expect((await s.closed).code).toBe(CloseCode.refused);
  });

  it('refuses a token signed with another secret', async () => {
    const acct = await newAccount(server);
    const forged = await createTokenService('some-other-secret-entirely').sign(acct.accountId);
    const s = await signedIn(forged);
    expect(await s.next('refused')).toMatchObject({ code: 'auth' });
    await s.closed;
  });

  it('refuses another protocol version and tells the player to reload', async () => {
    const acct = await newAccount(server);
    const s = await TestSocket.open(server.wsUrl);
    s.send({ t: 'hello', version: PROTOCOL_VERSION + 1, token: acct.token });
    const refused = await s.next('refused');
    expect(refused.code).toBe('version');
    expect(refused.reason).toMatch(/reload/i);
    await s.closed;
  });

  it('refuses another version even when the rest of its hello does not parse', async () => {
    for (const hello of [
      { t: 'hello', version: PROTOCOL_VERSION + 1, token: '' },
      { t: 'hello', version: 0, token: 42, extra: true },
    ]) {
      const s = await TestSocket.open(server.wsUrl);
      s.send(hello);
      expect(await s.next('refused')).toMatchObject({ code: 'version' });
      await s.closed;
    }
  });

  it('refuses a first message that is not hello', async () => {
    const s = await TestSocket.open(server.wsUrl);
    s.send({ t: 'join', characterId: 'x' });
    expect(await s.next('refused')).toMatchObject({ code: 'invalid' });
    await s.closed;

    const garbage = await TestSocket.open(server.wsUrl);
    garbage.sendRaw('{not json');
    expect(await garbage.next('refused')).toMatchObject({ code: 'invalid' });
    await garbage.closed;
  });

  it('refuses a socket that sends no hello in time', async () => {
    const s = await TestSocket.open(server.wsUrl);
    const started = Date.now();
    expect(await s.next('refused', 3000)).toMatchObject({ code: 'auth' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    await s.closed;
  });

  it("refuses to join another account's character", async () => {
    const owner = await newAccount(server);
    const character = await newCharacter(server, owner.token);
    const thief = await newAccount(server);
    const s = await signedIn(thief.token);
    s.send({ t: 'join', characterId: character.id });
    expect(await s.next('refused')).toMatchObject({ code: 'character' });
    await s.closed;

    const s2 = await signedIn(thief.token);
    s2.send({ t: 'join', characterId: 'not-a-uuid' });
    expect(await s2.next('refused')).toMatchObject({ code: 'character' });
    await s2.closed;
  });

  it('drops and counts invalid messages after hello without closing', async () => {
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const before = server.ws.stats().invalidMessages;
    const s = await signedIn(acct.token);
    s.sendRaw('{not json');
    s.send({ t: 'nope' });
    s.send({ t: 'input', seq: -1 });
    s.sendRaw(Buffer.from([1, 2, 3]));
    s.send({ t: 'join', characterId: character.id });
    await s.next('welcome');
    s.send({ t: 'join', characterId: character.id }); // a second join is out of place
    s.send({ t: 'ping', id: 1, clientTime: 0 });
    await s.next('pong');
    expect(server.ws.stats().invalidMessages - before).toBe(5);
    const session = [...server.ws.registry.sessions].find((x) => x.characterId === character.id);
    expect(session?.invalidMessages).toBe(5);
    expect(s.received.filter((m) => m.t === 'refused')).toEqual([]);
    s.close();
  });

  it('kicks the older connection when a character enters the world twice', async () => {
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const first = await signedIn(acct.token);
    first.send({ t: 'join', characterId: character.id });
    await first.next('welcome');
    const second = await signedIn(acct.token);
    second.send({ t: 'join', characterId: character.id });
    await second.next('welcome');
    expect(await first.next('refused')).toMatchObject({ code: 'kicked' });
    await first.closed;
    second.close();
  });

  it('only upgrades on /ws', async () => {
    await expect(TestSocket.open(server.wsUrl.replace(/\/ws$/, '/elsewhere'))).rejects.toThrow(/404/);
  });

  it('closes open sessions with 1001 on shutdown', async () => {
    const own = await startTestServer();
    const acct = await newAccount(own);
    const s = await TestSocket.open(own.wsUrl);
    s.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
    await new Promise((r) => setTimeout(r, 50));
    await own.close();
    expect((await s.closed).code).toBe(CloseCode.goingAway);
  });
});

describe('connection limits', () => {
  let limited: RunningServer;
  beforeAll(async () => {
    limited = await startTestServer({ JOIN_TIMEOUT_MS: 400, WS_MAX_PER_IP: 3 });
  });
  afterAll(async () => {
    await limited?.close();
  });

  function sessionOf(on: RunningServer, accountId: string) {
    return [...on.ws.registry.sessions].find((x) => x.accountId === accountId);
  }

  it('closes a flooding socket that is not reading', async () => {
    const acct = await newAccount(server);
    const s = await signedIn(acct.token);
    await waitFor(() => server.ws.registry.countForAccount(acct.accountId) === 1, 5000, 'hello');
    const session = sessionOf(server, acct.accountId)!;
    const before = server.ws.stats().rateLimitedMessages;
    s.pause();
    for (let i = 0; i < 20_000; i++) s.send({ t: 'ping', id: i, clientTime: 1 });
    await waitFor(() => server.ws.registry.countForAccount(acct.accountId) === 0, 10_000, 'the server to drop the socket');
    expect(session.endReason).toBe('refused: invalid');
    expect(session.rateLimited).toBeGreaterThanOrEqual(MESSAGE_LIMITS.strikes);
    expect(server.ws.stats().rateLimitedMessages - before).toBe(session.rateLimited);
    s.resume();
    await s.closed;
  });

  it('closes a socket after too many invalid messages', async () => {
    const acct = await newAccount(server);
    const s = await signedIn(acct.token);
    await waitFor(() => server.ws.registry.countForAccount(acct.accountId) === 1, 5000, 'hello');
    for (let i = 0; i <= MESSAGE_LIMITS.maxInvalid; i++) s.send({ t: 'nope', i });
    const refused = await s.next('refused');
    expect(refused).toMatchObject({ code: 'invalid' });
    expect(refused.reason).toMatch(/invalid messages/);
    await s.closed;
  });

  it('refuses a signed-in socket that joins no character in time', async () => {
    const acct = await newAccount(limited);
    const started = Date.now();
    const s = await signedIn(acct.token, limited);
    expect(await s.next('refused', 3000)).toMatchObject({ code: 'character' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    await s.closed;
  });

  it('caps open sockets per account', async () => {
    const acct = await newAccount(server);
    const max = server.config.WS_MAX_PER_ACCOUNT;
    const open = [];
    for (let i = 0; i < max; i++) open.push(await signedIn(acct.token));
    await waitFor(() => server.ws.registry.countForAccount(acct.accountId) === max, 5000, 'every socket signed in');
    const extra = await signedIn(acct.token);
    expect(await extra.next('refused')).toMatchObject({ code: 'full' });
    await extra.closed;
    open.pop()!.close();
    await waitFor(() => server.ws.registry.countForAccount(acct.accountId) === max - 1, 5000, 'a socket to close');
    open.push(await signedIn(acct.token));
    await waitFor(() => server.ws.registry.countForAccount(acct.accountId) === max, 5000, 'the replacement to sign in');
    for (const s of open) s.close();
  });

  it('caps open sockets per IP', async () => {
    const max = limited.config.WS_MAX_PER_IP;
    const open = [];
    for (let i = 0; i < max; i++) open.push(await TestSocket.open(limited.wsUrl));
    await expect(TestSocket.open(limited.wsUrl)).rejects.toThrow(/429/);
    const first = open.shift()!;
    first.close();
    await first.closed;
    // The server frees the slot when its side of the TCP connection closes, a moment after the client's.
    let again: TestSocket | undefined;
    for (let i = 0; i < 40 && !again; i++) {
      again = await TestSocket.open(limited.wsUrl).catch(() => undefined);
      if (!again) await new Promise((r) => setTimeout(r, 25));
    }
    expect(again).toBeDefined();
    for (const s of [...open, again!]) s.close();
  });
});
