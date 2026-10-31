// Heat and Charge (P1.E07.T02, DESIGN 9.1): the cooling table and its world modifiers, the beam and the overheat lockout,
// Charge regeneration and the pulse drive's burn, the skill nodes and hull perks that change them, the place a character is
// as the meters read it, and that stepping by frames or by inputs reaches the same values.
import { describe, expect, it } from 'vitest';
import { METERS } from '../src/data/index.ts';
import {
  HABITABLE_BAND,
  NEAR_STAR_RADII,
  NOWHERE,
  PULSE_BURN_REACH,
  UNDERWATER_DEPTH,
  addHeat,
  canEngagePulse,
  canFireBeam,
  chargeRegenPerS,
  clampMeters,
  coolingPerS,
  freshMeters,
  meterConditions,
  meterEnvironment,
  meterProfile,
  meterRates,
  meterSaveSchema,
  meterViewSchema,
  refillCharge,
  spendCharge,
  stepMeters,
  type MeterActivity,
  type MeterEnvironment,
  type MeterProfile,
  type MeterState,
} from '../src/meters/index.ts';
import type { ShipLoadout } from '../src/ships/index.ts';
import { describeSystem, systemPoses, type SystemDescription, type Vec3 } from '../src/world/index.ts';

const LARK: ShipLoadout = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };
const lark = meterProfile({ ship: LARK });
const env = (e: Partial<MeterEnvironment> = {}): MeterEnvironment => ({ ...NOWHERE, ...e });
const cool = (e: Partial<MeterEnvironment>, channelling = false, p: MeterProfile = lark) => coolingPerS(p, meterConditions(env(e)), channelling);
const idle: MeterActivity = { beam: false, pulse: false };
const beam: MeterActivity = { beam: true, pulse: false };
const pulse: MeterActivity = { beam: false, pulse: true };
const state = (s: Partial<MeterState> = {}): MeterState => ({ heat: 0, overheated: false, charge: 100, ...s });

describe('the cooling table (DESIGN 9.1)', () => {
  it('cools 20/s idle and 8/s while channelling, with no world modifier', () => {
    expect(cool({})).toBe(20);
    expect(cool({}, true)).toBe(8);
    // a lush world by day changes nothing
    expect(cool({ world: 'lush', time: 'day' })).toBe(20);
  });

  it.each([
    ['frozen worlds +50%', { world: 'frozen', time: 'day' }, 1.5],
    ['cryo worlds +50% (a world with a cryo hazard)', { world: 'crushing', hazards: ['cryo'], time: 'day' }, 1.5],
    ['desert in daylight −40%', { world: 'desert', time: 'day' }, 0.6],
    ['volcanic in daylight −40%', { world: 'volcanic', time: 'day' }, 0.6],
    ['inferno in daylight −40%', { world: 'inferno', time: 'day' }, 0.6],
    ['underwater +100%', { world: 'lush', time: 'day', underwater: true }, 2],
    ['night +10%', { world: 'lush', time: 'night' }, 1.1],
    // the daylight penalty is daylight's: a desert night is a night
    ['a desert by night: +10%, no daylight penalty', { world: 'desert', time: 'night' }, 1.1],
    ['frozen at night: ×1.5 × 1.1', { world: 'frozen', time: 'night' }, 1.5 * 1.1],
    ['under a frozen sea at night: ×1.5 × 2 × 1.1', { world: 'frozen', time: 'night', underwater: true }, 1.5 * 2 * 1.1],
    ['under a desert sea by day: ×0.6 × 2', { world: 'desert', time: 'day', underwater: true }, 0.6 * 2],
  ] as const)('%s', (_, e, mult) => {
    expect(cool(e as Partial<MeterEnvironment>)).toBeCloseTo(20 * mult, 12);
    expect(cool(e as Partial<MeterEnvironment>, true)).toBeCloseTo(8 * mult, 12);
  });

  it('reads the table from METERS, one modifier per DESIGN line', () => {
    expect(METERS.heat.worldModifiers.map((w) => [w.when, w.coolingMult])).toEqual([
      ['frozen_or_cryo', 1.5],
      ['hot_world_daylight', 0.6],
      ['underwater', 2],
      ['night', 1.1],
    ]);
  });
});

