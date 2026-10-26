// A star system's tier (DESIGN 11): how dangerous it is, which sets its levels, its mobs and the dens on its living
// worlds. Distance is danger (DESIGN 3): the further a system lies from the three home systems and the nearer The Edge,
// the higher its tier. The Edge's position is an input, so the Count can move it and the tiers follow (DESIGN 16.3,
// P2.E22.T02); by default it stands where the demo has it, EDGE_X out along +X.
//
// The client does not plan dens by tier yet: it plans every world without dens until the den art lands (P1.E14.T10).
import { hypot3 } from '../math/det.ts';
import { EDGE_X, edgeX } from './edge.ts';
import { GALAXY_SEED, Galaxy, type GalaxySystem, type Point3 } from './galaxy.ts';
import { homeSystems } from './homes.ts';

/** A system's tier: 0 for the three home systems up to 5 for the far and the Edge-ward systems (DESIGN 11). */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;
/** Every tier, in order. */
export const TIERS: readonly Tier[] = [0, 1, 2, 3, 4, 5];

/** Where tiers 2, 3, 4 and 5 begin, in light years from the nearest home system (DESIGN 11): each band takes in its
 * lower edge, so a system exactly 18 ly out is Tier 2 and one exactly 60 ly out is Tier 5. Every other system nearer
 * than 18 ly is Tier 1: DESIGN's "6–18 ly" begins where the cluster does (no system but system 0 lies within 6 ly of
 * it), and a system nearer a home than that is still not a home system. (Tier 1 ended at 15 ly until it proved too
 * thin at seed 424242, two systems, for Act I's opening levels; at 18 ly it holds nine.) */
export const TIER_BANDS_LY: readonly number[] = [18, 30, 45, 60];

/** How far out from system 0 along +X (towards The Edge) the Edge-ward fringe begins while the Edge stands at its
 * default (ly): where Tier 4's band begins, so a fringe system is that far from system 0 at least (at seed 424242 the
 * other two home systems lie on the far side, and the fringe lifts only Tier 4 systems to Tier 5). */
export const EDGE_FRINGE_X = 45;

/** A system this near The Edge or nearer (ly along +X to the wall, see edgeLy) is Edge-ward, and so Tier 5: the fringe
 * line's distance from the Edge at its default. As the Edge advances the fringe comes in with it, light year for light
 * year, and as it recedes the fringe goes back out. */
export const EDGE_WARD_LY = EDGE_X - EDGE_FRINGE_X;
// For the Count moving the Edge (P2.E22.T02): the fringe line moves light year for light year with the Edge, and the
// cluster is about 110 ly across along X, so the Count should move the Edge by tens of light years (at seed 424242 a
// few systems flip for every 10 ly), not by anything like its 3.1 million ly distance; or keep this fringe line apart from the
// wall the map and the sky draw, so the visible wall can move further. And once edgeX takes a position parameter, edgeLy
// must pass `edge` through to it rather than shift edgeX's default wall by (edge − EDGE_X) as it does now.

/** A system as tierOf takes it: where it is (ly) and its id in its galaxy (the game's galaxy unless `galaxy` names
 * another). */
export type TierSystem = Pick<GalaxySystem, 'id' | 'x' | 'y' | 'z'> & Partial<Pick<GalaxySystem, 'galaxy'>>;

/** A system's row in a galaxy's tier table. */
export interface SystemTier {
  id: number;
  name: string;
  /** distance to the nearest home system (ly) */
  homeLy: number;
  /** distance to The Edge (ly along +X to the wall) */
  edgeLy: number;
  edgeWard: boolean;
  tier: Tier;
}

interface Placed {
  systems: readonly GalaxySystem[];
  homeIds: ReadonlySet<number>;
  homes: readonly Point3[];
}
const placed = new Map<number, Placed>();

