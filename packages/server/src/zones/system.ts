// The star system a zone hosts: galaxy system `index` described exactly as every client describes it
// (describeGalaxySystem on the client's Galaxy), so frame ids and body poses agree on both ends.
import { describeGalaxySystem, describeSystem, Galaxy, type SystemDescription } from '@astra/shared/world';
import { GALAXY_SEED, systemSeed } from '../world/home.ts';

let galaxy: Galaxy | undefined;

/** Galaxy system `index`; one beyond the galaxy's listed systems is described from its seed alone. */
export function describeZoneSystem(index: number): SystemDescription {
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`bad system index ${index}`);
  galaxy ??= new Galaxy(GALAXY_SEED);
  const info = galaxy.systems[index];
  return info ? describeGalaxySystem(info) : describeSystem(systemSeed(index));
}
