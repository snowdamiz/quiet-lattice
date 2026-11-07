import { SYMBIOTIC_NUMBERS as N } from '@astra/shared/abilities';
import { creatureSphere } from '@astra/shared/combat';
import { AI, move, reach, stunned, type Creature, type Ctx } from './ai.ts';
import type { Vec3 } from './cells.ts';

export const distance = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The companion keeps fauna's terrain, turning, speed and attack clock. It has no player-level scaling. */
export function companionStep(c: Creature, ctx: Ctx, owner: Readonly<Vec3>, enemy: Creature | undefined): void {
  if (stunned(c, ctx.now)) {
    c.attack = null;
    c.speed = 0;
    return;
  }
  const at = enemy?.pos ?? owner;
  const sphere = enemy && creatureSphere(enemy);
  const near = sphere
    ? distance(c.pos, sphere.pos) <= reach(c) + sphere.radius
    : distance(c.pos, at) <= N.bond.followM + (c.species.kind === 'flyer' ? N.bond.flyerFollowSlackM : 0);
  c.target = enemy?.id ?? null;
  c.state = enemy ? (near ? 'attack' : 'rush') : near ? 'idle' : 'follow';
  if (enemy && near) {
    c.attack = (c.attack ?? 0) + ctx.dt / AI.attackS;
    if (c.attack >= 1) {
      c.attack = 0;
      ctx.strike?.(c, enemy.id);
    }
  } else c.attack = null;
  const altitude = enemy?.species.kind === 'flyer' ? enemy.alt : N.bond.flyerAltitudeM;
  move(c, ctx, { to: [...at], speed: near ? 0 : c.species.run, altitude });
}

/** Swept contact prevents a fast herd from stepping through a target between ticks. */
export function segmentDistance(p: Readonly<Vec3>, a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / length2));
  return distance(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]);
}
