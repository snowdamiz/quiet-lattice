// The Pilot branch's Tier I–II nodes (P1.E07.T09, DESIGN 9.7) are passives: each changes a number a server system reads, so
// each is tested through the system that reads it, not through the table that holds it. Movement authority judges a ship's
// speed and the speed it comes to rest at; the meters burn the pulse drive's fuel; a zone's combat gives a ship its shield and
// hull; the hazard rule takes a hostile sky's damage through the plating. A node bought or refunded in play changes all of
// them at once (`retune`).
import { HAZARDS } from '@astra/shared/data';
import { flightCaps, hazardDamagePerS, hazardDepth, SHIP_GEAR_HEIGHT, shipStats, type ShipLoadout } from '@astra/shared/ships';
import { frameIdOf } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { MeterService } from '../meters/service.ts';
import { Harness, LARK, pose } from '../sim/movement/testing.ts';
import { groundOf, heightAt, type Vec3 } from '../sim/movement/world.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';

const D = describeZoneSystem(0);
const HOME = frameIdOf(D.seed, D.home)!;
const HOME_R = D.bodies[D.home]!.radius;
/** Far above the system's plane: no sphere of influence, nothing near. */
const OPEN: Vec3 = [0, 2e9, 0];

const stats = (...skills: string[]) => shipStats(LARK, { skills });

/** Flies a straight line in open space at `v` m/s for `seconds`, an input every 50 ms; whether the server let it. */
function flies(v: number, seconds: number, skills: string[] = []): boolean {
  const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' }, { skills });
  let p: Vec3 = [...OPEN];
  for (let i = 0; i < seconds * 20; i++) h.send(pose(null, (p = [p[0] + v * 0.05, p[1], p[2]]), [v, 0, 0]), 'ship');
  return h.refusals.length === 0;
}

describe('Throttle Tuning and Photon Thrusters: top speed', () => {
  // the Lark's space speed is 600 m/s and the server allows a tenth and 50 m/s over it
  it('Throttle Tuning: +10%, the server lets the ship fly 660', () => {
    expect(flies(740, 2)).toBe(false);
    expect(flies(740, 2, ['throttle_tuning'])).toBe(true);
    expect(flies(790, 2, ['throttle_tuning'])).toBe(false);
  });

  it('Photon Thrusters: +25%, the server lets the ship fly 750', () => {
    expect(flies(860, 2, ['throttle_tuning'])).toBe(false);
    expect(flies(860, 2, ['photon_thrusters'])).toBe(true);
    expect(flies(890, 2, ['photon_thrusters'])).toBe(false);
  });

  it('both multiply: 600 × 1.1 × 1.25', () => {
    expect(flies(940, 2, ['throttle_tuning', 'photon_thrusters'])).toBe(true);
    expect(flies(970, 2, ['throttle_tuning', 'photon_thrusters'])).toBe(false);
    expect(flightCaps(stats('throttle_tuning', 'photon_thrusters'), 'space').max).toBeCloseTo(825, 9);
  });

  it('a node bought in flight is the server’s limit from the next input, and one refunded takes it away', () => {
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' }, { skills: [] });
    let p: Vec3 = [...OPEN];
    const fly = (v: number, seconds: number) => {
      for (let i = 0; i < seconds * 20; i++) h.send(pose(null, (p = [p[0] + v * 0.05, p[1], p[2]]), [v, 0, 0]), 'ship');
    };
    fly(600, 2);
    h.a.retune(h.id, { ship: LARK, skills: ['photon_thrusters'] });
    fly(850, 3);
    expect(h.refusals).toEqual([]);
    h.a.retune(h.id, { ship: LARK, skills: [] });
    fly(850, 3);
    expect(h.corrections.length).toBeGreaterThan(0);
  });
});

