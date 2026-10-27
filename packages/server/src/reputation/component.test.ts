// The reputation persistence component (P2.E18.T01, ARCHITECTURE §8, §24): registered after the recipes and before the
// quests, leading to the service it loads into; a new character (or one saved before reputation) has none; a saved value
// loads into the service, is saved back with what changed since and is evicted on leave; one naming a faction the table no
// longer has is reconciled (one warning, written back); one that cannot be read refuses the join. And owed reputation a
// quest log saved before reputation existed holds is settled on join exactly once: across a crash before the save (the
// next join settles it again, from the row that still holds it) and after it (the owed list and the standing are written
// in one row update, so nothing is settled twice).
import { emptyQuestLog, type Owed, type QuestLog } from '@astra/shared/quests';
import type { Reputation } from '@astra/shared/reputation';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, coreRegistry, QUESTS, RECIPES, REPUTATION, ShipLoadouts } from '../persistence/components.ts';
import { CharacterLoadError, ComponentRegistry, type PersistenceLog, type StoredCharacter, type StoredState } from '../persistence/registry.ts';
import { CharacterPersistence, type StoredCharacterRow } from '../persistence/service.ts';
import type { CharacterStore, SaveRow } from '../persistence/store.ts';
import { QuestRuntime } from '../quests/runtime.ts';
import { homeSystemOf } from '../world/home.ts';
import { ZoneManager } from '../zones/manager.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { reputationServiceIn } from './component.ts';
import { reputationRewardHooks } from './quests.ts';
import { ReputationService } from './service.ts';

const HOME = homeSystemOf('thalune');
const CHARACTER = { id: 'c1', name: 'Ves', people: 'thalune' as const, homeSystem: HOME };

class Sink implements ZoneViewer {
  constructor(
    readonly id: number,
    readonly characterId = 'c1',
  ) {}
  sendBinary(): void {}
}

/** The characters table in memory with the store's revision guard: a save merges its entries into the row's state. */
class Rows implements CharacterStore {
  readonly rows = new Map<string, StoredCharacterRow>();
  readonly writes: SaveRow[] = [];

  async read(id: string): Promise<StoredCharacterRow | null> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async write(batch: readonly SaveRow[]): Promise<Set<string>> {
    const written = new Set<string>();
    for (const s of batch) {
      this.writes.push(structuredClone(s));
      const r = this.rows.get(s.id);
      if (!r || s.revision <= r.revision) continue;
      this.rows.set(s.id, { ...r, ...s.columns, state: { ...r.state, ...structuredClone(s.state) }, revision: s.revision });
      written.add(s.id);
    }
    return written;
  }
}

function logger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines };
}

/** One server process: zones, the reputation service, a quest runtime whose reputation and titles go to it, persistence
 * over `store`. */
function server(store: CharacterStore, given?: ReputationService) {
  const { log, lines } = logger();
  const clock = { now: () => 1000 };
  const zones = new ZoneManager({ clock });
  const inventory = new InventoryService();
  const progress = new CharacterProgress();
  const reputation = given ?? new ReputationService({ log });
  const quests = new QuestRuntime({ zones, inventory, progress, clock, log, rewards: reputationRewardHooks(() => reputation) });
  const registry = coreRegistry({ zones, clock, inventory, ships: new ShipLoadouts(), progress, reputation, quests, log });
  const persistence = new CharacterPersistence({ store, registry, log });
  let sessions = 0;
  return {
    registry,
    reputation,
    quests,
    persistence,
    lines,
    /** joins as the gateway does: persistence loads, the entity enters its zone, the quest runtime hears of it */
    join(row: StoredCharacterRow) {
      const viewer = new Sink(++sessions, row.id);
      persistence.join(viewer, row);
      zones.join(viewer, { id: row.id, name: row.name, people: row.people, level: row.level, homeSystem: row.homeSystem });
      quests.joined(viewer);
      return viewer;
    },
    leave(viewer: ZoneViewer) {
      persistence.leave(viewer);
      zones.leave(viewer);
    },
  };
}

function stored(state: StoredState = {}): StoredCharacter {
  return { revision: 0, columns: { level: 1, xp: 0, homeSystem: HOME }, state };
}

function row(state: StoredState = {}, revision = 0): StoredCharacterRow {
  return { ...CHARACTER, level: 1, xp: 0, revision, state };
}

