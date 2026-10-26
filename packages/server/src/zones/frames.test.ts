// Frames of reference in a zone (docs/ARCHITECTURE.md §4): each tick the zone re-expresses every entity in the frame
// the shared rule picks for it at the tick's time, keeping its world position within 1 cm and turning (never boosting)
// its velocity, and its snapshots report the entity in its new frame under a frame id the protocol accepts.
import { FrameId, type EntityState } from '@astra/shared/protocol';
import {
  frameIdOf,
  frameKeyOf,
  framePose,
  localToWorld,
  reframe,
  systemPoses,
  worldToLocal,
  type FrameKey,
  type FramedPose,
  type SystemDescription,
  type Vec3,
} from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import { describeZoneSystem } from './system.ts';
import { Zone, type ZoneViewer } from './zone.ts';

/** Thirty years of server time. */
const T0 = 9.4e8;

class Viewer implements ZoneViewer {
  readonly client = new SnapshotClient();
  constructor(readonly id: number) {}
  sendBinary(data: Uint8Array): void {
    this.client.receive(data);
  }
}

const len = (v: ArrayLike<number>) => Math.hypot(...Array.from(v));
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** A pose's world position and world velocity in system d at time t. */
function inWorld(d: SystemDescription, t: number, p: FramedPose) {
  return reframe(d, systemPoses(d, t), p, null);
}

function setup() {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0) });
  const d = zone.system;
  const viewer = new Viewer(1);
  let time = T0;
  const step = (dt = 0.05) => {
    zone.step((time += dt));
    zone.ack(viewer, zone.tick);
    return viewer.client.snapshots.at(-1)!;
  };
  /** The entity as the viewer last saw it, as a wire pose. */
  const seen = (id: number): FramedPose => {
    const e = viewer.client.latest.get(id) as Required<EntityState>;
    return { frame: e.frame, pos: e.pos, quat: e.quat, vel: e.vel };
  };
  const id = (key: FrameKey) => frameIdOf(d.seed, key);
  return { zone, d, viewer, step, seen, id, now: () => time };
}

