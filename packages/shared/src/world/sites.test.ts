import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cityPads, planCities } from './cities.ts';
import { PLANET_TYPES, TerrainSampler, archetype, createPlanetParams, surfaceAttribs, type PlanetParams, type PlanetType } from './planetgen.ts';
import { Random } from './rng.ts';
import {
  APEX_FOOTPRINT,
  DEN_FOOTPRINT,
  DEN_KINDS,
  DEN_PASSES,
  LAND_PER_PREDATOR_DEN,
  MAX_TIER,
  denCounts,
  denPads,
  denPlans,
  hasFauna,
  landArea,
  planDens,
  planSites,
  planSurface,
  sitePads,
  type Den,
  type DenRole,
} from './sites.ts';

/** A world planned the way the client's Planet plans it, at a tier, and its land area. */
function world(seed: number, type: PlanetType, radius: number, tier: number, isMoon = false) {
  const params = createPlanetParams(seed, type, radius, { isMoon });
  const sampler = new TerrainSampler(params);
  const plan = planSurface(params, sampler, { tier });
  return { params, land: landArea(params, sampler), ...plan };
}

/** A lush world with at least one city (so the dens have a city to keep clear of). */
function lushWithCity(): { seed: number; params: PlanetParams } {
  for (let seed = 1; ; seed++) {
    const params = createPlanetParams(seed, 'lush', 60000);
    if (params.cityCount && planCities(params, new TerrainSampler(params)).length) return { seed, params };
  }
}

/** A sampler for the world with the given pads levelled. */
function padded(params: PlanetParams, pads: number[]): TerrainSampler {
  const s = new TerrainSampler(params);
  s.setPads(pads);
  return s;
}

/** Points round a den's centre at `radius` metres (16 of them), and the centre itself. */
function ring(d: Den, radius: number, R: number): Vector3[] {
  const dir = new Vector3(...d.dir);
  const t = new Vector3().crossVectors(Math.abs(dir.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0), dir).normalize();
  const b = new Vector3().crossVectors(dir, t);
  const out = [dir.clone()];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    out.push(
      dir
        .clone()
        .addScaledVector(t, (Math.cos(a) * radius) / R)
        .addScaledVector(b, (Math.sin(a) * radius) / R)
        .normalize(),
    );
  }
  return out;
}

/** Points across a den's footprint: its centre and rings at a quarter, half, three quarters and all of its radius. */
const footprintPoints = (d: Den, R: number) => [0.25, 0.5, 0.75, 1].flatMap((f) => ring(d, d.footprint * f, R));

/** As far as a pad changes the ground: levelled to `outer`, worn (padWear's ragged edge) to (inner + 9) / 0.65. */
const reach = (inner: number, outer: number) => Math.max(outer, (inner + 9) / 0.65);
const denReach = (d: Den) => reach(...(denPads([d]).slice(4) as [number, number]));

