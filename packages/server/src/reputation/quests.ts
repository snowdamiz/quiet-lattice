// The quest runtime's rewards and ranks the reputation service takes (P2.E18.T01, ARCHITECTURE §17, §24): a quest's
// reputation (its rewards' and its dialogue answers') through `grant`, its title through `earnTitle`, and the character's
// rank with a faction for rank prerequisites. A character the service does not hold (out of play) declines, and the
// runtime keeps the reward owed until the next join settles it.
import type { QuestRewardHooks } from '../quests/runtime.ts';
import type { ReputationService } from './service.ts';

export function reputationRewardHooks(reputation: () => ReputationService | undefined): Pick<QuestRewardHooks, 'rep' | 'title' | 'rankOf'> {
  return {
    rep: (characterId, faction, amount, quest) => {
      const r = reputation();
      return !!r && r.grant(characterId, faction, amount, { reason: `quest:${quest}` }) !== null;
    },
    // (a title held already counts as given: a repeat of its quest gives nothing new)
    title: (characterId, title, quest) => {
      const r = reputation();
      return !!r && r.earnTitle(characterId, title, quest) !== null;
    },
    rankOf: (characterId, faction) => reputation()?.rankOf(characterId, faction) ?? null,
  };
}
