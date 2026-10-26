// The three peoples' home systems (DESIGN 5.1): the starting system 0 and the two neighbours that keep all three closest
// together (within about a warp of each other), all three Tier 0, each round the kind of world its people grew up on
// (lush, exotic, and a mild toxic world) with their capital planned on it. Only those three home worlds are forced:
// every other world in the galaxy, and every other body in the three systems, comes out exactly as its seed makes it.
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

/** The two systems that, with system 0, make the smallest triangle: the pair whose triangle with system 0 has the
 * shortest longest side (ties go to the lower ids), nearer system 0 first (ties to the lower id). */
export function homeNeighbours(galaxy: Galaxy): [GalaxySystem, GalaxySystem] {
  const [first, ...rest] = galaxy.systems;
  let best: [GalaxySystem, GalaxySystem] | null = null;
  let bestSide = Infinity;
  // (in id order, so the first pair found at the shortest side has the lowest ids)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const da = galaxy.distance(first, a);
    if (da >= bestSide) continue;
    for (let j = i + 1; j < rest.length; j++) {
      const b = rest[j];
      const side = Math.max(da, galaxy.distance(first, b), galaxy.distance(a, b));
      if (side < bestSide) {
        bestSide = side;
        best = [a, b];
      }
    }
  }
  const [a, b] = best!;
  return galaxy.distance(first, b) < galaxy.distance(first, a) ? [b, a] : [a, b];
}

/** The three home systems of the galaxy generated from `galaxySeed`: system 0 for the Thalune, then the two systems that
 * keep all three closest together (homeNeighbours): the nearer to system 0 for the Ixari, the other for the Ulgani.
 * Worked out once per galaxy. */
export function homeSystems(galaxySeed: number = GALAXY_SEED): readonly HomeSystem[] {
  const known = cache.get(galaxySeed);
  if (known) return known;
  const galaxy = new Galaxy(galaxySeed);
  const homes = [galaxy.systems[0], ...homeNeighbours(galaxy)].map((s, i): HomeSystem => {
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
