import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cityPads, planCities } from './cities.ts';
import { PLANET_TYPES, TerrainSampler, archetype, createPlanetParams, surfaceAttribs, type PlanetParams, type PlanetType } from './planetgen.ts';
import { Random } from './rng.ts';
import {
  APEX_FOOTPRINT,
  DEN_FOOTPRINT,
  DEN_TYPES,
  MAX_TIER,
  denCounts,
  denPads,
  hasFauna,
  planDens,
  planSites,
  planSurface,
  sitePads,
  type Den,
  type DenRole,
} from './sites.ts';

/** A world planned the way the client's Planet plans it, at a tier. */
function world(seed: number, type: PlanetType, radius: number, tier: number, isMoon = false) {
  const params = createPlanetParams(seed, type, radius, { isMoon });
  const plan = planSurface(params, new TerrainSampler(params), { tier });
  return { params, ...plan };
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

/** Points across a den's footprint: its centre and rings at a quarter, half, three quarters and all of its radius. */
function footprintPoints(d: Den, R: number): Vector3[] {
  const dir = new Vector3(...d.dir);
  const t = new Vector3().crossVectors(Math.abs(dir.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0), dir).normalize();
  const b = new Vector3().crossVectors(dir, t);
  const out = [dir.clone()];
  for (const f of [0.25, 0.5, 0.75, 1]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const r = (d.footprint * f) / R;
      out.push(
        dir
          .clone()
          .addScaledVector(t, Math.cos(a) * r)
          .addScaledVector(b, Math.sin(a) * r)
          .normalize(),
      );
    }
  }
  return out;
}

const pad = (pads: number[], i: number) => ({ dir: new Vector3(pads[i], pads[i + 1], pads[i + 2]), inner: pads[i + 4], outer: pads[i + 5] });
/** As far as a pad changes the ground: levelled to `outer`, worn (padWear's ragged edge) to (inner + 9) / 0.65. */
const reach = (inner: number, outer: number) => Math.max(outer, (inner + 9) / 0.65);
const chord = (a: Vector3, b: Vector3, R: number) => a.distanceTo(b) * R;

