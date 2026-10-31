// What a player can hit on its world (ARCHITECTURE §20, §28): the creatures a shot or a cast tests against, every one
// through the same two rules, so neither ever reaches what its player cannot see: the shared hit sphere
// (`creatureSphere`, `@astra/shared/combat`) and the phase rule (§6.1: a phase's own creature is no one else's).
import { creatureSphere } from '@astra/shared/combat';
import type { FaunaSim } from '../fauna/sim.ts';
import type { PhaseManager } from '../phases/manager.ts';

type Vec3 = readonly [number, number, number];

/** A creature as hit tests take it: its entity, and its hit sphere in its world's frame. */
export interface CreatureTarget {
  id: number;
  pos: [number, number, number];
  radius: number;
}

/** A zone, as target picking reads it. */
export interface TargetZone {
  readonly fauna: Pick<FaunaSim, 'creaturesIn'> | null;
  readonly phases: Pick<PhaseManager, 'canSee'>;
}

/** The living creatures of world `frame` that the player whose entity is `viewer` can see, with their hit spheres; with
 * `near`, only those whose sphere may come within `reach` metres of `at` (a coarse cull, axis by axis). */
export function creatureTargets(zone: TargetZone, viewer: number, frame: string, near?: { at: Vec3; reach: number }): CreatureTarget[] {
  const out: CreatureTarget[] = [];
  if (!zone.fauna) return out;
  for (const c of zone.fauna.creaturesIn(frame)) {
    const s = creatureSphere(c);
    if (near) {
      const r = near.reach + s.radius;
      if (Math.abs(s.pos[0] - near.at[0]) > r || Math.abs(s.pos[1] - near.at[1]) > r || Math.abs(s.pos[2] - near.at[2]) > r) continue;
    }
    if (!zone.phases.canSee(viewer, c.id)) continue;
    out.push({ id: c.id, pos: s.pos, radius: s.radius });
  }
  return out;
}
