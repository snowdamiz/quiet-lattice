// The season awards' persistence component (ARCHITECTURE §8, §27): the titles and glyphs a character carries from the
// seasons its account's philosophy won, stored as the `seasonAwards` entry of its `state` (v1, `{awards: [...]}`, one a
// season, oldest first). It is earned, so a value that cannot be read refuses the join rather than being replaced; a
// character with no entry has none. The account's awards in `season_awards` are the record: the gateway merges them in
// as the character enters the world, so one the character missed (it was out of play when the season ended) reaches it.
import { storedSeasonAwardsSchema, type StoredSeasonAwards } from '@astra/shared/seasons';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';
import { SeasonAwards } from './awards.ts';

export const SEASON_AWARDS = 'seasonAwards';

/** The component, and the holder it loads into (so whoever holds the registry reaches it: `seasonAwardsIn`). */
export interface SeasonAwardsComponent extends CharacterComponent<StoredSeasonAwards> {
  readonly awards: SeasonAwards;
}

/**
 * `writtenWith`: the components it is only ever written together with (§8): the reputation, which holds the titles its
 * awards earn, so an award never reaches the row without its title (nothing earns the title again on a later join).
 */
export function seasonAwardsComponent(awards: SeasonAwards, opts: { log?: PersistenceLog; writtenWith?: readonly string[] } = {}): SeasonAwardsComponent {
  return {
    key: SEASON_AWARDS,
    v: 1,
    schema: storedSeasonAwardsSchema,
    onInvalid: 'refuse',
    ...(opts.writtenWith?.length ? { writtenWith: [...opts.writtenWith] } : {}),
    awards,
    default: () => ({ awards: [] }),
    load: (stored, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything still held for a character not in play is a leftover.
      if (awards.close(id)) opts.log?.warn({ character: id }, 'season awards held for a character out of play; replaced by the stored ones');
      awards.open(id, stored);
    },
    save: ({ characterId }) => {
      const a = awards.get(characterId);
      return a ? { awards: a.map((x) => ({ ...x })) } : undefined;
    },
    unload: (characterId) => void awards.close(characterId),
  };
}

/** The season awards a registry's `seasonAwards` component loads into, if it has one. */
export function seasonAwardsIn(registry: ComponentRegistry): SeasonAwards | undefined {
  const c = registry.get(SEASON_AWARDS) as Partial<SeasonAwardsComponent> | undefined;
  return c?.awards instanceof SeasonAwards ? c.awards : undefined;
}
