// The recipes persistence component (P1.E13.T05, ARCHITECTURE §8, §23): registered after the codex, leading to the book
// it loads into; a new character (or one saved before crafting) knows the starting recipes; saved recipes load into the
// book, are saved back with what was learned since, and are evicted on leave; ones stored under an older recipe table are
// reconciled with the table as it is now (one warning, written back); ones that cannot be read refuse the join rather
// than lose what was learned.
import { STARTING_RECIPES } from '@astra/shared/crafting';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, CODEX, coreRegistry, PROGRESS, RECIPES, ShipLoadouts } from '../persistence/components.ts';
import { CharacterLoadError, ComponentRegistry, type PersistenceLog, type StoredCharacter } from '../persistence/registry.ts';
import { CharacterPersistence } from '../persistence/service.ts';
import type { CharacterStore } from '../persistence/store.ts';
import { homeSystemOf } from '../world/home.ts';
import { ZoneManager } from '../zones/manager.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { RecipeBook } from './book.ts';
import { recipeBookIn } from './component.ts';

const HOME = homeSystemOf('thalune');
const CHARACTER = { id: 'c1', name: 'Ves', people: 'thalune' as const, homeSystem: HOME };

class Sink implements ZoneViewer {
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

function world(given?: RecipeBook) {
  const clock = { now: () => 1000 };
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  const registry = coreRegistry({
    zones: new ZoneManager({ clock }),
    clock,
    inventory: new InventoryService(),
    ships: new ShipLoadouts(),
    progress: new CharacterProgress(),
    recipes: given,
    log,
  });
  const book = recipeBookIn(registry)!;
  const writes: { state: StoredCharacter['state'] }[] = [];
  const store: CharacterStore = {
    write: async (rows) => {
      writes.push(...(rows as unknown as typeof writes));
      return new Set(rows.map((r) => r.id));
    },
  };
  const persistence = new CharacterPersistence({ store, registry, log });
  return { registry, book, lines, writes, persistence };
}

function stored(state: StoredCharacter['state'] = {}): StoredCharacter {
  return { revision: 0, columns: { level: 1, xp: 0, homeSystem: HOME }, state };
}

describe('the recipes component', () => {
  it('loads after the codex, and leads to the book it loads into', () => {
    const { registry, book } = world();
    const keys = registry.components.map((c) => c.key);
    expect(keys.indexOf(RECIPES)).toBe(keys.indexOf(CODEX) + 1);
    expect(book).toBeInstanceOf(RecipeBook);
    const given = new RecipeBook();
    expect(world(given).book).toBe(given);
    expect(recipeBookIn(new ComponentRegistry())).toBeUndefined();
  });

  it('gives a new character (or one saved before crafting) the starting recipes', () => {
    const { registry } = world();
    expect(registry.decode(stored(), CHARACTER).values.get(RECIPES)).toEqual({ known: [...STARTING_RECIPES] });
  });

  it('loads the saved recipes into the book, saves them with what was learned since, and evicts them on leave', async () => {
    const { book, persistence, writes } = world();
    const v = new Sink(1);
    persistence.join(v, { ...CHARACTER, level: 1, xp: 0, revision: 0, state: { recipes: { v: 1, data: { known: ['warp_cell', 'cargo_pod'] } } } });
    expect(book.get('c1')).toEqual({ known: ['warp_cell', 'cargo_pod'] });
    expect(book.learn('c1', 'torpedo')).toBe(true);
    persistence.leave(v);
    expect(book.holds('c1')).toBe(false);
    await persistence.flush();
    expect(writes.at(-1)!.state.recipes).toEqual({ v: 1, data: { known: ['warp_cell', 'cargo_pod', 'torpedo'] } });
  });

  it('drops recipes the table no longer has: one warning, the rest in play, written back at the next save', async () => {
    const { book, persistence, writes, lines } = world();
    const v = new Sink(1);
    persistence.join(v, {
      ...CHARACTER,
      level: 1,
      xp: 0,
      revision: 0,
      state: { recipes: { v: 1, data: { known: ['warp_cell', 'old_warp_core', 'torpedo'] } } },
    });
    expect(book.get('c1')).toEqual({ known: ['warp_cell', 'torpedo'] });
    const warned = lines.filter((l) => l.level === 'warn' && l.msg === 'recipes no longer in the table since the character was saved; dropped');
    expect(warned).toHaveLength(1);
    expect(warned[0]!.obj).toMatchObject({ character: 'c1', component: RECIPES, dropped: ['old_warp_core'] });
    persistence.leave(v);
    await persistence.flush();
    expect(writes.at(-1)!.state.recipes).toEqual({ v: 1, data: { known: ['warp_cell', 'torpedo'] } });
  });

  it('refuses recipes it cannot read rather than lose what was learned', () => {
    const { registry } = world();
    for (const entry of [
      { v: 2, data: { known: ['warp_cell'] } },
      { v: 1, data: { known: ['warp_cell', 'warp_cell'] } },
      { v: 1, data: { known: ['Warp Cell'] } },
      { v: 1, data: ['warp_cell'] },
      { v: 1, data: { known: ['warp_cell'], forgotten: [] } },
    ]) {
      let err: unknown;
      try {
        registry.decode(stored({ recipes: entry as StoredCharacter['state'][string] }), CHARACTER);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(entry)).toBeInstanceOf(CharacterLoadError);
      expect((err as CharacterLoadError).component).toBe(RECIPES);
    }
    // the rest of the character is untouched by it
    expect(registry.decode(stored({ recipes: { v: 1, data: { known: [] } } }), CHARACTER).values.get(PROGRESS)).toEqual({ level: 1, xp: 0, homeSystem: HOME });
  });
});
