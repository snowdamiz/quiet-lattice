import { type Pose } from '@astra/shared/protocol';
import { chooseFrame, frameIdOf, localToWorld, systemPoses, worldToLocal, type Vec3 } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import { LARK } from '../sim/movement/testing.ts';
import { describeZoneSystem } from './system.ts';
import { Zone } from './zone.ts';

const system = describeZoneSystem(0);
const time = 1e6;
const home = system.station.parent;
const stationInHome = (t: number) => {
  const poses = systemPoses(system, t);
  return worldToLocal(poses.bodies[home]!, poses.station.position);
};

/** Just outside the station's sphere in its world's frame; the station reaches it between input and snapshot. */
function edgePose(): Pose {
  const station = stationInHome(time);
  const next = stationInHome(time + 0.01);
  const drift = next.map((x, i) => x - station[i]!);
  const scale = (system.station.soi + 1) / Math.hypot(...drift);
  const pos: Vec3 = [station[0] + drift[0]! * scale, station[1] + drift[1]! * scale, station[2] + drift[2]! * scale];
  return { frame: frameIdOf(system.seed, home), pos, quat: [0, 0, 0, 1], vel: [0, 0, 0] };
}

describe('authority-owned snapshot pose time', () => {
  it('keeps the accepted input frame and pose through repeated ticks and a lost delta at the station edge', () => {
    const zone = new Zone({ id: 'pose-time', systemIndex: 0, system, movement: true, fauna: false });
    const client = new SnapshotClient();
    let drop = false;
    const viewer = {
      id: 1,
      sendBinary: (bytes: Uint8Array) => {
        if (!drop) client.receive(bytes);
      },
    };
    const pose = edgePose();
    const id = zone.join(viewer, { kind: 'player', mode: 'ship', ...pose }, { profile: { ship: LARK }, now: time - 0.05 });
    expect(zone.input(viewer, { t: 'input', seq: 1, time, pose, mode: 'ship', buttons: 0 }, time + 0.1)).toBe('ok');
    for (const [at, expected] of [
      [time, home],
      [time + 0.1, 'station'],
    ] as const) {
      const poses = systemPoses(system, at);
      expect(chooseFrame(system, poses, localToWorld(poses.bodies[home]!, pose.pos), home)).toBe(expected);
    }
    zone.step(time);
    zone.ack(viewer, zone.tick);
    drop = true;
    zone.step(time + 0.05);
    drop = false;
    for (const at of [time + 0.1, time + 0.15, time + 0.2]) {
      zone.step(at);
      const snapshot = client.snapshots.at(-1)!;
      expect(snapshot).toMatchObject({ ack: 1, time: at, full: false, base: 1 });
      expect(client.latest.get(id)).toMatchObject(pose);
      const expected = localToWorld(systemPoses(system, at).bodies[home]!, pose.pos);
      expect(Math.hypot(...zone.entity(id)!.world.map((x, i) => x - expected[i]!))).toBeLessThan(0.01);
    }
    expect(zone.movement!.corrections).toBe(0);
    expect(zone.droppedFields).toBe(0);
  });
});
