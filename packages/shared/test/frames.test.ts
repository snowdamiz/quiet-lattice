// Frames of reference over the wire (ARCHITECTURE §4): the one frame-selection rule, the client's and the server's use
// of it agreeing everywhere, poses keeping their world position through every frame change, and the conversions
// between the protocol's poses (a frame id and arrays) and the kinematics' shapes.
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FrameId, Pose } from '../src/protocol/index.ts';
import {
  FRAME_HYSTERESIS,
  GALAXY_SEED,
  Galaxy,
  Random,
  bodyPoseInto,
  chooseFrame,
  describeGalaxySystem,
  frameDistance,
  frameIdOf,
  frameKeyOf,
  framePose,
  framedPose,
  innermostFrame,
  localPoseInto,
  localToWorld,
  localToWorldInto,
  reframe,
  selectFrame,
  setFrameInto,
  settleFrame,
  stationPoseInto,
  systemPoses,
  worldToLocal,
  type FrameKey,
  type FramedPose,
  type Motion,
  type Orbit,
  type Quat,
  type SystemDescription,
  type SystemPoses,
  type Vec3,
} from '../src/world/index.ts';

const galaxy = new Galaxy(GALAXY_SEED);
/** Galaxy systems 0–9 of the game, described as the client and the server's zones describe them. */
const SYSTEMS: SystemDescription[] = galaxy.systems.slice(0, 10).map((s) => describeGalaxySystem(s));
/** Thirty years of server time: positions and angles at their largest. */
const LATE = 9.4e8;

const len = (v: ArrayLike<number>) => Math.hypot(...Array.from(v));
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaled = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const unit = (v: Vec3): Vec3 => scaled(v, 1 / len(v));

/** Every frame key of a system: the inertial frame, each planet and moon, the Waystation. */
const keysOf = (d: SystemDescription): FrameKey[] => [null, ...d.bodies.map((_, i) => i), 'station'];
const soiOf = (d: SystemDescription, key: number | 'station') => (key === 'station' ? d.station.soi : d.bodies[key]!.soi);

// ---------- the client's side, as it runs in the browser ----------

/** One of the client's bodies (Body, Station): its motion in three's objects, its pose updated in place each frame by
 * bodyPoseInto or stationPoseInto (Body.update, Station.update), its sphere of influence and Body.distanceTo. */
class ClientBody implements Motion<Quaternion> {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  readonly angularVelocity = new Vector3();
  readonly orbitTilt: Quaternion;
  readonly axialTilt: Quaternion;
  readonly orbitRadius: number;
  readonly orbitPeriod: number;
  readonly orbitPhase: number;
  readonly rotationPeriod: number;
  readonly rotationPhase: number;

  constructor(
    spec: Orbit & Partial<Motion>,
    readonly parent: ClientBody | null,
    readonly soi: number,
    readonly station = false,
  ) {
    this.orbitRadius = spec.orbitRadius;
    this.orbitPeriod = spec.orbitPeriod;
    this.orbitPhase = spec.orbitPhase;
    this.orbitTilt = new Quaternion().fromArray(spec.orbitTilt);
    this.rotationPeriod = spec.rotationPeriod ?? 0;
    this.rotationPhase = spec.rotationPhase ?? 0;
    this.axialTilt = new Quaternion().fromArray(spec.axialTilt ?? [0, 0, 0, 1]);
  }

  update(t: number): void {
    if (this.station) stationPoseInto(this, t, this.parent!, this);
    else bodyPoseInto(this, t, this.parent, this);
  }

  distanceTo(world: Vector3): number {
    return new Vector3().copy(world).sub(this.position).length();
  }
}

/** A system as the client's SolarSystem and Station hold it. */
class ClientSystem {
  readonly star: ClientBody;
  readonly planets: ClientBody[] = [];
  readonly station: ClientBody;

  constructor(d: SystemDescription) {
    this.star = new ClientBody({ orbitRadius: 0, orbitPeriod: 1, orbitPhase: 0, orbitTilt: [0, 0, 0, 1] }, null, 0);
    for (const b of d.bodies) this.planets.push(new ClientBody(b, b.parent === null ? this.star : this.planets[b.parent]!, b.soi));
    this.station = new ClientBody(d.station, this.planets[d.station.parent]!, d.station.soi, true);
  }

  update(t: number): void {
    this.star.update(t);
    for (const p of this.planets) p.update(t);
    this.station.update(t);
  }

  frame(key: FrameKey): ClientBody | null {
    return key === null ? null : key === 'station' ? this.station : this.planets[key]!;
  }

