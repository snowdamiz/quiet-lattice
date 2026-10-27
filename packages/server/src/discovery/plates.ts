// Codex plates (DESIGN 14.5, P2.E29.T01; ARCHITECTURE §8, §26): the first finds a character made, each with when, held
// while it is in play and stored as the `plates` entry of its `state` (v1, `{plates: [{kind, key, at}]}`). A plate is
// also the record that its find's XP was paid: the discovery service pays a find to its finder only while it has no
// plate, and both land in the same save, so a find is paid once whenever its reward is looked at (as it is found, and
// again on every join for any find the character made that its plates do not show). It is earned, so a value that
// cannot be read refuses the join rather than being replaced.
import { addPlate, emptyPlates, hasPlate, platesSchema, type DiscoveryKind, type Plate, type Plates } from '@astra/shared/discovery';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';

export const PLATES = 'plates';

/** A character the book does not hold (out of play). */
export class PlatesNotHeldError extends Error {
  constructor(readonly characterId: string) {
    super(`the plates of ${characterId} are not held: the character is not in play`);
    this.name = 'PlatesNotHeldError';
  }
}

/** Each character in play's plates. */
export class PlateBook {
  private readonly held = new Map<string, Plates>();

  /** Puts a character's plates in play (persistence, on join). */
  open(characterId: string, plates: Plates = emptyPlates()): void {
    this.held.set(characterId, { plates: plates.plates.map((p) => ({ ...p })) });
  }

  /** Forgets a character (persistence, once its last save is captured); true when it was held. */
  close(characterId: string): boolean {
    return this.held.delete(characterId);
  }

  holds(characterId: string): boolean {
    return this.held.has(characterId);
  }

  /** The live plates of a character in play (what persistence saves), or undefined. */
  get(characterId: string): Readonly<Plates> | undefined {
    return this.held.get(characterId);
  }

  has(characterId: string, kind: DiscoveryKind, key: string): boolean {
    const p = this.held.get(characterId);
    return !!p && hasPlate(p, kind, key);
  }

  /** Adds a plate: `added`, `known` (the find has one) or `full`. Throws for a character out of play. */
  add(characterId: string, plate: Plate): 'added' | 'known' | 'full' {
    const p = this.held.get(characterId);
    if (!p) throw new PlatesNotHeldError(characterId);
    return addPlate(p, plate);
  }
}

/** The component, and the book it loads into (so whoever holds the registry reaches the book: `plateBookIn`). */
export interface PlatesComponent extends CharacterComponent<Plates> {
  readonly book: PlateBook;
}

export function platesComponent(book: PlateBook, opts: { log?: PersistenceLog } = {}): PlatesComponent {
  return {
    key: PLATES,
    v: 1,
    schema: platesSchema,
    onInvalid: 'refuse',
    book,
    default: () => emptyPlates(),
    load: (stored, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything the book still holds for a character not in play is a leftover.
      if (book.close(id)) opts.log?.warn({ character: id }, 'plates held for a character out of play; replaced by the stored ones');
      book.open(id, stored);
    },
    save: ({ characterId }) => {
      const p = book.get(characterId);
      return p ? { plates: p.plates.map((x) => ({ ...x })) } : undefined;
    },
    unload: (characterId) => void book.close(characterId),
  };
}

/** The plate book a registry's `plates` component loads into, if it has one. */
export function plateBookIn(registry: ComponentRegistry): PlateBook | undefined {
  const c = registry.get(PLATES) as Partial<PlatesComponent> | undefined;
  return c?.book instanceof PlateBook ? c.book : undefined;
}