describe('the beam and the overheat lockout', () => {
  it('heats at 32/s against 8/s of cooling: a cool meter overheats after 100/24 s, not before', () => {
    const tFull = 100 / 24;
    const before = stepMeters(state(), lark, env(), beam, tFull - 1e-6);
    expect(before.state.overheated).toBe(false);
    expect(before.state.heat).toBeCloseTo(100, 3);
    expect(before.events).toEqual([]);
    const at = stepMeters(state(), lark, env(), beam, tFull + 1e-6);
    expect(at.state.overheated).toBe(true);
    expect(at.events).toEqual(['overheated']);
    expect(at.beamS).toBeCloseTo(tFull, 9);
    expect(canFireBeam(at.state)).toBe(false);
  });

  it('locks the beam out until heat falls to 25 at the idle rate, then fires again if it is still held', () => {
    // 100 → 25 at 20/s takes 3.75 s, held beam or not
    const locked = stepMeters(state({ heat: 100, overheated: true }), lark, env(), beam, 3.7);
    expect(locked.state).toMatchObject({ overheated: true });
    expect(locked.state.heat).toBeCloseTo(26, 9);
    expect(locked.beamS).toBe(0);
    const freed = stepMeters(state({ heat: 100, overheated: true }), lark, env(), beam, 3.75 + 0.5);
    expect(freed.events).toEqual(['recovered']);
    expect(freed.state.overheated).toBe(false);
    // half a second of beam again from 25
    expect(freed.state.heat).toBeCloseTo(25 + 24 * 0.5, 9);
    expect(freed.beamS).toBeCloseTo(0.5, 9);
  });

  it('cools a meter at rest to 0 and no further, and cools faster under water', () => {
    expect(stepMeters(state({ heat: 50 }), lark, env(), idle, 2).state.heat).toBeCloseTo(10, 12);
    expect(stepMeters(state({ heat: 50 }), lark, env(), idle, 10).state.heat).toBe(0);
    expect(stepMeters(state({ heat: 50 }), lark, env({ world: 'lush', time: 'day', underwater: true }), idle, 1).state.heat).toBeCloseTo(10, 12);
  });

  it('runs whole overheat cycles in one long step', () => {
    // 100/24 s to overheat, 3.75 s to recover, and 75/24 s back to the top: two overheats and a recovery in 12 s
    const s = stepMeters(state(), lark, env(), beam, 12);
    expect(s.events).toEqual(['overheated', 'recovered', 'overheated']);
    expect(s.beamS).toBeCloseTo(100 / 24 + 75 / 24, 9);
  });

  it('adds abilities’ heat in chunks, refusing them in the lockout and overheating at the top', () => {
    const r = addHeat(state({ heat: 70 }), lark, 15);
    expect(r).toMatchObject({ ok: true, state: { heat: 85, overheated: false }, events: [] });
    expect(addHeat(state({ heat: 90 }), lark, 15)).toMatchObject({ ok: true, state: { heat: 100, overheated: true }, events: ['overheated'] });
    expect(addHeat(state({ heat: 60, overheated: true }), lark, 10)).toEqual({ ok: false, error: 'overheated' });
  });
});

describe('the step does not matter', () => {
  // a minute of play: mine, overheat, wait, mine again, dive, fly the pulse drive near a body and out of the band
  const script: [number, MeterActivity, Partial<MeterEnvironment>][] = [
    [6.2, beam, { world: 'desert', time: 'day' }],
    [3.1, idle, { world: 'desert', time: 'day' }],
    [2.5, beam, { world: 'desert', time: 'night', underwater: true }],
    [4, idle, { sunlight: true, habitableBand: true }],
    [9.3, pulse, { sunlight: false, nearBodies: true }],
    [7, pulse, { sunlight: true, habitableBand: true, nearBodies: true }],
    [5, idle, { sunlight: true, habitableBand: true }],
  ];

  function run(dt: number, from: MeterState): MeterState {
    let s = from;
    for (const [secs, act, e] of script) {
      const n = Math.max(1, Math.round(secs / dt));
      for (let i = 0; i < n; i++) s = stepMeters(s, lark, env(e), act, secs / n).state;
    }
    return s;
  }

  it('reaches the same meters by 60 fps frames, 20 Hz inputs and whole stretches', () => {
    const from = state({ heat: 10, charge: 40 });
    const frames = run(1 / 60, from);
    const inputs = run(1 / 20, from);
    const whole = run(100, from);
    for (const s of [inputs, whole]) {
      expect(s.overheated).toBe(frames.overheated);
      expect(s.heat).toBeCloseTo(frames.heat, 9);
      expect(s.charge).toBeCloseTo(frames.charge, 9);
    }
  });
});

