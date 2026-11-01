// The render time remote entities are read at (P1.E04.T02): 100 ms behind the newest server time the snapshots bring,
// the trip measured as the least lag of the last two seconds' arrivals, moving smoothly and never back.
import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_S, JUMP_S, PlaybackClock } from './clock.js';

/** Snapshots every 50 ms from t0 to t1, each arriving `trip(t)` later; the clock advanced at 60 Hz throughout. */
function run(clock, { t0 = 1000, t1 = 1003, trip = () => 0.04 } = {}) {
  const arrivals = [];
  for (let t = t0; t <= t1 + 1e-9; t += 0.05) arrivals.push([t + trip(t), t]);
  arrivals.sort((a, b) => a[0] - b[0]);
  const out = [];
  let i = 0;
  for (let now = t0; now <= t1 + 1e-9; now += 1 / 60) {
    while (i < arrivals.length && arrivals[i][0] <= now) clock.arrived(arrivals[i][1], arrivals[i++][0]);
    out.push([now, clock.advance(now)]);
  }
  return out;
}

describe('PlaybackClock', () => {
  it(`runs ${INTERP_DELAY_S * 1000} ms behind the newest server time, less the trip`, () => {
    const c = new PlaybackClock();
    const out = run(c, { trip: () => 0.04 });
    const [now, t] = out.at(-1);
    expect(now - t).toBeCloseTo(0.04 + INTERP_DELAY_S, 6);
  });

  it('takes the trip as the least lag of the last two seconds: jitter goes into the delay, not the clock', () => {
    const c = new PlaybackClock();
    // 40 ms, plus up to 60 ms of jitter
    const out = run(c, { trip: (t) => 0.04 + 0.06 * ((Math.sin(t * 91.7) + 1) / 2) });
    const [now, t] = out.at(-1);
    expect(now - t).toBeGreaterThan(0.14 - 0.005);
    expect(now - t).toBeLessThan(0.14 + 0.01);
  });

  it('never goes back, and runs within 10% of the clock while it eases', () => {
    const c = new PlaybackClock();
    // the trip grows from 30 to 300 ms over two seconds, then falls back
    const out = run(c, { t1: 1006, trip: (t) => (t < 1002 ? 0.03 + 0.135 * (t - 1000) : t < 1004 ? 0.3 : 0.03) });
    for (let k = 2; k < out.length; k++) {
      const rate = (out[k][1] - out[k - 1][1]) / (out[k][0] - out[k - 1][0]);
      expect(rate).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(rate).toBeLessThanOrEqual(1.1 + 1e-9);
    }
  });

  it(`jumps forward when more than ${JUMP_S * 1000} ms behind (the first snapshots, a stalled page)`, () => {
    const c = new PlaybackClock();
    c.arrived(1000, 1000.04);
    expect(c.advance(1000.05)).toBeCloseTo(1000.05 - 0.04 - INTERP_DELAY_S, 9);
    // the page stalls for 5 s; snapshots pile up and arrive together
    for (let t = 1000.05; t < 1005; t += 0.05) c.arrived(t, 1005.04);
    c.arrived(1005, 1005.04);
    const t = c.advance(1005.05);
    expect(t).toBeCloseTo(1005.05 - 0.04 - INTERP_DELAY_S, 6);
  });
});
