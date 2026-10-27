// The skill web's persistence component (ARCHITECTURE §8, §14): the state the skill service holds, stored as the `skills`
// entry of a character's `state`. It loads before the ship and the inventory, which read the owned nodes (Pack Mule's
// cargo bay and stack cap). Earned progress: an unreadable value refuses the join rather than reset it.
import { newSkillState, skillStateProblem, skillStateSchema, type SkillState } from '@astra/shared/skills';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';
import { SkillService } from './service.ts';

export const SKILLS = 'skills';

/** The component, and the service it loads into (so whoever holds the registry reaches the service: `skillServiceIn`). */
export interface SkillsComponent extends CharacterComponent<SkillState> {
  readonly service: SkillService;
}

export function skillsComponent(skills: SkillService, opts: { log?: PersistenceLog } = {}): SkillsComponent {
  return {
    key: SKILLS,
    v: 1,
    schema: skillStateSchema,
    onInvalid: 'refuse',
    service: skills,
    // a new character, or one saved before the web existed: its people's node unlocked, nothing else
    default: (ctx) => newSkillState(ctx.character.people),
    check: skillStateProblem,
    load: (state, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything the service still holds for a character not in play is a leftover.
      if (skills.close(id)) opts.log?.warn({ character: id }, 'skills held for a character out of play; replaced by the stored ones');
      skills.open(id, state, ctx.character.people);
      // only a level or grant taken back overspends; the nodes stay owned and buying waits for points
      const points = skills.points(id);
      if (points.available < 0) ctx.warn({ points }, 'more skill points spent than earned');
    },
    save: ({ characterId }) => skills.get(characterId) ?? undefined,
    unload: (characterId) => void skills.close(characterId),
  };
}

/** The skill service a registry's `skills` component loads into, if it has one. */
export function skillServiceIn(registry: ComponentRegistry): SkillService | undefined {
  const c = registry.get(SKILLS) as Partial<SkillsComponent> | undefined;
  return c?.service instanceof SkillService ? c.service : undefined;
}