describe('den counts by tier', () => {
  it('none at Tier 0; a predator species from Tier 1, ambushers and the apex from Tier 2, a second species from Tier 3', () => {
    const land = 100 * LAND_PER_PREDATOR_DEN;
    expect([0, 1, 2, 3, 4, 5].map((tier) => denCounts(tier, land))).toEqual([
      { predator: 0, ambusher: 0, apex: 0 },
      { predator: 100, ambusher: 0, apex: 0 },
      { predator: 100, ambusher: 40, apex: 1 },
      { predator: 200, ambusher: 40, apex: 1 },
      { predator: 200, ambusher: 40, apex: 1 },
      { predator: 200, ambusher: 40, apex: 1 },
    ]);
  });

  it('scales the predator dens with the land, one per 80 km² for each hostile species', () => {
    expect(LAND_PER_PREDATOR_DEN).toBe(80);
    expect(denCounts(1, 40000).predator).toBe(500);
    expect(denCounts(3, 40000).predator).toBe(1000);
    expect(denCounts(3, 4000)).toEqual({ predator: 100, ambusher: 40, apex: 1 });
  });

  it('plans its passes in the order of the tiers they start at, so raising the tier only appends', () => {
    for (let i = 1; i < DEN_PASSES.length; i++) expect(DEN_PASSES[i].from).toBeGreaterThanOrEqual(DEN_PASSES[i - 1].from);
    expect(DEN_PASSES[0].from).toBe(1);
  });

  it('refuses a tier outside 0–5', () => {
    for (const tier of [-1, MAX_TIER + 1, 1.5, NaN]) expect(() => denCounts(tier, 1000)).toThrow(RangeError);
    const params = createPlanetParams(7, 'lush', 60000);
    expect(() => planDens(params, new TerrainSampler(params), { tier: 6 })).toThrow(RangeError);
  });

  it('only worlds with fauna have dens: never gas giants, barren or lifeless worlds', () => {
    for (const type of PLANET_TYPES) {
      const a = archetype(type);
      if (type === 'barren' || a.lifeless) expect(hasFauna(createPlanetParams(3, type, 60000)), type).toBe(false);
    }
    expect(hasFauna(createPlanetParams(3, 'lush', 60000))).toBe(true);
    // (a gas giant's params, as the client's solar system makes them, have no flora)
    expect(hasFauna({ type: 'gas', hasOcean: false } as unknown as PlanetParams)).toBe(false);
    expect(hasFauna({ type: 'desert', lifeless: false, flora: 0.05 })).toBe(false);
  });

  it("measures a world's land: all of a dry world, the part of a wet one above the sea", () => {
    const dry = createPlanetParams(4, 'lush', 50000);
    dry.hasOcean = false;
    expect(landArea(dry, new TerrainSampler(dry))).toBeCloseTo(4 * Math.PI * 50 * 50, 6);
    const wet = createPlanetParams(4, 'lush', 50000);
    const sampler = new TerrainSampler(wet);
    const land = landArea(wet, sampler);
    const rng = new Random(8);
    let above = 0;
    for (let i = 0; i < 4000; i++) {
      const p = new Vector3(rng.gaussian(), rng.gaussian(), rng.gaussian()).normalize();
      if (sampler.height(p.x, p.y, p.z) > 0) above++;
    }
    expect(land / (4 * Math.PI * 50 * 50)).toBeCloseTo(above / 4000, 1);
  });
});

