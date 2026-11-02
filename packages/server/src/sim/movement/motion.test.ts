import { describe, expect, it } from 'vitest';
import { frameIdOf, localToWorld, systemPoses, worldToLocal, type Vec3 } from '@astra/shared/world';
import { describeZoneSystem } from '../../zones/system.ts';
import { Harness, LARK, pose } from './testing.ts';

const system = describeZoneSystem(0);

describe('motion observations for server re-entry', () => {
  it('measures accepted displacement and credited time even when the moving client reports zero velocity', () => {
    const h = new Harness(system, { pose: pose(null, [0, 2e9, 0]), mode: 'ship' });
    expect(h.send(pose(null, [0, 2e9, 0]), 'ship')).toMatchObject({ ok: true, motion: null });
    const result = h.send(pose(null, [25, 2e9, 0]), 'ship');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('honest displacement refused');
    expect(result.motion?.seconds).toBeCloseTo(0.05, 7);
    expect(result.motion?.vel[0]).toBeCloseTo(500, 5);
    expect(result.vel).toEqual([0, 0, 0]);
    const stationary = h.send(pose(null, [25, 2e9, 0], [1000, 0, 0]), 'ship');
    expect(stationary).toMatchObject({ ok: true, motion: { vel: [0, 0, 0] } });
  });

  it('needs a fresh pair after a teleport, a correction and a zone handoff', () => {
    const h = new Harness(system, { pose: pose(null, [0, 2e9, 0]), mode: 'ship' });
    h.send(pose(null, [0, 2e9, 0]), 'ship');
    h.a.remove(h.id);
    h.a.add(h.id, pose(null, [1e8, 2e9, 0]), 'ship', { ship: LARK }, h.now);
    expect(h.send(pose(null, [1e8, 2e9, 0]), 'ship')).toMatchObject({ ok: true, motion: null });
    const bad = h.send(pose(null, [1e8 + 1e6, 2e9, 0]), 'ship');
    expect(bad.ok).toBe(false);
    if (bad.ok || !bad.correction) throw new Error('a teleport must be corrected');
    expect(h.send(bad.correction.pose, 'ship')).toMatchObject({ ok: true, motion: null });
    const target = new Harness(system, { pose: pose(null, [0, 3e9, 0]), mode: 'ship' });
    h.a.transfer(h.id, target.a, 99, pose(null, [2e8, 2e9, 0]), 'ship', h.now, true);
    const moved = target.a.check(99, { t: 'input', seq: 100, time: h.now + 0.05, mode: 'ship', pose: pose(null, [2e8, 2e9, 0]), buttons: 0 }, h.now + 0.05);
    expect(moved).toMatchObject({ ok: true, motion: null });
  });

  it('removes the apparent jump when a stationary pose changes into the approaching station frame', () => {
    const start = 1e6;
    const stationIn = (t: number): Vec3 => {
      const p = systemPoses(system, t);
      return worldToLocal(p.bodies[system.station.parent]!, p.station.position);
    };
    const a = stationIn(start);
    const b = stationIn(start + 1);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const end = stationIn(start + 7);
    const at: Vec3 = [end[0] + ((b[0] - a[0]) / length) * 2000, end[1] + ((b[1] - a[1]) / length) * 2000, end[2] + ((b[2] - a[2]) / length) * 2000];
    const world = frameIdOf(system.seed, system.station.parent);
    const h = new Harness(system, { pose: pose(world, at), mode: 'ship' }, {}, { now: start });
    for (let i = 0; i < 60; i++) expect(h.send(pose(world, at), 'ship').ok).toBe(true);
    h.now += 4;
    const p = systemPoses(system, h.now + 0.05);
    const local = worldToLocal(p.station, localToWorld(p.bodies[system.station.parent]!, at));
    const switched = h.send(pose(frameIdOf(system.seed, 'station'), local), 'ship');
    expect(switched.ok).toBe(true);
    if (!switched.ok) throw new Error('station frame switch refused');
    expect(Math.hypot(...(switched.motion?.vel ?? [0, 0, 0]))).toBeLessThan(0.001);
  });
});
