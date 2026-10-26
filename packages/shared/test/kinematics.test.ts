// Body kinematics and frames of reference (ARCHITECTURE §3–§4): every pose as the demo computed it, bit for bit (the
// golden fixture was first written from the demo's Body.update and station update), velocities and angular velocities
// that are the derivatives of those poses, and frame changes that keep an entity where it is.
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  Galaxy,
  Random,
  bodyPose,
  describeSystem,
  dirToLocal,
  dirToWorld,
  hashInts,
  localToWorld,
  setFrame,
  setFrameInto,
  starPose,
  stationPose,
  systemPoses,
  worldToLocal,
  type BodyPose,
  type Frame,
  type LocalPose,
  type Quat,
  type SystemDescription,
  type SystemMotions,
  type Vec3,
} from '../src/world/index.ts';
import { asJson } from './digest.ts';
import { digestPoses, poseTimes } from './poses.ts';
import fixture from './fixtures/poses-424242.json';

const galaxy = new Galaxy(424242);
/** Systems 0–5 of the fixture's galaxy as the client builds them, then a few from bare seeds (gas giants, more moons). */
const SYSTEMS: SystemDescription[] = [
  ...galaxy.systems.slice(0, 6).map((s) => describeSystem(s.seed, { name: s.name, cls: s.cls, homeType: s.id === 0 ? 'lush' : undefined })),
  ...Array.from({ length: 6 }, (_, i) => describeSystem(hashInts(11, i))),
];

