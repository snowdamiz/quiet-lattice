// The render time remote entities are read at (docs/ARCHITECTURE.md §9, "Remote entities"): INTERP_DELAY_S behind the
// newest server time the snapshots bring. A snapshot stamped `time` arrives some way after the server took it (its trip
// and the tick's wait), measured on the server's clock as the client estimates it; the least such lag of the last
// LAG_ARRIVALS arrivals is the trip. The render time is world time (game.time, which the bodies stand at) less the trip
// and the delay, so a remote entity is always placed through frames as far ahead of its pose as the trip and the delay,
// whether world time runs a little ahead of the server's clock or has fallen behind it after a hitch; and a tick or two of
// jitter still finds two samples to interpolate between.
//
// It moves smoothly: it never goes back, runs between 0.9 and 1.1 times as fast as world time while it eases, and jumps
// only forward, when it is more than JUMP_S behind (the first snapshots, a stalled page).

/** The interpolation delay: two ticks at the zone's 20 Hz. */
export const INTERP_DELAY_S = 0.1;
/** Arrivals the trip is the least lag of: the last two seconds' at 20 Hz. */
export const LAG_ARRIVALS = 40;
/** Further than this behind where it should be, the render time jumps there instead of easing. */
export const JUMP_S = 0.5;
/** How much faster or slower than world time the render time runs while it eases. */
const SLEW = 0.1;

export class PlaybackClock {
  constructor(delay = INTERP_DELAY_S, arrivals = LAG_ARRIVALS) {
    this.delay = delay;
    this.lateBy = new Float64Array(arrivals);
    this.reset();
  }

  reset() {
    this.count = 0;
    this.head = 0;
    /** the render time (world seconds); -Infinity until the first advance */
    this.t = -Infinity;
    this.prevNow = null;
  }

  /** A snapshot taken at server time `time` arrived when the server's clock read `now`. */
  arrived(time, now) {
    this.lateBy[this.head] = now - time;
    this.head = (this.head + 1) % this.lateBy.length;
    this.count = Math.min(this.lateBy.length, this.count + 1);
  }

  /** The trip: the least lag of the arrivals kept (0 before any). */
  lag() {
    let best = Infinity;
    for (let i = 0; i < this.count; i++) best = Math.min(best, this.lateBy[i]);
    return best === Infinity ? 0 : best;
  }

  /** The render time for world time `now`, moved on from the last. */
  advance(now) {
    const target = now - this.lag() - this.delay;
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
