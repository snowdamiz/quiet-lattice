// The two ability resources' rules (DESIGN 9.1) as pure functions both ends run: Heat on the ground, 0 to its capacity, which
// the beam and abilities raise and cooling lowers (20/s idle, 8/s while channelling, scaled by the world), with an overheat
// lockout from full until it falls to 25; and Charge, the ship's, which regenerates in sunlight inside the habitable band
// (nothing in deep space) and which the pulse drive burns near bodies. The numbers are `METERS` (`@astra/shared/data`); the
// skill passives, hull perks and buffs that change them are read from the same tables `shipStats` reads.
//
// `stepMeters` integrates a stretch of time exactly, segment by segment (the beam fires until the meter is full, the lockout
// holds until it has cooled, the pulse drive burns until Charge is gone), so a client stepping each frame and a server
// stepping each input reach the same values whatever their step: only float rounding tells them apart.
import { getHull } from '../data/hulls.ts';
import { METERS } from '../data/meters.ts';
import type { StatMod } from '../data/modifiers.ts';
import { SKILL_NODES, getSkillNode } from '../data/skills/index.ts';
import type { ShipLoadout } from '../ships/loadout.ts';
import { applyMods, shipStats } from '../ships/stats.ts';
import { meterConditions, type MeterEnvironment } from './environment.ts';

/** A character's two meters. `overheated` is the lockout: no beam and no abilities until heat falls to `recoverBelow`. */
export interface MeterState {
  heat: number;
  overheated: boolean;
  charge: number;
}

/** What a character's build makes of the meters: capacities and the modifiers in force (some only under a condition). */
export interface MeterProfile {
  /** Heat capacity: 100, 125 with Tempered Core (or a Frostglass catalyst). */
  heatCapacity: number;
  /** Heat at which the meter overheats: full (DESIGN's 100 on a capacity of 100). */
  overheatAt: number;
  /** The lockout ends once heat is down to this (DESIGN: "until heat falls below 25"). */
  recoverBelow: number;
  /** The `heat.cooling` and `charge.regen` modifiers in force, each with its condition if it has one (Solar Kin). */
  mods: readonly StatMod[];
  /** Charge capacity: the flown hull's (Lark 100); none without a ship. */
  chargeCapacity: number;
  /** Charge the pulse drive burns per second near bodies (0.35; Reserve Tank 25% less). */
  pulseBurn: number;
  /** The hull regenerates Charge anywhere (the Listener's built-in flag), not only in the sunlit habitable band. */
  regenAnywhere: boolean;
}

/** What the meters depend on besides where the character is. */
export interface MeterInputs {
  /** The ship it flies (its hull's Charge, its perks, its modules), or null when it has none. */
  ship: ShipLoadout | null;
  /** Skill nodes it owns: passives and cost-free forms change the meters (Tempered Core, Furnace, Solar Kin, Reserve Tank). */
  skills?: Iterable<string>;
  /** Timed effects in force (catalysts). */
  buffs?: readonly StatMod[];
}

/** What a character is doing to its meters over a stretch of time. */
export interface MeterActivity {
  /** The multitool's beam is held (on foot, the tool out). It fires only while not overheated. */
  beam: boolean;
  /** Channelling an ability (a channelled cast): cooling drops to the channelling rate. The beam channels too. */
  channelling?: boolean;
  /** On the pulse drive. It burns Charge near bodies and drops out when Charge is gone. */
  pulse: boolean;
}

export type MeterEvent = 'overheated' | 'recovered' | 'charge_empty';

export interface MeterStep {
  state: MeterState;
  /** What happened in the stretch, in order. */
  events: MeterEvent[];
  /** Seconds the beam actually fired (held and not locked out): what mining yield may be judged by. */
  beamS: number;
  /** Still on the pulse drive at the end (it drops out when Charge runs out). */
  pulse: boolean;
}

const METER_STATS: ReadonlySet<string> = new Set(['heat.capacity', 'heat.cooling', 'charge.regen']);