const len = (v: ArrayLike<number>) => Math.hypot(...Array.from(v));
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const l = len(v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** A body's local axis in world axes. */
const axis = (p: BodyPose, local: Vec3) => dirToWorld(p, local);
/** The rotation that takes quaternion a to b, as an angle (0 for the same orientation, whatever the sign). */
const angleBetween = (a: Quat, b: Quat) => {
  const rel = new Quaternion().fromArray(a).invert().multiply(new Quaternion().fromArray(b));
  return 2 * Math.atan2(Math.hypot(rel.x, rel.y, rel.z), Math.abs(rel.w));
};

describe('poses golden fixture (first written from the demo’s Body.update and station update)', () => {
  interface Pinned {
    t: number;
    position: number[];
    quaternion: number[];
    velocity?: number[];
  }
  interface Run {
    name: string;
    poses: string;
    first: Pinned[];
  }
  interface FixtureSystem {
    id: number;
    name: string;
    bodies: (SystemMotions['bodies'][number] & Run)[];
    station: SystemMotions['station'] & Run;
  }
  const times = poseTimes(fixture.times.seed, fixture.times.count);

  it('samples 1,000 times from 0 to decades', () => {
    expect(times.length).toBe(1000);
    expect(times[0]).toBe(0);
    expect(Math.max(...times)).toBeGreaterThan(5e8);
    expect(times.filter((t) => t < 100).length).toBeGreaterThan(100);
  });

  it.each((fixture.systems as unknown as FixtureSystem[]).map((s) => [s.id, s.name, s] as const))('system %i %s', (_id, _name, sys) => {
    const runs = times.map((t) => systemPoses(sys, t));
    const bodies = sys.bodies.map((b, i) => {
      const poses = runs.map((r) => r.bodies[i]);
      return {
        name: b.name,
        poses: digestPoses(poses),
        first: asJson(poses.slice(0, 3).map(({ position, quaternion, velocity }, k) => ({ t: times[k], position, quaternion, velocity }))),
      };
    });
    expect(bodies).toEqual(sys.bodies.map(({ name, poses, first }) => ({ name, poses, first })));
    const station = runs.map((r) => ({ position: r.station.position, quaternion: r.station.quaternion }));
    expect({ poses: digestPoses(station), first: asJson(station.slice(0, 3).map((p, k) => ({ t: times[k], ...p }))) }).toEqual({
      poses: sys.station.poses,
      first: sys.station.first,
    });
  });
});

describe('systemPoses', () => {
  const rng = new Random(91);
  const someTimes = [0, ...Array.from({ length: 40 }, () => rng.float(0, 1e6))];

  it('puts the star at rest at the centre, each body on its orbit about its parent and the Waystation on its own', () => {
    for (const d of SYSTEMS) {
      for (const t of someTimes) {
        const p = systemPoses(d, t);
        expect(p.star).toEqual(starPose());
        expect(p.bodies.length).toBe(d.bodies.length);
        d.bodies.forEach((b, i) => {
          const parent = b.parent === null ? p.star : p.bodies[b.parent];
          expect(len(sub(p.bodies[i].position, parent.position)) / b.orbitRadius).toBeCloseTo(1, 12);
          expect(len(p.bodies[i].quaternion)).toBeCloseTo(1, 12);
          expect(p.bodies[i]).toEqual(bodyPose(b, t, parent));
        });
        expect(len(sub(p.station.position, p.bodies[d.home].position)) / d.station.orbitRadius).toBeCloseTo(1, 12);
        expect(p.station).toEqual(stationPose(d.station, t, p.bodies[d.home]));
      }
    }
  });

  it('is plain data, the same every time', () => {
    const p = systemPoses(SYSTEMS[0], 1234.5);
    expect(JSON.parse(JSON.stringify(p))).toEqual(asJson(p));
    expect(systemPoses(SYSTEMS[0], 1234.5)).toEqual(p);
  });

  it('refuses a body that orbits one listed after it', () => {
    const d = SYSTEMS.find((s) => s.bodies.some((b) => b.parent !== null))!;
    const moon = d.bodies.findIndex((b) => b.parent !== null);
    const bodies = [...d.bodies];
    bodies.splice(moon, 1);
    bodies.splice(d.bodies[moon].parent!, 0, d.bodies[moon]);
    expect(() => systemPoses({ ...d, bodies }, 0)).toThrow(RangeError);
    expect(() => systemPoses({ ...d, station: { ...d.station, parent: d.bodies.length } }, 0)).toThrow(RangeError);
  });

  it('bodyPose refuses a moon without its planet’s pose, and orbits a planet round the star by default', () => {
    const d = SYSTEMS.find((s) => s.bodies.some((b) => b.parent !== null))!;
    const moon = d.bodies.find((b) => b.parent !== null)!;
    expect(() => bodyPose(moon, 100)).toThrow(RangeError);
    expect(bodyPose(moon, 100, systemPoses(d, 100).bodies[moon.parent!])).toEqual(systemPoses(d, 100).bodies[moon.index]);
    expect(bodyPose(d.bodies[0], 100)).toEqual(systemPoses(d, 100).bodies[0]);
  });

  it('moves every body and the Waystation at its velocity, turning at its angular velocity', () => {
    for (const d of SYSTEMS) {
      for (const t of someTimes.slice(0, 10)) {
        const now = systemPoses(d, t);
        const all = (p: typeof now) => [...p.bodies, p.station];
        // a step small against every period, large against the rounding of positions a few AU out
        const h = 0.05;
        const before = all(systemPoses(d, t - h));
        const after = all(systemPoses(d, t + h));
        all(now).forEach((p, i) => {
          const v = sub(after[i].position, before[i].position).map((x) => x / (2 * h));
          expect(len(sub(v as Vec3, p.velocity))).toBeLessThan(1e-6 * len(p.velocity) + 1e-3);
          // the rotation from t − h to t + h, in world axes, against ω·2h
          const dq = new Quaternion().fromArray(after[i].quaternion).multiply(new Quaternion().fromArray(before[i].quaternion).invert());
          if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
          const s = Math.hypot(dq.x, dq.y, dq.z);
          const angle = 2 * Math.atan2(s, dq.w);
          const w: Vec3 = s === 0 ? [0, 0, 0] : [(dq.x / s) * (angle / (2 * h)), (dq.y / s) * (angle / (2 * h)), (dq.z / s) * (angle / (2 * h))];
          expect(len(sub(w, p.angularVelocity))).toBeLessThan(1e-7 * len(p.angularVelocity) + 1e-12);
        });
        // spinning bodies turn about their own (tilted) axis; the Waystation once per orbit
        d.bodies.forEach((b, i) => {
          const p = now.bodies[i];
          expect(len(p.angularVelocity)).toBeCloseTo((2 * Math.PI) / b.rotationPeriod, 15);
          expect(dot(unit(p.angularVelocity), axis(p, [0, 1, 0]))).toBeCloseTo(1, 12);
        });
        expect(len(now.station.angularVelocity)).toBeCloseTo((2 * Math.PI) / d.station.orbitPeriod, 15);
      }
    }
  });

  it('keeps the Waystation’s floor facing away from its world and its hangar mouth along its orbit', () => {
    for (const d of SYSTEMS) {
      for (const t of someTimes) {
        const p = systemPoses(d, t);
        const world = p.bodies[d.station.parent];
        expect(dot(axis(p.station, [0, 1, 0]), unit(sub(p.station.position, world.position)))).toBeCloseTo(1, 12);
        expect(dot(axis(p.station, [0, 0, 1]), unit(sub(p.station.velocity, world.velocity)))).toBeCloseTo(1, 12);
      }
    }
  });
});

describe('frames of reference', () => {
  const rng = new Random(2026);
  const r = (a: number, b: number) => rng.float(a, b);
  const randomDir = (): Vec3 => unit([r(-1, 1), r(-1, 1), r(-1, 1)]);
  const scaled = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
  const randomQuat = (): Quat => new Quaternion().setFromAxisAngle(new Vector3(...randomDir()), r(0, 2 * Math.PI)).toArray();

  /** Every frame of a system at time t: the inertial frame, its planets and moons and its Waystation, each with the
   * reach an entity in it might have. */
  function frames(d: SystemDescription, t: number): { frame: Frame | null; reach: number }[] {
    const p = systemPoses(d, t);
    return [
      { frame: null, reach: d.outerOrbit },
      ...p.bodies.map((b, i) => ({ frame: b, reach: d.bodies[i].soi })),
      { frame: p.station, reach: d.station.soi },
    ];
  }

  it('localToWorld and worldToLocal undo each other', () => {
    for (const d of SYSTEMS) {
      const t = r(0, 1e7);
      for (const { frame, reach } of frames(d, t)) {
        for (let k = 0; k < 20; k++) {
          const local = scaled(randomDir(), r(0, reach));
          const world = localToWorld(frame, local);
          expect(len(sub(worldToLocal(frame, world), local))).toBeLessThan(1e-4);
          expect(len(sub(localToWorld(frame, worldToLocal(frame, world)), world))).toBeLessThan(1e-4);
          // directions turn, and keep their length
          const dir = scaled(randomDir(), r(0, 3e4));
          expect(len(sub(dirToLocal(frame, dirToWorld(frame, dir)), dir))).toBeLessThan(1e-12 * len(dir) + 1e-12);
          expect(len(dirToWorld(frame, dir)) / len(dir)).toBeCloseTo(1, 12);
          if (!frame) expect(localToWorld(frame, local)).toEqual(local);
        }
      }
    }
  });

  it('setFrame keeps an entity’s world position within 1 cm, its orientation, and its velocity turned but never boosted', () => {
    for (const d of SYSTEMS) {
      const t = r(0, 1e7);
      const all = frames(d, t);
      for (let n = 0; n < 20; n++) {
        // somewhere in some frame's reach
        let at = all[rng.int(0, all.length - 1)];
        let state: LocalPose = { pos: scaled(randomDir(), r(0, at.reach)), quat: randomQuat(), vel: scaled(randomDir(), r(0, 3e4)) };
        const world = setFrame(state, at.frame, null);
        for (let k = 0; k < 12; k++) {
          const to = all[rng.int(0, all.length - 1)];
          state = setFrame(state, at.frame, to.frame);
          at = to;
          const now = setFrame(state, at.frame, null);
          expect(len(sub(now.pos, world.pos))).toBeLessThan(0.01);
          expect(angleBetween(now.quat, world.quat)).toBeLessThan(1e-9);
          // (the arcade flight model: velocity is relative to the frame it is in, so a frame change only turns it)
          expect(len(sub(now.vel, world.vel))).toBeLessThan(1e-9 * len(world.vel) + 1e-12);
          expect(len(state.vel) / len(world.vel)).toBeCloseTo(1, 12);
        }
      }
    }
  });

  it('changes nothing when the frame stays the same, and expresses inertial poses as they are', () => {
    const p = systemPoses(SYSTEMS[1], 777);
    const state: LocalPose = { pos: [1, 2, 3], quat: [0, 0, 0, 1], vel: [4, 5, 6] };
    expect(setFrame(state, null, null)).toEqual(state);
    const there = setFrame(state, p.bodies[0], p.bodies[0]);
    expect(len(sub(there.pos, state.pos))).toBeLessThan(1e-6);
    expect(angleBetween(there.quat, state.quat)).toBeLessThan(1e-9);
    // a body at rest in its own frame faces the way the frame does
    expect(angleBetween(setFrame(state, p.station, null).quat, p.station.quaternion)).toBeLessThan(1e-12);
  });

  it('setFrame on arrays is setFrameInto on three’s objects, bit for bit', () => {
    const p = systemPoses(SYSTEMS[2], 4321);
    const objects = (f: BodyPose) => ({ position: new Vector3().fromArray(f.position), quaternion: new Quaternion().fromArray(f.quaternion) });
    for (const [from, to] of [
      [p.bodies[0], p.station],
      [null, p.bodies[1]],
      [p.station, null],
    ] as const) {
      const state: LocalPose = { pos: [1234.5, -88.25, 9e5], quat: randomQuat(), vel: [-3, 400, 12] };
      const o = { pos: new Vector3().fromArray(state.pos), quat: new Quaternion().fromArray(state.quat), vel: new Vector3().fromArray(state.vel) };
      setFrameInto(o, from && objects(from), to && objects(to));
      expect(setFrame(state, from, to)).toEqual({ pos: o.pos.toArray(), quat: o.quat.toArray(), vel: o.vel.toArray() });
    }
  });
});
