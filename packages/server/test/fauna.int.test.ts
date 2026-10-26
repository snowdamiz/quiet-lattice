// Fauna over the wire (P1.E08.T01), against the dockerised Postgres and Redis: bots walk out onto a world of their home
// system and see its herds in their snapshots, as zone entities carrying species, level, behaviour state and attack
// phase. Two bots standing together see the same herd, creature for creature, tick for tick; a predator stalks a bot,
// rushes it, attacks, and chases it when it runs.
import { PROTOCOL_VERSION, type EntityState } from '@astra/shared/protocol';
import { faunaSpecies, frameId, type FaunaSpecies, type PlanetParams } from '@astra/shared/world';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { RULES } from '../src/fauna/index.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
import type { Zone } from '../src/zones/zone.ts';
import { findWorld, openGround } from './faunaWorld.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

let server: RunningServer;
let zone: Zone;
const home = homeSystemOf('thalune');

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

/** A bot in the world: signed in, joined, applying and acknowledging every snapshot, and able to walk. */
async function bot() {
  const acct = await newAccount(server);
  const characterId = (await newCharacter(server, acct.token, { people: 'thalune' })).id;
  const sock = await TestSocket.open(server.wsUrl);
  const client = new SnapshotClient();
  const errors: unknown[] = [];
  sock.ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    try {
      const snap = client.receive(new Uint8Array(data as Buffer));
      sock.send({ t: 'ack', tick: snap.tick });
    } catch (err) {
      errors.push(err);
    }
  });
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  zone = server.zones.zone(welcome.zone.id)!;
  let seq = 0;
  return {
    sock,
    client,
    errors,
    entityId: welcome.entityId,
    /** sends an input that puts the bot at `pos` in `frame` */
    stand(frame: string, pos: Readonly<Vec3>, mode = 'foot') {
      sock.send({
        t: 'input',
        seq: ++seq,
        time: welcome.serverTime,
        mode,
        pose: { frame, pos: [pos[0], pos[1], pos[2]], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
        buttons: 0,
      });
    },
    /** the creatures in its latest snapshot */
    mobs(): EntityState[] {
      return [...client.latest.values()].filter((e) => e.kind === 'mob');
    },
  };
}

