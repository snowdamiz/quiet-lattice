import { describe, expect, it } from 'vitest';
import { PLANET_TYPES, archetype, createPlanetParams, cubeToSphere, linearToHex, sphereToCube } from './planetgen.ts';
import { Random } from './rng.ts';

describe('cube sphere', () => {
  it('cubeToSphere lands on the unit sphere and sphereToCube inverts it on every face', () => {
    const rng = new Random(11);
    const p = [0, 0, 0];
    for (let face = 0; face < 6; face++) {
      for (let i = 0; i < 200; i++) {
        const u = rng.float(-0.98, 0.98);
        const v = rng.float(-0.98, 0.98);
        cubeToSphere(face, u, v, p);
        expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 12);
        const c = sphereToCube(p[0], p[1], p[2], {});
        expect(c.face).toBe(face);
        expect(c.u).toBeCloseTo(u, 6);
        expect(c.v).toBeCloseTo(v, 6);
      }
    }
  });
});

describe('planet params', () => {
  it('are a pure function of seed, type and radius', () => {
    for (const type of PLANET_TYPES) {
      expect(createPlanetParams(1234, type, 90000)).toEqual(createPlanetParams(1234, type, 90000));
    }
  });

  it('moons never have cities; hostile archetypes always carry their hazard', () => {
    for (let seed = 1; seed < 60; seed++) expect(createPlanetParams(seed, 'lush', 30000, { isMoon: true }).cityCount).toBe(0);
    expect(createPlanetParams(5, 'inferno', 90000).hazard?.kind).toBe('heat');
    expect(archetype('barren').sky).toBeNull();
  });

  it('linearToHex undoes the sRGB-to-linear conversion of an unjittered colour', () => {
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const hex = 0x5e843f;
    const rgb: [number, number, number] = [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
    expect(linearToHex(rgb)).toBe(hex);
  });
});
