// Levels and XP (DESIGN 12.1, 14.9). A mob's health and damage scale with its level; a character's level comes from XP.
import { COMBAT, scaleByLevel } from '../data/index.ts';

/** DESIGN 14.9: XP to reach level n = 100 × n^1.6 (per level, not cumulative); a kill is worth the mob's level × 10. */
export const XP_CURVE = Object.freeze({ base: 100, exponent: 1.6, perKillLevel: 10 });

/** Checks a level: a whole number from 1 to 50 (DESIGN 12.1). Throws a RangeError otherwise, so a negative, fractional or
 * NaN level never reaches a health bar. */
export function assertLevel(level: number): number {
  if (!Number.isInteger(level) || level < COMBAT.level.min || level > COMBAT.level.max) {
    throw new RangeError(`level must be a whole number from ${COMBAT.level.min} to ${COMBAT.level.max}, got ${level}`);
  }
  return level;
}

/** A base amount at a level: base × (1 + 0.12 × level). Health and damage per hit both scale this way (DESIGN 12.1). */
export function atLevel(base: number, level: number): number {
  if (!Number.isFinite(base) || base < 0) throw new RangeError(`base must be a finite number ≥ 0, got ${base}`);
  return scaleByLevel(base, assertLevel(level));
}

/** XP needed to go from level n − 1 to level n, in whole XP. Everyone starts at level 1, so reaching it costs nothing. */
export function xpToReach(level: number): number {
  assertLevel(level);
  return level === COMBAT.level.min ? 0 : Math.round(XP_CURVE.base * level ** XP_CURVE.exponent);
}

/** Cumulative XP to stand at each level, indexed by level (index 0 unused). */
const CUMULATIVE: readonly number[] = (() => {
  const totals = [0, 0];
  for (let n = COMBAT.level.min + 1; n <= COMBAT.level.max; n++) totals.push(totals[n - 1] + xpToReach(n));
  return Object.freeze(totals);
})();

/** Total XP from level 1 to this level (about 1.0M to the cap of 50, DESIGN 14.9). */
export function totalXpFor(level: number): number {
  return CUMULATIVE[assertLevel(level)];
}

/** The level a character with this much total XP stands at, capped at 50. */
export function levelForXp(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp < 0) throw new RangeError(`XP must be a finite number ≥ 0, got ${totalXp}`);
  let level = COMBAT.level.min;
  while (level < COMBAT.level.max && CUMULATIVE[level + 1] <= totalXp) level++;
  return level;
}

/** XP for killing a mob of this level (DESIGN 14.9). */
export function killXp(mobLevel: number): number {
  return assertLevel(mobLevel) * XP_CURVE.perKillLevel;
}
