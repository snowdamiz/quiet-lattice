// Chat and parties over the wire, against the dockerised Postgres and Redis, with bot clients: shard chat reaches
// everyone, system chat the sender's star system only, party chat the party across systems; a party forms by invite
// and accept and runs promote, kick and leave; a leader who stays disconnected past the grace hands the lead on, and a
// member who reconnects within it keeps its place; party members placed at one place share a story phase and see each
// other anywhere in their zone; and a chat flood is refused, then muted, without costing the socket.
import { PROTOCOL_VERSION, type PeopleId, type ServerMessage } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhaseLocation } from '../src/phases/manager.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

/** A bot in the world: signed in, joined, applying and acknowledging every snapshot. */
async function bot(people: PeopleId = 'thalune', existing?: { token: string; characterId: string }) {
  const token = existing?.token ?? (await newAccount(server)).token;
  const characterId = existing?.characterId ?? (await newCharacter(server, token, { people })).id;
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
  let pings = 0;
  const b = {
    token,
    characterId,
    name,
    sock,
    client,
    session,
    zone,
    entityId: welcome.entityId,
    /** waits for (and takes) the first message that matches */
    async expect(pred: (m: ServerMessage) => boolean, what: string): Promise<ServerMessage> {
      await waitFor(() => sock.received.some(pred), 5000, `${name}: ${what}`);
      return sock.received.splice(sock.received.findIndex(pred), 1)[0]!;
    },
    /** a round trip: whatever the server sent before it has arrived */
    async settle(): Promise<void> {
      const id = ++pings;
      sock.send({ t: 'ping', id, clientTime: 0 });
      await b.expect((m) => m.t === 'pong' && m.id === id, 'pong');
    },
    chatsHeard: (text: string) => sock.received.filter((m) => m.t === 'event' && m.event.kind === 'chat' && m.event.text === text),
    /** the latest party state it holds, waiting for one that satisfies `pred` */
    async party(pred: (p: Extract<ServerMessage, { t: 'party' }>['party']) => boolean, what: string) {
      await waitFor(() => latestParty(sock.received) !== undefined && pred(latestParty(sock.received)!.party), 5000, `${name}: party ${what}`);
      return latestParty(sock.received)!.party;
    },
    news: (what: string, about?: string) =>
      b.expect((m) => m.t === 'event' && m.event.kind === 'party' && m.event.what === what && m.event.name === about, `party news ${what} ${about ?? ''}`),
    denied: (of: string, code: string) => b.expect((m) => m.t === 'denied' && m.of === of && m.code === code, `denied ${of} ${code}`),
    sees: (id: number) => client.latest.has(id),
    tag: () => server.zones.zoneOf(b.session)?.entity(b.entityId)?.party,
  };
  await b.party(() => true, 'state after welcome');
  return b;
}

type Bot = Awaited<ReturnType<typeof bot>>;

