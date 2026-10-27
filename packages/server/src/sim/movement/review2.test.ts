// The P1.E03.T04 second review's reproductions, kept, and a test for each rule a mutation survived: a client's clock is
// credited with no more time than really passed (banking it by freezing the clock, lagging it and running it fast, or
// stepping it back are refused), a client that sends no time is judged and placed on its arrival, an honest client with
// any skew, step or jitter of its clock is never corrected, getting out, falling, walking back and boarding on any ground
// is never corrected either; and a pose judged while its world's ground is still being planned is held and judged again.
import { STATION_LAYOUT, WALKER } from '@astra/shared/data';
import { flightCaps, pulseClearance, pulseSpeedLimit, shipStats, SHIP_GEAR_HEIGHT, walkerCaps, walkerStats, WALKER_TOLERANCE } from '@astra/shared/ships';
import {
  chooseFrame,
  dirToLocal,
  dirToWorld,
  frameIdOf,
  frameKeyOf,
  localToWorld,
  systemPoses,
  worldToLocal,
  type FrameKey,
  type SystemPoses,
} from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../../zones/system.ts';
import { ClientClock, planGround, poseProblem, type MovementRefusal, type MovementVerdict } from './authority.ts';
import { MOVEMENT } from './rules.ts';
import { BOOST, GatedGrounds, Harness, lcg, LARK, noseTo, pose, standing } from './testing.ts';
import { groundOf, heightAt, type Quat, type Vec3 } from './world.ts';

const D = describeZoneSystem(0);
const STATION = frameIdOf(D.seed, 'station')!;
const HOME = frameIdOf(D.seed, D.home)!;
const OPEN: Vec3 = [0, 2e9, 0];
const lark = shipStats(LARK);
const BOOST_ALLOWED = flightCaps(lark, 'boost').allowed;
const SPACE_ALLOWED = flightCaps(lark, 'space').allowed;
const X: Vec3 = [1, 0, 0];
const first = (h: Harness) => (h.refusals[0] as MovementRefusal | undefined)?.violation;
const frameOf = (p: SystemPoses, k: FrameKey) => (k === null ? null : k === 'station' ? p.station : p.bodies[k]!);
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('the client’s clock as credited', () => {
  it('credits an honest clock exactly, places the bodies at it, and judges an input without one on its arrival', () => {
    const c = new ClientClock(100);
    expect(c.credit(100.04, 100.1)).toEqual({ t: 100.04, p: 100.04, timeless: false, resync: false, stale: false, gap: expect.closeTo(0.1, 9) });
    for (let i = 1; i <= 20; i++) expect(c.credit(100.04 + i * 0.05, 100.1 + i * 0.05).t).toBeCloseTo(100.04 + i * 0.05, 9);
    // no time: its arrival gap, placed at its arrival
    const t = c.credit(0, 101.5);
    expect(t).toMatchObject({ timeless: true, p: 101.5 });
    expect(t.t).toBeCloseTo(101.04 + 0.4, 9);
    // a first input far behind its arrival: credited as stamped, but placed no further behind than behindS (nothing owed)
    const lagged = new ClientClock(1000).credit(965, 1000.05);
    expect(lagged.t).toBe(965);
    expect(lagged.p).toBeCloseTo(1000.05 - MOVEMENT.time.behindS, 9);
  });

  it('never runs backwards, and never ahead of the arrival by more than aheadS', () => {
    const c = new ClientClock(0.001);
    c.credit(10, 10);
    // a clock stepped back half a second costs that one input's time, and runs on from there
    expect(c.credit(9.55, 10.05).t).toBe(10);
    expect(c.credit(9.6, 10.1).t).toBeCloseTo(10.05, 9);
    // a first input from the future is placed no further ahead than aheadS
    expect(new ClientClock(0.001).credit(5000, 10).t).toBe(10 + MOVEMENT.time.aheadS);
    // and a clock already that far ahead gains no more out of the bank
    const ahead = new ClientClock(0.001);
    ahead.credit(10.3, 10);
    for (let i = 1; i <= 10; i++) expect(ahead.credit(10.3 + i * 0.1, 10 + i * 0.05).t).toBeCloseTo(10.3 + i * 0.05, 9);
  });

  it('credits no more than the arrival gap and perInputS of a bank of bankS that only unclaimed real time refills', () => {
    const T = MOVEMENT.time;
    const c = new ClientClock(0.001);
    c.credit(10, 10);
    // frozen for 20 s: banks bankS, no more
    for (let i = 1; i <= 400; i++) c.credit(10, 10 + i * 0.05);
    // then claims twice the real time from there: perInputS an input until the bank is spent, then real time only
    let t = 10;
    let extra = 0;
    for (let i = 1; i <= 40; i++) {
      const next = c.credit(10 + i * 0.1, 30 + i * 0.05);
      expect(next.resync).toBe(false);
      extra += next.t - t - 0.05;
      t = next.t;
    }
    expect(extra).toBeCloseTo(T.bankS, 9);
  });

  it('re-syncs to a clock stepped forward past what it can be credited, with no credit for the step, once in resyncEveryS', () => {
    const T = MOVEMENT.time;
    const c = new ClientClock(0.001);
    c.credit(10, 10);
    // frozen for 20 s, then stepped to the server's time: not cashed in, the credited time follows it
    for (let i = 1; i <= 400; i++) c.credit(10, 10 + i * 0.05);
    expect(c.credit(30.3, 30.05)).toMatchObject({ t: 30.3, p: 30.3, resync: true });
    // honest from there
    expect(c.credit(30.35, 30.1)).toMatchObject({ t: expect.closeTo(30.35, 9), resync: false });
    // another step within resyncEveryS is held to the bank like any other claim
    const again = c.credit(33, 30.15);
    expect(again.resync).toBe(false);
    expect(again.t).toBeCloseTo(30.35 + 0.05 + T.perInputS, 9);
    // a client further behind its arrival than behindS is not re-synced: held to real time until it catches up
    const late = new ClientClock(0.001);
    late.credit(10, 10);
    late.credit(10, 14);
    expect(late.credit(12.5, 14.05)).toMatchObject({ resync: false, t: expect.closeTo(10 + 0.05 + T.perInputS, 9) });
    // a clock stepped forward in step with its arrival gap (a pause, no input meanwhile) is real time: credited
    const paused = new ClientClock(0.001);
    paused.credit(10, 10);
    expect(paused.credit(70, 70)).toMatchObject({ t: 70, resync: false });
  });

  it('lets real time a running clock left unclaimed be claimed back, at twice real time at most, within drainS', () => {
    const T = MOVEMENT.time;
    // honest: a 3 s stall, everything sent in it arriving at once
    const c = new ClientClock(0.001);
    c.credit(10, 10.05);
    for (let i = 1; i <= 60; i++) expect(c.credit(10 + i * 0.05, 13.05).t).toBeCloseTo(10 + i * 0.05, 9);
    // a 5 s silence, then stamps from where they stopped running at twice real time, arriving at the usual pace: claimed
    // back at no more than twice real time (and perInputS more while the bank lasts), and never ahead of real time
    const s = new ClientClock(0.001);
    s.credit(10, 10.05);
    let t = 10;
    for (let i = 1; i <= 100; i++) {
      const next = s.credit(10 + i * 0.1, 15.05 + i * 0.05);
      if (i > 1) expect(next.t - t).toBeLessThanOrEqual(0.05 + T.drainInputS + T.perInputS + 1e-9);
      t = next.t;
    }
    expect(t - 10).toBeLessThanOrEqual(15.05 + 100 * 0.05 - 10.05 + T.bankS + 1e-9);
    // owed for drainS only: a silence left unclaimed for longer is not claimed back
    const old = new ClientClock(0.001);
    old.credit(10, 10.05);
    old.credit(10.05, 15.1);
    expect(old.owed).toBeCloseTo(5, 6);
    let now = 15.1;
    let stamp = 10.05;
    for (let i = 0; i < (T.drainS + 1) * 20; i++) old.credit((stamp += 0.05), (now += 0.05));
    expect(old.owed).toBe(0);
    const before = old.credit((stamp += 0.05), (now += 0.05)).t;
    let after = before;
    for (let i = 0; i < 40; i++) after = old.credit((stamp += 0.1), (now += 0.05)).t;
    expect(after - before - 40 * 0.05).toBeLessThanOrEqual(T.bankS + 1e-9);
    // a clock standing still while time passes is owed nothing; one running slow is owed what it leaves
    const frozen = new ClientClock(0.001);
    frozen.credit(10, 10);
    for (let i = 1; i <= 100; i++) frozen.credit(10, 10 + i * 0.05);
    expect(frozen.owed).toBe(0);
    const slow = new ClientClock(0.001);
    slow.credit(10, 10);
    for (let i = 1; i <= 100; i++) slow.credit(10 + i * 0.025, 10 + i * 0.05);
    expect(slow.owed).toBeCloseTo(2.5, 6);
  });
});