describe('Charge', () => {
  const band = env({ sunlight: true, habitableBand: true });

  it('regenerates 2/s in sunlight inside the habitable band, nothing in shadow, outside the band or in deep space', () => {
    expect(chargeRegenPerS(lark, band, meterConditions(band))).toBe(2);
    for (const e of [env({ sunlight: false, habitableBand: true }), env({ sunlight: true }), env({ sunlight: true, deepSpace: true })])
      expect(chargeRegenPerS(lark, e, meterConditions(e))).toBe(0);
    expect(stepMeters(state({ charge: 40 }), lark, band, idle, 10).state.charge).toBeCloseTo(60, 12);
    // never past the hull's capacity
    expect(stepMeters(state({ charge: 99 }), lark, band, idle, 10).state.charge).toBe(100);
  });

  it('burns 0.35/s on the pulse drive near bodies, none in the open, and drops the drive when it runs out', () => {
    const near = env({ nearBodies: true });
    expect(stepMeters(state({ charge: 10 }), lark, near, pulse, 10).state.charge).toBeCloseTo(6.5, 12);
    expect(stepMeters(state({ charge: 10 }), lark, env(), pulse, 10).state.charge).toBe(10);
    const out = stepMeters(state({ charge: 1 }), lark, near, pulse, 10);
    expect(out.state.charge).toBe(0);
    expect(out.events).toEqual(['charge_empty']);
    expect(out.pulse).toBe(false);
    expect(canEngagePulse(out.state, lark)).toBe(false);
    // the drive will not engage on an empty meter
    expect(stepMeters(state({ charge: 0 }), lark, near, pulse, 1).pulse).toBe(false);
    // in the sunlit band the regeneration outruns the burn
    expect(meterRates(state({ charge: 50 }), lark, { ...band, nearBodies: true }, pulse).charge).toBeCloseTo(2 - 0.35, 12);
  });

  it('spends ship actives’ Charge only when the meter holds it, and refills to the brim', () => {
    expect(spendCharge(state({ charge: 30 }), 25)).toMatchObject({ ok: true, state: { charge: 5 } });
    expect(spendCharge(state({ charge: 20 }), 25)).toEqual({ ok: false, error: 'charge' });
    expect(spendCharge(state({ charge: 25 }), 25)).toMatchObject({ ok: true, state: { charge: 0 }, events: ['charge_empty'] });
    expect(refillCharge(state({ charge: 3 }), lark).charge).toBe(100);
  });

  it('is the flown hull’s: none without a ship, and held to a smaller hull’s capacity', () => {
    const none = meterProfile({ ship: null });
    expect(none.chargeCapacity).toBe(0);
    expect(chargeRegenPerS(none, band, meterConditions(band))).toBe(0);
    expect(canEngagePulse(state({ charge: 50 }), none)).toBe(false);
    const mule = meterProfile({ ship: { hull: 'mule', modules: {}, cargoPods: 4, livery: 0 } });
    expect(mule.chargeCapacity).toBe(80);
    expect(clampMeters(state({ charge: 100 }), mule).charge).toBe(80);
    expect(freshMeters(mule)).toEqual({ heat: 0, overheated: false, charge: 80 });
  });
});