describe('the reputation component', () => {
  it('loads after the recipes and before the quests, and leads to the service it loads into', () => {
    const { registry, reputation } = server(new Rows());
    const keys = registry.components.map((c) => c.key);
    expect(keys.indexOf(REPUTATION)).toBe(keys.indexOf(RECIPES) + 1);
    expect(keys.indexOf(QUESTS)).toBe(keys.indexOf(REPUTATION) + 1);
    expect(reputationServiceIn(registry)).toBe(reputation);
    expect(reputationServiceIn(new ComponentRegistry())).toBeUndefined();
    // made by the registry when none is given
    const own = coreRegistry({
      zones: new ZoneManager({ clock: { now: () => 0 } }),
      clock: { now: () => 0 },
      inventory: new InventoryService(),
      ships: new ShipLoadouts(),
      progress: new CharacterProgress(),
    });
    expect(reputationServiceIn(own)).toBeInstanceOf(ReputationService);
  });

  it('gives a new character (or one saved before reputation) none', () => {
    const { registry } = server(new Rows());
    expect(registry.decode(stored(), CHARACTER).values.get(REPUTATION)).toEqual({ rep: {}, titles: [] });
  });

  it('loads the saved value into the service, saves it with what changed since, and evicts it on leave', async () => {
    const store = new Rows();
    store.rows.set('c1', row({ reputation: { v: 1, data: { rep: { compact: 190 }, titles: [] } } }));
    const s = server(store);
    const v = s.join(store.rows.get('c1')!);
    expect(s.reputation.get('c1')).toEqual({ rep: { compact: 190 }, titles: [] });
    s.reputation.grant('c1', 'compact', 20, { reason: 'test' });
    s.leave(v);
    expect(s.reputation.holds('c1')).toBe(false);
    await s.persistence.flush();
    expect(store.rows.get('c1')!.state.reputation).toEqual({ v: 1, data: { rep: { compact: 210 }, titles: [{ title: 'Hand', faction: 'compact' }] } });
  });

  it('drops a faction the table no longer has: one warning, the rest in play, written back at the next save', async () => {
    const store = new Rows();
    const data = {
      rep: { compact: 300, old_guild: 400 },
      titles: [
        { title: 'Hand', faction: 'compact' },
        { title: 'Elder', faction: 'old_guild' },
      ],
    };
    store.rows.set('c1', row({ reputation: { v: 1, data } }));
    const s = server(store);
    const v = s.join(store.rows.get('c1')!);
    expect(s.reputation.get('c1')).toEqual({ rep: { compact: 300 }, titles: [{ title: 'Hand', faction: 'compact' }] });
    const warned = s.lines.filter((l) => l.level === 'warn' && l.msg.startsWith('factions no longer in the table'));
    expect(warned).toHaveLength(1);
    expect(warned[0]!.obj).toMatchObject({ character: 'c1', component: REPUTATION, dropped: ['old_guild'] });
    s.leave(v);
    await s.persistence.flush();
    expect((store.rows.get('c1')!.state.reputation!.data as Reputation).rep).toEqual({ compact: 300 });
  });

  it('refuses a value it cannot read rather than lose standing earned', () => {
    const { registry } = server(new Rows());
    for (const entry of [
      { v: 2, data: { rep: {}, titles: [] } },
      { v: 1, data: { rep: { compact: 1001 }, titles: [] } },
      { v: 1, data: { rep: { compact: -5 }, titles: [] } },
      {
        v: 1,
        data: {
          rep: {},
          titles: [
            { title: 'Hand', faction: 'compact' },
            { title: 'Hand', faction: 'compact' },
          ],
        },
      },
      { v: 1, data: { rep: {} } },
    ]) {
      let err: unknown;
      try {
        registry.decode(stored({ reputation: entry }), CHARACTER);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(entry)).toBeInstanceOf(CharacterLoadError);
      expect((err as CharacterLoadError).component).toBe(REPUTATION);
    }
  });
});

