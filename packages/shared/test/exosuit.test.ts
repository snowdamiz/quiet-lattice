// The Exo-suit's Tier I–II passives (DESIGN 9.8, P1.E07.T10), one test each against the number the design gives, and the rules
// they act through (`@astra/shared/exosuit`, `walkerStats`).
import { describe, expect, it } from 'vitest';
import { applyStatMods, modsOfNodes } from '../src/combat/index.ts';
import { SUIT, footHazard, getSkillNode, suitSchema } from '../src/data/index.ts';
import { cartridgeRestore, hazardDrainMult, hazardDrainPerS, scanRanges, suitMods } from '../src/exosuit/index.ts';
import { NOWHERE, meterConditions, type MeterEnvironment } from '../src/meters/index.ts';
import { walkerCaps, walkerStats } from '../src/ships/index.ts';

const at = (env: Partial<MeterEnvironment>) => meterConditions({ ...NOWHERE, ...env });
const mods = (...skills: string[]) => suitMods({ skills });

describe('the exo-suit data', () => {
  it('is today’s demo: 40 a refill from 25, 180 m and 3 km scans', () => {
    expect(suitSchema.safeParse(SUIT).success).toBe(true);
    expect(SUIT.cartridge).toEqual({ restore: 40, below: 25, units: 10 });
    expect(SUIT.scan).toMatchObject({ depositM: 180, siteM: 3000 });
  });

  it('files the nine Tier I–II nodes as always-on passives of the branch with the numbers DESIGN 9.8 gives', () => {
    const nodes = [
      'cartridge_recycler',
      'long_jump',
      'efficient_jetpack',
      'hazard_weave',
      'cold_blood',
      'heat_shroud',
      'optical_drill',
      'scanner_lens',
      'sprint_stride',
    ];
    expect(nodes.map((id) => [getSkillNode(id).branch, getSkillNode(id).tier, getSkillNode(id).slot])).toEqual(
      nodes.map((_, i) => ['exosuit', i < 3 ? 1 : 2, null]),
    );
  });
});

describe('Cartridge Recycler', () => {
  it('makes an oxygen or sodium refill restore 60, not 40', () => {
    expect(cartridgeRestore(mods())).toBe(40);
    expect(cartridgeRestore(mods('cartridge_recycler'))).toBe(60);
  });

  it('is the Ulgani’s to buy, and nobody else’s nodes touch the refill', () => {
    expect(cartridgeRestore(mods('hazard_weave', 'sprint_stride'))).toBe(40);
  });
});

describe('Long Jump', () => {
  it('jumps at 7 m/s, not 5.5', () => {
    expect(walkerStats().jump).toBe(5.5);
    expect(walkerStats({ skills: ['long_jump'] }).jump).toBe(7);
  });

  it('leaves the speeds the walker is held to alone: the jetpack’s climb is already faster', () => {
    expect(walkerCaps(walkerStats({ skills: ['long_jump'] }))).toEqual(walkerCaps(walkerStats()));
  });
});

describe('Efficient Jetpack', () => {
  it('doubles the seconds a full tank lasts', () => {
    const plain = walkerStats().jetFuelS;
    expect(plain).toBeCloseTo(1 / 0.42, 12);
    expect(walkerStats({ skills: ['efficient_jetpack'] }).jetFuelS).toBeCloseTo(2 * plain, 12);
  });
});

describe('Sprint Stride', () => {
  it('sprints at 11.5 m/s, not 9.5, and walks no faster', () => {
    const plain = walkerStats();
    const fast = walkerStats({ skills: ['sprint_stride'] });
    expect([plain.sprint, fast.sprint, fast.walk]).toEqual([9.5, 11.5, 5.2]);
  });

  it('raises the cap the server holds a walker to', () => {
    expect(walkerCaps(walkerStats({ skills: ['sprint_stride'] })).across).toBeGreaterThan(walkerCaps(walkerStats()).across);
  });
});

describe('Hazard Weave', () => {
  const frozenDay = at({ world: 'frozen', time: 'day' });

  it('drains hazard protection 40% slower, in the dark as by day', () => {
    const strength = footHazard('frozen', null);
    const plain = hazardDrainPerS(strength, false, mods(), frozenDay);
    expect(hazardDrainPerS(strength, false, mods('hazard_weave'), frozenDay)).toBeCloseTo(plain * 0.6, 12);
    expect(hazardDrainPerS(strength, true, mods('hazard_weave'), frozenDay)).toBeCloseTo(plain * 1.4 * 0.6, 12);
  });

  it('takes the demo’s rate for the plain suit: a frozen world eats 0.6 a second, 0.84 at night', () => {
    expect(hazardDrainPerS(1, false, mods(), frozenDay)).toBeCloseTo(0.6, 12);
    expect(hazardDrainPerS(1, true, mods(), frozenDay)).toBeCloseTo(0.84, 12);
  });

  it('drains nothing where nothing is hazardous', () => {
    expect(hazardDrainPerS(0, true, mods('hazard_weave'), frozenDay)).toBe(0);
  });
});

