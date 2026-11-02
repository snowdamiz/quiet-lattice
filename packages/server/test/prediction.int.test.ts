import { frameIdOf, systemPoses, worldToLocal, type Vec3 } from '@astra/shared/world';
import type { Pose } from '@astra/shared/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { startTestServer, uniqueShard, waitFor } from './helpers.ts';
import { ManualClock, Pilot } from './pilot.ts';

let server: RunningServer;
const clock = new ManualClock();
const pilots: Pilot[] = [];
beforeAll(async () => {
  server = await startTestServer({}, { shard: uniqueShard(), clock: { monoNow: clock.now } });
});
afterAll(async () => {
  for (const p of pilots) p.close();
  await server?.close();
});

/** Put a pilot at a server-owned test starting pose, as the admin teleport does, before its first input. */
function place(p: Pilot, pose: Pose) {
  const zone = server.zones.zone(p.welcome.zone.id)!;
  const profile = zone.movement!.remove(p.entityId)!;
  zone.patch(p.entityId, { ...pose, mode: 'ship' });
  zone.movement!.add(p.entityId, pose, 'ship', profile, p.time);
  p.last = pose;
  return zone;
}

async function join() {
  const p = await Pilot.join(server, 'thalune', { clock });
  pilots.push(p);
  return p;
}

describe('prediction pose identity over the gateway', () => {
  it('repeats an accepted pose through later station-edge ticks and reports a correction there on the snapshot', async () => {
    const p = await join();
    const zone = server.zones.zone(p.welcome.zone.id)!;
    const system = zone.system;
    const home = system.station.parent;
    const at = p.time + 0.05;
    const station = (t: number) => {
      const poses = systemPoses(system, t);
      return worldToLocal(poses.bodies[home]!, poses.station.position);
    };
    const center = station(at);
    const drift = station(at + 0.01).map((x, i) => x - center[i]!);
    const scale = (system.station.soi + 1) / Math.hypot(...drift);
    const pos: Vec3 = [center[0] + drift[0]! * scale, center[1] + drift[1]! * scale, center[2] + drift[2]! * scale];
    const pose: Pose = { frame: frameIdOf(system.seed, home), pos, quat: [0, 0, 0, 1], vel: [0, 0, 0] };
    place(p, pose);
    await p.idle(50);
    p.send(pose, 'ship');
    await p.settled();
    await p.idle(200);
    const before = p.client.latestTick!;
    await waitFor(() => p.client.latestTick! > before, 5000, 'later station-edge snapshot');
    expect(p.client.latest.get(p.entityId)).toMatchObject(pose);
    expect(p.corrections).toEqual([]);
    // Refused across the frame boundary: even if its control correction is lost, the binary snapshot carries the
    // authoritative old-frame pose with the refused input's ack, which prediction can compare at that input's time.
    const poses = systemPoses(system, p.time);
    const world = zone.toWorld(pose.frame, pose.pos);
    const stationPos = worldToLocal(poses.station, world);
    const claim: Pose = { ...pose, frame: frameIdOf(system.seed, 'station'), pos: [stationPos[0] + 2000, stationPos[1], stationPos[2]] };
    const seq = p.send(claim, 'ship');
    await p.settled();
    expect(p.corrections).toHaveLength(1);
    expect(p.client.snapshots.at(-1)!.ack).toBe(seq);
    expect(p.client.latest.get(p.entityId)).toMatchObject(p.corrections[0]!.pose);
    expect(p.client.latest.get(p.entityId)!.frame).not.toBe(claim.frame);
    expect(zone.movement!.corrections).toBe(1);
  });

  it('refuses a first jump paid only by its network delay, then accepts the corrected trajectory', async () => {
    const p = await join();
    const origin: Pose = { frame: null, pos: [0, 2e9, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
    place(p, origin);
    const stamp = p.time + 0.05;
    await p.idle(4000);
    p.sock.send({ t: 'input', seq: ++p.seq, time: stamp, mode: 'ship', pose: { ...origin, pos: [500, 2e9, 0] }, buttons: 0 });
    await p.settled();
    expect(p.corrections).toHaveLength(1);
    expect(p.corrections[0]).toMatchObject({ seq: 1, mode: 'ship', pose: origin });
    expect(p.client.latest.get(p.entityId)).toMatchObject(origin);
    await p.idle(50);
    p.send(origin, 'ship');
    await p.settled();
    expect(p.corrections).toHaveLength(1);
    expect(p.errors).toEqual([]);
  });
});
