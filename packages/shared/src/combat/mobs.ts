// A mob at a level (DESIGN 12.1): its threat stars, scaled health and damage, its attacks, and how it takes damage. Fauna
// are a body plan with a temperament; archetypes (horrors, constructs, people, space mobs) and bosses are rows of their own.
import { COMBAT, getBodyPlan, getBoss, getMob, getTemperament } from '../data/index.ts';
import type { Attack, BodyPlan, BodyPlanId, Boss, Resistance } from '../data/index.ts';
import { isHollow } from './damage.ts';
import { assertLevel, atLevel } from './level.ts';

/** Which table row a combatant comes from. */
export type MobRef =
  | { readonly kind: 'fauna'; readonly bodyPlan: BodyPlanId; readonly temperament: string }
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
  /** Its own damage per hit at this level (a boss's or archetype's number; for fauna, the body plan's heaviest attack); null
   * when it has none (pirates fight with the skill web, ships with their weapons). */
  readonly damage: number | null;
  /** Its body plan's attacks at this level. */
  readonly attacks: readonly ScaledAttack[];
  readonly resistances: readonly Resistance[];
  readonly hollow: boolean;
}

/** A fauna temperament must take the body plan (DESIGN 12.2: territorial herds are heavy quadrupeds or grazers …). */
function checkFauna(bodyPlan: BodyPlanId, temperament: string) {
  const t = getTemperament(temperament);
  if (t.bodyPlans !== 'all' && !t.bodyPlans.some((p) => p.plan === bodyPlan)) {
    throw new RangeError(`temperament ${temperament} does not take body plan ${bodyPlan}`);
  }
  return { plan: getBodyPlan(bodyPlan), temperament: t };
}

/** Threat stars (DESIGN 12.1, shown after analysis): fauna by temperament, archetypes by their row, bosses at the top of the
 * scale (5), the unkillable Patient none. */
export function threatRating(ref: MobRef): number | null {
  if (ref.kind === 'fauna') return checkFauna(ref.bodyPlan, ref.temperament).temperament.threat;
  if (ref.kind === 'mob') return getMob(ref.id).threat;
  return getBoss(ref.id).killable ? COMBAT.threat.max : null;
}

function scaleAttacks(attacks: readonly Attack[], level: number): ScaledAttack[] {
  return attacks.map((a) => ({ id: a.id, name: a.name, damage: atLevel(a.damage, level) }));
}

function heaviest(plan: BodyPlan): number {
  return Math.max(...plan.attacks.map((a) => a.damage));
}

function bossStats(boss: Boss, level: number, threat: number | null): MobStats {
  const plan = boss.bodyPlan ? getBodyPlan(boss.bodyPlan) : null;
  return {
    level,
    threat,
    health: boss.baseHealth === null ? null : atLevel(boss.baseHealth, level),
    damage: boss.baseDamage === null ? null : atLevel(boss.baseDamage, level),
    attacks: plan ? scaleAttacks(plan.attacks, level) : [],
    resistances: boss.resistances,
    hollow: isHollow(boss.resistances),
  };
}

/** A mob's numbers at a level (1–50; anything else throws). Health and damage = base × (1 + 0.12 × level). A fauna
 * temperament that spawns as a boss (the apex is the Pack Alpha) takes the boss's health and damage. */
export function mobStats(ref: MobRef, level: number): MobStats {
  assertLevel(level);
  if (ref.kind === 'boss') {
    const boss = getBoss(ref.id);
    return bossStats(boss, level, threatRating(ref));
  }
  if (ref.kind === 'fauna') {
    const { plan, temperament } = checkFauna(ref.bodyPlan, ref.temperament);
    if (temperament.boss !== undefined) return bossStats(getBoss(temperament.boss), level, temperament.threat);
    return {
      level,
      threat: temperament.threat,
      health: atLevel(plan.baseHealth, level),
      damage: atLevel(heaviest(plan), level),
      attacks: scaleAttacks(plan.attacks, level),
      resistances: [],
      hollow: false,
    };
  }
  const mob = getMob(ref.id);
  const plan = mob.bodyPlan ? getBodyPlan(mob.bodyPlan) : null;
  const health = mob.baseHealth ?? plan?.baseHealth ?? null;
  const damage = mob.baseDamage ?? (plan ? heaviest(plan) : null);
  return {
    level,
    threat: mob.threat,
    health: health === null ? null : atLevel(health, level),
    damage: damage === null ? null : atLevel(damage, level),
    attacks: plan ? scaleAttacks(plan.attacks, level) : [],
    resistances: mob.resistances,
    hollow: isHollow(mob.resistances),
  };
}
