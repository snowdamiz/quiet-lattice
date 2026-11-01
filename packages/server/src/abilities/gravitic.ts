// Gravitic's Tier I–II actives on the server (DESIGN 9.2, ARCHITECTURE §28; P1.E07.T04): Pull, Slam, Well and the ship forms
// Tractor Beam and Inertial Brake. Every number is the node's (`@astra/shared/data`) or `GRAVITIC_NUMBERS`'s. They act through
// the context only: creatures are carried, knocked down and slowed by `control` (which refuses what a creature's resistances
// shrug off and never touches a player), a held ship by `ships`, the caster's own fall is read from `movement`. The branch's
// passives and augment are not cast: Dense Bones is a health modifier combat reads, Heavy Footing and Mass Sense are the
// client's, Pull Many is read by Pull.
import { GRAVITIC_NUMBERS as N, reachOf, slamRadius } from '@astra/shared/abilities';
import { hitTest } from '@astra/shared/combat';
import { getSkillNode } from '@astra/shared/data';
import type { AbilityEffect, CastContext } from './book.ts';

type Vec3 = [number, number, number];

/** The status an Inertial Brake leaves on its ship: no storm gust moves it until it ends. */
export const STORM_IMMUNE = 'storm_immune';

const sub = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The point Pull lands a creature at: `landM` from the caster's feet, towards the creature, along the ground. */
function landingPoint(feet: Readonly<Vec3>, from: Readonly<Vec3>): Vec3 {
  const l = Math.hypot(feet[0], feet[1], feet[2]) || 1;
  const up: Vec3 = [feet[0] / l, feet[1] / l, feet[2] / l];
  const d = sub(from, feet);
  const along = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
  const flat: Vec3 = [d[0] - up[0] * along, d[1] - up[1] * along, d[2] - up[2] * along];
  const fl = Math.hypot(flat[0], flat[1], flat[2]);
  // (a creature right on the caster's feet lands where it is)
  const k = fl > 1e-6 ? N.pull.landM / fl : 0;
  return [feet[0] + flat[0] * k, feet[1] + flat[1] * k, feet[2] + flat[2] * k];
}

/** The creatures Pull takes: the one named, and with Pull Many the nearest others the caster could have named (within the
 * node's reach of its eye, in sight, and that it may harm), up to the augment's total. */
function pulled(ctx: CastContext): number[] {
  const named = ctx.target!;
  const ids = [named];
  if (!ctx.owns('pull_many')) return ids;
  const reach = reachOf(ctx.ability, ctx.node);
  const total = getSkillNode('pull_many').params.targets!;
  const others = ctx
    .creatures(reach)
    .filter((c) => c.id !== named)
    .map((c) => ({ c, d: Math.hypot(c.pos[0] - ctx.origin[0], c.pos[1] - ctx.origin[1], c.pos[2] - ctx.origin[2]) - c.radius }))
    .filter(({ c, d }) => d <= reach && ctx.canHarm(c.id) && ctx.sight(c.pos) === true)
    .sort((a, b) => a.d - b.d);
  for (const { c } of others) {
    if (ids.length >= total) break;
    ids.push(c.id);
  }
  return ids;
}

export const GRAVITIC_EFFECTS: ReadonlyMap<string, AbilityEffect> = new Map<string, AbilityEffect>([
  [
    // The creature named, and with Pull Many up to two more near it in the caster's reach, are carried to its feet over 0.35 s.
    // A player is no target until PvP (P2.E17.T01 brings the movement authority's say over a player's own displacement): the
    // ability names mobs only, so the runtime refuses one `target`.
    'pull',
    {
      check: (ctx) => (ctx.target !== null && ctx.canHarm(ctx.target) ? null : 'target'),
      cast(ctx) {
        const feet = ctx.position();
        if (!feet) return;
        const here = new Map(ctx.creatures(reachOf(ctx.ability, ctx.node) + 2).map((c) => [c.id, c.pos] as const));
        for (const id of pulled(ctx)) {
          const from = here.get(id);
          if (from) ctx.control.pull(id, landingPoint(feet, from), N.pull.carryS, N.pull.threat);
        }
      },
    },
  ],
  [
    // A ground-pound from the jetpack: the cast needs the walker 3 m up, and the shockwave goes off where it lands, its radius
    // grown with the height it fell from (6 m at the least, 18 m from a full tank's height). The fall is gravity's: movement
    // authority judges a walker by what a fall allows, and the cast cuts the client's jetpack.
    'slam',
    {
      check(ctx) {
        const f = ctx.movement.fall();
        if (!f) return ctx.groundReady() ? 'target' : 'busy';
        return f.aboveM >= N.slam.minHeightM ? null : 'target';
      },
      cast(ctx) {
        const began = ctx.time();
        let peak = ctx.movement.fall()?.peakM ?? 0;
        const land = (): void => {
          const at = ctx.position();
          if (!at) return;
          const radius = slamRadius(peak);
          for (const h of hitTest({ kind: 'sphere', radius }, { origin: at }, ctx.creatures(radius, at))) ctx.control.knockdown(h.target.id, N.slam.downS);
        };
        const watch = (): void => {
          const f = ctx.movement.fall();
          if (!f || !ctx.position()) return;
          peak = Math.max(peak, f.peakM, f.aboveM);
          if (f.aboveM === 0) return land();
          if (ctx.time() - began < N.slam.airMaxS) ctx.after(N.slam.pollS, watch);
        };
        ctx.after(N.slam.pollS, watch);
      },
    },
  ],
  [
    // A 12 m bubble where the caster stands: for 8 s every creature in it keeps 40% of its speed (60% slower).
    'well',
    {
      cast(ctx) {
        const at = ctx.position();
        const { radiusM, slowMult, durationS } = ctx.node.params;
        if (at) ctx.control.slowField(at, radiusM!, slowMult!, durationS!);
      },
    },
  ],
  [
    // Rocks, debris and loot drawn to the hull are the client's (it holds the asteroid field; the server has no entity for any).
    // A ship the caster aimed at is held for 3 s, if it may harm one: no player until PvP (P2.E17.T01), so such a cast is
    // refused `target` before it is paid for.
    'tractor_beam',
    {
      check: (ctx) => (ctx.target === null || ctx.canHarm(ctx.target) ? null : 'target'),
      cast(ctx) {
        if (ctx.target !== null) ctx.ships.hold(ctx.target, ctx.node.params.holdS!);
      },
    },
  ],
  [
    // The stop and the turn are the client's own movement, which the authority takes as it takes any slowing; the server keeps
    // the immunity for 6 s as a status that a hazard tick (P1.E12.T03) will read.
    'inertial_brake',
    {
      cast(ctx) {
        ctx.status.apply(ctx.caster, STORM_IMMUNE, ctx.node.params.durationS!);
      },
    },
  ],
]);
