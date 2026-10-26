// Where a planet's points of interest stand. Planned once per planet before its terrain is
// built, because the ground under each site is levelled (see TerrainSampler.setPads).
import { Quaternion, Vector3 } from 'three';
import { cityPads, planCities, type City } from './cities.ts';
import { surfaceAttribs, type PlanetParams, type TerrainSampler } from './planetgen.ts';
import { Random, hashInts } from './rng.ts';

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

// ---------- dens ----------
// DESIGN 12.2 "Spawning": dens are a small site type where predators respawn and ambushers wait, planned with the planet
// like the other sites. Each pass below draws from a stream of its own and keeps clear of everything planned before it,
// so dens never move a city or a site or touch the ground under one, and raising a world's tier adds dens without moving
// any. A den has no model yet (DESIGN 19.3 lists the den models with the sites' art): nothing is drawn for one, but the
// ground under it is levelled, as under a site, for the model to sit on.

/** burrow: small quadrupeds (pack predators, ambushers); nest: bipeds (stalkers) and the apex's lair; roost: flyers (divers). */
export type DenType = 'burrow' | 'nest' | 'roost';
export const DEN_TYPES: readonly DenType[] = ['burrow', 'nest', 'roost'];
/** The temperament a den houses (DESIGN 12.2). */
export type DenRole = 'predator' | 'ambusher' | 'apex';
export const DEN_ROLES: readonly DenRole[] = ['predator', 'ambusher', 'apex'];
/** Ground footprint radius (m) of each kind of den: smaller than any site. */
export const DEN_FOOTPRINT: Readonly<Record<DenType, number>> = { burrow: 4, nest: 6, roost: 5 };
/** The apex's lair: a nest big enough for a heavy quadruped and the pack that follows it. */
export const APEX_FOOTPRINT = 10;
/** Tiers run from 0 (the home systems) to 5 (Edge-ward), DESIGN 11. */
export const MAX_TIER = 5;
const MAX_DEN_RELIEF = 4;
/** Dens keep this far apart (m). */
const DEN_SPACING = 300;
/** Dens keep this far (m) beyond the ground a city levels: out of its safe zone (DESIGN 11). */
const CITY_CLEARANCE = 2000;
/** Predator dens and the apex's lair leave this much open ground (m) between their ground and a site's. */
const SITE_CLEARANCE = 40;
/** How many places the apex's lair is chosen from: the most wooded is the world's landmark grove. */
const GROVE_CANDIDATES = 48;

// The passes, in planning order, with the tier each starts at and how many dens it plans on a world (a fixed number per
// world, like the sites). Tier 0 has docile and skittish herds only, which need no dens (DESIGN 12.8). Predator dens come
// in all three kinds, so whatever body plan a world's predators roll (P1.E08.T01) finds dens of its own; the second
// predator pass is the second hostile species of Tier 3 and up (DESIGN 12.2).
const DEN_PASSES: readonly { role: DenRole; from: number; count: number }[] = [
  { role: 'predator', from: 1, count: 60 },
  { role: 'ambusher', from: 2, count: 40 },
  { role: 'apex', from: 2, count: 1 },
  { role: 'predator', from: 3, count: 60 },
];

/**
 * A den, as plain data: it round-trips through JSON with the rest of a planet's description, for the server's fauna
 * spawning (P1.E08.T03).
 */
export interface Den {
  type: DenType;
  role: DenRole;
  /** planet-local unit direction */
  dir: [number, number, number];
  /** stands as a site does (+Y turned onto `dir`), then turned this far (rad) about its up axis */
  yaw: number;
  /** ground footprint radius (m) */
  footprint: number;
  /** height of the levelled ground (m above sea level) */
  base: number;
  /** spread of the natural ground under the footprint (m) */
  relief: number;
  /** an ambusher's burrow: the index of the site it lies beside (in the planet's sites); -1 for every other den */
  site: number;
  seed: number;
}

export interface DenOptions {
  /** the system's tier, 0–5 (DESIGN 11) */
  tier?: number;
  /** the planet's cities: dens keep out of their plains and safe zones */
  cities?: City[];
  /** the planet's sites: dens keep off their ground, and ambushers lie beside them */
  sites?: Site[];
}

function checkTier(tier: number) {
  if (!Number.isInteger(tier) || tier < 0 || tier > MAX_TIER) throw new RangeError(`tier must be an integer from 0 to ${MAX_TIER}, not ${tier}`);
}

/** How many dens of each role a world with fauna is planned at a tier (fewer only where its ground has no room). */
export function denCounts(tier: number): Record<DenRole, number> {
  checkTier(tier);
  const out: Record<DenRole, number> = { predator: 0, ambusher: 0, apex: 0 };
  for (const pass of DEN_PASSES) if (tier >= pass.from) out[pass.role] += pass.count;
  return out;
}

/**
 * Whether a world has fauna, and so dens: not gas giants, barren or lifeless worlds, nor worlds all but bare of plants
 * (the client's herd rule). Lifeless worlds get their horrors in Phase 2 (DESIGN 12.4).
 */
