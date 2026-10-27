// The skills persistence component (P1.E07.T01, ARCHITECTURE §8): registered before the ship and the inventory, which
// read the owned nodes; a new character gets its people's node; a saved Pack Mule character loads with its second cargo
// pod and the 15000 stack cap; leaving saves and evicts them. Stored under an older skill web (P1.E07.T15), skills are
// reconciled on join with one warning and written back; only unreadable structure or a newer web refuses the join.
import { emptyInventory, type Inventory } from '@astra/shared/inventory';
import { emptySkillState, newSkillState, SKILL_WEB_VERSION, storedSkills, type SkillState, type StoredSkills } from '@astra/shared/skills';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import {
  CharacterProgress,
  CODEX,
  coreRegistry,
  DEFAULT_SHIP,
  INVENTORY,
  POSE,
  PROGRESS,
  RECIPES,
  SHIP,
  ShipLoadouts,
  SKILLS,
} from '../persistence/components.ts';
import { CharacterLoadError, ComponentRegistry, type PersistenceLog, type StoredCharacter } from '../persistence/registry.ts';
import { CharacterPersistence } from '../persistence/service.ts';
import type { CharacterStore } from '../persistence/store.ts';
import { homeSystemOf } from '../world/home.ts';
import { ZoneManager } from '../zones/manager.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { skillServiceIn } from './component.ts';
import { SkillService } from './service.ts';

const HOME = homeSystemOf('thalune');
const CHARACTER = { id: 'c1', name: 'Ves', people: 'thalune' as const, homeSystem: HOME };

