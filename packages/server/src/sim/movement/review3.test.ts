// The P1.E03.T04 third review's reproductions, kept, and a test for each rule a mutation survived: a page that stalls
// for seconds and changes frame on its first input back is not corrected (the frames' motion meanwhile is theirs, not the
// ship's); a backlog that drains over seconds and a latency spike that falls back are not corrected; a client whose
// stamps lag its arrival for good is placed where the bodies really are, and flies into the real Waystation's sphere no
// further than one stamping now; re-syncing and silent bursts gain nothing; and no input carries more than a second.
import { flightCaps, pulseClearance, pulseSpeedLimit, shipStats } from '@astra/shared/ships';
import { chooseFrame, dirToLocal, frameIdOf, frameKeyOf, localToWorld, systemPoses, worldToLocal, type FrameKey, type SystemPoses } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../../zones/system.ts';
import { type MovementRefusal } from './authority.ts';
import { MOVEMENT } from './rules.ts';
import { BOOST, GatedGrounds, Harness, LARK, noseTo, pose } from './testing.ts';
import { groundOf, heightAt, type Vec3 } from './world.ts';

const D = describeZoneSystem(0);
const HOME = frameIdOf(D.seed, D.home)!;
const OPEN: Vec3 = [0, 2e9, 0];
const X: Vec3 = [1, 0, 0];
const lark = shipStats(LARK);
const BOOST_ALLOWED = flightCaps(lark, 'boost').allowed;
const first = (h: Harness) => (h.refusals[0] as MovementRefusal | undefined)?.violation;
const frameOf = (p: SystemPoses, k: FrameKey) => (k === null ? null : k === 'station' ? p.station : p.bodies[k]!);
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('a page that stalls, its frame changing on its first input back', () => {
  /** The Waystation in its world's frame at world time `t`. */
  const stationIn = (t: number): Vec3 => {
    const P = systemPoses(D, t);
    return worldToLocal(P.bodies[D.station.parent]!, P.station.position as Vec3) as Vec3;
  };

  it('is not corrected: its old frame carried it while it stood still, and only its own movement is judged', () => {
    for (const stall of [4, 9]) {
      const t0 = 1e6;
      const end = t0 + 3 + stall;
      // hovering in the world's frame where the Waystation, moving at ~780 m/s through it, will have come within 2 km of it
      const heading = norm(stationIn(t0 + 1).map((x, i) => x - stationIn(t0)[i]!) as Vec3);
      const at = stationIn(end).map((x, i) => x + heading[i]! * 2000) as Vec3;
      const world = frameIdOf(D.seed, D.station.parent);
      const h = new Harness(D, { pose: pose(world, at), mode: 'ship' }, {}, { now: t0 });
      for (let i = 0; i < 60; i++) h.send(pose(world, at), 'ship');
      expect(h.refusals).toEqual([]);
      // the page stalls: no frame runs, no input leaves, its clock runs on
      h.now += stall;
      // back: the shared rule puts it in the Waystation's frame now, where the client re-expresses it
      const P = systemPoses(D, h.now + 0.05);
      const w = localToWorld(frameOf(P, D.station.parent), at) as Vec3;
      expect(chooseFrame(D, P, w, D.station.parent)).toBe('station');
      const local = worldToLocal(P.station, w) as Vec3;
      const station = frameIdOf(D.seed, 'station');
      for (let i = 0; i < 40; i++) h.send(pose(station, local), 'ship');
      expect(h.refusals, `${stall} s: ${JSON.stringify(first(h))}`).toEqual([]);
      // (and a minute's ride along with the frame is not the ship's: 2 km further on, as it changes frame, is refused)
      const cheat = new Harness(D, { pose: pose(world, at), mode: 'ship' }, {}, { now: t0 });
      for (let i = 0; i < 60; i++) cheat.send(pose(world, at), 'ship');
      cheat.now += stall;
      expect(cheat.send(pose(station, [local[0] + 2000, local[1], local[2]]), 'ship').ok).toBe(false);
    }
  });
});