export function hasFauna(p: Pick<PlanetParams, 'type' | 'lifeless' | 'flora'>): boolean {
  return (p.type as string) !== 'gas' && p.type !== 'barren' && !p.lifeless && p.flora >= 0.08;
}

/** A den's pad: levelled inside `inner` metres of its centre, back to natural ground by `outer`. */
function denPad(footprint: number, relief: number): [inner: number, outer: number] {
  const inner = footprint + 1;
  return [inner, inner + 6 + relief * 3];
}

/**
 * How far from its centre (m, along the chord, as the sampler measures) a pad changes the ground: levelled out to
 * `outer`, and worn out to (inner + 9) / 0.65, the farthest TerrainSampler.padWear's ragged edge reaches (0.6 keeps a
 * margin).
 */
function padReach(inner: number, outer: number): number {
  return Math.max(outer, (inner + 9) / 0.6);
}

/** Ground a den keeps clear of: a unit direction and how far (m) it reaches. */
interface Clear {
  x: number;
  y: number;
  z: number;
  reach: number;
  kind: 'city' | 'site' | 'den';
}

const X = /* @__PURE__ */ new Vector3(1, 0, 0);

function tangents(dir: Vector3, t: Vector3, b: Vector3) {
  t.crossVectors(Math.abs(dir.y) > 0.99 ? X : Y, dir).normalize();
  b.crossVectors(dir, t);
}

/**
 * Plans a world's dens for a tier: none at Tier 0, nor on worlds without fauna. Plan the cities and sites first, on the
 * natural ground, and pass them in; `denPads` gives the ground levelled under the dens.
 */