describe('den planning', () => {
  it('plans no dens at Tier 0 on any world, so the planet comes out exactly as the client plans it today', () => {
    for (const type of PLANET_TYPES) {
      const { params, cities, sites, dens, pads } = world(11, type, 40000, 0);
      expect(dens, type).toEqual([]);
      const sampler = new TerrainSampler(params);
      const c = planCities(params, sampler);
      expect(pads, type).toEqual([...cityPads(c), ...sitePads(planSites(params, sampler, c))]);
      expect(cities.length + sites.length).toBe(pads.length / 6);
    }
  });

  it('plans none on lifeless and barren worlds at any tier', () => {
    for (const type of PLANET_TYPES.filter((t) => t === 'barren' || archetype(t).lifeless)) expect(world(5, type, 40000, MAX_TIER).dens, type).toEqual([]);
  });

  const { seed, params } = lushWithCity();
  const R = params.radius;
  const byTier = [0, 1, 2, 3, 4, 5].map((tier) => world(seed, 'lush', R, tier));
  const top = byTier[MAX_TIER];
  const land = top.land;

  it('meets the counts on a living world, predator dens in all three kinds, ambushers in burrows, the apex in a nest', () => {
    expect(land).toBeGreaterThan(1000);
    for (const [tier, w] of byTier.entries()) {
      const roles: Record<DenRole, number> = { predator: 0, ambusher: 0, apex: 0 };
      for (const d of w.dens) roles[d.role]++;
      expect(roles, `tier ${tier}`).toEqual(denCounts(tier, land));
      // (each predator pass deals the kinds in turn)
      const kinds = DEN_KINDS.map((k) => w.dens.filter((d) => d.role === 'predator' && d.kind === k).length);
      expect(Math.max(...kinds) - Math.min(...kinds)).toBeLessThanOrEqual(tier >= 3 ? 2 : 1);
      for (const d of w.dens) {
        expect(d.footprint).toBe(d.role === 'apex' ? APEX_FOOTPRINT : DEN_FOOTPRINT[d.kind]);
        if (d.role === 'ambusher') expect(d.kind).toBe('burrow');
        if (d.role === 'apex') expect(d.kind).toBe('nest');
        expect(d.site >= 0).toBe(d.role === 'ambusher');
      }
    }
  });

  it("says who lives in each den, so a world's predators find the dens of their body plan", () => {
    expect(DEN_KINDS.map((k) => denPlans('predator', k))).toEqual([['quad_small'], ['biped'], ['flyer']]);
    expect(denPlans('ambusher', 'burrow')).toEqual(['quad_small', 'biped']);
    expect(denPlans('apex', 'nest')).toEqual(['quad_heavy']);
    for (const d of top.dens) expect(d.plans).toEqual(denPlans(d.role, d.kind));
    for (const plan of ['quad_small', 'biped', 'flyer'] as const) {
      const homes = top.dens.filter((d) => d.role === 'predator' && d.plans.includes(plan)).length;
      expect(homes).toBeGreaterThanOrEqual(Math.floor(denCounts(MAX_TIER, land).predator / 3) - 1);
    }
  });

  it('is deterministic, and raising the tier adds dens without moving one', () => {
    expect(world(seed, 'lush', R, 3).dens).toEqual(byTier[3].dens);
    for (let tier = 0; tier < MAX_TIER; tier++) expect(byTier[tier + 1].dens.slice(0, byTier[tier].dens.length)).toEqual(byTier[tier].dens);
  });

  it('never moves a city or a site', () => {
    for (const w of byTier) {
      expect(w.cities).toEqual(byTier[0].cities);
      expect(w.sites).toEqual(byTier[0].sites);
      expect(w.pads.slice(0, byTier[0].pads.length)).toEqual(byTier[0].pads);
    }
  });

  it('levels the ground across every den', () => {
    const sampler = padded(params, top.pads);
    const raw = new TerrainSampler(params);
    let worst = 0;
    let natural = 0;
    for (const d of top.dens) {
      const pts = footprintPoints(d, R);
      for (const p of pts) worst = Math.max(worst, Math.abs(sampler.height(p.x, p.y, p.z) - d.base));
      const h = pts.map((p) => raw.height(p.x, p.y, p.z));
      natural = Math.max(natural, Math.max(...h) - Math.min(...h));
    }
    expect(worst).toBeLessThan(1e-9);
    // (and there was ground to level)
    expect(natural).toBeGreaterThan(0.5);
  });

  it("keeps every den's ground clear of the cities', the sites' and the other dens' (checked against all of them)", () => {
    const pads = top.pads;
    const nOld = byTier[0].pads.length;
    let worst = Infinity;
    for (let i = nOld; i < pads.length; i += 6) {
      const ri = reach(pads[i + 4], pads[i + 5]);
      for (let j = 0; j < pads.length; j += 6) {
        if (j === i) continue;
        const d = Math.hypot(pads[i] - pads[j], pads[i + 1] - pads[j + 1], pads[i + 2] - pads[j + 2]) * R;
        worst = Math.min(worst, d - ri - reach(pads[j + 4], pads[j + 5]));
      }
    }
    expect(worst).toBeGreaterThan(0);
  });

  it('changes the ground nowhere but under the dens: heights and surface attributes elsewhere stay as they were', () => {
    const before = padded(params, byTier[0].pads);
    const after = padded(params, top.pads);
    const dens = top.dens.map((d) => ({ dir: new Vector3(...d.dir), reach: denReach(d) }));
    const rng = new Random(99);
    const pts: Vector3[] = [];
    // random points, points in and around every site's and city's levelled ground, and rings just outside each den's reach
    for (let i = 0; i < 3000; i++) pts.push(new Vector3(rng.gaussian(), rng.gaussian(), rng.gaussian()).normalize());
    for (let i = 0; i < byTier[0].pads.length; i += 6) {
      const o = new Vector3(byTier[0].pads[i], byTier[0].pads[i + 1], byTier[0].pads[i + 2]);
      const spread = (byTier[0].pads[i + 5] * 1.6) / R;
      for (let k = 0; k < 24; k++)
        pts.push(
          o
            .clone()
            .addScaledVector(new Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)), spread)
            .normalize(),
        );
    }
    for (const d of top.dens) for (const extra of [0.5, 20]) pts.push(...ring(d, denReach(d) + extra, R).slice(1));
    let checked = 0;
    const changed: Vector3[] = [];
    const a = [0, 0, 0, 0];
    const b = [0, 0, 0, 0];
    for (const p of pts) {
      if (dens.some((d) => p.distanceTo(d.dir) * R <= d.reach)) continue;
      checked++;
      const sa = { ...before.sample(p.x, p.y, p.z) };
      const sb = { ...after.sample(p.x, p.y, p.z) };
      surfaceAttribs(before, sa, p.x, p.y, p.z, a);
      surfaceAttribs(after, sb, p.x, p.y, p.z, b);
      if (JSON.stringify([sa, a]) !== JSON.stringify([sb, b])) changed.push(p);
    }
    expect(changed).toEqual([]);
    expect(checked).toBeGreaterThan(top.dens.length * 30);
  });

  it("lays each ambusher's burrow beside its site", () => {
    const sp = sitePads(top.sites);
    for (const d of top.dens.filter((x) => x.role === 'ambusher')) {
      const s = new Vector3(sp[d.site * 6], sp[d.site * 6 + 1], sp[d.site * 6 + 2]);
      const gap = new Vector3(...d.dir).distanceTo(s) * R - denReach(d) - reach(sp[d.site * 6 + 4], sp[d.site * 6 + 5]);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(40);
    }
    expect(new Set(top.dens.filter((x) => x.role === 'ambusher').map((d) => d.site)).size).toBe(denCounts(MAX_TIER, land).ambusher);
  });

  it("puts the apex's lair in a grove: more wooded than most of the world's open ground", () => {
    const apex = top.dens.find((d) => d.role === 'apex')!;
    const sampler = new TerrainSampler(params);
    const forest = (x: number, y: number, z: number) => surfaceAttribs(sampler, sampler.sample(x, y, z), x, y, z, [0, 0, 0, 0])[3];
    const rng = new Random(5);
    const cover: number[] = [];
    while (cover.length < 300) {
      const p = new Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)).normalize();
      if (sampler.height(p.x, p.y, p.z) > 4) cover.push(forest(p.x, p.y, p.z));
    }
    cover.sort((x, y) => x - y);
    expect(forest(...apex.dir)).toBeGreaterThan(cover[Math.floor(cover.length * 0.75)]);
  });

  it('is plain data: the den list round-trips through JSON', () => {
    const copy = JSON.parse(JSON.stringify(top.dens)) as Den[];
    expect(copy).toEqual(top.dens);
    expect(denPads(copy)).toEqual(denPads(top.dens));
  });

  it('plans dens on moons with fauna too, by their land', () => {
    const moon = world(21, 'frozen', 24000, 2, true);
    const c = denCounts(2, moon.land);
    expect(moon.dens.length).toBe(c.predator + c.ambusher + c.apex);
  });

  it('plans on the natural ground only', () => {
    expect(() => planSurface(params, padded(params, top.pads))).toThrow(/natural ground/);
  });
});