describe('Soft Landing: the speed a ship may come to rest at', () => {
  const g = groundOf(D, D.home)!;
  const up: Vec3 = [0, 0, -1];
  const ground = HOME_R + heightAt(g, up);
  const at = (alt: number): Vec3 => [
    up[0] * (ground + SHIP_GEAR_HEIGHT + alt),
    up[1] * (ground + SHIP_GEAR_HEIGHT + alt),
    up[2] * (ground + SHIP_GEAR_HEIGHT + alt),
  ];

  /** A ship dropping straight onto dry ground at `v` m/s, then at rest on its gear; the rules the server corrected it by. */
  function lands(v: number, skills: string[] = []): string[] {
    const step = v * 0.05;
    const n = Math.floor(400 / step);
    const h = new Harness(D, { pose: pose(HOME, at((n + 1) * step)), mode: 'ship' }, { skills });
    for (let k = n; k >= 1; k--) h.send(pose(HOME, at(k * step), [-up[0] * v, -up[1] * v, -up[2] * v]), 'ship');
    h.send(pose(HOME, at(0)), 'landed');
    return h.corrections.map((c) => (c as { violation: { rule: string } }).violation.rule);
  }

  it('160 without it: a ship coming down at 200 is refused its landing, one at 150 lands', () => {
    expect(lands(150)).toEqual([]);
    expect(lands(200)).toContain('landing_speed');
  });

  it('220 with it: the ship that was refused at 200 lands, and one at 260 still is not', () => {
    expect(lands(200, ['soft_landing'])).toEqual([]);
    expect(lands(260, ['soft_landing'])).toContain('landing_speed');
  });

  it('is the ship’s number for the client’s own landing check too', () => {
    expect(stats().landingSpeedMax).toBe(160);
    expect(stats('soft_landing').landingSpeedMax).toBe(220);
  });
});

describe('Reserve Tank: the pulse drive burns Charge 25% slower', () => {
  const NOW = 2.3e7;
  /** Charge left after `seconds` of the pulse drive near bodies (a character whose place is not known is charged as near one). */
  function chargeAfter(seconds: number, owned: string[]): number {
    const meters = new MeterService({ ships: { get: () => LARK }, skills: { owned: () => owned }, zones: { zoneOf: () => undefined } });
    meters.open('c1', { heat: 0, overheated: false, charge: 100, at: NOW });
    meters.flown('c1', 'pulse', seconds, NOW, NOW);
    return meters.view('c1', NOW).charge;
  }

  it('0.35/s, 0.2625/s with it', () => {
    expect(chargeAfter(10, [])).toBeCloseTo(100 - 3.5, 9);
    expect(chargeAfter(10, ['reserve_tank'])).toBeCloseTo(100 - 2.625, 9);
  });

  it('the drive runs a third longer on a full tank', () => {
    expect(chargeAfter(280, ['reserve_tank'])).toBeGreaterThan(0);
    expect(chargeAfter(280, [])).toBe(2);
  });
});

