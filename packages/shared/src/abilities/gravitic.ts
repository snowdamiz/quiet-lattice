// The Gravitic branch's Tier I–II nodes (DESIGN 9.2; P1.E07.T04): what each cast names, and the numbers DESIGN leaves to the
// build. Costs, cooldowns, ranges, the Well's bubble, slow and time, Slam's radii and the hold are the nodes'
// (`@astra/shared/data`); only what the node does not carry is here, each chosen (docs/DECISIONS.md P1.E07.T04).
import { getSkillNode } from '../data/index.ts';
import type { Ability } from './index.ts';

export const GRAVITIC_NUMBERS = {
  pull: {
    /** A pulled creature is carried to the caster's feet over this long, s. */
    carryS: 0.35,
    /** It lands this far from the caster's feet, towards where it came from, m. */
    landM: 2.5,
    /** Threat the yank puts on the creature for its caster (as a blow of this size would): a hostile one turns on it, a grazer bolts. */
    threat: 2,
  },
  slam: {
    /** A cast needs the walker this high over the ground, m: a jump's apex is under it, the jetpack's reach is above. */
    minHeightM: 3,
    /** The fall height at which the knockdown reaches its widest, m (a full tank of jetpack climbs about this high). */
    fullHeightM: 20,
    /** A creature in the radius lies down this long, s. */
    downS: 3,
    /** A slam that has not landed this long after the cast is spent with no effect, s. */
    airMaxS: 8,
    /** How often the caster's fall is looked at, s. */
    pollS: 0.05,
  },
  tractor: {
    /** The beam draws rocks and holds a ship this far from the hull, m (the node gives no range). */
    rangeM: 500,
  },
  massSense: {
    /** Mass Sense shows creatures of this body plan through terrain (DESIGN calls them heavy). */
    heavyPlan: 'quad_heavy',
  },
} as const;

/** Gravitic's Tier I–II actives. Heavy Footing, Dense Bones and Mass Sense are passives and Pull Many an augment: the systems
 * they name read them, nothing casts them. */
export const GRAVITIC_ABILITIES: readonly Ability[] = [
  // (a creature: a player is no target until PvP, P2.E17.T01, and a loot pod has no entity in the world yet)
  { node: 'pull', target: 'entity', on: ['mob'] },
  { node: 'slam', target: 'self' },
  { node: 'well', target: 'self' },
  // (a ship to hold, if the caster aims at one: the rocks and loot it draws are the client's)
  { node: 'tractor_beam', target: 'entity', on: ['player'], optional: true, rangeM: GRAVITIC_NUMBERS.tractor.rangeM },
  { node: 'inertial_brake', target: 'self' },
];

/** The knockdown radius of a Slam that fell `fallM` from its peak: 6 m, growing to 18 m at `fullHeightM` (DESIGN 9.2). */
export function slamRadius(fallM: number): number {
  const { minRadiusM, maxRadiusM } = getSkillNode('slam').params;
  const { minHeightM, fullHeightM } = GRAVITIC_NUMBERS.slam;
  const f = Math.min(1, Math.max(0, (fallM - minHeightM) / (fullHeightM - minHeightM)));
  return minRadiusM! + (maxRadiusM! - minRadiusM!) * f;
}

/** What a walker owning these nodes lands with (Heavy Footing): no fall damage, and no stagger (the landing shake). */
export function landing(owned: readonly string[]): { fallDamage: boolean; stagger: boolean } {
  const flags = new Set(owned.includes('heavy_footing') ? getSkillNode('heavy_footing').flags : []);
  return { fallDamage: !flags.has('no_fall_damage'), stagger: !flags.has('no_landing_stagger') };
}

/** Whether a scanner of a character owning these nodes shows creatures and deposits through terrain (Mass Sense). */
export function massSense(owned: readonly string[]): boolean {
  return owned.includes('mass_sense');
}
