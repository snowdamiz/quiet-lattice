// Resistances by branch and the damage pipeline (DESIGN 12.1), and the modifiers it reads (Dense Bones, Second Skin,
// Grey Blood, Brand, Anchor, the Acidsalt catalyst).
import { describe, expect, it } from 'vitest';
import { BOSSES, COMBAT, CRYSTAL_RESISTANCES, HOLLOW_RESISTANCES, MOBS, SENTINEL_RESISTANCES, getItem, getMob } from '../../src/data/index.ts';
import type { Resistance, StatMod } from '../../src/data/index.ts';
import { applyStatMods, computeDamage, isHollow, modsOfNodes, playerMaxHealth, resistanceTo } from '../../src/combat/index.ts';

const hit = (base: number, node: string, resistances: readonly Resistance[], extra: { augments?: string[]; hollow?: boolean } = {}) =>
  computeDamage({ base, source: { node, augments: extra.augments }, target: { resistances, hollow: extra.hollow } }).amount;

describe('resistances by branch (DESIGN 12.1)', () => {
  it('uses the chosen multipliers', () => {
    expect(COMBAT.resistMult).toEqual({ resist: 0.5, weak: 2, immune: 0 });
  });

  it('crystal creatures take half Thermal and double Shatter', () => {
    for (const node of ['lance', 'flare', 'sear', 'corona']) expect(hit(100, node, CRYSTAL_RESISTANCES)).toBe(50);
    expect(hit(100, 'shatter', CRYSTAL_RESISTANCES)).toBe(200);
    expect(hit(100, 'pulse', CRYSTAL_RESISTANCES)).toBe(100);
    expect(hit(100, 'unmake', CRYSTAL_RESISTANCES)).toBe(100);
    expect(resistanceTo(CRYSTAL_RESISTANCES, { node: 'lance' })).toEqual({ multiplier: 0.5, effect: 'resist', immune: false, reactions: [] });
  });

  it('never stacks: Shatter on a crystal stalker (weak to Shatter and to Resonance) is ×2, not ×4', () => {
    const stalker = getMob('crystal_stalker').resistances;
    expect(hit(100, 'shatter', stalker)).toBe(200);
    expect(hit(100, 'pulse', stalker)).toBe(200);
    expect(hit(100, 'lance', stalker)).toBe(50);
  });

  it('the Hollow are immune to Spore unless the caster has Rot, which then triples it', () => {
    const spore = resistanceTo(HOLLOW_RESISTANCES, { node: 'spore' });
    expect(spore.immune).toBe(true);
    expect(spore.effect).toBe('immune');
    expect(hit(40, 'spore', HOLLOW_RESISTANCES, { hollow: true })).toBe(0);
    expect(resistanceTo(HOLLOW_RESISTANCES, { node: 'spore', augments: ['rot'] }).immune).toBe(false);
    expect(hit(40, 'spore', HOLLOW_RESISTANCES, { hollow: true, augments: ['rot'] })).toBe(120);
    // Rot is Spore's augment only, and only against the Hollow
    expect(hit(40, 'lance', HOLLOW_RESISTANCES, { hollow: true, augments: ['rot'] })).toBe(40);
    expect(hit(40, 'spore', [], { augments: ['rot'] })).toBe(40);
  });

  it('the Hollow flee Nullsong', () => {
    expect(resistanceTo(HOLLOW_RESISTANCES, { node: 'nullsong' })).toEqual({ multiplier: 1, effect: null, immune: false, reactions: ['flee'] });
  });

  it('sentinels and Wardens shrug Gravitic pulls and are stalled by Dissonance', () => {
    for (const resistances of [SENTINEL_RESISTANCES, getMob('monolith_sentinel').resistances, BOSSES.find((b) => b.id === 'wardens')?.resistances ?? []]) {
      for (const node of ['pull', 'well', 'slam', 'crush', 'singularity']) expect(resistanceTo(resistances, { node }).immune).toBe(true);
      expect(resistanceTo(resistances, { node: 'dissonance' })).toEqual({ multiplier: 1, effect: null, immune: false, reactions: ['stall'] });
      expect(hit(100, 'lance', resistances)).toBe(100);
    }
  });

  it('pirates are people: no resistances', () => {
    const pirates = getMob('pirate_crew').resistances;
    for (const node of ['lance', 'shatter', 'spore', 'pull', 'dissonance', 'nullsong'])
      expect(resistanceTo(pirates, { node })).toEqual({ multiplier: 1, effect: null, immune: false, reactions: [] });
  });

  it('matches weapons and reports behaviour effects (EMP and Shatter disable drones)', () => {
    const drone = getMob('outpost_drone').resistances;
    expect(resistanceTo(drone, { weapon: 'emp_pod' }).reactions).toEqual(['disabled_by']);
    expect(resistanceTo(drone, { node: 'shatter' }).reactions).toEqual(['disabled_by']);
    expect(resistanceTo(drone, { weapon: 'railgun' }).reactions).toEqual([]);
    expect(resistanceTo(getMob('stone_touched').resistances, { node: 'veil' }).reactions).toEqual(['hidden_by']);
    expect(resistanceTo(getMob('stone_touched').resistances, { node: 'harmonic' }).immune).toBe(true);
  });

  it('lets the most specific entry decide: node, then weapon, then branch; the lowest multiplier at a tie', () => {
    const custom: Resistance[] = [
      { kind: 'branch', id: 'thermal', effect: 'resist' },
      { kind: 'node', id: 'flare', effect: 'weak' },
      { kind: 'node', id: 'sear', effect: 'weak' },
      { kind: 'node', id: 'sear', effect: 'immune' },
    ];
    expect(resistanceTo(custom, { node: 'flare' }).multiplier).toBe(2);
    expect(resistanceTo(custom, { node: 'lance' }).multiplier).toBe(0.5);
    expect(resistanceTo(custom, { node: 'sear' }).multiplier).toBe(0);
    expect(resistanceTo(custom, { branch: 'thermal' }).multiplier).toBe(0.5);
    expect(resistanceTo(custom, {}).multiplier).toBe(1);
    expect(resistanceTo([{ kind: 'weapon', id: 'railgun', effect: 'resist' }], { weapon: 'railgun' }).multiplier).toBe(0.5);
  });

  it('throws on an unknown node', () => {
    expect(() => resistanceTo(CRYSTAL_RESISTANCES, { node: 'fireball' })).toThrow(/skill node/);
  });

  it('knows the Hollow by their resistances', () => {
    const hollow = MOBS.filter((m) => isHollow(m.resistances)).map((m) => m.id);
    expect(hollow).toEqual(['hollow_drifter', 'hollow_swarm', 'hollow_husk']);
    const bosses = BOSSES.filter((b) => isHollow(b.resistances)).map((b) => b.id);
    expect(bosses).toEqual(['dreadnought', 'hive_heart', 'husk_admiral']);
    expect(isHollow(getMob('stone_touched').resistances)).toBe(false); // they flee Nullsong too, but take Spore
  });
});

