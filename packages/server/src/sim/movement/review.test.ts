// The P1.E03.T04 review's reproductions, kept: honest clients on a real network (jitter, latency swings, stalls, a stall
// straddling a change of frame or the pulse drive's drop-out), getting out on any slope, and sprinting, jumping and
// jetpacking over rough ground are never corrected; frame hopping, mode cycling, time dilation and passing through the
// hangar's walls or a hill are refused.
import { STATION_LAYOUT } from '@astra/shared/data';
import { CLIENT_SPEED_HEADROOM, flightCaps, PULSE_DRIVE, pulseClearance, pulseSpeedLimit, shipStats } from '@astra/shared/ships';
import { chooseFrame, dirToLocal, dirToWorld, frameIdOf, localToWorld, systemPoses, worldToLocal, type BodyPose } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../../zones/system.ts';
import { padPose, type MovementRefusal } from './authority.ts';
import { BOOST, exitFeet, Harness, lcg, LARK, noseTo, pose, standing, walkClient } from './testing.ts';
import { dist, groundOf, heightAt, type Vec3 } from './world.ts';

const D = describeZoneSystem(0);
const STATION = frameIdOf(D.seed, 'station')!;
const HOME = frameIdOf(D.seed, D.home)!;
const OPEN: Vec3 = [0, 2e9, 0];
const lark = shipStats(LARK);
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const first = (h: Harness) => (h.refusals[0] as MovementRefusal | undefined)?.violation;

