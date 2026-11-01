// The exo-suit's meters over the socket against the dockerised Postgres and Redis (P1.E06.T06): a character on foot drains on
// the worlds the server believes it is on, the server's clock stepped by hand; regains in a station and where nothing is hard;
// refills at the line spend real inventory (raw units, then crafted cartridges) and the client hears the inventory change;
// Exo-suit nodes bought mid-session change the drain; health is lost at zero and regained in combat's suit vitals; a hazard
// death is decided by the server with the client sending nothing; and the meters survive leaving.
import { footHazard, SUIT } from '@astra/shared/data';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@astra/shared/protocol';
import { countOf } from '@astra/shared/inventory';
import { dirToLocal, systemPoses, type Vec3 } from '@astra/shared/world';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf, systemSeed } from '../src/world/home.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';

type Input = Extract<ClientMessage, { t: 'input' }>;
type Meters = Extract<ServerMessage, { t: 'meters' }>;

const config = parseConfig(process.env);
const running = new Set<RunningServer>();
let database: Database;

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL);
  database = createDatabase(config.DATABASE_URL, { max: 2 });
});

afterAll(async () => {
  await Promise.all([...running].map((s) => s.close()));
  await database?.close();
});

const HOME = homeSystemOf('thalune');
const SYSTEM = describeZoneSystem(HOME);
const FROZEN = SYSTEM.bodies.findIndex((b) => b.type === 'frozen');
const VOLCANIC = SYSTEM.bodies.findIndex((b) => b.type === 'volcanic');
const TOXIC = SYSTEM.bodies.findIndex((b) => b.type === 'toxic');
const INFERNO = SYSTEM.bodies.findIndex((b) => b.params.hazard?.kind === 'heat');

/** A server whose clock stands where the test puts it: it runs on the real one until the first `advance`. */
async function start(shard?: string) {
  let mono = performance.now();
  const server = await startTestServer({}, { movement: false, clock: { monoNow: () => mono }, ...(shard ? { shard } : {}) });
  running.add(server);
  return {
    server,
    clock: () => server.world.clock.now(),
    advance: (s: number) => void (mono += s * 1000),
    async stop() {
      await server.close();
      running.delete(server);
    },
  };
}

type Rig = Awaited<ReturnType<typeof start>>;

async function join(rig: Rig, token: string, characterId: string) {
  const s = await TestSocket.open(rig.server.wsUrl);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  s.send({ t: 'join', characterId });
  const welcome = await s.next('welcome');
  const meters = await s.next('meters');
  return { s, welcome, meters: meters.meters, zone: rig.server.zones.zone(welcome.zone.id)!, entity: welcome.entityId };
}

type Joined = Awaited<ReturnType<typeof join>>;

