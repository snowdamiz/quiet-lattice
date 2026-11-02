import { describe, expect, it } from 'vitest';
import { frameId, type Hazard, type SystemDescription } from '@astra/shared/world';
import { SHIP_GEAR_HEIGHT, type ShipLoadout } from '@astra/shared/ships';
import { STATION_LAYOUT } from '@astra/shared/data';
import { planHere, type GroundSource } from '../fauna/terrain.ts';
import { padPose } from '../sim/movement/authority.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone } from '../zones/zone.ts';
import { ZoneCombat, type DownedReport } from './zone.ts';
import { shipReentry } from './environment.ts';

const LARK: ShipLoadout = { hull: 'lark', modules: {}, cargoPods: 1, livery: 0 };

function rig(kind: Hazard['kind'] = 'heat', skills: string[] = [], grounds: GroundSource = planHere) {
  const base = describeZoneSystem(0);
  const body = base.bodies[base.home]!;
  if (body.params.type === 'gas') throw new Error('home world must be rocky');
  const params = { ...body.params, hazard: { kind, label: kind, ceiling: 1000, dps: 12, curve: 1 } };
  const system: SystemDescription = { ...base, bodies: base.bodies.map((b) => (b === body ? { ...body, params } : b)) };
  const zone = new Zone({ id: 'hazards', systemIndex: 0, system, fauna: false });
  const downed: DownedReport[] = [];
  const combat = new ZoneCombat(zone, { grounds, random: () => 0, hooks: () => ({ downed: (r) => downed.push(r) }) });
  const ground = planHere.ground(params)!;
  const r = body.radius + Math.max(0, ground.sample([0, 1, 0])) + SHIP_GEAR_HEIGHT;
  const id = zone.spawn({ kind: 'player', frame: frameId(system.seed, body.index), pos: [0, r, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' });
  combat.joined(id, { characterId: 'pilot', ship: LARK, skills });
  combat.step(100);
  return { zone, combat, id, downed, ground, health: () => combat.playerHealth(id)!, step: (time: number) => combat.step(time) };
}

describe('the server ship hazard tick', () => {
  it('requires observed descent in air, sufficient speed, a rocky world and flying mode for re-entry', () => {
    const w = rig();
    const fields = w.zone.entity(w.id)!.fields;
    expect(shipReentry(w.zone.system, fields, [0, -1400, 0])).toBe(1);
    expect(shipReentry(w.zone.system, fields, [0, 1400, 0])).toBe(0);
    expect(shipReentry(w.zone.system, fields, [0, -600, 0])).toBe(0);
    expect(shipReentry(w.zone.system, { ...fields, mode: 'landed' }, [0, -1400, 0])).toBe(0);
    expect(shipReentry(w.zone.system, { ...fields, pos: [0, 1e8, 0] }, [0, -1400, 0])).toBe(0);
  });
  it.each([
    ['heat', 'thermal_plating'],
    ['cryo', 'thermal_plating'],
    ['pressure', 'pressure_hull'],
    ['acid', 'hazard_coating'],
    ['radiation', 'hazard_coating'],
    ['storm', 'hazard_coating'],
  ] as const)('%s takes 12 hull/s without %s and 4 with it once shields are exhausted', (kind, plating) => {
    const plain = rig(kind);
    const plated = rig(kind, [plating]);
    for (const w of [plain, plated]) w.combat.applyDamage(null, w.id, { base: 100, kind: 'attack' });
    plain.step(101);
    plated.step(101);
    expect(plain.health()).toMatchObject({ hull: 88, shield: 0, suit: 100 });
    expect(plated.health()).toMatchObject({ hull: 96, shield: 0, suit: 100 });
    expect(plain.zone.entity(plain.id)!.fields.hp).toBe(0.88);
    expect(plated.zone.entity(plated.id)!.fields.hp).toBe(0.96);
  });

  it('takes shields first, exposes nothing above the ceiling or on foot, and reads retuned plating immediately', () => {
    const w = rig();
    w.step(101);
    expect(w.health()).toMatchObject({ shield: 88, hull: 100 });
    w.combat.retuned(w.id, { ship: LARK, skills: ['thermal_plating'] });
    w.step(102);
    expect(w.health().shield).toBeCloseTo(84, 10);
    const pos = w.zone.entity(w.id)!.fields.pos;
    w.zone.patch(w.id, { pos: [pos[0], pos[1] + 1000, pos[2]] });
    w.step(103);
    expect(w.health().shield).toBeCloseTo(84, 10);
    w.zone.patch(w.id, { pos: [...pos], mode: 'foot' });
    w.step(104);
    expect(w.health().shield).toBeCloseTo(84, 10);
    expect(w.health()).toMatchObject({ hull: 100, suit: 100 });
  });

  it('keeps server-timed extra storm strikes and applies Hazard Coating to them too; landed ships get only the sky rate', () => {
    const plain = rig('storm');
    const plated = rig('storm', ['hazard_coating']);
    const landed = rig('storm');
    landed.zone.patch(landed.id, { mode: 'landed' });
    for (const w of [plain, plated, landed]) w.step(103);
    expect(plain.health().shield).toBe(59); // 36 continuous + one 5-damage strike
    expect(plated.health().shield).toBeCloseTo(100 - 41 / 3, 10);
    expect(landed.health().shield).toBe(64);
  });

  it('reports one server ship death and stops there, without a repair, tax or teleport', () => {
    const w = rig();
    const pos = w.zone.entity(w.id)!.fields.pos;
    w.step(120);
    w.step(121);
    expect(w.health()).toMatchObject({ hull: 0, shield: 0, down: 'ship' });
    expect(w.downed).toEqual([{ zone: 'hazards', entity: w.id, characterId: 'pilot', cause: 'ship', source: null, at: 120 }]);
    expect(w.zone.entity(w.id)!.fields.pos).toEqual(pos);
  });

  it('a long stalled storm tick stops at death instead of rolling strikes for time the ship cannot survive', () => {
    const w = rig('storm');
    w.step(1e8);
    expect(w.health()).toMatchObject({ hull: 0, shield: 0, down: 'ship' });
    expect(w.downed).toHaveLength(1);
  });

  it('waits for ground without blocking or guessing exposure, then charges only the next ready interval', () => {
    let ready = false;
    const w = rig('heat', [], { ground: (p, tier) => (ready ? planHere.ground(p, tier) : null) });
    w.step(110);
    expect(w.health().shield).toBe(100);
    ready = true;
    w.step(111);
    expect(w.health().shield).toBe(88);
  });

  it('keeps already-earned re-entry through a handoff and disembarking, and applies it to the ship once', () => {
    const source = rig();
    const target = rig();
    source.combat.moved(source.id, { seconds: 0.1, vel: [0, -1400, 0], fromMode: 'ship' });
    source.zone.patch(source.id, { mode: 'foot' });
    target.zone.patch(target.id, { mode: 'foot' });
    source.combat.transfer(source.id, target.combat, target.id);
    target.step(150);
    expect(target.health().shield).toBeCloseTo(98, 8);
    expect(target.health().suit).toBe(100);
    target.step(151);
    expect(target.health().shield).toBeCloseTo(98, 8);
  });

  it('repairs 20 hull/s and refills shields once at a real pad; neither a forged dock location nor mode toggles buy service', () => {
    const w = rig();
    const observed = () => w.combat.moved(w.id, { seconds: 1, vel: [0, 0, 0], fromMode: 'docked' });
    w.combat.applyDamage(null, w.id, { base: 150, kind: 'attack' });
    w.zone.patch(w.id, { frame: w.zone.stationFrame, mode: 'docked', pos: [0, STATION_LAYOUT.padTop + SHIP_GEAR_HEIGHT, 0] });
    observed();
    w.step(101);
    expect(w.health()).toMatchObject({ hull: 50, shield: 0 });
    w.zone.patch(w.id, padPose(w.zone.stationFrame, 0));
    observed();
    w.step(102);
    expect(w.health()).toMatchObject({ hull: 70, shield: 100 });
    w.combat.applyDamage(null, w.id, { base: 50, kind: 'attack' });
    w.zone.patch(w.id, { mode: 'ship' });
    observed();
    w.step(103);
    w.zone.patch(w.id, { mode: 'docked' });
    observed();
    w.step(104);
    expect(w.health()).toMatchObject({ hull: 90, shield: 50 });
    w.zone.patch(w.id, { mode: 'ship', pos: [0, 14, 30] });
    observed();
    w.step(105);
    w.zone.patch(w.id, { ...padPose(w.zone.stationFrame, 0), mode: 'docked' });
    observed();
    w.step(106);
    expect(w.health()).toMatchObject({ hull: 100, shield: 100 });
  });
});
