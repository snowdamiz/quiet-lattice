// describeSystem: a star system as plain data (the golden fixtures in world.golden.test.ts pin its values).
import { describe, expect, it } from 'vitest';
import { FrameId } from '../src/protocol/index.ts';
import { Galaxy, PLANET_TYPES, STATION, describeSystem, frameId, hashInts, type SystemDescription } from '../src/world/index.ts';

const galaxy = new Galaxy(424242);
/** Systems 0–9 of the fixture's galaxy as the client asks for them, then systems from bare seeds. */
const SYSTEMS: SystemDescription[] = [
  ...galaxy.systems.slice(0, 10).map((s) => describeSystem(s.seed, { name: s.name, cls: s.cls, homeType: s.id === 0 ? 'lush' : undefined })),
  ...Array.from({ length: 30 }, (_, i) => describeSystem(hashInts(7, i))),
];

/** Every value in `v` that is not a number, string, boolean, null, plain array or plain object, by path. */
function notPlain(v: unknown, path = 'description'): string[] {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return [];
  if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0) ? [] : [`${path} = ${Object.is(v, -0) ? '-0' : v}`];
  if (Array.isArray(v)) return v.flatMap((x, i) => notPlain(x, `${path}[${i}]`));
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.entries(v).flatMap(([k, x]) => notPlain(x, `${path}.${k}`));
  return [`${path}: ${typeof v === 'object' ? Object.prototype.toString.call(v) : typeof v}`];
}

describe('describeSystem', () => {
  it('is plain data that round-trips through JSON unchanged', () => {
    for (const d of SYSTEMS) {
      expect(notPlain(d)).toEqual([]);
      expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
    }
  });

  it('is the same every time for the same seed and options', () => {
    const s = galaxy.systems[3];
    expect(describeSystem(s.seed, { name: s.name, cls: s.cls })).toStrictEqual(SYSTEMS[3]);
    expect(describeSystem(hashInts(7, 0))).toStrictEqual(SYSTEMS[10]);
  });

  it('lists each planet and then its moons, innermost first, with indices that are frame ids', () => {
    for (const d of SYSTEMS) {
      let slot = 0;
      d.bodies.forEach((b, i) => {
        expect(b.index).toBe(i);
        expect(FrameId.safeParse(frameId(d.seed, i)).success).toBe(true);
        if (b.kind === 'planet') {
          expect(b.parent).toBeNull();
          expect(b.slot).toBe(slot++);
          if (b.slot > 0) expect(b.orbitRadius).toBeGreaterThan(d.bodies.findLast((p, j) => j < i && p.kind === 'planet')!.orbitRadius);
        } else {
          // a moon follows its planet and the moons before it
          const parent = d.bodies[b.parent!];
          expect(parent.kind).toBe('planet');
          expect(d.bodies.slice(b.parent! + 1, i).every((m) => m.kind === 'moon' && m.parent === b.parent)).toBe(true);
          expect(b.slot).toBe(i - b.parent! - 1);
          expect(b.name).toBe(`${parent.name}-${String.fromCharCode(97 + b.slot)}`);
          expect(b.orbitRadius + b.radius).toBeLessThan(parent.soi);
        }
      });
      expect(d.bodies.filter((b) => b.kind === 'planet').length).toBeGreaterThanOrEqual(5);
      expect(d.bodies.filter((b) => b.kind === 'planet').length).toBeLessThanOrEqual(7);
      expect(d.outerOrbit).toBeGreaterThan(Math.max(...d.bodies.map((b) => b.orbitRadius)));
    }
  });

  it('gives every body its own params, orbit and spin', () => {
    for (const d of SYSTEMS) {
      for (const b of d.bodies) {
        expect({ seed: b.params.seed, type: b.params.type, radius: b.params.radius }).toEqual({ seed: b.seed, type: b.type, radius: b.radius });
        expect(b.orbitPeriod).toBeGreaterThan(0);
        expect(b.rotationPeriod).toBeGreaterThan(0);
        for (const q of [b.orbitTilt, b.axialTilt]) expect(Math.hypot(...q)).toBeCloseTo(1, 12);
        if (b.kind === 'moon') expect(b.rotationPeriod).toBe(b.orbitPeriod);
        if (b.rings) expect(b.type).toBe('gas');
      }
    }
  });

  it('puts the Waystation in low orbit round the home world, with its own frame id', () => {
    for (const d of SYSTEMS) {
      const home = d.bodies[d.home];
      expect(home.kind).toBe('planet');
      expect(home.type).not.toBe('gas');
      expect(d.station).toEqual({
        name: `${d.name} Waystation`,
        parent: d.home,
        radius: STATION.radius,
        orbitRadius: home.radius + STATION.altitude,
        orbitPeriod: STATION.orbitPeriod,
        orbitPhase: STATION.orbitPhase,
        orbitTilt: [0, 0, 0, 1],
        soi: STATION.soi,
        seed: d.seed,
      });
      expect(FrameId.safeParse(frameId(d.seed, 'station')).success).toBe(true);
    }
  });

  it('takes the galaxy’s name and star class, and makes the rest of the system the same with or without the class', () => {
    const seed = hashInts(7, 1);
    const own = describeSystem(seed);
    expect(own.name).toMatch(/^[A-Z][a-z]+$/);
    for (const cls of ['G', 'K', 'M', 'F', 'B', 'E'] as const) {
      const d = describeSystem(seed, { cls });
      expect(d.star.cls).toBe(cls);
      expect({ ...d, star: null }).toStrictEqual({ ...own, star: null });
      expect(d.star.radius).toBe(own.star.radius);
    }
    expect(describeSystem(seed, { name: 'Tessaly' }).name).toBe('Tessaly');
    expect(describeSystem(seed, { name: 'Tessaly' }).bodies[0].name).toBe('Tessaly I');
  });

  it('forces the home world’s type and changes nothing else', () => {
    const seed = hashInts(7, 2);
    const own = describeSystem(seed);
    for (const type of PLANET_TYPES) {
      const d = describeSystem(seed, { homeType: type });
      expect(d.bodies[d.home].type).toBe(type);
      expect(d.bodies[d.home].params.type).toBe(type);
      const rest = (s: SystemDescription) => ({ ...s, bodies: s.bodies.filter((b) => b.index !== s.home) });
      expect(rest(d)).toStrictEqual(rest(own));
    }
  });
});

describe('frameId', () => {
  it('names bodies and the Waystation as the protocol expects', () => {
    expect(frameId(2981198913, 0)).toBe('2981198913:0');
    expect(frameId(0, 12)).toBe('0:12');
    expect(frameId(0xffffffff, 'station')).toBe('4294967295:station');
  });

  it('refuses what is not a 32-bit seed or a body index', () => {
    expect(() => frameId(-1, 0)).toThrow(RangeError);
    expect(() => frameId(2 ** 32, 0)).toThrow(RangeError);
    expect(() => frameId(1.5, 0)).toThrow(RangeError);
    expect(() => frameId(1, -1)).toThrow(RangeError);
    expect(() => frameId(1, 0.5)).toThrow(RangeError);
  });
});