  key(frame: ClientBody | null): FrameKey {
    return frame === null ? null : frame === this.station ? 'station' : this.planets.indexOf(frame);
  }

  /** Game.chooseFrame: the frame an entity kept in `frame` at local position `pos` (a FrameState) belongs in. */
  chooseFrame(frame: ClientBody | null, pos: Vector3): ClientBody | null {
    const wp = localToWorldInto(frame, pos, new Vector3());
    return selectFrame({ bodies: this.planets, station: this.station }, frame, (f) => f.distanceTo(wp));
  }

  /** The demo's rule, as Game.chooseFrame and SolarSystem.frameFor had it before the rule moved to shared. */
  demoChooseFrame(frame: ClientBody | null, pos: Vector3): ClientBody | null {
    const wp = localToWorldInto(frame, pos, new Vector3());
    const frameFor = (world: Vector3, extra: ClientBody[]) => {
      for (const e of extra) if (e.distanceTo(world) < e.soi) return e;
      let best: ClientBody | null = null;
      for (const p of this.planets) {
        if (p.distanceTo(world) < p.soi && (!best || p.soi < best.soi)) best = p;
      }
      return best;
    };
    const cur = frame;
    if (cur && cur.distanceTo(wp) < cur.soi * 1.05) {
      const inner = frameFor(wp, [this.station]);
      if (inner && inner !== cur && inner.soi < cur.soi) return inner;
      return cur;
    }
    return frameFor(wp, [this.station]);
  }
}

describe('selectFrame', () => {
  /** Toy spheres along the x axis: a planet, a moon inside its sphere, a station inside the moon's. */
  const at = (x: number, soi: number) => ({ position: [x, 0, 0] as Vec3, soi });
  const planet = at(0, 1000);
  const moon = at(500, 100);
  const far = at(10_000, 2000);
  const station = at(-600, 50);
  const frames = { bodies: [planet, moon, far], station };
  const pick = (x: number, current: (typeof frames.bodies)[number] | null) => selectFrame(frames, current, (f) => frameDistance(f, [x, 0, 0]));

  it('takes the innermost sphere that holds the entity: the Waystation’s, else the smallest, else the inertial frame', () => {
    expect(pick(0, null)).toBe(planet);
    expect(pick(520, null)).toBe(moon);
    expect(pick(-620, null)).toBe(station);
    expect(pick(10_500, null)).toBe(far);
    expect(pick(5000, null)).toBeNull();
    expect(innermostFrame(frames, (f) => frameDistance(f, [520, 0, 0]))).toBe(moon);
    // the Waystation is preferred inside its sphere, however large
    const big = { bodies: [planet], station: at(0, 5000) };
    expect(innermostFrame(big, (f) => frameDistance(f, [0, 0, 0]))).toBe(big.station);
  });

  it('keeps an entity in its frame until it is 5% beyond the frame’s sphere', () => {
    expect(FRAME_HYSTERESIS).toBe(1.05);
    expect(pick(1040, planet)).toBe(planet);
    expect(pick(1060, planet)).toBeNull();
    // (not yet in: from outside, it must come within the sphere)
    expect(pick(1040, null)).toBeNull();
    expect(pick(990, null)).toBe(planet);
    expect(pick(604, moon)).toBe(moon);
    expect(pick(606, moon)).toBe(planet);
  });

  it('moves an entity into a smaller sphere inside its frame’s, never out of one into a larger', () => {
    expect(pick(520, planet)).toBe(moon);
    expect(pick(-620, planet)).toBe(station);
    // in the band beyond the moon's sphere but within the planet's, it stays with the moon
    expect(pick(603, moon)).toBe(moon);
    // in a frame it is far outside, it takes the innermost one that holds it
    expect(pick(520, far)).toBe(moon);
    expect(pick(5000, far)).toBeNull();
  });
});