describe('the damage pipeline', () => {
  it('scales the base by level, then applies resistance', () => {
    const r = computeDamage({ base: 25, level: 10, target: { resistances: CRYSTAL_RESISTANCES }, source: { node: 'flare' } });
    expect(r.scaled).toBeCloseTo(55, 9);
    expect(r.amount).toBeCloseTo(27.5, 9);
    expect(computeDamage({ base: 25 }).amount).toBe(25);
  });

  it("applies Brand's +25% and Anchor's −40% from the nodes' data, each once", () => {
    expect(computeDamage({ base: 100, target: { effects: ['brand'] } }).amount).toBeCloseTo(125, 9);
    expect(computeDamage({ base: 100, target: { effects: ['anchor'] } }).amount).toBeCloseTo(60, 9);
    expect(computeDamage({ base: 100, target: { effects: ['brand', 'anchor', 'brand'] } }).amount).toBeCloseTo(75, 9);
    expect(computeDamage({ base: 100, target: { effects: ['well'] } }).amount).toBe(100);
    expect(() => computeDamage({ base: 100, target: { effects: ['bogus'] } })).toThrow(/skill node/);
  });

  it("applies the target's damage-taken modifiers (Grey Blood +10%)", () => {
    const r = computeDamage({ base: 100, target: { mods: modsOfNodes(['grey_blood']), effects: ['anchor'] } });
    expect(r.taken).toBeCloseTo(1.1 * 0.6, 12);
    expect(r.amount).toBeCloseTo(66, 9);
  });

  it("applies the attacker's power to the nodes it names (Acidsalt catalyst: Spore +30%)", () => {
    const attackerMods = getItem('acidsalt_catalyst').mods ?? [];
    expect(computeDamage({ base: 10, source: { node: 'spore' }, attackerMods }).amount).toBeCloseTo(13, 9);
    expect(computeDamage({ base: 10, source: { node: 'lance' }, attackerMods }).amount).toBe(10);
    // Rot and the catalyst together on the Hollow: 10 × 1.3 × 3
    const r = computeDamage({
      base: 10,
      source: { node: 'spore', augments: ['rot'] },
      attackerMods,
      target: { resistances: HOLLOW_RESISTANCES, hollow: true },
    });
    expect(r.amount).toBeCloseTo(39, 9);
    expect(r).toMatchObject({ power: 1.3, augment: 3, taken: 1 });
  });

  it('clamps at 0 and rejects bad input', () => {
    expect(computeDamage({ base: 0, level: 50 }).amount).toBe(0);
    expect(computeDamage({ base: 50, source: { node: 'pull' }, target: { resistances: SENTINEL_RESISTANCES } }).amount).toBe(0);
    expect(() => computeDamage({ base: -1 })).toThrow(RangeError);
    expect(() => computeDamage({ base: NaN })).toThrow(RangeError);
    expect(() => computeDamage({ base: 10, level: -5 })).toThrow(RangeError);
  });

  it('is deterministic', () => {
    const req = { base: 33, level: 27, source: { node: 'flare' }, target: { resistances: CRYSTAL_RESISTANCES, effects: ['brand'] } };
    expect(computeDamage(req)).toEqual(computeDamage(req));
  });
});

