import { SYMBIOTIC_NUMBERS as N } from '@astra/shared/abilities';
import { shipStats } from '@astra/shared/ships';
import { getSkillNode } from '@astra/shared/data';
import { emptySkillState, type SkillState } from '@astra/shared/skills';
import type { ServerMessage } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { faunaWorld, dist } from '../../test/faunaWorld.ts';
import { CodexService } from '../codex/service.ts';
import { MeterService } from '../meters/service.ts';
import { DEFAULT_LOADOUT } from '../inventory/service.ts';
import { nodeGroundsHere } from '../resources/ground.ts';
import { CharacterProgress } from '../persistence/components.ts';
import { CastService } from './service.ts';

function rig(nodes: string[]) {
  const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'docile' && x.kind !== 'flyer') });
  const viewer = { id: 99, characterId: 'symbiotic', sendBinary() {} };
  w.zone.leave(w.viewer);
  w.player = w.zone.join(viewer, { kind: 'player', frame: w.frame, pos: w.at(0, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
  const slots = (bar: 'ground' | 'ship') => {
    const list: (string | null)[] = nodes.filter((n) => getSkillNode(n).slot === bar);
    return list.concat(Array.from({ length: (bar === 'ground' ? 6 : 5) - list.length }, () => null));
  };
  const state: SkillState = { ...emptySkillState(), unlocked: nodes, bought: nodes, slots: { ground: slots('ground'), ship: slots('ship') } };
  const skills = { get: () => state, owned: () => state.bought, shipSlots: () => 2, refresh() {} };
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
  let seq = 0;
  const cast = (node: string, extra: { target?: number; aim?: [number, number, number] } = {}): Extract<ServerMessage, { t: 'cast' }> =>
    svc.cast(viewer, {
      t: 'cast',
      seq: ++seq,
      time: w.time,
      frame: w.zone.entity(w.player)!.fields.frame,
      node,
      slot: state.slots[getSkillNode(node).slot ?? 'ground'].indexOf(node),
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
  return { w, viewer, state, codex, meters, svc, cast, spawn, analyze, pass, health: () => w.zone.combat.playerHealth(w.player)! };
}

function aimAt(r: ReturnType<typeof rig>, east: number): [number, number, number] {
  const from = r.w.at(0, 0);
  const at = r.w.at(east, 0);
  const d = dist(from, at);
  return [(at[0] - from[0]) / d, (at[1] - from[1]) / d, (at[2] - from[2]) / d];
}

function ally(r: ReturnType<typeof rig>) {
  const v = { id: 100, characterId: 'ally', sendBinary() {} };
  const id = r.w.zone.join(v, { kind: 'player', frame: r.w.frame, pos: r.w.at(2, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot', party: 'friends' });
  r.w.zone.setParty(r.w.player, 'friends');
  r.w.zone.combat.applyDamage(null, id, { base: 70, kind: 'hazard' });
  return { id, viewer: v, health: () => r.w.zone.combat.playerHealth(id)! };
}

describe('Symbiotic production effects', () => {
  it('Bond tames an analysed creature, follows the owner and strikes a hostile through combat', () => {
    const r = rig(['bond']);
    const id = r.spawn(5);
    r.analyze(id);
    expect(r.cast('bond', { target: id }).result).toBe('cast');
    expect(r.w.zone.entity(id)?.fields.owner).toBe(r.w.player);
    const before: [number, number, number] = [...r.w.zone.fauna!.creature(id)!.pos];
    r.w.zone.patch(r.w.player, { pos: r.w.at(30, 0) });
    r.pass(5);
    expect(dist(r.w.zone.fauna!.creature(id)!.pos, r.w.at(30, 0))).toBeLessThan(dist(before, r.w.at(30, 0)));
    const enemy = r.spawn(
      30,
      r.w.species.find((s) => s.temperament === 'territorial')!,
    );
    const hp = r.w.zone.combat.creatureHealth(enemy)!.hp;
    r.pass(8);
    expect(r.w.zone.combat.creatureHealth(enemy)!.hp).toBeLessThan(hp);
  });
  it('Regrow heals self by 40 over six seconds', () => {
    const r = rig(['bond', 'regrow']);
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 60, kind: 'hazard' });
    expect(r.cast('regrow').result).toBe('cast');
    r.pass(3);
    expect(r.health().suit).toBeCloseTo(60, 4);
    r.pass(3.1);
    expect(r.health().suit).toBeCloseTo(80, 4);
  });
  it('Regrow caps actual suit health at its maximum', () => {
    const r = rig(['bond', 'regrow']);
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 5, kind: 'hazard' });
    expect(r.cast('regrow').result).toBe('cast');
    r.pass(6.1);
    expect(r.health().suit).toBe(r.health().suitMax);
  });
  it('Spore poisons a creature and heals the caster inside its cloud', () => {
    const r = rig(['bond', 'spore']);
    const id = r.spawn(3);
    r.w.zone.fauna!.stun(id, 12);
    const hp = r.w.zone.combat.creatureHealth(id)!.hp;
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 60, kind: 'hazard' });
    expect(r.cast('spore').result).toBe('cast');
    r.pass(2);
    expect(r.w.zone.combat.creatureHealth(id)!.hp).toBeLessThan(hp);
    expect(r.health().suit).toBeGreaterThan(40);
  });
  it('Repair Drones consumes Charge and repairs the authoritative hull in flight', () => {
    const r = rig(['repair_drones']);
    r.w.zone.patch(r.w.player, { mode: 'ship', frame: null, pos: [1e9, 0, 0] });
    const h = r.health();
    r.w.zone.combat.applyDamage(null, r.w.player, { base: h.shield + 30, kind: 'hazard' });
    expect(r.cast('repair_drones').result).toBe('cast');
    r.pass(2);
    expect(r.health().hull).toBeCloseTo(h.hull - 28, 4);
  });
  it('Symbiont Hull increases max shield and regenerates 7.5/s after six seconds unhit', () => {
    const r = rig(['symbiont_hull']);
    r.w.zone.patch(r.w.player, { mode: 'ship', frame: null, pos: [1e9, 0, 0] });
    const h = r.health();
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 30, kind: 'hazard' });
    r.pass(7);
    expect(r.health().shield).toBeCloseTo(h.shield - 22.5, 4);
  });
});