describe('owed reputation from a save made before reputation existed', () => {
  const OWED: Owed[] = [
    { kind: 'rep', quest: 'the_apothecarys_sodium', faction: 'belost', amount: 30 },
    { kind: 'skill_points', quest: 'first_jobs', count: 1 },
    { kind: 'rep', quest: 'wing_over_rolis_iii', faction: 'compact', amount: 180 },
    { kind: 'rep', quest: 'wing_over_rolis_iii', faction: 'compact', amount: 60 },
    { kind: 'title', quest: 'forty_names', title: 'Unlisted' },
  ];
  const before = (): StoredState => ({ quests: { v: 2, data: { ...emptyQuestLog(), owed: OWED } } });
  const owedOf = (store: Rows) => (store.rows.get('c1')!.state.quests!.data as QuestLog).owed;

  it('settles on join exactly once: again after a crash before the save, never after it', async () => {
    const store = new Rows();
    store.rows.set('c1', row(before()));

    // a first process settles it in memory (a rank reached on the way: Hand, its title earned), then crashes unsaved
    const a = server(store);
    a.join(store.rows.get('c1')!);
    expect(a.reputation.get('c1')).toEqual({
      rep: { belost: 30, compact: 240 },
      titles: [
        { title: 'Hand', faction: 'compact' },
        { title: 'Unlisted', quest: 'forty_names' },
      ],
    });
    // what no hook takes stays owed
    expect(a.quests.stateOf('c1')!.owed).toEqual([{ kind: 'skill_points', quest: 'first_jobs', count: 1 }]);
    expect(a.lines).toContainEqual(expect.objectContaining({ msg: 'owed quest rewards settled' }));
    a.persistence.abandon();
    expect(store.writes).toEqual([]);
    expect(owedOf(store)).toEqual(OWED);

    // the next process settles it again from the row, which still holds it: once in all
    const b = server(store);
    const v = b.join(store.rows.get('c1')!);
    expect(b.reputation.get('c1')!.rep).toEqual({ belost: 30, compact: 240 });
    b.leave(v);
    expect(await b.persistence.flush()).toBe(true);
    // the owed list and the standing it paid went in one row update
    expect(store.writes).toHaveLength(1);
    expect(Object.keys(store.writes[0]!.state)).toEqual(expect.arrayContaining([QUESTS, REPUTATION]));
    expect(owedOf(store)).toEqual([{ kind: 'skill_points', quest: 'first_jobs', count: 1 }]);
    expect((store.rows.get('c1')!.state.reputation!.data as Reputation).rep).toEqual({ belost: 30, compact: 240 });

    // and after that save, a crash or a restart settles nothing more
    const c = server(store);
    c.join(store.rows.get('c1')!);
    expect(c.reputation.get('c1')!.rep).toEqual({ belost: 30, compact: 240 });
    expect(c.lines).not.toContainEqual(expect.objectContaining({ msg: 'owed quest rewards settled' }));
    c.persistence.abandon();
  });

  it('a periodic save after the settle carries both halves, so a crash after it settles nothing twice', async () => {
    const store = new Rows();
    store.rows.set('c1', row(before()));
    const a = server(store);
    a.join(store.rows.get('c1')!);
    // (one slot captured per step: step until its slot comes up)
    for (let i = 0; i < a.persistence.slots && store.writes.length === 0; i++) {
      a.persistence.step();
      await a.persistence.flush();
    }
    expect(store.writes).toHaveLength(1);
    expect(Object.keys(store.writes[0]!.state)).toEqual(expect.arrayContaining([QUESTS, REPUTATION]));
    a.persistence.abandon();

    const b = server(store);
    b.join(store.rows.get('c1')!);
    expect(b.reputation.get('c1')!.rep).toEqual({ belost: 30, compact: 240 });
    expect(b.quests.stateOf('c1')!.owed).toEqual([{ kind: 'skill_points', quest: 'first_jobs', count: 1 }]);
    b.persistence.abandon();
  });

  it('stays owed while no reputation service takes it', () => {
    const store = new Rows();
    store.rows.set('c1', row(before()));
    // (a runtime whose hooks find no service: nothing settled, nothing lost)
    const { log } = logger();
    const clock = { now: () => 1000 };
    const zones = new ZoneManager({ clock });
    const inventory = new InventoryService();
    const progress = new CharacterProgress();
    const quests = new QuestRuntime({ zones, inventory, progress, clock, log, rewards: reputationRewardHooks(() => undefined) });
    const registry = coreRegistry({ zones, clock, inventory, ships: new ShipLoadouts(), progress, quests, log });
    const persistence = new CharacterPersistence({ store, registry, log });
    const viewer = new Sink(1);
    persistence.join(viewer, store.rows.get('c1')!);
    zones.join(viewer, { id: 'c1', name: 'Ves', people: 'thalune', level: 1, homeSystem: HOME });
    quests.joined(viewer);
    expect(quests.stateOf('c1')!.owed).toEqual(OWED);
    persistence.abandon();
  });
});
