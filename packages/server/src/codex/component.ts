// The codex's persistence component (ARCHITECTURE §8, §22): the species a character has analyzed, per world, stored as the
// `codex` entry of its `state` (v1). It is earned, so a value that cannot be read refuses the join rather than being
// replaced. The species data it records can change under it (the fauna generator, the threat table), so on load it is
// reconciled with the data as it is now (`reconcileCodex`): a world that no longer has fauna and a species past its
// world's list are dropped, and an entry whose species changed takes its new temperament, threat, body plan and Bond
// reach, keeping when it was first analyzed; one warning per character lists the changes, and the next save writes it.
import { codexSchema, emptyCodex, reconcileCodex, type Codex } from '@astra/shared/codex';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';
import { CodexService } from './service.ts';
import { worldSpeciesAt } from './species.ts';

export const CODEX = 'codex';

/** The component, and the service it loads into (so whoever holds the registry reaches the service: `codexServiceIn`). */
export interface CodexComponent extends CharacterComponent<Codex> {
  readonly service: CodexService;
}

/** Changes listed in one warning, at most. */
const CHANGES_LOGGED = 32;

export function codexComponent(codex: CodexService, opts: { log?: PersistenceLog } = {}): CodexComponent {
  return {
    key: CODEX,
    v: 1,
    schema: codexSchema,
    onInvalid: 'refuse',
    service: codex,
    default: () => emptyCodex(),
    reconcile: (stored, ctx) => {
      const r = reconcileCodex(stored, worldSpeciesAt);
      if (r.changes.length)
        ctx.warn(
          { count: r.changes.length, changes: r.changes.slice(0, CHANGES_LOGGED) },
          'species data changed since the character was saved; codex reconciled',
        );
      return r.codex;
    },
    load: (stored, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything the service still holds for a character not in play is a leftover.
      if (codex.close(id)) opts.log?.warn({ character: id }, 'codex held for a character out of play; replaced by the stored one');
      codex.open(id, stored);
    },
    save: ({ characterId }) => codex.get(characterId) ?? undefined,
    unload: (characterId) => void codex.close(characterId),
  };
}

/** The codex service a registry's `codex` component loads into, if it has one. */
export function codexServiceIn(registry: ComponentRegistry): CodexService | undefined {
  const c = registry.get(CODEX) as Partial<CodexComponent> | undefined;
  return c?.service instanceof CodexService ? c.service : undefined;
}
