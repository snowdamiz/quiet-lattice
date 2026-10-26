// What the dens golden fixture (fixtures/dens-424242.json) records: for the home planet of each of systems 0–9 at seed
// 424242, as the world fixture lists them, its land area and the dens planned at every tier 0–5 (counts by role and
// kind, digests of the dens and of the ground levelled under them), and the apex's lair written out. Written by
// packages/tools/src/fixtures/dens-golden.ts; dens.golden.test.ts checks the planner against it.
import {
  DEN_KINDS,
  DEN_ROLES,
  GALAXY_SEED,
  Galaxy,
  MAX_TIER,
  TerrainSampler,
  denPads,
  describeGalaxySystem,
  landArea,
  planSurface,
  type Den,
  type PlanetParams,
} from '../src/world/index.ts';
import { asJson, digestString } from './digest.ts';

/** The parts of the world fixture (fixtures/world-424242.json) the dens fixture reads. */
export interface WorldFixture {
  seed: number;
  systems: { id: number; home: number; bodies: { name: string; kind: string; type: string; radius: number; seed: number }[] }[];
}

export interface Home {
  system: number;
  name: string;
  type: string;
  radius: number;
  seed: number;
}

export function homes(world: WorldFixture): Home[] {
  return world.systems.map((s) => {
    const b = s.bodies[s.home];
    return { system: s.id, name: b.name, type: b.type, radius: b.radius, seed: b.seed };
  });
}

const galaxy = new Galaxy(GALAXY_SEED);

/** A home planet as the game describes it (a people's home world with its capital, and as the mild variant if it is). */
function homeParams(home: Home): PlanetParams {
  const d = describeGalaxySystem(galaxy.systems[home.system]);
  const b = d.bodies[d.home];
  if (b.seed !== home.seed || b.type !== home.type || b.radius !== home.radius) throw new Error(`${home.name} is not system ${home.system}'s home world`);
  return b.params as PlanetParams;
}

/** A home planet planned as the client plans it (cities, sites, then dens) at a tier, and its land (km²). */
export function homeDens(home: Home, tier: number): { dens: Den[]; land: number } {
  const params = homeParams(home);
  const sampler = new TerrainSampler(params);
  const { dens } = planSurface(params, sampler, { tier });
  return { dens, land: landArea(params, sampler) };
}

const count = <K extends string>(keys: readonly K[], of: (k: K) => number) => Object.fromEntries(keys.map((k) => [k, of(k)])) as Record<K, number>;

/** One home planet's entry: its land, its dens at every tier, and its apex's lair (the same from Tier 2 on). */
export function denEntry(home: Home) {
  const tiers = [];
  let land = 0;
  let apex: Den | undefined;
  for (let tier = 0; tier <= MAX_TIER; tier++) {
    const plan = homeDens(home, tier);
    const dens = plan.dens;
    land = plan.land;
    apex ??= dens.find((d) => d.role === 'apex');
    tiers.push({
      tier,
      count: dens.length,
      byRole: count(DEN_ROLES, (r) => dens.filter((d) => d.role === r).length),
      byKind: count(DEN_KINDS, (k) => dens.filter((d) => d.kind === k).length),
      dens: digestString(JSON.stringify(dens)),
      pads: digestString(JSON.stringify(denPads(dens))),
    });
  }
  return asJson({ ...home, land, tiers, apex: apex ?? null });
}

export function buildDenFixture(world: WorldFixture) {
  return { seed: world.seed, homes: homes(world).map(denEntry) };
}
