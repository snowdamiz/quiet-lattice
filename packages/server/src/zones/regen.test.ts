import { describe, expect, it } from 'vitest';
import { ZoneManager } from './manager.ts';

describe('shield clock when reusing a sleeping zone', () => {
  it.each([
    { skills: [], expected: 0.25 },
    { skills: ['symbiont_hull'], expected: 0.375 },
  ])('does not count source regeneration a second time after a real follow handoff ($skills)', ({ skills, expected }) => {
    let now = 1000;
    const zones = new ZoneManager({ clock: { now: () => now }, mono: () => now * 1000 });
    const sleeping = zones.open(0, true);
    zones.runTick(now, now * 1000);
    now = 1031;
    zones.runTick(now, now * 1000);
    expect(zones.isAsleep(sleeping.id)).toBe(true);
    const viewer = { id: 1, characterId: 'review', sendBinary() {} };
    const pose = { frame: null, pos: [6e9 - 1, 0, 0], quat: [0, -Math.SQRT1_2, 0, Math.SQRT1_2], vel: [100, 0, 0] } as const;
    const first = zones.join(
      viewer,
      { id: 'review', name: 'Review', people: 'thalune', level: 4, homeSystem: 0, skills },
      { system: 0, pose: { ...pose, pos: [...pose.pos], quat: [...pose.quat], vel: [...pose.vel] }, mode: 'ship' },
    );
    first.zone.combat.applyDamage(null, first.entityId, { base: 50, kind: 'attack' });
    for (let i = 0; i < 140; i++) {
      now += 0.05;
      zones.runTick(now, now * 1000);
    }
    const before = first.zone.combat.playerHealth(first.entityId)!.shield;
    expect(
      zones.input(viewer, {
        t: 'input',
        seq: 1,
        time: now,
        zone: first.zone.id,
        mode: 'ship',
        pose: { ...pose, pos: [6e9 + 4, 0, 0], quat: [...pose.quat], vel: [...pose.vel] },
        buttons: 0,
      }),
    ).toBe('ok');
    const next = zones.follow(viewer)!;
    expect(next.zone).toBe(sleeping);
    expect(next.zone.combat.playerHealth(next.entityId)!.shield).toBe(before);
    now += 0.05;
    zones.runTick(now, now * 1000);
    const after = next.zone.combat.playerHealth(next.entityId)!.shield;
    expect(after - before).toBeCloseTo(expected, 6);
  });
  it('keeps the six second delay for a fresh hit before a sleeping zone first ticks', () => {
    let now = 1000;
    const zones = new ZoneManager({ clock: { now: () => now }, mono: () => now * 1000 });
    const sleeping = zones.open(0, true);
    zones.runTick(now, now * 1000);
    now = 1031;
    zones.runTick(now, now * 1000);
    expect(zones.isAsleep(sleeping.id)).toBe(true);
    const viewer = { id: 2, characterId: 'review2', sendBinary() {} };
    const joined = zones.join(
      viewer,
      { id: 'review2', name: 'Review2', people: 'thalune', level: 4, homeSystem: 0 },
      { system: 0, pose: { frame: null, pos: [7e9, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, mode: 'ship' },
    );
    expect(joined.zone).toBe(sleeping);
    const max = joined.zone.combat.playerHealth(joined.entityId)!.shield;
    joined.zone.combat.applyDamage(null, joined.entityId, { base: 40, kind: 'attack' });
    now += 0.05;
    zones.runTick(now, now * 1000);
    const after = joined.zone.combat.playerHealth(joined.entityId)!.shield;
    expect(after).toBe(max - 40);
    for (let i = 0; i < 119; i++) {
      now += 0.05;
      zones.runTick(now, now * 1000);
    }
    expect(joined.zone.combat.playerHealth(joined.entityId)!.shield).toBeCloseTo(max - 40, 6);
    now += 0.05;
    zones.runTick(now, now * 1000);
    expect(joined.zone.combat.playerHealth(joined.entityId)!.shield).toBeCloseTo(max - 40 + 0.25, 6);
  });
});
