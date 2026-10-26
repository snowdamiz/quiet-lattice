// Cover (P1.E12.T06, DESIGN 10.1): the asteroid belt and planetary rings as volumes, against real system descriptions.
import { describe, expect, it } from 'vitest';
import {
  BELT_BODY_CLEARANCE,
  Galaxy,
  RING_HALF_THICKNESS,
  coverAt,
  coverAtObjects,
  describeGalaxySystem,
  inBelt,
  inRings,
  localToWorld,
  systemPoses,
  type BodySpec,
  type SystemDescription,
  type Vec3,
} from '../src/world/index.ts';
import { Quaternion, Vector3 } from 'three';

const galaxy = new Galaxy(424242);
/** Systems 0–9 of the fixture's galaxy. */
const SYSTEMS: SystemDescription[] = galaxy.systems.slice(0, 10).map(describeGalaxySystem);
const sys0 = SYSTEMS[0];

/** A point at radius r about the star, angle th round the system's plane, height y above it. */
const around = (r: number, th: number, y = 0): Vec3 => [Math.cos(th) * r, y, Math.sin(th) * r];

/** The first ringed body in systems 0–9, and its system. */
function ringed(): { d: SystemDescription; body: BodySpec } {
  for (const d of SYSTEMS) {
    const body = d.bodies.find((b) => b.rings);
    if (body) return { d, body };
  }
  throw new Error('no ringed body in systems 0–9');
}

describe('the asteroid belt', () => {
  it("system 0's belt is a real annulus (positive width), so the cases below test what they say", () => {
    expect(sys0.belt.width).toBeGreaterThan(0);
    expect(sys0.belt.thickness).toBeGreaterThan(0);
  });

  it('a point on the belt’s mid radius, anywhere round it, is in it', () => {
    const { radius, width, thickness } = sys0.belt;
    for (const th of [0, 1, 2.5, 4, 6]) {
      expect(inBelt(sys0.belt, around(radius, th))).toBe(true);
      expect(inBelt(sys0.belt, around(radius + width * 0.9, th, thickness * 0.9))).toBe(true);
      expect(inBelt(sys0.belt, around(radius - width * 0.9, th, -thickness * 0.9))).toBe(true);
    }
  });

  it('outside its width or above its thickness is not', () => {
    const { radius, width, thickness } = sys0.belt;
    for (const th of [0, 3]) {
      expect(inBelt(sys0.belt, around(radius + width * 1.01, th))).toBe(false);
      expect(inBelt(sys0.belt, around(radius - width * 1.01, th))).toBe(false);
      expect(inBelt(sys0.belt, around(radius, th, thickness * 1.01))).toBe(false);
      expect(inBelt(sys0.belt, around(radius, th, -thickness * 1.01))).toBe(false);
    }
    expect(inBelt(sys0.belt, [0, 0, 0])).toBe(false);
  });

  it('where a body crosses the belt, the space within its clearance is open, as the field keeps clear of it', () => {
    // system 6's moon Phasolmir I-b sits in the belt at t = 0
    const d = SYSTEMS[6];
    const poses = systemPoses(d, 0);
    const moon = d.bodies.find((b) => inBelt(d.belt, poses.bodies[b.index].position))!;
    expect(moon.name).toBe('Phasolmir I-b');
    const [mx, my, mz] = poses.bodies[moon.index].position;
    const near: Vec3 = [mx + moon.radius * (BELT_BODY_CLEARANCE - 0.1), my, mz];
    const clear: Vec3 = [mx + moon.radius * (BELT_BODY_CLEARANCE + 0.5), my, mz];
    expect(inBelt(d.belt, near) && inBelt(d.belt, clear)).toBe(true);
    expect(coverAt(d, poses.bodies, near)).toBeNull();
    expect(coverAt(d, poses.bodies, clear)).toBe('belt');
  });

  it('a belt with a negative width (a planet and its moon bounding it) is |width| wide, as the client draws it', () => {
    const d = SYSTEMS.find((s) => s.belt.width < 0);
    expect(d).toBeDefined();
    const { radius, width } = d!.belt;
    expect(inBelt(d!.belt, around(radius, 0.5))).toBe(true);
    expect(inBelt(d!.belt, around(radius - width * 0.9, 0.5))).toBe(true);
    expect(inBelt(d!.belt, around(radius - width * 1.1, 0.5))).toBe(false);
  });

  it('coverAt finds it, at any time, whatever the bodies are doing', () => {
    for (const t of [0, 1234.5, 86400]) expect(coverAt(sys0, systemPoses(sys0, t).bodies, around(sys0.belt.radius, 2))).toBe('belt');
    expect(coverAt(sys0, systemPoses(sys0, 0).bodies, around(sys0.belt.radius + sys0.belt.width * 2, 2))).toBeNull();
  });
});

