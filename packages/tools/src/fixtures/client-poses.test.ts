// The client's bodies move as the shared kinematics says (ARCHITECTURE §3), which is how the server will place them: for
// 1,000 random times, the star, every planet and moon of the client's SolarSystem and its Waystation have exactly the pose
// systemPoses gives, and the client's FrameState changes frame exactly as setFrame does. (That systemPoses is the demo's
// arithmetic, bit for bit, is checked against the poses golden fixture in packages/shared/test/kinematics.test.ts.)
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Galaxy,
  Random,
  describeGalaxySystem,
  describeSystem,
  hashInts,
  setFrame,
  systemPoses,
  type BodyPose,
  type SystemDescription,
} from '@astra/shared/world';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const client = (path: string) => import(pathToFileURL(join(ROOT, 'packages/client', path)).href);

/** What the test reads off the client's three.js objects and bodies (the client is JavaScript). */
interface Vec {
  x: number;
  y: number;
  z: number;
  toArray(): number[];
  fromArray(a: number[]): Vec;
  set(x: number, y: number, z: number, w?: number): Vec;
}
interface Quat extends Vec {
  w: number;
}
interface ClientBody {
  position: Vec;
  quaternion: Quat;
  quaternionInv: Quat;
  velocity: Vec;
  angularVelocity: Vec;
  update(t: number): void;
}
interface ClientSystem {
  description: SystemDescription;
  star: ClientBody;
  planets: ClientBody[];
  update(t: number): void;
}
interface ClientFrameState {
  frame: ClientBody | null;
  pos: Vec;
  quat: Quat;
  vel: Vec;
  setFrame(frame: ClientBody | null): void;
}

const THREE = (await client('node_modules/three/build/three.module.js')) as { Quaternion: new () => Quat };
const { SolarSystem } = (await client('src/universe/SolarSystem.js')) as {
  SolarSystem: new (description: SystemDescription, pool: unknown, opts?: { staged?: boolean }) => ClientSystem;
};
const { Station } = (await client('src/universe/Station.js')) as { Station: new (opts: Record<string, unknown>) => ClientBody };
const { FrameState } = (await client('src/universe/Body.js')) as { FrameState: new () => ClientFrameState };

// the chunk workers are not needed to plan a world: only registerPlanet is called while one is built
const pool = { registerPlanet() {}, forgetPlanet() {}, request: () => ({}), cancel() {} };

/** A system and its Waystation as the client's Game builds them (Game.buildSystem). */
function build(description: SystemDescription) {
  const system = new SolarSystem(description, pool);
  const spec = system.description.station;
  const station = new Station({
    name: spec.name,
    parent: system.planets[spec.parent],
    radius: spec.radius,
    orbitRadius: spec.orbitRadius,
    orbitPeriod: spec.orbitPeriod,
    orbitPhase: spec.orbitPhase,
    orbitTilt: new THREE.Quaternion().fromArray(spec.orbitTilt),
    soi: spec.soi,
    seed: spec.seed,
    // (its meshes are never built: they are not needed to move it)
    staged: true,
  });
  return { system, station };
}

const galaxy = new Galaxy(424242);
const SYSTEMS = [
  ...galaxy.systems.slice(0, 6).map((s) => ({ label: `system ${s.id} ${s.name}`, description: describeGalaxySystem(s) })),
  ...[0, 1].map((i) => ({ label: `seed ${hashInts(11, i)}`, description: describeSystem(hashInts(11, i)) })),
];

