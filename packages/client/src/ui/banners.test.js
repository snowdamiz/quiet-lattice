// The HUD's banner queue: one at a time, the next held until the one showing has fully faded, the band let go only when
// nothing follows, and the hold taken from the same constant the stylesheet's animation runs on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNER_FADE_IN, BANNER_FADE_OUT, BANNER_MS, BANNER_STALE_MS, BannerQueue } from './banners.js';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

/** a queue on a clock the test moves: what it showed and when, and when it let the band go */
function rig() {
  let clock = 0;
  let timers = [];
  const made = [];
  const log = { shown: [], released: [] };
  const queue = new BannerQueue({
    now: () => clock,
    later: (fn, ms) => {
      const t = { at: clock + ms, fn };
      timers.push(t);
      made.push(t);
      return t;
    },
    cancel: (t) => (timers = timers.filter((x) => x !== t)),
    show: (b) => log.shown.push([clock, b.title]),
    release: () => log.released.push(clock),
  });
  const advance = (ms) => {
    const end = clock + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers = timers.filter((t) => t !== next);
      clock = next.at;
      next.fn();
    }
    clock = end;
  };
  return { queue, log, advance, made };
}

describe('the banner queue', () => {
  it('holds the next banner until the one showing has fully faded', () => {
    const { queue, log, advance } = rig();
    queue.push({ title: 'STAR SYSTEM' });
    queue.push({ title: 'HOLLOW TIDE' });
    advance(BANNER_MS - 1);
    expect(log.shown).toEqual([[0, 'STAR SYSTEM']]);
    advance(1);
    expect(log.shown).toEqual([
      [0, 'STAR SYSTEM'],
      [BANNER_MS, 'HOLLOW TIDE'],
    ]);
  });

  it('keeps the band for a banner that follows, and lets it go as the last banner starts to fade', () => {
    const { queue, log, advance } = rig();
    queue.push({ title: 'A' });
    queue.push({ title: 'B' });
    advance(BANNER_MS * 3);
    expect(log.released).toEqual([BANNER_MS + BANNER_MS * (1 - BANNER_FADE_OUT)]);
  });

  it('lets the band go with a banner’s text when none is waiting, but not when one arrives while it fades', () => {
    const { queue, log, advance } = rig();
    queue.push({ title: 'A' });
    advance(BANNER_MS * 0.5);
    queue.push({ title: 'B' });
    advance(BANNER_MS);
    expect(log.released).toEqual([]);
    advance(BANNER_MS);
    expect(log.released).toEqual([BANNER_MS * 1.8]);
  });

  it('drops a banner that waited too long, lets the band go with the last one it showed, and drops everything on a clear', () => {
    const { queue, log, advance } = rig();
    for (const title of ['A', 'B', 'C', 'D', 'E']) queue.push({ title });
    advance(BANNER_STALE_MS + BANNER_MS * 3);
    expect(log.shown.map((x) => x[1])).toEqual(['A', 'B', 'C', 'D']);
    // (D's release timer sees E waiting and holds the band; E is stale by the time its turn comes)
    expect(log.released).toEqual([BANNER_MS * 4]);
    queue.push({ title: 'F' });
    queue.push({ title: 'G' });
    queue.clear();
    advance(BANNER_MS * 3);
    expect(log.shown.map((x) => x[1])).toEqual(['A', 'B', 'C', 'D', 'F']);
    queue.push({ title: 'H' });
    expect(log.shown.at(-1)[1]).toBe('H');
  });

  it('shows three banners raised within a second, as a planet-side login raises them', () => {
    const { queue, log, advance } = rig();
    queue.push({ title: 'PLANET' });
    advance(300);
    queue.push({ title: 'EVENT' });
    advance(300);
    queue.push({ title: 'STAR SYSTEM' });
    advance(BANNER_MS * 3);
    expect(log.shown.map((x) => x[1])).toEqual(['PLANET', 'EVENT', 'STAR SYSTEM']);
    expect(log.released).toHaveLength(1);
  });

  it('keeps a world event’s banner waiting behind two others', () => {
    const { queue, log, advance } = rig();
    queue.push({ title: 'PLANET' });
    queue.push({ title: 'STAR SYSTEM' });
    queue.push({ title: 'EVENT STARTED', sub: 'WORLD EVENT' });
    advance(BANNER_MS * 2 - 1);
    expect(log.shown.map((x) => x[1])).toEqual(['PLANET', 'STAR SYSTEM']);
    advance(1);
    expect(log.shown.at(-1)).toEqual([BANNER_MS * 2, 'EVENT STARTED']);
  });

  it('ignores a release timer left from before a clear or a newer banner, as one on a clock that was swapped out would be', () => {
    const { queue, log, advance, made } = rig();
    queue.push({ title: 'A' });
    const stale = made.at(-1);
    queue.clear();
    queue.push({ title: 'B' });
    stale.fn();
    expect(log.released).toEqual([]);
    advance(BANNER_MS * 0.8 + 1);
    expect(log.released).toHaveLength(1);
  });

  it('shows a banner at once when nothing is showing', () => {
    const { queue, log, advance } = rig();
    advance(500);
    queue.push({ title: 'A' });
    expect(log.shown).toEqual([[500, 'A']]);
  });
});

describe('the stylesheet’s banner animation', () => {
  const block = (selector) => {
    const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return m?.[1] ?? '';
  };

  it('runs over the duration the queue holds for, a custom property HUD.js sets from BANNER_MS, with no second number', () => {
    expect(block('.banner.show')).toMatch(/animation:\s*banner var\(--banner-ms\)/);
    expect(block('.hud-band')).toContain('var(--banner-out-ms)');
    expect(block('.hud-band.show')).toContain('var(--banner-in-ms)');
    expect(block('.banner.show') + block('.hud-band') + block('.hud-band.show')).not.toMatch(/\d(ms|s)\b/);
  });

  it('fades in and out at the stops the queue’s fractions name', () => {
    const frames = css.match(/@keyframes banner\s*\{([\s\S]*?)\n\}\n/)?.[1] ?? '';
    const stops = [...frames.matchAll(/(\d+)%\s*\{([^}]*)\}/g)].map((m) => [Number(m[1]), /opacity:\s*(\d)/.exec(m[2])?.[1]]);
    expect(stops).toContainEqual([BANNER_FADE_IN * 100, '1']);
    expect(stops).toContainEqual([(1 - BANNER_FADE_OUT) * 100, '1']);
    expect(stops.at(-1)).toEqual([100, '0']);
  });

  it('is not outlasted by the hold: the queue waits at least as long as the animation runs', () => {
    const { queue, log, advance } = rig();
    queue.push({ title: 'A' });
    queue.push({ title: 'B' });
    advance(BANNER_MS * 2);
    const hold = log.shown[1][0] - log.shown[0][0];
    expect(hold).toBeGreaterThanOrEqual(BANNER_MS);
  });
});
