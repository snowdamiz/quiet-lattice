// The meters' persistence component (ARCHITECTURE §8, §16): heat and Charge as the meter service holds them, stored as the
// `meters` entry of a character's `state` with the world time they stood at. It loads after the ship and the skills, whose
// hull and owned nodes set the capacities. On join heat goes on cooling from the time it was saved (a character that left
// overheated comes back cooled, as it would have been) and Charge is as the ship left it: it regenerates only in play.
// Nothing here is earned progress, so a value that cannot be read gives the default (cool, Charge full), logged.
import { freshMeters, meterProfile, meterSaveSchema, type MeterSave } from '@astra/shared/meters';
import type { ShipLoadout } from '@astra/shared/ships';
import type { SkillState } from '@astra/shared/skills';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';
import { SKILLS } from '../skills/component.ts';
import { MeterService } from './service.ts';

export const METERS = 'meters';
/** The ship component's key (persistence/components.ts, which registers this one). */
const SHIP = 'ship';

/** The component, and the service it loads into (so whoever holds the registry reaches the service: `meterServiceIn`). */
export interface MetersComponent extends CharacterComponent<MeterSave> {
  readonly service: MeterService;
}

export function metersComponent(meters: MeterService, opts: { log?: PersistenceLog } = {}): MetersComponent {
  return {
    key: METERS,
    v: 1,
    schema: meterSaveSchema,
    onInvalid: 'default',
    service: meters,
    // a new character, or one saved before the meters were: cool, its ship's Charge full
    default: (ctx) => {
      const profile = meterProfile({ ship: ctx.get<ShipLoadout | null>(SHIP), skills: ctx.get<SkillState>(SKILLS).bought });
      return { ...freshMeters(profile), at: 0 };
    },
    load: (saved, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything the service still holds for a character not in play is a leftover.
      if (meters.close(id)) opts.log?.warn({ character: id }, 'meters held for a character out of play; replaced by the stored ones');
      meters.open(id, saved);
    },
    save: ({ characterId }) => meters.get(characterId) ?? undefined,
    unload: (characterId) => void meters.close(characterId),
  };
}

/** The meter service a registry's `meters` component loads into, if it has one. */
export function meterServiceIn(registry: ComponentRegistry): MeterService | undefined {
  const c = registry.get(METERS) as Partial<MetersComponent> | undefined;
  return c?.service instanceof MeterService ? c.service : undefined;
}