describe('an honest client on a real network is never corrected', () => {
  /** Straight flight at the client's clamp (space, boost) or at the pulse drive's limit, sent at 20 Hz, stamped with the
   * client's clock, delivered in order after `delay(t)` seconds. */
  function fly(mode: 'space' | 'boost' | 'pulse', delay: (t: number) => number, seconds = 30): Harness {
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const v = mode === 'pulse' ? 0 : flightCaps(lark, mode).max * CLIENT_SPEED_HEADROOM;
    let p: Vec3 = [...OPEN];
    const t0 = h.now;
    let arrived = t0;
    for (let i = 1; i <= seconds * 20; i++) {
      const sent = t0 + i * 0.05;
      const speed = mode === 'pulse' ? pulseSpeedLimit(lark, pulseClearance(D, systemPoses(D, sent), p, [1, 0, 0]).min) : v;
      p = [p[0] + speed * 0.05, p[1], p[2]];
      // (in order: an input never overtakes the one before it)
      const arrives = Math.max(sent + delay(sent - t0), arrived);
      const dt = arrives - h.now;
      arrived = arrives;
      h.send(pose(null, p, [speed, 0, 0], noseTo([1, 0, 0])), mode === 'pulse' ? 'pulse' : 'ship', { dt, at: sent, buttons: mode === 'boost' ? BOOST : 0 });
    }
    return h;
  }

  it('under jitter of 50 to 400 ms, latency falling 250 ms at once, swinging 50 to 350 ms, and stalls with floods after', { timeout: 60_000 }, () => {
    const profiles: [string, () => (t: number) => number][] = [
      ['constant 80 ms', () => () => 0.08],
      [
        'jitter 50-150 ms',
        () =>
          (
            (r) => () =>
              0.05 + r() * 0.1
          )(lcg(1)),
      ],
      [
        'jitter 50-250 ms',
        () =>
          (
            (r) => () =>
              0.05 + r() * 0.2
          )(lcg(1)),
      ],
      [
        'jitter 50-400 ms',
        () =>
          (
            (r) => () =>
              0.05 + r() * 0.35
          )(lcg(1)),
      ],
      ['300 ms, then 50 ms from 10 s', () => (t) => (t < 10 ? 0.3 : 0.05)],
      ['sawtooth 50 to 350 ms over 3 s', () => (t) => 0.05 + ((t % 3) / 3) * 0.3],
      ['sine 50 to 350 ms, period 4 s', () => (t) => 0.2 + 0.15 * Math.sin((2 * Math.PI * t) / 4)],
      ['a 3 s stall at 10 s, then the flood', () => (t) => (t >= 10 && t < 13 ? 13 - t + 0.05 : 0.05)],
      ['a 2 s stall every 8 s', () => (t) => (t >= 10 && (t - 10) % 8 < 2 ? 2 - ((t - 10) % 8) + 0.05 : 0.05)],
    ];
    for (const mode of ['space', 'boost', 'pulse'] as const)
      for (const [label, delay] of profiles) {
        const h = fly(mode, delay());
        expect(h.refusals.length, `${mode}, ${label}: ${JSON.stringify(first(h))}`).toBe(0);
      }
  });

  it('crossing a world’s sphere of influence with a stall straddling the crossing, inbound and outbound', { timeout: 60_000 }, () => {
    for (const [speed, inbound, buttons] of [
      [600, true, 0],
      [600, false, 0],
      [1560, true, BOOST],
    ] as const)
      for (const stall of [0, 0.3, 0.6, 1, 2, 3]) {
        const t0 = 1e6;
        const P = systemPoses(D, t0);
        const c = P.bodies[D.home]!.position as Vec3;
        const soi = D.bodies[D.home]!.soi;
        const startR = inbound ? soi + speed * 15 : soi * 1.05 - speed * 15;
        let key: number | null = inbound ? null : D.home;
        const fr = (p: ReturnType<typeof systemPoses>, k: number | null): BodyPose | null => (k === null ? null : p.bodies[k]!);
        const world: Vec3 = [c[0], c[1] + startR, c[2]];
        let local: Vec3 = key === null ? world : (worldToLocal(fr(P, key), world) as Vec3);
        const vdir: Vec3 = inbound ? [0, -1, 0] : [0, 1, 0];
        let dir: Vec3 = key === null ? vdir : (dirToLocal(fr(P, key), vdir) as Vec3);
        const h = new Harness(D, { pose: pose(frameIdOf(D.seed, key), local), mode: 'ship' }, {}, { now: t0 });
        let crossed = -1;
        const sends: { p: ReturnType<typeof pose>; at: number }[] = [];
        for (let i = 1; i <= 600; i++) {
          const at = t0 + i * 0.05;
          local = [local[0] + dir[0] * speed * 0.05, local[1] + dir[1] * speed * 0.05, local[2] + dir[2] * speed * 0.05];
          const poses = systemPoses(D, at);
          const w = localToWorld(fr(poses, key), local) as Vec3;
          const next = chooseFrame(D, poses, w, key) as number | null;
          if (next !== key) {
            dir = dirToLocal(fr(poses, next), dirToWorld(fr(poses, key), dir)) as Vec3;
            local = worldToLocal(fr(poses, next), w) as Vec3;
            key = next;
            if (crossed < 0) crossed = at;
          }
          sends.push({ p: pose(frameIdOf(D.seed, key), [...local], [dir[0] * speed, dir[1] * speed, dir[2] * speed], noseTo(dir)), at });
        }
        expect(crossed).toBeGreaterThan(0);
        // 50 ms of latency, but everything sent during the stall arrives at its end
        const a = crossed - stall / 2;
        const b = crossed + stall / 2;
        let last = t0;
        for (const s of sends) {
          const arrives = Math.max(s.at >= a && s.at < b ? b + 0.05 : s.at + 0.05, last);
          h.send(s.p, 'ship', { dt: arrives - h.now, at: s.at, buttons });
          last = arrives;
        }
        expect(h.refusals.length, `${speed} m/s ${inbound ? 'in' : 'out'}, stall ${stall} s: ${JSON.stringify(first(h))}`).toBe(0);
      }
  });

  it('dropping out of the pulse drive at the star with a stall straddling the drop-out', { timeout: 60_000 }, () => {
    for (const stall of [0, 0.5, 2]) {
      const clearR = D.star.radius * 3;
      let p: Vec3 = [0, clearR + 2e6, 0];
      const h = new Harness(D, { pose: pose(null, p), mode: 'ship' });
      const t0 = h.now;
      let v = 600;
      let spool = 0;
      let mode: 'pulse' | 'ship' = 'pulse';
      let dropped = -1;
      const sends: { p: ReturnType<typeof pose>; mode: 'pulse' | 'ship'; at: number }[] = [];
      const DT = 1 / 60;
      for (let k = 1; k < 60 * 120 && (dropped < 0 || k < dropped + 60 * 3); k++) {
        const t = t0 + k * DT;
        const c = pulseClearance(D, systemPoses(D, t), p, [0, -1, 0]);
        if (mode === 'pulse') {
          spool = Math.min(1, spool + DT * 0.8);
          const target = pulseSpeedLimit(lark, c.min) * spool;
          v = v < target ? Math.min(target, v * Math.exp(DT * 1.5) + 200 * DT) : target + (v - target) * Math.exp(-PULSE_DRIVE.easeRate * DT);
          if (c.ahead < PULSE_DRIVE.dropOutM) {
            mode = 'ship';
            v = Math.min(v, PULSE_DRIVE.exitSpeedMax);
            dropped = k;
          }
        }
        p = [p[0], p[1] - v * DT, p[2]];
        if (k % 3 === 0) sends.push({ p: pose(null, [...p], [0, -v, 0], noseTo([0, -1, 0])), mode, at: t });
      }
      expect(dropped).toBeGreaterThan(0);
      const at = t0 + dropped * DT;
      let last = t0;
      for (const s of sends) {
        const arrives = Math.max(s.at >= at - stall / 2 && s.at < at + stall / 2 ? at + stall / 2 + 0.05 : s.at + 0.05, last);
        h.send(s.p, s.mode, { dt: arrives - h.now, at: s.at });
        last = arrives;
      }
      expect(h.refusals.length, `stall ${stall} s: ${JSON.stringify(first(h))}`).toBe(0);
    }
  });
});

