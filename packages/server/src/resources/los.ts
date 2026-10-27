// Line of sight over a world's drawn ground, coarse (ARCHITECTURE §17): whether the multitool's beam from the eye to a
// node passes above the terrain. The ground is sampled every LOS_STEP_M along the beam, skipping its ends (the eye
// stands on the ground, the node sits in it); the beam is blocked where it runs more than LOS_TOLERANCE_M under the
// ground. Rocks, trees and buildings are the client's and do not block.
import type { TerrainSampler } from '@astra/shared/world';

/** Spacing of the ground samples along the beam, m. */
export const LOS_STEP_M = 2;
/** How far under the ground the beam may run before the ground counts as in the way, m (the lattice of the client's
 * terrain mesh and the sampler differ by a little, and the beam has some width). */
export const LOS_TOLERANCE_M = 0.75;
/** Beam left unchecked at the eye's end and at the node's, m. */
export const LOS_SKIP_EYE_M = 0.5;
export const LOS_SKIP_NODE_M = 2.5;

type Vec3 = readonly [number, number, number];

/**
 * Whether the straight beam from `from` to `to` (planet-local metres) stays above the ground of `sampler`'s world.
 * Returns the number of samples taken in `stats.samples` when given.
 */
export function lineOfSight(sampler: Pick<TerrainSampler, 'height' | 'R'>, from: Vec3, to: Vec3, stats?: { samples: number }): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const end = len - LOS_SKIP_NODE_M;
  for (let s = LOS_SKIP_EYE_M; s < end; s += LOS_STEP_M) {
    const f = s / len;
    const x = from[0] + dx * f;
    const y = from[1] + dy * f;
    const z = from[2] + dz * f;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (stats) stats.samples++;
    const ground = sampler.R + sampler.height(x / r, y / r, z / r);
    if (r < ground - LOS_TOLERANCE_M) return false;
  }
  return true;
}
