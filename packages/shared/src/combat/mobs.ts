// A mob at a level (DESIGN 12.1): its threat stars, scaled health and damage, its attacks, and how it takes damage. Fauna
// are a body plan with a temperament, and may be stone-touched (DESIGN 12.3: the `stone_touched` row is an overlay on the
// herd it turns, not a creature of its own); archetypes (horrors, constructs, people, space mobs) and bosses are rows.
import { COMBAT, getBodyPlan, getBoss, getMob, getTemperament } from '../data/index.ts';
import type { BodyPlanId, Mob, Resistance } from '../data/index.ts';
import { isHollow } from './damage.ts';
import { assertLevel, atLevel } from './level.ts';

/** Which table rows a combatant comes from. */
export type MobRef =
  | { readonly kind: 'fauna'; readonly bodyPlan: BodyPlanId; readonly temperament: string; readonly stoneTouched?: boolean }
  | { readonly kind: 'mob'; readonly id: string }
  | { readonly kind: 'boss'; readonly id: string };

export interface ScaledAttack {
  readonly id: string;
  readonly name: string;
  /** Damage per hit at the mob's level. */
  readonly damage: number;
}

export interface MobStats {
  readonly level: number;
  /** Threat stars 1–5; null for what is never fought or is an event (ring grazers, depth leviathans, the Hollow tide, the Patient). */
  readonly threat: number | null;
  /** Max health at this level; null when it comes from a hull (space mobs) or the mob is never fought. */
  readonly health: number | null;
  /** Damage per hit at this level. When the mob performs one of its `attacks`, that attack's own `damage` is what it deals
   * (E08.T02 uses it); this is the heaviest of them, so the two never disagree. A mob with no body-plan attacks (constructs,
   * the brood, rig-less bosses) deals this with whatever it does (beams, latches). Null when it has no number of its own:
   * pirates fight with the skill web, ships with their weapons. */
  readonly damage: number | null;
  /** Its body plan's attacks at this level. A row with its own base damage (a shambler's 30, the Pack Alpha's 35) rescales
   * them so the heaviest matches it and the rest keep their proportions (the Pack Alpha: charge 35, stomp 21). */
  readonly attacks: readonly ScaledAttack[];
  readonly resistances: readonly Resistance[];
  readonly hollow: boolean;
}

/** The fields a mob, boss or plain fauna row gives. */
interface Row {
  readonly bodyPlan: BodyPlanId | null;
  readonly baseHealth: number | null;
  readonly baseDamage: number | null;
  readonly resistances: readonly Resistance[];
}

/** The rows that overlay fauna rather than stand alone (the stone-touched). */
const isOverlay = (mob: Mob) => mob.group === 'stone_touched';

/** A fauna temperament must take the body plan (DESIGN 12.2: territorial herds are heavy quadrupeds or grazers …). */
function checkFauna(bodyPlan: BodyPlanId, temperament: string) {
  const t = getTemperament(temperament);
  if (t.bodyPlans !== 'all' && !t.bodyPlans.some((p) => p.plan === bodyPlan)) {
    throw new RangeError(`temperament ${temperament} does not take body plan ${bodyPlan}`);
  }
  return t;
}

function standalone(id: string): Mob {
  const mob = getMob(id);
  if (isOverlay(mob)) throw new RangeError(`${id} is an overlay on fauna: use { kind: 'fauna', bodyPlan, temperament, stoneTouched: true }`);
  return mob;
}

/** Threat stars (DESIGN 12.1, shown after analysis): fauna by temperament (a stone-touched herd rates at least the
 * stone-touched row's), archetypes by their row, bosses at the top of the scale (5), the unkillable Patient none. */
export function threatRating(ref: MobRef): number | null {
  if (ref.kind === 'mob') return standalone(ref.id).threat;
  if (ref.kind === 'boss') return getBoss(ref.id).killable ? COMBAT.threat.max : null;
  const own = checkFauna(ref.bodyPlan, ref.temperament).threat;
  return ref.stoneTouched ? Math.max(own, getMob('stone_touched').threat ?? COMBAT.threat.min) : own;
}

function rowStats(row: Row, level: number, threat: number | null): MobStats {
  const plan = row.bodyPlan ? getBodyPlan(row.bodyPlan) : null;
  const health = row.baseHealth ?? plan?.baseHealth ?? null;
  const top = plan ? Math.max(...plan.attacks.map((a) => a.damage)) : 0;
  const attacks = (plan?.attacks ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    damage: atLevel(row.baseDamage === null || top === 0 ? a.damage : (a.damage * row.baseDamage) / top, level),
  }));
  const damage = attacks.length > 0 ? Math.max(...attacks.map((a) => a.damage)) : row.baseDamage === null ? null : atLevel(row.baseDamage, level);
  return {
    level,
    threat,
    health: health === null ? null : atLevel(health, level),
    damage,
    attacks,
    resistances: row.resistances,
    hollow: isHollow(row.resistances),
  };
}

/** A mob's numbers at a level (1–50; anything else throws). Health and damage = base × (1 + 0.12 × level).
 * - Fauna take their body plan's health and attacks; a temperament that spawns as a boss (the apex is the Pack Alpha) takes
 *   the boss's row instead. Stone-touched fauna keep all of that and add the `stone_touched` row's resistances (immune to
 *   Harmonic, hidden by Veil, flee Nullsong) and threat; asking for that row on its own throws.
 * - Archetypes and bosses take their row, falling back to their body plan's health. */
export function mobStats(ref: MobRef, level: number): MobStats {
  assertLevel(level);
  const threat = threatRating(ref);
  if (ref.kind === 'boss') return rowStats(getBoss(ref.id), level, threat);
  if (ref.kind === 'mob') return rowStats(standalone(ref.id), level, threat);
  const temperament = checkFauna(ref.bodyPlan, ref.temperament);
  const own: Row = temperament.boss !== undefined ? getBoss(temperament.boss) : { bodyPlan: ref.bodyPlan, baseHealth: null, baseDamage: null, resistances: [] };
  const row = ref.stoneTouched ? { ...own, resistances: [...own.resistances, ...getMob('stone_touched').resistances] } : own;
  return rowStats(row, level, threat);
}
