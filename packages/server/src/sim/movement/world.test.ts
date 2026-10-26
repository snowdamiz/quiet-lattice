// What movement authority reads of a system: the ground (levelled under cities and sites as the client levels it, sampled
// only below a ceiling no terrain reaches), the hangar shell, frames by the shared rule, and plain vector maths.
import { STATION_LAYOUT } from '@astra/shared/data';
import { cityPads, frameIdOf, planCities, planSites, sitePads, systemPoses, TerrainSampler, type FrameKey, type PlanetParams } from '@astra/shared/world';
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
  const T = 1e6;
  const poses = w.posesAt(T);
  const at = (key: FrameKey) => w.framePose(key, poses);
  it('allows the frame the shared rule picks, with the sphere’s hysteresis, and nothing a smaller sphere clearly holds', () => {
    const home = at(d.home)!.position;
    const station = at('station')!.position;
    const sw = (p: Vec3) => w.toWorld(at('station'), p);
    expect(w.frameProblem('station', [0, 0, 100], sw([0, 0, 100]), 600, poses)).toBeNull();
    // past the Waystation's sphere and its 5 %
    expect(w.frameProblem('station', [0, 0, 4800], sw([0, 0, 4800]), 600, poses)).toMatchObject({ expected: d.home });
    // the world's frame right at the Waystation: the Waystation's sphere holds it
    const near: Vec3 = [station[0] + 100, station[1], station[2]];
    expect(w.frameProblem(d.home, w.toLocal(at(d.home), near), near, 600, poses)).toMatchObject({ expected: 'station' });
    // the inertial frame deep inside the world's sphere
    const inside: Vec3 = [home[0], home[1] + 2e5, home[2]];
    expect(w.frameProblem(null, inside, inside, 600, poses)).toMatchObject({ expected: d.home });
    // and in empty space it is right
    expect(w.frameProblem(null, [0, 2e9, 0], [0, 2e9, 0], 600, poses)).toBeNull();
    expect(w.innermost([0, 2e9, 0], poses)).toBeNull();
    expect(frameIdOf(d.seed, w.innermost(near, poses))).toBe(frameIdOf(d.seed, 'station'));
  });

  it('turns local positions to world ones and back, and re-expresses them across frames at their own time', () => {
    const p: Vec3 = [123, -456, 789];
    for (const key of [null, 'station', 0, d.home] as const) {
      const back = w.toLocal(at(key), w.toWorld(at(key), p));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(p[i]!, 4);
      // the exact poses are systemPoses' own
      expect(w.framePoseExact(key, T)?.position ?? null).toEqual(at(key)?.position ?? null);
    }
    // a point in the Waystation's frame, in its world's frame at the same time: the same world position
    const t = T + 12.345;
    const inHome = w.reframe(p, 'station', d.home, t);
    const sp = systemPoses(d, t);
    const a = w.toWorld(sp.station, p);
    const b = w.toWorld(sp.bodies[d.home]!, inHome);
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i]!, 4);
    expect(w.reframe(p, d.home, d.home, t)).toEqual(p);
    const q: [number, number, number, number] = [0.1, 0.7, -0.2, 0.678];
    const n = Math.hypot(...q);
    const unit = q.map((x) => x / n) as typeof q;
    const r = rotateInverse(unit, rotate(unit, p));
    for (let i = 0; i < 3; i++) expect(r[i]).toBeCloseTo(p[i]!, 9);
    expect(rotate([0, 1, 0, 0], [0, 0, -1])).toEqual([0, 0, 1]);
  });

  it('reads poses at a pose’s own time, kept per 10 ms, seeded by the zone’s tick', () => {
    const fresh = new MovementWorld(d);
    const tick = systemPoses(d, 5e6);
    fresh.setPoses(tick, 5e6);
    expect(fresh.posesAt(5e6 + 0.004)).toBe(tick);
    expect(fresh.posesAt(5e6 + 0.3).station.position).toEqual(systemPoses(d, 5e6 + 0.3).station.position);
    expect(fresh.posesAt(5e6 + 0.3)).toBe(fresh.posesAt(5e6 + 0.301));
  });
});