class Sink implements ZoneViewer {
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

function world() {
  const clock = { now: () => 1000 };
  const zones = new ZoneManager({ clock });
  const inventory = new InventoryService();
  const ships = new ShipLoadouts();
  const progress = new CharacterProgress();
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  const registry = coreRegistry({ zones, clock, inventory, ships, progress, log });
  const skills = skillServiceIn(registry)!;
  return { inventory, ships, progress, registry, skills, log, lines };
}

function stored(state: StoredCharacter['state'] = {}, level = 30): StoredCharacter {
  return { revision: 0, columns: { level, xp: 0, homeSystem: HOME }, state };
}

const GRAVITIC = (count: number) => ({ branch: 'gravitic' as const, count });

/** Owns Cartridge Recycler, Hazard Weave and Pack Mule (level 30). */
const PACK_MULE: SkillState = {
  ...emptySkillState(),
  unlocked: ['cartridge_recycler', 'hazard_weave', 'pack_mule'],
  bought: ['cartridge_recycler', 'hazard_weave', 'pack_mule'],
};

describe('the skills component', () => {
  it('loads after progress and before the ship and the inventory, and leads to the service it loads into', () => {
    const { registry, skills } = world();
    expect(registry.components.map((c) => c.key)).toEqual([PROGRESS, SKILLS, SHIP, INVENTORY, POSE, CODEX, RECIPES]);
    expect(skills).toBeInstanceOf(SkillService);
    // a service given is the one registered
    const given = new SkillService({ inventory: new InventoryService(), ships: new ShipLoadouts(), progress: new CharacterProgress() });
    const clock = { now: () => 0 };
    const zones = new ZoneManager({ clock });
    const r = coreRegistry({ zones, clock, inventory: new InventoryService(), ships: new ShipLoadouts(), progress: new CharacterProgress(), skills: given });
    expect(skillServiceIn(r)).toBe(given);
    expect(skillServiceIn(new ComponentRegistry())).toBeUndefined();
  });

  it('gives a new character its people’s node, and the Lark’s one pod at the 9999 cap', () => {
    const { registry } = world();
    for (const people of ['thalune', 'ixari', 'ulgani'] as const) {
      const d = registry.decode(stored({}, 1), { ...CHARACTER, people });
      expect(d.values.get(SKILLS)).toEqual(storedSkills(newSkillState(people)));
      expect((d.values.get(INVENTORY) as Inventory).stackMax).toBe(9999);
    }
  });

  it('loads a saved Pack Mule character with its second cargo pod and the 15000 stack cap, and gives that pod back without it', () => {
    const { registry, inventory, ships, skills, log, lines } = world();
    const ship = { ...DEFAULT_SHIP, cargoPods: 2 };
    const saved = emptyInventory({ suitStacks: 16, pods: 2, podStacks: 8, stackMax: 15000 }, 100);
    saved.pods[1]![0] = { item: 'ferrite', count: 12000 };
    const p = new CharacterPersistence({ store: { write: async (rows) => new Set(rows.map((r) => r.id)) }, registry });
    p.join(new Sink(1), {
      ...CHARACTER,
      level: 30,
      xp: 0,
      revision: 0,
      state: { skills: { v: 1, data: PACK_MULE }, ship: { v: 1, data: ship }, inventory: { v: 1, data: saved } },
    });
    // the stored state lacked the people's node: it is unlocked on load
    expect(skills.get('c1')).toEqual({ ...PACK_MULE, unlocked: [...PACK_MULE.unlocked, 'second_lung'] });
    expect(skills.owned('c1')).toContain('pack_mule');
    expect(ships.get('c1')!.cargoPods).toBe(2);
    expect(inventory.get('c1')).toEqual(saved);

    // a ship with a pod for a bay its pilot no longer has: the pod is given back, never the join refused
    const without = { ...PACK_MULE, bought: ['cartridge_recycler', 'hazard_weave'] };
    const d = registry.decode(stored({ skills: { v: 1, data: without }, ship: { v: 1, data: ship } }), CHARACTER, log);
    expect(d.values.get(SHIP)).toEqual({ ...ship, cargoPods: 1 });
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', obj: expect.objectContaining({ component: SHIP, pods: 2, bays: 1 }) }));
  });

  it('refuses only skills no web explains, or stored under a newer web, rather than reset what was earned', () => {
    const { registry } = world();
    const current = storedSkills(emptySkillState());
    const bad: [unknown, RegExp][] = [
      [{ v: 1, data: { ...emptySkillState(), bought: ['pull'] } }, /bought but not unlocked/],
      [{ v: 2, data: { ...current, bought: ['pull'] } }, /bought but not unlocked/],
      [{ v: 1, data: { ...emptySkillState(), granted: -4 } }, /granted/],
      [{ v: 2, data: { ...current, paid: { pull: { branch: 'gravitic', count: 1 } } } }, /paid for but not unlocked/],
      [{ v: 2, data: { ...current, web: SKILL_WEB_VERSION + 1 } }, /newer server/],
      [{ v: 2, data: emptySkillState() }, /web|paid/],
      [{ v: 3, data: current }, /newer server/],
      [{ v: 1, data: 'everything' }, /object/],
    ];
    for (const [entry, why] of bad) {
      let err: unknown;
      try {
        registry.decode(stored({ skills: entry as StoredCharacter['state'][string] }), CHARACTER);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(entry).slice(0, 80)).toBeInstanceOf(CharacterLoadError);
      expect((err as CharacterLoadError).component).toBe(SKILLS);
      expect((err as CharacterLoadError).reason).toMatch(why);
    }
    // what a change to the web explains is reconciled instead: an owned node without its prerequisite is refunded
    const orphan = registry.decode(stored({ skills: { v: 1, data: { ...emptySkillState(), unlocked: ['slam'], bought: ['slam'] } } }), CHARACTER);
    expect(orphan.values.get(SKILLS)).toMatchObject({ web: SKILL_WEB_VERSION, unlocked: ['slam'], bought: [] });
  });

  it('saves what the service holds, evicts it on leave, and warns of points overspent', async () => {
    const { registry, skills, lines, log } = world();
    const writes: { state: Record<string, { v: number; data: unknown }> }[] = [];
    const store: CharacterStore = {
      write: async (rows) => {
        writes.push(...(rows as unknown as typeof writes));
        return new Set(rows.map((r) => r.id));
      },
    };
    const p = new CharacterPersistence({ store, registry, log });
    const v = new Sink(1);
    // three points owned at level 2: one more than the level gives
    const overspent = { ...emptySkillState(), unlocked: ['second_lung', 'pull', 'heavy_footing'], bought: ['second_lung', 'pull', 'heavy_footing'] };
    p.join(v, { ...CHARACTER, level: 2, xp: 0, revision: 0, state: { skills: { v: 1, data: overspent } } });
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', msg: 'more skill points spent than earned' }));
    expect(skills.points('c1').available).toBe(-1);
    expect(skills.grantPoints('c1', 2).ok).toBe(true);
    expect(skills.grantFragments('c1', 'thermal', 2).ok).toBe(true);
    const last = skills.stored('c1');
    expect(last).toEqual(storedSkills(skills.get('c1')!));
    p.leave(v);
    expect(skills.get('c1')).toBeNull();
    await p.flush();
    expect(writes[0]!.state.skills).toEqual({ v: 2, data: last });
  });
  it('reconciles skills stored under an older web on join: one warning, the result in play, written back at the next save', async () => {
    const { registry, skills, lines, log } = world();
    const writes: { state: StoredCharacter['state'] }[] = [];
    const store: CharacterStore = {
      write: async (rows) => {
        writes.push(...(rows as unknown as typeof writes));
        return new Set(rows.map((r) => r.id));
      },
    };
    const p = new CharacterPersistence({ store, registry, log });
    const empty = emptySkillState();
    // under web 0, Gravity Hook was Gravitic's Tier I: Slam and Anchor stood on it; the bars had 4 and 6 slots
    const old: StoredSkills = {
      web: 0,
      ...empty,
      granted: 3,
      unlocked: ['gravity_hook', 'pull', 'slam', 'anchor', 'second_lung'],
      bought: ['gravity_hook', 'slam', 'anchor'],
      fragments: { ...empty.fragments, gravitic: { earned: 12, spent: 10 } },
      slots: { ground: ['gravity_hook', 'slam', 'anchor', null], ship: Array(6).fill(null) },
      paid: { gravity_hook: GRAVITIC(1), slam: GRAVITIC(3), anchor: GRAVITIC(6) },
    };
    const v = new Sink(1);
    p.join(v, { ...CHARACTER, level: 30, xp: 0, revision: 4, state: { skills: { v: 2, data: old } } });
    // Gravity Hook gone and its fragment back; Anchor then Slam refunded, still unlocked; the bars this web's size
    const now: SkillState = {
      ...empty,
      granted: 3,
      unlocked: ['pull', 'slam', 'anchor', 'second_lung'],
      bought: [],
      fragments: { ...empty.fragments, gravitic: { earned: 12, spent: 9 } },
    };
    expect(skills.get('c1')).toEqual(now);
    expect(skills.points('c1').available).toBe(33);
    expect(lines.filter((l) => l.obj.component === SKILLS)).toEqual([
      {
        level: 'warn',
        msg: 'skill web changed since the character was saved; skills reconciled',
        obj: {
          character: 'c1',
          component: SKILLS,
          from: 0,
          to: SKILL_WEB_VERSION,
          changes: [
            { change: 'removed', node: 'gravity_hook', owned: true, fragments: GRAVITIC(1) },
            { change: 'refunded', node: 'anchor', missing: ['a Tier II gravitic node'] },
            { change: 'refunded', node: 'slam', missing: ['a Tier I gravitic node'] },
            { change: 'resized', bar: 'ground', from: 4, to: 6 },
            { change: 'resized', bar: 'ship', from: 6, to: 5 },
          ],
        },
      },
    ]);
    // nothing changed in play, and still the reconciled skills are written at the next save
    p.leave(v);
    await p.flush();
    const written = { web: SKILL_WEB_VERSION, ...now, paid: { slam: GRAVITIC(3), anchor: GRAVITIC(6) } };
    expect(writes[0]!.state.skills).toEqual({ v: 2, data: written });
    // which then loads as it is stored, with nothing to say
    lines.length = 0;
    const again = registry.decode({ revision: 5, columns: { level: 30, xp: 0, homeSystem: HOME }, state: writes[0]!.state }, CHARACTER, log);
    expect(again.values.get(SKILLS)).toEqual(written);
    expect(again.asStored.has(SKILLS)).toBe(true);
    expect(lines).toEqual([]);
  });

  it('rejoins from the copy still held before its save lands, with the skills as reconciled and nothing more to say', async () => {
    const { registry, skills, lines, log } = world();
    let release!: () => void;
    const landed = new Promise<void>((r) => (release = r));
    const store: CharacterStore = {
      write: async (rows) => {
        await landed;
        return new Set(rows.map((r) => r.id));
      },
    };
    const p = new CharacterPersistence({ store, registry, log });
    const empty = emptySkillState();
    // under web 0, Gravity Hook (gone now) was Gravitic's Tier I and Slam stood on it
    const old: StoredSkills = {
      web: 0,
      ...empty,
      unlocked: ['gravity_hook', 'slam'],
      bought: ['gravity_hook', 'slam'],
      fragments: { ...empty.fragments, gravitic: { earned: 4, spent: 4 } },
      paid: { gravity_hook: GRAVITIC(1), slam: GRAVITIC(3) },
    };
    const row = { ...CHARACTER, level: 30, xp: 0, revision: 0, state: { skills: { v: 2, data: old } } };
    const first = new Sink(1);
    p.join(first, row);
    const reconciled = skills.get('c1');
    expect(reconciled).toMatchObject({ bought: [], fragments: { gravitic: { earned: 4, spent: 3 } } });
    p.leave(first);
    expect(p.status('c1')).toMatchObject({ inPlay: false, pending: true });
    // the row still holds web 0; the join reads the copy persistence holds, already reconciled: no second refund, no warning
    p.join(new Sink(2), row);
    expect(skills.get('c1')).toEqual(reconciled);
    expect(lines.filter((l) => l.obj.component === SKILLS)).toHaveLength(1);
    release();
    await p.flush();
  });

  it('gives back the pod of a Pack Mule a web change refunded, and keeps what the pod holds', () => {
    const { registry, inventory, ships, skills, lines, log } = world();
    const p = new CharacterPersistence({ store: { write: async (rows) => new Set(rows.map((r) => r.id)) }, registry, log });
    // under web 0, Pack Mule and Hazard Weave stood on an Exo-suit Tier I that is gone
    const old: StoredSkills = {
      web: 0,
      ...emptySkillState(),
      unlocked: ['old_harness', 'hazard_weave', 'pack_mule'],
      bought: ['old_harness', 'hazard_weave', 'pack_mule'],
      paid: {},
    };
    const ship = { ...DEFAULT_SHIP, cargoPods: 2 };
    const layout = { suitStacks: 16, pods: 2, podStacks: 8, stackMax: 15000 };
    const join = (id: string, saved: Inventory) =>
      p.join(new Sink(id === 'c1' ? 1 : 2), {
        ...CHARACTER,
        id,
        level: 30,
        xp: 0,
        revision: 0,
        state: { skills: { v: 2, data: old }, ship: { v: 1, data: ship }, inventory: { v: 1, data: saved } },
      });

    // the second pod empty: the ship and the inventory are one pod at the 9999 cap again
    join('c1', emptyInventory(layout, 100));
    expect(skills.owned('c1')).toEqual([]);
    expect(ships.get('c1')).toEqual({ ...ship, cargoPods: 1 });
    expect(inventory.get('c1')).toMatchObject({ stackMax: 9999, units: 100 });
    expect(inventory.get('c1')!.pods).toHaveLength(1);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 'warn', obj: expect.objectContaining({ character: 'c1', component: SHIP, pods: 2, bays: 1 }) }),
    );

    // every slot full and 12000 ferrite in the second pod: one pod at 9999 cannot hold that, so the inventory keeps its
    // saved layout and every item, logged
    const stacks = (n: number) => Array.from({ length: n }, () => ({ item: 'ferrite', count: 9999 }));
    const full: Inventory = { stackMax: 15000, units: 100, suit: stacks(16), pods: [stacks(8), [{ item: 'ferrite', count: 12000 }, ...stacks(7)]] };
    join('c2', full);
    expect(ships.get('c2')).toEqual({ ...ship, cargoPods: 1 });
    expect(inventory.get('c2')).toEqual(full);
    expect(lines).toContainEqual(expect.objectContaining({ obj: expect.objectContaining({ character: 'c2', component: INVENTORY, error: 'no_room' }) }));
  });

  it('stores what fragment unlocks paid, reading a v1 value’s payments from its ledger', () => {
    const { registry, skills } = world();
    const p = new CharacterPersistence({ store: { write: async (rows) => new Set(rows.map((r) => r.id)) }, registry });
    // stored before the record existed: Pull took the one gravitic fragment spent
    const v1: SkillState = {
      ...emptySkillState(),
      unlocked: ['second_lung', 'pull'],
      fragments: { ...emptySkillState().fragments, gravitic: { earned: 4, spent: 1 } },
    };
    p.join(new Sink(1), { ...CHARACTER, level: 30, xp: 0, revision: 0, state: { skills: { v: 1, data: v1 } } });
    expect(skills.stored('c1')).toEqual({ web: SKILL_WEB_VERSION, ...v1, paid: { pull: GRAVITIC(1) } });
    expect(skills.request('c1', 1, { op: 'unlock', node: 'slam' }).error).toBeUndefined();
    expect(skills.stored('c1')!.paid).toEqual({ pull: GRAVITIC(1), slam: GRAVITIC(3) });
  });
});
