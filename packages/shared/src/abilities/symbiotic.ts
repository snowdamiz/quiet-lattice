import type { Ability } from './index.ts';

/** Tier I–II choices where DESIGN 9.5 supplies no number. */
export const SYMBIOTIC_NUMBERS = {
  tickS: 0.25,
  bond: { rangeM: 60, followM: 4, flyerFollowSlackM: 3, flyerAltitudeM: 1, defendM: 20, leashM: 40 },
  repairDrones: { durationS: 20 },
  regrow: { rangeM: 30 },
  spore: { damagePerS: 4, healPerS: 4 },
  call: { rangeM: 30, herdRadiusM: 40, durationS: 6, contactDamage: 12, contactRadiusM: 2 },
} as const;

export const SYMBIOTIC_ABILITIES: readonly Ability[] = [
  { node: 'bond', target: 'entity', on: ['mob'], rangeM: SYMBIOTIC_NUMBERS.bond.rangeM },
  { node: 'repair_drones', target: 'self' },
  { node: 'regrow', target: 'entity', on: ['player'], rangeM: SYMBIOTIC_NUMBERS.regrow.rangeM, selfWhenUntargeted: true },
  { node: 'spore', target: 'self' },
  { node: 'call', target: 'aim' },
];
