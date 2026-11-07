import type { Pose } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { ZoneManager } from './manager.ts';
import { describeZoneSystem } from './system.ts';
import { frameId, type SystemDescription } from '@astra/shared/world';

function rig(overdue = true) {
  let now = 1000;
  const base = Array.from({ length: 70 }, (_, i) => describeZoneSystem(i)).find((s) => s.bodies.some((b) => b.type === 'gas'))!;
  const gas = base.bodies.find((b) => b.type === 'gas')!;
  expect(gas).toBeDefined();
  const system: SystemDescription = {
    ...base,
    bodies: base.bodies.map((b) =>
      b === gas ? { ...b, params: { ...b.params, hazard: { kind: 'pressure', label: 'pressure', ceiling: 1000, dps: 12, curve: 1 } } } : b,
    ),
  };
  const zones = new ZoneManager({ clock: { now: () => now }, mono: () => now * 1000, describe: () => system });
  const sleeping = zones.open(0);
  zones.runTick(now, now * 1000);
  now = 1031;
  zones.advance(now * 1000);
  expect(zones.isAsleep(sleeping.id)).toBe(true);
  now = 1041;
  if (!overdue) zones.advance(now * 1000);
  const viewer = { id: 1, characterId: 'wake-review', sendBinary() {} };
  const joined = zones.join(
    viewer,
    { id: viewer.characterId, name: 'Wake', people: 'thalune', level: 4, homeSystem: 0 },
    {
      system: 0,
      pose: { frame: frameId(system.seed, gas.index), pos: [0, gas.radius + 999, 0], quat: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], vel: [0, 40, 0] },
      mode: 'ship',
    },
  );
  expect(joined.fellBack).toBeUndefined();
  expect(joined.zone).toBe(sleeping);
  expect(sleeping.time).toBe(now);
  return {
    zones,
    joined,
    viewer,
    gas,
    now: () => now,
    setTime: (t: number) => {
      now = t;
    },
    health: () => joined.zone.combat.playerHealth(joined.entityId)!,
  };
}
describe('R2 wake before overdue scheduled advance', () => {
  it('control: a wake after scheduled catch-up keeps a fresh hazard hit unrecovered', () => {
    const r = rig(false);
    r.joined.zone.combat.applyDamage(null, r.joined.entityId, { base: 40, kind: 'attack' });
    r.setTime(1041.2);
    r.zones.advance(r.now() * 1000);
    const damaged = r.health().shield;
    expect(damaged).toBeLessThan(60);
    r.setTime(1041.25);
    const pose: Pose = { ...r.joined.pose, pos: [0, r.gas.radius + 1001, 0], quat: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], vel: [0, 40, 0] };
    expect(r.zones.input(r.viewer, { t: 'input', seq: 1, time: r.now(), zone: r.joined.zone.id, pose, mode: 'ship', buttons: 0 })).toBe('ok');
    r.zones.advance(r.now() * 1000);
    expect(r.health().shield).toBe(damaged);
  });
  it('does not rewind the newly woken zone clock', () => {
    const r = rig();
    r.zones.advance(r.now() * 1000);
    expect(r.joined.zone.time).toBeGreaterThanOrEqual(1041);
  });
  it('fresh catch-up hazard damage retains the six-second regen delay after a valid ascent', () => {
    const r = rig();
    r.joined.zone.combat.applyDamage(null, r.joined.entityId, { base: 40, kind: 'attack' });
    const initial = r.health().shield;
    r.zones.advance(r.now() * 1000);
    const damaged = r.health().shield;
    expect(damaged).toBe(initial); // No historical hazard interval exists for a newly joined ship.
    r.setTime(1041.05);
    const pose: Pose = { ...r.joined.pose, pos: [0, r.gas.radius + 1001, 0], quat: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], vel: [0, 40, 0] };
    expect(r.zones.input(r.viewer, { t: 'input', seq: 1, time: r.now(), zone: r.joined.zone.id, pose, mode: 'ship', buttons: 0 })).toBe('ok');
    r.zones.advance(r.now() * 1000);
    expect(r.health().shield).toBe(damaged);
  });
});

it('a real post-wake hazard and an explicitly older hit cannot shorten a new attack delay', () => {
  const r = rig();
  r.joined.zone.combat.applyDamage(null, r.joined.entityId, { base: 40, kind: 'attack' });
  r.zones.advance(r.now() * 1000);
  r.setTime(1041.05);
  r.zones.advance(r.now() * 1000);
  const hazard = r.health().shield;
  expect(hazard).toBeLessThan(60);
  r.joined.zone.combat.applyDamage(null, r.joined.entityId, { base: 1, kind: 'hazard' }, 1031);
  const damaged = r.health().shield;
  const pose: Pose = { ...r.joined.pose, pos: [0, r.gas.radius + 1001, 0], quat: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], vel: [0, 40, 0] };
  r.setTime(1041.101);
  expect(r.zones.input(r.viewer, { t: 'input', seq: 1, time: r.now(), zone: r.joined.zone.id, pose, mode: 'ship', buttons: 0 })).toBe('ok');
  r.zones.advance(r.now() * 1000);
  expect(r.joined.zone.time).toBeGreaterThanOrEqual(1041.1 - 1e-8);
  expect(r.health().shield).toBe(damaged);
  const world = r.joined.zone.toWorld(r.joined.pose.frame, r.joined.pose.pos);
  const time = r.joined.zone.time;
  r.joined.zone.step(1031);
  expect(r.joined.zone.time).toBe(time);
  expect(r.joined.zone.toWorld(r.joined.pose.frame, r.joined.pose.pos)).toEqual(world);
});