describe('stat modifiers', () => {
  it("raises a player's health: Dense Bones +20%, Second Skin 150, both 180", () => {
    expect(playerMaxHealth([])).toBe(100);
    expect(playerMaxHealth(['dense_bones'])).toBeCloseTo(120, 9);
    expect(playerMaxHealth(['second_skin'])).toBe(150);
    expect(playerMaxHealth(['second_skin', 'dense_bones', 'dense_bones'])).toBeCloseTo(180, 9);
    expect(playerMaxHealth(['lance', 'flare'])).toBe(100);
    expect(() => playerMaxHealth(['nope'])).toThrow(/skill node/);
  });

  it('applies add, then mul, then set, and honours conditions, branches and nodes', () => {
    const mods: StatMod[] = [
      { stat: 'heat.cost', op: 'mul', value: 2 },
      { stat: 'heat.cost', op: 'add', value: 5 },
      { stat: 'heat.cost', op: 'mul', value: 0.5, branch: 'void' },
      { stat: 'heat.cost', op: 'add', value: 100, when: 'night' },
      { stat: 'heat.cost', op: 'mul', value: 10, nodes: ['lance'] },
      { stat: 'heat.capacity', op: 'add', value: 1000 },
    ];
    expect(applyStatMods(10, 'heat.cost', mods)).toBe(30);
    expect(applyStatMods(10, 'heat.cost', mods, { branch: 'void' })).toBe(15);
    expect(applyStatMods(10, 'heat.cost', mods, { holds: (c) => c === 'night' })).toBe(230);
    expect(applyStatMods(10, 'heat.cost', mods, { node: 'lance' })).toBe(300);
    expect(applyStatMods(10, 'heat.cost', [...mods, { stat: 'heat.cost', op: 'set', value: 7 }])).toBe(7);
  });
});
