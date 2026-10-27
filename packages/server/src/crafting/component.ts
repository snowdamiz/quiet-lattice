// The recipes' persistence component (ARCHITECTURE §8, §23): the recipes a character knows, stored as the `recipes`
// entry of its `state` (v1, `{known: [ids]}`). It is earned, so a value that cannot be read refuses the join rather than
// being replaced; a character saved before crafting existed (no entry) gets the starting recipes. The recipe table can
// change under it, so on load it is reconciled with the table as it is now (`reconcileKnown`): a recipe the table no
// longer has is dropped, one warning per character, and the next save writes it.
import { knownRecipesSchema, reconcileKnown, startingKnowledge, type KnownRecipes } from '@astra/shared/crafting';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';
import { RecipeBook } from './book.ts';

export const RECIPES = 'recipes';

/** The component, and the book it loads into (so whoever holds the registry reaches the book: `recipeBookIn`). */
export interface RecipesComponent extends CharacterComponent<KnownRecipes> {
  readonly book: RecipeBook;
}

export function recipesComponent(book: RecipeBook, opts: { log?: PersistenceLog } = {}): RecipesComponent {
  return {
    key: RECIPES,
    v: 1,
    schema: knownRecipesSchema,
    onInvalid: 'refuse',
    book,
    default: () => startingKnowledge(),
    reconcile: (stored, ctx) => {
      const r = reconcileKnown(stored);
      if (r.dropped.length) ctx.warn({ dropped: r.dropped }, 'recipes no longer in the table since the character was saved; dropped');
      return r.knowledge;
    },
    load: (stored, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything the book still holds for a character not in play is a leftover.
      if (book.close(id)) opts.log?.warn({ character: id }, 'recipes held for a character out of play; replaced by the stored ones');
      book.open(id, stored);
    },
    save: ({ characterId }) => {
      const k = book.get(characterId);
      return k ? { known: [...k.known] } : undefined;
    },
    unload: (characterId) => void book.close(characterId),
  };
}

/** The recipe book a registry's `recipes` component loads into, if it has one. */
export function recipeBookIn(registry: ComponentRegistry): RecipeBook | undefined {
  const c = registry.get(RECIPES) as Partial<RecipesComponent> | undefined;
  return c?.book instanceof RecipeBook ? c.book : undefined;
}
