// The body-kinematics golden fixture (packages/shared/test/fixtures/poses-424242.json): for systems 0–5 of galaxy
// 424242 as every client and the server describe them (describeGalaxySystem), every planet's, moon's and Waystation's
// motion (copied from the description, so the fixture stands on its own) and its poses at 1,000 times: a digest of
// their exact bits (position, rotation and, for planets and moons, velocity) and the first three in full.
//
// The fixture was first written from the demo's JavaScript (Body.update and the Waystation's update in Game.js), before
// the kinematics moved to @astra/shared (P1.E02.T03); since then this script writes it from systemPoses. The shared
// kinematics test checks systemPoses against it, and packages/tools/src/fixtures/client-poses.test.ts checks that the
// client's bodies move as systemPoses says. Regenerate it only for a deliberate change to how bodies move, and say so
// in the commit:
//   pnpm exec tsx packages/tools/src/fixtures/poses-golden.ts [out.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { Galaxy, describeGalaxySystem, systemPoses, type BodySpec, type GalaxySystem, type SystemDescription } from '@astra/shared/world';
import { asJson } from '../../../shared/test/digest.ts';
import { digestPoses, poseTimes, type PinnedPose } from '../../../shared/test/poses.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const POSES_FIXTURE = join(ROOT, 'packages/shared/test/fixtures/poses-424242.json');
export const SEED = 424242;
/** How many of the galaxy's systems, and the times the poses are sampled at (see poseTimes). */
export const SYSTEMS = 6;
export const TIMES = { seed: 0x7105e, count: 1000 };

/** The poses of a system's planets and moons (in its description's order) and of its Waystation at time t. */
export type PosesAt = (t: number) => { bodies: PinnedPose[]; station: PinnedPose };

function motion(b: BodySpec) {
  const { parent, orbitRadius, orbitPeriod, orbitPhase, orbitTilt, rotationPeriod, rotationPhase, axialTilt } = b;
  return { parent, orbitRadius, orbitPeriod, orbitPhase, orbitTilt, rotationPeriod, rotationPhase, axialTilt };
}

/** The fixture, its poses from `posesFor` (by default the shared systemPoses). */
export function buildPosesFixture(posesFor: (d: SystemDescription, info: GalaxySystem) => PosesAt = (d) => (t) => systemPoses(d, t)) {
  const times = poseTimes(TIMES.seed, TIMES.count);
  const systems = new Galaxy(SEED).systems.slice(0, SYSTEMS).map((info) => {
    const d = describeGalaxySystem(info);
    const at = posesFor(d, info);
    const runs = times.map((t) => at(t));
    const body = (p: PinnedPose) => ({ position: Array.from(p.position), quaternion: Array.from(p.quaternion), velocity: Array.from(p.velocity!) });
    const station = (p: PinnedPose) => ({ position: Array.from(p.position), quaternion: Array.from(p.quaternion) });
    const { parent, orbitRadius, orbitPeriod, orbitPhase, orbitTilt } = d.station;
    return {
      id: info.id,
      name: d.name,
      bodies: d.bodies.map((b, i) => ({
        name: b.name,
        ...motion(b),
        poses: digestPoses(runs.map((r) => body(r.bodies[i]))),
        first: runs.slice(0, 3).map((r, k) => ({ t: times[k], ...body(r.bodies[i]) })),
      })),
      station: {
        name: d.station.name,
        parent,
        orbitRadius,
        orbitPeriod,
        orbitPhase,
        orbitTilt,
        poses: digestPoses(runs.map((r) => station(r.station))),
        first: runs.slice(0, 3).map((r, k) => ({ t: times[k], ...station(r.station) })),
      },
    };
  });
  return asJson({ seed: SEED, times: TIMES, systems });
}

/** Writes the fixture, formatted as the repository formats it. */
export async function writePosesFixture(out: string, fixture: unknown) {
  mkdirSync(dirname(out), { recursive: true });
  const options = (await prettier.resolveConfig(POSES_FIXTURE)) ?? {};
  writeFileSync(out, await prettier.format(JSON.stringify(fixture), { ...options, filepath: POSES_FIXTURE }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? POSES_FIXTURE;
  await writePosesFixture(out, buildPosesFixture());
  console.log(`wrote ${out}`);
}
