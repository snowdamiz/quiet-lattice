// Character persistence against the dockerised Postgres and Redis (P1.E03.T05): a character that moved and changed its
// inventory is where it was, with what it had, after the server is stopped gracefully and restarted on the same database;
// a crash loses at most the last save interval; leaving saves at once; a duplicate join carries the state across; a saved
// pose the world cannot place falls back to docked at home; an unreadable component refuses the join; and the store's
// revision guard keeps a stale save from overwriting a newer one.
import { countOf, slotAt } from '@astra/shared/inventory';
import { PROTOCOL_VERSION, type Pose, type ServerMessage } from '@astra/shared/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { characters } from '../src/db/schema.ts';
import { dockedAtHome } from '../src/persistence/components.ts';
import { pgCharacterStore } from '../src/persistence/store.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf, stationFrame, systemSeed } from '../src/world/home.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';

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

async function start(opts: Parameters<typeof startTestServer>[1] = {}): Promise<RunningServer> {
  const server = await startTestServer({}, opts);
  running.add(server);
  return server;
}

async function stop(server: RunningServer): Promise<void> {
  await server.close();
  running.delete(server);
}

type InventoryState = Extract<ServerMessage, { t: 'inventory' }>;

async function join(server: RunningServer, token: string, characterId: string) {
  const s = await TestSocket.open(server.wsUrl);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  s.send({ t: 'join', characterId });
  const welcome = await s.next('welcome');
  const inventory = await s.next('inventory');
  return { s, welcome, inventory };
}

let pings = 0;
/** Resolves once the server has handled everything this socket sent before (messages are handled in order). */
async function handled(s: TestSocket): Promise<void> {
  const id = ++pings;
  s.send({ t: 'ping', id, clientTime: 0 });
  for (;;) if ((await s.next('pong')).id === id) return;
}

/** The next inventory message with this request seq. */
async function reply(s: TestSocket, seq: number): Promise<InventoryState> {
  for (;;) {
    const m = await s.next('inventory');
    if (m.seq === seq) return m;
  }
}

function input(s: TestSocket, seq: number, pose: Pose, mode: 'ship' | 'foot' | 'landed' = 'ship'): void {
  s.send({ t: 'input', seq, time: 0, mode, pose, buttons: 0 });
}

/** The pose the server holds for the character's entity. */
function serverPose(server: RunningServer, characterId: string): { pose: Pose; mode: string | undefined } {
  const session = [...server.ws.registry.sessions].find((x) => x.characterId === characterId && x.state === 'joined')!;
  const zone = server.zones.zoneOf(session)!;
  const f = zone.entity(zone.entityOf(session)!)!.fields;
  return { pose: { frame: f.frame, pos: [...f.pos], quat: [...f.quat], vel: [...f.vel] }, mode: f.mode };
}

async function row(id: string) {
  const [r] = await database.db.select().from(characters).where(eq(characters.id, id));
  return r!;
}

const HOME = homeSystemOf('thalune');
const STATION = stationFrame(HOME);
const DOCKED: Pose = { frame: STATION, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] };

