// The Thermal branch's Tier I–II actives (DESIGN 9.3; P1.E07.T05): what each cast names, and the numbers DESIGN leaves to the
// build. Costs, cooldowns, ranges, the cone and the burn times are the nodes' (`@astra/shared/data`); only what the node does
// not carry is here, each chosen (docs/DECISIONS.md P1.E07.T05).
import type { Ability } from './index.ts';

export const THERMAL_NUMBERS = {
  lance: {
    /** Damage per second of the beam that fires (the meters' beam time), before the target's resistances. */
    dps: 12,
    /** How often the beam's damage is dealt while it fires, s. */
    tickS: 0.25,
    /** Chain: the second target takes this share of each tick. */
    chainShare: 0.5,
  },
  flare: {
    /** The burst the cone deals as it goes off. */
    burst: 18,
    burnDps: 6,
  },
  sear: {
    burnDps: 5,
    /** A mark is cast on a creature this far from the eye, m (the node gives no range). */
    rangeM: 30,
  },
  vent: {
    /** The shockwave reaches this far round the caster, m. */
    radiusM: 10,
    /** Damage for each point of heat dumped (a full 100 is 60). */
    damagePerHeat: 0.6,
  },
  /** A burn deals its damage in ticks this far apart, s. */
  burnTickS: 0.5,
} as const;

/** Thermal's Tier I–II actives. Ablative Plating, Focused Lasers, Tempered Core, Hot Hands and Chain are passives and an
 * augment: the systems they name read them, nothing casts them. */
export const THERMAL_ABILITIES: readonly Ability[] = [
  { node: 'lance', target: 'aim', toggle: true },
  { node: 'flare', target: 'aim' },
  { node: 'sear', target: 'entity', on: ['mob'], rangeM: THERMAL_NUMBERS.sear.rangeM },
  { node: 'vent', target: 'self' },
];