describe('planetary rings', () => {
  it('a gas giant in systems 0–9 has rings', () => {
    const { body } = ringed();
    expect(body.type).toBe('gas');
    expect(body.rings!.outer).toBeGreaterThan(body.rings!.inner);
  });

  it('in its own frame: between the edges, in the plane, within the half-thickness', () => {
    const { body } = ringed();
    const { inner, outer } = body.rings!;
    const mid = ((inner + outer) / 2) * body.radius;
    for (const th of [0, 1, 3, 5]) {
      expect(inRings(body, around(mid, th))).toBe(true);
      expect(inRings(body, around(mid, th, RING_HALF_THICKNESS * 0.99))).toBe(true);
      expect(inRings(body, around(mid, th, -RING_HALF_THICKNESS * 0.99))).toBe(true);
      expect(inRings(body, around(mid, th, RING_HALF_THICKNESS * 1.01))).toBe(false);
      expect(inRings(body, around(inner * body.radius * 0.99, th))).toBe(false);
      expect(inRings(body, around(outer * body.radius * 1.01, th))).toBe(false);
      // between the planet and its rings
      expect(inRings(body, around(body.radius * 1.2, th))).toBe(false);
    }
    expect(inRings({ radius: body.radius, rings: null }, around(mid, 0))).toBe(false);
  });

  it('coverAt finds the ring where the planet is at that time, tilted and turned as it is', () => {
    const { d, body } = ringed();
    const mid = ((body.rings!.inner + body.rings!.outer) / 2) * body.radius;
    for (const t of [0, 600, 5000, 1e6]) {
      const poses = systemPoses(d, t);
      const frame = poses.bodies[body.index];
      for (const th of [0.3, 2, 4.4]) {
        expect(coverAt(d, poses.bodies, localToWorld(frame, around(mid, th))), `t=${t} th=${th}`).toBe('ring');
        expect(coverAt(d, poses.bodies, localToWorld(frame, around(mid, th, RING_HALF_THICKNESS * 3)))).toBeNull();
      }
      // the same offset from the planet in the system's axes misses the ring's tilted plane once out of it
      const off = localToWorld(frame, around(mid, 1, RING_HALF_THICKNESS * 50));
      expect(coverAt(d, poses.bodies, off)).toBeNull();
    }
  });

  it('a system without rings or belt there has no cover', () => {
    const poses = systemPoses(sys0, 0);
    const home = poses.bodies[sys0.home].position;
    expect(coverAt(sys0, poses.bodies, [home[0] + 1e6, home[1], home[2]])).toBeNull();
    expect(sys0.bodies.some((b) => b.rings)).toBe(false);
  });
});

describe('coverAtObjects', () => {
  it('agrees with coverAt on the client’s math objects', () => {
    const { d, body } = ringed();
    const poses = systemPoses(d, 777);
    const objects = poses.bodies.map((p) => ({ position: new Vector3().fromArray(p.position), quaternion: new Quaternion().fromArray(p.quaternion) }));
    const mid = ((body.rings!.inner + body.rings!.outer) / 2) * body.radius;
    const points: Vec3[] = [
      localToWorld(poses.bodies[body.index], around(mid, 1)),
      localToWorld(poses.bodies[body.index], around(mid, 1, 1e5)),
      around(d.belt.radius, 1),
      around(Math.abs(d.belt.width) * 10 + d.belt.radius, 1),
      [0, 0, 0],
    ];
    for (const p of points) expect(coverAtObjects(d, objects, new Vector3().fromArray(p))).toBe(coverAt(d, poses.bodies, p));
    expect(points.map((p) => coverAt(d, poses.bodies, p))).toEqual(['ring', null, 'belt', null, null]);
  });
});
