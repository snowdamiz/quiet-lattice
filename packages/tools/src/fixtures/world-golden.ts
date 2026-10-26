// The world-generation golden fixture (packages/shared/test/fixtures/world-424242.json) for seed 424242: the galaxy's
// 70 systems; for systems 0–9 the star, outer orbit, belt and Waystation, and every body the client's SolarSystem builds
// (name, kind, type, radius, seed, orbit, spin, gravity, reach, rings, digests of its params and pads, site and city
// counts); for each home planet its full params, cities, sites, 20 terrain samples at fixed directions and a digest of its
// pads; and the cosmos (digests of the star fields, the other galaxies and nebulae).
//
// The fixture was first written from the demo's original JavaScript, before the world code moved to @astra/shared
// (P1.E02.T01). Since P1.E02.T02 it is written from describeGalaxySystem and the shared planners, as the client's
// SolarSystem and Planet use them; the orbits, spins, star, belt and Waystation were added then, from the shared code
// after it was checked equal to the demo's on hundreds of systems; gas giants' params digests were added too.
// packages/shared/test/world.golden.test.ts checks the shared code against it, and world-golden.test.ts here checks
// that this script still writes it and that the client builds the systems described. Regenerate it only for a deliberate change to the generated world, and say so in the commit:
//   pnpm exec tsx packages/tools/src/fixtures/world-golden.ts [out.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { Galaxy, TerrainSampler, cosmos, describeGalaxySystem, layoutCity, streetPlan, surfaceAttribs, type PlanetParams } from '@astra/shared/world';
import { asJson, digestArrays, digestString } from '../../../shared/test/digest.ts';
import { planSurface } from '../../../shared/test/surface.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const FIXTURE = join(ROOT, 'packages/shared/test/fixtures/world-424242.json');
export const SEED = 424242;

/** 20 directions spread over the sphere (a Fibonacci lattice); the fixture keeps them, and the tests read them back. */
function sampleDirections(n = 20): [number, number, number][] {
  const out: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) * 2) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(i * golden) * r, y, Math.sin(i * golden) * r]);
  }
  return out;
}

export function buildFixture() {
  const galaxy = new Galaxy(SEED);
  const dirs = sampleDirections();
  const systems = [];
  const homes = [];
  for (const info of galaxy.systems.slice(0, 10)) {
    const sys = describeGalaxySystem(info);
    // each rocky world's surface, planned as the client's Planet plans it
    const surfaces = sys.bodies.map((b) => (b.type === 'gas' ? null : planSurface(b.params as PlanetParams)));
    // every body as described (its params as a digest; its index is its place in the list), then its surface
    const bodies = sys.bodies.map(({ index, params, ...spec }) => {
      const s = surfaces[index];
      return {
        ...spec,
        paramsDigest: digestString(JSON.stringify(params)),
        padsDigest: s ? digestString(JSON.stringify(s.params.pads)) : null,
        sites: s ? s.sites.length : null,
        cities: s ? s.cities.length : null,
      };
    });
    const { star, outerOrbit, belt, station } = sys;
    systems.push({ id: info.id, name: sys.name, cls: info.cls, home: sys.home, star, outerOrbit, belt, station, bodies });

    const h = sys.bodies[sys.home];
    const { params: p, bare, sampler, sites, cities } = surfaces[sys.home]!;
    const raw = new TerrainSampler(bare);
    const sample = (d: number[]) => {
      const t = sampler.sample(d[0], d[1], d[2]);
      const fields = { h: t.h, land: t.land, moisture: t.moisture, temp: t.temp, mMask: t.mMask };
      return { ...fields, surface: surfaceAttribs(sampler, t, d[0], d[1], d[2], [0, 0, 0, 0]) };
    };
    const byType: Record<string, number> = {};
    for (const s of sites) byType[s.type] = (byType[s.type] ?? 0) + 1;
    homes.push({
      system: info.id,
      name: h.name,
      type: p.type,
      radius: h.radius,
      params: bare,
      cities: cities.map((c) => {
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
      }),
      sites: {
        count: sites.length,
        byType,
        first: sites.slice(0, 8).map((s) => ({ type: s.type, dir: [s.dir.x, s.dir.y, s.dir.z], base: s.base, relief: s.relief, seed: s.seed })),
      },
      pads: { count: p.pads!.length / 6, digest: digestString(JSON.stringify(p.pads)) },
      heights: dirs.map((d) => sampler.height(d[0], d[1], d[2])),
      rawHeights: dirs.map((d) => raw.height(d[0], d[1], d[2])),
      samples: dirs.map(sample),
      // on the levelled ground of the first sites
      siteHeights: sites.slice(0, 8).map((s) => sampler.height(s.dir.x, s.dir.y, s.dir.z)),
    });
  }

  const c = cosmos();
  return asJson({
    seed: SEED,
    sampleDirections: dirs,
    galaxy: galaxy.systems.map((s) => ({ id: s.id, seed: s.seed, name: s.name, cls: s.cls, x: s.x, y: s.y, z: s.z, color: s.color, lum: s.lum })),
    systems,
    homes,
    cosmos: {
      field: { count: c.field.count, digest: digestArrays(c.field.pos, c.field.tint, c.field.lum, c.field.size) },
      stars: { count: c.stars.count, digest: digestArrays(c.stars.pos, c.stars.col, c.stars.size) },
      galaxies: c.galaxies,
      nebulae: c.nebulae,
      shell: { count: c.shell.count, digest: digestArrays(c.shell.dir, c.shell.col) },
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? FIXTURE;
  mkdirSync(dirname(out), { recursive: true });
  // (formatted as the repository formats the fixture, wherever this copy is written)
  const options = (await prettier.resolveConfig(FIXTURE)) ?? {};
  writeFileSync(out, await prettier.format(JSON.stringify(buildFixture()), { ...options, filepath: FIXTURE }));
  console.log(`wrote ${out}`);
}
