// Stealth is a number (DESIGN 10.1): detection distance = the detector's sensor range × your signature. It sets when pirates
// roll a raid on you, when the Hollow turn toward you and how far away other players' markers pick you up (P1.E12.T06).
import type { ShipStats } from './stats.ts';

export const SIGNATURE = {
  /** Belts, rings and nebulae halve it. */
  cover: 0.5,
  /** Boosting or pulsing doubles it. */
  loud: 2,
} as const;

export interface SignatureContext {
  /** Who is looking: the Hollow read a Husk differently from everyone else (DESIGN 10.2). */
  detector?: 'hollow' | 'other';
  /** Inside an asteroid belt, a planetary ring or a nebula. */
  inCover?: boolean;
  boosting?: boolean;
  pulsing?: boolean;
  /** A stealth effect in force hides the ship from this detector (Veil, Cloak and Silent Running stack on top; which hides
   * from whom is P1.E12.T06's). */
  hidden?: boolean;
}

/** The ship's signature as this detector reads it now. */
export function effectiveSignature(stats: ShipStats, context: SignatureContext = {}): number {
  if (context.hidden) return 0;
  let s = context.detector === 'hollow' ? stats.signature.vsHollow : stats.signature.base;
  if (context.inCover) s *= SIGNATURE.cover;
  if (context.boosting || context.pulsing) s *= SIGNATURE.loud;
  return s;
}

/** How far away a detector with this sensor range picks the ship up, in the sensor range's units. */
export function detectionDistance(sensorRange: number, signature: number): number {
  return sensorRange * signature;
}