describe('the client and the server pick the same frame', () => {
  it('at 1,000 random positions and times across galaxy systems 0–9, and both as the demo did', () => {
    const rng = new Random(424);
    const clients = SYSTEMS.map((d) => new ClientSystem(d));
    const scales = [1e2, 1e4, 1e6, 1e8, 1e9];
    const disagreements: unknown[] = [];
    const outcomes = { stayed: 0, inner: 0, inertial: 0, entered: 0 };
    for (let n = 0; n < 1000; n++) {
      const s = rng.int(0, SYSTEMS.length - 1);
      const d = SYSTEMS[s]!;
      const client = clients[s]!;
      const t = rng.float(0, 1) * scales[rng.int(0, scales.length - 1)]!;
      const poses = systemPoses(d, t);
      client.update(t);
      // somewhere about a sphere's edge (most of the time), or anywhere in the system
      const dir = unit([rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)]);
      let world: Vec3;
      let near: number | 'station' | null = null;
      if (rng.next() < 0.85) {
        near = rng.next() < 0.3 ? 'station' : rng.int(0, d.bodies.length - 1);
        world = add(framePose(poses, near)!.position, scaled(dir, soiOf(d, near) * rng.float(0.9, 1.1)));
      } else world = scaled(dir, rng.float(0, d.outerOrbit));
      // in a frame it may well be in: the one it is near, its world's, the home world's, the Waystation's, any
      const parent = near === null ? null : near === 'station' ? d.station.parent : d.bodies[near]!.parent;
      const current = rng.pick<FrameKey>([near, parent, d.home, 'station', null, rng.int(0, d.bodies.length - 1)]);
      const local = worldToLocal(framePose(poses, current), world);

      const server = chooseFrame(d, poses, localToWorld(framePose(poses, current), local), current);
      const pos = new Vector3().fromArray(local);
      const ours = client.key(client.chooseFrame(client.frame(current), pos));
      const demo = client.key(client.demoChooseFrame(client.frame(current), pos));
      if (server !== ours || ours !== demo) disagreements.push({ system: s, t, local, current, server, ours, demo });
      if (server === current) outcomes.stayed++;
      else if (server === null) outcomes.inertial++;
      else if (current !== null && soiOf(d, server) < soiOf(d, current)) outcomes.inner++;
      else outcomes.entered++;
    }
    expect(disagreements).toEqual([]);
    // (every branch of the rule was taken many times)
    for (const k of Object.values(outcomes)) expect(k).toBeGreaterThan(50);
  });
});

