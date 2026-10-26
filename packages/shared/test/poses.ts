// The times and digests of the body-kinematics golden fixture (fixtures/poses-424242.json, written by
// packages/tools/src/fixtures/poses-golden.ts).
import { Random } from '../src/world/index.ts';
import { digestArrays } from './digest.ts';

/** The times the fixture samples poses at: 0, then `count - 1` drawn from `seed`, from a fraction of a second to three
 * decades (the server's clock counts seconds since the shard began). */
export function poseTimes(seed: number, count: number): number[] {
  const rng = new Random(seed);
  const scales = [1e2, 1e4, 1e6, 1e8, 1e9];
  const times = [0];
  while (times.length < count) times.push(rng.float(0, 1) * scales[rng.int(0, scales.length - 1)]);
  return times;
}

/** What the fixture pins of a pose: where it is, how it is turned and (for planets and moons) how fast it moves. */
export interface PinnedPose {
  position: ArrayLike<number>;
  quaternion: ArrayLike<number>;
  velocity?: ArrayLike<number>;
}

/** A digest of the exact bits of a run of poses (signed zeros included). */
export function digestPoses(poses: PinnedPose[]): string {
  return digestArrays(...poses.map((p) => Float64Array.from([...Array.from(p.position), ...Array.from(p.quaternion), ...Array.from(p.velocity ?? [])])));
}
