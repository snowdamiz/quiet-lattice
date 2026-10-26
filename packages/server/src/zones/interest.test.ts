// Interest sets: class radii, hysteresis, the session's own entity and party, frames, and what a client is sent as
// entities enter and leave.
import { localToWorld, systemPoses, worldToLocal } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import { INTEREST_HYSTERESIS, INTEREST_RADIUS, interestClass } from './interest.ts';
import { describeZoneSystem } from './system.ts';
import { Zone, type EntityInit, type ZoneViewer } from './zone.ts';

const T0 = 2.3e7;

class Viewer implements ZoneViewer {
  readonly client = new SnapshotClient();
  constructor(readonly id: number) {}
  sendBinary(data: Uint8Array): void {
    this.client.receive(data);
  }
}

function setup() {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0) });
  const station = zone.stationFrame;
  const at = (x: number, extra: Partial<EntityInit> = {}): EntityInit => ({
    kind: 'mob',
    frame: station,
    pos: [x, 0, 0],
    quat: [0, 0, 0, 1],
    vel: [0, 0, 0],
    ...extra,
  });
  const viewer = new Viewer(1);
  const self = zone.join(viewer, { ...at(0), kind: 'player', mode: 'foot', name: 'Ves', people: 'thalune', level: 3 });
  let time = T0;
  const step = () => {
    time += 0.05;
    zone.step(time);
    zone.ack(viewer, zone.tick);
    return zone.interestOf(viewer);
  };
  return { zone, station, at, viewer, self, step };
}

describe('interest classes', () => {
  it('maps kinds and modes to classes', () => {
    expect(interestClass('ship')).toBe('ship');
    expect(interestClass('player', 'ship')).toBe('ship');
    expect(interestClass('player', 'docked')).toBe('ship');
    expect(interestClass('player', 'landed')).toBe('ship');
    expect(interestClass('player', 'foot')).toBe('walker');
    expect(interestClass('npc')).toBe('walker');
    expect(interestClass('prop')).toBe('walker');
    expect(interestClass('mob', 'attack')).toBe('mob');
    expect(interestClass('loot')).toBe('loot');
    expect(interestClass('pod')).toBe('loot');
    expect(INTEREST_RADIUS).toEqual({ ship: 50_000, walker: 2_000, mob: 1_500, loot: 500 });
  });
});

