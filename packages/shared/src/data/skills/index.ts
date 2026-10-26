// The skill web (DESIGN 9): seven branches of 18 nodes and six conjunctions, 132 nodes, 152 points to own everything.
import { lookup, table } from '../common.ts';
import type { Branch } from '../common.ts';
import { CONJUNCTIONS } from './conjunctions.ts';
import { EXOSUIT } from './exosuit.ts';
import { GRAVITIC } from './gravitic.ts';
import { PILOT } from './pilot.ts';
import { RESONANCE } from './resonance.ts';
import type { SkillNode } from './schema.ts';
import { SYMBIOTIC } from './symbiotic.ts';
import { THERMAL } from './thermal.ts';
import { VOID } from './void.ts';

export * from './schema.ts';

/** Every node of the web, branch by branch in DESIGN's order, conjunctions last. */
export const SKILL_NODES = table<SkillNode>([...GRAVITIC, ...THERMAL, ...RESONANCE, ...SYMBIOTIC, ...VOID, ...PILOT, ...EXOSUIT, ...CONJUNCTIONS]);

export const getSkillNode = lookup(SKILL_NODES, 'skill node');

/** A branch's nodes (not its conjunctions). */
export function branchOf(branch: Branch): readonly SkillNode[] {
  return SKILL_NODES.filter((n) => n.branch === branch);
}

/** Points to own every node of the web. */
export function webPointCost(nodes: readonly SkillNode[] = SKILL_NODES): number {
  return nodes.reduce((sum, n) => sum + n.pointCost, 0);
}
