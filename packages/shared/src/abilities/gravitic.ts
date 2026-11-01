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

/** What a landing costs a walker (today's Player.js numbers): a fall faster than `shakeFrom` m/s shakes the view, by its speed
 * over `shakeAt`; one faster than `damageFrom` hurts, `damagePerMps` for each m/s over. */
export const LANDING = { shakeFrom: 7, shakeAt: 20, damageFrom: 16, damagePerMps: 4 } as const;

/**
 * What landing at `fallSpeed` m/s does to a walker owning these nodes: the shake of the view (0–1, the stagger) and the damage.
 * Heavy Footing takes the damage away (no fall damage) and the shake with it (jetpack landings never stagger); the thud's
 * sound is the landing's, not a stagger, and stays.
 */
export function landingOf(fallSpeed: number, owned: readonly string[]): { thud: boolean; shake: number; damage: number } {
  const flags = new Set(owned.includes('heavy_footing') ? getSkillNode('heavy_footing').flags : []);
  const thud = fallSpeed > LANDING.shakeFrom;
  return {
    thud,
    shake: thud && !flags.has('no_landing_stagger') ? Math.min(1, fallSpeed / LANDING.shakeAt) : 0,
    damage: fallSpeed > LANDING.damageFrom && !flags.has('no_fall_damage') ? (fallSpeed - LANDING.damageFrom) * LANDING.damagePerMps : 0,
  };
}

/** Whether a scanner of a character owning these nodes shows creatures and deposits through terrain (Mass Sense). */
export function massSense(owned: readonly string[]): boolean {
  return owned.includes('mass_sense');
}

/** A creature as a client holds it from the server's snapshots. */
interface SeenEntity {
  readonly kind: string;
  readonly frame: string | null;
  readonly pos: readonly number[];
  readonly species?: number;
}

/**
 * The heavy creatures a Mass Sense scan shows: those of `entities` on world `frame`, within `rangeM` of `from` (a position in the
 * same frame), whose species (by the index the wire carries, from the world's `faunaSpecies`) has the heavy body plan. They
 * are shown wherever they stand, behind the ground or not: the scan reads the snapshots, not the view.
 */
export function heavyCreatures(
  entities: Iterable<readonly [number, SeenEntity]>,
  species: readonly { readonly name: string; readonly bodyPlan: string }[],
  frame: string,
  from: readonly number[],
  rangeM: number,
): { id: number; name: string; pos: [number, number, number] }[] {
  const out: { id: number; name: string; pos: [number, number, number] }[] = [];
  for (const [id, e] of entities) {
    if (e.kind !== 'mob' || e.frame !== frame || e.species === undefined) continue;
    const sp = species[e.species];
    if (!sp || sp.bodyPlan !== GRAVITIC_NUMBERS.massSense.heavyPlan) continue;
    if (Math.hypot(e.pos[0]! - from[0]!, e.pos[1]! - from[1]!, e.pos[2]! - from[2]!) > rangeM) continue;
    out.push({ id, name: sp.name, pos: [e.pos[0]!, e.pos[1]!, e.pos[2]!] });
  }
  return out;
}
