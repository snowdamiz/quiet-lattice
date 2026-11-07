// P1.E07.T16: real gateway/persistence boundaries. The test book records runtime admission only, not Void effects.
import { type Ability } from '@astra/shared/abilities';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { emptySkillState, storedSkills, type SkillOp } from '@astra/shared/skills';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abilityBook, type AbilityEffect } from '../src/abilities/book.ts';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';

const REACHES = { kind: 'faction_rank', faction: 'reaches', rank: 'deckhand' };
const config = parseConfig(process.env);
let database: Database;
const running = new Set<RunningServer>();
beforeAll(() => {
  database = createDatabase(config.DATABASE_URL, { max: 2 });
});
afterAll(async () => {
  await Promise.all([...running].map((server) => server.close()));
  await database?.close();
});

async function start() {
  const effects: string[] = [];
  const server = await startTestServer(
    {},
    {
      shard: uniqueShard(),
      abilities: abilityBook(
        new Map<string, Ability>([['micro_jump', { node: 'micro_jump', target: 'self', toggle: true }]]),
        new Map<string, AbilityEffect>([
          [
            'micro_jump',
            {
              cast: () => {
                effects.push('cast');
              },
              end: () => {
                effects.push('end');
              },
            },
          ],
        ]),
      ),
    },
  );
  running.add(server);
  return { server, effects };
}

async function join(server: RunningServer, token: string, characterId: string) {
  const socket = await TestSocket.open(server.wsUrl);
  socket.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  socket.send({ t: 'join', characterId });
  const welcome = await socket.next('welcome');
  await barrier(socket);
  const skills = socket.received.find((m) => m.t === 'skills');
  if (!skills || skills.t !== 'skills') throw new Error('join sent no skills');
  let seq = 0;
  return {
    socket,
    welcome,
    skills,
    async ask(op: SkillOp) {
      socket.send({ t: 'skills', seq: ++seq, op });
      for (;;) {
        const reply = await socket.next('skills');
        if (reply.seq === seq) return reply;
      }
    },
  };
}

async function barrier(socket: TestSocket) {
  socket.send({ t: 'ping', id: 1, clientTime: 0 });
  await socket.next('pong');
}

function changes(socket: TestSocket) {
  return socket.received.flatMap((m) =>
    m.t === 'skills' || m.t === 'reputation' || m.t === 'abilities'
      ? [m.t]
      : m.t === 'event' && (m.event.kind === 'rank' || m.event.kind === 'title' || m.event.kind === 'cast')
        ? [m.event.kind]
        : [],
  );
}

function latestSkills(socket: TestSocket) {
  return socket.received.filter((m): m is Extract<ServerMessage, { t: 'skills' }> => m.t === 'skills').at(-1)!.skills;
}

async function saved(id: string) {
  const [row] = await database.db.select().from(characters).where(eq(characters.id, id));
  return row!;
}

