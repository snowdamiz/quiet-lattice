// Where a planet's points of interest stand. Planned once per planet before its terrain is
// built, because the ground under each site is levelled (see TerrainSampler.setPads).
import { Quaternion, Vector3 } from 'three';
import { angleTo, cos, hypot3, setFromAxisAngle, sin } from '../math/det.ts';
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
    const dir = new Vector3(cos(th) * r, y, sin(th) * r).normalize();
    if (avoid.some((c) => angleTo(c.dir, dir) * R < c.radius + 700)) continue;
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
        .addScaledVector(t, cos(a) * rr)
        .addScaledVector(b, sin(a) * rr)
        .normalize();
      const hk = sampler.height(q.x, q.y, q.z);
      lo = Math.min(lo, hk);
      hi = Math.max(hi, hk);
      sum += hk;
      n++;
    }
    if (hi - lo > MAX_RELIEF) continue;
    if (p.hasOcean && lo < 3) continue;
    const quat = new Quaternion().setFromUnitVectors(Y, dir).multiply(setFromAxisAngle(new Quaternion(), Y, rng.float(0, Math.PI * 2)));
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
// DESIGN 12.2 "Spawning": dens are a small site type, planned with the planet like the other sites: discoverable lairs
// that anchor packs, their respawns, the apex and the ambushers (predators also come with the herd spawner around the
// camera). Each pass below draws from a stream of its own and keeps clear of everything planned before it, so dens
// never move a city or a site or touch the ground under one, and raising a world's tier adds dens without moving any.
// A den has no model yet (DESIGN 19.3 lists the den models with the sites' art): nothing is drawn for one, but the
// ground under it is levelled, as under a site, for the model to sit on.

/** The kind of den, which is also the family of model that will stand on it (DESIGN 19.3). */
export type DenKind = 'burrow' | 'nest' | 'roost';
export const DEN_KINDS: readonly DenKind[] = ['burrow', 'nest', 'roost'];
/** The temperament a den houses (DESIGN 12.2). */
export type DenRole = 'predator' | 'ambusher' | 'apex';
export const DEN_ROLES: readonly DenRole[] = ['predator', 'ambusher', 'apex'];
/** A creature body plan, by the mob table's ids (DESIGN 12.2). */
export type DenBodyPlan = 'quad_heavy' | 'quad_small' | 'biped' | 'flyer';
/** Ground footprint radius (m) of each kind of den: smaller than any site. */
export const DEN_FOOTPRINT: Readonly<Record<DenKind, number>> = { burrow: 4, nest: 6, roost: 5 };
/** The apex's lair: a nest big enough for a heavy quadruped and the pack that follows it. */
export const APEX_FOOTPRINT = 10;
/** Tiers run from 0 (the home systems) to 5 (Edge-ward), DESIGN 11. */
export const MAX_TIER = 5;
/** Land (km²) per predator den, for each hostile species: a lair a few kilometres from most of the world's land. */
export const LAND_PER_PREDATOR_DEN = 80;
const MAX_DEN_RELIEF = 4;
/** Dens keep this far apart (m). */
const DEN_SPACING = 300;
/** Dens keep this far (m) beyond the ground a city levels: out of its safe zone (DESIGN 11). */
const CITY_CLEARANCE = 2000;
/** Predator dens and the apex's lair leave this much open ground (m) between their ground and a site's. */
const SITE_CLEARANCE = 40;
/** How many places the apex's lair is chosen from: the most wooded is the world's landmark grove. */
const GROVE_CANDIDATES = 48;
/** Points (evenly spread over the sphere) a world's land area is measured at. */
const LAND_SAMPLES = 4096;

/**
 * Who lives in a den (DESIGN 12.2's temperaments by body plan): predators by body plan, pack quad_small in burrows,
 * biped stalkers in nests and flyer divers on roosts; ambushers (quad_small or biped) in burrows; the apex (quad_heavy)
 * in its nest. The species are rolled later (P1.E08.T01), so predator dens come in all three kinds: a world's predators
 * use the dens whose `plans` hold their body plan.
 */
export function denPlans(role: DenRole, kind: DenKind): DenBodyPlan[] {
  if (role === 'apex') return ['quad_heavy'];
  if (role === 'ambusher') return ['quad_small', 'biped'];
  return kind === 'burrow' ? ['quad_small'] : kind === 'nest' ? ['biped'] : ['flyer'];
}

/** A planning pass: the dens of one role from a tier up, a fixed number per world or one per so much land. */
export interface DenPass {
  role: DenRole;
  /** the tier it starts at */
  from: number;
  count?: number;
  /** km² of land per den */
  landPerDen?: number;
}

