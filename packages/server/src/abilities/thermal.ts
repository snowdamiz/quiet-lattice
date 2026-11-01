// Thermal's Tier I–II actives on the server (DESIGN 9.3, ARCHITECTURE §28; P1.E07.T05): Lance, Flare, Sear and Vent. Every
// number is the node's (`@astra/shared/data`) or `THERMAL_NUMBERS`'s, every hit goes through `ctx.damage`, so a creature's
// resistances (crystal creatures resist Thermal), the safe zones and the phase rule apply as they do to any ability. The
// branch's passives (Tempered Core, Focused Lasers, Hot Hands, Ablative Plating) are not cast: the meters, the ship's stats
// and the mining service read them from the skill nodes.
import { THERMAL_NUMBERS } from '@astra/shared/abilities';
import { hitTest, shapeOfNode } from '@astra/shared/combat';
import { getSkillNode } from '@astra/shared/data';
import type { AbilityEffect, CastContext } from './book.ts';

const N = THERMAL_NUMBERS;

/** The status a Flare or a Sear leaves. */
export const BURNING = 'burning';

/** Sets `target` alight for `durationS` at `dps` for the caster (`CastContext.status`), and deals the burn in ticks until it
 * ends or the target dies or can no longer be harmed. A target already burning from this caster burns for the later of the
 * two ends at the greater rate, with the ticks it already has. */
function ignite(ctx: CastContext, target: number, dps: number, durationS: number): void {
  if (!ctx.status.apply(target, BURNING, durationS, dps)) return;
  let last = ctx.time();
  const tick = (): void => {
    const s = ctx.status.get(target, BURNING);
    if (!s) return;
    const at = Math.min(ctx.time(), s.until);
    const out = at > last ? ctx.damage(target, s.power * (at - last)) : null;
    const stopped = at > last && out === null;
    last = at;
    if (stopped || out?.killed || at >= s.until) return void ctx.status.remove(target, BURNING);
    ctx.after(N.burnTickS, tick);
  };
  ctx.after(N.burnTickS, tick);
}

/** What a held Lance has done: the beam time it has already dealt for, and whether it is still on. */
const lances = new WeakMap<CastContext, { on: boolean; dealt: number }>();

/** The beam's `seconds` of firing, along the caster's look now: the nearest creature it meets within the node's range and in
 * sight takes `dps` for each, and with Chain the nearest other creature whose centre is within its reach of the first's takes a share. */
function lanceHits(ctx: CastContext, seconds: number): void {
  const pose = ctx.pose();
  const shape = shapeOfNode('lance');
  if (!pose || shape?.kind !== 'ray') return;
  const near = ctx.creatures(shape.range + 2);
  const first = hitTest(shape, { origin: pose.origin, dir: pose.aim }, near)[0]?.target;
  if (!first || !ctx.sight(first.pos)) return;
  const damage = N.lance.dps * seconds;
  ctx.damage(first.id, damage);
  if (!ctx.owns('chain')) return;
  const chain = getSkillNode('chain').params;
  const others = near.filter((c) => c.id !== first.id);
  const reach = chain.rangeM!;
  const next = others
    .map((c) => ({ c, d: Math.hypot(c.pos[0] - first.pos[0], c.pos[1] - first.pos[1], c.pos[2] - first.pos[2]) }))
    .filter((x) => x.d <= reach)
    .sort((a, b) => a.d - b.d)
    .slice(0, chain.extraTargets ?? 1);
  for (const { c } of next) ctx.damage(c.id, damage * N.lance.chainShare);
}

export const THERMAL_EFFECTS: ReadonlyMap<string, AbilityEffect> = new Map<string, AbilityEffect>([
  [
    // The beam hurts while it fires: the damage is the beam time the meters judged since the last tick (held, on foot, out of
    // the lockout), so a client deals what it fired however it times its inputs, as mining does; the heat is the beam's own.
    'lance',
    {
      cast(ctx) {
        const run = { on: true, dealt: ctx.meters.beamTime() };
        lances.set(ctx, run);
        const tick = (): void => {
          if (!run.on) return;
          const total = ctx.meters.beamTime();
          const fired = total - run.dealt;
          run.dealt = total;
          if (fired > 0) lanceHits(ctx, fired);
          ctx.after(N.lance.tickS, tick);
        };
        ctx.after(N.lance.tickS, tick);
      },
      end(ctx) {
        const run = lances.get(ctx);
        if (run) run.on = false;
      },
    },
  ],
  [
    'flare',
    {
      cast(ctx) {
        const shape = shapeOfNode('flare');
        if (shape?.kind !== 'cone') return;
        const burnS = ctx.node.params.burnS!;
        for (const h of hitTest(shape, { origin: ctx.origin, dir: ctx.aim }, ctx.creatures(shape.range))) {
          if (!ctx.sight(h.target.pos)) continue;
          const out = ctx.damage(h.target.id, N.flare.burst);
          if (out && !out.killed) ignite(ctx, h.target.id, N.flare.burnDps, burnS);
        }
      },
    },
  ],
  [
    'sear',
    {
      check: (ctx) => (ctx.target !== null && ctx.canHarm(ctx.target) ? null : 'target'),
      cast(ctx) {
        ignite(ctx, ctx.target!, N.sear.burnDps, ctx.node.params.burnS!);
      },
    },
  ],
  [
    // All the heat out at once, as a shockwave round the caster whose damage is what left.
    'vent',
    {
      cast(ctx) {
        const dumped = ctx.meters.dumpHeat();
        if (!dumped) return;
        const damage = dumped * N.vent.damagePerHeat;
        for (const h of hitTest({ kind: 'sphere', radius: N.vent.radiusM }, { origin: ctx.origin }, ctx.creatures(N.vent.radiusM))) {
          if (ctx.sight(h.target.pos)) ctx.damage(h.target.id, damage);
        }
      },
    },
  ],
]);