describe('character persistence', () => {
  it('resumes pose, frame, mode and inventory after a graceful stop and a restart on the same database', async () => {
    const shard = uniqueShard();
    const first = await start({ shard });
    const acct = await newAccount(first);
    const character = await newCharacter(first, acct.token);
    const a = await join(first, acct.token, character.id);
    expect(a.welcome.pose).toEqual(DOCKED);
    expect(a.welcome.mode).toBe('docked');

    // it flies off the pad, picks something up, and stows its warp cell in the cargo pod
    input(a.s, 1, { frame: STATION, pos: [120, 5, -40], quat: [0, 0, 0.6, 0.8], vel: [10, 0, 0] });
    input(a.s, 2, { frame: STATION, pos: [130, 5, -40], quat: [0, 0, 0.6, 0.8], vel: [10, 0, 0] });
    expect(first.ws.inventory.grant(character.id, 'ferrite', 120).ok).toBe(true);
    a.s.send({ t: 'inventory', seq: 1, op: { op: 'move', from: { c: 'suit', i: 0 }, to: { c: 'pod', p: 0, i: 3 } } });
    const moved = await reply(a.s, 1);
    expect(moved.error).toBeUndefined();
    expect(slotAt(moved.inventory, { c: 'pod', p: 0, i: 3 })).toEqual({ item: 'warp_cell', count: 1 });
    await handled(a.s);
    const held = serverPose(first, character.id);
    expect(held.pose.pos).toEqual([130, 5, -40]);
    expect(held.mode).toBe('ship');

    await stop(first); // graceful: every character in play is saved
    const saved = await row(character.id);
    expect(saved.revision).toBeGreaterThan(0);
    expect(saved.savedAt).toBeInstanceOf(Date);
    expect(saved.state.pose).toEqual({ v: 1, data: { system: HOME, pose: held.pose, mode: 'ship' } });
    expect(saved.state.inventory).toEqual({ v: 1, data: moved.inventory });
    expect(saved.state.ship?.data).toMatchObject({ hull: 'lark', cargoPods: 1 });

    const second = await start({ shard });
    const b = await join(second, acct.token, character.id);
    expect(b.welcome.zone).toEqual({ id: `sys:${HOME}`, systemSeed: systemSeed(HOME) });
    expect(b.welcome.pose).toEqual(held.pose);
    expect(b.welcome.mode).toBe('ship');
    expect(b.inventory).toEqual({ t: 'inventory', seq: 0, inventory: moved.inventory });
    expect(countOf(b.inventory.inventory, 'ferrite')).toBe(120);
    expect(serverPose(second, character.id)).toEqual(held);
    await stop(second);
  });

  it('after a crash (no shutdown flush) resumes from the last periodic save: at most one interval is lost', async () => {
    const shard = uniqueShard();
    // one slot, so the character's saves are exactly one interval apart
    const crashing = await start({ shard, persistence: { intervalMs: 2000, slots: 1 } });
    const acct = await newAccount(crashing);
    const character = await newCharacter(crashing, acct.token);
    const a = await join(crashing, acct.token, character.id);

    const kept: Pose = { frame: STATION, pos: [300, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
    input(a.s, 1, kept);
    await handled(a.s);
    const before = crashing.persistence.status(character.id)!.revision;
    await waitFor(() => crashing.persistence.status(character.id)!.written > before, 5000, 'a periodic save after the move');
    expect((await row(character.id)).state.pose?.data).toMatchObject({ pose: { pos: [300, 0, 0] }, mode: 'ship' });

    // moved again, and the process dies before the next periodic save
    input(a.s, 2, { ...kept, pos: [900, 0, 0] });
    await handled(a.s);
    crashing.persistence.abandon();
    await stop(crashing);
    expect((await row(character.id)).state.pose?.data).toMatchObject({ pose: { pos: [300, 0, 0] } });

    const restarted = await start({ shard });
    const b = await join(restarted, acct.token, character.id);
    expect(b.welcome.pose).toEqual(kept);
    expect(b.welcome.mode).toBe('ship');
    await stop(restarted);
  });

  it('saves the moment a character leaves, then forgets it', async () => {
    const server = await start({ persistence: { intervalMs: 600_000 } });
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const a = await join(server, acct.token, character.id);
    const pose: Pose = { frame: STATION, pos: [-50, 12, 7], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
    input(a.s, 1, pose, 'foot');
    a.s.send({ t: 'inventory', seq: 1, op: { op: 'transfer', from: { c: 'suit', i: 0 } } });
    const moved = await reply(a.s, 1);
    expect(moved.error).toBeUndefined();
    a.s.close();
    await waitFor(() => server.persistence.status(character.id) === null, 5000, 'the character to be saved and evicted');
    const saved = await row(character.id);
    expect(saved.state.pose?.data).toEqual({ system: HOME, pose, mode: 'foot' });
    expect(saved.state.inventory?.data).toEqual(moved.inventory);
    expect(server.ws.inventory.get(character.id)).toBeNull();

    // and joining again loads what was saved
    const b = await join(server, acct.token, character.id);
    expect(b.welcome.pose).toEqual(pose);
    expect(b.welcome.mode).toBe('foot');
    expect(b.inventory.inventory).toEqual(moved.inventory);
    b.s.close();
  });

  it('carries the state to the new connection when the same character joins twice', async () => {
    const server = await start({ persistence: { intervalMs: 600_000 } });
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const a = await join(server, acct.token, character.id);
    const pose: Pose = { frame: STATION, pos: [40, 40, 40], quat: [0, 0, 0, 1], vel: [1, 2, 3] };
    input(a.s, 1, pose);
    server.ws.inventory.grant(character.id, 'gold', 7);
    await handled(a.s);
    const b = await join(server, acct.token, character.id);
    expect((await a.s.next('refused')).code).toBe('kicked');
    expect(b.welcome.pose).toEqual(pose);
    expect(countOf(b.inventory.inventory, 'gold')).toBe(7);
    b.s.close();
  });

  it('docks a character at its home Waystation when its saved frame no longer exists, and refuses one whose state cannot be read', async () => {
    const server = await start();
    const acct = await newAccount(server);
    const lost = await newCharacter(server, acct.token);
    const elsewhere = { ...dockedAtHome(HOME), pose: { ...DOCKED, frame: `${systemSeed(HOME)}:999`, pos: [5, 5, 5] }, mode: 'ship' };
    await database.db
      .update(characters)
      .set({ state: { pose: { v: 1, data: elsewhere } } })
      .where(eq(characters.id, lost.id));
    const a = await join(server, acct.token, lost.id);
    expect(a.welcome.pose).toEqual(DOCKED);
    expect(a.welcome.mode).toBe('docked');
    a.s.close();

    const future = await newCharacter(server, acct.token);
    await database.db
      .update(characters)
      .set({ state: { inventory: { v: 99, data: { from: 'a newer server' } } } })
      .where(eq(characters.id, future.id));
    const s = await TestSocket.open(server.wsUrl);
    s.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
    s.send({ t: 'join', characterId: future.id });
    expect((await s.next('refused')).code).toBe('full');
    // nothing was written over it
    expect((await row(future.id)).state.inventory).toEqual({ v: 99, data: { from: 'a newer server' } });
  });

  it('never lets a stale save overwrite a newer one, and keeps state entries a save does not carry', async () => {
    const server = await start();
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const store = pgCharacterStore(database.db);
    const id = character.id;

    expect(
      await store.write([{ id, revision: 5, state: { quests: { v: 2, data: { step: 3 } }, ship: { v: 1, data: null } }, columns: { level: 4, xp: 900 } }]),
    ).toEqual(new Set([id]));
    // older, then equal: both skipped
    expect(await store.write([{ id, revision: 4, state: { quests: { v: 2, data: { step: 1 } } }, columns: { level: 2 } }])).toEqual(new Set());
    expect(await store.write([{ id, revision: 5, state: { quests: { v: 2, data: { step: 1 } } }, columns: {} }])).toEqual(new Set());
    let r = await row(id);
    expect(r).toMatchObject({ revision: 5, level: 4, xp: 900, state: { quests: { v: 2, data: { step: 3 } } } });

    // newer: merged over the entries it does not carry; columns it does not carry stay
    expect(await store.write([{ id, revision: 6, state: { quests: { v: 2, data: { step: 4 } } }, columns: { xp: 950 } }])).toEqual(new Set([id]));
    r = await row(id);
    expect(r).toMatchObject({ revision: 6, level: 4, xp: 950, state: { quests: { v: 2, data: { step: 4 } }, ship: { v: 1, data: null } } });

    // a batch: one row written, one stale, one gone
    const other = await newCharacter(server, acct.token);
    const written = await store.write([
      { id: other.id, revision: 1, state: {}, columns: { level: 2 } },
      { id, revision: 3, state: {}, columns: { level: 1 } },
      { id: '00000000-0000-4000-8000-000000000000', revision: 1, state: {}, columns: {} },
    ]);
    expect(written).toEqual(new Set([other.id]));
    expect((await row(other.id)).level).toBe(2);
    expect((await row(id)).level).toBe(4);
  });
});