/** Every component of the client's pose that differs from the shared one (exactly: the same bits, signed zeros too). */
function differences(name: string, body: ClientBody, want: BodyPose): string[] {
  const got = {
    position: body.position.toArray(),
    quaternion: body.quaternion.toArray(),
    velocity: body.velocity.toArray(),
    angularVelocity: body.angularVelocity.toArray(),
  };
  const out: string[] = [];
  for (const key of ['position', 'quaternion', 'velocity', 'angularVelocity'] as const) {
    got[key].forEach((v, i) => {
      if (!Object.is(v, want[key][i])) out.push(`${name}.${key}[${i}]: client ${v}, shared ${want[key][i]}`);
    });
  }
  // (its inverse is kept beside it for the frame transforms)
  const q = body.quaternion;
  const inv = body.quaternionInv;
  if (!(Object.is(inv.x, -q.x) && Object.is(inv.y, -q.y) && Object.is(inv.z, -q.z) && Object.is(inv.w, q.w))) out.push(`${name}.quaternionInv`);
  return out;
}

describe('the client’s bodies move as systemPoses says', () => {
  const rng = new Random(0x5eed);
  // 0, then times from a fraction of a second to three decades
  const times = [0, ...Array.from({ length: 999 }, () => rng.float(0, 1) * 10 ** rng.int(2, 9))];

  it.each(SYSTEMS)('$label: star, planets, moons and Waystation at 1,000 times', ({ description: d }) => {
    const { system, station } = build(d);
    expect(d.bodies.length).toBe(system.planets.length);
    const bad: string[] = [];
    for (const t of times) {
      // (in the order Game.frame updates them)
      system.update(t);
      station.update(t);
      const want = systemPoses(d, t);
      bad.push(...differences(`t=${t} star`, system.star, want.star));
      system.planets.forEach((p, i) => bad.push(...differences(`t=${t} ${d.bodies[i].name}`, p, want.bodies[i])));
      bad.push(...differences(`t=${t} station`, station, want.station));
      if (bad.length > 20) break;
    }
    expect(bad).toEqual([]);
  });

  it('covers moons and gas giants', () => {
    const all = SYSTEMS.flatMap(({ description }) => description.bodies);
    expect(all.filter((b) => b.kind === 'moon').length).toBeGreaterThan(5);
    expect(all.some((b) => b.type === 'gas')).toBe(true);
  });
});

describe('the client’s FrameState changes frame as setFrame says', () => {
  it('bit for bit, between planets, moons, the Waystation and the inertial frame', () => {
    const rng = new Random(77);
    const bad: string[] = [];
    for (const { label, description } of SYSTEMS.slice(0, 4)) {
      const { system, station } = build(description);
      const t = rng.float(0, 1e7);
      system.update(t);
      station.update(t);
      const poses = systemPoses(system.description, t);
      const frames: [ClientBody | null, BodyPose | null][] = [
        [null, null],
        ...system.planets.map((p, i) => [p, poses.bodies[i]] as [ClientBody, BodyPose]),
        [station, poses.station],
      ];
      const s = new FrameState();
      let at = frames[0];
      s.pos.set(rng.float(-1e8, 1e8), rng.float(-1e7, 1e7), rng.float(-1e8, 1e8));
      s.quat.set(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1));
      const l = Math.hypot(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
      s.quat.set(s.quat.x / l, s.quat.y / l, s.quat.z / l, s.quat.w / l);
      s.vel.set(rng.float(-3e3, 3e3), rng.float(-3e3, 3e3), rng.float(-3e3, 3e3));
      for (let k = 0; k < 40; k++) {
        const to = frames[rng.int(0, frames.length - 1)];
        const now = { pos: s.pos.toArray() as never, quat: s.quat.toArray() as never, vel: s.vel.toArray() as never };
        // (staying in its frame, it is left as it is)
        const want = to === at ? now : setFrame(now, at[1], to[1]);
        s.setFrame(to[0]);
        at = to;
        const got = { pos: s.pos.toArray(), quat: s.quat.toArray(), vel: s.vel.toArray() };
        if (!(['pos', 'quat', 'vel'] as const).every((key) => got[key].every((v, i) => Object.is(v, want[key][i]))))
          bad.push(`${label} change ${k}: ${JSON.stringify({ got, want })}`);
        expect(s.frame).toBe(to[0]);
      }
    }
    expect(bad).toEqual([]);
  });
});