/** A galaxy's systems and where its three home systems are, worked out once per galaxy. */
function galaxyOf(galaxySeed: number): Placed {
  const known = placed.get(galaxySeed);
  if (known) return known;
  const { systems } = new Galaxy(galaxySeed);
  const ids = homeSystems(galaxySeed).map((h) => h.systemIndex);
  const p: Placed = { systems, homeIds: new Set(ids), homes: ids.map((i) => ({ x: systems[i].x, y: systems[i].y, z: systems[i].z })) };
  placed.set(galaxySeed, p);
  return p;
}

function checkEdge(edge: number) {
  if (!Number.isFinite(edge)) throw new RangeError(`the Edge must stand at a finite x (ly), not ${edge}`);
}

/** The tier of a system that is not a home system, `homeLy` light years from the nearest one, by distance alone. */
export function bandTier(homeLy: number): Tier {
  if (!(homeLy >= 0)) throw new RangeError(`a distance must be a number of light years from 0 up, not ${homeLy}`);
  let tier = 1;
  for (const from of TIER_BANDS_LY) if (homeLy >= from) tier++;
  return tier as Tier;
}

/** Distance (ly) from `p` to the nearest home system of the galaxy generated from `galaxySeed`. */
export function homeLy(p: Point3, galaxySeed: number = GALAXY_SEED): number {
  let best = Infinity;
  for (const h of galaxyOf(galaxySeed).homes) best = Math.min(best, hypot3(p.x - h.x, p.y - h.y, p.z - h.z));
  return best;
}

/** Distance (ly) from `p` to The Edge along +X, with the Edge's wall at x = `edge` on the X axis (straight out from
 * system 0) and bowed back towards the galaxy away from it as edgeX bows it; below zero past the wall. */
export function edgeLy(p: Point3, edge: number = EDGE_X): number {
  checkEdge(edge);
  return edgeX(p.y, p.z) + (edge - EDGE_X) - p.x;
}

/** Whether `p` lies on the Edge-ward fringe with the Edge at `edge`: within EDGE_WARD_LY of it. */
export function isEdgeWard(p: Point3, edge: number = EDGE_X): boolean {
  return edgeLy(p, edge) <= EDGE_WARD_LY;
}

/**
 * A system's tier with The Edge at `edge` (the x of its wall, EDGE_X by default; DESIGN 11): 0 for the three home
 * systems, whatever the Edge does; otherwise 5 on the Edge-ward fringe (isEdgeWard), and elsewhere its band by distance
 * to the nearest home system (bandTier). Never lower as the Edge comes nearer.
 */
export function tierOf(system: TierSystem, edge: number = EDGE_X): Tier {
  checkEdge(edge);
  const galaxySeed = system.galaxy ?? GALAXY_SEED;
  const d = homeLy(system, galaxySeed);
  if (galaxyOf(galaxySeed).homeIds.has(system.id)) {
    if (d !== 0) throw new RangeError(`system ${system.id} is a home system of galaxy ${galaxySeed}, but not where that system is`);
    return 0;
  }
  return isEdgeWard(system, edge) ? 5 : bandTier(d);
}

function systemOf(id: number, galaxySeed: number): GalaxySystem {
  const s = galaxyOf(galaxySeed).systems[id];
  if (!Number.isInteger(id) || !s) throw new RangeError(`galaxy ${galaxySeed} has no system ${id}`);
  return s;
}

/** The tier of system `id` of the galaxy generated from `galaxySeed` (the game's by default), with The Edge at `edge`. */
export function tierOfGalaxySystem(id: number, edge: number = EDGE_X, galaxySeed: number = GALAXY_SEED): Tier {
  return tierOf(systemOf(id, galaxySeed), edge);
}

/** Every system of a galaxy (the game's by default) with its distances and tier, with The Edge at `edge`, by id. */
export function galaxyTiers(edge: number = EDGE_X, galaxySeed: number = GALAXY_SEED): SystemTier[] {
  return galaxyOf(galaxySeed).systems.map((s) => ({
    id: s.id,
    name: s.name,
    homeLy: homeLy(s, galaxySeed),
    edgeLy: edgeLy(s, edge),
    edgeWard: isEdgeWard(s, edge),
    tier: tierOf(s, edge),
  }));
}