describe('Cold Blood', () => {
  const drain = (env: Partial<MeterEnvironment>, ...skills: string[]) => hazardDrainMult(mods(...skills), at(env));

  it('stops the drain at night on frozen worlds', () => {
    expect(drain({ world: 'frozen', time: 'night' }, 'cold_blood')).toBe(0);
  });

  it('does nothing by day on a frozen world, or at night anywhere else', () => {
    expect(drain({ world: 'frozen', time: 'day' }, 'cold_blood')).toBe(1);
    expect(drain({ world: 'desert', time: 'night' }, 'cold_blood')).toBe(1);
    expect(drain({ world: 'volcanic', time: 'night' }, 'cold_blood')).toBe(1);
    expect(drain({ world: 'frozen', time: 'night' })).toBe(1);
  });

  it('leaves the cryo hazard of another world alone', () => {
    expect(drain({ world: 'toxic', hazards: ['cryo'], time: 'night' }, 'cold_blood')).toBe(1);
  });
});

describe('Heat Shroud', () => {
  const drain = (env: Partial<MeterEnvironment>, ...skills: string[]) => hazardDrainMult(mods(...skills), at(env));

  it('stops the drain by day on desert and volcanic worlds', () => {
    expect(drain({ world: 'desert', time: 'day' }, 'heat_shroud')).toBe(0);
    expect(drain({ world: 'volcanic', time: 'day' }, 'heat_shroud')).toBe(0);
  });

  it('does nothing at night there, by day on an inferno or frozen world, or without the node', () => {
    expect(drain({ world: 'desert', time: 'night' }, 'heat_shroud')).toBe(1);
    expect(drain({ world: 'volcanic', time: 'night' }, 'heat_shroud')).toBe(1);
    expect(drain({ world: 'inferno', time: 'day' }, 'heat_shroud')).toBe(1);
    expect(drain({ world: 'frozen', time: 'day' }, 'heat_shroud')).toBe(1);
    expect(drain({ world: 'desert', time: 'day' })).toBe(1);
  });

  it('with Cold Blood and Hazard Weave: the weave slows what the two leave', () => {
    const all = ['hazard_weave', 'cold_blood', 'heat_shroud'];
    expect(drain({ world: 'frozen', time: 'night' }, ...all)).toBe(0);
    expect(drain({ world: 'desert', time: 'day' }, ...all)).toBe(0);
    expect(drain({ world: 'frozen', time: 'day' }, ...all)).toBeCloseTo(0.6, 12);
    expect(drain({ world: 'desert', time: 'night' }, ...all)).toBeCloseTo(0.6, 12);
  });
});

describe('Optical Drill', () => {
  it('mines half as much again, and stacks with Hot Hands', () => {
    const yieldOf = (...nodes: string[]) => applyStatMods(1, 'mining.yield', modsOfNodes(nodes));
    expect(yieldOf()).toBe(1);
    expect(yieldOf('optical_drill')).toBe(1.5);
    expect(yieldOf('optical_drill', 'hot_hands')).toBeCloseTo(2.25, 12);
  });
});

describe('Scanner Lens', () => {
  it('reveals sites to 6 km, not 3, and reaches no further for deposits', () => {
    expect(scanRanges(mods())).toEqual({ depositM: 180, siteM: 3000 });
    expect(scanRanges(mods('scanner_lens'))).toEqual({ depositM: 180, siteM: 6000 });
  });
});

describe('the suit’s modifiers', () => {
  it('come from the people’s perk too: the Ulgani drink toxic and corrosive worlds', () => {
    const ulgani = suitMods({ people: 'ulgani' });
    expect(hazardDrainMult(ulgani, at({ world: 'toxic' }))).toBe(0);
    expect(hazardDrainMult(ulgani, at({ world: 'corrosive' }))).toBe(0);
    expect(hazardDrainMult(ulgani, at({ world: 'frozen' }))).toBe(1);
  });

  it('leave out another branch’s modifiers and unknown nodes throw', () => {
    expect(suitMods({ skills: ['dense_bones', 'photon_thrusters'] }).filter((m) => m.stat.startsWith('suit.') || m.stat.startsWith('scan.'))).toEqual([]);
    expect(() => suitMods({ skills: ['sprint_strid'] })).toThrow(/Unknown skill node/);
  });

  it('a hazard on foot is the worse of the world’s and the ship hazard’s foot strength, or the mist’s alone', () => {
    expect(footHazard('lush', null)).toBe(0);
    expect(footHazard('volcanic', null)).toBe(1.5);
    expect(footHazard('inferno', { kind: 'heat', dps: 5 })).toBe(9);
    expect(footHazard('inferno', { kind: 'heat', dps: 2.5 })).toBe(4.5);
    expect(footHazard('lush', { kind: 'cryo', dps: 5 }, 0.3)).toBe(0.3);
  });
});