describe('skill nodes, hull perks and buffs', () => {
  it('Tempered Core: heat capacity 125, and the meter overheats at the top of it', () => {
    const p = meterProfile({ ship: LARK, skills: ['tempered_core'] });
    expect(p.heatCapacity).toBe(125);
    expect(p.overheatAt).toBe(125);
    expect(p.recoverBelow).toBe(25);
    expect(stepMeters(state({ heat: 100 }), p, env(), beam, 1).state).toMatchObject({ heat: 124, overheated: false });
    const top = stepMeters(state({ heat: 100 }), p, env(), beam, 25 / 24 + 1e-9);
    expect(top.state.overheated).toBe(true);
    expect(top.state.heat).toBeCloseTo(125, 6);
  });

  it('Furnace: cooling +50% everywhere', () => {
    const p = meterProfile({ ship: LARK, skills: ['furnace'] });
    expect(cool({}, false, p)).toBe(30);
    expect(cool({ world: 'frozen', time: 'night' }, true, p)).toBeCloseTo(8 * 1.5 * 1.5 * 1.1, 12);
  });

  it('Reserve Tank: the pulse drive burns 25% less', () => {
    expect(meterProfile({ ship: LARK, skills: ['reserve_tank'] }).pulseBurn).toBeCloseTo(0.35 * 0.75, 12);
  });

  it('Solar Kin: +2/s on hot worlds and near stars, even outside the band; never in deep space', () => {
    const p = meterProfile({ ship: LARK, skills: ['solar_kin'] });
    const regen = (e: Partial<MeterEnvironment>) => chargeRegenPerS(p, env(e), meterConditions(env(e)));
    expect(regen({ world: 'volcanic', time: 'night' })).toBe(2);
    expect(regen({ nearStar: true, sunlight: true })).toBe(2);
    expect(regen({ nearStar: true, sunlight: true, habitableBand: true })).toBe(4);
    expect(regen({ world: 'lush' })).toBe(0);
  });

  it('the Listener regenerates anywhere, deep space included (DESIGN 10.2), and holds 240', () => {
    const p = meterProfile({ ship: { hull: 'listener', modules: {}, cargoPods: 2, livery: 0 } });
    expect(p.chargeCapacity).toBe(240);
    expect(p.regenAnywhere).toBe(true);
    for (const e of [env(), env({ deepSpace: true })]) expect(chargeRegenPerS(p, e, meterConditions(e))).toBe(2);
  });

  it('nothing in deep space, a catalyst’s +2/s included; the Listener’s anywhere-flag regenerates there all the same', () => {
    const catalyst = meterProfile({ ship: LARK, buffs: [{ stat: 'charge.regen', op: 'add', value: 2 }] });
    const deep = env({ deepSpace: true, sunlight: true });
    expect(chargeRegenPerS(catalyst, deep, meterConditions(deep))).toBe(0);
    expect(stepMeters(state({ charge: 10 }), catalyst, deep, idle, 60).state.charge).toBe(10);
    const listener = meterProfile({ ship: { hull: 'listener', modules: {}, cargoPods: 2, livery: 0 }, buffs: [{ stat: 'charge.regen', op: 'add', value: 2 }] });
    expect(chargeRegenPerS(listener, deep, meterConditions(deep))).toBe(4);
  });

  it('catalysts: Frostglass +25 heat capacity, Stormquartz +2/s Charge', () => {
    const p = meterProfile({
      ship: LARK,
      buffs: [
        { stat: 'heat.capacity', op: 'add', value: 25 },
        { stat: 'charge.regen', op: 'add', value: 2 },
      ],
    });
    expect(p.heatCapacity).toBe(125);
    expect(chargeRegenPerS(p, env({ sunlight: true, habitableBand: true }), meterConditions(env({ sunlight: true, habitableBand: true })))).toBe(4);
    // Void's heat discounts change ability costs, not the meter
    expect(meterProfile({ ship: LARK, buffs: [{ stat: 'heat.cost', op: 'mul', value: 0.8, branch: 'void' }] }).mods).toEqual([]);
  });
});

