// What Gravitic asks of movement authority (P1.E07.T04, DESIGN 9.2): a walker's fall for Slam to read, a ship held by a Tractor
// Beam, and honest clients using Slam's fall and Inertial Brake's stop and turn, which are never corrected.
import { WALKER } from '@astra/shared/data';
import { frameIdOf } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../../zones/system.ts';
import { MOVEMENT } from './rules.ts';
import { Harness, noseTo, pose } from './testing.ts';
import { groundOf, heightAt, type Vec3 } from './world.ts';
import type { MovementRefusal } from './authority.ts';

const D = describeZoneSystem(0);
const HOME = frameIdOf(D.seed, D.home)!;
const HOME_R = D.bodies[D.home]!.radius;
const GRAVITY = D.bodies[D.home]!.gravity;
const OPEN: Vec3 = [0, 2e9, 0];
const scale = (v: Readonly<Vec3>, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const refusal = (v: unknown) => v as MovementRefusal;

/** A walker's harness on dry land of the home world, and the height of the ground there. */
function walker(): { h: Harness; up: Vec3; ground: number } {
  const g = groundOf(D, D.home)!;
  const up: Vec3 = [0, 0, -1];
  const ground = HOME_R + heightAt(g, up);
  const h = new Harness(D, { pose: pose(HOME, scale(up, ground)), mode: 'foot' });
  return { h, up, ground };
}

/** The client's walker rising on a jump and the jetpack for `thrustS` seconds, then falling free (Slam cuts the jetpack):
 * its heights, sent at 20 Hz. */
function slam(h: Harness, up: Vec3, ground: number, thrustS: number): number {
  const DT = 1 / 60;
  let r = ground;
  let vUp = WALKER.jumpSpeed;
  let airTime = 0;
  let highest = 0;
  for (let k = 1; k <= 60 * 12; k++) {
    airTime += DT;
    vUp -= GRAVITY * DT;
    if (airTime > WALKER.jet.afterS && airTime < thrustS) vUp = Math.min(vUp + (GRAVITY + WALKER.jet.thrust) * DT, WALKER.jet.climbMax);
    r += vUp * DT;
    highest = Math.max(highest, r - ground);
    const landed = r <= ground + 0.02;
    if (landed) {
      r = ground;
      vUp = 0;
    }
    if (k % 3 === 0 || landed) h.send(pose(HOME, scale(up, r), scale(up, vUp)), 'foot');
    if (landed) break;
  }
  return highest;
}

describe('a walker’s fall', () => {
  it('reads 0 standing, and the height above the ground and the highest of the fall in the air', () => {
    const { h, up, ground } = walker();
    h.send(pose(HOME, scale(up, ground)), 'foot');
    expect(h.a.fall(h.id)).toEqual({ aboveM: 0, peakM: 0 });
    for (let i = 1; i <= 15; i++) h.send(pose(HOME, scale(up, ground + i * 0.8), scale(up, 16)), 'foot');
    expect(h.a.fall(h.id)).toEqual({ aboveM: expect.closeTo(12, 3), peakM: expect.closeTo(12, 3) });
    for (let i = 1; i <= 3; i++) h.send(pose(HOME, scale(up, ground + 12 - i * 0.1), scale(up, -2)), 'foot');
    const f = h.a.fall(h.id)!;
    expect(f.aboveM).toBeCloseTo(11.7, 3);
    expect(f.peakM).toBeCloseTo(12, 3);
    expect(h.refusals).toEqual([]);
  });

  it('forgets the fall once the walker stands, and is null for anything that is not a walker, and for a missing mover', () => {
    const { h, up, ground } = walker();
    h.send(pose(HOME, scale(up, ground + 5)), 'foot');
    h.send(pose(HOME, scale(up, ground)), 'foot');
    expect(h.a.fall(h.id)).toEqual({ aboveM: 0, peakM: 0 });
    const ship = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    expect(ship.a.fall(ship.id)).toBeNull();
    expect(h.a.fall(99)).toBeNull();
  });

  it('is judged as a fall: an honest jetpack climb, a cut and a fall to the ground draw no correction, and show the height of the slam', () => {
    const { h, up, ground } = walker();
    let seen = 0;
    const read = () => (seen = Math.max(seen, h.a.fall(h.id)?.peakM ?? 0));
    const send = h.send.bind(h);
    h.send = (...args) => {
      const v = send(...args);
      read();
      return v;
    };
    for (let i = 0; i < 5; i++) h.send(pose(HOME, scale(up, ground)), 'foot');
    const highest = slam(h, up, ground, 1.5);
    expect(highest).toBeGreaterThan(8);
    expect(h.refusals).toEqual([]);
    expect(seen).toBeGreaterThan(highest - 1.5);
    expect(h.a.fall(h.id)).toEqual({ aboveM: 0, peakM: 0 });
  });
});

describe('Inertial Brake', () => {
  /** A ship cruising at `speed` m/s along +x for `seconds`, sent at 20 Hz. */
  function cruise(h: Harness, from: Vec3, speed: number, seconds: number): Vec3 {
    let p = from;
    for (let i = 0; i < seconds * 20; i++) {
      p = [p[0] + speed * 0.05, p[1], p[2]];
      h.send(pose(null, p, [speed, 0, 0], noseTo([1, 0, 0])), 'ship');
    }
    return p;
  }

  it('an instant stop and turn at full speed draws no correction, and the ship stays where it stopped', () => {
    const h = new Harness(D, { pose: pose(null, OPEN, [0, 0, 0], noseTo([1, 0, 0])), mode: 'ship' });
    const speed = 500;
    const at = cruise(h, OPEN, speed, 2);
    // the brake: velocity gone at once, the nose swung to the side; then it sits (and turns again) for a while
    for (let i = 0; i < 40; i++) h.send(pose(null, at, [0, 0, 0], noseTo(i < 20 ? [0, 0, -1] : [0, 1, 0])), 'ship');
    // and flies off again from rest
    cruise(h, at, 300, 1);
    expect(h.refusals).toEqual([]);
  });
});

describe('Tractor Beam hold', () => {
  function held(): { h: Harness; at: Vec3 } {
    const h = new Harness(D, { pose: pose(null, OPEN, [0, 0, 0], noseTo([1, 0, 0])), mode: 'ship' });
    let p = OPEN;
    for (let i = 0; i < 40; i++) {
      p = [p[0] + 15, p[1], p[2]];
      h.send(pose(null, p, [300, 0, 0], noseTo([1, 0, 0])), 'ship');
    }
    expect(h.a.hold(h.id, h.now + 3, h.now)).toBe(true);
    return { h, at: p };
  }

  it('lets a held ship stop where it is, even after the coast before its client heard of the beam', () => {
    const { h, at } = held();
    let p = at;
    for (let i = 0; i < 3; i++) {
      p = [p[0] + 15, p[1], p[2]];
      h.send(pose(null, p, [300, 0, 0], noseTo([1, 0, 0])), 'ship');
    }
    for (let i = 0; i < 40; i++) h.send(pose(null, p, [0, 0, 0], noseTo([1, 0, 0])), 'ship');
    expect(h.refusals).toEqual([]);
  });

  it('refuses a held ship that flies on out of the beam, with a correction to where it was held', () => {
    const { h, at } = held();
    let p = at;
    let first: MovementRefusal | null = null;
    for (let i = 0; i < 40 && !first; i++) {
      p = [p[0] + 15, p[1], p[2]];
      const v = h.send(pose(null, p, [300, 0, 0], noseTo([1, 0, 0])), 'ship');
      if (!v.ok) first = refusal(v);
    }
    expect(first?.violation).toMatchObject({ rule: 'held', allowed: MOVEMENT.held.reachM, unit: 'm' });
    expect(first!.violation!.measured).toBeGreaterThan(MOVEMENT.held.reachM);
    expect(first!.correction).not.toBeNull();
  });

  it('lets the ship go when the hold ends', () => {
    const { h, at } = held();
    let p = at;
    for (let i = 0; i < 64; i++) h.send(pose(null, at, [0, 0, 0], noseTo([1, 0, 0])), 'ship');
    for (let i = 0; i < 20; i++) {
      p = [p[0] + 15, p[1], p[2]];
      expect(h.send(pose(null, p, [300, 0, 0], noseTo([1, 0, 0])), 'ship').ok).toBe(true);
    }
  });

  it('a later hold extends the first, and a walker or a stranger cannot be held', () => {
    const { h } = held();
    expect(h.a.hold(h.id, h.now + 10, h.now)).toBe(true);
    expect(h.a.hold(99, h.now + 3, h.now)).toBe(false);
    const w = walker();
    expect(w.h.a.hold(w.h.id, w.h.now + 3, w.h.now)).toBe(false);
  });
});
