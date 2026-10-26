// What the dens golden fixture (fixtures/dens-424242.json) records: for the home planet of each of systems 0–9 at seed
// 424242, as the world fixture lists them, the dens planned at every tier 0–5 (counts by role and kind, digests of the
// dens and of the ground levelled under them) and the apex's lair written out. Written by
// packages/tools/src/fixtures/dens-golden.ts; dens.golden.test.ts checks the planner against it.
import { DEN_ROLES, DEN_TYPES, MAX_TIER, TerrainSampler, createPlanetParams, denPads, planSurface, type Den, type PlanetType } from '../src/world/index.ts';
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

/** The dens of a home planet at a tier, planned as the client plans the planet (cities, sites, then dens). */
export function homeDens(home: Home, tier: number): Den[] {
  const params = createPlanetParams(home.seed, home.type as PlanetType, home.radius);
  return planSurface(params, new TerrainSampler(params), { tier }).dens;
}

const count = <K extends string>(keys: readonly K[], of: (k: K) => number) => Object.fromEntries(keys.map((k) => [k, of(k)])) as Record<K, number>;

/** One home planet's entry: its dens at every tier, and its apex's lair (the same from Tier 2 on). */
export function denEntry(home: Home) {
  const tiers = [];
  let apex: Den | undefined;
  for (let tier = 0; tier <= MAX_TIER; tier++) {
    const dens = homeDens(home, tier);
    apex ??= dens.find((d) => d.role === 'apex');
    tiers.push({
      tier,
      count: dens.length,
      byRole: count(DEN_ROLES, (r) => dens.filter((d) => d.role === r).length),
      byType: count(DEN_TYPES, (t) => dens.filter((d) => d.type === t).length),
      dens: digestString(JSON.stringify(dens)),
      pads: digestString(JSON.stringify(denPads(dens))),
    });
  }
  return asJson({ ...home, tiers, apex: apex ?? null });
}

export function buildDenFixture(world: WorldFixture) {
  return { seed: world.seed, homes: homes(world).map(denEntry) };
}