describe('where a character is', () => {
  const d: SystemDescription = describeSystem(424242);
  const t = 5000;
  const poses = systemPoses(d, t);
  const home = d.bodies[d.home]!;
  const homePos = poses.bodies[d.home]!.position;
  const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  // the star is at the origin: sunward from the home world is −homePos
  const sunward = unit([-homePos[0], -homePos[1], -homePos[2]]);
  const at = (dir: Vec3, alt: number): Vec3 => [
    homePos[0] + dir[0] * (home.radius + alt),
    homePos[1] + dir[1] * (home.radius + alt),
    homePos[2] + dir[2] * (home.radius + alt),
  ];
  const placeOnHome = (dir: Vec3, alt: number, foot = true) => meterEnvironment(d, poses.bodies, { frame: d.home, world: at(dir, alt), foot });

  it('the home world’s day side: day, in sunlight, inside the habitable band', () => {
    const e = placeOnHome(sunward, 2);
    expect(e).toMatchObject({ world: home.type, time: 'day', sunlight: true, habitableBand: true, deepSpace: false, nearBodies: true });
  });

  it('its night side: night, in its own shadow; high above the night side, out of the shadow, in sunlight again', () => {
    const night = placeOnHome([-sunward[0], -sunward[1], -sunward[2]], 2);
    expect(night).toMatchObject({ time: 'night', sunlight: false });
    // three radii out, square to the sun line: night by its horizon, but the planet no longer stands between it and the star
    const side = unit([sunward[1], -sunward[0], 0]);
    const off = meterEnvironment(d, poses.bodies, { frame: d.home, world: at(side, home.radius * 3) });
    expect(off.sunlight).toBe(true);
  });

  it('a body between a point and the star hides the star from it', () => {
    // just behind a moon, on the side away from the star
    const moon = d.bodies.findIndex((b) => b.kind === 'moon');
    const m = poses.bodies[moon]!.position;
    const away = unit(m);
    const behind: Vec3 = [
      m[0] + away[0] * d.bodies[moon]!.radius * 1.5,
      m[1] + away[1] * d.bodies[moon]!.radius * 1.5,
      m[2] + away[2] * d.bodies[moon]!.radius * 1.5,
    ];
    expect(meterEnvironment(d, poses.bodies, { frame: null, world: behind }).sunlight).toBe(false);
    const front: Vec3 = [
      m[0] - away[0] * d.bodies[moon]!.radius * 1.5,
      m[1] - away[1] * d.bodies[moon]!.radius * 1.5,
      m[2] - away[2] * d.bodies[moon]!.radius * 1.5,
    ];
    expect(meterEnvironment(d, poses.bodies, { frame: null, world: front }).sunlight).toBe(true);
  });

  it('underwater: on foot, the feet more than 1.6 m under a water sea; never in a ship, never in an acid or lava sea', () => {
    expect(home.params.type !== 'gas' && home.params.hasOcean).toBe(true);
    expect(placeOnHome(sunward, -(UNDERWATER_DEPTH + 0.5)).underwater).toBe(true);
    expect(placeOnHome(sunward, -(UNDERWATER_DEPTH - 0.5)).underwater).toBe(false);
    expect(placeOnHome(sunward, -(UNDERWATER_DEPTH + 0.5), false).underwater).toBe(false);
    // body 3 is a corrosive world with a glowing sea
    const acid = d.bodies[3]!;
    expect(acid.params.type !== 'gas' && acid.params.water.emissive).toBeGreaterThan(0);
    const p = poses.bodies[3]!.position;
    const deep: Vec3 = [p[0], p[1] + acid.radius - 10, p[2]];
    expect(meterEnvironment(d, poses.bodies, { frame: 3, world: deep, foot: true }).underwater).toBe(false);
  });

  it('the band, the star’s neighbourhood and deep space', () => {
    const r = home.orbitRadius;
    const on = (dist: number, deepSpace?: boolean) => meterEnvironment(d, poses.bodies, { frame: null, world: [0, dist, 0], deepSpace });
    expect(on(r).habitableBand).toBe(true);
    expect(on(r * HABITABLE_BAND * 0.99).habitableBand).toBe(true);
    expect(on(r * HABITABLE_BAND * 1.01).habitableBand).toBe(false);
    expect(on(r / HABITABLE_BAND / 1.01).habitableBand).toBe(false);
    expect(on(d.star.radius * NEAR_STAR_RADII * 0.9).nearStar).toBe(true);
    expect(on(d.star.radius * NEAR_STAR_RADII * 1.1).nearStar).toBe(false);
    expect(on(d.outerOrbit * 1.01)).toMatchObject({ deepSpace: true, habitableBand: false, nearBodies: false });
    expect(on(r, true)).toMatchObject({ deepSpace: true, habitableBand: false });
    // a ship coasting through the band, far above the system's plane and every body, burns nothing on the pulse drive
    expect(on(r).nearBodies).toBe(
      Math.min(...d.bodies.map((b, i) => Math.hypot(...poses.bodies[i]!.position.map((c, k) => c - [0, r, 0][k]!)) - b.radius)) < PULSE_BURN_REACH,
    );
  });

  it('turns into the conditions the tables are keyed by', () => {
    expect([...meterConditions(env({ world: 'desert', time: 'day' }))].sort()).toEqual([
      'day_on_desert_or_volcanic',
      'daylight_on_living_world',
      'hot_world_daylight',
      'hot_world_or_near_star',
    ]);
    expect([...meterConditions(env({ sunlight: true, habitableBand: true }))]).toEqual(['sunlit_habitable_band']);
    expect([...meterConditions(env({ deepSpace: true }))]).toEqual(['deep_space']);
    // what the meters cannot know (combat, health, docking) never holds here
    expect(meterConditions(env()).has('out_of_combat')).toBe(false);
  });
});

describe('as JSON', () => {
  it('stores and sends finite meters within their capacities', () => {
    expect(meterSaveSchema.safeParse({ heat: 40, overheated: false, charge: 77.5, at: 1234.5 }).success).toBe(true);
    expect(meterSaveSchema.safeParse({ heat: -1, overheated: false, charge: 0, at: 0 }).success).toBe(false);
    expect(meterSaveSchema.safeParse({ heat: 1, overheated: false, charge: 0, at: 0, extra: 1 }).success).toBe(false);
    expect(meterViewSchema.safeParse({ heat: 130, heatMax: 125, overheated: true, charge: 0, chargeMax: 100, at: 1 }).success).toBe(false);
    expect(meterViewSchema.safeParse({ heat: 125, heatMax: 125, overheated: true, charge: 0, chargeMax: 0, at: 1 }).success).toBe(true);
  });
});