export function planDens(params: PlanetParams, sampler: TerrainSampler, { tier = 0, cities = [], sites = [] }: DenOptions = {}): Den[] {
  checkTier(tier);
  const dens: Den[] = [];
  if (!hasFauna(params)) return dens;
  const p = params;
  const R = p.radius;
  const clear: Clear[] = [];
  const cp = cityPads(cities);
  for (let i = 0; i < cp.length; i += 6)
    clear.push({ x: cp[i], y: cp[i + 1], z: cp[i + 2], reach: padReach(cp[i + 4], cp[i + 5]) + CITY_CLEARANCE, kind: 'city' });
  const sp = sitePads(sites);
  const siteReach: number[] = [];
  for (let i = 0; i < sp.length; i += 6) {
    const reach = padReach(sp[i + 4], sp[i + 5]);
    siteReach.push(reach);
    clear.push({ x: sp[i], y: sp[i + 1], z: sp[i + 2], reach, kind: 'site' });
  }

  // (before the ground under it is known, a den is taken to reach as far as the most broken ground it may level)
  const maxReach = (footprint: number) => padReach(...denPad(footprint, MAX_DEN_RELIEF));
  const fits = (d: Vector3, reach: number, role: DenRole) => {
    for (const c of clear) {
      let need = c.reach + reach + 1;
      if (c.kind === 'site' && role !== 'ambusher') need += SITE_CLEARANCE;
      if (c.kind === 'den') need = Math.max(need, DEN_SPACING);
      if (Math.hypot(d.x - c.x, d.y - c.y, d.z - c.z) * R < need) return false;
    }
    return true;
  };
  const t = new Vector3();
  const b = new Vector3();
  const q = new Vector3();
  // the natural ground under a footprint, or null where a den cannot go: the sea, a caldera, high or broken ground
  // (roosts take to the crags as well)
  const ground = (d: Vector3, footprint: number, type: DenType) => {
    const h = sampler.height(d.x, d.y, d.z);
    if (p.hasOcean && h < 4) return null;
    if (h > p.mountainHeight * (type === 'roost' ? 0.8 : 0.5)) return null;
    if (p.lava && sampler.caldera(d.x, d.y, d.z) > 0) return null;
    tangents(d, t, b);
    let lo = h;
    let hi = h;
    let sum = h;
    let n = 1;
    for (let k = 0; k < 20; k++) {
      const rr = ((k < 12 ? 1 : 0.5) * footprint) / R;
      const a = (k < 12 ? k / 12 : (k - 12) / 8 + 0.06) * Math.PI * 2;
      q.copy(d)
        .addScaledVector(t, Math.cos(a) * rr)
        .addScaledVector(b, Math.sin(a) * rr)
        .normalize();
      const hk = sampler.height(q.x, q.y, q.z);
      lo = Math.min(lo, hk);
      hi = Math.max(hi, hk);
      sum += hk;
      n++;
      if (hi - lo > MAX_DEN_RELIEF) return null;
    }
    if (p.hasOcean && lo < 3) return null;
    return { base: sum / n, relief: hi - lo };
  };
  const add = (rng: Random, type: DenType, role: DenRole, d: Vector3, footprint: number, g: { base: number; relief: number }, site: number) => {
    dens.push({ type, role, dir: [d.x, d.y, d.z], yaw: rng.float(0, Math.PI * 2), footprint, base: g.base, relief: g.relief, site, seed: rng.int(0, 1e9) });
    clear.push({ x: d.x, y: d.y, z: d.z, reach: padReach(...denPad(footprint, g.relief)), kind: 'den' });
  };
  // uniform over the sphere, as the sites are
  const randomDir = (rng: Random, out: Vector3) => {
    const y = rng.float(-1, 1);
    const r = Math.sqrt(1 - y * y);
    const th = rng.float(0, Math.PI * 2);
    return out.set(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
  };

  const dir = new Vector3();
  const st = new Vector3();
  const sb = new Vector3();
  DEN_PASSES.forEach((pass, k) => {
    if (tier < pass.from) return;
    const rng = new Random(hashInts(p.seed, 0xde75, k));
    if (pass.role === 'predator') {
      for (let i = 0, n = 0; i < 8000 && n < pass.count; i++) {
        const type = DEN_TYPES[n % DEN_TYPES.length];
        const fp = DEN_FOOTPRINT[type];
        randomDir(rng, dir);
        if (!fits(dir, maxReach(fp), 'predator')) continue;
        const g = ground(dir, fp, type);
        if (!g) continue;
        add(rng, type, 'predator', dir, fp, g, -1);
        n++;
      }
    } else if (pass.role === 'ambusher') {
      // beside the sites, taken in a shuffled order: at most one burrow each, just off the site's ground
      const order = sites.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const fp = DEN_FOOTPRINT.burrow;
      const reach = maxReach(fp);
      let n = 0;
      for (const si of order) {
        if (n >= pass.count) break;
        const s = sites[si];
        tangents(s.dir, st, sb);
        for (let tries = 0; tries < 4; tries++) {
          const a = rng.float(0, Math.PI * 2);
          const D = (siteReach[si] + reach + 2 + rng.float(0, 20)) / R;
          dir
            .copy(s.dir)
            .addScaledVector(st, Math.cos(a) * D)
            .addScaledVector(sb, Math.sin(a) * D)
            .normalize();
          if (!fits(dir, reach, 'ambusher')) continue;
          const g = ground(dir, fp, 'burrow');
          if (!g) continue;
          add(rng, 'burrow', 'ambusher', dir, fp, g, si);
          n++;
          break;
        }
      }
    } else {
      // the apex's lair, in the world's landmark grove: the most wooded of a few dozen places a den could go, by the
      // tree cover the terrain and the tree scatter share (surfaceAttribs)
      const reach = maxReach(APEX_FOOTPRINT);
      const attrs = [0, 0, 0, 0];
      let best: { dir: Vector3; g: { base: number; relief: number }; forest: number } | null = null;
      for (let i = 0, found = 0; i < 4000 && found < GROVE_CANDIDATES; i++) {
        randomDir(rng, dir);
        if (!fits(dir, reach, 'apex')) continue;
        const g = ground(dir, APEX_FOOTPRINT, 'nest');
        if (!g) continue;
        found++;
        const forest = surfaceAttribs(sampler, sampler.sample(dir.x, dir.y, dir.z), dir.x, dir.y, dir.z, attrs)[3];
        if (!best || forest > best.forest) best = { dir: dir.clone(), g, forest };
      }
      if (best) add(rng, 'nest', 'apex', best.dir, APEX_FOOTPRINT, best.g, -1);
    }
  });
  return dens;
}

/** Flat [x, y, z, height, inner, outer] per den for the terrain sampler, as sitePads gives for sites. */
export function denPads(dens: Den[]): number[] {
  const pads: number[] = [];
  for (const d of dens) pads.push(d.dir[0], d.dir[1], d.dir[2], d.base, ...denPad(d.footprint, d.relief));
  return pads;
}

/** Everything planned on a rocky world's surface, and the ground levelled under it. */
export interface SurfacePlan {
  cities: City[];
  sites: Site[];
  dens: Den[];
  /** for `params.pads` and `TerrainSampler.setPads`: the cities', then the sites', then the dens' */
  pads: number[];
}

/**
 * Plans a rocky world's surface in the order the client's Planet does: cities, then sites clear of them, then dens clear
 * of both, for the system's tier (DESIGN 11; 0, the default, plans no dens). Plans on the natural ground: `sampler` must
 * not have pads yet. Set `params.pads = plan.pads` and `sampler.setPads(plan.pads)` before sampling the ground.
 */
export function planSurface(params: PlanetParams, sampler: TerrainSampler, { tier = 0 }: { tier?: number } = {}): SurfacePlan {
  if (sampler.pads?.length) throw new Error('planSurface plans on the natural ground: pass a sampler without pads');
  const cities = planCities(params, sampler);
  const sites = planSites(params, sampler, cities);
  const dens = planDens(params, sampler, { tier, cities, sites });
  return { cities, sites, dens, pads: [...cityPads(cities), ...sitePads(sites), ...denPads(dens)] };
}
