// The world golden fixture is still written exactly by its generator, and the client's star systems, built from
// describeGalaxySystem, come out as the fixture records them: every body with its orbit, spin, gravity, reach, rings and
// params, planning the same surfaces. (describeGalaxySystem itself is checked against the fixture in
// packages/shared/test/world.golden.test.ts.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Galaxy, describeGalaxySystem, type City, type PlanetParams, type Site, type SystemDescription } from '@astra/shared/world';
import { digestString } from '../../../shared/test/digest.ts';
import { withoutPads } from '../../../shared/test/surface.ts';
import { FIXTURE, ROOT, SEED, buildFixture } from './world-golden.ts';

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
  new (description: SystemDescription, pool: unknown): ClientSystem;
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

describe('the client builds its star systems as the fixture records them', () => {
  // the chunk workers are not needed to plan a world: only registerPlanet is called while one is built
  const pool = { registerPlanet() {}, forgetPlanet() {}, request: () => ({}), cancel() {} };
  const galaxy = new Galaxy(SEED);

  it.each(galaxy.systems.slice(0, 10))('system $id $name', (info) => {
    const want = fixture.systems[info.id];
    const sys = new SolarSystem(describeGalaxySystem(info), pool);
    // building the planets left the description as it was
    expect(sys.description).toStrictEqual(describeGalaxySystem(info));

    const { star } = sys;
    expect({ name: sys.name, cls: sys.starClass.cls, home: sys.planets.indexOf(sys.homePlanet), outerOrbit: sys.outerOrbit, belt: sys.belt }).toEqual({
      name: want.name,
      cls: want.cls,
      home: want.home,
      outerOrbit: want.outerOrbit,
      belt: want.belt,
    });
    expect({ name: star.name, radius: star.radius, color: star.color.getHex() }).toEqual({
      name: want.star.name,
      radius: want.star.radius,
      color: want.star.color,
    });

    const bodies = sys.planets.map((p) => ({
      slot: p.index,
      name: p.name,
      kind: p.kind,
      type: p.params.type,
      radius: p.radius,
      seed: p.params.seed,
      parent: p.parent === star ? null : sys.planets.indexOf(p.parent!),
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
      paramsDigest: digestString(JSON.stringify(withoutPads(p.params))),
      // and its rocky worlds plan the surfaces the fixture recorded
      padsDigest: p.cities ? digestString(JSON.stringify(p.params.pads)) : null,
      sites: p.sites ? p.sites.length : null,
      cities: p.cities ? p.cities.length : null,
    }));
    expect(bodies).toEqual(want.bodies);
  });
});
