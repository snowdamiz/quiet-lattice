// Line of sight over the ground (P1.E13.T01): on a stand-in world of radius 1,000 m whose ground rises to a 6 m ridge
// across one longitude, a beam over the ridge is clear, through it blocked, and the ends it skips (the eye on the ground,
// the node sunk in it) never count; on the real home world, the beam from a node's stand is clear and from inside a hill
// is not.
import { describe, expect, it } from 'vitest';
import { miningWorld, norm, type Vec3 } from '../../test/resourceWorld.ts';
import { LOS_SKIP_NODE_M, LOS_STEP_M, LOS_TOLERANCE_M, lineOfSight } from './los.ts';

const R = 1000;
/** flat at 0, with a ridge 6 m high and 4 m wide where x is about 0 */
const ridge = { R, height: (x: number) => (Math.abs(x * R) < 2 ? 6 : 0) };
/** a point on the surface of the stand-in world `x` metres along it from the top, `h` metres up */
const at = (x: number, h: number): Vec3 => {
  const a = x / R;
  return [Math.sin(a) * (R + h), Math.cos(a) * (R + h), 0];
};

describe('lineOfSight', () => {
  it('is clear over the ridge, blocked through it', () => {
    expect(lineOfSight(ridge, at(-15, 8), at(15, 8))).toBe(true);
    expect(lineOfSight(ridge, at(-15, 1.6), at(15, 1))).toBe(false);
    // under the ridge's top by less than the tolerance (the chord dips 0.11 m below the arc midway): clear; by more: not
    expect(6 - LOS_TOLERANCE_M).toBeCloseTo(5.25, 9);
    expect(lineOfSight(ridge, at(-15, 5.5), at(15, 5.5))).toBe(true);
    expect(lineOfSight(ridge, at(-15, 5.2), at(15, 5.2))).toBe(false);
  });

  it('skips the ends: a node sunk in a rise, an eye in the ground', () => {
    const rise = { R, height: (x: number) => (Math.abs(x * R) < 0.5 ? 6 : 0) };
    expect(lineOfSight(rise, at(-20, 1.6), at(0, 0.5))).toBe(true);
    expect(lineOfSight(rise, at(0.3, 0.2), at(20, 1.6))).toBe(true);
    // the same beams with the rise in their middle are blocked
    expect(lineOfSight(rise, at(-10, 1.6), at(10, 0.5))).toBe(false);
    expect(LOS_SKIP_NODE_M).toBeGreaterThan(LOS_STEP_M);
  });

  it('samples every LOS_STEP_M along the beam', () => {
    const stats = { samples: 0 };
    lineOfSight({ R, height: () => 0 }, at(-15, 2), at(15, 2), stats);
    expect(stats.samples).toBe(Math.ceil((30 - 0.5 - LOS_SKIP_NODE_M) / LOS_STEP_M));
  });

  it('on the home world: clear from a node’s open stand, blocked from a stand with a hill between', () => {
    const w = miningWorld(0, 0);
    const open = w.findNode();
    const up = norm(open.stand);
    expect(lineOfSight(w.ground.sampler, [open.stand[0] + up[0] * 1.6, open.stand[1] + up[1] * 1.6, open.stand[2] + up[2] * 1.6], open.target)).toBe(true);
    const hill = w.findNode({ blocked: true });
    expect(w.clear(hill.stand, hill.target)).toBe(false);
    // underground, nothing is in sight
    const deep: Vec3 = [open.stand[0] - up[0] * 20, open.stand[1] - up[1] * 20, open.stand[2] - up[2] * 20];
    expect(lineOfSight(w.ground.sampler, deep, open.target)).toBe(false);
  });
});
