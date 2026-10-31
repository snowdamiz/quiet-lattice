// The recipes' persistence component (ARCHITECTURE §8, §23): the recipes a character knows, stored as the `recipes`
// entry of its `state` (v2, `{table, known: [ids]}`; v1 was the ids alone). It is earned, so a value that cannot be read
// refuses the join rather than being replaced; a character saved before crafting existed (no entry) gets the starting
// recipes. The recipe table can change under it, so on load it is reconciled with the table as it is now
// (`reconcileRecipes`): a recipe the table no longer has is dropped, one warning per character, unless the character was
// saved under a NEWER table (a server rolled back): then it keeps every recipe it learned, the warning says so, and the
// next save writes the newer table's version back so nothing is lost by the rollback.
import { RECIPE_TABLE, reconcileRecipes, startingStored, storedRecipesSchema, type RecipeTableView, type StoredRecipes } from '@astra/shared/crafting';
import type { CharacterComponent, ComponentRegistry, PersistenceLog } from '../persistence/registry.ts';
import { RecipeBook } from './book.ts';

export const RECIPES = 'recipes';

/** The component, and the book it loads into (so whoever holds the registry reaches the book: `recipeBookIn`). */
export interface RecipesComponent extends CharacterComponent<StoredRecipes> {
  readonly book: RecipeBook;
}

/** `table` stands in for the recipe table (tests give a rolled-back one); a build's own is the default. */
export function recipesComponent(book: RecipeBook, opts: { log?: PersistenceLog; table?: RecipeTableView } = {}): RecipesComponent {
  const table = opts.table ?? RECIPE_TABLE;
  return {
    key: RECIPES,
    v: 2,
    schema: storedRecipesSchema,
    // v1 was the ids alone, stored before the table had a version: under table 0, so it is reconciled like any older table's
    migrations: { 1: (data) => (data && typeof data === 'object' && !Array.isArray(data) ? { ...data, table: 0 } : data) },
    onInvalid: 'refuse',
    book,
    default: () => startingStored(),
    reconcile: (stored, ctx) => {
      const r = reconcileRecipes(stored, table);
      if (r.rolledBack)
        ctx.warn(
          { storedTable: stored.table, table: table.version, heldOver: r.heldOver },
          'recipes were learned under a newer recipe table than this server has; all kept, those it lacks cannot be made until it is back',
        );
      else if (r.dropped.length) ctx.warn({ dropped: r.dropped }, 'recipes no longer in the table since the character was saved; dropped');
      return r.stored;
    },
    load: (stored, ctx) => {
      const id = ctx.character.id;
      // What is stored is the truth: anything the book still holds for a character not in play is a leftover.
      if (book.close(id)) opts.log?.warn({ character: id }, 'recipes held for a character out of play; replaced by the stored ones');
      book.open(id, stored);
    },
    save: ({ characterId }) => {
      const k = book.get(characterId);
      return k ? { table: k.table, known: [...k.known] } : undefined;
    },
    unload: (characterId) => void book.close(characterId),
  };
}

/** The recipe book a registry's `recipes` component loads into, if it has one. */
export function recipeBookIn(registry: ComponentRegistry): RecipeBook | undefined {
  const c = registry.get(RECIPES) as Partial<RecipesComponent> | undefined;
  return c?.book instanceof RecipeBook ? c.book : undefined;
}
