// The ship model (P1.E12.T01): stats from the hull roster and the skill web, fitting rules, flight caps and signature.
import { describe, expect, it } from 'vitest';
import { HULLS, HULL_IDS, getHull } from '../src/data/index.ts';
import type { HullId, StatMod } from '../src/data/index.ts';
import {
  CLIENT_SPEED_HEADROOM,
  FLIGHT_MODES,
  FLIGHT_TOLERANCE,
  LoadoutError,
  PULSE_DRIVE,
  allowanceAfterChange,
  applyMods,
  detectionDistance,
  effectiveSignature,
  flightCaps,
  hardpointMarkers,
  hardpointsOf,
  pulseSpeedLimit,
  shipLoadoutSchema,
  shipStats,
  validateLoadout,
} from '../src/ships/index.ts';
import type { ShipLoadout, ShipStats } from '../src/ships/index.ts';
// Read as text through Vite's ?raw import, so the shared package's tests need no Node types.
import DESIGN from '../../../docs/DESIGN.md?raw';

/** The rows of the first markdown table under a heading, as trimmed cells, without header and separator. */
function designTable(heading: string): string[][] {
  const lines = DESIGN.split('\n');
  const start = lines.findIndex((l) => l.startsWith('#') && l.includes(heading));
  if (start < 0) throw new Error(`DESIGN.md has no heading ${heading}`);
  const first = lines.findIndex((l, i) => i > start && l.startsWith('|'));
  const end = lines.findIndex((l, i) => i > first && !l.startsWith('|'));
  return lines.slice(first + 2, end).map((l) =>
    l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim()),
  );
}

