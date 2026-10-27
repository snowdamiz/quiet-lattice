// Day and night on a world's surface (P1.E08.T03): night doubles predator spawns and brings out the apex (DESIGN 12.2,
// 12.8). The rule is the meters' (P1.E07.T02's meterEnvironment): it is day at a point when its star is above the
// horizon of the point's own up, and night otherwise; here from the shared kinematics (bodies' poses from the world time,
// ARCHITECTURE §3), so the server's night is where every client draws it. Points are in a world's own turning frame, as
// creatures are.
import { dirToLocal, systemPoses, type SystemMotions } from '@astra/shared/world';
import type { Vec3 } from './cells.ts';

/** The star as each body of a system sees it at world time `time`: the vector from the body's centre to the star, in the
 * body's own (turning) axes, m. */
export function starsAt(system: SystemMotions, time: number): Vec3[] {
  return systemPoses(system, time).bodies.map((p) => dirToLocal(p, [-p.position[0], -p.position[1], -p.position[2]]));
}

/** Whether it is night at the point `r` metres from a world's centre along unit direction `dir` (its own up): its star
 * (`star`, from starsAt) on or below that point's horizon. */
export function isNight(star: Readonly<Vec3>, dir: Readonly<Vec3>, r: number): boolean {
  return dir[0] * star[0] + dir[1] * star[1] + dir[2] * star[2] <= r;
}

/** Whether it is night at time `time` at a point on body `body` (`dir` a unit direction, `r` from its centre). */
export function nightAt(system: SystemMotions, body: number, dir: Readonly<Vec3>, r: number, time: number): boolean {
  return isNight(starsAt(system, time)[body]!, dir, r);
}

/**
 * The first time from `from` (s) at which it is night (`night` true) or day at a point, to within `step` seconds and at
 * least `margin` seconds before it turns again; null if not within `within` seconds. A forced clock for tests, the bench
 * and the dev tools: a world turns once in about an hour.
 */
export function nextTime(
  system: SystemMotions,
  body: number,
  dir: Readonly<Vec3>,
  r: number,
  night: boolean,
  from: number,
  { step = 10, margin = 0, within = 1e6 }: { step?: number; margin?: number; within?: number } = {},
): number | null {
  for (let t = from; t <= from + within; t += step) {
    if (nightAt(system, body, dir, r, t) !== night) continue;
    let ok = true;
    for (let s = step; s <= margin && ok; s += step) ok = nightAt(system, body, dir, r, t + s) === night;
    if (ok) return t;
  }
  return null;
}
