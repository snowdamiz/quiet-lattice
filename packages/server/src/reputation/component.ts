// The reputation's persistence component (ARCHITECTURE §8, §24): a character's standing by faction and the titles it has
// earned, stored as the `reputation` entry of its `state` (v1, `{rep, titles}`). It is earned, so a value that cannot be
// read refuses the join rather than being replaced; a character saved before reputation existed (no entry) has none. The
// faction table can change under it, so on load it is reconciled with the table as it is now (`reconcileReputation`):
// standing with a faction the table no longer has, and its ranks' titles, are dropped, one warning per character, and
// the next save writes it.
import { emptyReputation, reconcileReputation, reputationSchema, type Reputation } from '@astra/shared/reputation';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';
import { ReputationService } from './service.ts';

export const REPUTATION = 'reputation';

/** The component, and the service it loads into (so whoever holds the registry reaches the service:
 * `reputationServiceIn`). */
export interface ReputationComponent extends CharacterComponent<Reputation> {
  readonly service: ReputationService;
}

/**
 * `writtenWith`: the components it is only ever written together with (§8): the quest log, whose owed reputation is
 * settled into it on join, so the owed list and the standing it paid are saved in one row update or neither is.
 */
export function reputationComponent(service: ReputationService, opts: { log?: PersistenceLog; writtenWith?: readonly string[] } = {}): ReputationComponent {
  return {
    key: REPUTATION,
    v: 1,
    schema: reputationSchema,
    onInvalid: 'refuse',
    ...(opts.writtenWith?.length ? { writtenWith: [...opts.writtenWith] } : {}),
    service,
    default: () => emptyReputation(),
    reconcile: (stored, ctx) => {
      const r = reconcileReputation(stored);
      if (r.dropped.length) ctx.warn({ dropped: r.dropped }, 'factions no longer in the table since the character was saved; their standing dropped');
      return r.reputation;
    },
    load: (stored, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything the service still holds for a character not in play is a leftover.
      if (service.close(id)) opts.log?.warn({ character: id }, 'reputation held for a character out of play; replaced by the stored one');
      service.open(id, stored);
    },
    save: ({ characterId }) => {
      const r = service.get(characterId);
      return r ? structuredClone(r) : undefined;
    },
    unload: (characterId) => void service.close(characterId),
  };
}

/** The reputation service a registry's `reputation` component loads into, if it has one. */
export function reputationServiceIn(registry: ComponentRegistry): ReputationService | undefined {
  const c = registry.get(REPUTATION) as Partial<ReputationComponent> | undefined;
  return c?.service instanceof ReputationService ? c.service : undefined;
}
