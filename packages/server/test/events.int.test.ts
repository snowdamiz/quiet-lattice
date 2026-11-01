// World events over the wire (P2.E21.T01), against the dockerised Postgres and Redis, with raw-pose bots (movement off, so
// a bot is wherever it says): an event run in the bots' home system is announced to them with its place; a bot that goes
// there is put in an instance scaled to it alone (level 1), faces waves of the world's creatures that only its instance
// sees, shows the event's name in a call-for-aid listing, and is paid by its contribution when the waves are cleared.
// Fifteen bots that go there are split into an instance of 12 and one of 3, each scaled by its own count (its waves'
// size and its enemies' health); the damage each did decides its pay, not who landed the last hit, and those who did
// nothing are paid nothing.
import { mobStats } from '@astra/shared/combat';
import { contributionShares, type EventDef } from '@astra/shared/events';
import { PROTOCOL_VERSION, type ServerMessage, type WorldEventView } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventPayout } from '../src/events/service.ts';
import type { RunningServer } from '../src/server.ts';
import type { Zone } from '../src/zones/zone.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer({}, { movement: false });
});

afterAll(async () => {
  await server?.close();
});

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** An event for the bots' home system: two waves of two of its world's creatures at level 1, soon after an instance opens. */
const drill = (): EventDef => ({
  id: 'drill',
  name: `Drill ${uid()}`,
  kind: 'waves',
  tiers: [0, 5],
  schedule: { everyS: 86400, durationS: 1200, announceS: 0, stagger: false },
  place: { kind: 'surface', radius: 400 },
  enemies: { kind: 'fauna', temperaments: ['docile', 'skittish', 'territorial', 'predator'], level: 3 },
  waves: { count: 2, size: 2, firstS: 1, gapS: 0.5 },
  scaling: { sizePerPlayer: 0.5, healthPerPlayer: 0.1 },
  contribution: { damage: 0.6, objective: 0.25, presence: 0.15 },
  rewards: { xp: 400, units: 120, items: [{ item: 'count_residue', count: 2 }], rep: [] },
});

/** A bot in the world, docked at its home Waystation: signed in, joined, acknowledging every snapshot. */
async function bot() {
  const { token } = await newAccount(server);
  const characterId = (await newCharacter(server, token, { people: 'thalune' })).id;
  const sock = await TestSocket.open(server.wsUrl);
  const client = new SnapshotClient();
  sock.ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const snap = client.receive(new Uint8Array(data as Buffer));
    sock.send({ t: 'ack', tick: snap.tick });
  });
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome', 15_000);
  const zone = server.zones.zone(welcome.zone.id)!;
  const session = [...server.ws.registry.sessions].find((s) => s.characterId === characterId && s.entityId === welcome.entityId)!;
  let seq = 0;
  const b = {
    characterId,
    name: welcome.character.name,
    sock,
    session,
    zone,
    entityId: welcome.entityId,
    /** messages of a type it was sent so far */
    of<K extends ServerMessage['t']>(t: K): Extract<ServerMessage, { t: K }>[] {
      return sock.received.filter((m): m is Extract<ServerMessage, { t: K }> => m.t === t);
    },
    /** stands (raw pose: movement is off) at `pos` in `frame` */
    goTo(frame: string, pos: readonly number[]) {
      sock.send({
        t: 'input',
        seq: ++seq,
        time: 0,
        mode: 'foot',
        pose: { frame, pos: [pos[0]!, pos[1]!, pos[2]!], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
        buttons: 0,
      });
    },
    /** its entity's world position is within `r` of the event's place */
    inside(e: WorldEventView) {
      const c = zone.toWorld(e.frame, e.center);
      const w = zone.entity(b.entityId)?.world;
      return !!w && Math.hypot(w[0] - c[0], w[1] - c[1], w[2] - c[2]) <= e.radius;
    },
    status: () => b.of('event_status').at(-1),
  };
  return b;
}
type Bot = Awaited<ReturnType<typeof bot>>;

async function bots(n: number): Promise<Bot[]> {
  const out: Bot[] = [];
  for (let i = 0; i < n; i += 5) out.push(...(await Promise.all(Array.from({ length: Math.min(5, n - i) }, () => bot()))));
  return out;
}

async function close(...all: Bot[]): Promise<void> {
  for (const b of all) b.sock.close();
  await Promise.all(all.map((b) => b.sock.closed));
}