describe('frame changes over the wire', () => {
  /** A point `r` from `centre` that no sphere but `owner`'s holds, nor comes within 10% of holding (with `owner` a body,
   * no smaller sphere: none of its moons, nor the Waystation). */
  function pointNear(d: SystemDescription, poses: SystemPoses, centre: Vec3, r: number, owner: FrameKey, rng: Random): Vec3 {
    for (;;) {
      const p = add(centre, scaled(unit([rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)]), r));
      const held = keysOf(d).some(
        (k) => k !== null && k !== owner && (owner === null || soiOf(d, k) < soiOf(d, owner)) && frameDistance(framePose(poses, k)!, p) < soiOf(d, k) * 1.1,
      );
      if (!held) return p;
    }
  }
  /** A point on a body's surface, 2 km up, that no smaller sphere holds. */
  const surfacePoint = (d: SystemDescription, poses: SystemPoses, i: number, rng: Random) =>
    pointNear(d, poses, poses.bodies[i]!.position, d.bodies[i]!.radius + 2000, i, rng);

  /** `p` in the inertial frame: its world position, and its velocity turned into world axes (frames do not boost it). */
  const inWorld = (d: SystemDescription, poses: SystemPoses, p: FramedPose) => reframe(d, poses, p, null);

  it('keeps world position within 1 cm from a planet to the inertial frame, another planet and the Waystation, decades on', () => {
    const rng = new Random(77);
    for (const d of SYSTEMS) {
      const planets = d.bodies.filter((b) => b.kind === 'planet' && b.index !== d.home).map((b) => b.index);
      const [a, b] = [planets[0]!, planets[planets.length - 1]!];
      let t = LATE + rng.float(0, 1e6);
      let poses = systemPoses(d, t);
      const quat = new Quaternion().setFromAxisAngle(new Vector3(...unit([1, 2, 3])), 1.1).toArray() as Quat;
      // on planet a's frame, flying at 300 m/s
      let p: FramedPose = {
        frame: frameIdOf(d.seed, a),
        pos: worldToLocal(poses.bodies[a]!, surfacePoint(d, poses, a, rng)),
        quat,
        vel: scaled(unit([0.3, 1, -0.2]), 300),
      };
      expect(settleFrame(d, poses, p)).toBe(p);
      const legs: { to: FrameKey; target: (poses: SystemPoses) => Vec3 }[] = [
        // out of a's sphere: the inertial frame
        { to: null, target: (q) => pointNear(d, q, q.bodies[a]!.position, d.bodies[a]!.soi * 1.2, null, rng) },
        // down to planet b's surface
        { to: b, target: (q) => surfacePoint(d, q, b, rng) },
        // across to the Waystation, 800 m off its hangar
        { to: 'station', target: (q) => localToWorld(q.station, [100, -200, 800]) },
        // and home to planet a
        { to: a, target: (q) => surfacePoint(d, q, a, rng) },
      ];
      for (const leg of legs) {
        t += 45;
        poses = systemPoses(d, t);
        // the entity arrives there in the frame it was in, as a client that has not yet changed frame would send it
        const target = leg.target(poses);
        const from = frameKeyOf(d, p.frame)!;
        const arrived: FramedPose = { ...p, pos: worldToLocal(framePose(poses, from), target) };
        const before = inWorld(d, poses, arrived);
        p = settleFrame(d, poses, arrived);
        expect(p.frame).toBe(frameIdOf(d.seed, leg.to));
        expect(FrameId.safeParse(p.frame).success).toBe(true);
        expect(Pose.safeParse(p).success).toBe(true);
        const after = inWorld(d, poses, p);
        expect(len(sub(after.pos, target))).toBeLessThan(0.01);
        expect(len(sub(after.pos, before.pos))).toBeLessThan(0.01);
        // velocity turned into the new frame's axes, never boosted by either frame's motion
        expect(len(sub(after.vel, before.vel))).toBeLessThan(1e-9 * len(before.vel));
        expect(len(p.vel)).toBeCloseTo(300, 9);
        // and settled, it stays
        expect(settleFrame(d, poses, p)).toBe(p);
      }
      // a full round trip through every frame at one time comes back where it started
      let q = p;
      for (const k of [null, b, 'station', ...keysOf(d), a] as FrameKey[]) q = reframe(d, poses, q, k);
      expect(q.frame).toBe(p.frame);
      expect(len(sub(q.pos, p.pos))).toBeLessThan(0.01);
      expect(len(sub(q.vel, p.vel))).toBeLessThan(1e-6);
    }
  });

  it('does not boost a resting entity by the frame it enters', () => {
    const d = SYSTEMS[0]!;
    const poses = systemPoses(d, LATE);
    const station = poses.station;
    // at rest in the inertial frame, inside the Waystation's sphere
    const p: FramedPose = { frame: null, pos: localToWorld(station, [0, 300, 900]), quat: [0, 0, 0, 1], vel: [0, 0, 0] };
    const q = settleFrame(d, poses, p);
    expect(q.frame).toBe(frameIdOf(d.seed, 'station'));
    expect(q.vel).toEqual([0, 0, 0]);
    expect(len(station.velocity)).toBeGreaterThan(1000);
    expect(len(sub(q.pos, [0, 300, 900]))).toBeLessThan(0.01);
  });

  it('writes frame ids the protocol accepts, and reads back only the system’s own', () => {
    for (const d of SYSTEMS) {
      for (const key of keysOf(d)) {
        const id = frameIdOf(d.seed, key);
        expect(FrameId.safeParse(id).success).toBe(true);
        expect(frameKeyOf(d, id)).toBe(key);
      }
      const other = SYSTEMS.find((o) => o.seed !== d.seed)!;
      for (const bad of [
        `${other.seed}:0`,
        `${other.seed}:station`,
        `${d.seed}:${d.bodies.length}`,
        `${d.seed}:01`,
        `0${d.seed}:station`,
        `${d.seed}:`,
        `${d.seed}:Station`,
        'station',
        '',
      ]) {
        expect(frameKeyOf(d, bad)).toBeUndefined();
      }
      expect(() => reframe(d, systemPoses(d, 0), { frame: `${other.seed}:0`, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, null)).toThrow(RangeError);
    }
  });

  it('converts between wire poses and the client’s FrameState, and re-expresses them as FrameState.setFrame does, bit for bit', () => {
    const d = SYSTEMS[3]!;
    const t = LATE + 1234.5;
    const poses = systemPoses(d, t);
    const client = new ClientSystem(d);
    client.update(t);
    const wire: FramedPose = { frame: frameIdOf(d.seed, d.home), pos: [1.5e5, -2e4, 3.25e4], quat: [0, 0.6, 0, 0.8], vel: [12, -40, 300] };
    const state = localPoseInto(wire, { pos: new Vector3(), quat: new Quaternion(), vel: new Vector3() });
    expect(framedPose(wire.frame, state)).toEqual(wire);
    for (const to of ['station', null, 0, d.home] as FrameKey[]) {
      const from = client.frame(frameKeyOf(d, wire.frame)!);
      const s = localPoseInto(wire, { pos: new Vector3(), quat: new Quaternion(), vel: new Vector3() });
      setFrameInto(s, from, client.frame(to));
      expect(reframe(d, poses, wire, to)).toEqual(framedPose(frameIdOf(d.seed, to), s));
    }
  });
});
