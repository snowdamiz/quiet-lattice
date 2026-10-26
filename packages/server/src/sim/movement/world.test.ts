// What movement authority reads of a system: the ground (levelled under cities and sites as the client levels it, sampled
// only below a ceiling no terrain reaches), the hangar shell, frames by the shared rule, and plain vector maths.
import { STATION_LAYOUT } from '@astra/shared/data';
import { cityPads, frameIdOf, planCities, planSites, sitePads, systemPoses, TerrainSampler, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../../zones/system.ts';
import { groundOf, heightAt, insideHangar, insideHangarShell, MovementWorld, rotate, rotateInverse, terrainCeiling, type Vec3 } from './world.ts';

describe('the ground', () => {
  it('is the client’s sampler with the client’s pads: cities’ plains first, then the sites', () => {
    const d = describeZoneSystem(0);
    const g = groundOf(d, d.home)!;
    // the client's Planet, step for step
    const params = structuredClone(d.bodies[d.home]!.params) as PlanetParams;
    const sampler = new TerrainSampler(params);
    const cities = planCities(params, sampler);
    sampler.setPads([...cityPads(cities), ...sitePads(planSites(params, sampler, cities))]);
    expect(g.sampler.pads).toEqual(sampler.pads);
    expect(g.sampler.pads!.length).toBeGreaterThan(0);
    for (const dir of [
      [0, 0, -1],
      [0.6, 0.8, 0],
      [-0.48, 0.6, 0.64],
    ] as Vec3[])
      expect(heightAt(g, dir)).toBe(sampler.height(dir[0], dir[1], dir[2]));
    // the description is left as it was, and the ground is kept
    expect((d.bodies[d.home]!.params as PlanetParams).pads).toBeUndefined();
    expect(groundOf(d, d.home)).toBe(g);
    expect(groundOf(d, 999)).toBeNull();
  });

  it('never reaches its ceiling, volcanoes and landforms included (above it the sampler is not asked)', () => {
    let worst = 0;
    for (const sys of [0, 5]) {
      const d = describeZoneSystem(sys);
      d.bodies.forEach((b, i) => {
        if (b.type === 'gas') return;
        const g = groundOf(d, i)!;
        expect(g.ceiling).toBe(terrainCeiling(b.params as PlanetParams));
        let top = -Infinity;
        for (let k = 0; k < 4000; k++) {
          // a deterministic spread of directions (a spherical Fibonacci lattice)
          const y = 1 - (2 * (k + 0.5)) / 4000;
          const r = Math.sqrt(1 - y * y);
          const a = k * 2.399963229728653;
          top = Math.max(top, heightAt(g, [r * Math.cos(a), y, r * Math.sin(a)]));
        }
        expect(top, `system ${sys} body ${i}`).toBeLessThan(g.ceiling);
        worst = Math.max(worst, top / g.ceiling);
      });
    }
    expect(worst).toBeGreaterThan(0.2);
  });
});

describe('the hangar shell', () => {
  const H = STATION_LAYOUT.hangar;
  it('is solid in its walls, floor and ceiling, open inside, at its mouth and beyond', () => {
    expect(insideHangarShell([H.x0 - 2, 10, 0])).toBe(true);
    expect(insideHangarShell([H.x1 + 2, 10, 0])).toBe(true);
    expect(insideHangarShell([0, -2, 0])).toBe(true);
    expect(insideHangarShell([0, H.y1 + 2, 0])).toBe(true);
    expect(insideHangarShell([0, 10, H.z0 - 2])).toBe(true);
    expect(insideHangarShell([0, 10, 0])).toBe(false);
    expect(insideHangarShell([0, 0.5, 0])).toBe(false);
    expect(insideHangarShell([0, 10, H.z1 + 1])).toBe(false);
    expect(insideHangarShell([H.x0 - 6, 10, 0])).toBe(false);
    expect(insideHangarShell([0, 10, 500])).toBe(false);
    // within a metre of a face is not inside
    expect(insideHangarShell([H.x0 - 0.5, 10, 0])).toBe(false);
  });

  it('holds walkers inside the hangar, with a margin', () => {
    expect(insideHangar([0, 0, 0], 2)).toBe(true);
    expect(insideHangar([0, 0, H.z1 + 1], 2)).toBe(true);
    expect(insideHangar([0, 0, H.z1 + 3], 2)).toBe(false);
    expect(insideHangar([H.x1 + 5, 0, 0], 2)).toBe(false);
  });
});

describe('frames', () => {
  const d = describeZoneSystem(0);
  const w = new MovementWorld(d);
  w.setPoses(systemPoses(d, 1e6), 1e6);
  it('allows the frame the shared rule picks, with the sphere’s hysteresis, and nothing a smaller sphere clearly holds', () => {
    const home = w.framePose(d.home)!.position;
    const station = w.framePose('station')!.position;
    expect(w.frameProblem('station', [0, 0, 100], w.toWorld('station', [0, 0, 100]), 600)).toBeNull();
    // past the Waystation's sphere and its 5 %
    expect(w.frameProblem('station', [0, 0, 4800], w.toWorld('station', [0, 0, 4800]), 600)).toMatchObject({ expected: d.home });
    // the world's frame right at the Waystation: the Waystation's sphere holds it
    const near: Vec3 = [station[0] + 100, station[1], station[2]];
    expect(w.frameProblem(d.home, w.toLocal(d.home, near), near, 600)).toMatchObject({ expected: 'station' });
    // the inertial frame deep inside the world's sphere
    const inside: Vec3 = [home[0], home[1] + 2e5, home[2]];
    expect(w.frameProblem(null, inside, inside, 600)).toMatchObject({ expected: d.home });
    // and in empty space it is right
    expect(w.frameProblem(null, [0, 2e9, 0], [0, 2e9, 0], 600)).toBeNull();
    expect(w.innermost([0, 2e9, 0])).toBeNull();
    expect(frameIdOf(d.seed, w.innermost(near))).toBe(frameIdOf(d.seed, 'station'));
  });

  it('turns local positions to world ones and back', () => {
    const p: Vec3 = [123, -456, 789];
    for (const key of [null, 'station', 0, d.home] as const) {
      const back = w.toLocal(key, w.toWorld(key, p));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(p[i]!, 4);
    }
    const q: [number, number, number, number] = [0.1, 0.7, -0.2, 0.678];
    const n = Math.hypot(...q);
    const unit = q.map((x) => x / n) as typeof q;
    const r = rotateInverse(unit, rotate(unit, p));
    for (let i = 0; i < 3; i++) expect(r[i]).toBeCloseTo(p[i]!, 9);
    expect(rotate([0, 1, 0, 0], [0, 0, -1])).toEqual([0, 0, 1]);
  });

  it('reads its poses at the time asked when the zone has not ticked near it', () => {
    const fresh = new MovementWorld(d);
    fresh.at(5e6);
    expect(fresh.posesTime).toBe(5e6);
    expect(fresh.poses.station.position).toEqual(systemPoses(d, 5e6).station.position);
    fresh.setPoses(systemPoses(d, 5e6 + 0.1), 5e6 + 0.1);
    fresh.at(5e6 + 0.2);
    expect(fresh.posesTime).toBe(5e6 + 0.1);
  });
});