describe('a walker', () => {
  it('gets out where the client sets it down, whatever the slope beside its ship', () => {
    const rnd = lcg(3);
    let far = 0;
    for (const sys of [0, 1]) {
      const d = describeZoneSystem(sys);
      d.bodies.forEach((b, bi) => {
        if (b.type === 'gas' || bi > 3) return;
        const g = groundOf(d, bi)!;
        const frame = frameIdOf(d.seed, bi);
        for (let k = 0; k < 150; k++) {
          const up = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
          const hgt = heightAt(g, up);
          if (g.ocean && hgt < 0.5) continue;
          const groundR = b.radius + (g.ocean ? Math.max(hgt, 0) : hgt);
          const a = rnd() * Math.PI * 2;
          const t1 = norm(cross(up, Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
          const t2 = cross(up, t1);
          const fwd = norm([t1[0] * Math.cos(a) + t2[0] * Math.sin(a), t1[1] * Math.cos(a) + t2[1] * Math.sin(a), t1[2] * Math.cos(a) + t2[2] * Math.sin(a)]);
          const ship = pose(frame, [up[0] * (groundR + 1.95), up[1] * (groundR + 1.95), up[2] * (groundR + 1.95)], [0, 0, 0], standing(up, fwd));
          const feet = exitFeet(d, ship);
          if (dist(feet, ship.pos as Vec3) > 25) far++;
          const h = new Harness(d, { pose: ship, mode: 'landed' });
          h.send(ship, 'landed');
          const r = h.send(pose(frame, feet), 'foot');
          expect(r.ok, `system ${sys} body ${bi}: ${JSON.stringify(first(h))}`).toBe(true);
        }
      });
    }
    // (some of those were set down far above or below the ship, on steep ground)
    expect(far).toBeGreaterThan(0);
  });

  it('sprints, jumps and jetpacks over rough ground, downhill off crests and up cliffs', { timeout: 60_000 }, () => {
    let runs = 0;
    for (const sys of [0, 1]) {
      const d = describeZoneSystem(sys);
      const rnd = lcg(11 + sys);
      d.bodies.forEach((b, bi) => {
        if (b.type === 'gas') return;
        const g = groundOf(d, bi)!;
        for (let run = 0; run < 6; run++) {
          // start on high ground (so it runs downhill), heading anywhere
          let up: Vec3 = [0, 0, 1];
          let best = -Infinity;
          for (let k = 0; k < 40; k++) {
            const u = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
            const hgt = heightAt(g, u);
            if (hgt > best) {
              best = hgt;
              up = u;
            }
          }
          if (g.ocean && best < 1) continue;
          const heading = norm(cross(up, norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1])));
          const h = new Harness(d, {
            pose: pose(frameIdOf(d.seed, bi), [up[0] * (b.radius + best), up[1] * (b.radius + best), up[2] * (b.radius + best)]),
            mode: 'foot',
          });
          const refused = walkClient(h, bi, up, heading, 15, rnd, run % 2 === 0);
          expect(refused, `system ${sys} body ${bi} run ${run}: ${JSON.stringify(first(h))}`).toBe(0);
          runs++;
        }
      });
    }
    expect(runs).toBeGreaterThan(50);
  });
});