/** Runs `def` in the bots' zone, announced to them; every bot goes to its place, and then it starts. */
async function startWith(def: EventDef, all: Bot[]) {
  const zone = all[0]!.zone;
  const id = server.ws.events.run(def, zone.id, { startsIn: 600 });
  // (its place waits for the world's ground, planned in the worker)
  await waitFor(() => all.every((b) => b.of('world_event').some((m) => m.op === 'announced' && m.event.id === id)), 30_000, 'the announcement');
  const event = all[0]!.of('world_event').find((m) => m.event.id === id)!.event;
  expect(event).toMatchObject({ event: 'drill', name: def.name, system: zone.systemIndex, radius: 400 });
  all.forEach((b, i) => b.goTo(event.frame!, [event.center[0] + (i % 4) * 3, event.center[1] + Math.floor(i / 4) * 3, event.center[2]]));
  await waitFor(() => all.every((b) => b.inside(event)), 5000, 'every bot at the place');
  expect(server.ws.events.startNow(id)).toBe(true);
  await waitFor(() => all.every((b) => b.of('world_event').some((m) => m.op === 'started' && m.event.id === id)), 5000, 'the start');
  await waitFor(() => all.every((b) => b.status()?.id === id), 5000, 'every bot in an instance');
  return { id, event, zone };
}

const instances = (id: number) => server.ws.events.list().find((o) => o.id === id)?.instances ?? [];

/** The health a creature's mob stats give it at level 3. */
function baseHealth(zone: Zone, mob: number): number {
  const c = zone.fauna!.creature(mob)!;
  return mobStats({ kind: 'fauna', bodyPlan: c.species.bodyPlan, temperament: c.species.temperament }, 3).health!;
}

/** Each of `mobs` hurt by each bot in turn, by its fraction of the creature's health: the last bot's hit kills. */
function fight(zone: Zone, mobs: readonly number[], by: readonly [Bot, number][]): void {
  for (const id of mobs) {
    const max = zone.combat.creatureHealth(id)!.max;
    for (const [b, f] of by) zone.combat.applyDamage(b.entityId, id, { base: max * f, kind: 'weapon' });
  }
}

