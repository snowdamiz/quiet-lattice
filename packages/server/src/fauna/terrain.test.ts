import { planSurface, Random, TerrainSampler, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import type { Vec3 } from './cells.ts';
import { Ground, groundOf, LATTICE_M } from './terrain.ts';

const system = describeZoneSystem(0);
const home = system.bodies[system.home]!;
const params = home.params as PlanetParams;

describe('the ground herds walk on', () => {
  it('is the client’s ground: levelled under cities and sites as the client plans them', () => {
    const g = new Ground(params);
    const client = new TerrainSampler(params);
    client.setPads(planSurface(params, new TerrainSampler(params), { tier: 0 }).pads);
    const rng = new Random(3);
    for (let i = 0; i < 200; i++) {
      const d: Vec3 = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
      const l = Math.hypot(...d);
      expect(g.sample(d)).toBeCloseTo(client.height(d[0] / l, d[1] / l, d[2] / l), 6);
    }
  });

  it('reads heights off a per-cell cache within centimetres of the true ground, sampling each lattice point once', () => {
    const g = new Ground(params);
    const rng = new Random(5);
    const key = g.cells.keyOf(0.2, 0.9, 0.3);
    const errors: number[] = [];
    let s = 0.5;
    let t = 0.5;
    for (let i = 0; i < 400; i++) {
      s += rng.float(-0.002, 0.002);
      t += rng.float(-0.002, 0.002);
      const d = g.cells.dirIn(key, s, t);
      errors.push(Math.abs(g.height(d) - g.sample(d)));
    }
    errors.sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length * 0.95)]!).toBeLessThan(0.2);
    // a walk of ~150 m over one cell samples a strip of the lattice, not every point it passes
    const before = g.samples;
    for (let i = 0; i < 400; i++) g.height(g.cells.dirIn(key, 0.5, 0.5));
    expect(g.samples).toBe(before);
    expect(g.cached).toBeLessThan((400 * 4 * (0.002 * g.cells.step * g.radius)) / LATTICE_M + 50);
    g.drop(key);
    expect(g.cached).toBe(0);
  });

  it('is kept per world', () => {
    expect(groundOf(params)).toBe(groundOf(params));
    expect(groundOf(params).radius).toBe(home.radius);
  });
});
