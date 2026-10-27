// Combat over the wire (P1.E06.T02), against the dockerised Postgres and Redis, with movement authority on: a pilot set
// down over a world of its home system (the admin teleport, which re-seats its mover) hovers its ship legally over a test
// creature and shoots it dead with the base gun: every shot is resolved by the server from the pose it believes, the hits
// and the death come back as combat events, the corpse lies for the death beat and goes, and the kill's XP and units reach
// the character. A client that says what its shot did, or sends a combat event of its own, changes nothing.
import type { GameEvent, ServerMessage } from '@astra/shared/protocol';
import { faunaSpecies, frameId, type FaunaSpecies, type PlanetParams } from '@astra/shared/world';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creatureSphere } from '../src/combat/gun.ts';
import { DEATH_BEAT_S } from '../src/combat/zone.ts';
import type { Vec3 } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import type { RunningServer } from '../src/server.ts';
import type { Zone } from '../src/zones/zone.ts';
import { openGround } from './faunaWorld.ts';
import { startTestServer, waitFor } from './helpers.ts';
import { noseTo, Pilot } from './pilot.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const docileWalker = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer' && x.spawn === 'herd');
const unit = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

/** A world of the pilot's home system with a docile walker at the zone's tier, and an open spot on its ground. */
function worldOf(zone: Zone) {
  const tier = zone.fauna!.tier;
  const body = zone.system.bodies.find((b) => b.type !== 'gas' && docileWalker(faunaSpecies(b.params as PlanetParams, tier)));
  if (!body) throw new Error(`no world of system ${zone.systemIndex} has a docile walker at tier ${tier}`);
  const params = body.params as PlanetParams;
  const ground = groundOf(params, tier);
  const spot = openGround(ground);
  const [t, b] = tangents(spot);
  const at = (east: number, north: number, up = 0): Vec3 => {
    const x = spot[0] * ground.radius + t[0] * east + b[0] * north;
    const y = spot[1] * ground.radius + t[1] * east + b[1] * north;
    const z = spot[2] * ground.radius + t[2] * east + b[2] * north;
    const d = unit([x, y, z]);
    const r = ground.radius + ground.sample(d) + up;
    return [d[0] * r, d[1] * r, d[2] * r];
  };
  return { body, frame: frameId(zone.system.seed, body.index)!, species: docileWalker(faunaSpecies(params, tier))!, at };
}

/** The pilot's events of a kind so far. */
function events<K extends GameEvent['kind']>(p: Pilot, kind: K): Extract<GameEvent, { kind: K }>[] {
  return p.sock.received.flatMap((m) => (m.t === 'event' && m.event.kind === kind ? [m.event as Extract<GameEvent, { kind: K }>] : []));
}
const answers = (p: Pilot) => p.sock.received.filter((m): m is Extract<ServerMessage, { t: 'fire' }> => m.t === 'fire');