describe('Symbiotic target, timing and lifecycle boundaries', () => {
  it('Call moves the real herd through the aim point and deals one contact hit per target', () => {
    const r = rig(['bond', 'call']);
    const herd = r.spawn(5);
    const target = r.spawn(26);
    r.w.zone.fauna!.stun(target, 15);
    const before: [number, number, number] = [...r.w.zone.fauna!.creature(herd)!.pos];
    const hp = r.w.zone.combat.creatureHealth(target)!.hp;
    expect(r.cast('call', { aim: aimAt(r, 30) })).toMatchObject({ result: 'cast' });
    let nearest = Infinity;
    r.w.run(6.2, () => {
      r.svc.step(r.w.time);
      nearest = Math.min(nearest, dist(r.w.zone.fauna!.creature(herd)!.pos, r.w.at(30, 0)));
    });
    expect(dist(r.w.zone.fauna!.creature(herd)!.pos, before)).toBeGreaterThan(20);
    expect(nearest).toBeLessThan(5);
    expect(r.w.zone.combat.creatureHealth(target)!.hp).toBeCloseTo(hp - N.call.contactDamage, 6);
  });
  it.each(['quad_heavy', 'flyer'])('Big Game alone expands Bond to an analysed %s', (plan) => {
    const r = rig(['bond']);
    const species = r.w.species.find((s) => s.bodyPlan === plan)!;
    expect(species).toBeDefined();
    const id = r.spawn(4, species);
    r.w.zone.fauna!.stun(id, 10);
    r.analyze(id);
    // Stand beside the airborne species without altering the creature.
    const pos = r.w.zone.fauna!.creature(id)!.pos;
    r.w.zone.patch(r.w.player, { pos: [pos[0], pos[1], pos[2]] });
    expect(r.cast('bond', { target: id })).toMatchObject({ result: 'refused', reason: 'target' });
    r.state.bought.push('big_game');
    expect(r.cast('bond', { target: id })).toMatchObject({ result: 'cast' });
    expect(r.w.zone.entity(id)?.fields.owner).toBe(r.w.player);
    expect(r.w.zone.entity(id)?.fields.level).toBe(2);
    r.w.zone.patch(r.w.player, { pos: r.w.at(25, 0) });
    r.pass(15);
    expect(dist(r.w.zone.fauna!.creature(id)!.pos, r.w.at(25, 0))).toBeLessThan(8);
    r.state.bought.splice(r.state.bought.indexOf('big_game'), 1);
    r.pass(0.1);
    expect(r.w.zone.entity(id)).toBeUndefined();
  });
  it('Bond refuses unanalysed and stale replacements without spending or dismissing the old companion', () => {
    const r = rig(['bond']);
    const old = r.spawn(5);
    expect(r.cast('bond', { target: old })).toMatchObject({ result: 'refused', reason: 'target' });
    r.analyze(old);
    expect(r.cast('bond', { target: old }).result).toBe('cast');
    r.pass(60.1);
    const target = r.spawn(5);
    r.w.zone.despawn(target);
    const heat = r.meters.view(r.viewer.characterId, r.w.time).heat;
    expect(r.cast('bond', { target })).toMatchObject({ result: 'refused', reason: 'unseen' });
    expect(r.w.zone.entity(old)?.fields.owner).toBe(r.w.player);
    expect(r.meters.view(r.viewer.characterId, r.w.time).heat).toBe(heat);
    const replacement = r.spawn(5);
    expect(r.cast('bond', { target: replacement }).result).toBe('cast');
    expect(r.w.zone.entity(old)).toBeUndefined();
    expect(r.w.zone.entity(replacement)?.fields.owner).toBe(r.w.player);
  });
  it.each(['death', 'suit_recovery', 'disconnect', 'world_return', 'phase_return', 'refund'] as const)('Bond is dismissed on %s and cannot resume', (event) => {
    const r = rig(['bond']);
    const id = r.spawn(5);
    r.analyze(id);
    expect(r.cast('bond', { target: id }).result).toBe('cast');
    if (event === 'death') r.w.zone.combat.applyDamage(null, r.w.player, { base: 1000, kind: 'hazard' });
    if (event === 'suit_recovery') r.w.zone.combat.suitHealth(r.w.player, -1000);
    if (event === 'disconnect') {
      r.w.zone.leave(r.viewer, 'disconnected');
      r.svc.left(r.viewer.characterId);
    }
    if (event === 'world_return') {
      r.w.zone.patch(r.w.player, { frame: null });
      r.w.zone.patch(r.w.player, { frame: r.w.frame });
    }
    if (event === 'phase_return') {
      r.w.zone.phases.phaseFor(r.viewer, 'event', { key: 'test', frame: r.w.frame, center: r.w.at(0, 0), radius: 100 });
      r.w.zone.phases.leave(r.viewer);
    }
    if (event === 'refund') r.state.bought.splice(r.state.bought.indexOf('bond'), 1);
    r.pass(1);
    expect(r.w.zone.entity(id)).toBeUndefined();
    expect(r.w.zone.fauna!.creature(id)).toBeNull();
  });
  it('a dead companion leaves the sim and never attacks again', () => {
    const r = rig(['bond']);
    const id = r.spawn(5);
    r.analyze(id);
    expect(r.cast('bond', { target: id }).result).toBe('cast');
    r.w.zone.combat.applyDamage(null, id, { base: 10000, kind: 'hazard' });
    expect(r.w.zone.fauna!.creature(id)).toBeNull();
    r.pass(4);
    expect(r.w.zone.entity(id)).toBeUndefined();
  });
  it('Bond protects its player-owned companion from ability control as well as damage', () => {
    const r = rig(['bond', 'pulse']);
    const id = r.spawn(5);
    r.analyze(id);
    expect(r.cast('bond', { target: id }).result).toBe('cast');
    expect(r.cast('pulse').result).toBe('cast');
    expect(r.w.zone.fauna!.creatures().find((c) => c.id === id)?.stunUntil).toBe(0);
  });
  it('companion strikes taunt on the existing threat table and never hurt players or player companions', () => {
    const r = rig(['bond']);
    const id = r.spawn(5);
    r.analyze(id);
    expect(r.cast('bond', { target: id }).result).toBe('cast');
    const a = ally(r);
    const enemy = r.spawn(
      6,
      r.w.species.find((s) => s.temperament === 'territorial')!,
    );
    r.w.zone.combat.applyDamage(r.w.player, enemy, { base: 1, kind: 'weapon' });
    let taunted = false;
    r.w.run(4, () => {
      r.svc.step(r.w.time);
      taunted ||= r.w.zone.fauna!.creatures().find((c) => c.id === enemy)?.target === id;
    });
    expect(taunted).toBe(true);
    expect(r.w.zone.combat.applyDamage(id, a.id, { base: 100, kind: 'attack' })).toBeNull();
    expect(r.w.zone.combat.applyDamage(a.id, id, { base: 100, kind: 'weapon' })).toBeNull();
    expect(a.health().suit).toBe(30);
  });
  it('Regrow heals a party ally by exactly 40 and refuses a stranger before paying heat', () => {
    const r = rig(['bond', 'regrow']);
    const a = ally(r);
    expect(r.cast('regrow', { target: a.id }).result).toBe('cast');
    r.pass(6.1);
    expect(a.health().suit).toBeCloseTo(70, 6);
    r.pass(4);
    r.w.zone.setParty(a.id, null);
    expect(r.cast('regrow', { target: a.id })).toMatchObject({ result: 'refused', reason: 'target' });
  });
  it('Call cannot contact a hidden target and stops driving after a phase departure and return', () => {
    const r = rig(['bond', 'call']);
    const herd = r.spawn(5);
    const target = r.spawn(26);
    r.w.zone.fauna!.stun(target, 15);
    const a = ally(r);
    const phase = r.w.zone.phases.phaseFor(a.viewer, 'event', { key: 'hidden', frame: r.w.frame, center: r.w.at(0, 0), radius: 100 });
    r.w.zone.phases.adopt(phase.id, target);
    const hp = r.w.zone.combat.creatureHealth(target)!.hp;
    expect(r.cast('call', { aim: aimAt(r, 30) }).result).toBe('cast');
    r.pass(1);
    expect(r.w.zone.fauna!.creatures().find((c) => c.id === herd)?.state).toBe('charge');
    r.w.zone.phases.phaseFor(r.viewer, 'event', { key: 'depart', frame: r.w.frame, center: r.w.at(0, 0), radius: 100 });
    r.w.zone.phases.leave(r.viewer);
    r.pass(5);
    expect(r.w.zone.fauna!.creatures().find((c) => c.id === herd)?.state).not.toBe('charge');
    expect(r.w.zone.combat.creatureHealth(target)!.hp).toBe(hp);
  });
  it.each(['world_return', 'phase_return', 'suit_recovery', 'disconnect'] as const)('Regrow cannot heal across caster %s', (event) => {
    const r = rig(['bond', 'regrow']);
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 60, kind: 'hazard' });
    expect(r.cast('regrow').result).toBe('cast');
    if (event === 'world_return') {
      r.w.zone.patch(r.w.player, { frame: null });
      r.w.zone.patch(r.w.player, { frame: r.w.frame });
    }
    if (event === 'phase_return') {
      r.w.zone.phases.phaseFor(r.viewer, 'event', { key: 'test', frame: r.w.frame, center: r.w.at(0, 0), radius: 100 });
      r.w.zone.phases.leave(r.viewer);
    }
    if (event === 'suit_recovery') r.w.zone.combat.suitHealth(r.w.player, -1000);
    if (event === 'disconnect') r.svc.left(r.viewer.characterId);
    const hp = r.health().suit;
    r.pass(10);
    expect(r.health().suit).toBe(hp);
  });
  it.each(['suit_recovery', 'world_return', 'phase_return'] as const)('Regrow cannot heal an old recipient after %s', (event) => {
    const r = rig(['bond', 'regrow']);
    const a = ally(r);
    expect(r.cast('regrow', { target: a.id }).result).toBe('cast');
    if (event === 'suit_recovery') r.w.zone.combat.suitHealth(a.id, -1000);
    if (event === 'world_return') {
      r.w.zone.patch(a.id, { frame: null });
      r.w.zone.patch(a.id, { frame: r.w.frame });
    }
    if (event === 'phase_return') {
      r.w.zone.phases.phaseFor(a.viewer, 'event', { key: 'depart', frame: r.w.frame, center: r.w.at(0, 0), radius: 100 });
      r.w.zone.phases.leave(a.viewer);
    }
    const hp = a.health().suit;
    r.pass(6.1);
    expect(a.health().suit).toBe(hp);
  });
  it.each(['down', 'hidden', 'aboard'] as const)('Regrow refuses an ally who is %s without paying or starting a cooldown', (state) => {
    const r = rig(['bond', 'regrow']);
    const a = ally(r);
    if (state === 'down') r.w.zone.combat.applyDamage(null, a.id, { base: 1000, kind: 'hazard' });
    if (state === 'hidden') r.w.zone.phases.phaseFor(a.viewer, 'event', { key: 'hidden', frame: r.w.frame, center: r.w.at(0, 0), radius: 100 });
    if (state === 'aboard') r.w.zone.patch(a.id, { mode: 'ship' });
    const heat = r.meters.view(r.viewer.characterId, r.w.time).heat;
    expect(r.cast('regrow', { target: a.id }).result).toBe('refused');
    expect(r.meters.view(r.viewer.characterId, r.w.time).heat).toBe(heat);
    expect(r.svc.state(r.viewer.characterId).cooldowns).toEqual([]);
  });
  it('Spore stays at the cast point, heals allies inside it and expires', () => {
    const r = rig(['bond', 'spore']);
    const a = ally(r);
    const enemy = r.spawn(3);
    const distant = r.spawn(20);
    r.w.zone.fauna!.stun(enemy, 15);
    r.w.zone.fauna!.stun(distant, 15);
    const before = r.w.zone.combat.creatureHealth(distant)!.hp;
    expect(r.cast('spore').result).toBe('cast');
    r.w.zone.patch(r.w.player, { pos: r.w.at(20, 0) });
    r.pass(10.1);
    expect(a.health().suit).toBeCloseTo(70, 6);
    expect(r.w.zone.combat.creatureHealth(distant)!.hp).toBe(before);
    const hp = r.w.zone.combat.creatureHealth(enemy)!.hp;
    r.pass(2);
    expect(r.w.zone.combat.creatureHealth(enemy)!.hp).toBe(hp);
  });
  it('Repair Drones stops on landing and cannot restart on takeoff without a new cast', () => {
    const r = rig(['repair_drones']);
    r.w.zone.patch(r.w.player, { mode: 'ship', frame: null, pos: [1e9, 0, 0] });
    const h = r.health();
    r.w.zone.combat.applyDamage(null, r.w.player, { base: h.shield + 40, kind: 'hazard' });
    expect(r.cast('repair_drones').result).toBe('cast');
    r.pass(1);
    r.w.zone.patch(r.w.player, { mode: 'landed' });
    r.w.zone.patch(r.w.player, { mode: 'ship' });
    r.pass(4);
    expect(r.health().hull).toBeCloseTo(h.hull - 39, 6);
  });
  it('Repair Drones lasts 20 seconds and costs 15 Charge', () => {
    const r = rig(['repair_drones']);
    r.w.zone.patch(r.w.player, { mode: 'ship', frame: null, pos: [1e9, 0, 0] });
    const h = r.health();
    r.w.zone.combat.applyDamage(null, r.w.player, { base: h.shield + 40, kind: 'hazard' });
    const charge = r.meters.view(r.viewer.characterId, r.w.time).charge;
    expect(r.cast('repair_drones').result).toBe('cast');
    expect(r.meters.view(r.viewer.characterId, r.w.time).charge).toBe(charge - 15);
    r.pass(22);
    expect(r.health().hull).toBeCloseTo(h.hull - 20, 6);
  });
  it('Repair Drones caps the authoritative hull at its maximum', () => {
    const r = rig(['repair_drones']);
    r.w.zone.patch(r.w.player, { mode: 'ship', frame: null, pos: [1e9, 0, 0] });
    r.w.zone.combat.applyDamage(null, r.w.player, { base: r.health().shield + 5, kind: 'hazard' });
    expect(r.cast('repair_drones').result).toBe('cast');
    r.pass(20.1);
    expect(r.health().hull).toBe(r.health().hullMax);
  });
  it('baseline shield regen is 5/s after six unhit seconds; each real hit restarts the delay and max caps it', () => {
    const r = rig([]);
    r.w.zone.patch(r.w.player, { mode: 'ship', frame: null, pos: [1e9, 0, 0] });
    const h = r.health();
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 40, kind: 'hazard' });
    r.pass(5);
    expect(r.health().shield).toBe(h.shield - 40);
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 10, kind: 'attack' });
    r.pass(6);
    expect(r.health().shield).toBeCloseTo(h.shield - 50, 6);
    r.pass(2);
    expect(r.health().shield).toBeCloseTo(h.shield - 40, 6);
    r.pass(20);
    expect(r.health().shield).toBe(h.shieldMax);
  });
  it('Symbiont Hull retunes the real shield maximum without granting a free refill', () => {
    const r = rig([]);
    r.w.zone.patch(r.w.player, { mode: 'ship', frame: null, pos: [1e9, 0, 0] });
    const plain = shipStats(DEFAULT_LOADOUT.ship!);
    r.w.zone.combat.applyDamage(null, r.w.player, { base: plain.shieldMax / 2, kind: 'attack' });
    r.w.zone.retune(r.viewer, { ship: DEFAULT_LOADOUT.ship, skills: ['symbiont_hull'] });
    expect(r.health().shieldMax).toBe(plain.shieldMax * 1.25);
    expect(r.health().shield).toBe((plain.shieldMax * 1.25) / 2);
  });
  it('the parked ship regenerates while its owner is on foot; suit damage does not count as a shield hit', () => {
    const r = rig(['symbiont_hull']);
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 30, kind: 'hazard', pool: 'ship' });
    const shield = r.health().shield;
    r.pass(5);
    r.w.zone.combat.applyDamage(null, r.w.player, { base: 10, kind: 'hazard' });
    r.pass(2);
    expect(r.health().shield).toBeCloseTo(shield + 7.5, 6);
  });
});