describe('interest sets', () => {
  it('holds each entity within its own class radius of the session, and itself', () => {
    const { zone, at, self, step } = setup();
    const inside = [
      zone.spawn(at(49_900, { kind: 'ship' })),
      zone.spawn(at(-49_000, { kind: 'player', mode: 'pulse' })),
      zone.spawn(at(1_990, { kind: 'player', mode: 'foot' })),
      zone.spawn(at(1_990, { kind: 'npc' })),
      zone.spawn(at(1_495, { kind: 'mob' })),
      zone.spawn(at(495, { kind: 'loot' })),
      zone.spawn(at(-495, { kind: 'pod' })),
    ];
    // just outside each radius
    zone.spawn(at(50_100, { kind: 'ship' }));
    zone.spawn(at(2_010, { kind: 'player', mode: 'foot' }));
    zone.spawn(at(2_010, { kind: 'prop' }));
    zone.spawn(at(1_505, { kind: 'mob' }));
    zone.spawn(at(505, { kind: 'loot' }));
    zone.spawn(at(0, { kind: 'mob', frame: null, pos: [1e8, 0, 0] }));
    expect([...step()].sort((a, b) => a - b)).toEqual([self, ...inside].sort((a, b) => a - b));
  });

  it('measures distance between world positions, whatever frames the entities keep', () => {
    const { zone, station, viewer, step } = setup();
    const home = `${zone.system.seed}:${zone.system.home}`;
    // a ship on the home world's frame, 10 km from the Waystation at the next tick's time (beyond the Waystation's
    // sphere of influence, so it stays in its world's frame)
    const t = T0 + 0.05;
    const poses = systemPoses(zone.system, t);
    const stationWorld = localToWorld(poses.station, [0, 0, 0]);
    const near = worldToLocal(poses.bodies[zone.system.home]!, [stationWorld[0] + 10_000, stationWorld[1], stationWorld[2]]);
    const ship = zone.spawn({ kind: 'ship', frame: home, pos: near, quat: [0, 0, 0, 1], vel: [0, 0, 0] });
    // the same local position in the station's frame is far away
    const other = zone.spawn({ kind: 'ship', frame: station, pos: near, quat: [0, 0, 0, 1], vel: [0, 0, 0] });
    const seen = step();
    expect(seen.has(ship)).toBe(true);
    expect(seen.has(other)).toBe(false);
    expect(zone.entity(ship)!.fields.frame).toBe(home);
    const w = zone.entity(ship)!.world;
    expect(Math.hypot(w[0] - stationWorld[0], w[1] - stationWorld[1], w[2] - stationWorld[2])).toBeCloseTo(10_000, 3);
    // ten minutes on, the world has turned under it and the station has moved along its orbit
    zone.step(T0 + 600);
    expect(zone.interestOf(viewer).has(ship)).toBe(false);
  });

  it('keeps an entity at the edge until it is past the hysteresis margin', () => {
    const { zone, at, step } = setup();
    const r = INTEREST_RADIUS.mob;
    const mob = zone.spawn(at(r * 1.02));
    expect(step().has(mob)).toBe(false); // not yet in view: it must come within the radius
    zone.patch(mob, { pos: [r * 0.99, 0, 0] });
    expect(step().has(mob)).toBe(true);
    zone.patch(mob, { pos: [r * (INTEREST_HYSTERESIS - 0.01), 0, 0] });
    expect(step().has(mob)).toBe(true); // in view: stays inside the margin
    zone.patch(mob, { pos: [r * (INTEREST_HYSTERESIS + 0.01), 0, 0] });
    expect(step().has(mob)).toBe(false);
    zone.patch(mob, { pos: [r * 1.02, 0, 0] });
    expect(step().has(mob)).toBe(false);
  });

  it('changes radius with the class: a player stepping out of its ship', () => {
    const { zone, at, step } = setup();
    const p = zone.spawn(at(10_000, { kind: 'player', mode: 'ship' }));
    expect(step().has(p)).toBe(true);
    zone.patch(p, { mode: 'foot' });
    expect(step().has(p)).toBe(false);
    zone.patch(p, { mode: 'landed' });
    expect(step().has(p)).toBe(true);
  });

  it('always holds the session’s party, wherever they are', () => {
    const { zone, at, self, step } = setup();
    const friend = zone.spawn(at(0, { kind: 'player', mode: 'foot', frame: null, pos: [3e8, 0, 0], party: 'p1' }));
    const stranger = zone.spawn(at(0, { kind: 'player', mode: 'foot', frame: null, pos: [3e8, 10, 0], party: 'p2' }));
    expect(step().has(friend)).toBe(false);
    zone.setParty(self, 'p1');
    let seen = step();
    expect(seen.has(friend)).toBe(true);
    expect(seen.has(stranger)).toBe(false);
    zone.setParty(friend, null);
    seen = step();
    expect(seen.has(friend)).toBe(false);
    zone.setParty(stranger, 'p1');
    expect(step().has(stranger)).toBe(true);
    expect(zone.entity(self)!.party).toBe('p1');
  });

  it('sends an entity in full when it enters, then deltas, then its removal when it leaves or goes', () => {
    const { zone, at, viewer, step } = setup();
    // (out of view, but inside the Waystation's sphere of influence, so it keeps the Waystation's frame)
    const mob = zone.spawn(at(4_000, { species: 4, level: 7, hp: 0.5, mode: 'idle' }));
    step();
    expect(viewer.client.latest.has(mob)).toBe(false);

    zone.patch(mob, { pos: [1_000, 0, 0] });
    step();
    const entered = viewer.client.snapshots.at(-1)!;
    expect(entered.full).toBe(false);
    const full = entered.entities.find((e) => e.id === mob);
    expect(full).toEqual({
      id: mob,
      kind: 'mob',
      frame: zone.stationFrame,
      pos: [1_000, 0, 0],
      quat: [0, 0, 0, 1],
      vel: [0, 0, 0],
      mode: 'idle',
      species: 4,
      level: 7,
      hp: 0.5,
    });

    zone.patch(mob, { pos: [900, 0, 0] }, ['hp']);
    step();
    expect(viewer.client.snapshots.at(-1)!.entities.find((e) => e.id === mob)).toEqual({ id: mob, pos: [900, 0, 0], clear: ['hp'] });
    step();
    expect(viewer.client.snapshots.at(-1)!.entities.find((e) => e.id === mob)).toBeUndefined(); // nothing changed

    zone.patch(mob, { pos: [4_000, 0, 0] });
    step();
    expect(viewer.client.snapshots.at(-1)!.removed).toEqual([mob]);
    expect(viewer.client.latest.has(mob)).toBe(false);

    zone.patch(mob, { pos: [100, 0, 0] });
    step();
    expect(viewer.client.latest.get(mob)).toMatchObject({ id: mob, pos: [100, 0, 0], kind: 'mob' });
    zone.despawn(mob);
    step();
    expect(viewer.client.snapshots.at(-1)!.removed).toEqual([mob]);
    expect(viewer.client.latest.has(mob)).toBe(false);
  });

  it('sees other sessions and loses them when they leave', () => {
    const { zone, at, viewer, step } = setup();
    const other = new Viewer(2);
    const otherId = zone.join(other, at(300, { kind: 'player', mode: 'docked', name: 'Ora', people: 'ixari', level: 1 }));
    step();
    zone.ack(other, zone.tick);
    expect(viewer.client.latest.get(otherId)).toMatchObject({ kind: 'player', name: 'Ora', people: 'ixari', mode: 'docked' });
    expect([...other.client.latest.keys()].sort()).toEqual([...viewer.client.latest.keys()].sort());
    expect(zone.leave(other)).toBe(true);
    expect(zone.leave(other)).toBe(false);
    step();
    expect(viewer.client.snapshots.at(-1)!.removed).toEqual([otherId]);
    expect(zone.entity(otherId)).toBeUndefined();
  });
});
