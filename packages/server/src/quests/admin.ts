// The quest runtime's side of developer tooling (P1.E03.T07's QuestAdmin; docs/ARCHITECTURE.md §16, §17): the admin
// CLI's set-quest-step moves a character's quest to a step, in play through the runtime (its client is sent `quests`),
// out of play on the quest log persistence's edit loaded.
import type { QuestLog } from '@astra/shared/quests';
import type { QuestAdmin } from '../admin/service.ts';
import { QUESTS } from '../persistence/components.ts';
import type { QuestRuntime } from './runtime.ts';

export function questAdmin(quests: Pick<QuestRuntime, 'setStep' | 'setStepStored'>): QuestAdmin {
  return {
    component: QUESTS,
    setStep: (characterId, quest, step) => quests.setStep(characterId, quest, step),
    // (persistence's edit hands over the stored value decoded, migrated and checked as a join would load it)
    setStepStored: (log, quest, step) => quests.setStepStored(log as QuestLog, quest, step),
  };
}
