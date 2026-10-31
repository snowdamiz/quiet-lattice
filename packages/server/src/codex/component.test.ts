// The codex persistence component (P1.E08.T04, ARCHITECTURE §8, §22): registered after the pose, leading to the service it
// loads into; a new character's codex is empty; a saved one loads into the service, is saved back with what was analyzed
// since, and is evicted on leave; one stored under older species data is reconciled with the data as it is now (one
// warning, written back); one that cannot be read refuses the join rather than lose what was earned.
import { codexEntryFor, emptyCodex, SPECIES_XP, type Codex } from '@astra/shared/codex';
import { faunaSpecies, FAUNA_MAX_TIER, frameId, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, CODEX, coreRegistry, POSE, PROGRESS, ShipLoadouts } from '../persistence/components.ts';
import { CharacterLoadError, ComponentRegistry, type PersistenceLog, type StoredCharacter } from '../persistence/registry.ts';
import { CharacterPersistence } from '../persistence/service.ts';
import type { CharacterStore } from '../persistence/store.ts';
import { homeSystemOf } from '../world/home.ts';
import { ZoneManager } from '../zones/manager.ts';
import { describeZoneSystem } from '../zones/system.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { codexServiceIn } from './component.ts';
import { CodexService } from './service.ts';
import { worldSpeciesAt } from './species.ts';

const HOME = homeSystemOf('thalune');
const CHARACTER = { id: 'c1', name: 'Ves', people: 'thalune' as const, homeSystem: HOME };
const system = describeZoneSystem(HOME);
/** A world of the home system with fauna (three species at least), and one without (a gas giant or a bare world). */
const living = system.bodies.find((b) => b.type !== 'gas' && faunaSpecies(b.params as PlanetParams, FAUNA_MAX_TIER).length >= 3)!;
const lifeless = system.bodies.find((b) => b.type === 'gas' || faunaSpecies(b.params as PlanetParams, FAUNA_MAX_TIER).length === 0)!;
const W = frameId(system.seed, living.index);
const species = faunaSpecies(living.params as PlanetParams, FAUNA_MAX_TIER);

