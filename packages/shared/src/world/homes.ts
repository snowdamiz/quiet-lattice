// The three peoples' home systems (DESIGN 5.1): the starting system 0 and its two nearest neighbours in the galaxy, all
// three Tier 0, each round the kind of world its people grew up on (lush, exotic, and a mild toxic world) with their
// capital planned on it. Only those three home worlds are forced: every other world in the galaxy, and every other body
// in the three systems, comes out exactly as its seed makes it.
import type { CapitalSpec } from './cities.ts';
import { GALAXY_SEED, Galaxy, type GalaxySystem } from './galaxy.ts';
import type { PlanetType } from './planetgen.ts';
import { describeSystem, type SystemDescription, type SystemOptions } from './system.ts';

/** The three playable peoples, in the order their home systems are handed out. */
export const PEOPLE_IDS = ['thalune', 'ixari', 'ulgani'] as const;
export type PeopleId = (typeof PEOPLE_IDS)[number];

/** A people's home world: its archetype, whether it is the mild variant, and the capital they built on it. */
export interface HomeWorld {
  /** the world generator's archetype id (DESIGN's "exotic" is 'alien') */
  type: PlanetType;
  /** breathable lowlands, caustic air only above the mist line, no ship hazard (see Mist) */
  mild: boolean;
  capital: CapitalSpec;
}

/** Each people's home world and capital (DESIGN 5.1–5.4). */
export const HOME_WORLDS: Readonly<Record<PeopleId, HomeWorld>> = {
  thalune: { type: 'lush', mild: false, capital: { name: 'Sarelun', plan: 'radial', people: 'thalune' } },
  ixari: { type: 'alien', mild: false, capital: { name: 'Quavel', plan: 'spiral', people: 'ixari' } },
  ulgani: { type: 'toxic', mild: true, capital: { name: 'Belost', plan: 'grid', people: 'ulgani' } },
};

/** A people's home system in the galaxy. */
export interface HomeSystem extends HomeWorld {
  people: PeopleId;
  /** the system's id in the galaxy (its place in `Galaxy.systems`) */
  systemIndex: number;
  /** the seed it is generated from: the system part of its frame ids */
  systemSeed: number;
  /** the home world's place in the system's description (`SystemDescription.home`): the body part of its frame id */
  homePlanetIndex: number;
}

const cache = new Map<number, readonly HomeSystem[]>();

/** The three home systems of the galaxy generated from `galaxySeed`: system 0 for the Thalune, then its nearest
 * neighbour for the Ixari and the next nearest for the Ulgani (ties go to the lower id). Worked out once per galaxy. */
export function homeSystems(galaxySeed: number = GALAXY_SEED): readonly HomeSystem[] {
  const known = cache.get(galaxySeed);
  if (known) return known;
  const galaxy = new Galaxy(galaxySeed);
  const first = galaxy.systems[0];
  const nearest = galaxy.systems
    .slice(1)
    .map((s) => ({ s, d: galaxy.distance(s, first) }))
    .sort((a, b) => a.d - b.d || a.s.id - b.s.id)
    .slice(0, PEOPLE_IDS.length - 1)
    .map(({ s }) => s);
  const homes = [first, ...nearest].map((s, i): HomeSystem => {
    const people = PEOPLE_IDS[i];
    const world = HOME_WORLDS[people];
    // (forcing the home world never moves it: its place in the system is drawn before its type matters)
    const homePlanetIndex = describeSystem(s.seed, { name: s.name, cls: s.cls }).home;
    const capital = Object.freeze({ ...world.capital });
    return Object.freeze({ people, systemIndex: s.id, systemSeed: s.seed, homePlanetIndex, type: world.type, mild: world.mild, capital });
  });
  const frozen = Object.freeze(homes);
  cache.set(galaxySeed, frozen);
  return frozen;
}

/** A galaxy's system, as describeGalaxySystem takes it (from the game's galaxy unless `galaxy` names another). */
export type GalaxySystemInfo = Pick<GalaxySystem, 'id' | 'seed' | 'name' | 'cls'> & Partial<Pick<GalaxySystem, 'galaxy'>>;

/** The home system a galaxy system is, if it is one. */
export function homeSystemAt(info: Pick<GalaxySystemInfo, 'id' | 'seed' | 'galaxy'>): HomeSystem | undefined {
  const galaxy = info.galaxy ?? GALAXY_SEED;
  const home = homeSystems(galaxy).find((h) => h.systemIndex === info.id);
  if (home && home.systemSeed !== info.seed) throw new RangeError(`system ${info.id} (seed ${info.seed}) is not system ${info.id} of galaxy ${galaxy}`);
  return home;
}

/** What describeSystem is asked for a galaxy system: its name and star class as the galaxy shows them, and in a home
 * system its people's home world and capital. */
export function galaxySystemOptions(info: GalaxySystemInfo): SystemOptions {
  const home = homeSystemAt(info);
  if (!home) return { name: info.name, cls: info.cls };
  return { name: info.name, cls: info.cls, homeType: home.type, mild: home.mild, capital: { ...home.capital } };
}

/** A system of the galaxy as every client and the server build it: named and classed as the galaxy shows it, and in the
 * three home systems round the peoples' home worlds, with their capitals on them. */
export function describeGalaxySystem(info: GalaxySystemInfo): SystemDescription {
  return describeSystem(info.seed, galaxySystemOptions(info));
}
