// The star system a zone hosts: galaxy system `index` described exactly as every client describes it
// (describeGalaxySystem on the game's Galaxy, home worlds and capitals included), so frame ids and body poses agree on
// both ends.
import { describeGalaxySystem, Galaxy, GALAXY_SEED, type SystemDescription } from '@astra/shared/world';

let galaxy: Galaxy | undefined;

/** Galaxy system `index` of the game's galaxy. */
export function describeZoneSystem(index: number): SystemDescription {
  galaxy ??= new Galaxy(GALAXY_SEED);
  const info = galaxy.systems[index];
  if (!info) throw new RangeError(`no system ${index} in galaxy ${GALAXY_SEED}`);
  return describeGalaxySystem(info);
}
