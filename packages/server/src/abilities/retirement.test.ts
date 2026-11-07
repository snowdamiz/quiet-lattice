import { SkillService } from '../skills/service.ts';
import { getSkillNode } from '@astra/shared/data';
import { emptySkillState } from '@astra/shared/skills';
import type { ServerMessage } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { faunaWorld } from '../../test/faunaWorld.ts';
import { CodexService } from '../codex/service.ts';
import { MeterService } from '../meters/service.ts';
import { InventoryService, DEFAULT_LOADOUT } from '../inventory/service.ts';
import { nodeGroundsHere } from '../resources/ground.ts';
import { CharacterProgress, ShipLoadouts } from '../persistence/components.ts';
import { CastService } from './service.ts';

function rig(nodes: string[]) {
  const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'docile' && x.kind !== 'flyer') });
  const viewer = { id: 99, characterId: 'symbiotic', sendBinary() {} };
  w.zone.leave(w.viewer);
  w.player = w.zone.join(viewer, { kind: 'player', frame: w.frame, pos: w.at(0, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
  const inventory = new InventoryService();
  const ships = new ShipLoadouts();
  const progress = new CharacterProgress();
  const id = viewer.characterId;
  progress.set(id, { level: 29, xp: 0, homeSystem: 0 });
  ships.set(id, DEFAULT_LOADOUT.ship);
  inventory.open(id, { loadout: { ship: DEFAULT_LOADOUT.ship, skills: [] } });
  const skills = new SkillService({ inventory, ships, progress, hooks: { trainerAtHand: () => true } });
  skills.open(id, emptySkillState(), 'thalune');
  let skillSeq = 0;
  for (const node of nodes) {
    expect(skills.unlock(id, node, { kind: 'dev' }).ok).toBe(true);
    expect(skills.buy(id, node).ok).toBe(true);
    const bar = getSkillNode(node).slot;
    if (bar) expect(skills.request(id, ++skillSeq, { op: 'slot', bar, index: skills.get(id)!.slots[bar].indexOf(null), node }).error).toBeUndefined();
  }
  const codex = new CodexService({ progress: new CharacterProgress(), skills });
  codex.open(viewer.characterId);
  const meters = new MeterService({ skills, ships: { get: () => DEFAULT_LOADOUT.ship }, zones: { zoneOf: () => w.zone } });
  meters.open(viewer.characterId, { heat: 0, overheated: false, charge: 100, lifeSupport: 100, hazard: 100, at: w.time });
  meters.locate(viewer.characterId, viewer, w.time);
  w.zone.combat.joined(w.player, { characterId: viewer.characterId, ship: DEFAULT_LOADOUT.ship, skills: nodes });
  const svc = new CastService({
    zones: { zoneOf: (v) => (w.zone.has(v) ? w.zone : undefined), tier: () => 3 },
    skills,
    codex,
    meters,
    grounds: nodeGroundsHere,
    now: () => w.time,
  });
  skills.subscribe((id) => svc.skillsChanged(id));
  let seq = 0;
  const cast = (node: string, extra: { target?: number; aim?: [number, number, number] } = {}): Extract<ServerMessage, { t: 'cast' }> =>
    svc.cast(viewer, {
      t: 'cast',
      seq: ++seq,
      time: w.time,
      frame: w.zone.entity(w.player)!.fields.frame,
      node,
      slot: skills.get(id)!.slots[getSkillNode(node).slot ?? 'ground'].indexOf(node),
      aim: extra.aim ?? [0, 0, -1],
      ...extra,
    });
  const spawn = (east: number, species = w.species.find((s) => s.temperament === 'docile' && s.kind !== 'flyer')!) => {
    const id = w.spawn({ body: w.body.index, species: species.index, at: w.at(east, 0), count: 1, level: 2 }).creatures[0]!;
    return id;
  };
  const analyze = (id: number) => {
    const c = w.zone.fauna!.creature(id)!;
    codex.record(
      viewer.characterId,
      { system: w.zone.systemIndex, world: w.frame, index: c.species.index, bodyPlan: c.species.bodyPlan, temperament: c.species.temperament },
      w.time,
    );
  };
  const pass = (s: number) => w.run(s, () => svc.step(w.time));
  return { w, viewer, skills, inventory, codex, meters, svc, cast, spawn, analyze, pass, health: () => w.zone.combat.playerHealth(w.player)! };
}

describe('cast retirement through real skill-service notifications', () => {
  it('retires Bond when the real service removes its ownership', () => {
    const r = rig(['bond']);
    const id = r.spawn(5);
    r.analyze(id);
    expect(r.cast('bond', { target: id }).result).toBe('cast');
    const units = r.inventory.get(r.viewer.characterId)!.units;
    expect(r.skills.respec(r.viewer.characterId, ['bond']).ok).toBe(true);
    expect(r.inventory.get(r.viewer.characterId)!.units).toBe(units - 500);
    expect(r.w.zone.entity(id)).toBeUndefined();
    expect(r.skills.get(r.viewer.characterId)!.bought).not.toContain('bond');
    expect(r.skills.buy(r.viewer.characterId, 'bond').ok).toBe(true);
    r.pass(0.5);
    expect(r.w.zone.entity(id)?.fields.owner).toBeUndefined();
  });
  it('retires Regrow when the real service removes its ownership', () => {
    const r = rig(['bond', 'regrow']);
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 60, kind: 'hazard' });
    expect(r.cast('regrow').result).toBe('cast');
    expect(r.skills.respec(r.viewer.characterId, ['regrow']).ok).toBe(true);
    expect(r.skills.get(r.viewer.characterId)!.bought).not.toContain('regrow');
    expect(r.skills.buy(r.viewer.characterId, 'regrow').ok).toBe(true);
    r.pass(6.1);
    expect(r.health().suit).toBe(40);
  });
  it.each(['quad_heavy', 'flyer'] as const)('dismisses an analysed %s before a Big Game rebuy can hide eligibility loss', (plan) => {
    const r = rig(['bond', 'big_game']);
    const id = r.spawn(
      5,
      r.w.species.find((s) => s.bodyPlan === plan)!,
    );
    r.analyze(id);
    expect(r.cast('bond', { target: id }).result).toBe('cast');
    expect(r.skills.respec(r.viewer.characterId, ['big_game']).ok).toBe(true);
    expect(r.w.zone.entity(id)).toBeUndefined();
    expect(r.skills.buy(r.viewer.characterId, 'big_game').ok).toBe(true);
    r.pass(0.5);
    expect(r.w.zone.fauna!.creature(id)).toBeNull();
  });
  it('preserves Bond and Regrow through an unrelated purchase and refund', () => {
    const r = rig(['bond', 'regrow']);
    const id = r.spawn(5);
    r.analyze(id);
    expect(r.cast('bond', { target: id }).result).toBe('cast');
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 60, kind: 'hazard' });
    expect(r.cast('regrow').result).toBe('cast');
    expect(r.skills.buy(r.viewer.characterId, 'second_lung').ok).toBe(true);
    expect(r.skills.respec(r.viewer.characterId, ['second_lung']).ok).toBe(true);
    r.pass(6.1);
    expect(r.w.zone.entity(id)?.fields.owner).toBe(r.w.player);
    expect(r.health().suit).toBeCloseTo(80, 6);
  });
  it('retires Call control before a refund and rebuy between fauna ticks', () => {
    const r = rig(['bond', 'call']);
    r.spawn(5);
    const enemy = r.spawn(26);
    r.w.zone.fauna!.stun(enemy, 10);
    const hp = r.w.zone.combat.creatureHealth(enemy)!.hp;
    const a = r.w.at(0, 0);
    const b = r.w.at(30, 0);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    expect(r.cast('call', { aim: [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d] }).result).toBe('cast');
    expect(r.skills.respec(r.viewer.characterId, ['call']).ok).toBe(true);
    expect(r.skills.buy(r.viewer.characterId, 'call').ok).toBe(true);
    r.pass(6.1);
    expect(r.w.zone.combat.creatureHealth(enemy)!.hp).toBe(hp);
  });
});
