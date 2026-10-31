// The quest runtime's rewards and ranks the reputation service takes (P2.E18.T01, ARCHITECTURE §17, §24): a quest's
// reputation (its rewards' and its dialogue answers') through `grant`, its title through `earnTitle` (with the factions
// the quest pays reputation to, so a chain's last quest naming its rank's title gives that rank's title, never a second
// one), and the character's rank with a faction for rank prerequisites. A character the service does not hold (out of
// play) declines, and the runtime keeps the reward owed until the next join settles it.
import type { FactionId } from '@astra/shared/data';
import { getQuest, type QuestDef } from '@astra/shared/quests';
import type { QuestRewardHooks } from '../quests/runtime.ts';
import type { ReputationService } from './service.ts';

/** Every faction a quest pays reputation to, in its rewards, its steps' or its answers'. */
export function questFactions(def: QuestDef | undefined): FactionId[] {
  if (!def) return [];
  const out = new Set<FactionId>();
  const add = (rep: readonly { faction: FactionId; amount: number }[] | undefined) => {
    for (const r of rep ?? []) if (r.amount > 0) out.add(r.faction);
  };
  add(def.rewards.rep);
  for (const s of def.steps) {
    add(s.rewards?.rep);
    if (s.type === 'dialogue') for (const c of s.choices) add(c.rep);
  }
  return [...out];
}

export function reputationRewardHooks(
  reputation: () => ReputationService | undefined,
  catalog: (id: string) => QuestDef | undefined = getQuest,
): Pick<QuestRewardHooks, 'rep' | 'title' | 'rankOf'> {
  return {
    rep: (characterId, faction, amount, quest) => {
      const r = reputation();
      return !!r && r.grant(characterId, faction, amount, { reason: `quest:${quest}` }) !== null;
    },
    // (a title held already counts as given: a repeat of its quest gives nothing new)
    title: (characterId, title, quest) => {
      const r = reputation();
      return !!r && r.earnTitle(characterId, title, { quest, factions: questFactions(catalog(quest)) }) !== null;
    },
    rankOf: (characterId, faction) => reputation()?.rankOf(characterId, faction) ?? null,
  };
}
