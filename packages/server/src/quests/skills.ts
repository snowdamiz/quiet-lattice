// The quest runtime's rewards the skill service takes (P1.E07.T01, DECISIONS P1.E07.T01): skill points through
// `grantPoints`, a node unlocked through the node's quest route (`unlock` with the quest that teaches it: Hazard Weave
// and "The Apothecary's Sodium"), and the skill view refreshed when a quest's XP raises the level. A node already
// unlocked counts as given; any other refusal (past the phase ceiling, a route the node does not list) leaves the reward
// owed, as does a skill service that is not there.
import type { SkillService } from '../skills/service.ts';
import type { QuestRewardHooks } from './runtime.ts';

export function skillRewardHooks(skills: () => SkillService | undefined): Pick<QuestRewardHooks, 'skillPoints' | 'node' | 'levelled'> {
  return {
    skillPoints: (characterId, count) => skills()?.grantPoints(characterId, count).ok ?? false,
    node: (characterId, node, quest) => {
      const r = skills()?.unlock(characterId, node, { kind: 'quest', quest });
      return !!r && (r.ok || r.error.code === 'already_unlocked');
    },
    levelled: (characterId) => skills()?.refresh(characterId),
  };
}
