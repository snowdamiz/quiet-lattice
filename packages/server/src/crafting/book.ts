// Every character in play's recipes (DESIGN 15.7: "learned once, kept forever"; P1.E13.T05, ARCHITECTURE §23):
// persistence opens a character's knowledge on join (the `recipes` component), saves it and closes it; the crafting
// service reads it for every craft and adds to it when a recipe item is used. Nothing a client sends reaches it directly.
import { recipeById, startingKnowledge, type KnownRecipes } from '@astra/shared/crafting';

/** A character the book does not hold (out of play). */
export class RecipesNotHeldError extends Error {
  constructor(readonly characterId: string) {
    super(`the recipes of ${characterId} are not held: the character is not in play`);
    this.name = 'RecipesNotHeldError';
  }
}

export class RecipeBook {
  private readonly held = new Map<string, KnownRecipes>();

  /** Puts a character's knowledge in play (persistence, on join). */
  open(characterId: string, knowledge: KnownRecipes = startingKnowledge()): void {
    this.held.set(characterId, { known: [...knowledge.known] });
  }

  /** Forgets a character (persistence, once its last save is captured); true when it was held. */
  close(characterId: string): boolean {
    return this.held.delete(characterId);
  }

  holds(characterId: string): boolean {
    return this.held.has(characterId);
  }

  /** The live knowledge of a character in play (what persistence saves), or undefined. */
  get(characterId: string): Readonly<KnownRecipes> | undefined {
    return this.held.get(characterId);
  }

  /** Whether a character in play knows a recipe. */
  knows(characterId: string, recipe: string): boolean {
    return this.held.get(characterId)?.known.includes(recipe) ?? false;
  }

  /** Records a recipe learned for good: false when it was known already. Throws for a character out of play, or a recipe
   * the table lacks (the crafting service checks both first). */
  learn(characterId: string, recipe: string): boolean {
    const k = this.held.get(characterId);
    if (!k) throw new RecipesNotHeldError(characterId);
    if (!recipeById(recipe)) throw new RangeError(`no recipe ${recipe}`);
    if (k.known.includes(recipe)) return false;
    k.known.push(recipe);
    return true;
  }
}
