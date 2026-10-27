// Cutscenes over the wire, against the dockerised Postgres and Redis: two players at their home Waystation. One sends
// `cutscene {op: 'request'}` for the test cutscene (a dev cutscene; the test server runs in development) and is answered
// `play` with the story phase it is placed in, whose tug only it sees in its snapshots, while the other player sees the
// ordinary world and both still see each other. Asking again answers with the same phase; `done` takes it out, the
// phase closes and the tug leaves its snapshots; asking again at once is refused (the cooldown). A player whose socket
// closes mid-cutscene is forgotten and no longer watching; one whose phase the server closes is told `ended`.
import { PROTOCOL_VERSION } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from '../../test/helpers.ts';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import type { RunningServer } from '../server.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

/** A player joined and acknowledging every snapshot it applies. */
async function player() {
  const { token } = await newAccount(server);
  const characterId = (await newCharacter(server, token)).id;
  const sock = await TestSocket.open(server.wsUrl);
  const client = new SnapshotClient();
  const errors: unknown[] = [];
  sock.ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    try {
      sock.send({ t: 'ack', tick: client.receive(new Uint8Array(data as Buffer)).tick });
    } catch (err) {
      errors.push(err);
    }
  });
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  const session = [...server.ws.registry.sessions].find((s) => s.characterId === characterId && s.entityId === welcome.entityId)!;
  const zone = server.zones.zone(welcome.zone.id)!;
  // (one tick, so the zone knows where the player is)
  await waitFor(() => (client.latestTick ?? 0) > 0, 5000, 'a first snapshot');
  return { sock, client, errors, session, zone, entityId: welcome.entityId, sees: (id: number) => client.latest.has(id) };
}

describe('cutscenes over the wire', () => {
  it('plays in a story phase whose actors only its player sees, and ends when the client says it is done', async () => {
    const a = await player();
    const b = await player();
    expect(b.zone).toBe(a.zone);

    a.sock.send({ t: 'cutscene', op: 'request', id: 'test' });
    const play = await a.sock.next('cutscene');
    expect(play).toMatchObject({ t: 'cutscene', op: 'play', id: 'test' });
    expect(play.phase).toBeGreaterThan(0);
    expect(a.zone.phases.phaseOf(a.entityId)).toBe(play.phase);
    expect(server.cutscenes.watching(a.zone.id, a.entityId)).toBe(true);
    const [tug] = a.zone.phases.phase(play.phase!)!.entities;
    expect(tug).toBeDefined();

    await waitFor(() => a.sees(tug!) && a.sees(b.entityId) && b.sees(a.entityId), 5000, 'the player to see its tug, and both players each other');
    expect(a.client.latest.get(tug!)).toMatchObject({ kind: 'ship', name: 'Waystation tug', hull: 'mule' });
    const tick = b.client.latestTick ?? 0;
    await waitFor(() => (b.client.latestTick ?? 0) >= tick + 10, 5000, 'ten more ticks');
    expect(b.client.snapshots.some((s) => s.entities.some((e) => e.id === tug))).toBe(false);

    // asked again: the same phase
    a.sock.send({ t: 'cutscene', op: 'request', id: 'test' });
    expect(await a.sock.next('cutscene')).toEqual(play);

    a.sock.send({ t: 'cutscene', op: 'done', id: 'test', skipped: true });
    expect(await a.sock.next('cutscene')).toEqual({ t: 'cutscene', op: 'ended', id: 'test', phase: play.phase });
    expect(a.zone.phases.phase(play.phase!)).toBeUndefined();
    expect(server.cutscenes.watching(a.zone.id, a.entityId)).toBe(false);
    await waitFor(() => !a.sees(tug!), 5000, 'the tug to leave the player’s snapshots');

    // at once again: too soon
    a.sock.send({ t: 'cutscene', op: 'request', id: 'test' });
    expect(await a.sock.next('cutscene')).toMatchObject({ op: 'refused', reason: 'cooldown' });
    // an unknown one
    b.sock.send({ t: 'cutscene', op: 'request', id: 'nope' });
    expect(await b.sock.next('cutscene')).toMatchObject({ op: 'refused', reason: 'unknown' });

    // b starts it and its connection drops: forgotten, no longer watching
    b.sock.send({ t: 'cutscene', op: 'request', id: 'test' });
    expect((await b.sock.next('cutscene')).op).toBe('play');
    const bSession = b.session;
    b.sock.close();
    await b.sock.closed;
    await waitFor(() => server.cutscenes.playingOf(bSession) === null, 5000, 'the closed session to be forgotten');
    expect(server.cutscenes.watching(a.zone.id, b.entityId)).toBe(false);

    // c's phase goes from under it (the server closed it): the sweep ends it and tells c's client
    const c = await player();
    c.sock.send({ t: 'cutscene', op: 'request', id: 'test' });
    const cPlay = await c.sock.next('cutscene');
    expect(cPlay.op).toBe('play');
    c.zone.phases.close(cPlay.phase!);
    expect(server.cutscenes.watching(c.zone.id, c.entityId)).toBe(false);
    server.cutscenes.sweep();
    expect(await c.sock.next('cutscene')).toEqual({ t: 'cutscene', op: 'ended', id: 'test', phase: cPlay.phase });

    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(c.errors).toEqual([]);
    a.sock.close();
    c.sock.close();
    await Promise.all([a.sock.closed, c.sock.closed]);
  });
});
