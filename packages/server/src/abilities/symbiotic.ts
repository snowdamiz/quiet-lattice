import { SYMBIOTIC_NUMBERS as N } from '@astra/shared/abilities';
import { hitTest } from '@astra/shared/combat';
import type { AbilityEffect, CastContext } from './book.ts';

/** Integrate elapsed time exactly, including a late final tick, without extending the effect's lifetime. */
function over(ctx: CastContext, duration: number, apply: (seconds: number) => void): void {
  let last = ctx.now;
  const end = last + duration;
  const tick = () => {
    if (!ctx.pose()) return;
    const at = Math.min(ctx.time(), end);
    if (at > last) apply(at - last);
    last = at;
    if (at < end) ctx.after(Math.min(N.tickS, end - at), tick);
  };
  ctx.after(N.tickS, tick);
}

export const SYMBIOTIC_EFFECTS: ReadonlyMap<string, AbilityEffect> = new Map<string, AbilityEffect>([
  [
    'bond',
    {
      check: (ctx) => (ctx.target !== null && ctx.bond.eligible(ctx.target) ? null : 'target'),
      cast: (ctx) => {
        if (ctx.target !== null) ctx.bond.tame(ctx.target);
      },
    },
  ],
  [
    'repair_drones',
    {
      cast: (ctx) => over(ctx, N.repairDrones.durationS, (seconds) => ctx.repairHull(ctx.node.params.hullPerS! * seconds)),
    },
  ],
  [
    'regrow',
    {
      check: (ctx) => (ctx.target !== null && ctx.canHeal(ctx.target) ? null : 'target'),
      cast(ctx) {
        const target = ctx.target;
        if (target === null) return;
        over(ctx, ctx.node.params.durationS!, (seconds) => ctx.heal(target, (seconds * ctx.node.params.heal!) / ctx.node.params.durationS!));
      },
    },
  ],
  [
    'spore',
    {
      check: (ctx) => (ctx.onWorld() ? (ctx.groundReady() ? null : 'busy') : 'frame'),
      cast(ctx) {
        const radius = ctx.node.params.radiusM!;
        over(ctx, ctx.node.params.durationS!, (seconds) => {
          for (const { target } of hitTest({ kind: 'sphere', radius }, { origin: ctx.origin }, ctx.creatures(radius, ctx.origin))) {
            if (ctx.sight(target.pos, ctx.origin) === true) ctx.damage(target.id, N.spore.damagePerS * seconds);
          }
          const self = ctx.pose();
          if (self && Math.hypot(...self.origin.map((x, i) => x - ctx.origin[i]!)) <= radius) ctx.heal(ctx.caster, N.spore.healPerS * seconds);
          for (const ally of ctx.party(radius, ctx.origin)) if (ctx.sight(ally.pos, ctx.origin) === true) ctx.heal(ally.id, N.spore.healPerS * seconds);
        });
      },
    },
  ],
  [
    'call',
    {
      check: (ctx) => (!ctx.onWorld() ? 'frame' : !ctx.groundReady() ? 'busy' : ctx.stampede.ready() ? null : 'target'),
      cast: (ctx) => ctx.stampede.start(),
    },
  ],
]);
