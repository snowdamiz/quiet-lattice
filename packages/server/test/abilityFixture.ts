// The test ability (P1.E07.T03): one effect cast through real slotted nodes of the web, never shipped (the server's own
// book is the build's, empty until the branch tasks fill it). Each cast is recorded; one that names an entity hurts it by
// a point, so its combat event follows the cast's.
import type { Ability } from '@astra/shared/abilities';
import { abilityBook, type AbilityBook, type AbilityEffect, type CastContext } from '../src/abilities/book.ts';

/** The ground bar it slots, keys 1–6, and the ship bar, keys 1–4: every targeting a cast can name. */
export const FIXTURE_GROUND: readonly Ability[] = [
  { node: 'pulse', target: 'self' },
  { node: 'pull', target: 'entity', on: ['mob'] },
  { node: 'vent', target: 'self' },
  { node: 'sear', target: 'entity', on: ['mob'], rangeM: 30 },
  { node: 'harmonic', target: 'aim' },
  { node: 'regrow', target: 'self' },
];
export const FIXTURE_SHIP: readonly Ability[] = [
  { node: 'tractor_beam', target: 'self' },
  { node: 'deep_sweep', target: 'self' },
  { node: 'repair_drones', target: 'self' },
  { node: 'inertial_brake', target: 'aim' },
];

/** A test ability's book, and every cast it carried out. */
export function fixtureBook(): { book: AbilityBook; casts: CastContext[] } {
  const casts: CastContext[] = [];
  const effect: AbilityEffect = {
    cast(ctx) {
      casts.push(ctx);
      if (ctx.target !== null) ctx.damage(ctx.target, 1);
    },
  };
  const all = [...FIXTURE_GROUND, ...FIXTURE_SHIP];
  return { book: abilityBook(new Map(all.map((a) => [a.node, a])), new Map(all.map((a) => [a.node, effect]))), casts };
}