function latestParty(ms: ServerMessage[]) {
  return ms.findLast((m): m is Extract<ServerMessage, { t: 'party' }> => m.t === 'party');
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const names = (p: Extract<ServerMessage, { t: 'party' }>['party']) => p?.members.map((m) => m.name) ?? [];

async function close(...bots: Bot[]): Promise<void> {
  for (const b of bots) b.sock.close();
  await Promise.all(bots.map((b) => b.sock.closed));
}

/** a invites b and b accepts (by names as typed: any case). */
async function join(leader: Bot, b: Bot): Promise<void> {
  leader.sock.send({ t: 'party', op: { op: 'invite', name: b.name.toLowerCase() } });
  await b.news('invite', leader.name);
  b.sock.send({ t: 'party', op: { op: 'accept', name: leader.name.toUpperCase() } });
  await b.party((p) => names(p).includes(b.name), 'joined');
}

describe('chat and parties over the wire', () => {
  it('relays shard chat to everyone, system chat to the sender’s system only, and refuses party chat outside a party', async () => {
    const a = await bot('thalune');
    const b = await bot('thalune');
    const c = await bot('ixari');
    expect(a.zone).toBe(b.zone);
    expect(c.zone).not.toBe(a.zone);

    const shard = `shard ${uid()}`;
    a.sock.send({ t: 'chat', channel: 'shard', text: shard });
    for (const x of [a, b, c]) {
      expect(await x.expect((m) => m.t === 'event' && m.event.kind === 'chat' && m.event.text === shard, 'shard line')).toMatchObject({
        event: { channel: 'shard', from: a.name },
      });
    }

    const near = `system ${uid()}`;
    a.sock.send({ t: 'chat', channel: 'system', text: `  ${near}  ` });
    for (const x of [a, b]) await x.expect((m) => m.t === 'event' && m.event.kind === 'chat' && m.event.text === near, 'system line');
    await c.settle();
    expect(c.chatsHeard(near)).toEqual([]);

    const far = `elsewhere ${uid()}`;
    c.sock.send({ t: 'chat', channel: 'system', text: far });
    await c.expect((m) => m.t === 'event' && m.event.kind === 'chat' && m.event.text === far, 'own system line');
    await Promise.all([a.settle(), b.settle()]);
    expect([...a.chatsHeard(far), ...b.chatsHeard(far)]).toEqual([]);

    a.sock.send({ t: 'chat', channel: 'party', text: 'anyone?' });
    expect(await a.denied('chat', 'no_party')).toEqual({ t: 'denied', of: 'chat', code: 'no_party' });
    await b.settle();
    expect(b.sock.received.some((m) => m.t === 'denied')).toBe(false);
    await close(a, b, c);
  });

  it('forms a party by invite and accept, chats across systems, and runs promote, kick and leave', async () => {
    const a = await bot('thalune');
    const b = await bot('thalune');
    const c = await bot('ixari');

    a.sock.send({ t: 'party', op: { op: 'invite', name: 'Nobody Here' } });
    expect(await a.denied('invite', 'not_found')).toMatchObject({ name: 'Nobody Here' });

    await join(a, b);
    await a.news('invited', b.name);
    const two = await a.party((p) => names(p).length === 2, 'of two');
    expect(two).toEqual({
      leader: a.name,
      members: [
        { name: a.name, online: true, system: homeSystemOf('thalune'), health: 10 },
        { name: b.name, online: true, system: homeSystemOf('thalune'), health: 10 },
      ],
    });
    const id = server.ws.social.partyIdOf(a.characterId);
    expect(id).not.toBeNull();
    expect([a.tag(), b.tag()]).toEqual([id, id]);

    await join(a, c);
    expect((await a.party((p) => names(p).length === 3, 'of three'))!.members[2]).toEqual({
      name: c.name,
      online: true,
      system: homeSystemOf('ixari'),
      health: 10,
    });
    expect(c.tag()).toBe(id);

    const line = `party ${uid()}`;
    c.sock.send({ t: 'chat', channel: 'party', text: line });
    for (const x of [a, b, c])
      await x.expect((m) => m.t === 'event' && m.event.kind === 'chat' && m.event.channel === 'party' && m.event.text === line, 'party line');

    b.sock.send({ t: 'party', op: { op: 'promote', name: b.name } });
    await b.denied('promote', 'not_leader');
    a.sock.send({ t: 'party', op: { op: 'promote', name: b.name } });
    for (const x of [a, b, c]) {
      await x.news('leader', b.name);
      await x.party((p) => p?.leader === b.name, 'led by b');
    }

    b.sock.send({ t: 'party', op: { op: 'kick', name: c.name } });
    await c.news('kicked', c.name);
    expect(await c.party((p) => p === null, 'none')).toBeNull();
    expect(c.tag()).toBeNull();
    for (const x of [a, b]) {
      await x.news('kicked', c.name);
      expect(names(await x.party((p) => names(p).length === 2, 'without c'))).toEqual([a.name, b.name]);
    }

    a.sock.send({ t: 'party', op: { op: 'leave' } });
    await a.news('left', a.name);
    await b.news('disbanded');
    for (const x of [a, b]) expect(await x.party((p) => p === null, 'none')).toBeNull();
    expect([a.tag(), b.tag(), server.ws.social.partyIdOf(a.characterId)]).toEqual([null, null, null]);
    await close(a, b, c);
  });

  it('hands the lead on when the leader stays disconnected past the grace', async () => {
    const { limits } = server.ws.social;
    const grace = limits.graceMs;
    limits.graceMs = 600;
    try {
      const a = await bot();
      const b = await bot();
      const c = await bot();
      await join(a, b);
      await join(a, c);
      await close(a);
      const away = await b.party((p) => p?.members[0]?.online === false, 'a offline');
      expect(away).toMatchObject({
        leader: a.name,
        members: [{ name: a.name, online: false, system: null, health: null }, { online: true }, { online: true }],
      });
      for (const x of [b, c]) {
        await x.news('left', a.name);
        await x.news('leader', b.name);
        expect(await x.party((p) => p?.leader === b.name && names(p).length === 2, 'led by b')).toMatchObject({
          members: [{ name: b.name }, { name: c.name }],
        });
      }
      await close(b, c);
    } finally {
      limits.graceMs = grace;
    }
  });

  it('keeps a member who reconnects within the grace in its party, tagged again', async () => {
    const a = await bot();
    const b = await bot();
    await join(a, b);
    const id = server.ws.social.partyIdOf(a.characterId);
    await close(b);
    await a.party((p) => p?.members[1]?.online === false, 'b offline');

    const back = await bot('thalune', b);
    expect(latestParty(back.sock.received)?.party).toMatchObject({ leader: a.name, members: [{ name: a.name }, { name: b.name, online: true }] });
    await a.party((p) => p?.members[1]?.online === true, 'b back');
    expect(back.tag()).toBe(id);
    expect(server.ws.social.partyIdOf(b.characterId)).toBe(id);
    await close(a, back);
  });

  it('places party members at one place in one story phase, and lets them see each other anywhere in their zone', async () => {
    const a = await bot();
    const b = await bot();
    const c = await bot();
    await join(a, b);
    const { zone } = a;
    const site: PhaseLocation = { key: `chapter-${uid()}`, frame: zone.stationFrame, center: [0, 0, 0], radius: 300 };
    const p = zone.phases.phaseFor(a.session, 'story', site);
    expect(zone.phases.phaseFor(b.session, 'story', site)).toBe(p);
    const q = zone.phases.phaseFor(c.session, 'story', site);
    expect(q).not.toBe(p);
    const boss = zone.phases.spawn(p.id, { kind: 'mob', frame: zone.stationFrame, pos: [0, 20, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], name: 'Overseer' });
    await waitFor(() => a.sees(boss) && b.sees(boss), 5000, 'the party to see its boss');
    expect(c.sees(boss)).toBe(false);

    // b goes far out, well beyond any interest radius: its party still sees it, c does not
    await waitFor(() => c.sees(b.entityId), 5000, 'c to see b at the dock');
    zone.patch(b.entityId, { pos: [3e6, 0, 0] });
    await waitFor(() => !c.sees(b.entityId), 5000, 'b out of c’s sight');
    const after = zone.tick;
    await waitFor(() => (a.client.latestTick ?? 0) > after + 5, 5000, 'five ticks');
    expect(a.sees(b.entityId)).toBe(true);
    expect(b.sees(a.entityId)).toBe(true);
    zone.phases.close(p.id);
    zone.phases.close(q.id);
    await close(a, b, c);
  });

  it('refuses a chat flood from one account, then mutes it, without closing its socket', async () => {
    const a = await bot();
    const b = await bot();
    const tag = uid();
    for (let i = 0; i < 20; i++) a.sock.send({ t: 'chat', channel: 'system', text: `flood ${tag} ${i}` });
    await waitFor(
      () => a.sock.received.filter((m) => m.t === 'denied' || (m.t === 'event' && m.event.kind === 'chat' && m.event.text.includes(tag))).length === 20,
      5000,
      'an answer to every message',
    );
    const answers = a.sock.received.filter((m) => m.t === 'denied' || (m.t === 'event' && m.event.kind === 'chat'));
    const relayed = answers.filter((m) => m.t === 'event').length;
    const codes = answers.flatMap((m) => (m.t === 'denied' ? [m.code] : []));
    expect(relayed).toBeGreaterThanOrEqual(5);
    expect(relayed).toBeLessThanOrEqual(6);
    expect(codes.filter((x) => x === 'rate').length).toBeGreaterThanOrEqual(9);
    expect(codes.at(-1)).toBe('muted');
    expect(codes.slice(codes.indexOf('muted')).every((x) => x === 'muted')).toBe(true);
    await b.settle();
    expect(b.sock.received.filter((m) => m.t === 'event' && m.event.kind === 'chat' && m.event.text.includes(tag)).length).toBe(relayed);
    expect(b.sock.received.some((m) => m.t === 'denied')).toBe(false);
    // the socket stays open: the flood fit the gateway's budget
    await a.settle();
    expect(a.session.state).toBe('joined');
    await close(a, b);
  });
});
