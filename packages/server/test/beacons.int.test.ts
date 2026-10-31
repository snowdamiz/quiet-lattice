// Call-for-aid beacons over the wire (P1.E15.T02), against the dockerised Postgres and Redis, with bot clients at their
// home Waystation: a player in an event with open slots raises a beacon, another watching the shard's list sees it and
// answers, and the instance holds (and shows) both; a player in another system is refused; an instance that filled
// refuses an answer before its beacon is taken down, and then the beacon comes down; answering a quest step's story
// beacon joins the caller's party and its phase, as a helper without the quest, who goes back to the shared world once it
// is kicked from the party.
import { PROTOCOL_VERSION, type BeaconOp, type PeopleId, type ServerMessage } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhaseLocation } from '../src/phases/manager.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
import type { Zone } from '../src/zones/zone.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

/** A bot in the world, docked at its home Waystation: signed in, joined, applying and acknowledging every snapshot. */
async function bot(people: PeopleId = 'thalune') {
  const { token } = await newAccount(server);
  const characterId = (await newCharacter(server, token, { people })).id;
  const sock = await TestSocket.open(server.wsUrl);
  const client = new SnapshotClient();
  sock.ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const snap = client.receive(new Uint8Array(data as Buffer));
    sock.send({ t: 'ack', tick: snap.tick });
  });
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  const session = [...server.ws.registry.sessions].find((s) => s.characterId === characterId && s.entityId === welcome.entityId)!;
  const zone = server.zones.zone(welcome.zone.id)!;
  const name = welcome.character.name;
  const b = {
    characterId,
    name,
    sock,
    session,
    zone,
    entityId: welcome.entityId,
    /** waits for (and takes) the first message that matches */
    async expect<M extends ServerMessage>(pred: (m: ServerMessage) => m is M, what: string): Promise<M> {
      await waitFor(() => sock.received.some(pred), 5000, `${name}: ${what}`);
      return sock.received.splice(sock.received.findIndex(pred), 1)[0] as M;
    },
    beacon: (op: BeaconOp) => sock.send({ t: 'beacon', op }),
    denied: (of: string, code: string) =>
      b.expect((m): m is Extract<ServerMessage, { t: 'denied' }> => m.t === 'denied' && m.of === of && m.code === code, `denied ${of} ${code}`),
    news: (op: string) => b.expect((m): m is Extract<ServerMessage, { t: 'beacon' }> => m.t === 'beacon' && m.op === op, `beacon ${op}`),
    listing: (pred: (m: Extract<ServerMessage, { t: 'beacons' }>) => boolean, what: string) =>
      b.expect((m): m is Extract<ServerMessage, { t: 'beacons' }> => m.t === 'beacons' && pred(m), `beacons ${what}`),
    party: (pred: (p: Extract<ServerMessage, { t: 'party' }>['party']) => boolean, what: string) =>
      b.expect((m): m is Extract<ServerMessage, { t: 'party' }> => m.t === 'party' && pred(m.party), `party ${what}`),
    sees: (id: number) => client.latest.has(id),
  };
  return b;
}

type Bot = Awaited<ReturnType<typeof bot>>;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/** A place at the home Waystation, where every bot docks: as an event, or a quest step, opens one. */
const at = (zone: Zone, key: string): PhaseLocation => ({ key: `${key}-${uid()}`, frame: zone.stationFrame, center: [0, 0, 0], radius: 300 });

async function close(...bots: Bot[]): Promise<void> {
  for (const b of bots) b.sock.close();
  await Promise.all(bots.map((b) => b.sock.closed));
}

