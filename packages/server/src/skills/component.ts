// The skill web's persistence component (ARCHITECTURE §8, §14): the state the skill service holds, stored as the `skills`
// entry of a character's `state` with the web it was stored under and what each unlock paid (v2, P1.E07.T15; v1 was the
// state alone). It loads before the ship and the inventory, which read the owned nodes (Pack Mule's cargo bay and stack
// cap). A value stored under an older web is reconciled with this build's on load, one warning per character, and never
// refused for it; earned progress that is unreadable (its structure, or a newer web's) refuses the join rather than reset.
import {
  migrateSkillsV1,
  newSkillState,
  reconcileSkills,
  skillStateOf,
  storedSkills,
  storedSkillsProblem,
  storedSkillsSchema,
  type StoredSkills,
} from '@astra/shared/skills';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';
import { SkillService } from './service.ts';

export const SKILLS = 'skills';

/** The component, and the service it loads into (so whoever holds the registry reaches the service: `skillServiceIn`). */
export interface SkillsComponent extends CharacterComponent<StoredSkills> {
  readonly service: SkillService;
}

export function skillsComponent(skills: SkillService, opts: { log?: PersistenceLog } = {}): SkillsComponent {
  return {
    key: SKILLS,
    v: 2,
    schema: storedSkillsSchema,
    migrations: { 1: migrateSkillsV1 },
    onInvalid: 'refuse',
    service: skills,
    // a new character, or one saved before the web existed: its people's node unlocked, nothing else
    default: (ctx) => storedSkills(newSkillState(ctx.character.people)),
    reconcile: (stored, ctx) => {
      const r = reconcileSkills(stored);
      if (r.changes.length)
        ctx.warn({ from: stored.web, to: r.stored.web, changes: r.changes }, 'skill web changed since the character was saved; skills reconciled');
      return r.stored;
    },
    check: (stored) => storedSkillsProblem(stored),
    load: (stored, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything the service still holds for a character not in play is a leftover.
      if (skills.close(id)) opts.log?.warn({ character: id }, 'skills held for a character out of play; replaced by the stored ones');
      skills.open(id, skillStateOf(stored), ctx.character.people, stored.paid);
      // only a level or grant taken back overspends; the nodes stay owned and buying waits for points
      const points = skills.points(id);
      if (points.available < 0) ctx.warn({ points }, 'more skill points spent than earned');
    },
    save: ({ characterId }) => skills.stored(characterId) ?? undefined,
    unload: (characterId) => void skills.close(characterId),
  };
}

/** The skill service a registry's `skills` component loads into, if it has one. */
export function skillServiceIn(registry: ComponentRegistry): SkillService | undefined {
  const c = registry.get(SKILLS) as Partial<SkillsComponent> | undefined;
  return c?.service instanceof SkillService ? c.service : undefined;
}
