import { describe, expect, it } from 'vitest';
import { hazardDamagePerS, hazardDepth, reentryDamagePerS, reentryIntensity, shipStats, type ShipLoadout } from '../src/ships/index.ts';

const LARK: ShipLoadout = { hull: 'lark', modules: {}, cargoPods: 1, livery: 0 };

describe('shared ship hazard rates', () => {
  it.each([
    ['heat', 'thermal_plating'],
    ['cryo', 'thermal_plating'],
    ['pressure', 'pressure_hull'],
    ['acid', 'hazard_coating'],
    ['radiation', 'hazard_coating'],
    ['storm', 'hazard_coating'],
  ] as const)('%s damage is divided by three by %s, at the actual altitude depth', (kind, plating) => {
    const hazard = { kind, ceiling: 1000, dps: 12, curve: 2 };
    const depth = hazardDepth(hazard, 500);
    expect(hazardDamagePerS(hazard, depth, shipStats(LARK))).toBe(3);
    expect(hazardDamagePerS(hazard, depth, shipStats(LARK, { skills: [plating] }))).toBe(1);
    expect(hazardDamagePerS(hazard, hazardDepth(hazard, 1000), shipStats(LARK))).toBe(0);
  });

  it('Ablative Plating protects heat and re-entry independently, and stacks with Thermal Plating on heat alone', () => {
    const hazard = { kind: 'heat' as const, dps: 18, curve: 1 };
    const ablative = shipStats(LARK, { skills: ['ablative_plating'] });
    const thermal = shipStats(LARK, { skills: ['thermal_plating'] });
    const both = shipStats(LARK, { skills: ['ablative_plating', 'thermal_plating'] });
    expect(hazardDamagePerS(hazard, 1, ablative)).toBe(6);
    expect(hazardDamagePerS(hazard, 1, both)).toBe(2);
    expect(reentryDamagePerS(1, shipStats(LARK))).toBe(20);
    expect(reentryDamagePerS(1, thermal)).toBe(20);
    expect(reentryDamagePerS(1, ablative)).toBeCloseTo(20 / 3, 12);
    expect(reentryDamagePerS(1, both)).toBeCloseTo(20 / 3, 12);
  });

  it('requires air, sufficient speed and descent; an ordinary climb and slow flight do not burn', () => {
    expect(reentryIntensity(1, 1100, 1)).toBe(1);
    expect(reentryIntensity(0, 1600, 1)).toBe(0);
    expect(reentryIntensity(1, 600, 1)).toBe(0);
    expect(reentryIntensity(1, 1600, -1)).toBe(0);
    expect(reentryIntensity(0.01, 900, 0)).toBeGreaterThan(0);
    expect(reentryIntensity(0.01, 900, 0)).toBeLessThan(1);
  });
});
