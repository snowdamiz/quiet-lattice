// The Resonance branch's Tier I–II nodes (DESIGN 9.4; P1.E07.T06): what each cast names, and the numbers DESIGN leaves to the
// build. Costs, cooldowns, radii and durations that DESIGN gives are the nodes' (`@astra/shared/data`); only what the node
// does not carry is here, each chosen (docs/DECISIONS.md P1.E07.T06).
import { applyStatMods, modsOfNodes } from '../combat/index.ts';
import type { Ability } from './index.ts';

export const RESONANCE_NUMBERS = {
  /** Today's scan, before Long Ear (the demo's): deposits within this, sites within this, m. */
  scan: { depositM: 180, siteM: 3000 },
  shatter: {
    /** The burst reaches this far round the caster, m (the node gives no radius). */
    radiusM: 15,
    /** Damage to each crystal creature it reaches, before its weakness (×2 to Shatter). Other creatures are not its target. */
    creatureDamage: 45,
    /** hp it takes off each mineral deposit and formation (a deposit has 4–7; the multitool does 1.6 a second). Plants are
     * not deposits. */
    depositHp: 6,
    /** The most deposits one burst works on, nearest first. */
    depositsMax: 12,
  },
  deepSweep: {
    /** How long pirates read on the radar at the node's range after the sweep, s (the node gives none). */
    radarS: 15,
  },
  jammer: {
    /** A jammed ship cannot engage the pulse drive again for this long, s (the node gives none: a cancel with no lockout is
     * undone at the next input). */
    lockoutS: 6,
  },
} as const;

/** Resonance's Tier I–II actives. Long Ear and Choir are passives and Echo an augment: the scan, the Pulse and the cast
 * service read them from the skill nodes; nothing casts them. */
export const RESONANCE_ABILITIES: readonly Ability[] = [
  { node: 'pulse', target: 'self' },
  { node: 'deep_sweep', target: 'self' },
  { node: 'harmonic', target: 'self' },
  { node: 'shatter', target: 'self' },
  { node: 'veil', target: 'self' },
  // (an enemy ship: a player until PvP lets a cast harm one, P2.E17.T01, and pirates after P1.E08.T05)
  { node: 'jammer', target: 'entity', on: ['player'] },
];

/** How far today's scan reaches with these nodes owned (Long Ear's ×2): deposits and sites, m. */
export function scanRanges(owned: Iterable<string>): { depositM: number; siteM: number } {
  const mods = modsOfNodes(owned);
  return {
    depositM: applyStatMods(RESONANCE_NUMBERS.scan.depositM, 'scan.deposit_range', mods),
    siteM: applyStatMods(RESONANCE_NUMBERS.scan.siteM, 'scan.site_range', mods),
  };
}
