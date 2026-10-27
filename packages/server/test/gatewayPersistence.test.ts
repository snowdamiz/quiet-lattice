// The gateway's join against persistence, with the row read and the save under the test's control (no database): a
// character that rejoins while the save of its leave lands during the row read loads what it left, not the older row,
// however the client spells its id; and the inventory sent after `welcome` is the one persistence loaded.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PROTOCOL_VERSION, type Pose } from '@astra/shared/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.ts';
import type { CharacterRow } from '../src/db/schema.ts';
import { attachWsGateway, type WsGateway } from '../src/gateway/ws.ts';
import { InventoryService } from '../src/inventory/service.ts';
import { CharacterProgress, coreRegistry, ShipLoadouts } from '../src/persistence/components.ts';
import { CharacterPersistence } from '../src/persistence/service.ts';
import type { CharacterStore, SaveRow } from '../src/persistence/store.ts';
import { homeSystemOf, stationFrame } from '../src/world/home.ts';
import { ZoneManager } from '../src/zones/manager.ts';
import { TestSocket, waitFor } from './helpers.ts';

const ACCOUNT = '0a0a0a0a-0000-4000-8000-00000000000a';
const CHARACTER = 'c0ffee00-abcd-4000-8000-0000000000ef';
const HOME = homeSystemOf('thalune');

/** The characters table in memory: Postgres's revision guard and merge, and its case-insensitive uuid lookup. */
class Rows implements CharacterStore {
  readonly rows = new Map<string, CharacterRow>();
  readonly calls: SaveRow[][] = [];
  /** Runs after a lookup has read its row and before it returns it. */
  duringRead: (() => Promise<void>) | null = null;
  private gate: Promise<void> | null = null;

  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise((r) => (release = r));
    return () => {
      this.gate = null;
      release();
    };
  }

  async write(batch: readonly SaveRow[]): Promise<Set<string>> {
    this.calls.push(structuredClone([...batch]));
    if (this.gate) await this.gate;
    const written = new Set<string>();
    for (const r of batch) {
      const row = this.rows.get(r.id);
      if (!row || r.revision <= row.revision) continue;
      this.rows.set(r.id, { ...row, ...r.columns, state: { ...row.state, ...structuredClone(r.state) }, revision: r.revision, savedAt: new Date() });
      written.add(r.id);
    }
    return written;
  }

  async owned(accountId: string, characterId: string): Promise<CharacterRow | null> {
    const row = [...this.rows.values()].find((r) => r.accountId === accountId && r.id === characterId.toLowerCase());
    const read = row ? structuredClone(row) : null;
    const during = this.duringRead;
    this.duringRead = null;
    if (during) await during();
    return read;
  }
}

const silent = (() => {
  const log = { level: 'silent', info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, silent() {}, child: () => log };
  return log as unknown as FastifyBaseLogger;
})();

let server: Server | undefined;
let gateway: WsGateway | undefined;
let persistence: CharacterPersistence | undefined;

afterEach(async () => {
  await gateway?.close();
  await persistence?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = gateway = persistence = undefined;
});

async function setup() {
  const store = new Rows();
  store.rows.set(CHARACTER, {
    id: CHARACTER,
    accountId: ACCOUNT,
    name: 'Ves',
    people: 'thalune',
    look: { palette: 0, pattern: 0, head: 0, suit: 0 },
    level: 1,
    xp: 0,
    homeSystem: HOME,
    state: {},
    revision: 0,
    savedAt: null,
    createdAt: new Date(),
  });
  const clock = { now: () => 1000 };
  const zones = new ZoneManager({ clock });
  const inventory = new InventoryService();
  persistence = new CharacterPersistence({
    store,
    registry: coreRegistry({ zones, inventory, ships: new ShipLoadouts(), progress: new CharacterProgress() }),
    flushTimeoutMs: 2000,
  });
  server = createServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  gateway = attachWsGateway(server, {
    db: {} as Db,
    tokens: { sign: async () => 'token', verify: async (t) => (t === 'token' ? ACCOUNT : null) },
    clock,
    world: { message: () => ({ t: 'world', season: 1, count: 500, edgeX: 0, tiers: [], serverTime: clock.now() }), subscribe: () => () => {} },
    zones,
    log: silent,
    limits: { helloTimeoutMs: 5000, joinTimeoutMs: 5000, maxPerIp: 16, maxPerAccount: 4 },
    inventory,
    persistence,
    ownedCharacter: (accountId, characterId) => store.owned(accountId, characterId),
  });
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  const join = async (characterId: string) => {
    const s = await TestSocket.open(url);
    s.send({ t: 'hello', version: PROTOCOL_VERSION, token: 'token' });
    s.send({ t: 'join', characterId });
    return { s, welcome: await s.next('welcome'), inventory: await s.next('inventory') };
  };
  return { store, zones, inventory, persistence, join };
}

let pings = 0;
async function handled(s: TestSocket): Promise<void> {
  const id = ++pings;
  s.send({ t: 'ping', id, clientTime: 0 });
  for (;;) if ((await s.next('pong')).id === id) return;
}

describe('gateway join with persistence', () => {
  it('loads what a character left when the save of its leave lands while its row is being read, however its id is spelled', async () => {
    const { store, inventory, persistence, join } = await setup();
    const a = await join(CHARACTER);
    const moved: Pose = { frame: stationFrame(HOME), pos: [60, 4, -9], quat: [0, 0, 0, 1], vel: [2, 0, 0] };
    a.s.send({ t: 'input', seq: 1, time: 0, mode: 'ship', pose: moved, buttons: 0 });
    a.s.send({ t: 'inventory', seq: 1, op: { op: 'transfer', from: { c: 'suit', i: 0 } } });
    const left = (await a.s.next('inventory')).inventory;
    await handled(a.s);

    // it leaves; the save is written only once the next join has read the (older) row
    const release = store.hold();
    a.s.close();
    await waitFor(() => persistence.status(CHARACTER)?.inPlay === false, 5000, 'the character to leave');
    expect(store.calls).toHaveLength(1);
    store.duringRead = async () => {
      release();
      await persistence.flush();
    };

    const b = await join(CHARACTER.toUpperCase());
    expect(store.rows.get(CHARACTER)!.revision).toBe(1); // the save landed during the read
    expect(b.welcome.pose).toEqual(moved);
    expect(b.welcome.mode).toBe('ship');
    expect(b.inventory).toEqual({ t: 'inventory', seq: 0, inventory: left });
    expect(b.inventory.inventory).toEqual(inventory.get(CHARACTER));

    // and its next save is not stale: memory and the row agree
    const again: Pose = { ...moved, pos: [70, 4, -9] };
    b.s.send({ t: 'input', seq: 1, time: 0, mode: 'ship', pose: again, buttons: 0 });
    await handled(b.s);
    expect(persistence.saveNow(CHARACTER)).toBe(true);
    expect(await persistence.flush()).toBe(true);
    expect(persistence.stats().stale).toBe(0);
    expect(store.rows.get(CHARACTER)!.state.pose?.data).toMatchObject({ pose: { pos: [70, 4, -9] } });
    b.s.close();
  });
});
