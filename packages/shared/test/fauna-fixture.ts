// What the fauna golden fixture (fixtures/fauna-424242.json) records: every rocky world of systems 0, 1, 2 and 59 at
// seed 424242 (the three home systems and one more), as the game describes them (home worlds forced), with its species
// at FAUNA_MAX_TIER written out in full. Each species says the tier it appears from, so a lower tier's list is the
// prefix of species with `tier` at or below it. fauna.golden.test.ts checks the generator against it. Regenerate it
// only for a deliberate change to the species generator, and say so in the commit:
//   pnpm exec tsx packages/server/test/write-fauna-fixture.ts [out.json]
import { FAUNA_MAX_TIER, GALAXY_SEED, Galaxy, describeGalaxySystem, faunaSpecies, type PlanetParams } from '../src/world/index.ts';
import { asJson } from './digest.ts';

/** The systems the fixture covers. */
export const FAUNA_SYSTEMS = [0, 1, 2, 59];

export function buildFaunaFixture() {
  const galaxy = new Galaxy(GALAXY_SEED);
  const worlds = [];
  for (const system of FAUNA_SYSTEMS) {
    const d = describeGalaxySystem(galaxy.systems[system]);
    for (const b of d.bodies) {
      if (b.type === 'gas') continue;
      worlds.push({ system, body: b.index, name: b.name, type: b.type, seed: b.seed, species: faunaSpecies(b.params as PlanetParams, FAUNA_MAX_TIER) });
    }
  }
  return asJson({ seed: GALAXY_SEED, maxTier: FAUNA_MAX_TIER, worlds });
}