describe('frames of reference in a zone', () => {
  it('reports a ship flying out of the Waystation’s sphere, out of its world’s, into another planet’s and back to the Waystation in each new frame', () => {
    const { zone, d, viewer, step, seen, id, now } = setup();
    const self = zone.join(viewer, { kind: 'player', frame: id('station'), pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' });
    step();
    expect(seen(self).frame).toBe(id('station'));

    // a planet with no moons, not the home world
    const other = d.bodies.findIndex((b, i) => b.kind === 'planet' && i !== d.home && d.bodies[i + 1]?.kind !== 'moon');
    expect(other).toBeGreaterThanOrEqual(0);
    const quat: [number, number, number, number] = [0, 0.6, 0, 0.8];
    let seq = 0;
    const legs: { from: FrameKey; to: FrameKey; local: (t: number) => Vec3 }[] = [
      // 6 km off the Waystation: beyond its sphere (4.5 km, and 5% more), still in its world's
      { from: 'station', to: d.home, local: () => [0, 1000, 6000] },
      // beyond the home world's sphere (and 5% more): the inertial frame
      { from: d.home, to: null, local: () => [d.bodies[d.home]!.soi * 1.1, 0, 0] },
      // 3 km above the other planet's surface
      {
        from: null,
        to: other,
        local: (t) => add(systemPoses(d, t).bodies[other]!.position, [0, d.bodies[other]!.radius + 3000, 0]),
      },
      // into the Waystation's sphere, from the other planet's frame
      { from: other, to: 'station', local: (t) => worldToLocal(systemPoses(d, t).bodies[other]!, localToWorld(systemPoses(d, t).station, [0, 0, 900])) },
    ];
    for (const leg of legs) {
      const t = now() + 0.05;
      const sent: FramedPose = { frame: id(leg.from), pos: leg.local(t), quat, vel: [30, 0, 250] };
      expect(zone.input(viewer, { t: 'input', seq: ++seq, time: t, mode: 'ship', pose: sent, buttons: 0 })).toBe('ok');
      const snap = step();
      expect(snap.time).toBe(t);
      const got = seen(self);
      expect(got.frame).toBe(id(leg.to));
      expect(FrameId.safeParse(got.frame).success).toBe(true);
      expect(snap.entities.find((e) => e.id === self)?.frame).toBe(id(leg.to));
      const before = inWorld(d, t, sent);
      const after = inWorld(d, t, got);
      expect(len(sub(after.pos, before.pos))).toBeLessThan(0.01);
      // the velocity turned into the new frame's axes, not boosted by either frame's motion
      expect(len(sub(after.vel, before.vel))).toBeLessThan(1e-9 * len(before.vel));
      expect(len(got.vel)).toBeCloseTo(len(sent.vel), 9);
      // and the zone keeps it there, its world position the same
      expect(zone.entity(self)!.fields.frame).toBe(id(leg.to));
      expect(len(sub(zone.entity(self)!.world as Vec3, before.pos))).toBeLessThan(0.01);
    }
  });

  it('moves an entity at rest into a planet’s frame as the planet comes to it, unboosted', () => {
    const { zone, d, viewer, step, seen, id } = setup();
    const self = zone.join(viewer, { kind: 'player', frame: id('station'), pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship', party: 'p' });
    const i = d.bodies.findIndex((b, k) => b.kind === 'planet' && k !== d.home && d.bodies[k + 1]?.kind !== 'moon');
    const b = d.bodies[i]!;
    const v = len(systemPoses(d, T0).bodies[i]!.velocity);
    // where the planet will be once it has come three of its spheres' reach, 5 km above its surface
    const dt = (3 * b.soi) / v;
    const there = add(systemPoses(d, T0 + dt).bodies[i]!.position, [0, b.radius + 5000, 0]);
    // (seen by the viewer wherever it is: they share a party)
    const rock = zone.spawn({ kind: 'prop', frame: null, pos: there, quat: [0, 0, 0, 1], vel: [0, 0, 0], party: 'p' });
    step();
    expect(seen(rock).frame).toBeNull();
    expect(seen(self).frame).toBe(id('station'));
    const snap = step(dt - 0.05);
    const got = seen(rock);
    expect(got.frame).toBe(id(i));
    expect(frameKeyOf(d, got.frame)).toBe(i);
    expect(got.vel).toEqual([0, 0, 0]);
    expect(len(sub(inWorld(d, snap.time, got).pos, there))).toBeLessThan(0.01);
    // from then on it rides with the planet
    step(600);
    expect(seen(rock).frame).toBe(id(i));
    expect(seen(rock).pos).toEqual(got.pos);
  });

  it('keeps an entity in its frame until 5% beyond its sphere, and takes it in only once inside', () => {
    const { zone, d, viewer, step, seen, id } = setup();
    zone.join(viewer, { kind: 'player', frame: id('station'), pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship', party: 'p' });
    const home = d.home;
    const soi = d.bodies[home]!.soi;
    const ship = zone.spawn({ kind: 'ship', frame: id(home), pos: [0, 0, soi * 1.03], quat: [0, 0, 0, 1], vel: [0, 0, 0], party: 'p' });
    step();
    expect(seen(ship).frame).toBe(id(home));
    zone.patch(ship, { pos: [0, 0, soi * 1.06] });
    step();
    expect(seen(ship).frame).toBeNull();
    // in the inertial frame, 3% beyond the sphere is still outside it
    const w = (k: number) => localToWorld(framePose(systemPoses(d, zone.time + 0.05), home), [0, 0, soi * k]);
    zone.patch(ship, { pos: w(1.03) });
    step();
    expect(seen(ship).frame).toBeNull();
    zone.patch(ship, { pos: w(0.99) });
    step();
    expect(seen(ship).frame).toBe(id(home));
    expect(len(sub(seen(ship).pos, [0, 0, soi * 0.99]))).toBeLessThan(0.01);
  });

  it('takes an entity on its world’s frame into the Waystation’s within the Waystation’s sphere', () => {
    const { zone, d, viewer, step, seen, id, now } = setup();
    zone.join(viewer, { kind: 'player', frame: id('station'), pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    const poses = systemPoses(d, now() + 0.05);
    const world = localToWorld(poses.station, [1000, 0, 0]);
    const mob = zone.spawn({ kind: 'mob', frame: id(d.home), pos: worldToLocal(poses.bodies[d.home]!, world), quat: [0, 0, 0, 1], vel: [0, 0, 0] });
    step();
    const got = seen(mob);
    expect(got.frame).toBe(id('station'));
    expect(len(sub(got.pos, [1000, 0, 0]))).toBeLessThan(0.01);
    // an entity at rest beside the Waystation now moves with it
    step(600);
    expect(seen(mob).pos).toEqual(got.pos);
    expect(zone.interestOf(viewer).has(mob)).toBe(true);
  });
});
