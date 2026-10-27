// Phase 1's character components: what a new character gets, the ship and inventory round trip with the inventory's
// layout re-derived from the ship, the pose read from the zone entity, and a saved pose the world can no longer place
// falling back to docked at the home Waystation.
import { emptyInventory, slotAt, type Inventory } from '@astra/shared/inventory';
import { describe, expect, it } from 'vitest';
import { InventoryNotHeldError, InventoryService } from '../inventory/service.ts';
import { homeSystemOf, stationFrame, systemSeed } from '../world/home.ts';
import { ZoneManager } from '../zones/manager.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import {
  CharacterProgress,
  coreRegistry,
  DEFAULT_SHIP,
  dockedAtHome,
  INVENTORY,
  POSE,
  poseProblem,
  PROGRESS,
  SHIP,
  ShipLoadouts,
  SKILLS,
  type PoseState,
} from './components.ts';
import { CharacterLoadError, type PersistenceLog, type StoredCharacter } from './registry.ts';
import { CharacterPersistence } from './service.ts';
import type { CharacterStore } from './store.ts';

const HOME = homeSystemOf('thalune');
const CHARACTER = { id: 'c1', name: 'Ves', people: 'thalune' as const, homeSystem: HOME };

class Sink implements ZoneViewer {
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

function logger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines };
}

function world() {
  const zones = new ZoneManager({ clock: { now: () => 1000 } });
  const inventory = new InventoryService();
  const ships = new ShipLoadouts();
  const progress = new CharacterProgress();
  const { log, lines } = logger();
  const registry = coreRegistry({ zones, inventory, ships, progress, log });
  return { zones, inventory, ships, progress, registry, log, lines };
}

function stored(state: StoredCharacter['state'] = {}, columns: Partial<StoredCharacter['columns']> = {}): StoredCharacter {
  return { revision: 0, columns: { level: 1, xp: 0, homeSystem: HOME, ...columns }, state };
}

