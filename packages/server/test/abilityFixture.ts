// The test ability (P1.E07.T03): one effect cast through real slotted nodes of the web, never shipped (the server's own
// book is the build's, empty until the branch tasks fill it). Each cast is recorded, and each toggle's end; one that names
// an entity hurts it by a point, so its combat event follows the cast's; a toggle's sets a timer that records it again.
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
/** A toggle, slotted only by the tests of toggles. */
export const FIXTURE_TOGGLE: Ability = { node: 'lance', target: 'aim', toggle: true };

/** How long after a toggle's cast its timer runs, s. */
export const FIXTURE_TIMER_S = 0.5;

/** A test ability's book, every cast it carried out, every toggle it ended (with the cast that turned it on) and every
 * toggle's timer that ran. */
export function fixtureBook(): { book: AbilityBook; casts: CastContext[]; ends: CastContext[]; timers: CastContext[] } {
  const casts: CastContext[] = [];
  const ends: CastContext[] = [];
  const timers: CastContext[] = [];
  const effect: AbilityEffect = {
    cast(ctx) {
      casts.push(ctx);
      if (ctx.target !== null) ctx.damage(ctx.target, 1);
      if (ctx.ability.toggle) ctx.after(FIXTURE_TIMER_S, () => void timers.push(ctx));
    },
    end: (ctx) => void ends.push(ctx),
  };
  const all = [...FIXTURE_GROUND, ...FIXTURE_SHIP, FIXTURE_TOGGLE];
  return { book: abilityBook(new Map(all.map((a) => [a.node, a])), new Map(all.map((a) => [a.node, effect]))), casts, ends, timers };
}