describe('world events over the wire', () => {
  it('scales one player’s instance to level 1, names its place in a beacon and pays it for clearing the waves', { timeout: 120_000 }, async () => {
    const [a] = await bots(1);
    const def = drill();
    const payouts: EventPayout[][] = [];
    const off = server.ws.events.subscribe((p) => payouts.push([...p]));
    const { id, zone } = await startWith(def, [a!]);
    expect(a!.status()).toMatchObject({ id, level: 1, players: 1, waves: 2 });
    const [inst] = instances(id);
    expect(zone.phases.phaseOf(a!.entityId)).toBe(inst!.phase);

    // a call for aid from inside it lists the event by its name
    a!.sock.send({ t: 'beacon', op: { op: 'raise' } });
    await waitFor(() => a!.of('beacon').some((m) => m.op === 'raised'), 5000, 'the beacon');
    expect(a!.of('beacon').find((m) => m.op === 'raised')!.beacon).toMatchObject({ kind: 'event', place: def.name, open: 11, cap: 12 });

    const unitsBefore = server.ws.inventory.get(a!.characterId)!.units;
    for (let wave = 1; wave <= 2; wave++) {
      await waitFor(() => instances(id)[0]?.wave === wave && instances(id)[0]!.mobs.length > 0, 10_000, `wave ${wave}`);
      const mobs = instances(id)[0]!.mobs;
      expect(mobs).toHaveLength(2);
      for (const m of mobs) {
        // level 1: its mob stats' health; the instance's own, which the bot sees
        expect(zone.combat.creatureHealth(m)!.max).toBeCloseTo(baseHealth(zone, m), 9);
        expect(zone.phases.phaseOf(m)).toBe(inst!.phase);
      }
      await waitFor(() => mobs.every((m) => zone.sees(a!.session, m)), 5000, 'the wave in the bot’s sight');
      fight(zone, mobs, [[a!, 1]]);
    }
    await waitFor(() => a!.of('event_reward').length > 0, 10_000, 'the reward');
    const reward = a!.of('event_reward')[0]!;
    expect(reward).toMatchObject({
      id,
      outcome: 'completed',
      share: 1,
      xp: def.rewards.xp,
      units: def.rewards.units,
      items: [{ item: 'count_residue', count: 2 }],
    });
    expect(payouts.at(-1)).toEqual([{ character: a!.characterId, share: 1, xp: 400, units: 120, items: [{ item: 'count_residue', count: 2 }], rep: [] }]);
    // the units reached its inventory beside the kills' own loot
    const kills = a!.sock.received.flatMap((m) => (m.t === 'event' && m.event.kind === 'loot' && m.event.item === 'units' ? [m.event.count] : []));
    await waitFor(() => server.ws.inventory.get(a!.characterId)!.units === unitsBefore + 120 + kills.reduce((s, x) => s + x, 0), 5000, 'the units');
    // the event is over: the system hears it was cleared, and the bot is back in the shared world
    await waitFor(() => a!.of('world_event').some((m) => m.op === 'ended' && m.event.id === id), 5000, 'the end');
    expect(a!.of('world_event').find((m) => m.op === 'ended')).toMatchObject({ outcome: 'completed' });
    expect(zone.phases.phaseOf(a!.entityId)).toBeNull();
    expect(a!.sock.errors).toEqual([]);
    off();
    await close(a!);
  });

  it('splits 15 players into instances of 12 and 3, scales each by its count, and pays each by what it did', { timeout: 180_000 }, async () => {
    const all = await bots(15);
    expect(new Set(all.map((b) => b.zone)).size).toBe(1);
    const def = drill();
    const payouts: EventPayout[][] = [];
    const off = server.ws.events.subscribe((p) => payouts.push([...p]));
    const { id, zone } = await startWith(def, all);

    // a 13th opened another instance: 12 and 3, each at its own level, and every bot told its own
    const [big, small] = [...instances(id)].sort((x, y) => y.players - x.players);
    expect([big!.players, small!.players]).toEqual([12, 3]);
    expect([big!.level, small!.level]).toEqual([12, 3]);
    const inBig = all.filter((b) => zone.phases.phaseOf(b.entityId) === big!.phase);
    const inSmall = all.filter((b) => zone.phases.phaseOf(b.entityId) === small!.phase);
    expect([inBig.length, inSmall.length]).toEqual([12, 3]);
    await waitFor(() => all.every((b) => b.status()!.level === (inBig.includes(b) ? 12 : 3)), 5000, 'every bot told its level');

    // each instance's waves are its own size, its enemies' health its own scaling
    const [a, b] = inBig;
    const [c] = inSmall;
    for (let wave = 1; wave <= 2; wave++) {
      await waitFor(
        () => instances(id).every((i) => i.wave === wave && i.mobs.length > 0) && instances(id).length === 2,
        15_000,
        `wave ${wave} in both instances`,
      );
      const now = instances(id);
      const bigMobs = now.find((i) => i.phase === big!.phase)!.mobs;
      const smallMobs = now.find((i) => i.phase === small!.phase)!.mobs;
      // (2 at level 1, half as many again per player above it: 13 at 12, 4 at 3; health 10% more per player)
      expect(bigMobs).toHaveLength(13);
      expect(smallMobs).toHaveLength(4);
      for (const m of bigMobs) expect(zone.combat.creatureHealth(m)!.max).toBeCloseTo(baseHealth(zone, m) * 2.1, 9);
      for (const m of smallMobs) expect(zone.combat.creatureHealth(m)!.max).toBeCloseTo(baseHealth(zone, m) * 1.2, 9);
      // in the big one a does 70% of each enemy and b the rest, every last hit b's; in the small one c does it all
      fight(zone, bigMobs, [
        [a!, 0.7],
        [b!, 0.7],
      ]);
      fight(zone, smallMobs, [[c!, 1]]);
    }

    // the scores as the last enemies fell: a's damage over twice b's, nobody else's
    await waitFor(() => payouts.length === 2, 15_000, 'both instances paid');
    const bigPay = payouts.find((p) => p.some((x) => x.character === a!.characterId))!;
    const smallPay = payouts.find((p) => p.some((x) => x.character === c!.characterId))!;
    const pay = (bot: Bot, of: EventPayout[]) => of.find((x) => x.character === bot.characterId)!;
    expect(bigPay).toHaveLength(12);
    expect(smallPay).toHaveLength(3);
    // two paid in the big one, the pool twice the per-player rewards, split by share: a more than b, the last hitter
    expect(pay(a!, bigPay).xp + pay(b!, bigPay).xp).toBe(2 * def.rewards.xp);
    expect(pay(a!, bigPay).xp).toBeGreaterThan(pay(b!, bigPay).xp);
    const shares = contributionShares(def.contribution, [
      [a!.characterId, { damage: 0.7, objective: 0, presence: 1 }],
      [b!.characterId, { damage: 0.3, objective: 0, presence: 1 }],
    ]);
    expect(pay(a!, bigPay).share).toBeCloseTo(shares.get(a!.characterId)!, 2);
    for (const idle of inBig.slice(2)) expect(pay(idle, bigPay)).toMatchObject({ share: 0, xp: 0, units: 0, items: [] });
    // the small one: c alone did it, and takes one player's rewards
    expect(pay(c!, smallPay)).toMatchObject({ share: 1, xp: def.rewards.xp, units: def.rewards.units });
    for (const idle of inSmall.slice(1)) expect(pay(idle, smallPay).xp).toBe(0);
    // each told its own
    await waitFor(() => all.every((x) => x.of('event_reward').length === 1), 5000, 'every bot told its reward');
    expect(a!.of('event_reward')[0]).toMatchObject({ outcome: 'completed', xp: pay(a!, bigPay).xp, units: pay(a!, bigPay).units });
    await waitFor(() => all.every((x) => x.of('world_event').some((m) => m.op === 'ended' && m.event.id === id)), 5000, 'the end');
    expect(all[0]!.of('world_event').find((m) => m.op === 'ended')).toMatchObject({ outcome: 'completed' });
    off();
    await close(...all);
  });
});