const bare = (hull: HullId): ShipLoadout => ({ hull, modules: {}, cargoPods: 0, livery: 0 });
/** Today's ship: the Lark with its pair of Pulse Lasers and its one cargo pod. */
const DEMO: ShipLoadout = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('shipStats on every hull', () => {
  it('matches DESIGN 10.2 through the data, with no modifiers', () => {
    const rows = designTable('10.2 Hull roster');
    expect(rows).toHaveLength(HULLS.length);
    for (const [name, , , speed, boost, hull, shield, charge, pods, signature, hardpoints, slots] of rows) {
      const h = HULLS.find((x) => x.name === name)!;
      const s = shipStats(bare(h.id));
      expect(s.hullId).toBe(h.id);
      expect(`${s.speed.space}/${s.speed.atmo}`, name).toBe(speed);
      expect(s.boost, name).toBe(Number(boost));
      expect(s.hullMax, name).toBe(Number(hull));
      expect(s.shieldMax, name).toBe(Number(shield));
      expect(s.charge === 'count' ? 'from the Count' : String(s.charge), name).toBe(charge);
      expect(s.cargoPods, name).toBe(Number(pods));
      const split = signature.match(/^([\d.]+) to the Hollow, ([\d.]+) to everyone else$/);
      expect(s.signature, name).toEqual(
        split ? { base: Number(split[2]), vsHollow: Number(split[1]) } : { base: Number(signature), vsHollow: Number(signature) },
      );
      const sizes = hardpoints.split(' ').flatMap((g) => Array<string>(Number(g.slice(0, -1))).fill(g.slice(-1)));
      expect(
        s.hardpoints.map((p) => p.size),
        name,
      ).toEqual(sizes);
      expect(s.hardpoints.every((p) => p.module === null && p.weapon === null)).toBe(true);
      expect(s.abilitySlots, name).toBe(Number(slots));
      expect(s.builtIn.nodes).toEqual(h.builtIn.nodes);
      expect(s.builtIn.flags).toEqual(h.builtIn.flags);
    }
  });

  it('numbers hardpoints by size, as the models mark them', () => {
    expect(hardpointsOf('lark').map((h) => h.id)).toEqual(['s1', 's2']);
    expect(hardpointsOf('kestrel').map((h) => h.id)).toEqual(['s1', 's2', 'm1']);
    expect(hardpointsOf('warden_breaker').map((h) => h.id)).toEqual(['m1', 'm2', 'l1', 'l2']);
    for (const id of HULL_IDS) expect(new Set(hardpointsOf(id).map((h) => h.id)).size).toBe(getHull(id).hardpoints.length);
  });

  it("matches a model's HP_ markers to hardpoints: per size, sorted by name", () => {
    const kestrel = hardpointMarkers('kestrel', ['Hull', 'HP_S_wing_r', 'GearFront', 'hp_s_Wing_L', 'HP_M_nose', 'BAY_1']);
    expect([...kestrel]).toEqual([
      ['s1', 'hp_s_Wing_L'],
      ['s2', 'HP_S_wing_r'],
      ['m1', 'HP_M_nose'],
    ]);
    // digit runs compare as numbers; exact ties fall back to code points
    expect([...hardpointMarkers('dart', ['HP_S_10', 'HP_S_2', 'HP_S_1'])]).toEqual([
      ['s1', 'HP_S_1'],
      ['s2', 'HP_S_2'],
      ['s3', 'HP_S_10'],
    ]);
    expect([...hardpointMarkers('lark', ['hp_s_a', 'HP_S_A'])].map(([, n]) => n)).toEqual(['HP_S_A', 'hp_s_a']);
    // the model must mark exactly the hull's hardpoints
    expect(() => hardpointMarkers('lark', ['HP_S_1'])).toThrow(/2 S hardpoints but its model marks 1/);
    expect(() => hardpointMarkers('lark', ['HP_S_1', 'HP_S_2', 'HP_M_1'])).toThrow(/0 M hardpoints/);
  });

  it("the Wayfarer's base hazard resist ×2 is half damage from every hazard, and its scan range ×2; others are plain", () => {
    expect(Object.values(shipStats(bare('wayfarer')).hazardDamage)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(shipStats(bare('wayfarer')).scanRange).toBe(2);
    for (const id of HULL_IDS.filter((h) => h !== 'wayfarer')) {
      expect(Object.values(shipStats(bare(id)).hazardDamage), id).toEqual([1, 1, 1, 1, 1, 1]);
      expect(shipStats(bare(id)).scanRange, id).toBe(1);
    }
  });

  it('stats are frozen', () => {
    const s = shipStats(DEMO);
    expect(Object.isFrozen(s) && Object.isFrozen(s.speed) && Object.isFrozen(s.hardpoints[0])).toBe(true);
  });
});

describe("the Lark is today's ship", () => {
  // The demo's Ship.js constants before it read them from shipStats.
  it('flies with the demo numbers exactly', () => {
    const s = shipStats(DEMO);
    expect(s.speed).toEqual({ space: 600, atmo: 240 });
    expect(s.boost).toBe(2.6);
    expect(s.hullMax).toBe(100);
    expect(s.shieldMax).toBe(100);
    expect(s.charge).toBe(100);
    expect(s.landingSpeedMax).toBe(160);
    expect(s.pulse).toEqual({ fuelBurn: 0.35, nearLimit: 1 });
    expect(s.hazardDamage).toEqual({ heat: 1, cryo: 1, pressure: 1, acid: 1, radiation: 1, storm: 1 });
    expect(s.hardpoints[0]).toEqual({
      id: 's1',
      size: 'S',
      module: 'pulse_lasers',
      weapon: 'pulse_lasers',
      cooldownS: 0.12,
      rangeM: 1500,
      damage: 11,
      dps: null,
    });
    expect(s.hardpoints[1]).toMatchObject({ id: 's2', module: null });
    // the flight model's hard clamp: 600 × 2.6 × 1.05
    expect(flightCaps(s, 'boost').max * CLIENT_SPEED_HEADROOM).toBe(600 * 2.6 * 1.05);
  });

  it("the pulse drive's limit is the demo's formula", () => {
    const s = shipStats(DEMO);
    for (const d of [0, 100, 545, 1000, 5e5, 1e7, 1.12e7, 3e9, 4e16]) {
      expect(pulseSpeedLimit(s, d)).toBe(Math.max(300, Math.min(d * 0.55, Math.max(280000, d / 40))));
    }
    expect(PULSE_DRIVE.openSpeed * PULSE_DRIVE.cruiseS).toBe(280000 * 40);
  });
});

describe('skill-web modifiers', () => {
  const lark = (...skills: string[]) => shipStats(DEMO, { skills });

  it('Throttle Tuning: top speed +10%, in space and air', () => {
    const s = lark('throttle_tuning');
    close(s.speed.space, 660);
    close(s.speed.atmo, 264);
    expect(s.boost).toBe(2.6);
  });

  it("Photon Thrusters: top speed +25% (the demo shop's upgrade); stacks with Throttle Tuning", () => {
    expect(lark('photon_thrusters').speed).toEqual({ space: 750, atmo: 300 });
    close(lark('throttle_tuning', 'photon_thrusters').speed.space, 825);
  });

  it('Shield Capacitor: shield 125; Hull Plating: hull 125; Keel stacks with Hull Plating', () => {
    expect(lark('shield_capacitor').shieldMax).toBe(125);
    expect(lark('hull_plating').hullMax).toBe(125);
    expect(lark('hull_plating', 'keel').hullMax).toBe(156.25);
    // ×1.25 of the hull's base, not a flat 125
    expect(shipStats(bare('bulwark'), { skills: ['shield_capacitor', 'hull_plating'] })).toMatchObject({ shieldMax: 275, hullMax: 325 });
  });

  it('the shop-era hazard nodes divide hazard damage by 3, and stack with the Wayfarer', () => {
    const s = lark('thermal_plating', 'pressure_hull', 'hazard_coating');
    for (const v of Object.values(s.hazardDamage)) close(v, 1 / 3);
    close(shipStats(bare('wayfarer'), { skills: ['thermal_plating'] }).hazardDamage.heat, 1 / 6);
  });

  it('Soft Landing, Reserve Tank, Supercruise, Gunnery, Pack Mule', () => {
    expect(lark('soft_landing').landingSpeedMax).toBe(220);
    close(lark('reserve_tank').pulse.fuelBurn, 0.2625);
    expect(lark('supercruise').pulse.nearLimit).toBe(1.5);
    expect(pulseSpeedLimit(lark('supercruise'), 1000)).toBeCloseTo(825, 9);
    close(lark('gunnery').hardpoints[0].cooldownS!, 0.08);
    expect(lark('pack_mule').cargoPods).toBe(2);
    expect(shipStats(bare('dart'), { skills: ['pack_mule'] }).cargoPods).toBe(1);
  });

  it('Focused Lasers reaches laser-type weapons only', () => {
    const s = shipStats({ ...bare('kestrel'), modules: { s1: 'pulse_lasers', m1: 'flak_cannon' } }, { skills: ['focused_lasers'] });
    expect(s.hardpoints[0]).toMatchObject({ rangeM: 2200 });
    close(s.hardpoints[0].damage!, 14.3);
    expect(s.hardpoints[2]).toMatchObject({ weapon: 'flak_cannon', rangeM: 1200, damage: 8, cooldownS: 1.2 });
  });

  it('actives and unrelated passives leave the ship alone', () => {
    const plain = shipStats(DEMO);
    expect(lark('afterburner', 'evasive', 'tempered_core')).toEqual(plain);
  });

  it('an unknown skill node is an error', () => {
    expect(() => lark('throttle_tunning')).toThrow(/Unknown skill node/);
  });
});

describe('modifier order, conditions and buffs', () => {
  const speed = (mods: StatMod[]) => applyMods(600, 'ship.speed_max', mods);

  it('add, then mul, then set, whatever order they come in', () => {
    expect(
      speed([
        { stat: 'ship.speed_max', op: 'mul', value: 2 },
        { stat: 'ship.speed_max', op: 'add', value: 100 },
      ]),
    ).toBe(1400);
    expect(
      speed([
        { stat: 'ship.speed_max', op: 'set', value: 1000 },
        { stat: 'ship.speed_max', op: 'mul', value: 2 },
        { stat: 'ship.speed_max', op: 'add', value: 100 },
      ]),
    ).toBe(1000);
    expect(speed([{ stat: 'ship.hull_max', op: 'mul', value: 2 }])).toBe(600);
  });

  it('a buff applies; a conditional one only while its condition holds; a branch-scoped one never to the ship', () => {
    const buff: StatMod = { stat: 'ship.shield_max', op: 'add', value: 20 };
    const docked: StatMod = { stat: 'ship.hull_max', op: 'mul', value: 2, when: 'docked' };
    const voidOnly: StatMod = { stat: 'charge.cost', op: 'mul', value: 0.5, branch: 'void' };
    expect(shipStats(DEMO, { buffs: [buff, docked, voidOnly] })).toMatchObject({ shieldMax: 120, hullMax: 100 });
    expect(shipStats(DEMO, { buffs: [docked], conditions: ['docked'] }).hullMax).toBe(200);
  });
});

describe('fitting', () => {
  const fit = (hull: HullId, modules: Record<string, string>, cargoPods = 0, skills: string[] = []) =>
    validateLoadout({ hull, modules, cargoPods, livery: 0 }, { skills });

  it('a weapon fits a hardpoint of its size or larger', () => {
    expect(fit('lark', { s1: 'pulse_lasers', s2: 'mining_laser' })).toEqual([]);
    expect(fit('bulwark', { m1: 'pulse_lasers', m2: 'beam_lance', l1: 'railgun' })).toEqual([]);
    expect(fit('listener', { m1: 'tractor_mount' })).toEqual([]);
    expect(fit('warden_breaker', { l1: 'emp_pod', l2: 'dreadnought_railgun' })).toEqual([]);
  });

  it('never a smaller one', () => {
    expect(fit('kestrel', { s1: 'beam_lance' })).toEqual([{ code: 'too_large', hardpoint: 's1', module: 'beam_lance', size: 'M', hardpointSize: 'S' }]);
    expect(fit('bulwark', { m1: 'torpedo_rack' })).toEqual([{ code: 'too_large', hardpoint: 'm1', module: 'torpedo_rack', size: 'L', hardpointSize: 'M' }]);
  });

  it('an unknown module, or an item that is not a weapon module', () => {
    expect(fit('lark', { s1: 'plasma_cannon' })).toEqual([{ code: 'unknown_module', hardpoint: 's1', module: 'plasma_cannon' }]);
    for (const module of ['cargo_pod', 'thermal_plating_module', 'husk_plating', 'warp_cell', 'torpedo']) {
      expect(fit('lark', { s1: module })).toEqual([{ code: 'not_a_weapon', hardpoint: 's1', module }]);
    }
  });

  it('too many modules: one for a hardpoint the hull does not have', () => {
    expect(fit('lark', { s1: 'pulse_lasers', s2: 'mining_laser', s3: 'tractor_mount' })).toEqual([
      { code: 'no_such_hardpoint', hardpoint: 's3', module: 'tractor_mount' },
    ]);
    expect(fit('lark', { m1: 'beam_lance' })).toEqual([{ code: 'no_such_hardpoint', hardpoint: 'm1', module: 'beam_lance' }]);
  });

  it('cargo pods up to the bays, which Pack Mule raises', () => {
    expect(fit('mule', {}, 4)).toEqual([]);
    expect(fit('lark', {}, 2)).toEqual([{ code: 'too_many_cargo_pods', pods: 2, capacity: 1 }]);
    expect(fit('lark', {}, 2, ['pack_mule'])).toEqual([]);
    expect(fit('dart', {}, 1)).toEqual([{ code: 'too_many_cargo_pods', pods: 1, capacity: 0 }]);
  });

  it('shipStats refuses a loadout that cannot fly, naming every reason', () => {
    const bad: ShipLoadout = { hull: 'lark', modules: { s1: 'railgun', s3: 'pulse_lasers' }, cargoPods: 5, livery: 0 };
    expect(() => shipStats(bad)).toThrow(LoadoutError);
    try {
      shipStats(bad);
    } catch (e) {
      expect((e as LoadoutError).errors.map((x) => x.code)).toEqual(['too_large', 'no_such_hardpoint', 'too_many_cargo_pods']);
    }
  });
});

describe('flight caps', () => {
  const lark = shipStats(DEMO);
  const T = FLIGHT_TOLERANCE;

  it('per mode, for the Lark', () => {
    expect(flightCaps(lark, 'space')).toEqual({ mode: 'space', max: 600, allowed: 600 * T.factor + T.slackMps });
    expect(flightCaps(lark, 'boost')).toEqual({ mode: 'boost', max: 1560, allowed: 1560 * T.factor + T.slackMps });
    expect(flightCaps(lark, 'atmo').max).toBe(1560);
    expect(flightCaps(lark, 'pulse', 1000)).toEqual({ mode: 'pulse', max: 550, allowed: 550 * T.factor + T.slackMps });
    expect(flightCaps(lark, 'pulse', 1e9).max).toBe(2.5e7);
    expect(flightCaps(lark, 'pulse').max).toBe(Infinity);
    expect(flightCaps(lark, 'landed')).toEqual({ mode: 'landed', max: 0, allowed: T.restSlackMps });
    expect(flightCaps(lark, 'docked')).toEqual({ mode: 'docked', max: 0, allowed: T.restSlackMps });
  });

  it('per hull, and with the pilot', () => {
    expect(flightCaps(shipStats(bare('dart')), 'boost').max).toBe(2700);
    expect(flightCaps(shipStats(bare('longhaul')), 'space').max).toBe(460);
    expect(flightCaps(shipStats(DEMO, { skills: ['photon_thrusters'] }), 'boost').max).toBe(1950);
  });

  it('every mode leaves room over what the client reaches, and between the stars no more than the factor', () => {
    for (const id of HULL_IDS) {
      const s = shipStats(bare(id));
      for (const mode of FLIGHT_MODES) {
        const c = flightCaps(s, mode, 1e6);
        if (mode === 'boost' || mode === 'atmo' || mode === 'space') expect(c.allowed).toBeGreaterThan(c.max * CLIENT_SPEED_HEADROOM);
        else expect(c.allowed).toBeGreaterThan(c.max);
      }
      // the pulse drive drops a ship out under every space cap
      expect(s.speed.space).toBeGreaterThanOrEqual(PULSE_DRIVE.exitSpeedMax);
    }
    const open = flightCaps(lark, 'pulse', 1e15);
    expect(open.allowed / open.max).toBeLessThan(1.11);
  });

  it('after a change of mode: decays in flight, fades into the pulse drive, immediate otherwise', () => {
    const boost = flightCaps(lark, 'boost');
    const space = flightCaps(lark, 'space');
    const pulse = flightCaps(lark, 'pulse', 1000);
    expect(allowanceAfterChange(boost, space, 0)).toBe(boost.allowed);
    expect(allowanceAfterChange(boost, space, 2)).toBe(boost.allowed - 2 * T.decelMps2);
    expect(allowanceAfterChange(boost, space, 60)).toBe(space.allowed);
    expect(allowanceAfterChange(boost, pulse, 0)).toBe(pulse.allowed + boost.allowed);
    expect(allowanceAfterChange(boost, pulse, 1)).toBeCloseTo(pulse.allowed + boost.allowed * Math.exp(-PULSE_DRIVE.easeRate), 9);
    expect(allowanceAfterChange(flightCaps(lark, 'pulse', 1e9), space, 0)).toBe(space.allowed);
    expect(allowanceAfterChange(space, flightCaps(lark, 'landed'), 0)).toBe(T.restSlackMps);
    expect(allowanceAfterChange(flightCaps(lark, 'docked'), space, 0)).toBe(space.allowed);
  });
});

// Honest pilots against the policy: the client's own controllers, integrated at 60 Hz and measured as the server would, in
// windows of FLIGHT_TOLERANCE.windowS judged against the larger of the allowances at each window's two end poses.
describe('honest flight stays within the allowance', () => {
  const lark = (...skills: string[]) => shipStats(DEMO, { skills });
  const DT = 1 / 60;
  const PER_WINDOW = Math.round(FLIGHT_TOLERANCE.windowS / DT);
  interface Sample {
    p: readonly [number, number];
    allowed: number;
  }
  /** The worst window: its speed over the larger allowance at its two end poses (never a pose in between, which a cheat
   * could fake). */
  function worst(samples: Sample[], judge: (window: Sample[]) => number = (w) => Math.max(w[0].allowed, w[w.length - 1].allowed)): number {
    let out = 0;
    for (let i = PER_WINDOW; i < samples.length; i++) {
      const w = samples.slice(i - PER_WINDOW, i + 1);
      const a = w[0].p;
      const b = w[w.length - 1].p;
      out = Math.max(out, Math.hypot(b[0] - a[0], b[1] - a[1]) / FLIGHT_TOLERANCE.windowS / judge(w));
    }
    return out;
  }

  /** Ship.updateFlight's space branch (no air): boost released at the boost cap with the nose swung `deg` off the path,
   * instantly or at `yawRate` rad/s, the throttle held at `throttle`. Main engine to +160 / −220 m/s² toward the throttle's
   * speed, thrusters trimming drift at 1.8/s up to 140 m/s², the hard clamp at the boost cap × CLIENT_SPEED_HEADROOM. */
  function releaseBoost(s: ShipStats, deg: number, yawRate: number, throttle: number): number {
    const boost = flightCaps(s, 'boost');
    const space = flightCaps(s, 'space');
    const vmax = boost.max * CLIENT_SPEED_HEADROOM;
    const turn = (deg * Math.PI) / 180;
    let v = [boost.max, 0];
    let p: [number, number] = [0, 0];
    let ang = 0;
    const samples: Sample[] = [{ p, allowed: allowanceAfterChange(boost, space, 0) }];
    for (let t = DT; t < 30; t += DT) {
      ang = Math.min(turn, ang + yawRate * DT);
      const f = [Math.cos(ang), Math.sin(ang)];
      const vF = v[0] * f[0] + v[1] * f[1];
      const aF = Math.min(160, Math.max(-220, (throttle * s.speed.space - vF) * 2));
      let as = [(v[0] - vF * f[0]) * -1.8, (v[1] - vF * f[1]) * -1.8];
      const al = Math.hypot(as[0], as[1]);
      if (al > 140) as = as.map((x) => (x * 140) / al);
      v = [v[0] + (aF * f[0] + as[0]) * DT, v[1] + (aF * f[1] + as[1]) * DT];
      const speed = Math.hypot(v[0], v[1]);
      if (speed > vmax) v = v.map((x) => (x * vmax) / speed);
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT];
      samples.push({ p, allowed: allowanceAfterChange(boost, space, t) });
    }
    return worst(samples);
  }

  it('releasing boost and turning 90° (or any angle) on every hull', () => {
    for (const id of HULL_IDS) {
      const s = shipStats(bare(id));
      for (const deg of [0, 45, 90, 135, 180])
        for (const yawRate of [Infinity, 1.6])
          for (const throttle of [1, 0])
            expect(releaseBoost(s, deg, yawRate, throttle), `${id} ${deg}° ${yawRate} rad/s throttle ${throttle}`).toBeLessThanOrEqual(1);
    }
  });

  /** The drive drops out this close to what it is heading for (Ship.updatePulse). */
  const DROP_OUT_M = 400;

  /** Ship.updatePulse's speed, flying head-on at a body from `d0` m (`away`: straight out from it, to 1e10 m): it spools up
   * over 1.25 s, climbs exponentially to its limit and eases down to a falling one. `from` is the mode it was engaged from, at
   * that mode's top speed. */
  function pulseRun(s: ShipStats, d0: number, from: 'space' | 'boost', away = false, judge?: (w: Sample[]) => number): number {
    const entry = flightCaps(s, from);
    const dir = away ? 1 : -1;
    let d = d0;
    let v = Math.max(entry.max, 200);
    let spool = 0;
    const samples: Sample[] = [{ p: [0, 0], allowed: allowanceAfterChange(entry, flightCaps(s, 'pulse', d), 0) }];
    for (let t = DT; (away ? d < 1e10 : d > DROP_OUT_M) && t < 900; t += DT) {
      spool = Math.min(1, spool + DT * 0.8);
      const target = pulseSpeedLimit(s, d) * spool;
      if (v < target) v = Math.min(target, v * Math.exp(DT * 1.5) + 200 * DT);
      else v = target + (v - target) * Math.exp(-PULSE_DRIVE.easeRate * DT);
      d += dir * v * DT;
      samples.push({ p: [dir * (d - d0), 0], allowed: allowanceAfterChange(entry, flightCaps(s, 'pulse', d), t) });
    }
    return worst(samples, judge);
  }

  it("the pulse drive's approach to a body and escape from one, with and without Supercruise", () => {
    for (const s of [lark(), lark('supercruise'), shipStats(bare('dart'))])
      for (const from of ['space', 'boost'] as const) {
        for (const d0 of [700, 5000, 2e6, 5e7, 1e9])
          expect(pulseRun(s, d0, from), `${s.hullId} ${s.pulse.nearLimit} ${d0} m from ${from}`).toBeLessThanOrEqual(1);
        expect(pulseRun(s, 600, from, true), `${s.hullId} ${s.pulse.nearLimit} away from ${from}`).toBeLessThanOrEqual(1);
      }
    // judged at the clearance a window ends at alone, an honest approach would be corrected
    const atEnd = (w: Sample[]) => w[w.length - 1].allowed;
    expect(pulseRun(lark(), 2e6, 'space', false, atEnd)).toBeGreaterThan(1);
    expect(pulseRun(lark('supercruise'), 2e6, 'space', false, atEnd)).toBeGreaterThan(1);
  });
});

