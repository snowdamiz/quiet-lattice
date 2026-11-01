// Thermal's passives and ship nodes (DESIGN 9.3; P1.E07.T05) as the systems they name read them: Tempered Core in the meters,
// Focused Lasers and Ablative Plating in the ship's stats, Hot Hands in the mining modifiers. Each test would fail were the
// node's effect taken out of the data.
import { describe, expect, it } from 'vitest';
import { applyStatMods, modsOfNodes } from '../src/combat/index.ts';
import { getSkillNode } from '../src/data/index.ts';
import { dumpHeat, meterProfile, addHeat } from '../src/meters/index.ts';
import { shipStats } from '../src/ships/index.ts';
import type { ShipLoadout } from '../src/ships/index.ts';

const kestrel: ShipLoadout = { hull: 'kestrel', modules: { s1: 'pulse_lasers', m1: 'flak_cannon' }, cargoPods: 1, livery: 0 };
const lark: ShipLoadout = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };

describe('Tempered Core', () => {
  it('raises the heat capacity from 100 to 125, and the meter overheats at the top of it', () => {
    const plain = meterProfile({ ship: lark });
    const tempered = meterProfile({ ship: lark, skills: ['tempered_core'] });
    expect([plain.heatCapacity, plain.overheatAt]).toEqual([100, 100]);
    expect([tempered.heatCapacity, tempered.overheatAt]).toEqual([125, 125]);
    const state = { heat: 100, overheated: false, charge: 100 };
    expect(addHeat(state, plain, 1)).toMatchObject({ ok: true, state: { overheated: true } });
    expect(addHeat(state, tempered, 24)).toMatchObject({ ok: true, state: { heat: 124, overheated: false } });
    expect(addHeat(state, tempered, 25)).toMatchObject({ ok: true, state: { heat: 125, overheated: true } });
  });
});

describe('Focused Lasers', () => {
  it('adds 30% to a laser’s damage and sets its range to 2200 m, and leaves other weapons alone', () => {
    const plain = shipStats(kestrel);
    const focused = shipStats(kestrel, { skills: ['focused_lasers'] });
    expect(plain.hardpoints[0]!.rangeM).toBe(1500);
    expect(focused.hardpoints[0]!.rangeM).toBe(2200);
    expect(focused.hardpoints[0]!.damage).toBeCloseTo(plain.hardpoints[0]!.damage! * 1.3, 9);
    expect(focused.hardpoints[0]!.dps).toBeCloseTo(plain.hardpoints[0]!.dps! * 1.3, 9);
    expect(focused.hardpoints[2]).toEqual(plain.hardpoints[2]);
  });
});

describe('Ablative Plating', () => {
  it('divides re-entry and heat-hazard damage by three, and no other hazard’s', () => {
    const plain = shipStats(lark);
    const plated = shipStats(lark, { skills: ['ablative_plating'] });
    expect(plain.reentryDamage).toBe(1);
    expect(plated.reentryDamage).toBeCloseTo(1 / 3, 12);
    expect(plain.hazardDamage.heat).toBe(1);
    expect(plated.hazardDamage.heat).toBeCloseTo(1 / 3, 12);
    for (const h of ['cryo', 'pressure', 'acid', 'radiation', 'storm'] as const) expect(plated.hazardDamage[h]).toBe(plain.hazardDamage[h]);
  });

  it('stacks with a hull that already resists (the Wayfarer’s half)', () => {
    const wayfarer: ShipLoadout = { hull: 'wayfarer', modules: {}, cargoPods: 1, livery: 0 };
    expect(shipStats(wayfarer, { skills: ['ablative_plating'] }).hazardDamage.heat).toBeCloseTo(1 / 6, 12);
    expect(shipStats(wayfarer, { skills: ['ablative_plating'] }).reentryDamage).toBeCloseTo(1 / 3, 12);
  });
});

describe('Hot Hands', () => {
  it('multiplies mining yield by 1.5 and marks deposits as breaking faster', () => {
    expect(applyStatMods(1, 'mining.yield', modsOfNodes([]))).toBe(1);
    expect(applyStatMods(1, 'mining.yield', modsOfNodes(['hot_hands']))).toBe(1.5);
    expect(getSkillNode('hot_hands').flags).toContain('deposits_break_faster');
  });
});

describe('Vent’s dump', () => {
  it('takes all the heat and says how much, and is refused in the lockout', () => {
    expect(dumpHeat({ heat: 73, overheated: false, charge: 5 })).toEqual({ ok: true, state: { heat: 0, overheated: false, charge: 5 }, events: [], dumped: 73 });
    expect(dumpHeat({ heat: 100, overheated: true, charge: 5 })).toEqual({ ok: false, error: 'overheated' });
  });
});