describe('combat over the wire', () => {
  it('lets a ship flying legally shoot a test creature dead, and gives the kill to its pilot', { timeout: 60_000 }, async () => {
    const p = await Pilot.join(server);
    const zone = server.zones.zone(p.welcome.zone.id)!;
    expect(zone.movement).not.toBeNull();
    const w = worldOf(zone);
    let fireSeq = 0;
    const fire = (aim: Vec3, extra: Record<string, unknown> = {}) =>
      p.sock.send({ t: 'fire', seq: ++fireSeq, time: p.time, frame: p.last.frame, aim, ...extra });

    // docked, the guns do not fire
    fire([0, 0, -1]);
    expect(await p.sock.next('fire')).toMatchObject({ seq: 1, result: 'refused', reason: 'mode' });

    // set down 40 m over open ground on the world (in play: by a correction, its mover re-seated there), and hovering
    const hover = w.at(0, 0, 40);
    const moved = await server.admin.run(
      { cmd: 'teleport', character: p.characterId, system: zone.systemIndex, frame: String(w.body.index), pose: hover.join(','), mode: 'ship' },
      { name: 'combat test', via: 'channel' },
    );
    expect(moved).toMatchObject({ moved: 'zone', mode: 'ship' });
    const teleport = await p.sock.next('correction');
    p.last = teleport.pose;
    await p.hold('ship', 300);
    await waitFor(() => zone.fauna!.groundReady(w.body.index), 20_000, "the world's ground planned");

    // a test creature 15 m off, on the ground below
    const spawned = zone.fauna!.spawnHerd({ body: w.body.index, species: w.species.index, at: w.at(15, 0), count: 1, level: 3 })!;
    const mob = spawned.creatures[0]!;
    const max = zone.combat.creatureHealth(mob)!.max;
    await waitFor(() => p.client.latest.get(mob)?.hp === 1, 5000, 'the creature in its snapshots');

    // a client that says what its shot did, or claims a hit of its own, changes nothing: neither is a message the server takes
    const invalidBefore = server.ws.stats().invalidMessages;
    const sphere = () => creatureSphere(zone.fauna!.creature(mob)!).pos;
    const aimAt = () => unit([sphere()[0] - p.last.pos[0], sphere()[1] - p.last.pos[1], sphere()[2] - p.last.pos[2]]);
    fire(aimAt(), { damage: 1e6 });
    fireSeq--;
    p.sock.send({ t: 'event', event: { kind: 'combat', source: p.entityId, target: mob, amount: 1e6, damageType: 'weapon', killed: true } });
    p.sock.send({ t: 'cast', seq: 1, slot: 0, aim: aimAt(), target: mob, damage: 1e6 });
    await p.hold('ship', 300);
    expect(server.ws.stats().invalidMessages).toBeGreaterThanOrEqual(invalidBefore + 2);
    expect(zone.combat.creatureHealth(mob)).toEqual({ hp: max, max, dead: false });
    expect(answers(p)).toEqual([]);
    expect(events(p, 'combat')).toEqual([]);

    // hovering, nose on it, firing a little slower than the guns' cooldown until it is dead
    const unitsBefore = server.ws.inventory.get(p.characterId)!.units;
    for (let i = 0; i < 80 && zone.fauna!.creature(mob); i++) {
      const aim = aimAt();
      p.send({ ...p.last, quat: noseTo(aim), vel: [0, 0, 0] }, 'ship');
      await sleep(25);
      if (!zone.fauna!.creature(mob)) break;
      fire(aimAt());
      await sleep(125);
    }
    expect(zone.fauna!.creature(mob)).toBeNull();
    await waitFor(() => events(p, 'combat').some((e) => e.target === mob && e.killed), 5000, 'the killing blow');
    // fighting, it may not swap its skill slots (the skill service asks combat)
    p.sock.send({ t: 'skills', seq: 1, op: { op: 'unslot', bar: 'ground', index: 0 } });
    await waitFor(() => p.sock.received.some((m) => m.t === 'skills' && m.seq === 1), 5000, 'the skills answer');
    expect(p.sock.received.find((m) => m.t === 'skills' && m.seq === 1)).toMatchObject({ error: 'in_combat' });

    // every shot was the server's: hits for the gun's damage, the death, the corpse and then nothing
    const hits = events(p, 'combat').filter((e) => e.target === mob);
    expect(hits.every((e) => e.source === p.entityId && e.damageType === 'weapon' && e.ability === 'pulse_lasers')).toBe(true);
    // (the last shot's whole damage counts, though the creature had less left)
    const dealt = hits.reduce((s, e) => s + e.amount, 0);
    expect(dealt).toBeGreaterThanOrEqual(max - 1e-9);
    expect(dealt).toBeLessThan(max + 11);
    expect(answers(p).filter((a) => a.result === 'hit').length).toBeGreaterThanOrEqual(Math.ceil(max / 11));
    expect(answers(p).filter((a) => a.result === 'refused')).toEqual([]);
    await waitFor(() => p.client.latest.get(mob)?.mode === 'dead', 2000, 'the corpse in its snapshots');
    expect(p.client.latest.get(mob)).toMatchObject({ hp: 0, mode: 'dead' });
    await waitFor(() => !p.client.latest.has(mob), (DEATH_BEAT_S + 2) * 1000, 'the corpse gone');

    // the kill is its pilot's: XP for a level-3 creature, units into its inventory, both told
    await waitFor(() => events(p, 'xp').length > 0 && events(p, 'loot').length > 0, 5000, 'the kill’s rewards');
    expect(events(p, 'xp')).toEqual([{ kind: 'xp', amount: 30, from: mob, level: 1 }]);
    const [loot] = events(p, 'loot');
    expect(loot).toMatchObject({ item: 'units', from: mob });
    expect(server.ws.inventory.get(p.characterId)!.units).toBe(unitsBefore + loot!.count);
    const pushed = p.sock.received.filter((m) => m.t === 'inventory').at(-1) as Extract<ServerMessage, { t: 'inventory' }>;
    expect(pushed.inventory.units).toBe(unitsBefore + loot!.count);

    // and all of it flying legally: the teleport's (taken above) was its only correction
    expect(p.corrections).toEqual([]);
    expect(zone.movement!.recent.filter((r) => r.entity === p.entityId)).toEqual([]);
    expect(p.errors).toEqual([]);
    p.close();
  });

  it('refuses a shot fired faster than the guns allow, or aimed off the nose', { timeout: 30_000 }, async () => {
    const p = await Pilot.join(server);
    const zone = server.zones.zone(p.welcome.zone.id)!;
    const w = worldOf(zone);
    await server.admin.run(
      { cmd: 'teleport', character: p.characterId, system: zone.systemIndex, frame: String(w.body.index), pose: w.at(200, 200, 60).join(','), mode: 'ship' },
      { name: 'combat test', via: 'channel' },
    );
    p.last = (await p.sock.next('correction')).pose;
    await p.hold('ship', 200);
    // nose down at the ground; a shot square to it is off the nose
    const nose = unit(p.last.pos.map((x) => -x));
    const square = unit([nose[1], -nose[0], 0]);
    p.send({ ...p.last, quat: noseTo(nose) }, 'ship');
    await sleep(100);
    p.sock.send({ t: 'fire', seq: 1, time: p.time, frame: p.last.frame, aim: square });
    await waitFor(() => answers(p).length === 1, 5000, 'the first answer');
    expect(answers(p)[0]).toMatchObject({ seq: 1, result: 'refused', reason: 'aim' });
    // eight at once: the guns' burst goes, and then they wait on their cooldown
    await sleep(500);
    for (let i = 2; i <= 9; i++) p.sock.send({ t: 'fire', seq: i, time: p.time, frame: p.last.frame, aim: nose });
    await waitFor(() => answers(p).length === 9, 5000, 'nine answers');
    const results = answers(p)
      .slice(1)
      .map((a) => a.reason ?? a.result);
    expect(results.slice(0, 3).every((r) => r === 'miss' || r === 'hit' || r === 'blocked')).toBe(true);
    expect(results.filter((r) => r === 'rate').length).toBeGreaterThanOrEqual(4);
    p.close();
  });
});
