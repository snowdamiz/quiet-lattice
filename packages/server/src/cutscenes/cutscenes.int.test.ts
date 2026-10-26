// Cutscenes over the wire, against the dockerised Postgres and Redis: two players at their home Waystation; one asks
// for the test cutscene (as the gateway will hand it the networked client's `cutscene` message) and is placed in a
// story phase there, whose tug only it sees in its snapshots while the other player sees the ordinary world and both
// players still see each other. When it ends, the phase closes and the tug leaves the player's snapshots.
import { encodeServerMessage, PROTOCOL_VERSION } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from '../../test/helpers.ts';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import type { RunningServer } from '../server.ts';
import { CutsceneService } from './service.ts';

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
  return { sock, client, errors, session, zone: server.zones.zone(welcome.zone.id)!, entityId: welcome.entityId, sees: (id: number) => client.latest.has(id) };
}

describe('cutscenes over the wire', () => {
  it('plays in a story phase whose actors only its player sees', async () => {
    const a = await player();
    const b = await player();
    expect(b.zone).toBe(a.zone);
    const cutscenes = new CutsceneService(server.zones);
    const play = cutscenes.handle(a.session, { t: 'cutscene', op: 'request', id: 'test' });
    expect(play).toMatchObject({ op: 'play', id: 'test' });
    // (what the gateway sends back is a valid server message)
    expect(() => encodeServerMessage(play)).not.toThrow();
    expect(a.zone.phases.phaseOf(a.entityId)).toBe(play.phase);
    const [tug] = a.zone.phases.phase(play.phase!)!.entities;
    expect(tug).toBeDefined();

    await waitFor(() => a.sees(tug!) && a.sees(b.entityId) && b.sees(a.entityId), 5000, 'the player to see its tug, and both players each other');
    expect(a.client.latest.get(tug!)).toMatchObject({ kind: 'ship', name: 'Waystation tug', hull: 'mule' });
    const tick = b.client.latestTick ?? 0;
    await waitFor(() => (b.client.latestTick ?? 0) >= tick + 10, 5000, 'ten more ticks');
    expect(b.client.snapshots.some((s) => s.entities.some((e) => e.id === tug))).toBe(false);

    expect(cutscenes.handle(a.session, { t: 'cutscene', op: 'done', id: 'test', skipped: false })).toMatchObject({ op: 'ended', phase: play.phase });
    expect(a.zone.phases.phase(play.phase!)).toBeUndefined();
    await waitFor(() => !a.sees(tug!), 5000, 'the tug to leave the player’s snapshots');
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    a.sock.close();
    b.sock.close();
    await Promise.all([a.sock.closed, b.sock.closed]);
  });
});