describe('cheats the review found are refused', () => {
  it('hopping frames back and forth round the Waystation and at a world’s sphere', () => {
    // round the Waystation, 1.7 km of arc an input, alternating its frame and its world's
    const h = new Harness(D, { pose: pose(STATION, [0, 0, 4300]), mode: 'ship' });
    let station = true;
    for (let i = 1; i <= 40; i++) {
      const ang = (i * 1700) / 4300;
      const local: Vec3 = [Math.sin(ang) * 4300, 0, Math.cos(ang) * 4300];
      station = !station;
      const poses = systemPoses(D, h.now + 0.05);
      const p = station ? local : (worldToLocal(poses.bodies[D.home]!, localToWorld(poses.station, local)) as Vec3);
      h.send(pose(station ? STATION : HOME, p), 'ship', { buttons: BOOST });
    }
    // (all but the odd hop that comes round the circle near the corrected pose)
    expect(h.refusals.length).toBeGreaterThanOrEqual(36);
    // at the world's sphere: 2.5 km of arc an input, alternating its frame and the inertial one
    const t = 1e6;
    const c0 = systemPoses(D, t).bodies[D.home]!.position as Vec3;
    const rr = D.bodies[D.home]!.soi;
    const g = new Harness(D, { pose: pose(null, [c0[0], c0[1] + rr, c0[2]]), mode: 'ship' }, {}, { now: t });
    let inWorld = false;
    for (let i = 1; i <= 40; i++) {
      inWorld = !inWorld;
      const poses = systemPoses(D, g.now + 0.05);
      const c = poses.bodies[D.home]!.position as Vec3;
      const w: Vec3 = [c[0] + Math.sin((i * 2500) / rr) * rr, c[1] + Math.cos((i * 2500) / rr) * rr, c[2]];
      g.send(pose(inWorld ? HOME : null, inWorld ? (worldToLocal(poses.bodies[D.home]!, w) as Vec3) : w), 'ship', { buttons: BOOST });
    }
    expect(g.refusals.length).toBeGreaterThanOrEqual(36);
    // and hopping inside the Waystation sphere's hysteresis at a modest speed: the rule never changes frame there
    const s = new Harness(D, { pose: pose(STATION, [0, 0, 4600]), mode: 'ship' });
    const poses = systemPoses(D, s.now + 0.05);
    const p = worldToLocal(poses.bodies[D.home]!, localToWorld(poses.station, [0, 0, 4610])) as Vec3;
    s.send(pose(HOME, p), 'ship');
    expect(first(s)).toMatchObject({ rule: 'frame', detail: 'from the Waystation to body 1 short of where the rule changes it' });
  });

  it('cycling landed and flying, or getting out and boarding, to move faster than the caps', () => {
    const g = groundOf(D, D.home)!;
    const R = D.bodies[D.home]!.radius;
    // a dry, gentle stretch of ground on the home world
    let up0: Vec3 = [0, 0, -1];
    let tan: Vec3 = [1, 0, 0];
    for (let k = 0; k < 5000; k++) {
      const u = norm([Math.sin(k * 1.37), Math.cos(k * 0.71), Math.sin(k * 2.13 + 0.5)]);
      const t = norm([u[1], -u[0], 0]);
      const h = (s: number) => heightAt(g, norm([u[0] + (t[0] * s) / R, u[1] + (t[1] * s) / R, u[2] + (t[2] * s) / R]));
      let ok = true;
      for (let s = 0; s < 6000 && ok; s += 10) if (h(s) < 5 || Math.abs(h(s + 10) - h(s)) > 4) ok = false;
      if (ok) {
        up0 = u;
        tan = t;
        break;
      }
    }
    const at = (s: number, extra: number): Vec3 => {
      const d = norm([up0[0] + (tan[0] * s) / R, up0[1] + (tan[1] * s) / R, up0[2] + (tan[2] * s) / R]);
      const r = R + Math.max(0, heightAt(g, d)) + extra;
      return [d[0] * r, d[1] * r, d[2] * r];
    };
    // landed and flying in turn at 60 Hz, 80 m an input (4.8 km/s)
    const toggle = new Harness(D, { pose: pose(HOME, at(0, 1.95)), mode: 'landed' });
    for (let i = 0; i < 60; i++) toggle.send(pose(HOME, at(80 * (i + 1), i % 2 ? 1.95 : 2.5)), i % 2 ? 'landed' : 'ship', { dt: 1 / 60, buttons: BOOST });
    expect(toggle.refusals.length).toBe(60);
    // (at 20 Hz, 1.4 km/s, under the boost cap: nothing gained, nothing refused)
    const slow = new Harness(D, { pose: pose(HOME, at(0, 1.95)), mode: 'landed' });
    for (let i = 0; i < 60; i++) slow.send(pose(HOME, at(70 * (i + 1), i % 2 ? 1.95 : 2.5)), i % 2 ? 'landed' : 'ship', { buttons: BOOST });
    expect(slow.refusals.length, JSON.stringify(first(slow))).toBe(0);
    // out beside the ship, then boarding it 500 m further on
    const cycle = new Harness(D, { pose: pose(HOME, at(0, 1.95)), mode: 'landed' });
    for (let i = 0; i < 10; i++) {
      cycle.send(pose(HOME, at(500 * i + 5, 0)), 'foot');
      cycle.send(pose(HOME, at(500 * (i + 1), 3)), 'ship', { buttons: BOOST });
    }
    expect(cycle.refusals.length).toBe(20);
  });

  it('a clock run fast (a time-dilation speed hack): its extra time is not credited', () => {
    // twice the space cap, the client's clock running twice as fast to make it look like the cap
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    let p: Vec3 = [...OPEN];
    const t0 = h.now;
    for (let i = 1; i <= 100; i++) {
      p = [p[0] + 1200 * 0.05, p[1], p[2]];
      h.send(pose(null, p, [600, 0, 0]), 'ship', { at: t0 + i * 0.1 });
    }
    expect(h.refusals.length).toBeGreaterThan(0);
    expect(first(h)).toMatchObject({ rule: 'speed' });
    // the same from a clock first held 5 s behind (to bank time), then run fast to catch up
    const late = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    p = [...OPEN];
    const t1 = late.now;
    for (let i = 1; i <= 40; i++) late.send(pose(null, OPEN), 'ship', { at: t1 + i * 0.05 - 5 });
    for (let i = 1; i <= 60; i++) {
      p = [p[0] + 1200 * 0.05, p[1], p[2]];
      late.send(pose(null, p, [600, 0, 0]), 'ship', { at: late.now + 0.05 - 5 + i * 0.05 });
    }
    expect(first(late)).toMatchObject({ rule: 'speed' });
  });

  it('passing through the hangar’s side wall at 100 m/s without a pose inside it, or a hill in one hop', () => {
    const H = STATION_LAYOUT.hangar;
    // 20 m every 0.2 s, never sampled inside the shell or its ship-sized margin
    const h = new Harness(D, { pose: pose(STATION, [H.x0 - 72, 10, -22]), mode: 'ship' });
    for (let x = H.x0 - 52; x < H.x0 + 40; x += 20) h.send(pose(STATION, [x, 10, -22], [100, 0, 0], noseTo([1, 0, 0])), 'ship', { dt: 0.2 });
    expect(first(h)).toMatchObject({ rule: 'station_hull', detail: 'through the hangar shell' });
    // (at boost speed the client's own collisions miss the wall too: no more than they would is refused)
    const fast = new Harness(D, { pose: pose(STATION, [H.x0 - 120, 10, -22]), mode: 'ship' });
    for (let i = 1; i <= 4; i++) fast.send(pose(STATION, [H.x0 - 120 + 80 * i, 10, -22], [1600, 0, 0], noseTo([1, 0, 0])), 'ship', { buttons: BOOST });
    expect(fast.refusals.filter((r) => (r as MovementRefusal).violation?.rule === 'station_hull')).toEqual([]);

    // a hop between two points on either side of a hill 40 m higher than both
    const g = groundOf(D, D.home)!;
    const R = D.bodies[D.home]!.radius;
    let hopped: boolean | null = null;
    for (let k = 0; k < 4000 && hopped === null; k++) {
      const a = norm([Math.sin(k * 1.7), Math.cos(k * 2.3), Math.sin(k * 0.9 + 1)]);
      const t = norm([a[1], -a[0], 0]);
      const b = norm([a[0] + (t[0] * 200) / R, a[1] + (t[1] * 200) / R, a[2] + (t[2] * 200) / R]);
      const ga = heightAt(g, a);
      const gb = heightAt(g, b);
      if (ga < 1 || gb < 1) continue;
      let peak = -Infinity;
      for (let j = 1; j < 20; j++)
        peak = Math.max(peak, heightAt(g, norm([a[0] + (t[0] * 10 * j) / R, a[1] + (t[1] * 10 * j) / R, a[2] + (t[2] * 10 * j) / R])));
      if (peak - (Math.max(ga, gb) + 10) < 40) continue;
      const pa: Vec3 = [a[0] * (R + ga + 10), a[1] * (R + ga + 10), a[2] * (R + ga + 10)];
      const pb: Vec3 = [b[0] * (R + gb + 10), b[1] * (R + gb + 10), b[2] * (R + gb + 10)];
      const hill = new Harness(D, { pose: pose(HOME, pa), mode: 'ship' });
      for (let i = 0; i < 20; i++) hill.send(pose(HOME, pa), 'ship');
      const r = hill.send(pose(HOME, pb), 'ship', { dt: 0.1 });
      hopped = r.ok;
      expect(first(hill)).toMatchObject({ rule: 'terrain', detail: 'through the ground' });
    }
    expect(hopped).toBe(false);
  });

  it('a ship joining when every pad is held waits in the hangar instead of docking on a held pad', () => {
    const h = new Harness(D, { pose: padPose(STATION, 0), mode: 'docked' });
    for (let i = 1; i < STATION_LAYOUT.pads.length; i++) h.a.add(10 + i, padPose(STATION, i), 'docked', { ship: LARK }, h.now);
    expect(h.a.freePad()).toBeNull();
  });
});
