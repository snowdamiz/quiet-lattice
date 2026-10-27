// Mining over the wire (P1.E13.T01), against the dockerised Postgres and Redis: two bots stand by a mineral deposit on
// their home world and mine it together. The server answers every hit; their damage adds up on the one node; it breaks
// once, its yield split between them by the damage each did and granted into their inventories (pushed as inventory
// state); both are sent the node's cell as harvested, are refused while it is, and see it grow back on its timer. Hits
// from too far, too fast, through a hill or from a ship are refused.
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { nodeType } from '@astra/shared/world';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { miningWorld, norm, type NodeSpot, type Vec3 } from './resourceWorld.ts';

type Mine = Extract<ServerMessage, { t: 'mine' }>;
type Nodes = Extract<ServerMessage, { t: 'nodes' }>;

let server: RunningServer;
let world: ReturnType<typeof miningWorld>;
let deposit: NodeSpot;
const home = homeSystemOf('thalune');
const RESPAWN_S = 3;

beforeAll(async () => {
  server = await startTestServer();
  // (a node grows back in minutes; here in seconds, so the timer can be watched)
  server.ws.resources.respawnSeconds = () => RESPAWN_S;
  world = miningWorld(home, 0);
  deposit = world.findNode({ want: (t) => nodeType(t).kind === 'deposit' });
});

afterAll(async () => {
  await server?.close();
});

