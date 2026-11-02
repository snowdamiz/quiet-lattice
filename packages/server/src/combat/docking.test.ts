// Dock service through real movement authority, including accepted claims that use its short-window position slack.
import { describe, expect, it } from 'vitest';
import type { ClientMessage, Pose } from '@astra/shared/protocol';
import { STATION_LAYOUT } from '@astra/shared/data';
import { padPose } from '../sim/movement/authority.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';

type Input = Extract<ClientMessage, { t: 'input' }>;

function docked(offset = 0, mode: Input['mode'] = 'docked') {
  const zone = new Zone({ id: 'dock-service', systemIndex: 0, system: describeZoneSystem(0), fauna: false, movement: true });
  const viewer: ZoneViewer = { id: 1, characterId: 'pilot', sendBinary() {} };
  const start = padPose(zone.stationFrame, 0);
  start.pos[0] += offset;
  let now = 1000;
  let seq = 0;
  const id = zone.join(
    viewer,
    { kind: 'player', ...start, mode },
    { now, profile: { characterId: 'pilot', ship: { hull: 'lark', modules: {}, cargoPods: 1, livery: 0 } } },
  );
  zone.step(now);
  const claim = (pose: Pose, mode: Input['mode'] = 'docked', seconds = 0.05, at?: number) => {
    now += seconds;
    return zone.input(viewer, { t: 'input', seq: ++seq, time: at ?? now, mode, pose, buttons: 0 }, now);
  };
  const send = (...args: Parameters<typeof claim>) => expect(claim(...args)).toBe('ok');
  const tick = () => zone.step(now);
  const wait = (seconds: number) => {
    now += seconds;
    tick();
  };
  const hit = (base: number) => zone.combat.applyDamage(null, id, { base, kind: 'attack' });
  const health = () => zone.combat.playerHealth(id)!;
  return { zone, id, start, claim, send, tick, wait, hit, health, now: () => now };
}

describe('dock service from accepted ship motion', () => {
  it('does not service four accepted 20 m/s docked moves that report zero velocity', () => {
    const w = docked(0, 'ship');
    w.hit(150);
    for (let x = 1; x <= 4; x++) {
      w.send({ ...w.start, pos: [w.start.pos[0] + x, w.start.pos[1], w.start.pos[2]], vel: [0, 0, 0] });
      w.tick();
    }
    expect(w.health()).toMatchObject({ hull: 50, shield: 0 });
    w.wait(2);
    expect(w.health()).toMatchObject({ hull: 50, shield: 0 });
  });

  it('records an accepted departure and a slow return that both arrive before the next tick', () => {
    const w = docked(11.9);
    w.send(w.start);
    w.tick();
    w.send(w.start);
    w.tick();
    w.hit(50);
    expect(w.health().shield).toBe(50);
    const pad = STATION_LAYOUT.pads[0]!;
    w.send({ ...w.start, pos: [pad.x + 12.1, w.start.pos[1], pad.z] }, 'ship', 0.25);
    w.send(w.start, 'docked', 0.25); // 0.2 m / 0.25 s = 0.8 m/s
    w.tick();
    expect(w.health().shield).toBe(100);
  });

  it('waits for measured rest, then repairs 20/s during silence without refilling a serviced shield again', () => {
    const w = docked();
    w.hit(150);
    w.wait(1);
    expect(w.health()).toMatchObject({ hull: 50, shield: 0 });
    w.send(w.start);
    w.tick();
    expect(w.health()).toMatchObject({ hull: 50, shield: 0 });
    w.send({ ...w.start, vel: [1000, 0, 0] }); // A reported velocity cannot override observed rest either.
    w.tick();
    expect(w.health().hull).toBeCloseTo(51, 8);
    expect(w.health().shield).toBe(100);
    w.hit(50);
    w.wait(2);
    expect(w.health().hull).toBeCloseTo(91, 8);
    expect(w.health().shield).toBe(50);
    w.send(w.start, 'ship');
    w.tick();
    w.send(w.start);
    w.tick();
    expect(w.health().shield).toBe(50);
  });

  it.each(['placement', 'correction', 'resync'] as const)('%s clears stationary proof without inventing another arrival', (reset) => {
    const w = docked();
    w.send(w.start);
    w.tick();
    w.send(w.start);
    w.tick();
    w.hit(150);
    if (reset === 'placement') {
      const profile = w.zone.movement!.remove(w.id)!;
      w.zone.movement!.add(w.id, w.start, 'docked', profile, w.now());
      w.zone.patch(w.id, w.start);
    } else if (reset === 'correction') {
      expect(w.claim({ ...w.start, pos: [1000, w.start.pos[1], w.start.pos[2]] })).not.toBe('ok');
    } else w.send(w.start, 'docked', 0.05, w.now() + 2);
    w.wait(0.05);
    expect(w.health()).toMatchObject({ hull: 50, shield: 0 });
  });

  it('keeps the service latch when a pilot walks beyond pad reach and boards the same parked ship', () => {
    const w = docked();
    w.send(w.start);
    w.tick();
    w.send(w.start);
    w.tick();
    w.hit(50);
    const feet: Pose = { ...w.start, pos: [w.start.pos[0] + 8, 2, w.start.pos[2]] };
    w.send(feet, 'foot');
    w.tick();
    w.send({ ...feet, pos: [w.start.pos[0] + 20, 2, w.start.pos[2]] }, 'foot', 2.5);
    w.tick();
    w.send(feet, 'foot', 2.5);
    w.tick();
    w.send(w.start);
    w.tick();
    w.send(w.start);
    w.tick();
    expect(w.health().shield).toBe(50);
  });
});
