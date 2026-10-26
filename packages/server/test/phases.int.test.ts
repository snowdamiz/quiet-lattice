// Phases over the wire, against the dockerised Postgres and Redis: players at one spot in their home Waystation, put in
// phases by the zone's phase manager (as the quest engine and the hangar will), see their own phase's actors and the
// shared world, never another phase's actors, and (in an event instance) not another instance's players; a party shares
// one phase; a phase whose last member disconnects closes and takes its actors with it.
import { PROTOCOL_VERSION, type PeopleId } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhaseLocation } from '../src/phases/manager.ts';
import type { RunningServer } from '../src/server.ts';
import type { EntityInit, Zone } from '../src/zones/zone.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

/** A player in the world: signed in, joined, applying and acknowledging every snapshot; its session and zone. */
async function player(people: PeopleId = 'thalune') {
  const { token } = await newAccount(server);
  const characterId = (await newCharacter(server, token, { people })).id;
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
  const session = [...server.ws.registry.sessions].find((s) => s.characterId === characterId)!;
  const zone = server.zones.zone(welcome.zone.id)!;
  /** whether it holds entity `id` now */
  const sees = (id: number) => client.latest.has(id);
  /** whether any state it applied after tick `after` held entity `id` */
  const heldAfter = (after: number, id: number) => [...client.states].some(([tick, state]) => tick > after && state.has(id));
  return { sock, client, errors, welcome, session, zone, entityId: welcome.entityId, sees, heldAfter };
}

type Player = Awaited<ReturnType<typeof player>>;

const npc = (zone: Zone, pos: [number, number, number], name: string): EntityInit => ({
  kind: 'npc',
  frame: zone.stationFrame,
  pos,
  quat: [0, 0, 0, 1],
  vel: [0, 0, 0],
  name,
});

/** The spot every player in these tests stands on: its home Waystation's dock. */
const spot = (zone: Zone, key: string): PhaseLocation => ({
  key: `${key}-${Date.now().toString(36)}`,
  frame: zone.stationFrame,
  center: [0, 0, 0],
  radius: 300,
});

/** Waits for `n` more ticks to reach every player. */
async function ticks(players: Player[], n: number): Promise<void> {
  const target = players[0]!.zone.tick + n;
  await waitFor(() => players.every((p) => (p.client.latestTick ?? 0) >= target), 5000, `${n} ticks`);
}

async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) p.sock.close();
  await Promise.all(players.map((p) => p.sock.closed));
  await waitFor(() => players.every((p) => p.zone.entity(p.entityId) === undefined), 5000, 'the players to leave the zone');
}

