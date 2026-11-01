// Mining over the wire (P1.E13.T01), against the dockerised Postgres and Redis: two bots stand by a mineral deposit on
// their home world and mine it together. The server answers every hit; their damage adds up on the one node; it breaks
// once, its yield split between them by the damage each did and granted into their inventories (pushed as inventory
// state); both are sent the node's cell as harvested, are refused while it is, and see it grow back on its timer. Hits
// from too far, too fast, through a hill or from a ship are refused, and so are hits without the beam's button held or in
// Heat's overheat lockout (P1.E07.T02); a hit is worth the beam time Heat saw fire, so pressing the button only for the
// hit earns next to nothing.
import { Buttons, PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { nodeType } from '@astra/shared/world';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { HIT_INTERVAL_S, MULTITOOL_POWER } from '../src/resources/service.ts';
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
  // (its bots stand anywhere on the world with raw poses, straight from the Waystation: no movement authority here; a hit
  // reads the mode movement authority believes, movement.int.test)
  server = await startTestServer({}, { movement: false });
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
  /** where it stands, and how (its inputs repeat it) */
  let at: { pos: Vec3; mode: 'foot' | 'ship' } = { pos: [0, 0, 0], mode: 'foot' };
  /** an input where it stands, with these buttons held */
  const press = (buttons: number) =>
    sock.send({
      t: 'input',
      seq: ++inputSeq,
      time: time(),
      mode: at.mode,
      pose: { frame: world.frame, pos: [...at.pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
      buttons,
    });
  /** shares of nodes another bot broke, put aside while waiting for an answer */
  const shares: Mine[] = [];
  let pings = 0;
  /** resolves once the server has handled everything sent before it (a ping's round trip) */
  async function handled(): Promise<void> {
    const id = ++pings;
    sock.send({ t: 'ping', id, clientTime: 0 });
    for (;;) if ((await sock.next('pong')).id === id) return;
  }
  /**
   * Sends a hit on a node and returns the server's answer to it. As a client does, the beam's button is held while the
   * beam fires: a hit interval before the hit (the beam time it is worth), let go once it is answered. `beam: 'up'` sends
   * it with the button up; `'pulsed'` presses the button only for the hit's instant, after beam time it never fired.
   */
  async function hit(node: string, { beam = 'held' }: { beam?: 'held' | 'pulsed' | 'up' } = {}): Promise<Mine> {
    const seq = ++mineSeq;
    if (beam !== 'up') press(Buttons.beam);
    if (beam === 'held') {
      // the press handled before the beam's interval is timed: a stall on the server's thread would otherwise let it land
      // with the hit, and the hit be worth next to none of the interval
      await handled();
      await sleep(HIT_INTERVAL_S * 1000);
    }
    sock.send({ t: 'mine', seq, frame: world.frame, node, tool: 'multitool', time: time() });
    if (beam === 'pulsed') press(0);
    try {
      for (;;) {
        const m = await sock.next('mine');
        if (m.seq === seq) return m;
        // (a share of a node another broke, kept for the test to read)
        shares.push(m);
      }
    } finally {
      if (beam === 'held') press(0);
    }
  }
  return {
    sock,
    shares,
    characterId,
    /** stands at a point of the world, on foot (or in another mode), and waits for the server to have it there */
    async stand(pos: Readonly<Vec3>, mode: 'foot' | 'ship' = 'foot') {
      at = { pos: [pos[0], pos[1], pos[2]], mode };
      press(0);
      await waitFor(() => {
        const f = zone.entity(welcome.entityId)?.fields;
        return f?.mode === mode && f.frame === world.frame && Math.hypot(f.pos[0] - pos[0], f.pos[1] - pos[1], f.pos[2] - pos[2]) < 1e-6;
      });
    },
    hit,
    /** waits for the world's ground, planned in a worker as a player arrives: until it is, a hit is refused `busy` (probed
     * with the button up, so the beam does not heat meanwhile) */
    async ready(node: string) {
      for (let i = 0; i < 100 && (await hit(node, { beam: 'up' })).reason === 'busy'; i++) await sleep(100);
    },
    /** sends hits without waiting, the beam held through them */
    burst(node: string, n: number) {
      press(Buttons.beam);
      for (let i = 0; i < n; i++) sock.send({ t: 'mine', seq: ++mineSeq, frame: world.frame, node, tool: 'multitool', time: time() });
      press(0);
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
    // what the quest runtime hears (its `mine` steps)
    const questEvents: [string, unknown][] = [];
    const event = server.quests.event.bind(server.quests);
    server.quests.event = (id, e) => (questEvents.push([id, e]), event(id, e));
    await a.stand(deposit.stand);
    await b.stand(deposit.stand);
    // both are sent the world as they arrive on it
    expect((await a.sock.next('nodes')).reset).toBe(true);
    expect((await b.sock.next('nodes')).reset).toBe(true);
    // the world's ground is planned in a worker as they arrive: a hit before it is ready is `busy`
    await a.ready(deposit.id);
    const first = await a.hit(deposit.id);
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
    // both shares reached the quest runtime as `mine` events of the node's type, the node the distinct thing mined
    const mined = { type: 'mine', node: type.id, id: `${world.frame}/${deposit.id}` };
    expect(questEvents.filter(([, e]) => (e as { type: string }).type === 'mine').sort()).toEqual(
      [
        [a.characterId, mined],
        [b.characterId, mined],
      ].sort(),
    );
    delete (server.quests as { event?: unknown }).event;
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
  }, 60_000);

  it('refuses hits from too far, too fast, through a hill and from a ship', async () => {
    const a = await bot();
    const other = world.findNode({ want: (t) => nodeType(t).kind === 'deposit', skip: 40 });
    await a.stand(other.stand);
    await a.ready(other.id);
    expect((await a.hit(other.id)).result).toBe('hit');
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

  it('mines only while Heat says the beam fires (the button held, out of the overheat lockout), on the beam time it saw', async () => {
    const a = await bot();
    const spot = world.findNode({ want: (t) => nodeType(t).kind === 'deposit', skip: 80 });
    const hp = nodeType(spot.node.type).hp;
    await a.stand(spot.stand);
    await a.ready(spot.id);
    expect((await a.hit(spot.id)).result).toBe('hit');
    // the button up: no beam, no hit (a client cannot mine with it off and never heat)
    await sleep(1200);
    expect(await a.hit(spot.id, { beam: 'up' })).toMatchObject({ result: 'refused', reason: 'heat' });
    // held again: it mines, a hit interval of beam
    await sleep(300);
    const held = await a.hit(spot.id);
    expect(held.result).toBe('hit');
    // pressed only for the hit's instant: it counts, but is worth only the beam the server saw fire, next to nothing (the
    // time since the last hit, 0.3 s and more, before Heat timed the beam)
    await sleep(300);
    const pulsed = await a.hit(spot.id, { beam: 'pulsed' });
    expect(pulsed.result).toBe('hit');
    expect(((held.hp! - pulsed.hp!) * hp) / MULTITOOL_POWER).toBeLessThan(0.1);
    // overheated (an ability's chunk takes it to the top): the beam is locked out, held or not
    const now = () => server.world.clock.now();
    expect(server.ws.meters.addHeat(a.characterId, 100, now())).toMatchObject({ ok: true, state: { overheated: true } });
    await sleep(300);
    expect(await a.hit(spot.id)).toMatchObject({ result: 'refused', reason: 'heat' });
    // cooled out of the lockout (100 → 25 at 20/s: 3.75 s), it mines again
    await waitFor(() => !server.ws.meters.view(a.characterId, now()).overheated, 6000, 'the lockout to lift');
    await sleep(300);
    expect((await a.hit(spot.id)).result).toBe('hit');
    a.sock.close();
  }, 30_000);
});
