// The render time remote entities are read at (docs/ARCHITECTURE.md §9, "Remote entities"): INTERP_DELAY_S behind the
// newest server time the snapshots bring. A snapshot stamped `time` arrives some way after the server took it (its trip
// and the tick's wait); the least such lag over the last LAG_WINDOW_S of arrivals is the trip, and the render time is the
// server's clock less that lag and the delay, so a tick or two of jitter still finds two samples to interpolate between.
// It moves smoothly: it never goes back, runs between 0.9 and 1.1 times as fast as the clock while it catches up, and
// jumps only forward, when it is more than JUMP_S behind (the first snapshots, a stalled page).

/** The interpolation delay: two ticks at the zone's 20 Hz. */
export const INTERP_DELAY_S = 0.1;
/** Arrivals the lag is the least of: the last two seconds' (forty snapshots). */
export const LAG_WINDOW_S = 2;
/** Further than this behind where it should be, the render time jumps there instead of easing. */
export const JUMP_S = 0.5;
/** How much faster or slower than the clock the render time runs while it eases. */
const SLEW = 0.1;
const KEEP = 64;

export class PlaybackClock {
  constructor(delay = INTERP_DELAY_S, window = LAG_WINDOW_S) {
    this.delay = delay;
    this.window = window;
    this.lateBy = new Float64Array(KEEP);
    this.arrivedAt = new Float64Array(KEEP);
    this.reset();
  }

  reset() {
    this.count = 0;
    this.head = 0;
    /** the render time (world seconds); -Infinity until the first advance */
    this.t = -Infinity;
    this.last = null;
    this.prevNow = null;
  }

  /** A snapshot taken at server time `time` arrived when the server's clock read `now`. */
  arrived(time, now) {
    this.lateBy[this.head] = now - time;
    this.arrivedAt[this.head] = now;
    this.head = (this.head + 1) % KEEP;
    this.count = Math.min(KEEP, this.count + 1);
    this.last = now - time;
  }

  /** The trip: the least lag of the arrivals within the window before `now` (the latest one's when none is). */
  lag(now) {
    let best = Infinity;
    for (let i = 0; i < this.count; i++) if (this.arrivedAt[i] >= now - this.window && this.lateBy[i] < best) best = this.lateBy[i];
    return best === Infinity ? (this.last ?? 0) : best;
  }

  /** The render time for server clock reading `now`, moved on from the last. */
  advance(now) {
    const target = now - this.lag(now) - this.delay;
    const step = this.prevNow === null ? 0 : Math.max(0, now - this.prevNow);
    this.prevNow = now;
    // (far behind it jumps; ahead, however far, it only slows: going back would play the entities backwards)
    if (target - this.t > JUMP_S) this.t = target;
    else {
      const on = this.t + step;
      this.t = on + Math.max(-SLEW * step, Math.min(SLEW * step, target - on));
    }
    return this.t;
  }
}
