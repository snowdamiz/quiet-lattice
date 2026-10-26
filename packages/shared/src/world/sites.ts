// Where a planet's points of interest stand. Planned once per planet before its terrain is
// built, because the ground under each site is levelled (see TerrainSampler.setPads).
import { Quaternion, Vector3 } from 'three';
import type { PlanetParams, TerrainSampler } from './planetgen.ts';
import { Random } from './rng.ts';

export type SiteType = 'outpost' | 'monolith' | 'crash' | 'beacon';
export const SITE_TYPES: SiteType[] = ['outpost', 'monolith', 'crash', 'beacon'];
/** Ground footprint radius (m) of each kind of site. */
export const FOOTPRINT: Record<SiteType, number> = { outpost: 16.5, monolith: 8, crash: 18, beacon: 8 };
const MAX_RELIEF = 7;
// (pure: a bundle that never plans sites, such as the terrain worker's, drops it and three with it)
const Y = /* @__PURE__ */ new Vector3(0, 1, 0);

export interface Site {
  type: SiteType;
  /** planet-local unit direction */
  dir: Vector3;
  /** stands on the ground at `dir`, turned about its up axis */
  quat: Quaternion;
  /** height of the levelled ground (m above sea level) */
  base: number;
  /** spread of the natural ground under the footprint (m) */
  relief: number;
  seed: number;
}

/** Ground kept clear of sites: a city's plain. */
export interface SiteAvoid {
  dir: Vector3;
  radius: number;
}

// (`avoid`: the planet's cities, whose plains are kept clear of sites)
export function planSites(params: PlanetParams, sampler: Pick<TerrainSampler, 'height'>, avoid: SiteAvoid[] = []): Site[] {
  const p = params;
  const R = p.radius;
  const rng = new Random(p.seed ^ 0x5173);
  // dense enough that a site is usually within a few km of any landing spot
  const want = p.type === 'barren' ? 110 : 160;
  const sites: Site[] = [];
  const t = new Vector3();
  const b = new Vector3();
  const q = new Vector3();
  for (let i = 0; i < 8000 && sites.length < want; i++) {
    // uniform random directions (sites must cover the whole sphere evenly)
    const y = rng.float(-1, 1);
    const r = Math.sqrt(1 - y * y);
    const th = rng.float(0, Math.PI * 2);
    const dir = new Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
    if (avoid.some((c) => c.dir.angleTo(dir) * R < c.radius + 700)) continue;
    const h = sampler.height(dir.x, dir.y, dir.z);
    if (p.hasOcean && h < 4) continue;
    if (h > p.mountainHeight * 0.5) continue;
    const type = SITE_TYPES[sites.length % SITE_TYPES.length];
    // the footprint must be gentle enough to level without carving a pit
    t.crossVectors(Y, dir).normalize();
    b.crossVectors(dir, t);
    let lo = h;
    let hi = h;
    let sum = h;
    let n = 1;
    for (let k = 0; k < 20 && hi - lo <= MAX_RELIEF; k++) {
      const rr = ((k < 12 ? 1 : 0.5) * FOOTPRINT[type]) / R;
      const a = (k < 12 ? k / 12 : (k - 12) / 8 + 0.06) * Math.PI * 2;
      q.copy(dir)
        .addScaledVector(t, Math.cos(a) * rr)
        .addScaledVector(b, Math.sin(a) * rr)
        .normalize();
      const hk = sampler.height(q.x, q.y, q.z);
      lo = Math.min(lo, hk);
      hi = Math.max(hi, hk);
      sum += hk;
      n++;
    }
    if (hi - lo > MAX_RELIEF) continue;
    if (p.hasOcean && lo < 3) continue;
    const quat = new Quaternion().setFromUnitVectors(Y, dir).multiply(new Quaternion().setFromAxisAngle(Y, rng.float(0, Math.PI * 2)));
    sites.push({ type, dir, quat, base: sum / n, relief: hi - lo, seed: rng.int(0, 1e9) });
  }
  return sites;
}

/**
 * Flat [x, y, z, height, inner, outer] per site for the terrain sampler: level inside
 * `inner` metres, blending back to natural ground by `outer`.
 */
export function sitePads(sites: Site[]): number[] {
  const pads: number[] = [];
  for (const s of sites) {
    const inner = FOOTPRINT[s.type] + 2;
    pads.push(s.dir.x, s.dir.y, s.dir.z, s.base, inner, inner + 8 + s.relief * 3);
  }
  return pads;
}
