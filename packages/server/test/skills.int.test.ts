// The skill web over the socket against the dockerised Postgres and Redis (P1.E07.T01): join sends the character's
// skills; a client unlocks and buys nodes in order and is refused out of order, under level or unaffordable; slots its
// actives; respecs at a trainer for units; Pack Mule adds a cargo pod and raises the stack cap; and a restart on the same
// database resumes the skills and that layout.
import { countOf, slotAt } from '@astra/shared/inventory';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { pointsOf } from '@astra/shared/skills';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard } from './helpers.ts';

const config = parseConfig(process.env);
let database: Database;
const running = new Set<RunningServer>();

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL);
  database = createDatabase(config.DATABASE_URL, { max: 2 });
});

afterAll(async () => {
  await Promise.all([...running].map((s) => s.close()));
  await database?.close();
});

async function start(shard?: string): Promise<RunningServer> {
  const server = await startTestServer({}, shard ? { shard } : {});
  running.add(server);
  return server;
}

async function stop(server: RunningServer): Promise<void> {
  await server.close();
  running.delete(server);
}

type SkillsState = Extract<ServerMessage, { t: 'skills' }>;
type InventoryState = Extract<ServerMessage, { t: 'inventory' }>;

async function join(server: RunningServer, token: string, characterId: string) {
  const s = await TestSocket.open(server.wsUrl);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  s.send({ t: 'join', characterId });
  const welcome = await s.next('welcome');
  const inventory = await s.next('inventory');
  const skills = await s.next('skills');
  return { s, welcome, inventory, skills };
}

/** Sends a skills request and returns the server's answer to it. */
async function ask(s: TestSocket, seq: number, op: Record<string, unknown>): Promise<SkillsState> {
  s.send({ t: 'skills', seq, op });
  for (;;) {
    const m = await s.next('skills');
    if (m.seq === seq) return m;
  }
}

/** The next inventory state that satisfies `cond`. */
async function inventoryWhere(s: TestSocket, cond: (m: InventoryState) => boolean): Promise<InventoryState> {
  for (;;) {
    const m = await s.next('inventory');
    if (cond(m)) return m;
  }
}

let pings = 0;
/** Resolves once the server has handled everything this socket sent before (messages are handled in order). */
async function handled(s: TestSocket): Promise<void> {
  const id = ++pings;
  s.send({ t: 'ping', id, clientTime: 0 });
  for (;;) if ((await s.next('pong')).id === id) return;
}

/** A character's level as its row holds it (progress loads it on join). */
async function setLevel(characterId: string, level: number): Promise<void> {
  await database.db.update(characters).set({ level }).where(eq(characters.id, characterId));
}

async function row(id: string) {
  const [r] = await database.db.select().from(characters).where(eq(characters.id, id));
  return r!;
}

