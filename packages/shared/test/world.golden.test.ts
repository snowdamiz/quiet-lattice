// Golden fixtures for seed 424242, first written from the demo's JavaScript before the world code moved here
// (P1.E02.T01; see packages/tools/src/fixtures/world-golden.ts; the systems' orbits, spins, stars, belts and Waystations
// were added in P1.E02.T02). Every value must come out exactly as it did then: the same random draws in the same order
// and the same float arithmetic.
import { describe, expect, it } from 'vitest';
import {
  Galaxy,
  TerrainSampler,
  cosmos,
  describeGalaxySystem,
  layoutCity,
  streetPlan,
  surfaceAttribs,
  type GalaxySystem,
  type PlanetParams,
} from '../src/world/index.ts';
import { asJson, digestArrays, digestString } from './digest.ts';
import { planSurface } from './surface.ts';
import fixture from './fixtures/world-424242.json';

describe('world golden fixtures, seed 424242', () => {
  it('galaxy: names, star classes and positions of all 70 systems', () => {
    const galaxy = new Galaxy(fixture.seed);
    const got = galaxy.systems.map((s) => ({ id: s.id, seed: s.seed, name: s.name, cls: s.cls, x: s.x, y: s.y, z: s.z, color: s.color, lum: s.lum }));
    expect(asJson(got)).toEqual(fixture.galaxy);
    expect(fixture.systems.map((s) => [s.name, s.cls])).toEqual(fixture.galaxy.slice(0, 10).map((s) => [s.name, s.cls]));
  });

  describe.each(fixture.systems)('system $id $name', (sys) => {
    const d = describeGalaxySystem(fixture.galaxy[sys.id] as GalaxySystem);

    it('describeGalaxySystem: its name, star, home world, outer orbit, belt and Waystation', () => {
      const got = { name: d.name, cls: d.star.cls, home: d.home, star: d.star, outerOrbit: d.outerOrbit, belt: d.belt, station: d.station };
      expect(got).toEqual({ name: sys.name, cls: sys.cls, home: sys.home, star: sys.star, outerOrbit: sys.outerOrbit, belt: sys.belt, station: sys.station });
    });

    it('describeGalaxySystem: every body, its type, radius, seed, orbit, spin, gravity, reach, rings and params', () => {
      // (its index is its place in the list; its params are kept as a digest)
      const got = d.bodies.map(({ index, params, ...spec }) => ({ ...spec, paramsDigest: digestString(JSON.stringify(params)) }));
      expect(got).toEqual(sys.bodies.map(({ padsDigest, sites, cities, ...spec }) => spec));
    });

    it('every rocky body described: cities, sites and pads', () => {
      expect(d.bodies.length).toBe(sys.bodies.length);
      d.bodies.forEach((b, i) => {
        const want = sys.bodies[i];
        if (b.type === 'gas') {
          expect({ name: b.name, pads: want.padsDigest, sites: want.sites, cities: want.cities }).toEqual({
            name: want.name,
            pads: null,
            sites: null,
            cities: null,
          });
          return;
        }
        const { bare, params, cities, sites } = planSurface(b.params as PlanetParams);
        expect({ name: b.name, params: digestString(JSON.stringify(bare)) }).toEqual({ name: want.name, params: want.paramsDigest });
        expect({ name: b.name, cities: cities.length, sites: sites.length }).toEqual({ name: want.name, cities: want.cities, sites: want.sites });
        expect({ name: b.name, pads: digestString(JSON.stringify(params.pads)) }).toEqual({ name: want.name, pads: want.padsDigest });
      });
    });
  });

  describe.each(fixture.homes)('home planet $name', (home) => {
    // (described as the game describes it: in a people's home system, system 0 here, with their capital)
    const d = describeGalaxySystem(fixture.galaxy[home.system] as GalaxySystem);
    const { bare, params, sampler, cities, sites } = planSurface(d.bodies[d.home].params as PlanetParams);
    const dirs = fixture.sampleDirections;

    it('params', () => {
      expect(asJson(bare)).toEqual(home.params);
    });

    it('20 terrain heights at fixed directions, with and without the levelled pads', () => {
      expect(dirs.map((d) => sampler.height(d[0], d[1], d[2]))).toEqual(home.heights);
      const raw = new TerrainSampler(bare);
      expect(dirs.map((d) => raw.height(d[0], d[1], d[2]))).toEqual(home.rawHeights);
    });

    it('terrain samples and surface attributes', () => {
      const got = dirs.map((d) => {
        const t = sampler.sample(d[0], d[1], d[2]);
        const fields = { h: t.h, land: t.land, moisture: t.moisture, temp: t.temp, mMask: t.mMask };
        return { ...fields, surface: surfaceAttribs(sampler, t, d[0], d[1], d[2], [0, 0, 0, 0]) };
      });
      expect(asJson(got)).toEqual(home.samples);
    });

    it('site counts, the first sites and the ground levelled under them', () => {
      const byType: Record<string, number> = {};
      for (const s of sites) byType[s.type] = (byType[s.type] ?? 0) + 1;
      expect({ count: sites.length, byType }).toEqual({ count: home.sites.count, byType: home.sites.byType });
      const first = sites.slice(0, 8).map((s) => ({ type: s.type, dir: [s.dir.x, s.dir.y, s.dir.z], base: s.base, relief: s.relief, seed: s.seed }));
      expect(asJson(first)).toEqual(home.sites.first);
      expect(sites.slice(0, 8).map((s) => sampler.height(s.dir.x, s.dir.y, s.dir.z))).toEqual(home.siteHeights);
      expect({ count: params.pads!.length / 6, digest: digestString(JSON.stringify(params.pads)) }).toEqual(home.pads);
    });

    it('cities, their street plans and layouts', () => {
      const got = cities.map((c) => {
        const plan = streetPlan(c);
        const layout = layoutCity(c, plan);
        return {
          name: c.name,
          dir: [c.dir.x, c.dir.y, c.dir.z],
          radius: c.radius,
          base: c.base,
          relief: c.relief,
          seed: c.seed,
          plan,
          buildings: layout.buildings.length,
          hMax: layout.hMax,
          buildingsDigest: digestString(JSON.stringify(layout.buildings)),
        };
      });
      expect(asJson(got)).toEqual(home.cities);
    });
  });

  it('cosmos: field stars, the galaxy, other galaxies, nebulae and the far shell', () => {
    const c = cosmos();
    expect({ count: c.field.count, digest: digestArrays(c.field.pos, c.field.tint, c.field.lum, c.field.size) }).toEqual(fixture.cosmos.field);
    expect({ count: c.stars.count, digest: digestArrays(c.stars.pos, c.stars.col, c.stars.size) }).toEqual(fixture.cosmos.stars);
    expect(asJson(c.galaxies)).toEqual(fixture.cosmos.galaxies);
    expect(asJson(c.nebulae)).toEqual(fixture.cosmos.nebulae);
    expect({ count: c.shell.count, digest: digestArrays(c.shell.dir, c.shell.col) }).toEqual(fixture.cosmos.shell);
  });
});
