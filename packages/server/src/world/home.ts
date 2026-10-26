// Home systems of the three peoples and the frames a new character spawns in (DESIGN 5.1, docs/ARCHITECTURE.md §4), from
// the shared world: `homeSystems()` and the galaxy every client builds (`Galaxy(GALAXY_SEED)`).
import type { FrameId, PeopleId } from '@astra/shared/protocol';
import { GALAXY_SEED, Galaxy, frameId, homeSystems } from '@astra/shared/world';

let galaxy: Galaxy | null = null;

/** The galaxy system a people's characters start in. */
export function homeSystemOf(people: PeopleId): number {
  const home = homeSystems(GALAXY_SEED).find((h) => h.people === people);
  if (!home) throw new RangeError(`no home system for people ${people}`);
  return home.systemIndex;
}

/** The seed of galaxy system `index`, as `Galaxy` assigns it. */
export function systemSeed(index: number): number {
  galaxy ??= new Galaxy(GALAXY_SEED);
  const sys = galaxy.systems[index];
  if (!sys) throw new RangeError(`no system ${index} in galaxy ${GALAXY_SEED}`);
  return sys.seed;
}

/** Zone id of a star system. */
export function systemZoneId(index: number): string {
  return `sys:${index}`;
}

/** Frame id of a system's Waystation. */
export function stationFrame(index: number): NonNullable<FrameId> {
  return frameId(systemSeed(index), 'station');
}
