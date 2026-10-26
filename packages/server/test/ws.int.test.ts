// WebSocket gateway against the dockerised Postgres and Redis: hello, join, welcome and every way to be refused.
import { PROTOCOL_VERSION, Welcome } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenService } from '../src/accounts/tokens.ts';
import type { RunningServer } from '../src/server.ts';
import { CloseCode } from '../src/session/session.ts';
import { systemSeed } from '../src/world/home.ts';
import { newAccount, newCharacter, startTestServer, TestSocket } from './helpers.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer({ HELLO_TIMEOUT_MS: 500 });
});

afterAll(async () => {
  await server?.close();
});

async function signedIn(token: string): Promise<TestSocket> {
  const s = await TestSocket.open(server.wsUrl);
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
