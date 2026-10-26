// Zone bookkeeping: poses it cannot place are refused, a despawned session entity takes its session out, snapshots
// acknowledge inputs from seq 1 with 0 meaning none yet, and with movement authority a player's mode is the one the server
// believes.
import { describe, expect, it } from 'vitest';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import { LARK } from '../sim/movement/testing.ts';
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

  it('with movement authority: applies the mode it believes, keeps a refused input out and puts the entity where the correction says', () => {
    const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0), movement: true });
    let time = 2.3e7;
    zone.step(time);
    const v = new Viewer(1);
    const dock = zone.dockPose();
    expect(() => zone.join(new Viewer(2), { kind: 'player', ...dock, mode: 'docked' })).toThrow(/profile/);
    const id = zone.join(v, { kind: 'player', ...dock, mode: 'docked' }, { profile: { ship: LARK }, now: time });
    // the next joiner gets the next pad
    expect(zone.dockPose().pos).not.toEqual(dock.pos);
    const input = (seq: number, pos: [number, number, number], mode: 'ship' | 'foot', vel: [number, number, number] = [0, 0, 0]) => ({
      t: 'input' as const,
      seq,
      time: 0,
      mode,
      pose: { ...dock, pos, vel },
      buttons: 0,
    });
    const up: [number, number, number] = [dock.pos[0], dock.pos[1] + 1, dock.pos[2]];
    expect(zone.input(v, input(1, up, 'ship', [0, 5e6, 0]), (time += 0.05))).toBe('ok');
    const e = zone.entity(id)!;
    expect(e.fields).toMatchObject({ mode: 'ship', pos: up });
    expect(e.cls).toBe('ship');
    expect(e.unvalidated).toBe(false);
    // its velocity held to the space allowance
    expect(Math.hypot(...e.fields.vel)).toBeCloseTo(710, 6);
    // claiming to be on foot 40 m up, nowhere near where its ship could set it down: refused, still a ship (seen from
    // 50 km, not 2), still where it was
    const r = zone.input(v, input(2, [dock.pos[0], 40, dock.pos[2]], 'foot'), (time += 0.05));
    expect(r).toMatchObject({ ok: false, correction: { seq: 2, mode: 'ship', pose: { pos: up } } });
    expect(e.fields).toMatchObject({ mode: 'ship', pos: up });
    expect(e.cls).toBe('ship');
    // and the snapshot acknowledges it as handled
    zone.step(time + 0.05);
    expect(v.client.snapshots.at(-1)!.ack).toBe(2);
    expect(zone.movement!.recent.at(-1)).toMatchObject({ rule: 'exit_range', entity: id });
  });
});
