// The skills persistence component (P1.E07.T01, ARCHITECTURE §8): registered before the ship and the inventory, which
// read the owned nodes; a new character gets its people's node; a saved Pack Mule character loads with its second cargo
// pod and the 15000 stack cap; unreadable skills refuse the join; leaving saves and evicts them.
import { emptyInventory, type Inventory } from '@astra/shared/inventory';
import { emptySkillState, newSkillState, type SkillState } from '@astra/shared/skills';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, coreRegistry, DEFAULT_SHIP, INVENTORY, METERS, POSE, PROGRESS, SHIP, ShipLoadouts, SKILLS } from '../persistence/components.ts';
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

/** Owns Cartridge Recycler, Hazard Weave and Pack Mule (level 30). */
const PACK_MULE: SkillState = {
  ...emptySkillState(),
  unlocked: ['cartridge_recycler', 'hazard_weave', 'pack_mule'],
  bought: ['cartridge_recycler', 'hazard_weave', 'pack_mule'],
};

describe('the skills component', () => {
  it('loads after progress and before the ship and the inventory, and leads to the service it loads into', () => {
    const { registry, skills } = world();
    expect(registry.components.map((c) => c.key)).toEqual([PROGRESS, SKILLS, SHIP, INVENTORY, METERS, POSE]);
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
      expect(d.values.get(SKILLS)).toEqual(newSkillState(people));
      expect((d.values.get(INVENTORY) as Inventory).stackMax).toBe(9999);
    }
  });

  it('loads a saved Pack Mule character with its second cargo pod and the 15000 stack cap, and refuses that ship without it', () => {
    const { registry, inventory, ships, skills } = world();
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

    const without = { ...PACK_MULE, bought: ['cartridge_recycler', 'hazard_weave'] };
    expect(() => registry.decode(stored({ skills: { v: 1, data: without }, ship: { v: 1, data: ship } }), CHARACTER)).toThrow(
      expect.objectContaining({ component: SHIP }),
    );
  });

  it('refuses skills it cannot read rather than reset what was earned', () => {
    const { registry } = world();
    const bad = [
      { v: 1, data: { ...emptySkillState(), bought: ['pull'] } },
      { v: 1, data: { ...emptySkillState(), unlocked: ['slam'], bought: ['slam'] } },
      { v: 1, data: { ...emptySkillState(), granted: -4 } },
      { v: 2, data: emptySkillState() },
      { v: 1, data: 'everything' },
    ];
    for (const entry of bad) {
      let err: unknown;
      try {
        registry.decode(stored({ skills: entry }), CHARACTER);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(entry).slice(0, 80)).toBeInstanceOf(CharacterLoadError);
      expect((err as CharacterLoadError).component).toBe(SKILLS);
    }
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
    const last = skills.get('c1');
    p.leave(v);
    expect(skills.get('c1')).toBeNull();
    await p.flush();
    expect(writes[0]!.state.skills).toEqual({ v: 1, data: last });
  });
});
