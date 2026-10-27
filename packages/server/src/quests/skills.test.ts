// The quest rewards the skill service takes: skill points, a node unlocked through its quest route (Hazard Weave by "The
// Apothecary's Sodium", once, and again counted as given), a node the route does not cover left owed, the view refreshed
// on a level, and nothing taken for a character the service does not hold.
import { newSkillState } from '@astra/shared/skills';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, ShipLoadouts } from '../persistence/components.ts';
import { SkillService } from '../skills/service.ts';
import { skillRewardHooks } from './skills.ts';

describe('quest rewards through the skill service', () => {
  it('grants points, unlocks a node by its quest route, refreshes on a level, and declines what it cannot take', () => {
    const inventory = new InventoryService();
    const progress = new CharacterProgress();
    const skills = new SkillService({ inventory, ships: new ShipLoadouts(), progress });
    inventory.open('c1');
    progress.set('c1', { level: 3, xp: 0, homeSystem: 0 });
    skills.open('c1', newSkillState('ulgani'), 'ulgani');
    const pushed: string[] = [];
    skills.subscribe((id, _reply, change) => pushed.push(`${id}:${change}`));
    const hooks = skillRewardHooks(() => skills);

    expect(hooks.skillPoints!('c1', 1)).toBe(true);
    expect(skills.get('c1')!.granted).toBe(1);
    expect(hooks.node!('c1', 'hazard_weave', 'the_apothecarys_sodium')).toBe(true);
    expect(skills.get('c1')!.unlocked).toContain('hazard_weave');
    // (unlocked already: given)
    expect(hooks.node!('c1', 'hazard_weave', 'the_apothecarys_sodium')).toBe(true);
    // a quest the node does not list as a route: declined, so the runtime holds it as owed
    expect(hooks.node!('c1', 'cold_blood', 'the_apothecarys_sodium')).toBe(false);
    pushed.length = 0;
    hooks.levelled!('c1', 4);
    expect(pushed).toEqual(['c1:server']);
    expect(skillRewardHooks(() => undefined).skillPoints!('c1', 1)).toBe(false);
  });
});