// The passes, in planning order, which is by the tier each starts at: a pass for a lower tier never lands after one for
// a higher, so raising the tier only appends. Tier 0 has docile and skittish herds only, which need no dens (DESIGN
// 12.8). A predator pass is one hostile species: the first from Tier 1, the second from Tier 3 (DESIGN 12.2). Ambushers
// lie beside sites, at most one burrow each; the apex has one lair per world.
export const DEN_PASSES: readonly DenPass[] = [
  { role: 'predator', from: 1, landPerDen: LAND_PER_PREDATOR_DEN },
  { role: 'ambusher', from: 2, count: 40 },
  { role: 'apex', from: 2, count: 1 },
  { role: 'predator', from: 3, landPerDen: LAND_PER_PREDATOR_DEN },
];

function passCount(pass: DenPass, landKm2: number): number {
  return pass.count ?? Math.round(landKm2 / pass.landPerDen!);
}

/**
 * A den, as plain data: it round-trips through JSON with the rest of a planet's description, for the server's fauna
 * spawning (P1.E08.T03).
 */
export interface Den {
  kind: DenKind;
  role: DenRole;
  /** the body plans that live here (denPlans) */
  plans: DenBodyPlan[];
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

/**
 * How many dens of each role a world with fauna and `landKm2` of land is planned at a tier (fewer only where its ground
 * has no room: ambushers need a site each).
 */
export function denCounts(tier: number, landKm2: number): Record<DenRole, number> {
  checkTier(tier);
  const out: Record<DenRole, number> = { predator: 0, ambusher: 0, apex: 0 };
  for (const pass of DEN_PASSES) if (tier >= pass.from) out[pass.role] += passCount(pass, landKm2);
  return out;
}

/** A world's dry land (km²): its surface above the sea, measured on its natural ground at points spread evenly over the sphere. */
export function landArea(params: Pick<PlanetParams, 'radius' | 'hasOcean'>, sampler: Pick<TerrainSampler, 'height'>): number {
  let land = LAND_SAMPLES;
  if (params.hasOcean) {
    land = 0;
    // (a Fibonacci lattice)
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < LAND_SAMPLES; i++) {
      const y = 1 - ((i + 0.5) * 2) / LAND_SAMPLES;
      const r = Math.sqrt(1 - y * y);
      if (sampler.height(cos(i * golden) * r, y, sin(i * golden) * r) > 0) land++;
    }
  }
  return ((land / LAND_SAMPLES) * 4 * Math.PI * params.radius * params.radius) / 1e6;
}

/**
 * Whether a world has fauna, and so dens: not barren or lifeless worlds, nor worlds all but bare of plants (the
 * client's herd rule; a gas giant's params have no flora at all). Lifeless worlds get their horrors in Phase 2 (DESIGN
 * 12.4).
 */