describe('the skill web over the socket', () => {
  it('unlocks and buys in order, refuses out of order, under level or unaffordable, slots actives and respecs at a trainer', async () => {
    const server = await start();
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token, { people: 'thalune' });
    await setLevel(character.id, 16);
    const id = character.id;

    // skills before join are out of place
    const early = await TestSocket.open(server.wsUrl);
    early.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
    early.send({ t: 'skills', seq: 1, op: { op: 'buy', node: 'second_lung' } });
    await handled(early);
    expect([...server.ws.registry.sessions].find((x) => x.accountId === acct.accountId)!.invalidMessages).toBe(1);
    early.close();

    const { s, skills: first } = await join(server, acct.token, id);
    expect(first.seq).toBe(0);
    expect(first.error).toBeUndefined();
    expect(first.skills).toMatchObject({ level: 16, shipSlots: 2, met: [], maxTier: 2 });
    expect(first.skills.state.unlocked).toEqual(['second_lung']);
    expect(first.skills.state.bought).toEqual([]);
    expect(pointsOf(first.skills.state, first.skills.level).available).toBe(16);

    // a monolith's fragments are the server's to give: they arrive as pushed state
    expect(server.ws.skills.grantFragments(id, 'gravitic', 4).ok).toBe(true);
    const pushed = await s.next('skills');
    expect(pushed.seq).toBe(0);
    expect(pushed.skills.state.fragments.gravitic).toEqual({ earned: 4, spent: 0 });

    expect((await ask(s, 1, { op: 'unlock', node: 'pull' })).error).toBeUndefined();
    expect((await ask(s, 2, { op: 'unlock', node: 'slam' })).skills.state.fragments.gravitic).toEqual({ earned: 4, spent: 4 });
    expect(await ask(s, 3, { op: 'unlock', node: 'well' })).toMatchObject({ error: 'fragments' });
    // Slam needs a Gravitic Tier I owned first
    expect(await ask(s, 4, { op: 'buy', node: 'slam' })).toMatchObject({ error: 'prerequisite' });
    expect((await ask(s, 5, { op: 'buy', node: 'pull' })).error).toBeUndefined();
    expect((await ask(s, 6, { op: 'buy', node: 'slam' })).skills.state.bought).toEqual(['pull', 'slam']);
    expect(await ask(s, 7, { op: 'buy', node: 'pull_many' })).toMatchObject({ error: 'not_unlocked' });
    // Phase 1 sells Tier I and II: Tier III is refused by any route
    expect(server.ws.skills.unlock(id, 'anchor', { kind: 'dev' })).toMatchObject({ ok: false, error: { code: 'phase' } });
    expect(await ask(s, 8, { op: 'unlock', node: 'anchor' })).toMatchObject({ error: 'phase' });

    // the people's node is unlocked from the start
    expect((await ask(s, 9, { op: 'buy', node: 'second_lung' })).skills.state.bought).toEqual(['pull', 'slam', 'second_lung']);

    // the bars: actives on their own bar, passives always on, a node already slotted swaps places
    expect((await ask(s, 11, { op: 'slot', bar: 'ground', index: 0, node: 'pull' })).error).toBeUndefined();
    expect(await ask(s, 12, { op: 'slot', bar: 'ground', index: 1, node: 'second_lung' })).toMatchObject({ error: 'not_slottable' });
    expect(await ask(s, 13, { op: 'slot', bar: 'ship', index: 0, node: 'pull' })).toMatchObject({ error: 'wrong_bar' });
    expect(await ask(s, 14, { op: 'slot', bar: 'ground', index: 2, node: 'anchor' })).toMatchObject({ error: 'not_owned' });
    expect((await ask(s, 15, { op: 'slot', bar: 'ground', index: 1, node: 'slam' })).skills.state.slots.ground.slice(0, 2)).toEqual(['pull', 'slam']);
    expect((await ask(s, 16, { op: 'slot', bar: 'ground', index: 0, node: 'slam' })).skills.state.slots.ground.slice(0, 2)).toEqual(['slam', 'pull']);

    // respec: Pull holds Slam up; Slam goes only at a Chorus listener, for 500 units
    expect(await ask(s, 17, { op: 'respec', nodes: ['pull'] })).toMatchObject({ error: 'needed' });
    expect(await ask(s, 18, { op: 'respec', nodes: ['slam'] })).toMatchObject({ error: 'trainer' });
    server.ws.skills.hooks.trainerAtHand = (_, trainer) => trainer === 'chorus_listener';
    const respec = await ask(s, 19, { op: 'respec', nodes: ['slam'] });
    expect(respec.error).toBeUndefined();
    expect(respec.skills.state.bought).toEqual(['pull', 'second_lung']);
    expect(respec.skills.state.slots.ground.slice(0, 2)).toEqual([null, 'pull']);
    expect(pointsOf(respec.skills.state, respec.skills.level).available).toBe(14);
    expect((await inventoryWhere(s, (m) => m.inventory.units === 2000)).inventory.units).toBe(2000);
    expect(await ask(s, 19, { op: 'buy', node: 'slam' })).toMatchObject({ seq: 19, error: 'stale_seq' });

    // a request a client may not make is dropped and counted, never answered
    const session = [...server.ws.registry.sessions].find((x) => x.characterId === id)!;
    const invalid = session.invalidMessages;
    s.send({ t: 'skills', seq: 30, op: { op: 'grant', points: 99 } });
    await handled(s);
    expect(session.invalidMessages).toBe(invalid + 1);
    expect(server.ws.skills.points(id).available).toBe(14);
    expect(server.ws.skills.get(id)).toEqual(respec.skills.state);
    s.close();
  });

  it('refuses what a character cannot afford until the server grants the points', async () => {
    const server = await start();
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token, { people: 'ixari' });
    const id = character.id;
    const { s, skills } = await join(server, acct.token, id);
    expect(skills.skills).toMatchObject({ level: 1, state: { unlocked: ['pulse'] } });
    // level 1 gives one point
    expect((await ask(s, 1, { op: 'buy', node: 'pulse' })).error).toBeUndefined();
    expect(server.ws.skills.unlock(id, 'long_ear', { kind: 'dev' }).ok).toBe(true);
    expect(await ask(s, 2, { op: 'buy', node: 'long_ear' })).toMatchObject({ error: 'points' });
    // a chapter's point, pushed
    expect(server.ws.skills.grantPoints(id, 1).ok).toBe(true);
    const granted = await s.next('skills');
    expect(pointsOf(granted.skills.state, granted.skills.level)).toMatchObject({ granted: 1, available: 1 });
    expect((await ask(s, 3, { op: 'buy', node: 'long_ear' })).skills.state.bought).toEqual(['pulse', 'long_ear']);
    // the developer CLI's "set skill points"
    expect(server.ws.skills.setPoints(id, 5)).toMatchObject({ ok: true, available: 5 });
    expect(pointsOf((await s.next('skills')).skills.state, 1).available).toBe(5);
    s.close();
  });

  it('adds a cargo pod and raises the stack cap with Pack Mule, and resumes both and the skills after a restart', async () => {
    const shard = uniqueShard();
    const first = await start(shard);
    const acct = await newAccount(first);
    const character = await newCharacter(first, acct.token, { people: 'ulgani' });
    await setLevel(character.id, 30);
    const id = character.id;
    const a = await join(first, acct.token, id);
    expect(a.skills.skills.state.unlocked).toEqual(['cartridge_recycler']);
    expect(a.inventory.inventory.pods).toHaveLength(1);
    expect(a.inventory.inventory.stackMax).toBe(9999);

    // Pack Mule is Tier III, past Phase 1's ceiling: the server lifts it here as Phase 2 will
    first.ws.skills.maxTier = 4;
    // a city skill master teaches Exo-suit: the server unlocks, the client buys
    for (const node of ['hazard_weave', 'pack_mule']) expect(first.ws.skills.unlock(id, node, { kind: 'trainer', trainer: 'city_master' }).ok).toBe(true);
    expect(await ask(a.s, 1, { op: 'buy', node: 'pack_mule' })).toMatchObject({ error: 'prerequisite' });
    expect(await ask(a.s, 2, { op: 'buy', node: 'hazard_weave' })).toMatchObject({ error: 'prerequisite' });
    expect((await ask(a.s, 3, { op: 'buy', node: 'cartridge_recycler' })).error).toBeUndefined();
    expect((await ask(a.s, 4, { op: 'buy', node: 'hazard_weave' })).error).toBeUndefined();
    const mule = await ask(a.s, 5, { op: 'buy', node: 'pack_mule' });
    expect(mule.skills.state.bought).toEqual(['cartridge_recycler', 'hazard_weave', 'pack_mule']);
    const relaid = await inventoryWhere(a.s, (m) => m.inventory.pods.length === 2);
    expect(relaid.inventory.stackMax).toBe(15000);

    // a stack over the old cap, stowed in the new pod
    expect(first.ws.inventory.grant(id, 'ferrite', 12000).ok).toBe(true);
    await inventoryWhere(a.s, (m) => countOf(m.inventory, 'ferrite') === 12000);
    a.s.send({ t: 'inventory', seq: 1, op: { op: 'move', from: { c: 'suit', i: 1 }, to: { c: 'pod', p: 1, i: 0 } } });
    const stowed = await inventoryWhere(a.s, (m) => m.seq === 1);
    expect(stowed.error).toBeUndefined();
    expect(slotAt(stowed.inventory, { c: 'pod', p: 1, i: 0 })).toEqual({ item: 'ferrite', count: 12000 });
    await handled(a.s);

    await stop(first); // graceful: every character in play is saved
    const saved = await row(id);
    expect(saved.state.skills).toEqual({ v: 1, data: mule.skills.state });
    expect(saved.state.ship?.data).toMatchObject({ hull: 'lark', cargoPods: 2 });
    expect(saved.state.inventory).toEqual({ v: 1, data: stowed.inventory });

    const second = await start(shard);
    const b = await join(second, acct.token, id);
    // under the default ceiling again: what is owned stays owned
    expect(b.skills).toEqual({ t: 'skills', seq: 0, skills: { ...mule.skills, maxTier: 2 } });
    expect(b.inventory.inventory).toEqual(stowed.inventory);
    expect(b.inventory.inventory.pods).toHaveLength(2);
    expect(b.inventory.inventory.stackMax).toBe(15000);
    expect(second.ws.skills.owned(id)).toContain('pack_mule');
    b.s.close();
    await stop(second);
  });
});
