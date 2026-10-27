// The ground a rocky world is drawn on (DESIGN 17, "World from seeds"): its cities and sites planned as planSurface plans
// them, at its system's tier, with the ground levelled under them, and the sampler over that ground. The client's Planet
// draws it, its Flora scatters on it, and the server (P1.E13.T01) places resource nodes on it, all through drawnGround,
// so both ends scatter over the same levelled ground (ARCHITECTURE §12).
import type { City } from './cities.ts';
import { TerrainSampler, type PlanetParams } from './planetgen.ts';
import { FOOTPRINT, planSurface, type Den, type Site } from './sites.ts';

/** Whether the client draws dens yet. Until their art lands (P1.E14.T10) it plans every world without them, so the ground
 * leaves them and their levelled pads out; P1.E14.T10 turns this on, and with it the dens of the system's tier, as
 * planSurface plans them (each housing one of the world's species), the very dens the server's fauna spawns at. */
export const DENS_DRAWN = false;

/** How far past a site's footprint no resource node grows (m): the client used to clear its plants this far round a site. */
export const SITE_NODE_CLEARANCE = 6;

/** A world's drawn ground. */
export interface DrawnGround {
  /** the system's tier it was planned for */
  tier: number;
  /** the terrain, with the ground under the cities, sites (and dens) levelled */
  sampler: TerrainSampler;
  cities: City[];
  sites: Site[];
  /** planned only while dens are drawn (DENS_DRAWN); none until then */
  dens: Den[];
  /** the levelled pads: the cities', then the sites', then the dens' (as params.pads and the sampler hold them) */
  pads: number[];
  /** where no resource node grows round a site: flat [x, y, z, r] per site (planet-local unit direction, metres) */
  nodeClear: number[];
}

/** Flat [x, y, z, r] per site: the ground no resource node takes, its footprint and SITE_NODE_CLEARANCE round it. */
export function siteNodeClearance(sites: readonly Site[]): number[] {
  const out: number[] = [];
  for (const s of sites) out.push(s.dir.x, s.dir.y, s.dir.z, FOOTPRINT[s.type] + SITE_NODE_CLEARANCE);
  return out;
}

/**
 * The ground a rocky world is drawn on in a system of `tier` (DESIGN 11): its cities and sites, planned on its natural
 * ground as planSurface plans them (and its dens of that tier too once DENS_DRAWN), the ground levelled under them, and
 * the sampler over it. `params` is the world's own copy, without pads: this sets `params.pads`, which the terrain
 * workers read. The one definition the client's Planet, its Flora and the server's resource nodes all plan with.
 */
export function drawnGround(params: PlanetParams, tier: number): DrawnGround {
  if (!Number.isInteger(tier) || tier < 0 || tier > 5) throw new RangeError(`a tier is 0 to 5, not ${tier}`);
  if (params.pads?.length) throw new Error('drawnGround plans on the natural ground: pass params without pads');
  const sampler = new TerrainSampler(params);
  // (until dens are drawn, planned as at Tier 0, which has none: the same cities and sites at every tier)
  const plan = planSurface(params, sampler, { tier: DENS_DRAWN ? tier : 0 });
  params.pads = plan.pads;
  sampler.setPads(plan.pads);
  return { tier, sampler, ...plan, nodeClear: siteNodeClearance(plan.sites) };
}
