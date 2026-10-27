// Every quest step's cutscene is one the cutscene service has (its catalog), unless the step marks it planned (not
// authored yet); a planned one that has since been authored must drop the mark.
import { CUTSCENE_TEST_QUEST, QUESTS } from '@astra/shared/quests';
import { describe, expect, it } from 'vitest';
import { CUTSCENES } from '../cutscenes/catalog.ts';

describe('quest cutscenes and the cutscene catalog', () => {
  it('names only cutscenes the service has, or marks them planned while they are not', () => {
    const steps = [...QUESTS, CUTSCENE_TEST_QUEST].flatMap((q) => q.steps.map((s) => ({ quest: q.id, s })));
    const cutscenes = steps.filter(({ s }) => s.type === 'cutscene');
    expect(cutscenes.length).toBeGreaterThan(0);
    for (const { quest, s } of cutscenes) {
      if (s.type !== 'cutscene') continue;
      const known = Object.hasOwn(CUTSCENES, s.cutscene);
      expect(known, `${quest}/${s.id}: cutscene ${s.cutscene} ${s.planned ? 'is authored: drop planned' : 'does not exist'}`).toBe(!s.planned);
    }
  });
});
