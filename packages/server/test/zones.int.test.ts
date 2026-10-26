// Zones over the wire, against the dockerised Postgres and Redis: players who join enter their home system's zone and
// receive binary snapshots every tick, which they apply onto their acknowledged baselines and acknowledge; they see each
// other, see each other move after `input`, and see each other go.
import { PROTOCOL_VERSION, type PeopleId } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf, systemSeed } from '../src/world/home.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

/** A player in the world: signed in, joined, applying and acknowledging every snapshot. */
async function player(people: PeopleId, existing?: { token: string; characterId: string }) {
  const acct = existing ? null : await newAccount(server);
  const token = existing?.token ?? acct!.token;
  const characterId = existing?.characterId ?? (await newCharacter(server, token, { people })).id;
  const sock = await TestSocket.open(server.wsUrl);
  const client = new SnapshotClient();
  const errors: unknown[] = [];
  sock.ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    try {
      const snap = client.receive(new Uint8Array(data as Buffer));
      sock.send({ t: 'ack', tick: snap.tick });
    } catch (err) {
      errors.push(err);
    }
  });
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  return { token, characterId, sock, client, welcome, errors, entityId: welcome.entityId };
}

describe('zones over the wire', () => {
  it('shows two players in one home zone to each other, moving after input, and gone after disconnect', async () => {
    const a = await player('thalune');
    const b = await player('thalune');
    const home = homeSystemOf('thalune');
    const station = `${systemSeed(home)}:station`;
    expect(a.welcome.zone).toEqual({ id: `sys:${home}`, systemSeed: systemSeed(home) });
    expect(b.welcome.zone).toEqual(a.welcome.zone);
    expect(a.welcome.pose).toEqual({ frame: station, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] });
    expect(a.entityId).not.toBe(b.entityId);

    await waitFor(() => a.client.latest.has(b.entityId) && b.client.latest.has(a.entityId), 5000, 'each to see the other');
    expect(b.client.latest.get(a.entityId)).toMatchObject({
      kind: 'player',
      name: a.welcome.character.name,
      people: 'thalune',
      level: 1,
      mode: 'docked',
      frame: station,
      pos: [0, 0, 0],
    });
    // each sees itself too
    expect(a.client.latest.get(a.entityId)).toMatchObject({ kind: 'player', name: a.welcome.character.name });

    a.sock.send({
      t: 'input',
      seq: 1,
      time: a.welcome.serverTime,
      mode: 'ship',
      pose: { frame: station, pos: [120, 5, -40], quat: [0, 0, 0.6, 0.8], vel: [10, 0, 0] },
      buttons: 1,
    });
    await waitFor(() => b.client.latest.get(a.entityId)?.pos?.[0] === 120, 5000, 'b to see a move');
    expect(b.client.latest.get(a.entityId)).toMatchObject({ pos: [120, 5, -40], quat: [0, 0, 0.6, 0.8], vel: [10, 0, 0], mode: 'ship' });
    // a's snapshots acknowledge the input it sent, for reconciliation
    await waitFor(() => a.client.snapshots.at(-1)?.ack === 1, 5000, 'the input ack');

    a.sock.send({
      t: 'input',
      seq: 2,
      time: a.welcome.serverTime,
      mode: 'ship',
      pose: { frame: station, pos: [130, 5, -40], quat: [0, 0, 0.6, 0.8], vel: [10, 0, 0] },
      buttons: 0,
    });
    await waitFor(() => b.client.latest.get(a.entityId)?.pos?.[0] === 130, 5000, 'b to see a move again');

    // acknowledgements work: after the first, snapshots are deltas against an acknowledged tick
    expect(b.client.snapshots[0]!.full).toBe(true);
    const deltas = b.client.snapshots.filter((s) => !s.full);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((s) => s.base! < s.tick)).toBe(true);
    // one snapshot per tick, in order
    const ticks = b.client.snapshots.map((s) => s.tick);
    expect(ticks).toEqual([...ticks].sort((x, y) => x - y));

    a.sock.close();
    await a.sock.closed;
    await waitFor(() => !b.client.latest.has(a.entityId), 5000, 'b to see a go');
    expect(b.client.snapshots.some((s) => s.removed.includes(a.entityId))).toBe(true);
    expect(server.zones.zone(`sys:${home}`)!.entity(a.entityId)).toBeUndefined();

    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    b.sock.close();
  });

  it('puts a player of another people in its own home system’s zone', async () => {
    const a = await player('thalune');
    const c = await player('ixari');
    const home = homeSystemOf('ixari');
    expect(home).not.toBe(homeSystemOf('thalune'));
    expect(c.welcome.zone).toEqual({ id: `sys:${home}`, systemSeed: systemSeed(home) });
    expect(a.welcome.zone.id).not.toBe(c.welcome.zone.id);
    await waitFor(() => c.client.latest.has(c.entityId) && a.client.latest.has(a.entityId), 5000, 'snapshots');
    const ixari = server.zones.zone(`sys:${home}`)!;
    expect(ixari.entity(c.entityId)?.fields.name).toBe(c.welcome.character.name);
    expect([...a.client.latest.values()].some((e) => e.name === c.welcome.character.name)).toBe(false);
    expect(server.zones.metrics().find((m) => m.id === `sys:${home}`)).toMatchObject({ sessions: 1, entities: 1, asleep: false });
    a.sock.close();
    c.sock.close();
    await Promise.all([a.sock.closed, c.sock.closed]);
    await waitFor(() => ixari.sessionCount === 0, 5000, 'the Ixari zone to empty');
  });

  it('takes a kicked connection’s entity out at once when its character enters again', async () => {
    const first = await player('thalune');
    const watcher = await player('thalune');
    await waitFor(() => watcher.client.latest.has(first.entityId), 5000, 'the watcher to see the first');
    const again = await player('thalune', { token: first.token, characterId: first.characterId });
    expect(await first.sock.next('refused')).toMatchObject({ code: 'kicked' });
    await waitFor(() => watcher.client.latest.has(again.entityId) && !watcher.client.latest.has(first.entityId), 5000, 'the swap');
    const zone = server.zones.zone(`sys:${homeSystemOf('thalune')}`)!;
    const named = [...zone.entityIds()].filter((id) => zone.entity(id)!.fields.name === again.welcome.character.name);
    expect(named).toEqual([again.entityId]);
    watcher.sock.close();
    again.sock.close();
  });

  it('drops and counts input in a frame outside the zone, and ack before join', async () => {
    const a = await player('thalune');
    const session = [...server.ws.registry.sessions].find((s) => s.characterId === a.characterId)!;
    const before = session.invalidMessages;
    a.sock.send({ t: 'input', seq: 1, time: 0, mode: 'ship', pose: { frame: '12345:0', pos: [1, 2, 3], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
    await waitFor(() => session.invalidMessages === before + 1, 5000, 'the input to be counted');
    expect(server.zones.zone(`sys:${homeSystemOf('thalune')}`)!.entity(a.entityId)!.fields.pos).toEqual([0, 0, 0]);
    a.sock.close();

    const acct = await newAccount(server);
    const s = await TestSocket.open(server.wsUrl);
    s.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
    s.send({ t: 'ack', tick: 1 });
    s.send({ t: 'ping', id: 1, clientTime: 0 });
    await s.next('pong');
    const pre = [...server.ws.registry.sessions].find((x) => x.accountId === acct.accountId)!;
    expect(pre.invalidMessages).toBe(1);
    s.close();
  });
});
