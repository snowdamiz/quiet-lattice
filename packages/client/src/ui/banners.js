// The HUD's banner queue (a star system reached, a world found, a world event announced): one banner at a time, the next
// held until the one showing has fully faded. style.css runs the banner's keyframes over `BANNER_MS` (HUD.js hands the
// constants to the page as custom properties), so the hold and the animation cannot drift apart; banners.test.js checks
// the keyframes' stops against the fractions here.

/** How long one banner lives, fade in to fade out. */
export const BANNER_MS = 7000;
/** The fractions of that spent fading in and fading out (`@keyframes banner`: in by 10%, out from 80%). */
export const BANNER_FADE_IN = 0.1;
export const BANNER_FADE_OUT = 0.2;
/** A banner that waited longer than this for its turn is stale and dropped. Three holds: a planet-side login raises three banners at once, and the third waits two. */
export const BANNER_STALE_MS = BANNER_MS * 3;

export class BannerQueue {
  /**
   * @param {object} o
   * @param {() => number} o.now
   * @param {(fn: () => void, ms: number) => unknown} o.later
   * @param {(id: unknown) => void} o.cancel
   * @param {(item: object) => void} o.show   puts a banner up; the page's band stays lit if one is following another
   * @param {() => void} o.release            a banner starts fading out with none behind it: the band goes with its text
   */
  constructor({ now, later, cancel, show, release }) {
    Object.assign(this, { now, later, cancel, show, release });
    this.items = [];
    this.until = 0;
    this.pumpTimer = null;
    this.releaseTimer = null;
    /** counts banners shown and clears: a release timer a swapped clock could not cancel finds itself out of date */
    this.epoch = 0;
  }

  push(item) {
    this.items.push({ ...item, at: this.now() });
    this.pump();
  }

  pump() {
    const now = this.now();
    this.cancel(this.pumpTimer);
    if (now < this.until) {
      this.pumpTimer = this.later(() => this.pump(), this.until - now);
      return;
    }
    let item;
    while ((item = this.items.shift()) && now - item.at > BANNER_STALE_MS);
    if (!item) {
      // the release timer held the band for banners that turned out stale
      this.release();
      return;
    }
    this.show(item);
    this.until = now + BANNER_MS;
    this.cancel(this.releaseTimer);
    const epoch = ++this.epoch;
    this.releaseTimer = this.later(() => {
      if (epoch === this.epoch && !this.items.length) this.release();
    }, BANNER_MS * (1 - BANNER_FADE_OUT));
    if (this.items.length) this.pump();
  }

  /** Drops the banner showing and those waiting. */
  clear() {
    this.items = [];
    this.until = 0;
    this.epoch++;
    this.cancel(this.pumpTimer);
    this.cancel(this.releaseTimer);
  }
}