describe('den counts by tier', () => {
  it('none at Tier 0; one predator species from Tier 1, ambushers and the apex from Tier 2, a second species from Tier 3', () => {
    expect([0, 1, 2, 3, 4, 5].map(denCounts)).toEqual([
      { predator: 0, ambusher: 0, apex: 0 },
      { predator: 60, ambusher: 0, apex: 0 },
      { predator: 60, ambusher: 40, apex: 1 },
      { predator: 120, ambusher: 40, apex: 1 },
      { predator: 120, ambusher: 40, apex: 1 },
      { predator: 120, ambusher: 40, apex: 1 },
    ]);
  });

  it('refuses a tier outside 0–5', () => {
    for (const tier of [-1, MAX_TIER + 1, 1.5, NaN]) expect(() => denCounts(tier)).toThrow(RangeError);
    const params = createPlanetParams(7, 'lush', 60000);
    expect(() => planDens(params, new TerrainSampler(params), { tier: 6 })).toThrow(RangeError);
  });

  it('only worlds with fauna have dens: never gas giants, barren or lifeless worlds', () => {
    for (const type of PLANET_TYPES) {
      const a = archetype(type);
      if (type === 'barren' || a.lifeless) expect(hasFauna(createPlanetParams(3, type, 60000)), type).toBe(false);
    }
    expect(hasFauna(createPlanetParams(3, 'lush', 60000))).toBe(true);
    expect(hasFauna({ type: 'gas' as PlanetType, lifeless: false, flora: 1 })).toBe(false);
    expect(hasFauna({ type: 'desert', lifeless: false, flora: 0.05 })).toBe(false);
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

  it('meets the counts on a living world, predator dens in all three kinds, ambushers in burrows, the apex in a nest', () => {
    for (const [tier, w] of byTier.entries()) {
      const roles: Record<DenRole, number> = { predator: 0, ambusher: 0, apex: 0 };
      for (const d of w.dens) roles[d.role]++;
      expect(roles, `tier ${tier}`).toEqual(denCounts(tier));
      const predators = w.dens.filter((d) => d.role === 'predator');
      for (const type of DEN_TYPES) expect(predators.filter((d) => d.type === type).length).toBe(predators.length / 3);
      for (const d of w.dens) {
        expect(d.footprint).toBe(d.role === 'apex' ? APEX_FOOTPRINT : DEN_FOOTPRINT[d.type]);
        if (d.role === 'ambusher') expect(d.type).toBe('burrow');
        if (d.role === 'apex') expect(d.type).toBe('nest');
        expect(d.site >= 0).toBe(d.role === 'ambusher');
      }
    }
  });

  it('is deterministic, and raising the tier adds dens without moving one', () => {
    expect(world(seed, 'lush', R, 3).dens).toEqual(byTier[3].dens);
    for (let tier = 0; tier < MAX_TIER; tier++) for (const d of byTier[tier].dens) expect(byTier[tier + 1].dens).toContainEqual(d);
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
    let natural = 0;
    for (const d of top.dens) {
      const pts = footprintPoints(d, R);
      for (const p of pts) expect(sampler.height(p.x, p.y, p.z)).toBeCloseTo(d.base, 9);
      const h = pts.map((p) => raw.height(p.x, p.y, p.z));
      natural = Math.max(natural, Math.max(...h) - Math.min(...h));
    }
    // (and there was ground to level)
    expect(natural).toBeGreaterThan(0.5);
  });

  it("keeps every den's ground clear of the cities', the sites' and the other dens'", () => {
    const pads = top.pads;
    const nOld = byTier[0].pads.length;
    for (let i = nOld; i < pads.length; i += 6) {
      const d = pad(pads, i);
      for (let j = 0; j < pads.length; j += 6) {
        if (j === i) continue;
        const o = pad(pads, j);
        expect(chord(d.dir, o.dir, R)).toBeGreaterThan(reach(d.inner, d.outer) + reach(o.inner, o.outer));
      }
    }
  });

  it('changes the ground nowhere but under the dens: heights and surface attributes elsewhere stay as they were', () => {
    const before = padded(params, byTier[0].pads);
    const after = padded(params, top.pads);
    const dens = top.dens.map((d) => {
      const [inner, outer] = [denPads([d])[4], denPads([d])[5]];
      return { dir: new Vector3(...d.dir), reach: reach(inner, outer) };
    });
    const rng = new Random(99);
    const pts: Vector3[] = [];
    // random points, points in and around every site's and city's levelled ground, and points just outside each den's reach
    for (let i = 0; i < 3000; i++) pts.push(new Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)).normalize());
    for (let i = 0; i < byTier[0].pads.length; i += 6) {
      const o = pad(byTier[0].pads, i);
      for (let k = 0; k < 24; k++)
        pts.push(
          o.dir
            .clone()
            .addScaledVector(new Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)), (o.outer * 1.6) / R)
            .normalize(),
        );
    }
    for (const d of top.dens) {
      for (const p of footprintPoints(d, R)) {
        const dir = new Vector3(...d.dir);
        pts.push(dir.clone().addScaledVector(p.clone().sub(dir), 12).normalize());
      }
    }
    let checked = 0;
    const a = [0, 0, 0, 0];
    const b = [0, 0, 0, 0];
    for (const p of pts) {
      if (dens.some((d) => chord(p, d.dir, R) <= d.reach)) continue;
      checked++;
      const sa = { ...before.sample(p.x, p.y, p.z) };
      const sb = { ...after.sample(p.x, p.y, p.z) };
      expect(sb).toEqual(sa);
      expect(surfaceAttribs(after, sb, p.x, p.y, p.z, b)).toEqual(surfaceAttribs(before, sa, p.x, p.y, p.z, a));
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("lays each ambusher's burrow beside its site", () => {
    const sp = sitePads(top.sites);
    for (const d of top.dens.filter((x) => x.role === 'ambusher')) {
      const s = pad(sp, d.site * 6);
      const [inner, outer] = denPads([d]).slice(4);
      const gap = chord(new Vector3(...d.dir), s.dir, R) - reach(inner, outer) - reach(s.inner, s.outer);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(40);
    }
    expect(new Set(top.dens.filter((x) => x.role === 'ambusher').map((d) => d.site)).size).toBe(denCounts(MAX_TIER).ambusher);
  });

  it("puts the apex's lair in a grove: more wooded than most of the world's open ground", () => {
    const apex = top.dens.find((d) => d.role === 'apex')!;
    const sampler = new TerrainSampler(params);
    const forest = (x: number, y: number, z: number) => surfaceAttribs(sampler, sampler.sample(x, y, z), x, y, z, [0, 0, 0, 0])[3];
    const rng = new Random(5);
    const land: number[] = [];
    while (land.length < 300) {
      const p = new Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)).normalize();
      if (sampler.height(p.x, p.y, p.z) > 4) land.push(forest(p.x, p.y, p.z));
    }
    land.sort((x, y) => x - y);
    expect(forest(...apex.dir)).toBeGreaterThan(land[Math.floor(land.length * 0.75)]);
  });

  it('is plain data: the den list round-trips through JSON', () => {
    const copy = JSON.parse(JSON.stringify(top.dens)) as Den[];
    expect(copy).toEqual(top.dens);
    expect(denPads(copy)).toEqual(denPads(top.dens));
  });

  it('plans dens on moons with fauna too', () => {
    const moon = world(21, 'frozen', 24000, 2, true);
    expect(moon.dens.length).toBe(101);
  });

  it('plans on the natural ground only', () => {
    expect(() => planSurface(params, padded(params, top.pads))).toThrow(/natural ground/);
  });
});
