// Day and night on a world, as fauna reads it (P1.E08.T03): the meters' rule (`isNight`, @astra/shared/meters) from the
// shared kinematics, agreeing with what the meters themselves say there.
import { isNight, meterEnvironment } from '@astra/shared/meters';
import { dirToWorld, localToWorld, Random, systemPoses } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import type { Vec3 } from './cells.ts';
import { nextTime, nightAt, starsAt } from './sky.ts';

const system = describeZoneSystem(0);
const home = system.bodies[system.home]!;
const moon = system.bodies.find((b) => b.kind === 'moon')!;

function randomDir(rng: Random): Vec3 {
  const y = rng.float(-1, 1);
  const a = rng.float(0, Math.PI * 2);
  const q = Math.sqrt(1 - y * y);
  return [Math.cos(a) * q, y, Math.sin(a) * q];
}

describe('day and night on a world', () => {
  it('is night where the star is below the point’s own horizon, judged as the meters judge it in the system’s frame', () => {
    const rng = new Random(11);
    for (const body of [home, moon]) {
      let nights = 0;
      for (let i = 0; i < 400; i++) {
        const t = rng.float(0, 2e7);
        const dir = randomDir(rng);
        const r = body.radius + rng.float(-200, 3000);
        // in the system's frame, the star at the origin: day when the point's up leans toward it
        const pose = systemPoses(system, t).bodies[body.index]!;
        const p = localToWorld(pose, [dir[0] * r, dir[1] * r, dir[2] * r]);
        const up = dirToWorld(pose, dir);
        const day = -(up[0] * p[0] + up[1] * p[1] + up[2] * p[2]) > 0;
        expect(nightAt(system, body.index, dir, r, t), `${body.name} at ${t}`).toBe(!day);
        expect(isNight(dir, starsAt(system, t)[body.index]!, r)).toBe(!day);
        // the meters' own reading of the place (their environment, in the system's frame)
        expect(meterEnvironment(system, systemPoses(system, t).bodies, { frame: body.index, world: p }).time).toBe(day ? 'day' : 'night');
        if (!day) nights++;
      }
      // about half the world is in the dark at any time
      expect(nights).toBeGreaterThan(140);
      expect(nights).toBeLessThan(260);
    }
  });

  it('turns with the world: night falls and lifts at a place on its equator about once a turn, half the time dark', () => {
    // (the spin axis is the world's own +Y)
    const at: Vec3 = [1, 0, 0];
    const dusk = nextTime(system, home.index, at, home.radius, true, 0, { step: 5 })!;
    const dawn = nextTime(system, home.index, at, home.radius, false, dusk, { step: 5 })!;
    const next = nextTime(system, home.index, at, home.radius, true, dawn, { step: 5 })!;
    const day = next - dusk;
    expect(day).toBeGreaterThan(home.rotationPeriod * 0.8);
    expect(day).toBeLessThan(home.rotationPeriod * 1.3);
    expect((dawn - dusk) / day).toBeGreaterThan(0.4);
    expect((dawn - dusk) / day).toBeLessThan(0.6);
    // the clock forced to a time that stays dark (or light) for a while
    const t = nextTime(system, home.index, at, home.radius, true, dawn, { margin: 600 })!;
    for (let s = 0; s <= 600; s += 30) expect(nightAt(system, home.index, at, home.radius, t + s)).toBe(true);
    expect(nextTime(system, home.index, at, home.radius, true, dawn, { within: 10 })).toBeNull();
  });
});