/** The meters' numbers for a build. Throws on an unknown skill node. */
export function meterProfile(inputs: MeterInputs): MeterProfile {
  const { ship } = inputs;
  const skills = [...(inputs.skills ?? [])];
  const hull = ship ? getHull(ship.hull) : null;
  const owned = new Set<string>(hull?.builtIn.nodes ?? []);
  for (const id of skills) owned.add(getSkillNode(id).id);
  // as shipStats gathers them: the hull's perks, the always-on nodes in the web's order, then buffs; modifiers scoped to one
  // branch's or named nodes' effects change those abilities' costs, not the meters
  const mods: StatMod[] = [...(hull?.builtIn.mods ?? [])];
  for (const n of SKILL_NODES) if (owned.has(n.id) && n.slot === null) mods.push(...n.mods);
  mods.push(...(inputs.buffs ?? []));
  const meterMods = mods.filter((m) => METER_STATS.has(m.stat) && !m.branch && !m.nodes);
  const heatCapacity = applyMods(
    METERS.heat.capacity,
    'heat.capacity',
    meterMods.filter((m) => !m.when),
  );
  let chargeCapacity = 0;
  let pulseBurn = METERS.charge.pulseBurnNearBodiesPerS;
  if (ship) {
    const stats = shipStats(ship, { skills, buffs: inputs.buffs });
    // (the Husk draws its Charge from the Count, Phase 3: until then it holds the baseline)
    chargeCapacity = stats.charge === 'count' ? METERS.charge.capacity : stats.charge;
    pulseBurn = stats.pulse.fuelBurn;
  }
  return {
    heatCapacity,
    overheatAt: METERS.heat.overheatAt + (heatCapacity - METERS.heat.capacity),
    recoverBelow: METERS.heat.recoverBelow,
    mods: meterMods,
    chargeCapacity,
    pulseBurn,
    regenAnywhere: !!hull?.builtIn.flags.includes('charge_regen_anywhere'),
  };
}

function inForce(mods: readonly StatMod[], conditions: ReadonlySet<string>): StatMod[] {
  return mods.filter((m) => !m.when || conditions.has(m.when));
}

/** Heat shed per second: 20 idle, 8 while channelling (the beam included), times every world modifier that holds (frozen
 * and cryo worlds ×1.5, hot worlds by day ×0.6, underwater ×2, night ×1.1; they multiply together) and the build's
 * `heat.cooling` (Furnace ×1.5). */
export function coolingPerS(p: MeterProfile, conditions: ReadonlySet<string>, channelling: boolean): number {
  const base = channelling ? METERS.heat.coolingChannellingPerS : METERS.heat.coolingIdlePerS;
  let world = 1;
  for (const w of METERS.heat.worldModifiers) if (conditions.has(w.when)) world *= w.coolingMult;
  return Math.max(0, applyMods(base, 'heat.cooling', inForce(p.mods, conditions)) * world);
}

/** Charge regenerated per second: 2 in sunlight inside the habitable band and nothing elsewhere (the hull's anywhere-flag
 * gives the band's rate everywhere), plus the build's `charge.regen` (Solar Kin +2 on hot worlds and near stars, a
 * Stormquartz catalyst +2); nothing at all in deep space unless the hull regenerates anywhere, and none without a ship. */
export function chargeRegenPerS(p: MeterProfile, env: MeterEnvironment, conditions: ReadonlySet<string>): number {
  if (p.chargeCapacity <= 0) return 0;
  if (env.deepSpace && !p.regenAnywhere) return 0;
  let base = 0;
  if (p.regenAnywhere) base = Math.max(...METERS.charge.regen.map((r) => r.perS));
  else
    for (const r of METERS.charge.regen)
      if (conditions.has(r.when)) {
        base = r.perS;
        break;
      }
  return Math.max(0, applyMods(base, 'charge.regen', inForce(p.mods, conditions)));
}

/** Rates at this moment, per second: heat (+ while the beam out-heats cooling) and Charge (+ regenerating, − burning). */
export interface MeterRates {
  heat: number;
  charge: number;
  /** The regeneration on its own (the HUD's regen indication). */
  regen: number;
}