describe('a clock that banks time or runs fast gains nothing', () => {
  /** where each harness's ship has flown to */
  const flown = new Map<Harness, Vec3>();

  /** In open space: a ship that flies on at `speed` m/s, its client stamping `stamp(i, now)` for input i (arriving at
   * `now`). Returns the first input refused, or -1. */
  function run(h: Harness, n: number, speed: number, stamp: (i: number, now: number) => number): number {
    let p = flown.get(h) ?? OPEN;
    let firstAt = -1;
    for (let i = 0; i < n; i++) {
      p = [p[0] + speed * 0.05, p[1], p[2]];
      const r = h.send(pose(null, p, [Math.min(speed, 1560), 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: stamp(i, h.now + 0.05) });
      if (!r.ok && firstAt < 0) firstAt = i;
    }
    flown.set(h, p);
    return firstAt;
  }

  it('a clock jumped ahead once and the jump spent at once', () => {
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    let p: Vec3 = [...OPEN];
    for (let i = 0; i < 200; i++) {
      p = [p[0] + 1560 * 0.05, p[1], p[2]];
      h.send(pose(null, p, [1560, 0, 0], noseTo(X)), 'ship', { buttons: BOOST });
    }
    p = [p[0] + 1700 * 0.4, p[1], p[2]];
    expect(h.send(pose(null, p, [1560, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: h.now + 0.05 + 0.3 }).ok).toBe(false);
  });

  it('a clock lagged 30 s, then run fast to spend the lag, refused within two seconds', () => {
    for (const rate of [0.3, 0.38, 0.45]) {
      const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
      let lag = 30;
      const at = run(h, 400, BOOST_ALLOWED * (1 + rate) * 0.97, (i, now) => {
        const t = now - lag;
        lag = Math.max(-0.3, lag - rate * 0.05);
        return t;
      });
      expect(at, `run at ${1 + rate}x`).toBeGreaterThanOrEqual(0);
      expect(at * 0.05, `run at ${1 + rate}x`).toBeLessThan(2);
    }
    // honest for 2 s at the lag first
    for (const rate of [0.3, 0.38]) {
      const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
      run(h, 40, 1500, (i, now) => now - 30);
      expect(h.refusals).toEqual([]);
      let lag = 30;
      const at = run(h, 400, BOOST_ALLOWED * (1 + rate) * 0.97, (i, now) => now - (lag = Math.max(-0.3, lag - rate * 0.05)));
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at * 0.05).toBeLessThan(2.5);
    }
  });

  it('a clock frozen while standing still, then spent in one input, or over many', () => {
    // one input as far as the idle time at the boost cap would take it
    for (const idle of [5, 15, 29]) {
      const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
      const t0 = h.now;
      for (let i = 0; i < idle * 20; i++) h.send(pose(null, OPEN), 'ship', { at: t0 });
      const r = h.send(pose(null, [OPEN[0] + BOOST_ALLOWED * idle * 0.98, OPEN[1], OPEN[2]], [1560, 0, 0], noseTo(X)), 'ship', {
        buttons: BOOST,
        at: h.now + 0.05 + 0.25,
      });
      expect(h.refusals.length, `idle ${idle} s`).toBe(1);
      expect(r.ok).toBe(false);
    }
    // 31 s, then 1.34 times the boost allowance on a clock run 1.38 times as fast
    const c = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const t0 = c.now;
    for (let i = 0; i < 31 * 20; i++) c.send(pose(null, OPEN), 'ship', { at: t0 });
    let lag = c.now - t0;
    const at = run(c, 400, BOOST_ALLOWED * 1.38 * 0.97, (i, now) => now - (lag = Math.max(-0.3, lag - 0.38 * 0.05)));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at * 0.05).toBeLessThan(2);
    // 5 s, then 2 s of claimed flight arriving within 0.2 s: no more than the bank of it accepted
    const d = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const t1 = d.now;
    for (let i = 0; i < 100; i++) d.send(pose(null, OPEN), 'ship', { at: t1 });
    let p: Vec3 = [...OPEN];
    let ok = 0;
    for (let i = 1; i <= 40; i++) {
      p = [p[0] + 1750 * 0.05, p[1], p[2]];
      if (d.send(pose(null, p, [1560, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: t1 + i * 0.05, dt: 0.005 }).ok) ok++;
    }
    expect(ok * 0.05).toBeLessThanOrEqual(0.2 + MOVEMENT.time.bankS + 0.1);
  });

  it('docked with a frozen clock, then out of the hangar in one input', () => {
    const at: Vec3 = [STATION_LAYOUT.pads[0]!.x, STATION_LAYOUT.padTop + SHIP_GEAR_HEIGHT, STATION_LAYOUT.pads[0]!.z];
    const h = new Harness(D, { pose: pose(STATION, at, [0, 0, 0], [0, 1, 0, 0]), mode: 'docked' });
    const t0 = h.now;
    for (let i = 0; i < 400; i++) h.send(pose(STATION, at, [0, 0, 0], [0, 1, 0, 0]), 'docked', { at: t0 });
    expect(h.send(pose(STATION, [at[0], 14, at[2]]), 'ship', { buttons: BOOST, at: t0 + 0.05 }).ok).toBe(true);
    expect(h.send(pose(STATION, [0, 600, 4000]), 'ship', { buttons: BOOST, at: h.now + 0.3 })).toMatchObject({ ok: false, violation: { rule: 'teleport' } });
  });

  it('a walker standing with a frozen clock, then 300 m across the ground in one input', () => {
    const g = groundOf(D, D.home)!;
    const R = D.bodies[D.home]!.radius;
    const on = (p: Vec3, above = 0): Vec3 => {
      const d = norm(p);
      const r = R + heightAt(g, d) + above;
      return [d[0] * r, d[1] * r, d[2] * r];
    };
    const ship = on([0, 0, -1], SHIP_GEAR_HEIGHT);
    const h = new Harness(D, { pose: pose(HOME, ship), mode: 'landed' });
    expect(h.send(pose(HOME, on([ship[0] - 11, ship[1], ship[2] - 3], 0.3)), 'foot').ok).toBe(true);
    const stand = on([ship[0] - 11, ship[1], ship[2] - 3]);
    const t0 = h.now;
    for (let i = 0; i < 29 * 20; i++) h.send(pose(HOME, stand), 'foot', { at: t0 });
    expect(h.send(pose(HOME, on([stand[0] + 300, stand[1], stand[2]])), 'foot', { at: h.now + 0.3 }).ok).toBe(false);
  });

  it('a silence spent afterwards: at no more than twice real time, and no more of it than there was', () => {
    // 5 s without a word, then 2.5 times the boost allowance on a clock running 2.5 times as fast from where it stopped
    const fast = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    run(fast, 20, 600, (i, now) => now);
    const t0 = fast.now;
    fast.now += 5;
    const quick = run(fast, 200, BOOST_ALLOWED * 2.5, (i) => t0 + (i + 1) * 0.125);
    expect(quick).toBeGreaterThanOrEqual(0);
    expect(quick * 0.05).toBeLessThan(1.5);
    // at 1.9 times: claimed back while the silence lasts, then held to real time
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    run(h, 20, 600, (i, now) => now);
    const t = h.now;
    h.now += 5;
    const at = run(h, 400, BOOST_ALLOWED * 1.9, (i) => t + (i + 1) * 0.095);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at * 0.05).toBeLessThan(5 / 0.9 + 1.5);
  });

  it('a stamp stepped back to bank the time it skips, then spent', () => {
    // (never backwards: the step back credits nothing, so there is nothing to spend)
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    run(h, 20, 1500, (i, now) => now);
    h.send(pose(null, [OPEN[0] + 1500, OPEN[1], OPEN[2]]), 'ship', { buttons: BOOST, at: h.now + 0.05 - 5 });
    const r = h.send(pose(null, [OPEN[0] + 1500 + BOOST_ALLOWED * 5, OPEN[1], OPEN[2]], [1560, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: h.now + 0.05 });
    expect(r).toMatchObject({ ok: false, violation: { rule: 'teleport' } });
  });

  it('a clock at the ahead bound gains nothing more from the bank', () => {
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const v = SPACE_ALLOWED * 0.97;
    let p: Vec3 = [...OPEN];
    for (let i = 0; i < 40; i++) {
      p = [p[0] + v * 0.05, p[1], p[2]];
      h.send(pose(null, p, [600, 0, 0], noseTo(X)), 'ship', { at: h.now + 0.05 + MOVEMENT.time.aheadS });
    }
    expect(h.refusals).toEqual([]);
    // then a further 0.1 s claimed for every 0.05 s, flying twice as far
    const base = h.now;
    for (let i = 1; i <= 9; i++) {
      p = [p[0] + v * 0.1, p[1], p[2]];
      h.send(pose(null, p, [600, 0, 0], noseTo(X)), 'ship', { at: base + MOVEMENT.time.aheadS + i * 0.1 });
    }
    expect(first(h)).toMatchObject({ rule: 'speed' });
  });
});

describe('a client whose frame loop paused for a minute (a hidden tab), its clock stepped forward on its return', () => {
  /** Boosting along +x at `v` for 5 s, stamped honestly; then nothing for `pause` s, the ship where it was (its frame loop
   * stood still). Returns where it is and the client time it stopped at. */
  function beforePause(h: Harness, v: number, pause: number): { p: Vec3; stopped: number } {
    let p: Vec3 = [...OPEN];
    for (let i = 0; i < 100; i++) {
      p = [p[0] + v * 0.05, p[1], p[2]];
      h.send(pose(null, p, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST });
    }
    const stopped = h.now;
    h.now += pause;
    return { p, stopped };
  }
  const FRAME = 0.066;

  it('stepped with its first input back: no correction for honest motion, no credit for a teleport', () => {
    const v = 1500;
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    let { p } = beforePause(h, v, 60);
    // one clamped frame on, stamped at the server's time; then on as before
    for (let i = 0; i < 200; i++) {
      p = [p[0] + v * (i === 0 ? FRAME : 0.05), p[1], p[2]];
      h.send(pose(null, p, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST });
    }
    expect(h.refusals, JSON.stringify(first(h))).toEqual([]);
    // a minute's boost in that first input
    const t = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const at = beforePause(t, v, 60).p;
    expect(t.send(pose(null, [at[0] + BOOST_ALLOWED * 60, at[1], at[2]], [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST })).toMatchObject({
      ok: false,
      violation: { rule: 'teleport' },
    });
  });

  it('back first on its stopped clock, then stepped: no correction for honest motion, no credit for a teleport', () => {
    const v = 1500;
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const paused = beforePause(h, v, 60);
    let p: Vec3 = [paused.p[0] + v * FRAME, paused.p[1], paused.p[2]];
    expect(h.send(pose(null, p, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: paused.stopped + FRAME }).ok).toBe(true);
    for (let i = 0; i < 200; i++) {
      p = [p[0] + v * 0.05, p[1], p[2]];
      h.send(pose(null, p, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST });
    }
    expect(h.refusals, JSON.stringify(first(h))).toEqual([]);
    // the step's minute spent in the input that steps
    const t = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const back = beforePause(t, v, 60);
    const q: Vec3 = [back.p[0] + v * FRAME, back.p[1], back.p[2]];
    t.send(pose(null, q, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: back.stopped + FRAME });
    expect(t.send(pose(null, [q[0] + BOOST_ALLOWED * 60, q[1], q[2]], [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST })).toMatchObject({
      ok: false,
      violation: { rule: 'teleport' },
    });
    // or spread over the inputs after it: the window starts afresh at the step
    const s = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const b2 = beforePause(s, v, 60);
    let r: Vec3 = [b2.p[0] + v * FRAME, b2.p[1], b2.p[2]];
    s.send(pose(null, r, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: b2.stopped + FRAME });
    let refusedAt = -1;
    for (let i = 0; i < 40 && refusedAt < 0; i++) {
      r = [r[0] + BOOST_ALLOWED * 2 * 0.05, r[1], r[2]];
      if (!s.send(pose(null, r, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST }).ok) refusedAt = i;
    }
    expect(first(s)).toMatchObject({ rule: 'speed' });
    expect(refusedAt).toBeLessThan(5);
  });

  it('back on its stopped clock and catching up at twice real time (no step): held to real time, never corrected', () => {
    const v = 1500;
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    const back = beforePause(h, v, 20);
    let p = back.p;
    let stamp = back.stopped;
    for (let i = 0; i < 600; i++) {
      p = [p[0] + v * 0.05, p[1], p[2]];
      stamp = Math.min(stamp + 0.1, h.now + 0.05);
      h.send(pose(null, p, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: stamp });
    }
    expect(h.refusals, JSON.stringify(first(h))).toEqual([]);
  });

  it('stepping its clock again and again to start a fresh window each time gains nothing', () => {
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    let p: Vec3 = [...OPEN];
    let stamp = h.now;
    let at = -1;
    for (let i = 0; i < 100 && at < 0; i++) {
      p = [p[0] + BOOST_ALLOWED * 2 * 0.05, p[1], p[2]];
      stamp += 2;
      if (!h.send(pose(null, p, [1560, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: Math.min(stamp, h.now + 0.05 + 0.3) }).ok) at = i;
    }
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at * 0.05).toBeLessThan(MOVEMENT.time.resyncEveryS);
  });

  it('with no time at all: a minute’s teleport in one input is refused too', () => {
    const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
    let p: Vec3 = [...OPEN];
    for (let i = 0; i < 100; i++) {
      p = [p[0] + 1500 * 0.05, p[1], p[2]];
      h.send(pose(null, p, [1500, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: 0 });
    }
    expect(h.send(pose(null, [p[0] + 1500 * FRAME, p[1], p[2]], [1500, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: 0, dt: 60 }).ok).toBe(true);
    expect(h.send(pose(null, [p[0] + BOOST_ALLOWED * 60, p[1], p[2]], [1500, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, at: 0, dt: 60 })).toMatchObject({
      ok: false,
      violation: { rule: 'teleport' },
    });
  });
});

describe('a client that sends no time', () => {
  it('is judged and placed on its arrival: in and out of the Waystation’s sphere it is never corrected, and it is logged once', () => {
    for (const sys of [0, 2])
      for (const stamped of [true, false])
        for (const leg of ['out', 'in'] as const) {
          const d = describeZoneSystem(sys);
          const t0 = 1e6;
          let key: FrameKey = leg === 'out' ? 'station' : d.home;
          let local: Vec3;
          let dir: Vec3;
          if (leg === 'out') {
            local = [0, 300, 3000];
            dir = [0, 0.1, 0.995];
          } else {
            const P = systemPoses(d, t0);
            const st = P.station.position as Vec3;
            local = worldToLocal(frameOf(P, d.home), [st[0], st[1] + 6000, st[2]]) as Vec3;
            dir = dirToLocal(frameOf(P, d.home), [0, -1, 0]) as Vec3;
          }
          const h = new Harness(d, { pose: pose(frameIdOf(d.seed, key), local), mode: 'ship' }, {}, { now: t0 });
          for (let i = 1; i <= 200; i++) {
            const tc = t0 + i * 0.05;
            local = [local[0] + dir[0] * 25, local[1] + dir[1] * 25, local[2] + dir[2] * 25];
            const P = systemPoses(d, tc);
            const w = localToWorld(frameOf(P, key), local) as Vec3;
            const next = chooseFrame(d, P, w, key) as FrameKey;
            if (next !== key) {
              dir = dirToLocal(frameOf(P, next), dirToWorld(frameOf(P, key), dir)) as Vec3;
              local = worldToLocal(frameOf(P, next), w) as Vec3;
              key = next;
            }
            h.send(pose(frameIdOf(d.seed, key), [...local], [dir[0] * 500, dir[1] * 500, dir[2] * 500], noseTo(dir)), 'ship', {
              dt: tc + 0.05 - h.now,
              at: stamped ? tc : 0,
            });
            if (leg === 'in' && key === 'station' && Math.hypot(...local) < 1500) break;
          }
          expect(h.corrections.length, `system ${sys} ${stamped ? 'stamped' : 'no time'} ${leg}: ${JSON.stringify(first(h))}`).toBe(0);
          expect(h.lines.filter((l) => l.msg.includes('sends no time')).length).toBe(stamped ? 0 : 1);
        }
  });

  it('obeying its corrections, leaves the Waystation’s sphere for its world’s frame and is never kicked', () => {
    const t0 = 1e6;
    let key: FrameKey = 'station';
    let local: Vec3 = [0, 300, 3000];
    let dir: Vec3 = [0, 0.1, 0.995];
    const h = new Harness(D, { pose: pose(STATION, local), mode: 'ship' }, {}, { now: t0 });
    let kicked = false;
    for (let i = 1; i <= 1200 && !kicked; i++) {
      const tc = t0 + i * 0.05;
      local = [local[0] + dir[0] * 25, local[1] + dir[1] * 25, local[2] + dir[2] * 25];
      const P = systemPoses(D, tc);
      const w = localToWorld(frameOf(P, key), local) as Vec3;
      const next = chooseFrame(D, P, w, key) as FrameKey;
      if (next !== key) {
        dir = dirToLocal(frameOf(P, next), dirToWorld(frameOf(P, key), dir)) as Vec3;
        local = worldToLocal(frameOf(P, next), w) as Vec3;
        key = next;
      }
      const r = h.send(pose(frameIdOf(D.seed, key), [...local], [dir[0] * 500, dir[1] * 500, dir[2] * 500], noseTo(dir)), 'ship', { at: 0 });
      if (!r.ok && r.correction) {
        const wd = dirToWorld(frameOf(P, key), dir);
        key = frameKeyOf(D, r.correction.pose.frame)!;
        local = [...r.correction.pose.pos];
        dir = dirToLocal(frameOf(P, key), wd) as Vec3;
        kicked = r.kick;
      }
    }
    expect(h.corrections.length, JSON.stringify(first(h))).toBe(0);
    expect(key).toBe(D.station.parent);
  });

  it('at a steady latency, on the engines, boosting or on the pulse drive, is never corrected (jitter is not cancelled for it)', () => {
    for (const mode of ['space', 'boost', 'pulse'] as const) {
      const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
      let p: Vec3 = [...OPEN];
      const t0 = h.now;
      for (let i = 1; i <= 600; i++) {
        const sent = t0 + i * 0.05;
        const speed = mode === 'pulse' ? pulseSpeedLimit(lark, pulseClearance(D, systemPoses(D, sent), p, X).min) : mode === 'boost' ? 1560 : 600;
        p = [p[0] + speed * 0.05, p[1], p[2]];
        h.send(pose(null, p, [speed, 0, 0], noseTo(X)), mode === 'pulse' ? 'pulse' : 'ship', {
          dt: sent + 0.08 - h.now,
          at: 0,
          buttons: mode === 'boost' ? BOOST : 0,
        });
      }
      expect(h.refusals.length, `${mode}: ${JSON.stringify(first(h))}`).toBe(0);
    }
  });
});

describe('an honest clock is never corrected', () => {
  it('stepped back or forward by its sync, mid-boost', () => {
    for (const step of [-0.05, -0.1, -0.2, -0.5, 0.2, 0.5])
      for (const v of [1560, 1400]) {
        const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
        let p: Vec3 = [...OPEN];
        let off = 0;
        const t0 = h.now;
        for (let i = 1; i <= 200; i++) {
          if (i === 100) off = step;
          const tc = t0 + i * 0.05;
          p = [p[0] + v * 0.05, p[1], p[2]];
          h.send(pose(null, p, [v, 0, 0], noseTo(X)), 'ship', { buttons: BOOST, dt: tc + 0.08 - h.now, at: tc + off });
        }
        expect(h.corrections.length, `step ${step} at ${v}: ${JSON.stringify(first(h))}`).toBe(0);
      }
  });

  it('off by a constant, crossing the Waystation’s sphere and its world’s, with its bodies where its own clock has them', () => {
    function cross(start: { key: FrameKey; local: Vec3; dir: Vec3 }, speed: number, skew: number, latency: number): Harness {
      const t0 = 1e6;
      let { key, local, dir } = start;
      const h = new Harness(D, { pose: pose(frameIdOf(D.seed, key), local), mode: 'ship' }, {}, { now: t0 });
      for (let i = 1; i <= 200; i++) {
        const tc = t0 + i * 0.05;
        local = [local[0] + dir[0] * speed * 0.05, local[1] + dir[1] * speed * 0.05, local[2] + dir[2] * speed * 0.05];
        // (a client places the bodies by its own estimate of server time)
        const P = systemPoses(D, tc + skew);
        const w = localToWorld(frameOf(P, key), local) as Vec3;
        const next = chooseFrame(D, P, w, key) as FrameKey;
        if (next !== key) {
          dir = dirToLocal(frameOf(P, next), dirToWorld(frameOf(P, key), dir)) as Vec3;
          local = worldToLocal(frameOf(P, next), w) as Vec3;
          key = next;
        }
        h.send(pose(frameIdOf(D.seed, key), [...local], [dir[0] * speed, dir[1] * speed, dir[2] * speed], noseTo(dir)), 'ship', {
          dt: tc + latency - h.now,
          at: tc + skew,
        });
      }
      return h;
    }
    const c = systemPoses(D, 1e6).bodies[D.home]!.position as Vec3;
    const soi = D.bodies[D.home]!.soi;
    for (const latency of [0.08, 0.4])
      for (const skew of [-0.3, -0.15, -0.05, 0.05, 0.15, 0.25]) {
        const out = cross({ key: 'station', local: [0, 300, 3000], dir: [0, 0.1, 0.995] }, 500, skew, latency);
        const inward = cross({ key: null, local: [c[0], c[1] + soi + 3000, c[2]], dir: [0, -1, 0] }, 600, skew, latency);
        const what = `skew ${skew}, latency ${latency}`;
        expect(out.corrections.length, `${what}, out: ${JSON.stringify(first(out))}`).toBe(0);
        expect(inward.corrections.length, `${what}, in: ${JSON.stringify(first(inward))}`).toBe(0);
      }
  });

  it('ahead or behind and wandering, under jitter and stalls, boosting and on the pulse drive', { timeout: 60_000 }, () => {
    const runs: [string, (s: number) => number, (t: number) => number][] = [];
    const jitter = (r: () => number) => () => 0.05 + r() * 0.35;
    for (const stamp of [(s: number) => s + 0.15, (s: number) => s - 0.2 + 0.05 * Math.sin(s / 10)]) {
      runs.push(['jitter 50-400 ms', stamp, jitter(lcg(7))]);
      runs.push(['sine 50-350 ms', stamp, (t) => 0.2 + 0.15 * Math.sin((2 * Math.PI * t) / 4)]);
      runs.push([
        'a 3 s stall every 10 s',
        stamp,
        (t) => {
          const k = t % 10;
          return k > 5 && k < 8 ? 8 - k + 0.05 : 0.05;
        },
      ]);
    }
    for (const mode of ['boost', 'pulse'] as const)
      for (const [label, stamp, delay] of runs) {
        const h = new Harness(D, { pose: pose(null, OPEN), mode: 'ship' });
        let p: Vec3 = [...OPEN];
        const t0 = h.now;
        let last = t0;
        for (let i = 1; i <= 1200; i++) {
          const sent = t0 + i * 0.05;
          const speed = mode === 'pulse' ? pulseSpeedLimit(lark, pulseClearance(D, systemPoses(D, sent), p, X).min) : 1560;
          p = [p[0] + speed * 0.05, p[1], p[2]];
          const arrives = Math.max(sent + delay(sent - t0), last);
          last = arrives;
          h.send(pose(null, p, [speed, 0, 0], noseTo(X)), mode === 'pulse' ? 'pulse' : 'ship', {
            dt: arrives - h.now,
            buttons: mode === 'boost' ? BOOST : 0,
            at: stamp(sent),
          });
        }
        expect(h.corrections.length, `${mode}, ${label}: ${JSON.stringify(first(h))}`).toBe(0);
      }
  });
});

describe('getting out, falling, walking back and boarding', () => {
  it('on any dry ground, the ship levelled as the client lands it, is never corrected', { timeout: 60_000 }, () => {
    const rnd = lcg(3);
    const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let landings = 0;
    for (const sys of [0, 1, 2]) {
      const d = describeZoneSystem(sys);
      d.bodies.forEach((b, bi) => {
        if (b.type === 'gas') return;
        const g = groundOf(d, bi)!;
        const F = frameIdOf(d.seed, bi);
        const surf = (u: Vec3) => b.radius + heightAt(g, u);
        const grav = b.gravity || 9;
        for (let k = 0; k < 12; k++) {
          const up = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
          const hgt = heightAt(g, up);
          if (g.ocean && hgt < 0.5) continue;
          landings++;
          const groundR = b.radius + (g.ocean ? Math.max(hgt, 0) : hgt);
          const ship: Vec3 = [up[0] * (groundR + 1.95), up[1] * (groundR + 1.95), up[2] * (groundR + 1.95)];
          // the ship's up: the ground's normal, lerped 0.4 toward the radial (the client's landing)
          const t1 = norm(cross3(up, Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
          const t2 = cross3(up, t1);
          const e = 2 / b.radius;
          const at = (v: Vec3): Vec3 => {
            const n = norm(v);
            const r = surf(n);
            return [n[0] * r, n[1] * r, n[2] * r];
          };
          const off = (s: number, t: Vec3) => at([up[0] + t[0] * e * s, up[1] + t[1] * e * s, up[2] + t[2] * e * s]);
          const da = off(1, t1).map((x, i) => x - off(-1, t1)[i]!) as Vec3;
          const db = off(1, t2).map((x, i) => x - off(-1, t2)[i]!) as Vec3;
          let n = norm(cross3(da, db));
          if (dot(n, up) < 0) n = [-n[0], -n[1], -n[2]];
          const sUp = norm([n[0] + (up[0] - n[0]) * 0.4, n[1] + (up[1] - n[1]) * 0.4, n[2] + (up[2] - n[2]) * 0.4]);
          const a = rnd() * Math.PI * 2;
          let fwd: Vec3 = [t1[0] * Math.cos(a) + t2[0] * Math.sin(a), t1[1] * Math.cos(a) + t2[1] * Math.sin(a), t1[2] * Math.cos(a) + t2[2] * Math.sin(a)];
          fwd = norm([fwd[0] - sUp[0] * dot(fwd, sUp), fwd[1] - sUp[1] * dot(fwd, sUp), fwd[2] - sUp[2] * dot(fwd, sUp)]);
          const q: Quat = standing(sUp, fwd);
          const h = new Harness(d, { pose: pose(F, ship, [0, 0, 0], q), mode: 'landed' });
          h.send(pose(F, ship, [0, 0, 0], q), 'landed');
          // out where Game.exitShip sets it down, falling onto the ground there
          const left = norm([fwd[1] * sUp[2] - fwd[2] * sUp[1], fwd[2] * sUp[0] - fwd[0] * sUp[2], fwd[0] * sUp[1] - fwd[1] * sUp[0]]).map((x) => -x) as Vec3;
          const ex = norm([ship[0] + left[0] * 11 + fwd[0] * 3, ship[1] + left[1] * 11 + fwd[1] * 3, ship[2] + left[2] * 11 + fwd[2] * 3]);
          let r = surf(ex) + 0.3;
          let vUp = 0;
          h.send(pose(F, [ex[0] * r, ex[1] * r, ex[2] * r]), 'foot');
          for (let i = 0; i < 20; i++) {
            for (let j = 0; j < 3; j++) {
              vUp -= grav / 60;
              r += vUp / 60;
              if (r <= surf(ex)) {
                r = surf(ex);
                vUp = 0;
              }
            }
            h.send(pose(F, [ex[0] * r, ex[1] * r, ex[2] * r]), 'foot');
          }
          // back to the ship with the client's walker, and aboard when it offers it (within 9 m)
          let pos: Vec3 = [ex[0] * r, ex[1] * r, ex[2] * r];
          let vel: Vec3 = [0, 0, 0];
          let grounded = true;
          for (let s = 1; s < 60 * 15; s++) {
            const u = norm(pos);
            let to: Vec3 = [ship[0] - pos[0], ship[1] - pos[1], ship[2] - pos[2]];
            to = [to[0] - u[0] * dot(to, u), to[1] - u[1] * dot(to, u), to[2] - u[2] * dot(to, u)];
            const hd = norm(to);
            const vu = dot(vel, u);
            let horiz: Vec3 = [vel[0] - u[0] * vu, vel[1] - u[1] * vu, vel[2] - u[2] * vu];
            const f = 1 - Math.exp(-(grounded ? 14 : 2.2) / 60);
            horiz = [horiz[0] + (hd[0] * 5.2 - horiz[0]) * f, horiz[1] + (hd[1] * 5.2 - horiz[1]) * f, horiz[2] + (hd[2] * 5.2 - horiz[2]) * f];
            const nu = vu - grav / 60;
            vel = [horiz[0] + u[0] * nu, horiz[1] + u[1] * nu, horiz[2] + u[2] * nu];
            pos = [pos[0] + vel[0] / 60, pos[1] + vel[1] / 60, pos[2] + vel[2] / 60];
            grounded = false;
            const d2 = norm(pos);
            const gr = surf(d2);
            if (Math.hypot(...pos) <= gr + 0.02) {
              pos = [d2[0] * gr, d2[1] * gr, d2[2] * gr];
              const vin = dot(vel, d2);
              if (vin < 0) vel = [vel[0] - d2[0] * vin, vel[1] - d2[1] * vin, vel[2] - d2[2] * vin];
              grounded = true;
            }
            if (s % 3 === 0) {
              h.send(pose(F, [...pos]), 'foot');
              if (Math.hypot(pos[0] - ship[0], pos[1] - ship[1], pos[2] - ship[2]) < 8.5) {
                h.send(pose(F, ship, [0, 0, 0], q), 'landed');
                break;
              }
            }
          }
          expect(h.refusals.length, `system ${sys} body ${bi}: ${JSON.stringify(first(h))}`).toBe(0);
        }
      });
    }
    expect(landings).toBeGreaterThan(100);
  });
});

describe('rules a mutation once survived', () => {
  const g = groundOf(D, D.home)!;
  const R = D.bodies[D.home]!.radius;
  /** A point `s` metres along tangent `t` from `up` on the home world, `above` metres over its ground. */
  const along = (up: Vec3, t: Vec3, s: number, above: number): Vec3 => {
    const d = norm([up[0] + (t[0] * s) / R, up[1] + (t[1] * s) / R, up[2] + (t[2] * s) / R]);
    const r = R + heightAt(g, d) + above;
    return [d[0] * r, d[1] * r, d[2] * r];
  };
  const tangent = (u: Vec3, k: number): Vec3 => {
    const t: Vec3 = [u[1], -u[0], 0.3 * Math.sin(k)];
    const d = t[0] * u[0] + t[1] * u[1] + t[2] * u[2];
    return norm([t[0] - u[0] * d, t[1] - u[1] * d, t[2] - u[2] * d]);
  };

  it('a change of frame allows the frames’ drift over its step and no more', () => {
    const t0 = 1e6;
    let key: FrameKey = 'station';
    let local: Vec3 = [0, 300, 3000];
    let dir: Vec3 = [0, 0.1, 0.995];
    const h = new Harness(D, { pose: pose(STATION, local), mode: 'ship' }, {}, { now: t0 });
    let crossing: MovementVerdict | null = null;
    for (let i = 1; i <= 200 && !crossing; i++) {
      const tc = t0 + i * 0.05;
      local = [local[0] + dir[0] * 25, local[1] + dir[1] * 25, local[2] + dir[2] * 25];
      const P = systemPoses(D, tc);
      const w = localToWorld(frameOf(P, key), local) as Vec3;
      const next = chooseFrame(D, P, w, key) as FrameKey;
      let extra = 0;
      if (next !== key) {
        dir = dirToLocal(frameOf(P, next), dirToWorld(frameOf(P, key), dir)) as Vec3;
        local = worldToLocal(frameOf(P, next), w) as Vec3;
        key = next;
        // the frames drift apart at ~780 m/s here: ~47 m over the step, with its fifth to spare; a kilometre more is not theirs
        extra = 1000;
      }
      const p: Vec3 = [local[0] + dir[0] * extra, local[1] + dir[1] * extra, local[2] + dir[2] * extra];
      const r = h.send(pose(frameIdOf(D.seed, key), p, [dir[0] * 500, dir[1] * 500, dir[2] * 500], noseTo(dir)), 'ship', { at: tc, dt: tc + 0.05 - h.now });
      if (extra) crossing = r;
      else expect(r.ok, JSON.stringify(first(h))).toBe(true);
    }
    expect(crossing).toMatchObject({ ok: false, violation: { rule: 'teleport' } });
  });

  it('a ship coming to rest settles by settleM in no time, and slides no further', () => {
    // dry, flat ground (a city's levelled plain or a site's pad)
    let up: Vec3 | null = null;
    let tan: Vec3 = [1, 0, 0];
    for (let k = 0; k < 20000 && !up; k++) {
      const u = norm([Math.sin(k * 1.37), Math.cos(k * 0.71), Math.sin(k * 2.13 + 0.5)]);
      const t = tangent(u, k);
      const h0 = heightAt(g, u);
      if (h0 < 2) continue;
      let flat = true;
      for (let s = 5; s <= 60 && flat; s += 5)
        if (Math.abs(heightAt(g, norm([u[0] + (t[0] * s) / R, u[1] + (t[1] * s) / R, u[2] + (t[2] * s) / R])) - h0) > 0.3) flat = false;
      if (flat) {
        up = u;
        tan = t;
      }
    }
    expect(up).not.toBeNull();
    const q = standing(up!, tan);
    // hovering, then touching down 50 m along in an input that claims no time since the last
    const slide = new Harness(D, { pose: pose(HOME, along(up!, tan, 0, 5), [0, 0, 0], q), mode: 'ship' });
    for (let i = 0; i < 30; i++) slide.send(pose(HOME, along(up!, tan, 0, 5), [0, 0, 0], q), 'ship');
    expect(slide.send(pose(HOME, along(up!, tan, 50, SHIP_GEAR_HEIGHT), [0, 0, 0], q), 'landed', { at: slide.now })).toMatchObject({
      ok: false,
      violation: { rule: 'speed' },
    });
    // the half metre it settles: accepted
    const settle = new Harness(D, { pose: pose(HOME, along(up!, tan, 0, SHIP_GEAR_HEIGHT + 0.5), [0, 0, 0], q), mode: 'ship' });
    for (let i = 0; i < 30; i++) settle.send(pose(HOME, along(up!, tan, 0, SHIP_GEAR_HEIGHT + 0.5), [0, 0, 0], q), 'ship');
    expect(settle.send(pose(HOME, along(up!, tan, 0, SHIP_GEAR_HEIGHT), [0, 0, 0], q), 'landed', { at: settle.now }).ok).toBe(true);
  });

  it('a flying ship’s centre stays its collision radius off the hangar’s shell', () => {
    const H = STATION_LAYOUT.hangar;
    // toward the side wall's outer face (4 m thick) at 20 m/s
    const h = new Harness(D, { pose: pose(STATION, [H.x0 - 40, 10, -22]), mode: 'ship' });
    let x = H.x0 - 40;
    while (!h.refusals.length && x < H.x0 - 4 - 1) h.send(pose(STATION, [++x, 10, -22], [20, 0, 0], noseTo(X)), 'ship');
    expect(first(h)).toMatchObject({ rule: 'station_hull' });
    // (refused once its centre is within its radius, less the tolerance, of the face)
    expect(x).toBeGreaterThan(H.x0 - 4 - MOVEMENT.shipRadiusM);
    expect(x).toBeLessThanOrEqual(H.x0 - 4 - MOVEMENT.shipRadiusM + MOVEMENT.hullM + 1);
  });

  it('a walker is lifted by the highest ground along its step, not only at its ends', () => {
    const caps = walkerCaps(walkerStats({}));
    // what a step 0.2 s after the last may climb on its own
    const climb = caps.climb * (0.2 + MOVEMENT.teleport.lagS) + WALKER_TOLERANCE.stepM + MOVEMENT.teleport.walkerSlackM;
    const L = 7;
    let found: { up: Vec3; t: Vec3 } | null = null;
    for (let k = 160_000; k < 260_000 && !found; k++) {
      const u = norm([Math.sin(k * 1.37 + 0.2), Math.cos(k * 0.71), Math.sin(k * 2.13 + 0.5)]);
      const h0 = heightAt(g, u);
      if (g.ocean && h0 < 1) continue;
      const t = tangent(u, k);
      const rel = (s: number) => heightAt(g, norm([u[0] + (t[0] * s) / R, u[1] + (t[1] * s) / R, u[2] + (t[2] * s) / R])) - h0;
      // both ends level, a hump between at least 2.5 m up where the step is sampled, and the chord over it
      if (Math.abs(rel(L)) > 0.5 || Math.max(rel(L / 4), rel(L / 2), rel((3 * L) / 4)) < 2.5) continue;
      let clear = true;
      for (let i = 1; i < 28 && clear; i++) if (rel((L * i) / 28) - ((climb + 2) * i) / 28 > 2.5) clear = false;
      if (clear) found = { up: u, t };
    }
    expect(found).not.toBeNull();
    const { up, t } = found!;
    const h = new Harness(D, { pose: pose(HOME, along(up, t, 0, 0)), mode: 'foot' });
    for (let i = 0; i < 25; i++) h.send(pose(HOME, along(up, t, 0, 0)), 'foot');
    // over the hump and 2 m higher than it could climb on its own: thrown up by the hump
    const r0 = Math.hypot(...along(up, t, 0, 0));
    const end = norm(along(up, t, L, 0));
    const high: Vec3 = [end[0] * (r0 + climb + 2), end[1] * (r0 + climb + 2), end[2] * (r0 + climb + 2)];
    expect(h.send(pose(HOME, high), 'foot', { dt: 0.2 }).ok, JSON.stringify(first(h))).toBe(true);
    // the same without a hump to lift it (flying straight up from level ground): refused
    const flat = new Harness(D, { pose: pose(HOME, along(up, t, 0, 0)), mode: 'foot' });
    for (let i = 0; i < 25; i++) flat.send(pose(HOME, along(up, t, 0, 0)), 'foot');
    const above = norm(along(up, t, 0, 0));
    flat.send(pose(HOME, [above[0] * (r0 + climb + 2), above[1] * (r0 + climb + 2), above[2] * (r0 + climb + 2)]), 'foot', { dt: 0.2 });
    expect(first(flat)).toMatchObject({ detail: 'up' });
  });
});

describe('a pose judged while its world’s ground is still being planned', () => {
  const g = groundOf(D, D.home)!;
  const up: Vec3 = [0, 0, -1];
  const groundR = D.bodies[D.home]!.radius + heightAt(g, up);
  const at = (above: number): Vec3 => [up[0] * (groundR + above), up[1] * (groundR + above), up[2] * (groundR + above)];
  const grav = D.bodies[D.home]!.gravity || WALKER.defaultGravity;

  it('is let through, then judged again with everything after it once the ground is ready', () => {
    const gated = new GatedGrounds();
    const h = new Harness(D, { pose: pose(HOME, at(0)), mode: 'foot' }, {}, { grounds: gated });
    // standing, then falling (as fast as it may) into the ground the server cannot see yet
    for (let i = 0; i < 10; i++) expect(h.send(pose(HOME, at(0)), 'foot').ok).toBe(true);
    for (let i = 1; i <= 40; i++) expect(h.send(pose(HOME, at(-0.5 * grav * (i * 0.05) ** 2)), 'foot').ok).toBe(true);
    gated.open = true;
    const r = h.send(pose(HOME, at(-0.5 * grav * 2.05 ** 2)), 'foot');
    expect(r).toMatchObject({ ok: false, violation: { rule: 'terrain', detail: 'below the ground' } });
    // back to the last pose it can vouch for, judged with the ground
    const back = Math.hypot(...(r as MovementRefusal).correction!.pose.pos);
    expect(back).toBeGreaterThanOrEqual(groundR - MOVEMENT.terrain.walkerBelowM);
    expect(back).toBeLessThan(groundR);
  });

  it('an honest walker held so is never corrected once it is ready', () => {
    const gated = new GatedGrounds();
    const t: Vec3 = [1, 0, 0];
    const h = new Harness(D, { pose: pose(HOME, at(0)), mode: 'foot' }, {}, { grounds: gated });
    const walk = (s: number) => {
      const d = norm([up[0] + t[0] * (s / groundR), up[1] + t[1] * (s / groundR), up[2] + t[2] * (s / groundR)]);
      const r = D.bodies[D.home]!.radius + heightAt(g, d);
      return [d[0] * r, d[1] * r, d[2] * r] as Vec3;
    };
    for (let i = 1; i <= 60; i++) {
      if (i === 30) gated.open = true;
      h.send(pose(HOME, walk(i * 0.25)), 'foot');
    }
    expect(h.refusals, JSON.stringify(first(h))).toEqual([]);
  });

  it('landed off the ground: let through, then refused once the ground is ready', () => {
    const gated = new GatedGrounds();
    const h = new Harness(D, { pose: pose(HOME, at(60)), mode: 'ship' }, {}, { grounds: gated });
    expect(h.send(pose(HOME, at(60)), 'landed').ok).toBe(true);
    gated.open = true;
    expect(h.send(pose(HOME, at(60)), 'landed')).toMatchObject({ ok: false, violation: { rule: 'landed' } });
  });

  it('refused, back to where it began, when the ground is never ready', () => {
    const h = new Harness(D, { pose: pose(HOME, at(0)), mode: 'foot' }, {}, { grounds: new GatedGrounds() });
    for (let i = 0; i < (MOVEMENT.ground.holdS + 1) * 20 && !h.refusals.length; i++) h.send(pose(HOME, at(0)), 'foot');
    expect(first(h)).toMatchObject({ rule: 'terrain', unit: 's', allowed: MOVEMENT.ground.holdS });
    expect((h.refusals[0] as MovementRefusal).correction!.pose.pos).toEqual(at(0));
  });

  it('cannot be vouched for at login until the planner has it, which is waited for', async () => {
    const gated = new GatedGrounds();
    const landed = pose(HOME, at(SHIP_GEAR_HEIGHT));
    expect(poseProblem(D, landed, 'landed', 1e6, { ship: LARK }, undefined, { grounds: gated })).toMatchObject({
      rule: 'terrain',
      detail: expect.stringContaining('not planned'),
    });
    const ready = planGround(D, HOME, 0, 2000, gated);
    setTimeout(() => (gated.open = true), 50);
    expect(await ready).toBe(true);
    expect(poseProblem(D, landed, 'landed', 1e6, { ship: LARK }, undefined, { grounds: gated })).toBeNull();
    expect(await planGround(D, HOME, 0, 60, new GatedGrounds())).toBe(false);
    expect(await planGround(D, STATION, 0, 60, new GatedGrounds())).toBe(true);
  });
});
