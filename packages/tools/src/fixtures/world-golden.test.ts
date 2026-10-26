// The world golden fixture is still written exactly by its generator, and the client's star systems are built from
// describeSystem: every body the description lists, with its orbit, spin and params, planning the surfaces the fixture
// recorded. (describeSystem itself is checked against the fixture in packages/shared/test/world.golden.test.ts.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Galaxy, type BodySpec, type City, type PlanetParams, type Site, type SystemDescription } from '@astra/shared/world';
import { digestString } from '../../../shared/test/digest.ts';
import { withoutPads } from '../../../shared/test/surface.ts';
import { FIXTURE, ROOT, SEED, buildFixture, describeGalaxySystem } from './world-golden.ts';

/** What the test reads off the client's bodies (the client is JavaScript). */
interface Quaternion {
  toArray(): number[];
}
interface ClientBody {
  name: string;
  kind: string;
  index: number;
  parent: ClientBody | null;
  radius: number;
  params: PlanetParams;
  ringSpec: unknown;
  orbitRadius: number;
  orbitPeriod: number;
  orbitPhase: number;
  orbitTilt: Quaternion;
  rotationPeriod: number;
  rotationPhase: number;
  axialTilt: Quaternion;
  gravity: number;
  soi: number;
  sites?: Site[];
  cities?: City[];
}
interface ClientSystem {
  description: SystemDescription;
  name: string;
  starClass: { cls: string };
  star: ClientBody & { color: { getHex(): number } };
  planets: ClientBody[];
  homePlanet: ClientBody;
  outerOrbit: number;
  belt: unknown;
}
interface SolarSystemCtor {
  new (seed: number, pool: unknown, opts: { name: string; homeType?: string; cls: string }): ClientSystem;
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const { SolarSystem } = (await import(pathToFileURL(join(ROOT, 'packages/client/src/universe/SolarSystem.js')).href)) as { SolarSystem: SolarSystemCtor };

describe('world golden fixture', () => {
  it('is regenerated exactly by its generator', () => {
    const built = buildFixture();
    // (the systems first, so a failure points at the bodies rather than the whole file)
    expect(built.systems).toEqual(fixture.systems);
    expect(built).toEqual(fixture);
  }, 60_000);
});

describe('the client builds its star systems from describeSystem', () => {
  // the chunk workers are not needed to plan a world: only registerPlanet is called while one is built
  const pool = { registerPlanet() {}, forgetPlanet() {}, request: () => ({}), cancel() {} };
  const galaxy = new Galaxy(SEED);

  it.each(galaxy.systems.slice(0, 10))('system $id $name', (info) => {
    const d = describeGalaxySystem(info);
    const homeType = info.id === 0 ? 'lush' : undefined;
    const sys = new SolarSystem(info.seed, pool, { name: info.name, homeType, cls: info.cls });
    // its description is the one shared makes, and building the planets left it as it was
    expect(sys.description).toStrictEqual(d);

    expect({ name: sys.name, cls: sys.starClass.cls, home: sys.planets.indexOf(sys.homePlanet), outerOrbit: sys.outerOrbit, belt: sys.belt }).toEqual({
      name: d.name,
      cls: d.star.cls,
      home: d.home,
      outerOrbit: d.outerOrbit,
      belt: d.belt,
    });
    expect({ radius: sys.star.radius, color: sys.star.color.getHex() }).toEqual({ radius: d.star.radius, color: d.star.color });

    const built = sys.planets.map((p) => ({
      name: p.name,
      kind: p.kind,
      type: p.params.type,
      radius: p.radius,
      slot: p.index,
      parent: p.parent === sys.star ? null : sys.planets.indexOf(p.parent!),
      orbitRadius: p.orbitRadius,
      orbitPeriod: p.orbitPeriod,
      orbitPhase: p.orbitPhase,
      orbitTilt: p.orbitTilt.toArray(),
      rotationPeriod: p.rotationPeriod,
      rotationPhase: p.rotationPhase,
      axialTilt: p.axialTilt.toArray(),
      gravity: p.gravity,
      soi: p.soi,
      rings: p.ringSpec,
      params: withoutPads(p.params),
    }));
    // (all but its index, which is its place in the list, and its seed, which is in its params)
    const spec = (b: BodySpec) => {
      const { index, seed, ...rest } = b;
      return rest;
    };
    expect(built).toEqual(d.bodies.map(spec));

    // and its rocky worlds plan the surfaces the fixture recorded
    const surfaces = sys.planets.map((p) => ({
      name: p.name,
      paramsDigest: p.cities ? digestString(JSON.stringify(withoutPads(p.params))) : null,
      padsDigest: p.cities ? digestString(JSON.stringify(p.params.pads)) : null,
      sites: p.sites ? p.sites.length : null,
      cities: p.cities ? p.cities.length : null,
    }));
    const want = fixture.systems[info.id].bodies.map(
      (b: { name: string; paramsDigest: string | null; padsDigest: string | null; sites: number | null; cities: number | null }) => ({
        name: b.name,
        paramsDigest: b.paramsDigest,
        padsDigest: b.padsDigest,
        sites: b.sites,
        cities: b.cities,
      }),
    );
    expect(surfaces).toEqual(want);
  });
});
