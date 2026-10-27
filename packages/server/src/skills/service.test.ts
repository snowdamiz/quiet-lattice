// The skill service (P1.E07.T01): the server's authority over each character's place on the web. Requests are answered
// with the view (stale and malformed ones refused); points, fragments and world unlocks are server-side and pushed; slots
// wait out combat; a respec needs its trainer and its units; Pack Mule's cargo pod and stack cap reach the ship and the
// inventory, and a change that would lose items is refused with nothing changed.
import type { HullId } from '@astra/shared/data';
import { countOf } from '@astra/shared/inventory';
import { emptySkillState, newSkillState, SKILL_PHASE, type PhaseTier, type SkillState } from '@astra/shared/skills';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, DEFAULT_SHIP, ShipLoadouts } from '../persistence/components.ts';
import { SkillsNotHeldError, SkillService, type SkillChange, type SkillReply } from './service.ts';

const ID = 'c1';

/** A character in play. `maxTier` 4 sells the whole web (Pack Mule is Tier III, past Phase 1's ceiling). */
function world(opts: { level?: number; hull?: HullId | null; people?: string; saved?: SkillState; maxTier?: PhaseTier } = {}) {
  const inventory = new InventoryService();
  const ships = new ShipLoadouts();
  const progress = new CharacterProgress();
  const skills = new SkillService({ inventory, ships, progress, maxTier: opts.maxTier });
  const heard: { id: string; reply: SkillReply; change: SkillChange }[] = [];
  skills.subscribe((id, reply, change) => heard.push({ id, reply, change }));
  const ship = opts.hull === null ? null : { ...DEFAULT_SHIP, hull: opts.hull ?? 'lark', modules: {} };
  progress.set(ID, { level: opts.level ?? 50, xp: 0, homeSystem: 0 });
  ships.set(ID, ship);
  inventory.open(ID, { loadout: { ship, skills: [] } });
  const people = opts.people ?? 'thalune';
  skills.open(ID, opts.saved ?? newSkillState(people), people);
  /** Unlocks (by the developer route) and buys these nodes on the server. */
  const own = (...ids: string[]) => {
    for (const id of ids) {
      if (!skills.get(ID)!.unlocked.includes(id)) expect(skills.unlock(ID, id, { kind: 'dev' }).ok, id).toBe(true);
      const r = skills.buy(ID, id);
      expect(r.ok ? null : r.error, id).toBeNull();
    }
  };
  return { inventory, ships, progress, skills, heard, own };
}

