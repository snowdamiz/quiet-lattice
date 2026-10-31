// What the discovery service reads of the world (P2.E29.T01; ARCHITECTURE §25): a find's procedural name, the name it keeps
// until its finder gives it one (for the finder's notice and the admin CLI; every client makes the same names for
// itself), and where a world's sites stand, from the drawn ground its zone already plans (the sites' clearance, which
// the resource nodes keep off, holds each site's direction and footprint, in `planSites` order: the site keys' index).
import { parseSpeciesKey } from '@astra/shared/codex';
import { parseSiteKey, worldOfKey, type DiscoveryKind } from '@astra/shared/discovery';
import {
  frameKeyOf,
  Galaxy,
  GALAXY_SEED,
  SITE_NODE_CLEARANCE,
  SITE_TYPES,
  type PlanetParams,
  type SiteType,
  type SystemDescription,
} from '@astra/shared/world';
import { worldSpecies } from '../codex/species.ts';
import type { Ground } from '../fauna/terrain.ts';
import { describeZoneSystem } from '../zones/system.ts';

type Vec3 = [number, number, number];

/** What players call each kind of site (the client's Structures labels). */
export const SITE_LABELS: Readonly<Record<SiteType, string>> = {
  outpost: 'Abandoned Outpost',
  monolith: 'Ancient Monolith',
  crash: 'Crashed Starship',
  beacon: 'Signal Beacon',
};

/** A world's site `index` is of this type: planSites deals the types out in turn, by the index each site takes. */
export function siteTypeAt(index: number): SiteType {
  return SITE_TYPES[index % SITE_TYPES.length]!;
}

/** The planet or moon a frame id names in a system, or undefined. */
export function bodyAt(system: SystemDescription, frame: string): SystemDescription['bodies'][number] | undefined {
  const k = frameKeyOf(system, frame);
  return typeof k === 'number' ? system.bodies[k] : undefined;
}

let galaxy: Galaxy | undefined;
const bySeed = new Map<number, SystemDescription | null>();

/** The galaxy's star system of a seed, described as its zone describes it (kept), or null when the galaxy has none. */
export function systemOfSeed(seed: number): SystemDescription | null {
  let d = bySeed.get(seed);
  if (d === undefined) {
    galaxy ??= new Galaxy(GALAXY_SEED);
    const index = galaxy.systems.findIndex((s) => s.seed === seed);
    bySeed.set(seed, (d = index < 0 ? null : describeZoneSystem(index)));
  }
  return d;
}

/** A find's procedural name in its system: a body's own, a species' (its world's list), a site's label and world. The key
 * itself when the system has no such thing. */
export function proceduralName(kind: DiscoveryKind, key: string, system: SystemDescription | null): string {
  const body = system ? bodyAt(system, worldOfKey(kind, key)) : undefined;
  if (!body) return key;
  if (kind === 'body') return body.name;
  if (kind === 'species') {
    const s = parseSpeciesKey(key);
    const sp = s && body.type !== 'gas' ? worldSpecies(s.world, body.params as PlanetParams)[s.index] : undefined;
    return sp?.name ?? key;
  }
  const site = parseSiteKey(key);
  return site ? `${SITE_LABELS[siteTypeAt(site.index)]} on ${body.name}` : key;
}

/** One of a world's sites as a visit is judged: its index, its direction from the world's centre, and how far from the
 * middle of its levelled ground reaching it is (its footprint and `reachM`). */
export interface SitePoint {
  index: number;
  dir: Vec3;
  reach: number;
  /** the middle of its levelled ground, in the world's frame (sampled the first time it is needed) */
  centre: Vec3 | null;
}

const sitesByGround = new WeakMap<Ground, SitePoint[]>();

/** A world's sites, from its drawn ground (none for a ground planned without the sites' clearance). Kept per ground. */
export function sitesOf(ground: Ground, reachM: number): SitePoint[] {
  let sites = sitesByGround.get(ground);
  if (sites) return sites;
  sites = [];
  const clear = ground.nodes?.nodeClear ?? [];
  for (let i = 0; i + 3 < clear.length; i += 4) {
    // (the clearance is the footprint and SITE_NODE_CLEARANCE round it)
    sites.push({ index: i / 4, dir: [clear[i]!, clear[i + 1]!, clear[i + 2]!], reach: clear[i + 3]! - SITE_NODE_CLEARANCE + reachM, centre: null });
  }
  sitesByGround.set(ground, sites);
  return sites;
}

/**
 * The sites a position on a world reaches (world-frame metres from its centre): within each one's reach of the middle of
 * its ground. A cheap test along the surface goes first, so the ground is sampled only for the sites close by.
 */
export function sitesReached(ground: Ground, pos: Readonly<Vec3>, reachM: number): SitePoint[] {
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  if (!(r > 0)) return [];
  const R = ground.radius;
  const out: SitePoint[] = [];
  for (const s of sitesOf(ground, reachM)) {
    // (the chord at the world's radius: within a hair of the least distance at any height the ground reaches)
    const along = Math.hypot(pos[0] / r - s.dir[0], pos[1] / r - s.dir[1], pos[2] / r - s.dir[2]) * R;
    if (along > s.reach * 1.01 + 1) continue;
    if (!s.centre) {
      const at = R + ground.sample(s.dir);
      s.centre = [s.dir[0] * at, s.dir[1] * at, s.dir[2] * at];
    }
    if (Math.hypot(pos[0] - s.centre[0], pos[1] - s.centre[1], pos[2] - s.centre[2]) <= s.reach) out.push(s);
  }
  return out;
}