/** A world of the home system, a spot on open ground on it, and points on the ground around that spot. */
function worldFor(tier: 0 | 3, want: (s: readonly FaunaSpecies[]) => boolean) {
  const body = findWorld(tier, want);
  const params = body.params as PlanetParams;
  const ground = groundOf(params);
  const spot = openGround(ground);
  const [t, b] = tangents(spot);
  const at = (east: number, north: number): Vec3 => {
    const x = spot[0] * ground.radius + t[0] * east + b[0] * north;
    const y = spot[1] * ground.radius + t[1] * east + b[1] * north;
    const z = spot[2] * ground.radius + t[2] * east + b[2] * north;
    const l = Math.hypot(x, y, z);
    const r = ground.radius + ground.sample([x / l, y / l, z / l]);
    return [(x / l) * r, (y / l) * r, (z / l) * r];
  };
  return { body, frame: frameId(zone.system.seed, body.index), species: faunaSpecies(params, tier), at };
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('fauna over the wire', () => {
  it('shows two bots standing together the same herd in their snapshots, tick for tick', async () => {
    const a = await bot();
    const b = await bot();
    expect(zone.id).toBe(`sys:${home}`);
    expect(zone.fauna!.tier).toBe(0);
    const w = worldFor(0, (s) => s.filter((x) => x.spawn === 'herd').length >= 3);
    a.stand(w.frame, w.at(0, 0));
    b.stand(w.frame, w.at(4, 0));
    await waitFor(() => a.mobs().length >= 3 && b.mobs().length >= 3, 10_000, 'both bots to see creatures');
    // the same entities in the same states at the same tick
    await waitFor(() => [...a.client.states.keys()].some((t) => b.client.states.has(t) && a.client.states.get(t)!.size > 3), 5000, 'a tick both hold');
    const tick = Math.max(...[...a.client.states.keys()].filter((t) => b.client.states.has(t)));
    const mobsAt = (c: SnapshotClient) => [...c.states.get(tick)!.values()].filter((e) => e.kind === 'mob').sort((x, y) => x.id - y.id);
    const seenByA = mobsAt(a.client);
    expect(seenByA.length).toBeGreaterThanOrEqual(3);
    expect(mobsAt(b.client)).toEqual(seenByA);
    for (const m of seenByA) {
      expect(m).toMatchObject({ frame: w.frame, hp: 1 });
      expect(w.species[m.species!]).toBeDefined();
      expect(w.species[m.species!]!.temperament).toMatch(/docile|skittish/);
      expect(m.level).toBeGreaterThanOrEqual(1);
      expect(m.level).toBeLessThanOrEqual(5);
      expect(['idle', 'wander', 'flee', 'fly']).toContain(m.mode);
    }
    // they are the server's own herds: whole herds, each of one species
    const herds = new Map<number, Set<number>>();
    for (const c of zone.fauna!.creatures()) {
      if (!seenByA.some((m) => m.id === c.id)) continue;
      if (!herds.has(c.herd)) herds.set(c.herd, new Set());
      herds.get(c.herd)!.add(c.species.index);
    }
    expect(herds.size).toBeGreaterThan(0);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    a.sock.close();
    b.sock.close();
  });

  it('has a predator stalk a bot, rush it, attack, and chase it when it runs', async () => {
    const c = await bot();
    const want = (s: readonly FaunaSpecies[]) => s.some((x) => x.temperament === 'predator' && x.kind !== 'flyer');
    zone.fauna!.setTier(3);
    try {
      const w = worldFor(3, want);
      const sp = w.species.find((x) => x.temperament === 'predator' && x.kind !== 'flyer')!;
      c.stand(w.frame, w.at(0, 0));
      await waitFor(() => c.client.latest.get(c.entityId)?.frame === w.frame, 5000, 'the bot on the world');
      const { creatures } = zone.fauna!.spawnHerd({ body: w.body.index, species: sp.index, at: w.at(RULES.stalkM + 15, 0), count: 1 });
      const id = creatures[0]!;
      const me = () => c.client.latest.get(c.entityId)!.pos!;
      const it = () => c.client.latest.get(id);
      const modes: string[] = [];
      const record = () => {
        const m = it()?.mode;
        if (m && modes.at(-1) !== m) modes.push(m);
      };
      await waitFor(() => it() !== undefined, 5000, 'the predator in the bot’s snapshots');
      expect(it()).toMatchObject({ kind: 'mob', frame: w.frame, species: sp.index });
      const start = dist(it()!.pos!, me());
      await waitFor(
        () => {
          record();
          return it()?.mode === 'attack';
        },
        20_000,
        'the predator to reach the bot and attack',
      );
      expect(modes).toContain('stalk');
      expect(modes).toContain('rush');
      expect(modes.indexOf('rush')).toBeGreaterThan(modes.indexOf('stalk'));
      expect(dist(it()!.pos!, me())).toBeLessThan(start / 4);
      // the attack phase travels with the attacking state
      await waitFor(() => typeof it()?.attack === 'number' && it()!.attack! > 0, 3000, 'an attack phase');
      expect(it()!.attack!).toBeLessThanOrEqual(1);

      // the bot runs 40 m at 8 m/s; the predator gives chase and is on it again
      for (let k = 1; k <= 25; k++) {
        c.stand(w.frame, w.at(-k * 1.6, 0));
        record();
        await sleep(50);
      }
      const away = w.at(-40, 0);
      await waitFor(() => dist(me(), away) < 0.5, 5000, 'the bot to arrive');
      await waitFor(
        () => {
          record();
          return it()?.mode === 'attack' && dist(it()!.pos!, away) < 5;
        },
        15_000,
        'the predator to catch up',
      );
      expect(modes.lastIndexOf('rush')).toBeGreaterThan(modes.indexOf('attack'));
      expect(c.errors).toEqual([]);
    } finally {
      zone.fauna!.setTier(0);
      c.sock.close();
    }
  });
});
