// What a kill is worth (DESIGN 12.1, 14.9; P1.E06.T02): XP of mob level × 10, units by level and threat, and a row's drops.
import { describe, expect, it } from 'vitest';
import { KILL_LOOT, killLoot, killXp, threatRating } from '../../src/combat/index.ts';
import type { MobRef } from '../../src/combat/index.ts';
import { getBoss, getMob } from '../../src/data/index.ts';

const grazer: MobRef = { kind: 'fauna', bodyPlan: 'quad_grazer', temperament: 'docile' };
const pack: MobRef = { kind: 'fauna', bodyPlan: 'quad_small', temperament: 'predator' };

describe('a kill', () => {
  it('is worth its level × 10 in XP (DESIGN 14.9)', () => {
    expect(killLoot(grazer, 3).xp).toBe(30);
    expect(killLoot(pack, 15).xp).toBe(killXp(15));
  });

  it('is worth units by its level and threat, spread by the roll, and at least one', () => {
    const base = (ref: MobRef, level: number) => KILL_LOOT.unitsPerLevelStar * level * threatRating(ref)!;
    expect(killLoot(grazer, 3).units).toBe(Math.round(base(grazer, 3)));
    expect(killLoot(pack, 15, () => 0).units).toBe(Math.round(base(pack, 15) * KILL_LOOT.unitsSpread[0]));
    expect(killLoot(pack, 15, () => 1).units).toBe(Math.round(base(pack, 15) * KILL_LOOT.unitsSpread[1]));
    expect(killLoot(grazer, 1, () => 0).units).toBeGreaterThanOrEqual(1);
  });

  it("drops no resources from a living herd, Count residue from a stone-touched one, and a row's own drops", () => {
    expect(killLoot(grazer, 10).items).toEqual([]);
    expect(killLoot({ ...grazer, stoneTouched: true }, 10).items.map((i) => i.item)).toEqual(getMob('stone_touched').drops);
    for (const it of killLoot({ ...grazer, stoneTouched: true }, 10).items) expect(it.count).toBeGreaterThanOrEqual(1);
    const hive = getBoss('hive_heart');
    expect(killLoot({ kind: 'boss', id: hive.id }, 45).items.map((i) => i.item)).toEqual(hive.loot.resources);
  });

  it('refuses a level outside 1–50', () => {
    for (const bad of [0, 51, 2.5, NaN]) expect(() => killLoot(grazer, bad)).toThrow(RangeError);
  });
});