describe('character components', () => {
  it('gives a new character its level, the Lark, the starting kit with the Lark’s one pod, and a berth at home', () => {
    const { registry } = world();
    const d = registry.decode(stored({}, { level: 3, xp: 120 }), CHARACTER);
    expect(registry.components.map((c) => c.key)).toEqual([PROGRESS, SKILLS, SHIP, INVENTORY, POSE]);
    expect(d.values.get(PROGRESS)).toEqual({ level: 3, xp: 120, homeSystem: HOME });
    expect(d.values.get(SHIP)).toEqual(DEFAULT_SHIP);
    const inv = d.values.get(INVENTORY) as Inventory;
    expect(inv.pods).toHaveLength(1);
    expect(inv.units).toBe(2500);
    expect(d.values.get(POSE)).toEqual({
      system: HOME,
      pose: { frame: `${systemSeed(HOME)}:station`, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
      mode: 'docked',
    });
  });

  it('refuses a ship that cannot fly and an inventory the schema refuses, rather than replacing them', () => {
    const { registry } = world();
    const tooManyPods = { v: 1, data: { ...DEFAULT_SHIP, cargoPods: 9 } };
    expect(() => registry.decode(stored({ ship: tooManyPods }), CHARACTER)).toThrow(CharacterLoadError);
    expect(() => registry.decode(stored({ ship: { v: 1, data: { ...DEFAULT_SHIP, hull: 'zeppelin' } } }), CHARACTER)).toThrow(/ship/);
    expect(() => registry.decode(stored({ inventory: { v: 1, data: { stackMax: 9999, units: 0, suit: [], pods: [], fragments: 3 } } }), CHARACTER)).toThrow(
      /inventory/,
    );
  });

  it('re-derives a saved inventory’s layout from the saved ship when it loads, and saves and evicts it through the service', async () => {
    const { registry, inventory, ships, log } = world();
    const writes: unknown[] = [];
    const store: CharacterStore = {
      write: async (rows) => {
        writes.push(...rows);
        return new Set(rows.map((r) => r.id));
      },
    };
    const p = new CharacterPersistence({ store, registry, log });
    // saved with two pods (another hull's), ferrite in the second; the saved ship is the Lark, with one
    let saved = emptyInventory({ suitStacks: 16, pods: 2, podStacks: 8, stackMax: 9999 }, 40);
    saved = { ...saved, pods: [saved.pods[0]!, [{ item: 'ferrite', count: 50 }, ...saved.pods[1]!.slice(1)]] };
    const v = new Sink(1);
    p.join(v, {
      ...CHARACTER,
      level: 1,
      xp: 0,
      revision: 0,
      state: { ship: { v: 1, data: DEFAULT_SHIP }, inventory: { v: 1, data: saved } },
    });
    const held = inventory.get('c1')!;
    expect(held.pods).toHaveLength(1);
    expect(slotAt(held, { c: 'pod', p: 0, i: 0 })).toEqual({ item: 'ferrite', count: 50 });
    expect(held.units).toBe(40);
    expect(ships.get('c1')).toEqual(DEFAULT_SHIP);

    expect(inventory.grant('c1', 'gold', 5).ok).toBe(true);
    const last = inventory.get('c1');
    p.leave(v);
    expect(inventory.get('c1')).toBeNull();
    expect(ships.get('c1')).toBeUndefined();
    await p.flush();
    const state = (writes[0] as { state: Record<string, { data: Inventory }> }).state;
    expect(state.inventory!.data).toEqual(last);
    expect(slotAt(state.inventory!.data, { c: 'suit', i: 0 })).toEqual({ item: 'gold', count: 5 });
  });

  it('keeps a saved inventory’s layout, and logs it, when its ship cannot hold everything', () => {
    const { registry, inventory, log, lines } = world();
    const store: CharacterStore = { write: async (rows) => new Set(rows.map((r) => r.id)) };
    const p = new CharacterPersistence({ store, registry, log });
    // every suit slot and both pods full: one pod cannot take the second's stacks
    const full = (n: number) => Array.from({ length: n }, () => ({ item: 'ferrite', count: 9999 }));
    const saved: Inventory = { stackMax: 9999, units: 0, suit: full(16), pods: [full(8), full(8)] };
    p.join(new Sink(1), { ...CHARACTER, level: 1, xp: 0, revision: 0, state: { inventory: { v: 1, data: saved } } });
    expect(inventory.get('c1')!.pods).toHaveLength(2);
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', obj: expect.objectContaining({ component: INVENTORY, error: 'no_room' }) }));
  });

  it('replaces a stray inventory the service still held for a character out of play with the stored one', () => {
    const { registry, inventory, log, lines } = world();
    const p = new CharacterPersistence({ store: { write: async () => new Set() }, registry, log });
    // the service refuses a character it does not hold; one opened by hand outside persistence is still a leftover
    expect(() => inventory.grant('c1', 'gold', 99)).toThrow(InventoryNotHeldError);
    inventory.open('c1');
    inventory.grant('c1', 'gold', 99);
    p.join(new Sink(1), { ...CHARACTER, level: 1, xp: 0, revision: 0, state: {} });
    expect(slotAt(inventory.get('c1')!, { c: 'suit', i: 1 })).toBeNull();
    expect(lines.some((l) => l.msg.startsWith('inventory held for a character out of play'))).toBe(true);
  });

  it('reads the pose from the character’s zone entity, and nothing once it has left', () => {
    const { zones, registry } = world();
    const pose = registry.get(POSE)!;
    const v = new Sink(1);
    expect(pose.save({ characterId: 'c1', viewer: v })).toBeUndefined();
    const { zone } = zones.join(v, { id: 'c1', name: 'Ves', people: 'thalune', level: 1, homeSystem: HOME });
    const sent = {
      frame: stationFrame(HOME),
      pos: [120, 5, -40] as [number, number, number],
      quat: [0, 0, 0.6, 0.8] as [number, number, number, number],
      vel: [10, 0, 0] as [number, number, number],
    };
    zones.input(v, { t: 'input', seq: 1, time: 0, mode: 'ship', pose: sent, buttons: 0 });
    const at = pose.save({ characterId: 'c1', viewer: v }) as PoseState;
    expect(at).toMatchObject({ system: zone.systemIndex, mode: 'ship', pose: { frame: sent.frame, pos: sent.pos, vel: sent.vel } });
    expect(at.pose.quat.map((q) => Math.round(q * 1e9) / 1e9)).toEqual([0, 0, 0.6, 0.8]);
    zones.leave(v);
    expect(pose.save({ characterId: 'c1', viewer: v })).toBeUndefined();
  });

  it('names what makes a saved pose unusable', () => {
    const ok = dockedAtHome(HOME);
    expect(poseProblem(ok)).toBeNull();
    expect(poseProblem({ ...ok, system: 1000 })).toMatch(/no system/);
    expect(poseProblem({ ...ok, pose: { ...ok.pose, frame: stationFrame(HOME === 0 ? 1 : 0) } })).toMatch(/not in system/);
    expect(poseProblem({ ...ok, pose: { ...ok.pose, pos: [2e11, 0, 0] } })).toMatch(/position/);
    expect(poseProblem({ ...ok, pose: { ...ok.pose, vel: [0, 2e9, 0] } })).toMatch(/velocity/);
    expect(poseProblem({ ...ok, pose: { ...ok.pose, frame: null, pos: [1e9, 0, 0] } })).toBeNull();
  });

  it('decodes an unusable saved pose as docked at home, and logs it', () => {
    const { registry, log, lines } = world();
    const elsewhere = { ...dockedAtHome(HOME), pose: { ...dockedAtHome(HOME).pose, frame: stationFrame(HOME === 0 ? 1 : 0) } };
    expect(registry.decode(stored({ pose: { v: 1, data: elsewhere } }), CHARACTER, log).values.get(POSE)).toEqual(dockedAtHome(HOME));
    expect(registry.decode(stored({ pose: { v: 1, data: { ...elsewhere, mode: 'flying' } } }), CHARACTER, log).values.get(POSE)).toEqual(dockedAtHome(HOME));
    expect(lines.filter((l) => l.level === 'warn' && l.obj.component === POSE)).toHaveLength(2);
  });
});

describe('ZoneManager.join at a saved placement', () => {
  const character = { id: 'c1', name: 'Ves', people: 'thalune' as const, level: 1, homeSystem: HOME };

  it('puts the entity where it was saved, in that system, in its mode', () => {
    const zones = new ZoneManager({ clock: { now: () => 1000 } });
    const other = HOME === 0 ? 1 : 0;
    const at = {
      system: other,
      pose: {
        frame: `${systemSeed(other)}:0`,
        pos: [10, 2000, 3] as [number, number, number],
        quat: [0, 0, 0, 1] as [number, number, number, number],
        vel: [0, 0, 0] as [number, number, number],
      },
      mode: 'landed' as const,
    };
    const j = zones.join(new Sink(1), character, at);
    expect(j.fellBack).toBeUndefined();
    expect(j.zone.systemIndex).toBe(other);
    expect(j.pose).toEqual(at.pose);
    expect(j.mode).toBe('landed');
    expect(j.zone.entity(j.entityId)!.fields).toMatchObject({ ...at.pose, mode: 'landed' });
  });

  it('docks it at the home Waystation when the saved frame or system no longer exists', () => {
    const zones = new ZoneManager({ clock: { now: () => 1000 } });
    const home = dockedAtHome(HOME);
    const gone = zones.join(new Sink(1), character, { ...home, pose: { ...home.pose, frame: `${systemSeed(HOME)}:999` }, mode: 'ship' });
    expect(gone.fellBack).toMatch(/not in system/);
    expect(gone.zone.systemIndex).toBe(HOME);
    expect(gone.pose).toEqual(home.pose);
    expect(gone.mode).toBe('docked');
    const nowhere = zones.join(new Sink(2), character, { ...home, system: 5000 });
    expect(nowhere.fellBack).toMatch(/no system 5000/);
    expect(nowhere.pose).toEqual(home.pose);
  });
});
