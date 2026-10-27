// Dens and night over the wire (P1.E08.T03), against the dockerised Postgres and Redis, with a forced clock: a server on
// a shard of its own, whose world clock the test moves forward to the day or the night it wants at a place (the zone
// ticks at that clock's time). A bot in a ship beside the apex's lair in the landmark grove sees no apex by day, sees it
// come out at night, and sees it go back into its lair at dawn; its lair's dens were planned in the planner's worker.
import { PROTOCOL_VERSION, type EntityState } from '@astra/shared/protocol';
import { faunaSpecies, frameId, type PlanetParams } from '@astra/shared/world';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { nextTime } from '../src/fauna/sky.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import type { RunningServer } from '../src/server.ts';
import type { Zone } from '../src/zones/zone.ts';
import { along, findWorld, openGround } from './faunaWorld.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

let server: RunningServer;
/** how far the test has moved the world clock forward, s */
let skew = 0;

beforeAll(async () => {
  server = await startTestServer({}, { shard: uniqueShard() });
  const clock = server.world.clock;
  const real = clock.now.bind(clock);
  clock.now = () => real() + skew;
});

afterAll(async () => {
  await server?.close();
});

/** Moves the world clock forward to world time `t` (never back: the zone's ticks only go forward). */
function forceClock(t: number) {
  const now = server.world.clock.now();
  expect(t).toBeGreaterThan(now);
  skew += t - now;
}

describe('dens over the wire, with a forced clock', () => {
  it('shows a bot the apex coming out of its lair at night, none by day, and going back in at dawn', async () => {
    const acct = await newAccount(server);
    const characterId = (await newCharacter(server, acct.token, { people: 'thalune' })).id;
    const sock = await TestSocket.open(server.wsUrl);
    const client = new SnapshotClient();
    sock.ws.on('message', (data, isBinary) => {
      if (isBinary) sock.send({ t: 'ack', tick: client.receive(new Uint8Array(data as Buffer)).tick });
    });
    sock.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
    sock.send({ t: 'join', characterId });
    const welcome = await sock.next('welcome');
    const zone: Zone = server.zones.zone(welcome.zone.id)!;
    let seq = 0;
    const stand = (frame: string, pos: Readonly<Vec3>) =>
      sock.send({
        t: 'input',
        seq: ++seq,
        time: welcome.serverTime,
        mode: 'ship',
        pose: { frame, pos: [pos[0], pos[1], pos[2]], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
        buttons: 0,
      });

    zone.fauna!.setTier(2);
    try {
      const body = findWorld(2, (s) => s.some((x) => x.temperament === 'apex'));
      const params = body.params as PlanetParams;
      const apexSpecies = faunaSpecies(params, 2).find((x) => x.temperament === 'apex')!;
      const frame = frameId(zone.system.seed, body.index);
      const ground = groundOf(params);
      const onGround = (d: Readonly<Vec3>): Vec3 => {
        const r = ground.radius + ground.sample(d);
        return [d[0] * r, d[1] * r, d[2] * r];
      };
      // on the world: its ground and dens are planned in the worker
      stand(frame, onGround(openGround(ground)));
      await waitFor(() => zone.fauna!.densReady(body.index), 60_000, 'the world’s dens to be planned');
      const lair = zone.fauna!.dens(body.index).find((d) => d.den.role === 'apex')!;
      expect(lair.species).toEqual(apexSpecies);
      const [t, b] = tangents(lair.den.dir);
      stand(frame, onGround(along(lair.den.dir, t, b, 120, 0, ground.radius)));
      const apexes = (): EntityState[] => [...client.latest.values()].filter((e) => e.kind === 'mob' && e.species === apexSpecies.index);
      const when = (night: boolean) => nextTime(zone.system, body.index, lair.den.dir, ground.radius, night, server.world.clock.now() + 2, { margin: 600 })!;

      // by day: the lair's cell is awake round the bot, and no apex comes out
      forceClock(when(false));
      const cell = ground.cells.keyOf(...lair.den.dir);
      await waitFor(() => zone.fauna!.cells(body.index).some((c) => c.key === cell && c.state === 'active'), 20_000, 'the lair’s cell to wake');
      await new Promise((r) => setTimeout(r, 2000));
      expect(apexes()).toEqual([]);

      // at night it comes out at its lair, seen from afar (the walker radius)
      forceClock(when(true));
      await waitFor(() => apexes().length === 1, 20_000, 'the apex in the bot’s snapshots');
      const apex = apexes()[0]!;
      const lairPos = onGround(lair.den.dir);
      expect(Math.hypot(apex.pos![0] - lairPos[0], apex.pos![1] - lairPos[1], apex.pos![2] - lairPos[2])).toBeLessThan(15);
      expect(apex.frame).toBe(frame);
      expect(zone.entity(apex.id)!.cls).toBe('walker');

      // at dawn it goes back into its lair
      forceClock(when(false));
      await waitFor(() => apexes().length === 0, 30_000, 'the apex to go back into its lair');
      expect(zone.entity(apex.id)).toBeUndefined();
      expect(zone.fauna!.dens(body.index)[lair.index]!.pack).toEqual([]);
    } finally {
      zone.fauna!.setTier(0);
      sock.close();
    }
  });
});
