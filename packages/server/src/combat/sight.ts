// Whether a shot sees its target over a world's drawn ground (ARCHITECTURE §20): resources' beam check (§18, los.ts) made
// for long rays. A gun reaches 1.5 km, so the ground is sampled at most SIGHT_SAMPLES times along the line (every 2 m on a
// short one, every ~16 m at full range): coarse, as resources' is (rocks, trees and buildings never block), and a ridge
// thinner than the step can be missed at long range. The ends are skipped: the gun's (a ship flying low) and the
// target's, where a creature's hit sphere meets the ground it stands on.
import type { TerrainSampler } from '@astra/shared/world';

/** Most ground samples along one line of sight. */
export const SIGHT_SAMPLES = 96;
/** Spacing of the samples on a short line, m (resources' beam step). */
export const SIGHT_STEP_MIN_M = 2;
/** How far under the ground the line may run before the ground counts as in the way, m (resources' tolerance). */
export const SIGHT_TOLERANCE_M = 0.75;
/** Line left unchecked at the gun's end and at the target's, m. */
export const SIGHT_SKIP_FROM_M = 0.5;
export const SIGHT_SKIP_TO_M = 3;

type Vec3 = readonly [number, number, number];

/** Whether the straight line from `from` to `to` (planet-local metres) stays above `sampler`'s ground. `stats.samples`
 * counts the samples taken, when given. */
export function clearSight(sampler: Pick<TerrainSampler, 'height' | 'R'>, from: Vec3, to: Vec3, stats?: { samples: number }): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const end = len - SIGHT_SKIP_TO_M;
  const step = Math.max(SIGHT_STEP_MIN_M, len / SIGHT_SAMPLES);
  for (let s = SIGHT_SKIP_FROM_M; s < end; s += step) {
    const f = s / len;
    const x = from[0] + dx * f;
    const y = from[1] + dy * f;
    const z = from[2] + dz * f;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (stats) stats.samples++;
    if (r < sampler.R + sampler.height(x / r, y / r, z / r) - SIGHT_TOLERANCE_M) return false;
  }
  return true;
}