/** A bot signed in and joined, able to stand anywhere on its home world and to mine. */
async function bot() {
  const acct = await newAccount(server);
  const characterId = (await newCharacter(server, acct.token, { people: 'thalune' })).id;
  const sock = await TestSocket.open(server.wsUrl);
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  const zone = server.zones.zone(welcome.zone.id)!;
  const sentAt = Date.now();
  const time = () => welcome.serverTime + (Date.now() - sentAt) / 1000;
  let inputSeq = 0;
  let mineSeq = 0;
  /** shares of nodes another bot broke, put aside while waiting for an answer */
  const shares: Mine[] = [];
  return {
    sock,
    shares,
    characterId,
    /** stands at a point of the world, on foot (or in another mode), and waits for the server to have it there */
    async stand(pos: Readonly<Vec3>, mode: 'foot' | 'ship' = 'foot') {
      sock.send({
        t: 'input',
        seq: ++inputSeq,
        time: time(),
        mode,
        pose: { frame: world.frame, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
        buttons: 0,
      });
      await waitFor(() => {
        const f = zone.entity(welcome.entityId)?.fields;
        return f?.mode === mode && f.frame === world.frame && Math.hypot(f.pos[0] - pos[0], f.pos[1] - pos[1], f.pos[2] - pos[2]) < 1e-6;
      });
    },
    /** sends a hit on a node; the server's answer to it */
    async hit(node: string): Promise<Mine> {
      const seq = ++mineSeq;
      sock.send({ t: 'mine', seq, frame: world.frame, node, tool: 'multitool', time: time() });
      for (;;) {
        const m = await sock.next('mine');
        if (m.seq === seq) return m;
        // (a share of a node another broke, kept for the test to read)
        shares.push(m);
      }
    },
    /** sends hits without waiting */
    burst(node: string, n: number) {
      for (let i = 0; i < n; i++) sock.send({ t: 'mine', seq: ++mineSeq, frame: world.frame, node, tool: 'multitool', time: time() });
      return mineSeq;
    },
    /** the next `nodes` message that says something of this cell */
    async cell(id: string, timeoutMs = 5000): Promise<Nodes['cells'][number]> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const m = await sock.next('nodes', Math.max(1, deadline - Date.now()));
        const c = m.cells.find((x) => x.cell === id);
        if (c) return c;
      }
    },
    held(item: string): number {
      const inv = server.ws.inventory.get(characterId)!;
      return [...inv.suit, ...inv.pods.flat()].reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mining over the wire', () => {
  it('two players mine one node: damage shared, one yield split between them, both see it harvested and grow back', async () => {
    const a = await bot();
    const b = await bot();
    const type = nodeType(deposit.node.type);
    const cell = deposit.id.split('_').slice(0, 3).join('_');
    const sub = deposit.id.slice(cell.length + 1);
    const before = { a: a.held(type.resource), b: b.held(type.resource) };
    await a.stand(deposit.stand);
    await b.stand(deposit.stand);
    // both are sent the world as they arrive on it
    expect((await a.sock.next('nodes')).reset).toBe(true);
    expect((await b.sock.next('nodes')).reset).toBe(true);
    // the world's ground is planned in a worker as they arrive: a hit before it is ready is `busy`
    let first = await a.hit(deposit.id);
    for (let i = 0; first.reason === 'busy' && i < 100; i++) {
      await sleep(100);
      first = await a.hit(deposit.id);
    }
    expect(first).toMatchObject({ result: 'hit', node: deposit.id, frame: world.frame });
    // b's hit lands on the same node: less of it is left than a's hit left
    await sleep(250);
    const second = await b.hit(deposit.id);
    expect(second.result).toBe('hit');
    expect(second.hp!).toBeLessThan(first.hp!);
    // b sees a's damage as a hurt node in the cell
    const hurt = await b.cell(cell);
    expect(hurt.hurt.map(([s]) => s)).toEqual([sub]);
    // they beam on together until it breaks
    let broke: { by: 'a' | 'b'; m: Mine } | null = null;
    for (let i = 0; i < 60 && !broke; i++) {
      await sleep(250);
      for (const [name, v] of [['a', a] as const, ['b', b] as const]) {
        const m = await v.hit(deposit.id);
        if (m.result === 'depleted') {
          broke = { by: name, m };
          break;
        }
        expect(m.result).toBe('hit');
      }
    }
    expect(broke).not.toBeNull();
    const breaker = broke!.by === 'a' ? a : b;
    const other = broke!.by === 'a' ? b : a;
    // the other hears its share unasked
    const share = other.shares.find((m) => m.result === 'depleted') ?? (await other.sock.next('mine'));
    expect(share).toMatchObject({ seq: 0, result: 'depleted', node: deposit.id, item: type.resource });
    const got = { breaker: broke!.m.count!, other: share.count! };
    expect(got.breaker + got.other).toBeGreaterThanOrEqual(type.yield[0]);
    expect(got.breaker + got.other).toBeLessThanOrEqual(type.yield[1]);
    expect(got.breaker).toBeGreaterThan(0);
    expect(got.other).toBeGreaterThan(0);
    // granted into their inventories, which were pushed to them
    await waitFor(() => breaker.held(type.resource) - (breaker === a ? before.a : before.b) === got.breaker, 2000, 'the breaker’s grant');
    await waitFor(() => other.held(type.resource) - (other === a ? before.a : before.b) === got.other, 2000, 'the other’s grant');
    await a.sock.next('inventory');
    await b.sock.next('inventory');
    // both see it harvested, and are refused while it is
    for (const v of [a, b]) {
      let c = await v.cell(cell);
      while (!c.gone.includes(sub)) c = await v.cell(cell);
      expect(c.gone).toEqual([sub]);
    }
    expect((await a.hit(deposit.id)).reason).toBe('harvested');
    expect((await b.hit(deposit.id)).reason).toBe('harvested');
    // it grows back on its timer: both are sent the cell as the scatter has it again
    const brokeAt = Date.now();
    for (const v of [a, b]) {
      let c = await v.cell(cell, 8000);
      while (c.gone.length) c = await v.cell(cell, 8000);
      expect(c).toEqual({ cell, gone: [], hurt: [] });
    }
    expect(Date.now() - brokeAt).toBeGreaterThan((RESPAWN_S - 1) * 1000);
    await sleep(300);
    expect(await a.hit(deposit.id)).toMatchObject({ result: 'hit' });
    a.sock.close();
    b.sock.close();
  });

  it('refuses hits from too far, too fast, through a hill and from a ship', async () => {
    const a = await bot();
    const other = world.findNode({ want: (t) => nodeType(t).kind === 'deposit', skip: 40 });
    await a.stand(other.stand);
    let r = await a.hit(other.id);
    for (let i = 0; r.reason === 'busy' && i < 100; i++) {
      await sleep(100);
      r = await a.hit(other.id);
    }
    expect(r.result).toBe('hit');
    // too far: refused before the server scatters a cell
    const scattered = server.ws.resources.stats().scattered;
    await a.stand(world.onGround(norm(other.stand), 300, 0));
    expect((await a.hit(other.id)).reason).toBe('range');
    expect(server.ws.resources.stats().scattered).toBe(scattered);
    // from a ship
    await a.stand(other.stand, 'ship');
    expect((await a.hit(other.id)).reason).toBe('mode');
    // through a hill
    const hill = world.findNode({ blocked: true });
    await a.stand(hill.stand);
    await sleep(600);
    expect((await a.hit(hill.id)).reason).toBe('los');
    // too fast: past the burst, refused `rate`
    await a.stand(other.stand);
    await sleep(1500);
    const last = a.burst(other.id, 20);
    const answers: Mine[] = [];
    while (answers.length < 20) answers.push(await a.sock.next('mine'));
    expect(answers.at(-1)!.seq).toBe(last);
    expect(answers.filter((m) => m.reason === 'rate').length).toBeGreaterThanOrEqual(10);
    a.sock.close();
  });
});
