// The ship's base gun (P1.E06.T02): its numbers from the data through shipStats, the aim it allows off the ship's nose,
// creatures' hit spheres, and the coarse line of sight over the ground.
import { getWeapon } from '@astra/shared/data';
import { shipStats } from '@astra/shared/ships';
import { describe, expect, it } from 'vitest';
import { noseTo } from '../../test/pilot.ts';
import { DEFAULT_LOADOUT } from '../inventory/service.ts';
import { AIM_CONE_DEG, aimWithin, baseGun, creatureSphere, HIT_SLACK_M, noseOf } from './gun.ts';
import { clearSight, SIGHT_SAMPLES } from './sight.ts';

type Vec3 = [number, number, number];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('the base gun', () => {
  it("is the Lark's Pulse Lasers, with the weapon table's numbers", () => {
    const gun = baseGun(shipStats(DEFAULT_LOADOUT.ship!));
    const p = getWeapon('pulse_lasers').params;
    expect(gun).toEqual({ hardpoint: 's1', weapon: 'pulse_lasers', damage: p.damage, cooldownS: p.cooldownS, rangeM: p.rangeM });
  });

  it('takes the Pilot and Thermal modifiers the ship stats apply, and is none when nothing is fitted', () => {
    const plain = baseGun(shipStats(DEFAULT_LOADOUT.ship!))!;
    // Gunnery shortens the cooldown of every weapon (DESIGN 10.3)
    const gunnery = baseGun(shipStats(DEFAULT_LOADOUT.ship!, { skills: ['gunnery'] }))!;
    expect(gunnery.cooldownS).toBeLessThan(plain.cooldownS);
    expect(baseGun(shipStats({ ...DEFAULT_LOADOUT.ship!, modules: {} }))).toBeNull();
    // a fitted weapon that is not hitscan per shot is not the base gun
    expect(baseGun(shipStats({ hull: 'kestrel', modules: { s1: 'tractor_mount' }, cargoPods: 1, livery: 0 }))).toBeNull();
  });
});

describe('aiming', () => {
  it("reads the ship's nose as the client's lasers fire (its −z)", () => {
    for (const d of [unit([1, 2, 3]), unit([0, 0, -1]), unit([0, -1, 0.001]), unit([-0.3, 0.1, 0.9])]) {
      const n = noseOf(noseTo(d));
      for (let i = 0; i < 3; i++) expect(n[i]).toBeCloseTo(d[i]!, 9);
    }
  });

  it(`allows an aim up to ${AIM_CONE_DEG}° off the nose, and none past it`, () => {
    const q = noseTo([0, 0, -1]);
    const off = (deg: number): Vec3 => [Math.sin((deg * Math.PI) / 180), 0, -Math.cos((deg * Math.PI) / 180)];
    expect(aimWithin([0, 0, -5], q)).toBe(true);
    expect(aimWithin(off(AIM_CONE_DEG - 0.5), q)).toBe(true);
    expect(aimWithin(off(AIM_CONE_DEG + 0.5), q)).toBe(false);
    expect(aimWithin([0, 0, 1], q)).toBe(false);
    expect(aimWithin([0, 0, 0], q)).toBe(false);
  });

  it("puts a walker's hit sphere round its body and a flyer's on it, with slack", () => {
    const pos: Vec3 = [0, 1000, 0];
    const walker = creatureSphere({ pos, scale: 1, species: { size: 2, kind: 'quad' } });
    expect(walker.radius).toBeCloseTo(2 * 0.6 + HIT_SLACK_M, 9);
    expect(walker.pos[1]).toBeCloseTo(1001, 9);
    const flyer = creatureSphere({ pos, scale: 1, species: { size: 2, kind: 'flyer' } });
    expect(flyer.pos).toEqual(pos);
  });
});

describe('line of sight', () => {
  // a world of radius 1000 m, flat at 0 but for a 50 m ridge where x > 0 and |z| < 30
  const R = 1000;
  const sampler = { R, height: (x: number, _y: number, z: number) => (x > 0 && Math.abs(z * R) < 30 ? 50 : 0) };
  const up = (dir: Vec3, h: number): Vec3 => {
    const d = unit(dir);
    return [d[0] * (R + h), d[1] * (R + h), d[2] * (R + h)];
  };

  it('is clear over flat ground and blocked by a ridge between', () => {
    expect(clearSight(sampler, up([-0.3, 1, 0], 20), up([-0.1, 1, 0], 1))).toBe(true);
    expect(clearSight(sampler, up([-0.3, 1, 0], 20), up([0.3, 1, 0], 1))).toBe(false);
    // high enough over the ridge, it sees across
    expect(clearSight(sampler, up([-0.3, 1, 0], 400), up([0.3, 1, 0], 120))).toBe(true);
  });

  it(`samples a long line at most ${SIGHT_SAMPLES} times, and a short one every 2 m`, () => {
    const flat = { R: 100_000, height: () => 0 };
    const far = { samples: 0 };
    clearSight(flat, [0, 100_200, 0], [1500, 100_100, 0], far);
    expect(far.samples).toBeLessThanOrEqual(SIGHT_SAMPLES + 1);
    const near = { samples: 0 };
    clearSight(flat, [0, 100_200, 0], [40, 100_200, 0], near);
    expect(near.samples).toBe(19);
  });
});
