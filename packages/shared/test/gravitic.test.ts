// Gravitic's data (DESIGN 9.2; P1.E07.T04): what each of its actives names, Slam's radius by fall height, Heavy Footing's landings and
// Mass Sense's heavy creatures.
import { describe, expect, it } from 'vitest';
import { ABILITIES, GRAVITIC_NUMBERS, GRAVITIC_ABILITIES, heavyCreatures, landingOf, LANDING, massSense, reachOf, slamRadius } from '../src/abilities/index.ts';
import { getSkillNode } from '../src/data/index.ts';

describe('Gravitic’s actives', () => {
  it('are in the build’s abilities, each a slotted active of the web, on the right bar', () => {
    expect(GRAVITIC_ABILITIES.map((a) => a.node)).toEqual(['pull', 'slam', 'well', 'tractor_beam', 'inertial_brake']);
    for (const a of GRAVITIC_ABILITIES) expect(ABILITIES.get(a.node)).toBe(a);
    expect(getSkillNode('pull').slot).toBe('ground');
    expect(getSkillNode('tractor_beam').slot).toBe('ship');
    expect(getSkillNode('inertial_brake').slot).toBe('ship');
  });

  it('name what DESIGN says: Pull a creature within 25 m, Tractor Beam optionally a ship', () => {
    const pull = ABILITIES.get('pull')!;
    expect(pull).toMatchObject({ target: 'entity', on: ['mob'] });
    expect(reachOf(pull, getSkillNode('pull'))).toBe(25);
    expect(ABILITIES.get('tractor_beam')).toMatchObject({ target: 'entity', on: ['player'], optional: true });
    expect(ABILITIES.get('slam')!.target).toBe('self');
    expect(ABILITIES.get('well')!.target).toBe('self');
  });
});

describe('Slam’s radius', () => {
  it('is 6 m at the least fall and grows to 18 m at a full tank’s height (DESIGN 9.2: 6–18 m)', () => {
    expect(slamRadius(0)).toBe(6);
    expect(slamRadius(GRAVITIC_NUMBERS.slam.minHeightM)).toBe(6);
    expect(slamRadius(GRAVITIC_NUMBERS.slam.fullHeightM)).toBe(18);
    expect(slamRadius(1000)).toBe(18);
    const mid = (GRAVITIC_NUMBERS.slam.minHeightM + GRAVITIC_NUMBERS.slam.fullHeightM) / 2;
    expect(slamRadius(mid)).toBe(12);
    let last = 0;
    for (let h = 0; h <= 30; h += 0.5) {
      expect(slamRadius(h)).toBeGreaterThanOrEqual(last);
      last = slamRadius(h);
    }
  });
});

describe('Heavy Footing', () => {
  it('takes away the damage of a landing and its stagger, and the thud stays', () => {
    const hard = LANDING.damageFrom + 5;
    expect(landingOf(hard, [])).toEqual({ thud: true, shake: 1, damage: 20 });
    expect(landingOf(hard, ['heavy_footing'])).toEqual({ thud: true, shake: 0, damage: 0 });
    expect(landingOf(10, [])).toMatchObject({ thud: true, damage: 0 });
    expect(landingOf(10, [])!.shake).toBeCloseTo(0.5);
    expect(landingOf(3, [])).toEqual({ thud: false, shake: 0, damage: 0 });
  });
});

describe('Mass Sense', () => {
  const species = [
    { name: 'Hide Ram', bodyPlan: 'quad_heavy' },
    { name: 'Skip', bodyPlan: 'quad_small' },
  ];
  const mobs = new Map([
    [1, { kind: 'mob', frame: 'w', pos: [10, 0, 0], species: 0 }],
    [2, { kind: 'mob', frame: 'w', pos: [10, 0, 0], species: 1 }],
    [3, { kind: 'mob', frame: 'w', pos: [500, 0, 0], species: 0 }],
    [4, { kind: 'mob', frame: 'x', pos: [10, 0, 0], species: 0 }],
    [5, { kind: 'player', frame: 'w', pos: [10, 0, 0] }],
    [6, { kind: 'mob', frame: 'w', pos: [10, 0, 0], species: 9 }],
    [7, { kind: 'mob', frame: 'w', pos: [10, 0, 0] }],
  ]);

  it('lists the heavy creatures of the world within range, wherever they stand', () => {
    expect(heavyCreatures(mobs, species, 'w', [0, 0, 0], 360)).toEqual([{ id: 1, name: 'Hide Ram', pos: [10, 0, 0] }]);
    expect(heavyCreatures(mobs, species, 'w', [0, 0, 0], 600).map((c) => c.id)).toEqual([1, 3]);
  });

  it('is a node a build owns', () => {
    expect(massSense(['mass_sense'])).toBe(true);
    expect(massSense(['pull'])).toBe(false);
    expect(getSkillNode('mass_sense').flags).toEqual(['scan_deposits_through_terrain', 'scan_heavy_creatures_through_terrain']);
  });
});