describe('an honest client on a slowly draining network is never corrected', () => {
  it('a stall whose backlog then drains over seconds, boosting or on the pulse drive', { timeout: 60_000 }, () => {
    for (const mode of ['boost', 'pulse'] as const)
      for (const [S, Dd] of [
        [2, 0.5],
        [4, 1.5],
        [9, 2],
        [9, 4],
        [20, 3],
        [40, 6],
      ] as const) {
        const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
        let p: Vec3 = [...OPEN];
        const t0 = h.now;
        let last = t0;
        const s0 = t0 + 15;
        for (let i = 1; i <= Math.round((15 + S + Dd + 10) * 20); i++) {
          const tc = t0 + i * 0.05;
          const v = mode === 'boost' ? 1560 : pulseSpeedLimit(lark, pulseClearance(D, systemPoses(D, tc), p, X).min);
          p = [p[0] + v * 0.05, p[1], p[2]];
          // sent during the stall or while the backlog drains: delivered in order, evenly through the drain
          const arrives = Math.max(tc < s0 || tc >= s0 + S + Dd ? tc + 0.06 : s0 + S + ((tc - s0) / (S + Dd)) * Dd + 0.06, last);
          last = arrives;
          h.send(pose(null, p, [v, 0, 0], noseTo(X)), mode === 'pulse' ? 'pulse' : 'ship', {
            buttons: mode === 'boost' ? BOOST : 0,
            at: tc,
            dt: arrives - h.now,
          });
        }
        expect(h.corrections.length, `${mode}, stall ${S} s draining over ${Dd} s: ${JSON.stringify(first(h))}`).toBe(0);
      }
  });

  it('a latency spike of up to 3 s rising and falling back over seconds', () => {
    for (const [peak, up, down] of [
      [0.6, 2, 1],
      [1, 3, 2],
      [1, 1, 3],
      [2, 4, 2],
      [2, 2, 4],
      [3, 5, 5],
    ] as const) {
      const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
      let p: Vec3 = [...OPEN];
      const t0 = h.now;
      let last = t0;
      const lat = (t: number) => {
        const s = t - 10;
        if (s < 0) return 0.05;
        if (s < up) return 0.05 + ((peak - 0.05) * s) / up;
        if (s < up + down) return peak - ((peak - 0.05) * (s - up)) / down;
        return 0.05;
      };
      for (let i = 1; i <= 600; i++) {
        const tc = t0 + i * 0.05;
        p = [p[0] + 1560 * 0.05, p[1], p[2]];
        const arrives = Math.max(tc + lat(tc - t0), last);
        last = arrives;
        h.send(pose(null, p, [1560, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: tc, dt: arrives - h.now });
      }
      expect(h.corrections.length, `${peak * 1000} ms over ${up} s, back over ${down} s: ${JSON.stringify(first(h))}`).toBe(0);
    }
  });
});

describe('a client whose stamps lag its arrival for good', () => {
  /** A ship in its world's frame flying at `speed` from 8 km (or `from`) on the far side of where the Waystation really
   * is, straight through it, its inputs stamped `lag` behind: how many it got accepted inside the Waystation's sphere, and
   * the first refusal. */
  function through(lag: number, speed: number, mode: 'ship' | 'pulse', from = 8000) {
    const t0 = 1e6;
    const where = (t: number, x: number) => {
      const P = systemPoses(D, t);
      const s = P.station.position as Vec3;
      return { local: worldToLocal(P.bodies[D.home]!, [s[0] + x, s[1], s[2]]) as Vec3, dir: dirToLocal(P.bodies[D.home]!, [-1, 0, 0]) as Vec3 };
    };
    const a = where(t0, from);
    const h = new Harness(D, { pose: pose(HOME, a.local, [0, 0, 0], noseTo(a.dir)), mode }, {}, { now: t0 });
    let inside = 0;
    for (let i = 1; i <= 2000; i++) {
      const tc = t0 + i * 0.05;
      const x = from - speed * i * 0.05;
      const p = where(tc, x);
      const r = h.send(pose(HOME, p.local, [p.dir[0] * speed, p.dir[1] * speed, p.dir[2] * speed], noseTo(p.dir)), mode, { at: tc - lag, dt: 0.05 });
      if (!r.ok) break;
      if (Math.abs(x) < D.station.soi) inside++;
      if (x < -6000) break;
    }
    return { inside, refused: first(h) };
  }

  it('is placed where the bodies really are: it gets no further into the real Waystation’s sphere than one stamping now', () => {
    const now = through(0, 600, 'ship');
    expect(now.refused).toMatchObject({ rule: 'frame' });
    for (const lag of [1, 2, 5, 10, 25])
      for (const [speed, mode, from] of [
        [600, 'ship', 8000],
        [300, 'pulse', 12000],
        [2000, 'pulse', 12000],
        [4000, 'pulse', 12000],
      ] as const) {
        const r = through(lag, speed, mode, from);
        expect(r.refused, `${lag} s behind, ${mode} at ${speed}`).toMatchObject({ rule: 'frame' });
        expect(r.inside, `${lag} s behind, ${mode} at ${speed}`).toBeLessThanOrEqual(6);
      }
  });
});

describe('re-syncing and silent bursts gain nothing', () => {
  it('a clock stepped forward every 10 s with the ship further on gains no distance', () => {
    for (const jump of [150, 200, 400, 1500]) {
      const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
      let p: Vec3 = [...OPEN];
      let lag = 2;
      let gained = 0;
      for (let i = 1; i <= 1200; i++) {
        const step = i % 200 === 0;
        p = [p[0] + 1560 * 0.05 + (step ? jump : 0), p[1], p[2]];
        if (step) lag = 0;
        const r = h.send(pose(null, p, [1560, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: h.now + 0.05 - lag });
        if (step) {
          if (r.ok) gained += jump;
          lag = 2;
        }
      }
      expect(gained, `${jump} m jumps`).toBe(0);
    }
  });

  it('a silence, then a burst of inputs each claiming more than an input’s worth', () => {
    for (const G of [2, 5, 10]) {
      const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
      let p: Vec3 = [...OPEN];
      let tc = h.now;
      for (let i = 0; i < 40; i++) {
        tc += 0.05;
        p = [p[0] + 1600 * 0.05, p[1], p[2]];
        h.send(pose(null, p, [1600, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: tc });
      }
      h.now += G;
      tc += G;
      let ok = 0;
      for (let n = 0; n < 40 && tc < h.now + 1; n++) {
        tc += 0.3;
        p = [p[0] + 1600 * 0.3, p[1], p[2]];
        if (h.send(pose(null, p, [1600, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: tc, dt: 1 / 60 }).ok) ok++;
        else break;
      }
      expect(ok, `silent ${G} s`).toBeLessThanOrEqual(1);
    }
  });
});

describe('a mover the server re-seats (an admin teleport)', () => {
  it('is judged from its new pose, and refuses inputs from its old trajectory quietly, as after a correction', () => {
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    let p: Vec3 = [...OPEN];
    for (let i = 0; i < 20; i++) {
      p = [p[0] + 500 * 0.05, p[1], p[2]];
      h.send(pose(null, p, [500, 0, 0], noseTo(X)), 'ship');
    }
    // teleported 100 km on, given the correction grace
    const at: Vec3 = [p[0] + 100_000, p[1], p[2]];
    const profile = h.a.remove(h.id)!;
    h.a.add(h.id, pose(null, at), 'ship', profile, h.now);
    h.a.graceFrom(h.id, h.now);
    // its inputs from before, still on their way: refused without a correction or a strike
    for (let i = 0; i < 3; i++) {
      p = [p[0] + 500 * 0.05, p[1], p[2]];
      expect(h.send(pose(null, p, [500, 0, 0], noseTo(X)), 'ship')).toEqual({ ok: false, correction: null, violation: null, kick: false });
    }
    // then from the teleport, accepted
    expect(h.send(pose(null, [at[0] + 25, at[1], at[2]], [500, 0, 0], noseTo(X)), 'ship').ok).toBe(true);
    expect(h.a.corrections).toBe(0);
    expect(h.a.recent).toEqual([]);
  });
});

describe('rules a mutation once survived', () => {
  it('no input carries more than a second of movement, whatever silence came before it', () => {
    for (const stamped of [true, false]) {
      const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
      let p: Vec3 = [...OPEN];
      for (let i = 0; i < 40; i++) {
        p = [p[0] + 1500 * 0.05, p[1], p[2]];
        h.send(pose(null, p, [1500, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: stamped ? undefined : 0 });
      }
      // 20 s without a word, then 20 s of boost in one input
      const r = h.send(pose(null, [p[0] + BOOST_ALLOWED * 19, p[1], p[2]], [1500, 0, 0], noseTo(X)), 'ship', {
        buttons: BOOST,
        dt: 20,
        at: stamped ? undefined : 0,
      });
      expect(r, stamped ? 'stamped' : 'no time').toMatchObject({ ok: false, violation: { rule: 'teleport' } });
    }
  });

  it('the input that steps a clock forward carries no movement of its own beyond the anti-teleport slack', () => {
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    let p: Vec3 = [...OPEN];
    for (let i = 0; i < 40; i++) {
      p = [p[0] + 1500 * 0.05, p[1], p[2]];
      h.send(pose(null, p, [1500, 0, 0], noseTo(X)), 'ship', { buttons: BOOST });
    }
    // its clock stands still a minute, then steps to the server's time with the ship a kilometre on
    const stopped = h.now;
    for (let i = 0; i < 1200; i++) h.send(pose(null, p, [0, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: stopped });
    const r = h.send(pose(null, [p[0] + 1000, p[1], p[2]], [1500, 0, 0], noseTo(X)), 'ship', { buttons: BOOST });
    expect(r).toMatchObject({ ok: false, violation: { rule: 'teleport' } });
    expect((r as MovementRefusal).violation!.allowed).toBeLessThan(BOOST_ALLOWED * (MOVEMENT.teleport.lagS + 0.01) + MOVEMENT.teleport.slackM);
  });

  it('a pose held for a ground never planned is refused within five seconds', () => {
    const g = groundOf(D, D.home)!;
    const up: Vec3 = [0, 0, -1];
    const r = D.bodies[D.home]!.radius + heightAt(g, up);
    const feet: Vec3 = [0, 0, -r];
    const h = new Harness(D, { pose: pose(HOME, feet), mode: 'foot' }, {}, { grounds: new GatedGrounds() });
    let at = -1;
    for (let i = 0; i < 6 * 20 && at < 0; i++) if (!h.send(pose(HOME, feet), 'foot').ok) at = i;
    expect(at).toBeGreaterThan(0);
    expect(at * 0.05).toBeLessThanOrEqual(5.05);
    expect(frameKeyOf(D, HOME)).toBe(D.home);
  });
});
