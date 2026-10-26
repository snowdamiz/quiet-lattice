// Stealth is a number (DESIGN 10.1): detection distance = the detector's sensor range × your signature. It sets when pirates
// roll a raid on you, when the Hollow turn toward you and how far away other players' markers pick you up. Belts, rings and
// nebulae halve it (`coverAt` in @astra/shared/world says where cover is); boosting or pulsing doubles it; Veil, Cloak and
// Silent Running stack on top (STEALTH in @astra/shared/data says whom each hides you from). The sensor ranges are SENSORS.
// The client runs these today; the server will run the same functions on the poses and speeds it measures.
import { getSensor, getStealth } from '../data/sensors.ts';
import type { DetectorKind, SensorId, StealthId } from '../data/sensors.ts';
import type { FlightMode } from './flight.ts';
import type { ShipStats } from './stats.ts';

export const SIGNATURE = {
  /** Belts, rings and nebulae halve it. */
  cover: 0.5,
  /** Boosting or pulsing doubles it. */
  loud: 2,
  /** A ship reads as boosting while its measured speed is over its cruise cap (`ShipStats.speed.space`) × this: room for
   * gravity and the client's headroom at the cap, far under any hull's boost (×1.8 at the least). */
  boostingAbove: 1.1,
} as const;

export interface SignatureContext {
  /** What kind of detector is looking: the Hollow read a Husk differently from everyone else (DESIGN 10.2), and a stealth
   * effect hides the ship only from the kinds it names. With none named the ship reads at its base signature and only
   * `hidden` hides it. */
  detector?: DetectorKind;
  /** Inside an asteroid belt, a planetary ring or a nebula (`coverAt`). */
  inCover?: boolean;
  /** See `movementSignals`: judged from the ship's measured speed, not the boost button. */
  boosting?: boolean;
  /** On the pulse drive. */
  pulsing?: boolean;
  /** Stealth effects in force on the ship (Veil, Cloak, Silent Running); any that hides it from `detector` makes it 0. */
  stealth?: Iterable<StealthId>;
  /** Hidden from this detector by anything else. */
  hidden?: boolean;
}

/** Whether any of these stealth effects hides a ship from this kind of detector. */
export function hiddenBy(stealth: Iterable<StealthId> | undefined, detector: DetectorKind | undefined): boolean {
  if (!stealth || !detector) return false;
  for (const id of stealth) if (getStealth(id).hidesFrom.includes(detector)) return true;
  return false;
}

/** The ship's signature as this detector reads it now: its hull's number for that detector, halved in cover, doubled while
 * boosting or pulsing (once, not twice for both), 0 while hidden from it. */
export function effectiveSignature(stats: ShipStats, context: SignatureContext = {}): number {
  if (context.hidden || hiddenBy(context.stealth, context.detector)) return 0;
  let s = context.detector === 'hollow' ? stats.signature.vsHollow : stats.signature.base;
  if (context.inCover) s *= SIGNATURE.cover;
  if (context.boosting || context.pulsing) s *= SIGNATURE.loud;
  return s;
}

/**
 * Whether a ship reads as boosting and as pulsing (DESIGN 10.1), from how it moves: pulsing on the pulse drive, boosting
 * while its measured speed (relative to its frame, as the server measures it) is over its cruise cap × `boostingAbove` in
 * any mode it flies on its engines. Never from the boost button: a ship still accelerating on it is not yet loud, and one
 * still coasting fast after releasing it still is. The cruise cap is the space one in the air too, where `flightCaps` sets
 * none of its own (the drag-limited top speed rises as the air thins).
 */
export function movementSignals(stats: ShipStats, mode: FlightMode, speedMps: number): { boosting: boolean; pulsing: boolean } {
  const pulsing = mode === 'pulse';
  const engines = mode === 'space' || mode === 'boost' || mode === 'atmo';
  return { boosting: engines && speedMps > stats.speed.space * SIGNATURE.boostingAbove, pulsing };
}

/** A detector's sensor range, m: its SENSORS row × the detecting ship's scan-range multiplier (`ShipStats.scanRange`, the
 * Wayfarer's ×2; 1 for a mob). */
export function sensorRange(sensor: SensorId, scanRange = 1): number {
  return getSensor(sensor).rangeM * scanRange;
}

/** How far away a detector with this sensor range picks the ship up, in the sensor range's units. */
export function detectionDistance(sensorRange: number, signature: number): number {
  return sensorRange * signature;
}

/** Whether a detector with this sensor range picks up a ship of this signature at this distance: within its detection
 * distance, and never a hidden ship (signature 0), not even alongside. */
export function detects(sensorRange: number, signature: number, distance: number): boolean {
  return signature > 0 && distance <= detectionDistance(sensorRange, signature);
}