describe('Shield Capacitor and Hull Plating: a ship’s shield and hull', () => {
  class Viewer implements ZoneViewer {
    readonly characterId = 'c1';
    constructor(readonly id: number) {}
    sendBinary(): void {}
  }
  function aboard(skills: string[], ship: ShipLoadout = LARK) {
    const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: D, fauna: false });
    const viewer = new Viewer(1);
    zone.step(2.3e7);
    const entity = zone.join(
      viewer,
      { kind: 'player', frame: null, pos: OPEN, quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' },
      { profile: { ship, skills, characterId: 'c1' }, now: 2.3e7 },
    );
    const hit = (base: number) => zone.combat.applyDamage(null, entity, { base, kind: 'attack' });
    return { zone, viewer, entity, hit, health: () => zone.combat.playerHealth(entity)! };
  }

  it('Shield Capacitor: shield 125', () => {
    expect(aboard([]).health()).toMatchObject({ shield: 100, shieldMax: 100 });
    const a = aboard(['shield_capacitor']);
    expect(a.health()).toMatchObject({ shield: 125, shieldMax: 125, hull: 100 });
    a.hit(110);
    expect(a.health()).toMatchObject({ shield: 15, hull: 100 });
  });

  it('Hull Plating: hull 125, and the ship that went down at 200 stands', () => {
    const bare = aboard([]);
    expect(bare.hit(200)).toMatchObject({ killed: true });
    const plated = aboard(['hull_plating']);
    expect(plated.health()).toMatchObject({ hull: 125, hullMax: 125, shield: 100 });
    expect(plated.hit(200)).toMatchObject({ killed: false });
    expect(plated.health()).toMatchObject({ shield: 0, hull: 25, down: null });
  });

  it('a plate bought in flight adds its capacity and none of the damage taken is repaired; one refunded takes the capacity back', () => {
    const a = aboard([]);
    a.hit(150);
    expect(a.health()).toMatchObject({ shield: 0, hull: 50 });
    a.zone.retune(a.viewer, { ship: LARK, skills: ['shield_capacitor', 'hull_plating'] });
    expect(a.health()).toMatchObject({ shield: 25, shieldMax: 125, hull: 75, hullMax: 125 });
    a.zone.retune(a.viewer, { ship: LARK, skills: [] });
    expect(a.health()).toMatchObject({ shield: 0, shieldMax: 100, hull: 50, hullMax: 100 });
  });

  it('a downed ship stays down when its nodes change', () => {
    const a = aboard([]);
    a.hit(500);
    a.zone.retune(a.viewer, { ship: LARK, skills: ['hull_plating'] });
    expect(a.health()).toMatchObject({ down: 'ship' });
  });

  it('scales with the hull: 125% of what the hull has', () => {
    const swift: ShipLoadout = { hull: 'swift', modules: {}, cargoPods: 0, livery: 0 };
    expect(aboard([], swift).health()).toMatchObject({ shieldMax: 90, hullMax: 70 });
    expect(aboard(['shield_capacitor', 'hull_plating'], swift).health()).toMatchObject({ shieldMax: 112.5, hullMax: 87.5 });
  });
});

describe('Thermal Plating, Pressure Hull and Hazard Coating: hostile skies hurt a third as much', () => {
  const sky = (kind: (typeof HAZARDS)[number]) => ({ kind, dps: 9, ceiling: 1000, curve: 1.3 });
  const hurt = (kind: (typeof HAZARDS)[number], ...skills: string[]) => hazardDamagePerS(sky(kind), 1, stats(...skills));

  it('Thermal Plating: heat and cryo, no other', () => {
    for (const kind of HAZARDS) expect(hurt(kind, 'thermal_plating'), kind).toBeCloseTo(kind === 'heat' || kind === 'cryo' ? 3 : 9, 12);
  });

  it('Pressure Hull: pressure, no other', () => {
    for (const kind of HAZARDS) expect(hurt(kind, 'pressure_hull'), kind).toBeCloseTo(kind === 'pressure' ? 3 : 9, 12);
  });

  it('Hazard Coating: acid, radiation and storm, no other', () => {
    for (const kind of HAZARDS) expect(hurt(kind, 'hazard_coating'), kind).toBeCloseTo(['acid', 'radiation', 'storm'].includes(kind) ? 3 : 9, 12);
  });

  it('all three cover every hazard, each once: a third, never a ninth', () => {
    for (const kind of HAZARDS) expect(hurt(kind, 'thermal_plating', 'pressure_hull', 'hazard_coating'), kind).toBeCloseTo(3, 12);
  });

  it('rises toward the ground as the layer’s curve says, after the plating', () => {
    const heat = { kind: 'heat', dps: 9, ceiling: 14000 } as const;
    const shallow = hazardDepth(heat, 14000 - 1400);
    expect(shallow).toBeCloseTo(0.1, 12);
    expect(hazardDamagePerS(heat, shallow, stats())).toBeCloseTo(9 * 0.1 ** 1.3, 12);
    expect(hazardDamagePerS(heat, shallow, stats('thermal_plating'))).toBeCloseTo((9 * 0.1 ** 1.3) / 3, 12);
    expect(hazardDepth(heat, 20000)).toBe(0);
    expect(hazardDepth(heat, -5)).toBe(1);
  });
});