describe('call-for-aid beacons over the wire', () => {
  it('lists a beacon raised in an event to a watcher, who answers it and joins: the instance holds, and shows, both', async () => {
    const [a, b, c] = await Promise.all([bot(), bot(), bot()]);
    const far = await bot('ixari');
    const { zone } = a;
    expect([b.zone, c.zone]).toEqual([zone, zone]);
    expect(far.zone).not.toBe(zone);
    await waitFor(() => c.sees(a.entityId) && c.sees(b.entityId), 5000, 'everyone at the dock in sight');
    // as the event system will place a player arriving at its site
    const wreck = at(zone, 'wreck');
    const event = zone.phases.phaseFor(a.session, 'event', wreck);

    b.beacon({ op: 'watch' });
    await b.listing((m) => m.reset === true, 'the whole list');
    a.beacon({ op: 'raise' });
    const { id } = await a.news('raised');
    const listed = (await b.listing((m) => m.beacons.some((x) => x.id === id), 'with the new beacon')).beacons.find((x) => x.id === id);
    expect(listed).toMatchObject({
      kind: 'event',
      system: homeSystemOf('thalune'),
      frame: zone.stationFrame,
      radius: 300,
      place: wreck.key,
      from: a.name,
      open: 11,
      cap: 12,
    });
    expect(listed!.until - listed!.at).toBe(600);

    // from another star system it cannot be answered: the player must get there
    far.beacon({ op: 'answer', id });
    await far.denied('answer', 'elsewhere');

    b.beacon({ op: 'answer', id });
    expect(await b.news('joined')).toEqual({ t: 'beacon', op: 'joined', id, phase: event.id });
    expect(await a.news('answered')).toEqual({ t: 'beacon', op: 'answered', id, name: b.name });
    expect([...event.members].sort()).toEqual([a.entityId, b.entityId].sort());
    await b.listing((m) => m.beacons.some((x) => x.id === id && x.open === 10), 'one slot fewer');
    // sealed in the event together: a and b see each other; c, at the same dock in the shared world, sees neither
    await waitFor(
      () => a.sees(b.entityId) && b.sees(a.entityId) && !c.sees(a.entityId) && !c.sees(b.entityId) && !a.sees(c.entityId),
      5000,
      'the instance to hold both',
    );
    expect(zone.phases.phaseOf(b.entityId)).toBe(event.id);

    a.beacon({ op: 'lower' });
    expect(await a.news('ended')).toEqual({ t: 'beacon', op: 'ended', id, why: 'lowered' });
    await b.listing((m) => m.gone.includes(id), 'without it');
    zone.phases.close(event.id);
    await close(a, b, c, far);
  });

  it('refuses an answer once the instance is full, then takes the beacon down', async () => {
    const [a, z, ...arrivals] = await Promise.all(Array.from({ length: 13 }, () => bot()));
    const { zone } = a!;
    const wreck = at(zone, 'convoy');
    const event = zone.phases.phaseFor(a!.session, 'event', wreck);
    z!.beacon({ op: 'watch' });
    a!.beacon({ op: 'raise' });
    const { id } = await a!.news('raised');
    await z!.listing((m) => m.beacons.some((x) => x.id === id && x.open === 11), 'the beacon');

    // the social service's timer held, so the beacon is not swept while eleven more arrive and fill the instance
    const social = server.ws.social;
    social.stop();
    try {
      for (const p of arrivals) expect(zone.phases.phaseFor(p.session, 'event', wreck)).toBe(event);
      expect(event.members.size).toBe(12);
      expect(social.beacons.of(a!.characterId)).toMatchObject({ id, open: 11 });
      z!.beacon({ op: 'answer', id });
      await z!.denied('answer', 'full');
      expect(zone.phases.phaseOf(z!.entityId)).toBeNull();
      expect(event.members.size).toBe(12);
    } finally {
      social.start();
    }
    // its next sweep takes the beacon down: the watcher hears it is gone, the caller why
    await z!.listing((m) => m.gone.includes(id), 'without the beacon');
    expect(await a!.news('ended')).toEqual({ t: 'beacon', op: 'ended', id, why: 'full' });
    z!.beacon({ op: 'answer', id });
    await z!.denied('answer', 'unknown');
    zone.phases.close(event.id);
    await close(a!, z!, ...arrivals);
  });

  it('joins a quest step’s story phase through its beacon, in the caller’s party, as a helper without the quest', async () => {
    const [a, b] = await Promise.all([bot(), bot()]);
    const { zone } = a;
    // as the quest runtime places a player in no party at an instanced step
    const step = at(zone, 'quest:wing_over_rolis_iii:aid');
    const chapter = zone.phases.phaseFor(a.session, 'story', step, null);
    a.beacon({ op: 'raise' });
    const raised = await a.news('raised');
    expect(raised.beacon).toMatchObject({ kind: 'story', quest: 'wing_over_rolis_iii', place: 'Wing over Rolis III', open: 5, cap: 6 });

    b.beacon({ op: 'answer', id: raised.id });
    expect(await b.news('joined')).toEqual({ t: 'beacon', op: 'joined', id: raised.id, phase: chapter.id });
    for (const x of [a, b]) {
      const { party } = await x.party((p) => p?.members.length === 2, 'of two');
      expect(party).toMatchObject({ leader: a.name, members: [{ name: a.name }, { name: b.name }] });
    }
    const id = server.ws.social.partyIdOf(a.characterId);
    expect(id).not.toBeNull();
    expect(server.ws.social.partyIdOf(b.characterId)).toBe(id);
    expect([...chapter.members].sort()).toEqual([a.entityId, b.entityId].sort());
    await waitFor(() => server.ws.social.beacons.of(a.characterId)?.open === 4, 5000, 'one party slot fewer');

    // kicked from the party, the helper goes back to the shared world, and the chapter is the caller's alone again
    a.sock.send({ t: 'party', op: { op: 'kick', name: b.name } });
    await waitFor(() => zone.phases.phaseOf(b.entityId) === null, 5000, 'the helper out of the chapter');
    expect([...chapter.members]).toEqual([a.entityId]);
    zone.phases.close(chapter.id);
    await close(a, b);
  });
});