describe('live Reaches skill eligibility', () => {
  it('publishes 199/200, enforces loss, ends a toggle through skill changes and recovers purchases across reconnect', async () => {
    const { server, effects } = await start();
    const account = await newAccount(server);
    const id = (await newCharacter(server, account.token)).id;
    await database.db
      .update(characters)
      .set({ level: 16, state: { reputation: { v: 1, data: { rep: { reaches: 199 }, titles: [] } } } })
      .where(eq(characters.id, id));
    const a = await join(server, account.token, id);
    expect(a.skills.skills.met).toEqual([]);
    server.ws.skills.grantFragments(id, 'void', 10);
    expect((await a.ask({ op: 'unlock', node: 'phase' })).error).toBe('requirement');
    a.socket.received.length = 0;
    server.ws.reputation.grant(id, 'reaches', 1, { reason: 'test' });
    await barrier(a.socket);
    expect(changes(a.socket)).toEqual(['rank', 'title', 'reputation', 'skills']);
    expect(latestSkills(a.socket).met).toEqual([REACHES]);
    for (const node of ['phase', 'micro_jump', 'edge_sense']) {
      expect((await a.ask({ op: 'unlock', node })).error).toBeUndefined();
      if (node !== 'edge_sense') expect((await a.ask({ op: 'buy', node })).error).toBeUndefined();
    }
    expect((await a.ask({ op: 'slot', bar: 'ground', index: 0, node: 'phase' })).error).toBeUndefined();
    expect((await a.ask({ op: 'slot', bar: 'ship', index: 0, node: 'micro_jump' })).error).toBeUndefined();
    const owned = server.ws.skills.stored(id)!;
    const zone = server.zones.zone(a.welcome.zone.id)!;
    zone.patch(a.welcome.entityId, { mode: 'ship' });
    a.socket.send({ t: 'cast', seq: 1, time: server.world.clock.now(), node: 'micro_jump', slot: 0, frame: a.welcome.pose.frame, aim: [0, 0, -1] });
    expect((await a.socket.next('cast')).result).toBe('cast');
    expect(effects).toEqual(['cast']);
    await barrier(a.socket);
    a.socket.received.length = 0;
    server.ws.reputation.set(id, 'reaches', 199);
    expect(effects).toEqual(['cast', 'end']);
    await barrier(a.socket);
    expect(changes(a.socket)).toEqual(['rank', 'reputation', 'skills', 'cast', 'abilities']);
    const lost = latestSkills(a.socket);
    expect(lost.met).toEqual([]);
    expect(lost.state.slots.ground.every((s) => s === null)).toBe(true);
    expect(lost.state.slots.ship.every((s) => s === null)).toBe(true);
    expect(server.ws.skills.stored(id)).toEqual({ ...owned, slots: lost.state.slots });
    expect((await a.ask({ op: 'unlock', node: 'drain' })).error).toBe('requirement');
    expect((await a.ask({ op: 'buy', node: 'edge_sense' })).error).toBe('requirement');
    expect((await a.ask({ op: 'slot', bar: 'ground', index: 0, node: 'phase' })).error).toBe('requirement');
    expect((await a.ask({ op: 'slot', bar: 'ship', index: 0, node: 'micro_jump' })).error).toBe('requirement');
    const beforeCast = server.ws.meters.view(id, server.world.clock.now()).charge;
    a.socket.send({ t: 'cast', seq: 2, time: server.world.clock.now(), node: 'micro_jump', slot: 0, frame: a.welcome.pose.frame, aim: [0, 0, -1] });
    expect(await a.socket.next('cast')).toMatchObject({ result: 'refused', reason: 'not_slotted' });
    expect(effects).toEqual(['cast', 'end']);
    expect(server.ws.meters.view(id, server.world.clock.now()).charge).toBe(beforeCast);
    a.socket.close();
    await waitFor(() => server.persistence.status(id) === null);
    expect((await saved(id)).state.skills).toEqual({ v: 2, data: { ...owned, slots: lost.state.slots } });
    const b = await join(server, account.token, id);
    expect(b.skills.skills.state).toEqual(lost.state);
    expect(b.skills.skills.met).toEqual([]);
    b.socket.received.length = 0;
    server.ws.reputation.set(id, 'reaches', 200);
    await barrier(b.socket);
    expect(changes(b.socket)).toEqual(['rank', 'reputation', 'skills']);
    expect(latestSkills(b.socket).met).toEqual([REACHES]);
    expect((await b.ask({ op: 'slot', bar: 'ship', index: 0, node: 'micro_jump' })).error).toBeUndefined();
    expect(server.ws.skills.stored(id)!.paid).toEqual(owned.paid);
    expect(server.ws.skills.stored(id)!.fragments).toEqual(owned.fragments);
    b.socket.close();
  });

  it.each([199, 200])('loads reputation before judging stored gated slots at %i, including a restart', async (standing) => {
    const { server } = await start();
    const account = await newAccount(server);
    const id = (await newCharacter(server, account.token)).id;
    const state = emptySkillState();
    state.unlocked = ['phase', 'micro_jump', 'pull'];
    state.bought = [...state.unlocked];
    state.slots.ground[0] = 'phase';
    state.slots.ground[1] = 'pull';
    state.slots.ship[4] = 'micro_jump'; // inaccessible hull slot still loses its gate
    state.fragments.void = { earned: 3, spent: 2 };
    const paid = { phase: { branch: 'void', count: 1 }, micro_jump: { branch: 'void', count: 1 } } as const;
    const stored = storedSkills(state, paid);
    await database.db
      .update(characters)
      .set({
        level: 16,
        state: {
          skills: { v: 2, data: stored },
          reputation: { v: 1, data: { rep: { reaches: standing }, titles: [{ faction: 'reaches', rank: 'deckhand' }] } },
        },
      })
      .where(eq(characters.id, id));
    const a = await join(server, account.token, id);
    expect(a.skills.skills.met).toEqual(standing === 200 ? [REACHES] : []);
    expect(a.skills.skills.state.slots.ground.slice(0, 2)).toEqual([standing === 200 ? 'phase' : null, 'pull']);
    expect(a.skills.skills.state.slots.ship[4]).toBe(standing === 200 ? 'micro_jump' : null);
    expect(a.skills.skills.state.bought).toEqual(state.bought);
    expect(server.ws.skills.stored(id)!.paid).toEqual(paid);
    await server.close();
    running.delete(server);
    const restarted = (await start()).server;
    const b = await join(restarted, account.token, id);
    expect(b.skills.skills).toEqual(a.skills.skills);
    expect(restarted.ws.skills.stored(id)!.paid).toEqual(paid);
    b.socket.close();
  });
});