/** A character on a fresh server, its client scripted: raw poses, no movement authority. */
async function character(rig: Rig, level = 1) {
  const acct = await newAccount(rig.server);
  const c = await newCharacter(rig.server, acct.token, { people: 'thalune' });
  if (level > 1) await database.db.update(characters).set({ level }).where(eq(characters.id, c.id));
  const j = await join(rig, acct.token, c.id);
  let seq = 0;
  const send = (mode: Input['mode'], frame: string | null, pos: Vec3) =>
    j.s.send({ t: 'input', seq: ++seq, time: 0, mode, pose: { frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
  let pings = 0;
  /** Resolves once the server has handled everything this socket sent before. */
  const handled = async () => {
    const id = ++pings;
    j.s.send({ t: 'ping', id, clientTime: 0 });
    for (;;) if ((await j.s.next('pong')).id === id) return;
  };
  /** Stands on body `i`, day or night side, `alt` m over its sea level, and has the server hear it. */
  const stand = async (i: number, night = false, alt = 2) => {
    // (where the bodies are is the zone's last tick's: let it catch up with the stepped clock)
    await waitFor(() => j.zone.time >= rig.clock() - 0.2, 5000, 'the zone tick');
    const body = systemPoses(SYSTEM, j.zone.time).bodies[i]!;
    const [x, y, z] = body.position;
    const l = Math.hypot(x, y, z);
    const sign = night ? 1 : -1;
    const local = dirToLocal(body, [(sign * x) / l, (sign * y) / l, (sign * z) / l]);
    const r = SYSTEM.bodies[i]!.radius + alt;
    send('foot', `${systemSeed(HOME)}:${i}`, [local[0] * r, local[1] * r, local[2] * r]);
    await handled();
  };
  const sweep = () => rig.server.ws.meters.sweep(rig.clock());
  return {
    ...j,
    id: c.id,
    token: acct.token,
    send,
    handled,
    stand,
    sweep,
    /** The server's clock on `s` seconds, then its sweep. */
    async wait(s: number) {
      rig.advance(s);
      sweep();
      await handled();
    },
    view: () => rig.server.ws.meters.view(c.id, rig.clock()),
    held: (item: string) => countOf(rig.server.ws.inventory.get(c.id)!, item),
    grant: (item: string, n: number) => rig.server.ws.inventory.grant(c.id, item, n),
    health: () => j.zone.combat.playerHealth(j.entity)!,
  };
}

type Walker = Awaited<ReturnType<typeof character>>;

/** The meters state that satisfies `cond`, from those received so far or still to come. */
async function metersWhere(w: Joined, cond: (m: Meters['meters']) => boolean, timeoutMs = 5000): Promise<Meters['meters']> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const hit = w.s.received.find((m): m is Meters => m.t === 'meters' && cond(m.meters));
    if (hit) return hit.meters;
    if (Date.now() > end) throw new Error('no such meters state');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('the suit drains on the worlds the server believes the character is on', () => {
  it('drains life support and hazard protection on a frozen world by its strength, ×1.4 at night, and pushes them', async () => {
    const rig = await start();
    const w = await character(rig);
    expect(w.meters).toMatchObject({ lifeSupport: 100, hazard: 100 });
    await w.stand(FROZEN);
    await w.wait(10);
    expect(w.view().hazard).toBeCloseTo(100 - 10 * SUIT.hazardDrainPerS * footHazard('frozen', null), 3);
    expect(w.view().lifeSupport).toBeCloseTo(100 - 10 * SUIT.lifeSupportDrainPerS, 3);
    const pushed = await metersWhere(w, (m) => m.hazard < 95);
    expect(pushed.lifeSupport).toBeLessThan(97);

    await w.stand(FROZEN, true);
    const before = w.view().hazard;
    await w.wait(10);
    expect(before - w.view().hazard).toBeCloseTo(10 * 0.6 * 1.4, 2);
    w.s.close();
    await rig.stop();
  }, 60_000);

  it.each([
    ['a volcanic world’s own hazard', VOLCANIC],
    ['a toxic world’s own hazard', TOXIC],
    ['a heat hazard (the inferno’s ship hazard on foot)', INFERNO],
  ])(
    'drains by %s',
    async (_, body) => {
      expect(body).toBeGreaterThanOrEqual(0);
      const b = SYSTEM.bodies[body]!;
      const strength = footHazard(b.type, b.params.hazard ?? null);
      expect(strength).toBeGreaterThan(0);
      const rig = await start();
      const w = await character(rig);
      await w.stand(body);
      await w.wait(5);
      expect(w.view().hazard).toBeCloseTo(100 - 5 * SUIT.hazardDrainPerS * strength, 3);
      w.s.close();
      await rig.stop();
    },
    60_000,
  );

  it('regains hazard protection where nothing is hard, and both inside a station', async () => {
    const rig = await start();
    const w = await character(rig);
    await w.stand(FROZEN);
    await w.wait(30);
    const drained = w.view();
    expect(drained.hazard).toBeLessThan(85);
    // the lush home world: nothing hard, life support still drains
    await w.stand(SYSTEM.home);
    await w.wait(10);
    expect(w.view().hazard).toBeCloseTo(Math.min(100, drained.hazard + 10 * SUIT.hazardRegenPerS), 2);
    expect(w.view().lifeSupport).toBeLessThan(drained.lifeSupport);
    const frame = w.welcome.pose.frame;
    w.send('foot', frame, [-22, 0, -22]);
    await w.handled();
    await w.wait(30);
    expect(w.view()).toMatchObject({ lifeSupport: 100, hazard: 100 });
    w.s.close();
    await rig.stop();
  }, 60_000);

  it('does not move aboard the ship, and the ship tops it up', async () => {
    const rig = await start();
    const w = await character(rig);
    await w.stand(FROZEN);
    await w.wait(30);
    expect(w.view().hazard).toBeLessThan(85);
    const at = systemPoses(SYSTEM, rig.clock()).bodies[FROZEN]!.position;
    w.send('landed', `${systemSeed(HOME)}:${FROZEN}`, [0, SYSTEM.bodies[FROZEN]!.radius + 2, 0]);
    await w.handled();
    expect(at).toBeDefined();
    expect(w.view()).toMatchObject({ lifeSupport: 100, hazard: 100 });
    await w.wait(60);
    expect(w.view()).toMatchObject({ lifeSupport: 100, hazard: 100 });
    w.s.close();
    await rig.stop();
  }, 60_000);

  it('Exo-suit nodes bought mid-session change the drain from then: Hazard Weave ×0.6, Second Lung ×0.7', async () => {
    const rig = await start();
    const w = await character(rig, 15);
    await w.stand(FROZEN);
    await w.wait(10);
    const base = w.view();
    for (const node of ['cartridge_recycler', 'hazard_weave', 'second_lung']) {
      const unlocked = rig.server.ws.skills.unlock(w.id, node, { kind: 'dev' });
      expect(unlocked.ok || unlocked.error.code === 'already_unlocked', `${node} ${JSON.stringify(unlocked)}`).toBe(true);
      const bought = rig.server.ws.skills.buy(w.id, node);
      expect(bought.ok, `${node} ${JSON.stringify(bought)}`).toBe(true);
    }
    await w.wait(10);
    const after = w.view();
    expect(base.hazard - after.hazard).toBeCloseTo(10 * 0.6 * 0.6, 3);
    expect(base.lifeSupport - after.lifeSupport).toBeCloseTo(10 * 0.35 * 0.7, 3);
    w.s.close();
    await rig.stop();
  }, 60_000);
});

describe('refills at the line spend the server’s inventory', () => {
  /** A walker on the frozen world whose hazard protection stands just above the refill line. */
  async function nearLine(rig: Rig, w: Walker) {
    rig.server.ws.meters.open(w.id, { heat: 0, overheated: false, charge: 100, lifeSupport: 100, hazard: 28, at: rig.clock() });
    await w.stand(FROZEN);
  }

  it('takes 10 raw sodium, restores 40, and sends the inventory change and a toast', async () => {
    const rig = await start();
    const w = await character(rig);
    w.grant('sodium', 50);
    await nearLine(rig, w);
    const seen = w.s.received.length;
    await w.wait(10);
    expect(w.held('sodium')).toBe(40);
    // 28 → 25 in 5 s, +40, 5 s more
    expect(w.view().hazard).toBeCloseTo(25 + 40 - 5 * 0.6, 3);
    await waitFor(() => w.s.received.slice(seen).some((m) => m.t === 'inventory' && countOf(m.inventory, 'sodium') === 40), 5000, 'the inventory change');
    const toast = w.s.received.slice(seen).find((m) => m.t === 'event' && m.event.kind === 'notice' && m.event.text === 'Hazard protection recharged');
    expect(toast).toBeDefined();
    w.s.close();
    await rig.stop();
  }, 60_000);

  it('takes a crafted cartridge before raw units, and Cartridge Recycler adds its 20 to both', async () => {
    const rig = await start();
    const w = await character(rig);
    w.grant('sodium', 50);
    w.grant('sodium_cartridge', 1);
    expect(rig.server.ws.skills.unlock(w.id, 'cartridge_recycler', { kind: 'dev' }).ok).toBe(true);
    expect(rig.server.ws.skills.buy(w.id, 'cartridge_recycler')).toMatchObject({ ok: true });
    await nearLine(rig, w);
    await w.wait(6);
    expect(w.held('sodium_cartridge')).toBe(0);
    expect(w.held('sodium')).toBe(50);
    expect(w.view().hazard).toBeCloseTo(Math.min(100, 25 + 80) - 0.6, 3);
    w.s.close();
    await rig.stop();
  }, 60_000);

  it('refills life support from oxygen, and nothing at all without enough in the pack', async () => {
    const rig = await start();
    const w = await character(rig);
    w.grant('oxygen', 10);
    rig.server.ws.meters.open(w.id, { heat: 0, overheated: false, charge: 100, lifeSupport: 26, hazard: 100, at: rig.clock() });
    await w.stand(SYSTEM.home);
    await w.wait(10);
    expect(w.held('oxygen')).toBe(0);
    expect(w.view().lifeSupport).toBeGreaterThan(60);
    // the pack is empty now: it drains to zero
    await w.wait(300);
    expect(w.view().lifeSupport).toBe(0);
    w.s.close();
    await rig.stop();
  }, 60_000);
});

describe('health and the hazard death', () => {
  it('is lost at 4/s at zero and regained at 1.5/s once the meter is back, in combat’s suit vitals', async () => {
    const rig = await start();
    const w = await character(rig);
    rig.server.ws.meters.open(w.id, { heat: 0, overheated: false, charge: 100, lifeSupport: 100, hazard: 0, at: rig.clock() });
    await w.stand(FROZEN);
    await w.wait(5);
    expect(w.health().suit).toBeCloseTo(100 - 5 * SUIT.healthLostPerS, 3);
    expect(w.health().down).toBeNull();
    // a refill brings it back to protected: health regained
    w.grant('sodium', 50);
    await w.wait(1);
    const low = w.health().suit;
    await w.wait(10);
    expect(w.health().suit).toBeCloseTo(Math.min(100, low + 10 * SUIT.healthRegainPerS), 1);
    w.s.close();
    await rig.stop();
  }, 60_000);

  it('a hazard death is decided by the server, the client sending nothing, told to combat’s listeners once, and the player revived in place', async () => {
    const rig = await start();
    const w = await character(rig);
    const news: unknown[] = [];
    rig.server.ws.combat.subscribe((n) => news.push(n));
    const downed = () => news.filter((n) => (n as { kind: string }).kind === 'downed');
    rig.server.ws.meters.open(w.id, { heat: 0, overheated: false, charge: 100, lifeSupport: 100, hazard: 6, at: rig.clock() });
    await w.stand(FROZEN);
    // 10 s to zero, then 25 s of 4/s: the client, sending nothing, is no part of it
    for (let i = 0; i < 4; i++) await w.wait(10);
    expect(downed()).toHaveLength(1);
    expect(downed()[0]).toMatchObject({ report: { cause: 'suit', characterId: w.id, source: null } });
    // the stopgap P1.E06.T03's Recall replaces: up where it stands at 60% health and 60/60 meters, not down for the session
    expect(w.health()).toMatchObject({ suit: w.health().suitMax * 0.6, down: null });
    expect(w.zone.combat.isDown(w.entity)).toBe(false);
    expect(w.view()).toMatchObject({ lifeSupport: 60, hazard: 60 });
    await w.wait(30);
    expect(downed()).toHaveLength(1);
    expect(w.health().down).toBeNull();
    // (a cast is judged on its merits again: this one owns nothing, and is refused for that, not for being down)
    w.s.send({ t: 'cast', seq: 1, time: rig.clock(), node: 'pulse', slot: 0, frame: `${systemSeed(HOME)}:${FROZEN}`, aim: [0, 0, -1] });
    const cast = await w.s.next('cast');
    expect(cast).toMatchObject({ seq: 1, result: 'refused', reason: 'not_owned' });
    w.s.close();
    await rig.stop();
  }, 60_000);

  it('does not kill a character that is kept supplied, or one who steps into a station in time', async () => {
    const rig = await start();
    const w = await character(rig);
    w.grant('sodium', 200);
    w.grant('oxygen', 200);
    await w.stand(FROZEN);
    for (let i = 0; i < 12; i++) await w.wait(30);
    expect(w.health().down).toBeNull();
    expect(w.health().suit).toBe(w.health().suitMax);
    expect(w.held('sodium')).toBeLessThan(200);
    w.s.close();
    await rig.stop();
  }, 60_000);
});

describe('the gateway keeps the suit on the server’s clock', () => {
  it('sweeps on its own: a silent client drains, starves and dies with no one calling the service', async () => {
    const rig = await start();
    const w = await character(rig);
    const news: unknown[] = [];
    rig.server.ws.combat.subscribe((n) => news.push(n));
    rig.server.ws.meters.open(w.id, { heat: 0, overheated: false, charge: 100, lifeSupport: 100, hazard: 6, at: rig.clock() });
    await w.stand(FROZEN);
    rig.advance(45);
    await waitFor(() => news.some((n) => (n as { kind: string }).kind === 'downed'), 5000, 'the hazard death');
    const pushed = await metersWhere(w, (m) => m.hazard === 0);
    expect(pushed.lifeSupport).toBeLessThan(100);
    w.s.close();
    await rig.stop();
  }, 60_000);

  it('knows when the character is in combat (Second Skin’s floor holds only out of it)', async () => {
    const rig = await start();
    const w = await character(rig);
    expect(rig.server.ws.meters.inCombat?.(w.id)).toBe(false);
    rig.server.ws.combat.hooks.engaged?.(w.id, rig.clock());
    expect(rig.server.ws.meters.inCombat?.(w.id)).toBe(true);
    rig.advance(10);
    expect(rig.server.ws.meters.inCombat?.(w.id)).toBe(false);
    w.s.close();
    await rig.stop();
  }, 60_000);
});

describe('the suit is kept', () => {
  it('across leaving: as it was left, with nothing drained while away', async () => {
    const rig = await start();
    const w = await character(rig);
    await w.stand(FROZEN);
    await w.wait(20);
    const left = w.view();
    w.s.close();
    await w.s.closed;
    rig.advance(600);
    const again = await join(rig, w.token, w.id);
    expect(again.meters.lifeSupport).toBeCloseTo(left.lifeSupport, 2);
    expect(again.meters.hazard).toBeCloseTo(left.hazard, 2);
    expect(again.meters.hazard).toBeLessThan(95);
    again.s.close();
    await rig.stop();
  }, 60_000);
});