class Sink implements ZoneViewer {
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

function world() {
  const clock = { now: () => 1000 };
  const zones = new ZoneManager({ clock });
  const progress = new CharacterProgress();
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  const registry = coreRegistry({ zones, clock, inventory: new InventoryService(), ships: new ShipLoadouts(), progress, log });
  const codex = codexServiceIn(registry)!;
  const writes: { state: StoredCharacter['state']; columns: Partial<StoredCharacter['columns']> }[] = [];
  const store: CharacterStore = {
    write: async (rows) => {
      writes.push(...(rows as unknown as typeof writes));
      return new Set(rows.map((r) => r.id));
    },
  };
  const persistence = new CharacterPersistence({ store, registry, log });
  return { registry, codex, progress, lines, log, writes, persistence };
}

function stored(state: StoredCharacter['state'] = {}): StoredCharacter {
  return { revision: 0, columns: { level: 1, xp: 0, homeSystem: HOME }, state };
}

/** A codex holding the living world's first two species, as analyzed. */
function saved(): Codex {
  return { worlds: { [W]: { system: HOME, species: { 0: codexEntryFor(species[0]!, 10), 1: codexEntryFor(species[1]!, 20) } } } };
}

describe('the codex component', () => {
  it('loads after the pose, and leads to the service it loads into', () => {
    const { registry, codex } = world();
    const keys = registry.components.map((c) => c.key);
    expect(keys.indexOf(CODEX)).toBe(keys.indexOf(POSE) + 1);
    expect(codex).toBeInstanceOf(CodexService);
    const given = new CodexService({ progress: new CharacterProgress() });
    const clock = { now: () => 0 };
    const r = coreRegistry({
      zones: new ZoneManager({ clock }),
      clock,
      inventory: new InventoryService(),
      ships: new ShipLoadouts(),
      progress: new CharacterProgress(),
      codex: given,
    });
    expect(codexServiceIn(r)).toBe(given);
    expect(codexServiceIn(new ComponentRegistry())).toBeUndefined();
  });

  it('gives a new character (or one saved before the codex) an empty codex', () => {
    const { registry } = world();
    expect(registry.decode(stored(), CHARACTER).values.get(CODEX)).toEqual(emptyCodex());
  });

  it('loads the saved codex into the service, saves it with what was analyzed since and the XP, and evicts it on leave', async () => {
    const { codex, persistence, writes } = world();
    const v = new Sink(1);
    persistence.join(v, { ...CHARACTER, level: 1, xp: 0, revision: 0, state: { codex: { v: 1, data: saved() } } });
    expect(codex.get('c1')).toEqual(saved());
    expect(codex.record('c1', { ...species[0]!, system: HOME, world: W }, 500).result).toBe('known');
    const third = species[2]!;
    expect(codex.record('c1', { ...third, system: HOME, world: W }, 500).result).toBe('new');
    persistence.leave(v);
    expect(codex.holds('c1')).toBe(false);
    await persistence.flush();
    const last = writes.at(-1)!;
    expect(last.state.codex).toEqual({
      v: 1,
      data: { worlds: { [W]: { system: HOME, species: { ...saved().worlds[W]!.species, 2: codexEntryFor(third, 500) } } } },
    });
    expect(last.columns.xp).toBe(SPECIES_XP);
  });

  it('reconciles a codex stored under older species data: one warning, the result in play, written back at the next save', async () => {
    const { codex, persistence, writes, lines } = world();
    const old: Codex = {
      worlds: {
        // its first species was a flyer once, and a fiftieth species the world never had
        [W]: {
          system: HOME,
          species: {
            0: { ...codexEntryFor(species[0]!, 10), bodyPlan: 'flyer', bond: 'big_game', threat: 4 },
            1: codexEntryFor(species[1]!, 20),
            50: codexEntryFor(species[1]!, 30),
          },
        },
        // a world that has no fauna, and a frame of another system
        [frameId(system.seed, lifeless.index)]: { system: HOME, species: { 0: codexEntryFor(species[0]!, 40) } },
        [W.replace(/^\d+/, String((system.seed + 1) >>> 0))]: { system: HOME, species: { 0: codexEntryFor(species[0]!, 50) } },
      },
    };
    const v = new Sink(1);
    persistence.join(v, { ...CHARACTER, level: 1, xp: 0, revision: 0, state: { codex: { v: 1, data: old } } });
    expect(codex.get('c1')).toEqual(saved());
    const warned = lines.filter((l) => l.level === 'warn' && l.msg === 'species data changed since the character was saved; codex reconciled');
    expect(warned).toHaveLength(1);
    expect(warned[0]!.obj).toMatchObject({ character: 'c1', component: CODEX, count: 4 });
    persistence.leave(v);
    await persistence.flush();
    expect(writes.at(-1)!.state.codex).toEqual({ v: 1, data: saved() });
  });

  it('reads a world’s species from the galaxy: none for a frame of another system, a lifeless world or no system', () => {
    expect(worldSpeciesAt(HOME, W)!.map((s) => s.name)).toEqual(species.map((s) => s.name));
    expect(worldSpeciesAt(HOME, frameId(system.seed, lifeless.index))).toBeNull();
    expect(worldSpeciesAt(HOME, `${system.seed}:station`)).toBeNull();
    expect(worldSpeciesAt(HOME, `${system.seed}:999`)).toBeNull();
    expect(worldSpeciesAt(HOME === 0 ? 1 : 0, W)).toBeNull();
    expect(worldSpeciesAt(5000, W)).toBeNull();
  });

  it('refuses a codex it cannot read rather than lose what was earned', () => {
    const { registry } = world();
    for (const entry of [
      { v: 2, data: saved() },
      { v: 1, data: { worlds: { [W]: { system: HOME, species: { 0: { ...codexEntryFor(species[0]!, 1), threat: 9 } } } } } },
      { v: 1, data: { worlds: [] } },
      { v: 1, data: 'everything' },
    ]) {
      let err: unknown;
      try {
        registry.decode(stored({ codex: entry as StoredCharacter['state'][string] }), CHARACTER);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(entry).slice(0, 80)).toBeInstanceOf(CharacterLoadError);
      expect((err as CharacterLoadError).component).toBe(CODEX);
    }
    // the rest of the character is untouched by it
    expect(registry.decode(stored({ codex: { v: 1, data: saved() } }), CHARACTER).values.get(PROGRESS)).toEqual({ level: 1, xp: 0, homeSystem: HOME });
  });
});