/** The meters' rates now: what `stepMeters` would integrate over the next instant. */
export function meterRates(
  s: MeterState,
  p: MeterProfile,
  env: MeterEnvironment,
  act: MeterActivity,
  conditions: ReadonlySet<string> = meterConditions(env),
): MeterRates {
  const beam = act.beam && !s.overheated;
  const channelling = !s.overheated && (beam || !!act.channelling);
  const heat = (beam ? METERS.heat.beamPerS : 0) - coolingPerS(p, conditions, channelling);
  const regen = chargeRegenPerS(p, env, conditions);
  const burn = act.pulse && s.charge > 0 && env.nearBodies ? p.pulseBurn : 0;
  return {
    heat: heat < 0 && s.heat <= 0 ? 0 : s.heat >= p.overheatAt && heat > 0 ? 0 : heat,
    charge: regen - burn < 0 && s.charge <= 0 ? 0 : regen - burn > 0 && s.charge >= p.chargeCapacity ? 0 : regen - burn,
    regen: s.charge >= p.chargeCapacity ? 0 : regen,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The state held within the profile's capacities (a smaller hull, a node refunded). */
export function clampMeters(s: MeterState, p: MeterProfile): MeterState {
  return { heat: clamp(s.heat, 0, p.heatCapacity), overheated: s.overheated, charge: clamp(s.charge, 0, p.chargeCapacity) };
}

/** Cool and full: a new character's meters. */
export function freshMeters(p: MeterProfile): MeterState {
  return { heat: 0, overheated: false, charge: p.chargeCapacity };
}

/**
 * The meters `dt` seconds on, the character doing `act` in `env` throughout. Exact across the overheat and its lockout and
 * across Charge running out: the beam stops firing the moment the meter overheats and fires again once it has cooled (if
 * still held); the pulse drive drops out when Charge is gone.
 */
export function stepMeters(
  s: MeterState,
  p: MeterProfile,
  env: MeterEnvironment,
  act: MeterActivity,
  dt: number,
  conditions: ReadonlySet<string> = meterConditions(env),
): MeterStep {
  const events: MeterEvent[] = [];
  let { heat, overheated } = s;
  heat = clamp(heat, 0, p.heatCapacity);
  let charge = clamp(s.charge, 0, p.chargeCapacity);
  const idle = coolingPerS(p, conditions, false);
  const chan = coolingPerS(p, conditions, true);
  let beamS = 0;
  // heat, segment by segment (each overheat-and-recover cycle takes seconds, so a handful of segments covers any step)
  let t = Math.max(0, dt);
  for (let guard = 0; t > 0 && guard < 64; guard++) {
    if (overheated) {
      // locked out: no beam, nothing channelled, the idle rate
      const toRecover = idle > 0 ? Math.max(0, heat - p.recoverBelow) / idle : Infinity;
      if (toRecover > t) {
        heat -= idle * t;
        t = 0;
      } else {
        heat = Math.min(heat, p.recoverBelow);
        t -= toRecover;
        overheated = false;
        events.push('recovered');
      }
      continue;
    }
    const rate = (act.beam ? METERS.heat.beamPerS : 0) - (act.beam || act.channelling ? chan : idle);
    if (rate > 0) {
      const toFull = Math.max(0, p.overheatAt - heat) / rate;
      if (toFull > t) {
        heat += rate * t;
        if (act.beam) beamS += t;
        t = 0;
      } else {
        heat = p.overheatAt;
        if (act.beam) beamS += toFull;
        t -= toFull;
        overheated = true;
        events.push('overheated');
      }
    } else {
      heat = Math.max(0, heat + rate * t);
      if (act.beam) beamS += t;
      t = 0;
    }
  }
  // Charge
  const regen = chargeRegenPerS(p, env, conditions);
  let pulse = act.pulse && charge > 0;
  t = Math.max(0, dt);
  for (let guard = 0; t > 0 && guard < 4; guard++) {
    const rate = regen - (pulse && env.nearBodies ? p.pulseBurn : 0);
    if (rate < 0) {
      const toEmpty = charge / -rate;
      if (toEmpty > t) {
        charge += rate * t;
        t = 0;
      } else {
        charge = 0;
        t -= toEmpty;
        pulse = false;
        events.push('charge_empty');
      }
    } else {
      charge = Math.min(p.chargeCapacity, charge + rate * t);
      t = 0;
    }
  }
  return { state: { heat: clamp(heat, 0, p.heatCapacity), overheated, charge: clamp(charge, 0, p.chargeCapacity) }, events, beamS, pulse };
}

/** The beam fires (and abilities cast) only out of the lockout. */
export function canFireBeam(s: MeterState): boolean {
  return !s.overheated;
}

/** The pulse drive engages (and keeps running) only with Charge left. */
export function canEngagePulse(s: MeterState, p: MeterProfile): boolean {
  return p.chargeCapacity > 0 && s.charge > 0;
}

export type MeterResult = { ok: true; state: MeterState; events: MeterEvent[] } | { ok: false; error: 'overheated' | 'charge' };

/** An ability's heat (DESIGN 9.1: "abilities add heat in chunks"): refused in the lockout; a chunk that reaches the top
 * overheats the meter. */
export function addHeat(s: MeterState, p: MeterProfile, amount: number): MeterResult {
  if (s.overheated) return { ok: false, error: 'overheated' };
  const heat = s.heat + Math.max(0, amount);
  if (heat >= p.overheatAt) return { ok: true, state: { ...s, heat: p.overheatAt, overheated: true }, events: ['overheated'] };
  return { ok: true, state: { ...s, heat }, events: [] };
}

/** A ship active's Charge: refused unless the meter holds it all. */
export function spendCharge(s: MeterState, amount: number): MeterResult {
  const a = Math.max(0, amount);
  if (s.charge < a) return { ok: false, error: 'charge' };
  const charge = s.charge - a;
  return { ok: true, state: { ...s, charge }, events: charge <= 0 && a > 0 ? ['charge_empty'] : [] };
}

/** Charge to the brim (the Waystation's paid refill, today's Pulse Fuel). */
export function refillCharge(s: MeterState, p: MeterProfile): MeterState {
  return { ...s, charge: p.chargeCapacity };
}
