import { countOf } from '@astra/shared/inventory';
import { PROTOCOL_VERSION, type Pose } from '@astra/shared/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';
import { ManualClock } from './pilot.ts';

let server: RunningServer;
let database: Database;
const clock = new ManualClock();
const sockets = new Set<TestSocket>();
beforeAll(async () => {
  server = await startTestServer({}, { shard: uniqueShard(), clock: { monoNow: clock.now } });
  database = createDatabase(parseConfig(process.env).DATABASE_URL, { max: 2 });
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await server?.close();
  await database?.close();
});

async function connect(token: string, characterId: string) {
  const s = await TestSocket.open(server.wsUrl);
  sockets.add(s);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  s.send({ t: 'join', characterId });
  await waitFor(() => s.received.some((m) => m.t === 'welcome'), 5000, 'welcome');
  expect(s.received.findIndex((m) => m.t === 'world')).toBeLessThan(s.received.findIndex((m) => m.t === 'welcome'));
  return { s, welcome: await s.next('welcome') };
}

async function handled(s: TestSocket) {
  s.send({ t: 'ping', id: 17, clientTime: 0 });
  await s.next('pong');
}

const playerCount = () => server.zones.zones.reduce((n, z) => n + z.sessionCount, 0);

describe('handoff over the real gateway', () => {
  it('flies into deep space, keeps live skills after a respec, warps once for real fuel, and saves a deep-space rejoin', async () => {
    const account = await newAccount(server);
    const character = await newCharacter(server, account.token);
    const pose: Pose = { frame: null, pos: [6e9 - 1, 0, 0], quat: [0, -Math.SQRT1_2, 0, Math.SQRT1_2], vel: [100, 0, 0] };
    await database.db
      .update(characters)
      .set({ level: 16, state: { pose: { v: 2, data: { system: 0, pose, mode: 'ship' } } } })
      .where(eq(characters.id, character.id));
    const { s, welcome } = await connect(account.token, character.id);
    const session = server.ws.registry.holding(character.id)!;
    expect(server.ws.skills.unlock(character.id, 'throttle_tuning', { kind: 'dev' }).ok).toBe(true);
    s.send({ t: 'skills', seq: 1, op: { op: 'buy', node: 'throttle_tuning' } });
    await handled(s);
    expect(server.ws.skills.owned(character.id)).toContain('throttle_tuning');
    clock.advance(50);
    s.send({ t: 'input', zone: welcome.zone.id, seq: 1, time: welcome.serverTime + 0.05, mode: 'ship', pose: { ...pose, pos: [6e9 + 4, 0, 0] }, buttons: 0 });
    const deep = await s.next('zone');
    expect(deep).toMatchObject({ zone: { id: 'deep:0' }, reason: 'flight', seq: 1 });
    expect(server.zones.zoneOf(session)!.combat.profileOf(deep.entityId)?.skills).toContain('throttle_tuning');
    expect(playerCount()).toBe(1);
    expect(server.zones.zone(welcome.zone.id)!.entity(welcome.entityId)).toBeUndefined();

    // The skill service owns respec eligibility; a trainer fixture exposes its real paid respec here.
    server.ws.skills.hooks.trainerAtHand = () => true;
    s.send({ t: 'skills', seq: 2, op: { op: 'respec', nodes: ['throttle_tuning'] } });
    await handled(s);
    expect(server.ws.skills.owned(character.id)).toEqual([]);
    const source = server.zones.zoneOf(session)!;
    source.combat.applyDamage(null, deep.entityId, { base: 130, kind: 'attack' });
    const health = source.combat.playerHealth(deep.entityId);
    expect(health?.hull).toBe(70);
    s.send({ t: 'warp', seq: 1, system: 1 });
    const jumped = await s.next('zone');
    expect(jumped).toMatchObject({ zone: { id: 'sys:1' }, reason: 'warp', seq: 1 });
    const target = server.zones.zoneOf(session)!;
    expect(target.combat.profileOf(jumped.entityId)?.skills).toEqual([]);
    expect(target.combat.playerHealth(jumped.entityId)).toEqual(health);
    expect(playerCount()).toBe(1);
    expect(countOf(server.ws.inventory.get(character.id)!, 'warp_cell')).toBe(0);
    clock.advance(50);
    s.send({ t: 'input', zone: jumped.zone.id, seq: 2, time: welcome.serverTime + 0.1, mode: 'ship', pose: jumped.pose, buttons: 0 });
    await handled(s);
    expect(target.entity(jumped.entityId)?.input?.seq).toBe(2);
    s.send({ t: 'warp', seq: 1, system: 2 });
    expect(await s.next('warp')).toMatchObject({ reason: 'stale_seq' });
    s.send({ t: 'warp', seq: 2, system: 2 });
    expect(await s.next('warp')).toMatchObject({ reason: 'fuel' });
    expect(session.zoneId).toBe('sys:1');
    expect(s.received.filter((m) => m.t === 'correction' || m.t === 'refused')).toEqual([]);
    s.close();
    await s.closed;
    await waitFor(() => playerCount() === 0, 5000, 'last entity gone');

    // A separate character saved between stars is restored to the same nearest-system origin.
    const second = await newCharacter(server, account.token);
    await database.db
      .update(characters)
      .set({ state: { pose: { v: 2, data: { system: 0, pose: { ...pose, pos: [6e9 + 100, 0, 0] }, mode: 'ship' } } } })
      .where(eq(characters.id, second.id));
    const firstJoin = await connect(account.token, second.id);
    expect(firstJoin.welcome.zone.id).toBe('deep:0');
    firstJoin.s.close();
    await firstJoin.s.closed;
    await waitFor(() => playerCount() === 0, 5000, 'saved deep character left');
    const rejoined = await connect(account.token, second.id);
    expect(rejoined.welcome.zone.id).toBe('deep:0');
    expect(rejoined.welcome.pose.pos).toEqual(firstJoin.welcome.pose.pos);
    expect(playerCount()).toBe(1);
    rejoined.s.close();
  });
});
