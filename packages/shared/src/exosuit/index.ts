// The exo-suit on foot (DESIGN 9.8, ARCHITECTURE §28): what the Exo-suit branch's passives change besides the walker's speeds
// (`walkerStats`, ships) and mining yield (the resource service): how fast hazard protection drains, how much a cartridge
// refill restores, and how far a scan reaches. Pure functions both ends run; the numbers are `SUIT` (`@astra/shared/data`) and
// the modifiers the owned nodes' (and the people's perk's) tables.
import { SUIT, SKILL_NODES, getPeople, getSkillNode } from '../data/index.ts';
import type { PeopleId, StatMod } from '../data/index.ts';
import { applyStatMods } from '../combat/stats.ts';

export interface ExosuitInputs {
  /** Skill nodes the character owns (passives only change the suit). */
  skills?: Iterable<string>;
  /** The character's people: its perk's modifiers (Ulgani: no hazard drain on toxic and corrosive worlds). */
  people?: PeopleId;
  /** Timed effects in force. */
  buffs?: readonly StatMod[];
}

/** The modifiers in force on a character's suit: its people's perk, then the owned always-on nodes in the web's order, then
 * buffs. Modifiers scoped to a branch's or named nodes' abilities are left out: they change those, not the suit. */
export function suitMods(inputs: ExosuitInputs = {}): StatMod[] {
  const owned = new Set<string>();
  for (const id of inputs.skills ?? []) owned.add(getSkillNode(id).id);
  const mods: StatMod[] = inputs.people ? [...getPeople(inputs.people).perk.mods] : [];
  for (const n of SKILL_NODES) if (owned.has(n.id) && n.slot === null) mods.push(...n.mods);
  mods.push(...(inputs.buffs ?? []));
  return mods.filter((m) => !m.branch && !m.nodes);
}

/** What a refill of raw oxygen or sodium restores: 40, 60 with Cartridge Recycler. */
export function cartridgeRestore(mods: readonly StatMod[]): number {
  return applyStatMods(SUIT.cartridge.restore, 'suit.cartridge_restore', mods);
}

/** The multiple of the hazard drain the build leaves, given the conditions that hold now (`meterConditions`): 1; Hazard Weave
 * ×0.6; Cold Blood at night on frozen worlds and Heat Shroud by day on desert and volcanic worlds ×0, for good. */
export function hazardDrainMult(mods: readonly StatMod[], conditions: ReadonlySet<string>): number {
  return applyStatMods(1, 'suit.hazard_drain', mods, { holds: (c) => conditions.has(c) });
}

/** Hazard protection drained a second by a place of `strength` (`footHazard`), in the dark or not, with the build's modifiers. */
export function hazardDrainPerS(strength: number, dark: boolean, mods: readonly StatMod[], conditions: ReadonlySet<string>): number {
  if (strength <= 0) return 0;
  return strength * (dark ? SUIT.nightMult : 1) * SUIT.hazardDrainPerS * hazardDrainMult(mods, conditions);
}

/** How far a scan reaches, m: deposits (180) and sites (3 km; Scanner Lens 6 km). */
export function scanRanges(mods: readonly StatMod[]): { depositM: number; siteM: number } {
  return {
    depositM: applyStatMods(SUIT.scan.depositM, 'scan.deposit_range', mods),
    siteM: applyStatMods(SUIT.scan.siteM, 'scan.site_range', mods),
  };
}
