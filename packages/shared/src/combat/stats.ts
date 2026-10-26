// Applying stat modifiers (`@astra/shared/data` modifiers) to the numbers combat reads: a player's max health (Dense Bones,
// Second Skin), the damage they take (Grey Blood) and an ability's power (the Acidsalt catalyst). Order of application is
// the data's: every `add`, then every `mul`, then `set`.
import { COMBAT, getSkillNode } from '../data/index.ts';
import type { Branch, Stat, StatMod } from '../data/index.ts';

/** What a modifier's limits are checked against. */
export interface ModScope {
  /** The node whose effect is being computed; a mod limited to `nodes` applies only to those nodes. */
  readonly node?: string;
  /** That node's branch; a mod limited to a `branch` applies only to it. */
  readonly branch?: Branch;
  /** Whether a named condition holds now; a mod with a `when` is skipped unless it does. */
  readonly holds?: (condition: string) => boolean;
}

/** A stat after its modifiers: (base + Σ add) × Π mul, unless a `set` replaces it (the last `set` listed wins). */
export function applyStatMods(base: number, stat: Stat, mods: readonly StatMod[], scope: ModScope = {}): number {
  let add = 0;
  let mul = 1;
  let set: number | undefined;
  for (const m of mods) {
    if (m.stat !== stat) continue;
    if (m.when !== undefined && !scope.holds?.(m.when)) continue;
    if (m.branch !== undefined && m.branch !== scope.branch) continue;
    if (m.nodes !== undefined && (scope.node === undefined || !m.nodes.includes(scope.node))) continue;
    if (m.op === 'add') add += m.value;
    else if (m.op === 'mul') mul *= m.value;
    else set = m.value;
  }
  return set ?? (base + add) * mul;
}

/** Every stat modifier of these skill nodes, each node counted once. Throws on an unknown node id. */
export function modsOfNodes(nodeIds: Iterable<string>): StatMod[] {
  return [...new Set(nodeIds)].flatMap((id) => getSkillNode(id).mods);
}

/** A player's max health with the nodes they own (DESIGN 12.1: 100 today; Second Skin 150; Dense Bones +20%), plus any
 * other modifiers (catalysts, perks). */
export function playerMaxHealth(nodeIds: Iterable<string>, extraMods: readonly StatMod[] = [], scope: ModScope = {}): number {
  return applyStatMods(COMBAT.playerHealth, 'player.health_max', [...modsOfNodes(nodeIds), ...extraMods], scope);
}