describe('skill service', () => {
  it('puts a character in play with its people’s node, and reads its level and ship live', () => {
    const { skills, progress, ships } = world({ people: 'ixari' });
    expect(skills.view(ID)).toEqual({ state: newSkillState('ixari'), level: 50, shipSlots: 2, met: [], maxTier: SKILL_PHASE.maxTier });
    progress.set(ID, { level: 20, xp: 0, homeSystem: 0 });
    ships.set(ID, { ...DEFAULT_SHIP, hull: 'swift', modules: {} });
    expect(skills.view(ID)).toMatchObject({ level: 20, shipSlots: 3 });
    expect(skills.points(ID)).toEqual({ fromLevels: 20, granted: 0, earned: 20, spent: 0, available: 20 });
    ships.set(ID, null);
    expect(skills.view(ID).shipSlots).toBe(0);
    // standing comes from its hook
    skills.hooks.meets = (_, r) => r.faction === 'reaches';
    expect(skills.view(ID).met).toEqual([{ kind: 'faction_rank', faction: 'reaches', rank: 'deckhand' }]);
  });

  it('adds a people’s node a saved state lacks, refuses an invalid one, and refuses characters it does not hold', () => {
    const { skills } = world();
    expect(skills.open('c2', emptySkillState(), 'ulgani').skills.state.unlocked).toEqual(['cartridge_recycler']);
    expect(skills.size).toBe(2);
    expect(() => skills.open('c3', { ...emptySkillState(), bought: ['pull'] }, 'ulgani')).toThrow(/invalid/);
    expect(skills.close('c2')?.unlocked).toEqual(['cartridge_recycler']);
    expect(skills.get('c2')).toBeNull();
    for (const call of [() => skills.request('c2', 1, { op: 'buy', node: 'pull' }), () => skills.owned('c2'), () => skills.grantPoints('c2', 1)])
      expect(call).toThrow(SkillsNotHeldError);
  });

  it('answers every request with the authoritative view, refusing replayed and malformed ones', () => {
    const { skills, heard } = world({ level: 1 });
    const bought = skills.request(ID, 1, { op: 'buy', node: 'second_lung' });
    expect(bought.seq).toBe(1);
    expect(bought.error).toBeUndefined();
    expect(bought.skills.state.bought).toEqual(['second_lung']);
    expect(skills.owned(ID)).toEqual(['second_lung']);
    expect(skills.request(ID, 1, { op: 'unslot', bar: 'ground', index: 0 })).toMatchObject({ seq: 1, error: 'stale_seq' });
    expect(skills.request(ID, 2, { op: 'grant', points: 100 })).toMatchObject({ seq: 2, error: 'invalid_op' });
    expect(skills.request(ID, 3, { op: 'buy', node: 'pull' })).toMatchObject({ seq: 3, error: 'not_unlocked' });
    expect(skills.request(ID, 4, { op: 'buy', node: 'nope' })).toMatchObject({ seq: 4, error: 'unknown_node' });
    // only the purchase changed anything, and the requester was answered: listeners hear it as a request
    expect(heard.map((h) => h.change)).toEqual(['request']);
    expect(skills.state(ID)).toMatchObject({ seq: 4, skills: { state: { bought: ['second_lung'] } } });
  });

  it('takes points, fragments and unlocks from the world server-side, and pushes each', () => {
    const { skills, heard } = world({ level: 3 });
    expect(skills.grantFragments(ID, 'gravitic', 3).ok).toBe(true);
    expect(skills.grantFragments(ID, 'pilot', 1)).toMatchObject({ ok: false, error: { code: 'no_fragments' } });
    expect(skills.request(ID, 1, { op: 'unlock', node: 'pull' }).error).toBeUndefined();
    expect(skills.request(ID, 2, { op: 'unlock', node: 'well' })).toMatchObject({ error: 'fragments' });
    expect(skills.get(ID)!.fragments.gravitic).toEqual({ earned: 3, spent: 1 });
    expect(skills.unlock(ID, 'cartridge_recycler', { kind: 'trainer', trainer: 'city_master' }).ok).toBe(true);
    expect(skills.unlock(ID, 'lance', { kind: 'trainer', trainer: 'city_master' })).toMatchObject({ ok: false, error: { code: 'no_route' } });
    expect(skills.grantPoints(ID, 2).ok).toBe(true);
    expect(skills.points(ID)).toMatchObject({ earned: 5, available: 5 });
    expect(skills.setPoints(ID, 40)).toMatchObject({ ok: true, available: 40 });
    expect(skills.points(ID)).toMatchObject({ granted: 37, available: 40 });
    skills.refresh(ID);
    expect(heard.map((h) => h.change)).toEqual(['server', 'request', 'server', 'server', 'server', 'server']);
    expect(heard.at(-1)!.reply).toEqual(skills.state(ID));
  });

  it('swaps slots only out of combat', () => {
    const { skills, own } = world();
    own('pull');
    skills.hooks.inCombat = () => true;
    expect(skills.request(ID, 1, { op: 'slot', bar: 'ground', index: 0, node: 'pull' })).toMatchObject({ error: 'in_combat' });
    skills.hooks.inCombat = () => false;
    expect(skills.request(ID, 2, { op: 'slot', bar: 'ground', index: 0, node: 'pull' }).skills.state.slots.ground[0]).toBe('pull');
    // the Lark works two ship slots
    own('tractor_beam');
    expect(skills.request(ID, 3, { op: 'slot', bar: 'ship', index: 2, node: 'tractor_beam' })).toMatchObject({ error: 'bad_slot' });
    expect(skills.request(ID, 4, { op: 'slot', bar: 'ship', index: 1, node: 'tractor_beam' }).error).toBeUndefined();
  });

  it('respecs at a trainer for 500 units a point, and never half-changes the state or the units', () => {
    const { skills, inventory, own } = world();
    own('pull', 'heavy_footing');
    expect(skills.request(ID, 1, { op: 'respec', nodes: ['pull'] })).toMatchObject({ error: 'trainer' });
    skills.hooks.trainerAtHand = (_, t) => t === 'chorus_listener';
    const r = skills.request(ID, 2, { op: 'respec', nodes: ['pull'] });
    expect(r.error).toBeUndefined();
    expect(r.skills.state.bought).toEqual(['heavy_footing']);
    expect(inventory.get(ID)!.units).toBe(2000);
    expect(inventory.spend(ID, 1700).ok).toBe(true);
    expect(skills.request(ID, 3, { op: 'respec', nodes: ['heavy_footing'] })).toMatchObject({ error: 'units' });
    expect(skills.owned(ID)).toEqual(['heavy_footing']);
    expect(inventory.get(ID)!.units).toBe(300);
    // Void nodes only at a Free Reaches quartermaster
    skills.hooks.meets = () => true;
    expect(inventory.earn(ID, 1000).ok).toBe(true);
    own('phase');
    expect(skills.respec(ID, ['phase'])).toMatchObject({ ok: false, error: { code: 'trainer', message: /Free Reaches quartermaster/ } });
    skills.hooks.trainerAtHand = (_, t) => t === 'reaches_quartermaster';
    expect(skills.respec(ID, ['phase']).ok).toBe(true);
    expect(inventory.get(ID)!.units).toBe(800);
  });

  it('carries Pack Mule to the ship and the inventory: a cargo pod aboard and the 15000 stack cap, and back on a respec', () => {
    const { skills, inventory, ships, own } = world({ level: 30, maxTier: 4 });
    own('cartridge_recycler', 'hazard_weave');
    expect(skills.unlock(ID, 'pack_mule', { kind: 'trainer', trainer: 'city_master' }).ok).toBe(true);
    expect(skills.request(ID, 1, { op: 'buy', node: 'pack_mule' }).error).toBeUndefined();
    expect(ships.get(ID)).toMatchObject({ hull: 'lark', cargoPods: 2 });
    expect(inventory.get(ID)!.pods).toHaveLength(2);
    expect(inventory.get(ID)!.stackMax).toBe(15000);

    // full to the 15000 cap everywhere (the warp cell has a slot): a Lark without Pack Mule could not hold it, so the
    // respec is refused, nothing changed
    skills.hooks.trainerAtHand = () => true;
    expect(inventory.grant(ID, 'ferrite', 31 * 15000).ok).toBe(true);
    const before = structuredClone(inventory.get(ID));
    expect(skills.request(ID, 2, { op: 'respec', nodes: ['pack_mule'] })).toMatchObject({ error: 'no_room' });
    expect(inventory.get(ID)).toEqual(before);
    expect(ships.get(ID)!.cargoPods).toBe(2);
    expect(skills.owned(ID)).toContain('pack_mule');

    expect(inventory.consume(ID, 'ferrite', 31 * 15000 - 1000).ok).toBe(true);
    expect(skills.request(ID, 3, { op: 'respec', nodes: ['pack_mule'] }).error).toBeUndefined();
    expect(ships.get(ID)!.cargoPods).toBe(1);
    expect(inventory.get(ID)!.pods).toHaveLength(1);
    expect(inventory.get(ID)!.stackMax).toBe(9999);
    expect(countOf(inventory.get(ID)!, 'ferrite')).toBe(1000);
    expect(inventory.get(ID)!.units).toBe(2000);
  });

  it('refuses a Pack Mule respec it cannot pay for with nothing changed: layout, pods, units, nodes', () => {
    const { skills, inventory, ships, own } = world({ level: 30, maxTier: 4 });
    own('cartridge_recycler', 'hazard_weave', 'pack_mule');
    skills.hooks.trainerAtHand = () => true;
    expect(inventory.spend(ID, 2200).ok).toBe(true);
    const before = { inventory: structuredClone(inventory.get(ID)), ship: structuredClone(ships.get(ID)), state: skills.get(ID) };
    expect(before.inventory!.pods).toHaveLength(2);
    // the refund would fit the inventory (it is empty), but 300 units do not pay for a point
    expect(skills.request(ID, 1, { op: 'respec', nodes: ['pack_mule'] })).toMatchObject({ error: 'units' });
    expect(inventory.get(ID)).toEqual(before.inventory);
    expect(ships.get(ID)).toEqual(before.ship);
    expect(skills.get(ID)).toBe(before.state);
  });

  it('gives back a pod on refunding Pack Mule only when the ship carries more than its bays', () => {
    const { skills, inventory, ships, own } = world({ level: 30, maxTier: 4 });
    own('cartridge_recycler', 'hazard_weave', 'pack_mule');
    skills.hooks.trainerAtHand = () => true;
    // the Lark has two bays now but carries one pod
    const one = { ...ships.get(ID)!, cargoPods: 1 };
    ships.set(ID, one);
    expect(inventory.setLoadout(ID, { ship: one, skills: skills.owned(ID) }).ok).toBe(true);
    expect(skills.respec(ID, ['pack_mule']).ok).toBe(true);
    expect(ships.get(ID)!.cargoPods).toBe(1);
    expect(inventory.get(ID)!.pods).toHaveLength(1);
    expect(inventory.get(ID)!.stackMax).toBe(9999);
  });

  it('sells only Tier I and II in Phase 1, and says so in the view', () => {
    const { skills, own } = world({ level: 50 });
    expect(skills.view(ID).maxTier).toBe(2);
    own('cartridge_recycler', 'hazard_weave');
    expect(skills.unlock(ID, 'pack_mule', { kind: 'trainer', trainer: 'city_master' })).toMatchObject({ ok: false, error: { code: 'phase' } });
    expect(skills.unlock(ID, 'pack_mule', { kind: 'dev' })).toMatchObject({ ok: false, error: { code: 'phase' } });
    expect(skills.grantFragments(ID, 'gravitic', 20).ok).toBe(true);
    expect(skills.request(ID, 1, { op: 'unlock', node: 'anchor' })).toMatchObject({ error: 'phase' });
    expect(skills.request(ID, 2, { op: 'unlock', node: 'slam' }).error).toBeUndefined();
    skills.maxTier = 4;
    expect(skills.view(ID).maxTier).toBe(4);
    expect(skills.request(ID, 3, { op: 'unlock', node: 'anchor' }).error).toBeUndefined();
  });

  it('raises only the stack cap for a character with no ship', () => {
    const { inventory, ships, own } = world({ level: 30, hull: null, maxTier: 4 });
    own('cartridge_recycler', 'hazard_weave', 'pack_mule');
    expect(ships.get(ID)).toBeNull();
    expect(inventory.get(ID)!.pods).toHaveLength(0);
    expect(inventory.get(ID)!.stackMax).toBe(15000);
  });

  it('keeps a change and the other listeners when one listener throws', () => {
    const errors: unknown[] = [];
    const inventory = new InventoryService();
    const ships = new ShipLoadouts();
    const progress = new CharacterProgress();
    const skills = new SkillService({ inventory, ships, progress, onListenerError: (e) => errors.push(e) });
    progress.set(ID, { level: 5, xp: 0, homeSystem: 0 });
    skills.open(ID, newSkillState('thalune'), 'thalune');
    const heard: string[] = [];
    skills.subscribe(() => {
      throw new Error('boom');
    });
    skills.subscribe((id) => heard.push(id));
    expect(skills.grantPoints(ID, 1).ok).toBe(true);
    expect(skills.points(ID).granted).toBe(1);
    expect(heard).toEqual([ID]);
    expect(errors).toHaveLength(1);
  });
});
