// The world-generation golden fixture (packages/shared/test/fixtures/world-424242.json) for seed 424242: the galaxy's
// 70 systems; for systems 0–9 every body the client's SolarSystem builds (name, kind, type, radius, seed, digests of its
// params and pads, site and city counts); for each home planet its full params, cities, sites, 20 terrain samples at
// fixed directions and a digest of its pads; and the cosmos (digests of the star fields, the other galaxies and nebulae).
//
// The fixture was first written from the demo's original JavaScript, before the world code moved to @astra/shared
// (P1.E02.T01). packages/shared/test/world.golden.test.ts checks the shared code against it, and world-golden.test.ts
// here checks that the client still builds the same systems. Regenerate it only for a deliberate change to the
// generated world, and say so in the commit:
//   pnpm exec tsx packages/tools/src/fixtures/world-golden.ts [out.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { Galaxy, TerrainSampler, cosmos, layoutCity, streetPlan, surfaceAttribs, type City, type PlanetParams, type Site } from '@astra/shared/world';
import { asJson, digestArrays, digestString } from '../../../shared/test/digest.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const FIXTURE = join(ROOT, 'packages/shared/test/fixtures/world-424242.json');
const SEED = 424242;

/** What the fixture reads off the client's bodies (the client is JavaScript). */
interface Body {
  name: string;
  kind: string;
  radius: number;
  params: PlanetParams;
  sampler?: TerrainSampler;
  sites?: Site[];
  cities?: City[];
}
interface SolarSystemCtor {
  new (seed: number, pool: unknown, opts: { name: string; homeType?: string; cls: string }): { name: string; planets: Body[]; homePlanet: Body };
}

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

const withoutPads = (p: PlanetParams): PlanetParams => {
  const rest = { ...p };
  delete rest.pads;
  return rest;
};

export async function buildFixture() {
  const solar = pathToFileURL(join(ROOT, 'packages/client/src/universe/SolarSystem.js')).href;
  const { SolarSystem } = (await import(solar)) as { SolarSystem: SolarSystemCtor };
  // the chunk workers are not needed to plan a world: only registerPlanet is called while one is built
  const pool = { registerPlanet() {}, forgetPlanet() {}, request: () => ({}), cancel() {} };

  const galaxy = new Galaxy(SEED);
  const dirs = sampleDirections();
  const systems = [];
  const homes = [];
  for (const info of galaxy.systems.slice(0, 10)) {
    const homeType = info.id === 0 ? 'lush' : undefined;
    const sys = new SolarSystem(info.seed, pool, { name: info.name, homeType, cls: info.cls });
    const bodies = sys.planets.map((b) => ({
      name: b.name,
      kind: b.kind,
      type: b.params.type,
      radius: b.radius,
      seed: b.params.seed,
      paramsDigest: b.sampler ? digestString(JSON.stringify(withoutPads(b.params))) : null,
      padsDigest: b.sampler ? digestString(JSON.stringify(b.params.pads)) : null,
      sites: b.sites ? b.sites.length : null,
      cities: b.cities ? b.cities.length : null,
    }));
    systems.push({ id: info.id, name: sys.name, cls: info.cls, home: sys.planets.indexOf(sys.homePlanet), bodies });

    const h = sys.homePlanet;
    const p = h.params;
    const sampler = h.sampler!;
    const raw = new TerrainSampler(withoutPads(p));
    const sample = (d: number[]) => {
      const t = sampler.sample(d[0], d[1], d[2]);
      const fields = { h: t.h, land: t.land, moisture: t.moisture, temp: t.temp, mMask: t.mMask };
      return { ...fields, surface: surfaceAttribs(sampler, t, d[0], d[1], d[2], [0, 0, 0, 0]) };
    };
    const byType: Record<string, number> = {};
    for (const s of h.sites!) byType[s.type] = (byType[s.type] ?? 0) + 1;
    homes.push({
      system: info.id,
      name: h.name,
      type: p.type,
      radius: h.radius,
      params: withoutPads(p),
      cities: h.cities!.map((c) => {
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
        count: h.sites!.length,
        byType,
        first: h.sites!.slice(0, 8).map((s) => ({ type: s.type, dir: [s.dir.x, s.dir.y, s.dir.z], base: s.base, relief: s.relief, seed: s.seed })),
      },
      pads: { count: p.pads!.length / 6, digest: digestString(JSON.stringify(p.pads)) },
      heights: dirs.map((d) => sampler.height(d[0], d[1], d[2])),
      rawHeights: dirs.map((d) => raw.height(d[0], d[1], d[2])),
      samples: dirs.map(sample),
      // on the levelled ground of the first sites
      siteHeights: h.sites!.slice(0, 8).map((s) => sampler.height(s.dir.x, s.dir.y, s.dir.z)),
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
  writeFileSync(out, await prettier.format(JSON.stringify(await buildFixture()), { ...options, filepath: FIXTURE }));
  console.log(`wrote ${out}`);
}
