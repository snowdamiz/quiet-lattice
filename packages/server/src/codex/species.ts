// A world's species as the codex reads them (P1.E08.T04): its whole faunaSpecies list (at FAUNA_MAX_TIER, so an index
// names one species whatever the tier: a lower tier's list is a prefix of it), worked out once per world and kept. Every
// world of the galaxy fits (432 worlds carry fauna, 2,959 species), so after the first analyses and joins this costs a
// map lookup.
import { describeGalaxySystem, faunaSpecies, FAUNA_MAX_TIER, frameKeyOf, Galaxy, GALAXY_SEED, type FaunaSpecies, type PlanetParams } from '@astra/shared/world';

/** Worlds whose species are kept (more than the galaxy has). */
export const KEEP_WORLDS = 1024;

const byWorld = new Map<string, readonly FaunaSpecies[]>();
let galaxy: Galaxy | undefined;

/** The species of world `frame` of a system, from its planet parameters. */
export function worldSpecies(frame: string, params: Pick<PlanetParams, 'seed' | 'type' | 'lifeless' | 'flora'>): readonly FaunaSpecies[] {
  let list = byWorld.get(frame);
  if (!list) {
    list = Object.freeze(faunaSpecies(params, FAUNA_MAX_TIER));
    if (byWorld.size >= KEEP_WORLDS) byWorld.delete(byWorld.keys().next().value!);
    byWorld.set(frame, list);
  }
  return list;
}

/** The species of world `frame` of galaxy system `system`, or null when the frame names no rocky world of that system
 * with fauna (another system's, the Waystation's, a gas giant, a barren world). */
export function worldSpeciesAt(system: number, frame: string): readonly FaunaSpecies[] | null {
  const known = byWorld.get(frame);
  if (known && sameSystem(system, frame)) return known.length ? known : null;
  galaxy ??= new Galaxy(GALAXY_SEED);
  const info = galaxy.systems[system];
  if (!info) return null;
  const d = describeGalaxySystem(info);
  const key = frameKeyOf(d, frame);
  if (typeof key !== 'number') return null;
  const body = d.bodies[key];
  if (!body || body.type === 'gas') return null;
  const list = worldSpecies(frame, body.params as PlanetParams);
  return list.length ? list : null;
}

/** Whether a frame id names a body of galaxy system `system` (by its seed). */
function sameSystem(system: number, frame: string): boolean {
  galaxy ??= new Galaxy(GALAXY_SEED);
  return galaxy.systems[system]?.seed === Number(frame.split(':')[0]);
}
