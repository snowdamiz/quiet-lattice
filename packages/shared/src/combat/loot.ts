// What a kill is worth (DESIGN 12.1 "Death and drops", 14.9, 15.2; P1.E06.T02). DESIGN names what kills give (units,
// resources, Count residue from the stone-touched and the Hollow, ship parts in space, codex entries; XP = mob level × 10;
// fragments never) but no amounts: the numbers here are this table's, recorded in docs/DECISIONS.md. The server rolls a
// kill's loot once and shares it, and the kill's XP, among everyone who hurt it by the damage each did.
import { COMBAT, deepFreeze, getBoss, getMob } from '../data/index.ts';
import type { ResourceId } from '../data/index.ts';
import { assertLevel, killXp } from './level.ts';
import { threatRating, type MobRef } from './mobs.ts';

export const KILL_LOOT = deepFreeze({
  /** Units a kill is worth per mob level per threat star, before the roll (a level-3 grazer about 6, a level-15 pack
   * hunter about 90, a level-30 apex about 300: Tier 0's 1–3k units an hour, DESIGN 15.6, comes mostly from elsewhere). */
  unitsPerLevelStar: 2,
  /** The roll spreads units over this range of their base. */
  unitsSpread: [0.75, 1.25] as const,
  /** Each resource a row drops (a mob row's `drops`, a boss's loot resources): this many per threat star before the roll,
   * at least one. Plain fauna drop none (DESIGN gives resources to no living herd but the stone-touched). */
  resourcePerStar: 1,
  resourceSpread: [0.5, 1.5] as const,
});

export interface KillLoot {
  /** XP for the kill, shared by damage */
  xp: number;
  units: number;
  items: { item: ResourceId; count: number }[];
}

/** The resources a mob row drops: its own `drops` (fauna: only the stone-touched overlay's), a boss its loot's. */
function dropsOf(ref: MobRef): readonly ResourceId[] {
  if (ref.kind === 'boss') return getBoss(ref.id).loot.resources;
  if (ref.kind === 'mob') return getMob(ref.id).drops;
  return ref.stoneTouched ? getMob('stone_touched').drops : [];
}

/** A kill's loot, rolled with `roll` (uniform in [0, 1), called once for the units and once per resource; the server
 * passes its own random stream, tests a fixed value). Throws on a bad level, as the rest of the combat math does. */
export function killLoot(ref: MobRef, level: number, roll: () => number = () => 0.5): KillLoot {
  assertLevel(level);
  const stars = threatRating(ref) ?? COMBAT.threat.min;
  const between = ([lo, hi]: readonly [number, number]) => lo + (hi - lo) * Math.min(1, Math.max(0, roll()));
  const units = Math.max(1, Math.round(KILL_LOOT.unitsPerLevelStar * level * stars * between(KILL_LOOT.unitsSpread)));
  const items = dropsOf(ref).map((item) => ({ item, count: Math.max(1, Math.round(KILL_LOOT.resourcePerStar * stars * between(KILL_LOOT.resourceSpread))) }));
  return { xp: killXp(level), units, items };
}