describe('phases over the wire', () => {
  it('keeps each phase’s actors from players in other phases at the same spot, who all still see the shared world', async () => {
    const a = await player();
    const b = await player();
    const { zone } = a;
    expect(b.zone).toBe(zone);
    const dockhand = zone.spawn(npc(zone, [4, 0, 0], 'Dockhand'));
    const site = spot(zone, 'site');
    const pa = zone.phases.phaseFor(a.session, 'story', site);
    const pb = zone.phases.phaseFor(b.session, 'story', site);
    expect(pa.id).not.toBe(pb.id);
    const actorA = zone.phases.spawn(pa.id, npc(zone, [8, 0, 0], 'Echo'));
    const actorB = zone.phases.spawn(pb.id, npc(zone, [8, 0, 1], 'Echo'));

    await waitFor(() => a.sees(actorA) && a.sees(dockhand) && b.sees(actorB) && b.sees(dockhand), 5000, 'each to see its actor and the dockhand');
    await ticks([a, b], 10);
    expect(a.sees(actorB) || a.heldAfter(0, actorB)).toBe(false);
    expect(b.sees(actorA) || b.heldAfter(0, actorA)).toBe(false);
    expect(a.client.snapshots.some((s) => s.entities.some((e) => e.id === actorB))).toBe(false);
    expect(b.client.snapshots.some((s) => s.entities.some((e) => e.id === actorA))).toBe(false);
    expect(b.client.latest.get(actorB)).toMatchObject({ kind: 'npc', name: 'Echo', pos: [8, 0, 1] });
    // a story phase's players stay in each other's sight; only the actors are private
    expect(a.sees(b.entityId) && b.sees(a.entityId)).toBe(true);

    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    zone.despawn(dockhand);
    await leaveAll([a, b]);
    expect(pa.open || pb.open).toBe(false);
    expect(zone.entity(actorA) ?? zone.entity(actorB)).toBeUndefined();
  });

  it('puts the 13th player at an event in a second instance, where it and the first twelve do not see each other at all', async () => {
    const players = await Promise.all(Array.from({ length: 13 }, () => player()));
    const { zone } = players[0]!;
    const first = players[0]!;
    const late = players[12]!;
    const dockhand = zone.spawn(npc(zone, [-4, 0, 0], 'Dockhand'));
    await waitFor(() => first.sees(late.entityId) && late.sees(first.entityId), 5000, 'everyone at the dock to see each other');

    const site = spot(zone, 'event');
    const placedAt = zone.tick;
    const instances = players.map((p) => zone.phases.phaseFor(p.session, 'event', site));
    const one = instances[0]!;
    const two = instances[12]!;
    expect(instances.slice(0, 12).every((p) => p === one)).toBe(true);
    expect(two).not.toBe(one);
    const wave = zone.phases.spawn(one.id, { ...npc(zone, [0, 0, 30], 'Raider'), kind: 'mob', mode: 'attack' });
    const otherWave = zone.phases.spawn(two.id, { ...npc(zone, [0, 0, 31], 'Raider'), kind: 'mob', mode: 'attack' });

    await waitFor(() => first.sees(wave) && late.sees(otherWave) && !first.sees(late.entityId) && !late.sees(first.entityId), 5000, 'the instances to part');
    await ticks(players, 10);
    // the first twelve see each other, their wave and the dockhand; the 13th sees itself, its wave and the dockhand
    for (const p of players.slice(0, 12)) {
      expect(p.sees(wave) && p.sees(dockhand)).toBe(true);
      expect(players.slice(0, 12).every((q) => p.sees(q.entityId))).toBe(true);
      expect(p.sees(late.entityId) || p.sees(otherWave) || p.heldAfter(placedAt, late.entityId)).toBe(false);
    }
    expect([...late.client.latest.keys()].sort((x, y) => x - y)).toEqual([late.entityId, dockhand, otherWave].sort((x, y) => x - y));
    expect(players.slice(0, 12).some((p) => late.heldAfter(placedAt, p.entityId))).toBe(false);
    expect(players.every((p) => p.errors.length === 0)).toBe(true);

    // the 13th disconnects: its instance closes and its wave goes with it; the first instance is untouched
    late.sock.close();
    await late.sock.closed;
    await waitFor(() => !two.open, 5000, 'the second instance to close');
    expect(zone.entity(otherWave)).toBeUndefined();
    expect(one.open && one.members.size === 12 && zone.entity(wave) !== undefined).toBe(true);

    zone.despawn(dockhand);
    await leaveAll(players.slice(0, 12));
    expect(one.open).toBe(false);
  });

  it('puts two party members in one phase, sharing its actors, and a third player in a phase of its own', async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    const { zone } = a;
    const party = `party-${Date.now().toString(36)}`;
    zone.setParty(a.entityId, party);
    zone.setParty(b.entityId, party);
    const site = spot(zone, 'chapter');
    const p = zone.phases.phaseFor(a.session, 'story', site);
    expect(zone.phases.phaseFor(b.session, 'story', site)).toBe(p);
    const q = zone.phases.phaseFor(c.session, 'story', site);
    expect(q).not.toBe(p);
    expect([...p.members].sort()).toEqual([a.entityId, b.entityId].sort());
    const boss = zone.phases.spawn(p.id, { ...npc(zone, [0, 20, 0], 'Overseer'), kind: 'mob', mode: 'idle' });

    await waitFor(() => a.sees(boss) && b.sees(boss), 5000, 'the party to see its boss');
    await ticks([a, b, c], 10);
    expect(c.sees(boss) || c.heldAfter(0, boss)).toBe(false);
    expect(b.client.latest.get(boss)).toMatchObject({ kind: 'mob', name: 'Overseer' });

    // one member leaving keeps the phase for the other
    a.sock.close();
    await a.sock.closed;
    await waitFor(() => p.members.size === 1, 5000, 'a to leave the phase');
    expect(p.open && b.sees(boss)).toBe(true);
    await leaveAll([b, c]);
    expect(p.open || q.open).toBe(false);
    expect(zone.entity(boss)).toBeUndefined();
    expect([a, b, c].every((x) => x.errors.length === 0)).toBe(true);
  });
});