describe('signature', () => {
  it('base by hull; halved in cover; doubled boosting or pulsing; zero hidden', () => {
    const lark = shipStats(DEMO);
    expect(effectiveSignature(lark)).toBe(1);
    expect(effectiveSignature(shipStats(bare('ghost')))).toBe(0.25);
    expect(effectiveSignature(shipStats(bare('longhaul')))).toBe(2);
    expect(effectiveSignature(lark, { inCover: true })).toBe(0.5);
    expect(effectiveSignature(lark, { boosting: true })).toBe(2);
    expect(effectiveSignature(lark, { pulsing: true })).toBe(2);
    expect(effectiveSignature(lark, { boosting: true, pulsing: true })).toBe(2);
    expect(effectiveSignature(lark, { inCover: true, boosting: true })).toBe(1);
    expect(effectiveSignature(lark, { boosting: true, hidden: true })).toBe(0);
  });

  it('the Husk reads 0.1 to the Hollow and 1.2 to everyone else; other hulls read the same to both', () => {
    const husk = shipStats(bare('husk'));
    expect(effectiveSignature(husk, { detector: 'hollow' })).toBe(0.1);
    expect(effectiveSignature(husk, { detector: 'other' })).toBe(1.2);
    expect(effectiveSignature(husk)).toBe(1.2);
    expect(effectiveSignature(shipStats(bare('mule')), { detector: 'hollow' })).toBe(1.4);
  });

  it('detection distance is sensor range × signature', () => {
    expect(detectionDistance(5000, effectiveSignature(shipStats(bare('ghost')), { inCover: true }))).toBe(625);
  });
});

describe('the loadout schema', () => {
  it('round-trips through JSON', () => {
    const full: ShipLoadout = { hull: 'warden_breaker', modules: { m1: 'flak_cannon', l2: 'torpedo_rack' }, cargoPods: 3, livery: 2 };
    for (const l of [DEMO, full, bare('husk')]) expect(shipLoadoutSchema.parse(JSON.parse(JSON.stringify(l)))).toEqual(l);
  });

  it('refuses what is not a loadout', () => {
    const bad = [
      { ...DEMO, hull: 'shuttle' },
      { ...DEMO, modules: { hp1: 'pulse_lasers' } },
      { ...DEMO, modules: { s0: 'pulse_lasers' } },
      { ...DEMO, modules: { s1: 'Pulse Lasers' } },
      { ...DEMO, modules: { s1: 'x'.repeat(65) } },
      { ...DEMO, cargoPods: -1 },
      { ...DEMO, cargoPods: 1.5 },
      { ...DEMO, livery: 3 },
      { ...DEMO, extra: true },
      { hull: 'lark', modules: {}, livery: 0 },
    ];
    for (const b of bad) expect(shipLoadoutSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});
