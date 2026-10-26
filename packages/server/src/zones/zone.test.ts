// Zone bookkeeping: poses it cannot place are refused, a despawned session entity takes its session out, and snapshots
// acknowledge inputs from seq 1 with 0 meaning none yet.
import { describe, expect, it } from 'vitest';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import { describeZoneSystem } from './system.ts';
import { Zone, type EntityInit, type ZoneViewer } from './zone.ts';

class Viewer implements ZoneViewer {
  readonly client = new SnapshotClient();
  constructor(readonly id: number) {}
  sendBinary(data: Uint8Array): void {
    this.client.receive(data);
  }
}

function setup() {
  const removed: ZoneViewer[] = [];
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0), onViewerRemoved: (v) => removed.push(v) });
  const init = (extra: Partial<EntityInit> = {}): EntityInit => ({
    kind: 'player',
    frame: zone.stationFrame,
    pos: [0, 0, 0],
    quat: [0, 0, 0, 1],
    vel: [0, 0, 0],
    mode: 'docked',
    ...extra,
  });
  let time = 2.3e7;
  const step = () => zone.step((time += 0.05));
  return { zone, init, removed, step };
}

describe('Zone', () => {
  it('refuses poses it cannot place, and changes nothing when it does', () => {
    const { zone, init, step } = setup();
    expect(() => zone.spawn(init({ pos: [NaN, 0, 0] }))).toThrow(RangeError);
    expect(() => zone.spawn(init({ vel: [0, Infinity, 0] }))).toThrow(RangeError);
    expect(() => zone.spawn(init({ quat: [0, 0, 0, 0] }))).toThrow(RangeError);
    expect(() => zone.spawn(init({ pos: [1, 2] as unknown as [number, number, number] }))).toThrow(RangeError);
    expect(() => zone.spawn(init({ frame: '1:0' }))).toThrow(RangeError);
    expect(zone.entityCount).toBe(0);

    const id = zone.spawn(init({ kind: 'mob', mode: 'idle', pos: [5, 0, 0] }));
    expect(() => zone.patch(id, { pos: [0, -Infinity, 0], hp: 0.5 })).toThrow(RangeError);
    expect(() => zone.patch(id, { quat: [NaN, 0, 0, 1] })).toThrow(RangeError);
    expect(() => zone.patch(id, {}, ['pos'])).toThrow(/cannot clear/);
    expect(zone.entity(id)!.fields).toEqual({ kind: 'mob', frame: zone.stationFrame, pos: [5, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'idle' });
    // and the zone ticks on
    const v = new Viewer(1);
    zone.join(v, init());
    step();
    step();
    expect(zone.tick).toBe(2);
    expect(v.client.latest.get(id)).toMatchObject({ pos: [5, 0, 0] });
  });

  it('takes a session out, and says so, when its own entity is despawned', () => {
    const { zone, init, removed, step } = setup();
    const a = new Viewer(1);
    const b = new Viewer(2);
    const ea = zone.join(a, init());
    zone.join(b, init({ pos: [10, 0, 0] }));
    step();
    zone.ack(b, zone.tick);
    expect(b.client.latest.has(ea)).toBe(true);
    expect(zone.despawn(ea)).toBe(true);
    expect(removed).toEqual([a]);
    expect(zone.has(a)).toBe(false);
    expect(zone.sessionCount).toBe(1);
    const sent = a.client.snapshots.length;
    step();
    expect(a.client.snapshots).toHaveLength(sent);
    expect(b.client.snapshots.at(-1)!.removed).toEqual([ea]);
    expect(
      zone.input(a, { t: 'input', seq: 1, time: 0, mode: 'ship', pose: { frame: null, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 }),
    ).toBe('unknown');
    // leaving the ordinary way is not a removal to report
    expect(zone.leave(b)).toBe(true);
    expect(removed).toEqual([a]);
  });

  it('acknowledges inputs from seq 1, with 0 meaning none yet', () => {
    const { zone, init, step } = setup();
    const v = new Viewer(1);
    zone.join(v, init());
    const input = (seq: number) => ({
      t: 'input' as const,
      seq,
      time: 0,
      mode: 'ship' as const,
      pose: {
        frame: null,
        pos: [1, 2, 3] as [number, number, number],
        quat: [0, 0, 0, 1] as [number, number, number, number],
        vel: [0, 0, 0] as [number, number, number],
      },
      buttons: 0,
    });
    step();
    expect(v.client.snapshots.at(-1)!.ack).toBe(0);
    expect(zone.input(v, input(0))).toBe('stale');
    step();
    expect(v.client.snapshots.at(-1)!.ack).toBe(0);
    expect(zone.input(v, input(1))).toBe('ok');
    step();
    expect(v.client.snapshots.at(-1)!.ack).toBe(1);
    expect(zone.input(v, input(1))).toBe('stale');
    expect(zone.input(v, input(7))).toBe('ok');
    step();
    expect(v.client.snapshots.at(-1)!.ack).toBe(7);
  });
});
