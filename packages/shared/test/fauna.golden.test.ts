// Golden species per world for systems 0, 1, 2 and 59 at seed 424242 (P1.E08.T01; written by fauna-fixture.ts). Every
// species must come out exactly as written, at every tier: the same draws in the same order and the same arithmetic,
// so the server and every client name the same creatures.
import { describe, expect, it } from 'vitest';
import { FAUNA_MAX_TIER, GALAXY_SEED, Galaxy, describeGalaxySystem, faunaSpecies, type PlanetParams } from '../src/world/index.ts';
import { FAUNA_SYSTEMS, buildFaunaFixture } from './fauna-fixture.ts';
import fixture from './fixtures/fauna-424242.json';

const galaxy = new Galaxy(GALAXY_SEED);
const params = (system: number, body: number) => describeGalaxySystem(galaxy.systems[system]).bodies[body].params as PlanetParams;

describe('fauna golden fixture, seed 424242', () => {
  it('covers every rocky world of its systems, and the generator still writes it', () => {
    expect(fixture.seed).toBe(GALAXY_SEED);
    expect(fixture.maxTier).toBe(FAUNA_MAX_TIER);
    expect([...new Set(fixture.worlds.map((w) => w.system))]).toEqual(FAUNA_SYSTEMS);
    expect(buildFaunaFixture()).toEqual(fixture);
  });

  it('has worlds with fauna and worlds without, and hostile species from Tier 1', () => {
    const living = fixture.worlds.filter((w) => w.species.length);
    expect(living.length).toBeGreaterThan(10);
    expect(fixture.worlds.length - living.length).toBeGreaterThan(5);
    for (const w of living) expect(w.species.some((s) => s.tier > 0)).toBe(true);
  });

  describe.each(fixture.worlds.filter((w) => w.species.length))('$name (system $system, body $body)', (w) => {
    it('gives, at every tier, the fixture’s species from that tier down', () => {
      for (let tier = 0; tier <= 5; tier++) {
        expect(faunaSpecies(params(w.system, w.body), tier)).toEqual(w.species.filter((s) => s.tier <= tier));
      }
    });
  });
});