export function hasFauna(p: Pick<PlanetParams, 'type' | 'lifeless' | 'flora'>): boolean {
  return p.type !== 'barren' && !p.lifeless && p.flora >= 0.08;
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

/**
 * The sites' and dens' ground, bucketed on a grid of cells `cell` metres across: a candidate only has to look at the 27
 * cells round its own, as long as no clearance it needs from a site or a den is wider than a cell.
 */
class ClearGrid {
  cells = new Map<number, Clear[]>();
  constructor(
    readonly R: number,
    readonly cell: number,
  ) {}
  private index(v: number): number {
    return Math.floor((v * this.R) / this.cell) + 2048;
  }
  add(c: Clear) {
    const key = (this.index(c.x) * 4096 + this.index(c.y)) * 4096 + this.index(c.z);
    const list = this.cells.get(key);
    if (list) list.push(c);
    else this.cells.set(key, [c]);
  }
  /** Calls `fn` for everything in the cells round a point; stops, and returns false, when `fn` does. */
  every(x: number, y: number, z: number, fn: (c: Clear) => boolean): boolean {
    const ix = this.index(x);
    const iy = this.index(y);
    const iz = this.index(z);
    for (let i = ix - 1; i <= ix + 1; i++) {
      for (let j = iy - 1; j <= iy + 1; j++) {
        for (let k = iz - 1; k <= iz + 1; k++) {
          const list = this.cells.get((i * 4096 + j) * 4096 + k);
          if (list) for (const c of list) if (!fn(c)) return false;
        }
      }
    }
    return true;
  }
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
  if (!hasFauna(params) || tier < DEN_PASSES[0].from) return dens;
  const p = params;
  const R = p.radius;
  const land = landArea(p, sampler);

  // (before the ground under it is known, a den is taken to reach as far as the most broken ground it may level)
  const maxReach = (footprint: number) => padReach(...denPad(footprint, MAX_DEN_RELIEF));
  // cities, few and wide, are always checked; the sites and dens go on a grid
  const wide: Clear[] = [];
  const cp = cityPads(cities);
  for (let i = 0; i < cp.length; i += 6)
    wide.push({ x: cp[i], y: cp[i + 1], z: cp[i + 2], reach: padReach(cp[i + 4], cp[i + 5]) + CITY_CLEARANCE, kind: 'city' });
  const sp = sitePads(sites);
  const siteReach: number[] = [];
  for (let i = 0; i < sp.length; i += 6) siteReach.push(padReach(sp[i + 4], sp[i + 5]));
  const widest = Math.max(DEN_SPACING, Math.max(0, ...siteReach) + maxReach(APEX_FOOTPRINT) + SITE_CLEARANCE + 1);
  const grid = new ClearGrid(R, Math.max(widest, R / 1500));
  for (let i = 0; i < sp.length; i += 6) grid.add({ x: sp[i], y: sp[i + 1], z: sp[i + 2], reach: siteReach[i / 6], kind: 'site' });

  const fits = (d: Vector3, reach: number, role: DenRole) => {
    const clearOf = (c: Clear) => {
      let need = c.reach + reach + 1;
      if (c.kind === 'site' && role !== 'ambusher') need += SITE_CLEARANCE;
      if (c.kind === 'den') need = Math.max(need, DEN_SPACING);
      return hypot3(d.x - c.x, d.y - c.y, d.z - c.z) * R >= need;
    };
    return wide.every(clearOf) && grid.every(d.x, d.y, d.z, clearOf);
  };
  const t = new Vector3();
  const b = new Vector3();
  const q = new Vector3();
  // the natural ground under a footprint, or null where a den cannot go: the sea, a caldera, high or broken ground
  // (roosts take to the crags as well)
  const ground = (d: Vector3, footprint: number, kind: DenKind) => {
    const h = sampler.height(d.x, d.y, d.z);
    if (p.hasOcean && h < 4) return null;
    if (h > p.mountainHeight * (kind === 'roost' ? 0.8 : 0.5)) return null;
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
        .addScaledVector(t, cos(a) * rr)
        .addScaledVector(b, sin(a) * rr)
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
  const add = (rng: Random, kind: DenKind, role: DenRole, d: Vector3, footprint: number, g: { base: number; relief: number }, site: number) => {
    const plans = denPlans(role, kind);
    dens.push({
      kind,
      role,
      plans,
      dir: [d.x, d.y, d.z],
      yaw: rng.float(0, Math.PI * 2),
      footprint,
      base: g.base,
      relief: g.relief,
      site,
      seed: rng.int(0, 1e9),
    });
    grid.add({ x: d.x, y: d.y, z: d.z, reach: padReach(...denPad(footprint, g.relief)), kind: 'den' });
  };
  // uniform over the sphere, as the sites are
  const randomDir = (rng: Random, out: Vector3) => {
    const y = rng.float(-1, 1);
    const r = Math.sqrt(1 - y * y);
    const th = rng.float(0, Math.PI * 2);
    return out.set(cos(th) * r, y, sin(th) * r).normalize();
  };

  const dir = new Vector3();
  const st = new Vector3();
  const sb = new Vector3();
  DEN_PASSES.forEach((pass, k) => {
    if (tier < pass.from) return;
    const rng = new Random(hashInts(p.seed, 0xde75, k));
    const count = passCount(pass, land);
    if (pass.role === 'predator') {
      // (all three kinds in turn: see denPlans)
      for (let i = 0, n = 0; i < count * 40 + 2000 && n < count; i++) {
        const kind = DEN_KINDS[n % DEN_KINDS.length];
        const fp = DEN_FOOTPRINT[kind];
        randomDir(rng, dir);
        if (!fits(dir, maxReach(fp), 'predator')) continue;
        const g = ground(dir, fp, kind);
        if (!g) continue;
        add(rng, kind, 'predator', dir, fp, g, -1);
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
        if (n >= count) break;
        const s = sites[si];
        tangents(s.dir, st, sb);
        for (let tries = 0; tries < 4; tries++) {
          const a = rng.float(0, Math.PI * 2);
          const D = (siteReach[si] + reach + 2 + rng.float(0, 20)) / R;
          dir
            .copy(s.dir)
            .addScaledVector(st, cos(a) * D)
            .addScaledVector(sb, sin(a) * D)
            .normalize();
          if (!fits(dir, reach, 'ambusher')) continue;
          const g = ground(dir, fp, 'burrow');
          if (!g) continue;
          add(rng, 'burrow', 'ambusher', dir, fp, g, si);
          n++;
          break;
        }
      }
    } else if (count > 0) {
      // the apex's lair (one), in the world's landmark grove: the most wooded of a few dozen places a den could go, by
      // the tree cover the terrain and the tree scatter share (surfaceAttribs)
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
