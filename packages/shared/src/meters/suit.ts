// The exo-suit's two meters on foot (DESIGN 9.8): life support and hazard protection, each 0 to 100, as pure functions both ends
// run. The server decides them (the meter service runs `stepSuit` from timestamps, as it runs heat); the client predicts with the
// same rules. The numbers are `SUIT` (`@astra/shared/data`) and the modifiers the owned nodes' and the people's perk's
// (`@astra/shared/exosuit`).
//
// On foot on a world life support drains and hazard protection drains by how hard the place is (`MeterEnvironment.footHazard`,
// the night's ×1.4, the build's modifiers), or regains where nothing is hard; inside a station both refill; aboard a ship
// neither moves (the server tops them up). At zero either one costs health (the rates are `SUIT.healthLostPerS`, the
// regain `SUIT.healthRegainPerS`: combat's vitals take them). A refill from the pack is the caller's: `stepSuit` stops where a
// draining meter reaches the refill line and says which, so a refill is made at the moment the line was crossed.
import { SUIT } from '../data/suit.ts';
import type { StatMod } from '../data/modifiers.ts';
import { cartridgeRestore, hazardDrainPerS, lifeSupportDrainPerS, suitFloors, suitMods, type ExosuitInputs } from '../exosuit/index.ts';
import type { MeterEnvironment } from './environment.ts';

export const SUIT_MAX = 100;

export interface SuitState {
  lifeSupport: number;
  hazard: number;
}

export type SuitMeter = keyof SuitState;

/** Where the suit is: aboard a ship (or not in play on foot), inside a station (or out of any world), or on a world. */
export type SuitPlace = 'aboard' | 'station' | 'world';

/** What a character's build makes of the suit. */
export interface SuitProfile {
  /** The modifiers in force (`suitMods`: the people's perk, the owned always-on nodes, buffs). */
  mods: readonly StatMod[];
  /** What a refill of raw oxygen or sodium restores (40, 60 with Cartridge Recycler). */
  restore: number;
}

export function suitProfile(inputs: ExosuitInputs = {}): SuitProfile {
  const mods = suitMods(inputs);
  return { mods, restore: cartridgeRestore(mods) };
}

export function fullSuit(): SuitState {
  return { lifeSupport: SUIT_MAX, hazard: SUIT_MAX };
}

export function suitPlaceOf(env: MeterEnvironment, foot: boolean): SuitPlace {
  if (!foot) return 'aboard';
  return env.world === null ? 'station' : 'world';
}

/** The meters' rates now, per second (negative: draining). */
export function suitRates(p: SuitProfile, env: MeterEnvironment, place: SuitPlace, conditions: ReadonlySet<string>): SuitState {
  if (place === 'aboard') return { lifeSupport: 0, hazard: 0 };
  if (place === 'station') return { lifeSupport: SUIT.stationRegenPerS.lifeSupport, hazard: SUIT.stationRegenPerS.hazard };
  return {
    lifeSupport: -lifeSupportDrainPerS(p.mods, conditions),
    // (a place that is hard on the suit but whose drain a build zeroes does not also regain: the protection holds where it is)
    hazard: env.footHazard > 0 ? -hazardDrainPerS(env.footHazard, env.time === 'night', p.mods, conditions) : SUIT.hazardRegenPerS,
  };
}

/** Whether health is being lost: a meter is at zero and not recovering. */
export function suitStarved(s: SuitState, rates: SuitState): boolean {
  return (s.lifeSupport <= 0 && rates.lifeSupport <= 0) || (s.hazard <= 0 && rates.hazard <= 0);
}

/** A stretch of a step in which health was lost (`starved`) or regained. */
export interface SuitSpan {
  starved: boolean;
  s: number;
}

export interface SuitStep {
  state: SuitState;
  /** Seconds of the step done: all of them unless it stopped at a refill line. */
  elapsed: number;
  /** On a world, the health the stretch cost or gave, in order. */
  spans: SuitSpan[];
  /** The meter that reached the refill line (the step stopped there), or null. */
  refill: SuitMeter | null;
}

export type Refillable = Readonly<Record<SuitMeter, boolean>>;
export const NOT_REFILLABLE: Refillable = { lifeSupport: false, hazard: false };

const METERS: readonly SuitMeter[] = ['lifeSupport', 'hazard'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The suit `dt` seconds on, in `env` (its `place`) throughout. Exact: each meter moves at its constant rate, held to its floor
 * (0, or Second Skin's 20 out of combat) and 100, and the stretch is told as the seconds health was lost or regained in order.
 * A meter in `refillable` that is draining and reaches `SUIT.cartridge.below` (or starts below it) ends the step there with
 * `refill` set and its value at the line; the caller refills it and goes on with what is left.
 */
export function stepSuit(
  s: SuitState,
  p: SuitProfile,
  env: MeterEnvironment,
  place: SuitPlace,
  dt: number,
  conditions: ReadonlySet<string>,
  refillable: Refillable = NOT_REFILLABLE,
): SuitStep {
  const floors = suitFloors(p.mods, conditions);
  const lo: SuitState = { lifeSupport: clamp(floors.lifeSupport, 0, SUIT_MAX), hazard: clamp(floors.hazard, 0, SUIT_MAX) };
  const v: SuitState = { lifeSupport: clamp(s.lifeSupport, lo.lifeSupport, SUIT_MAX), hazard: clamp(s.hazard, lo.hazard, SUIT_MAX) };
  const t = Math.max(0, dt);
  if (place === 'aboard' || !(t > 0)) return { state: v, elapsed: t, spans: [], refill: null };
  const rates = suitRates(p, env, place, conditions);
  const line = SUIT.cartridge.below;
  const canRefill = (m: SuitMeter) => place === 'world' && refillable[m] && rates[m] < 0;
  // (a draining meter already below the line is refilled before anything else moves)
  for (const m of METERS) if (canRefill(m) && v[m] < line) return { state: v, elapsed: 0, spans: [], refill: m };
  let stop = t;
  let refill: SuitMeter | null = null;
  for (const m of METERS) {
    if (!canRefill(m)) continue;
    const at = (v[m] - line) / -rates[m];
    if (at < stop) {
      stop = at;
      refill = m;
    }
  }
  const spans: SuitSpan[] = [];
  if (place === 'world') {
    // health is lost from the moment a meter that is draining to zero gets there (or from the start, at zero and not recovering)
    let starvedFrom = stop;
    for (const m of METERS) {
      if (v[m] <= 0 && rates[m] <= 0) starvedFrom = 0;
      else if (rates[m] < 0 && lo[m] <= 0) starvedFrom = Math.min(starvedFrom, v[m] / -rates[m]);
    }
    if (starvedFrom > 0) spans.push({ starved: false, s: Math.min(starvedFrom, stop) });
    if (starvedFrom < stop) spans.push({ starved: true, s: stop - starvedFrom });
  }
  const state: SuitState = {
    lifeSupport: clamp(v.lifeSupport + rates.lifeSupport * stop, lo.lifeSupport, SUIT_MAX),
    hazard: clamp(v.hazard + rates.hazard * stop, lo.hazard, SUIT_MAX),
  };
  if (refill) state[refill] = line;
  return { state, elapsed: stop, spans, refill };
}

/** The health a span costs (negative) or gives, out of `SUIT`'s rates. */
export function spanHealth(span: SuitSpan): number {
  return span.starved ? -SUIT.healthLostPerS * span.s : SUIT.healthRegainPerS * span.s;
}
