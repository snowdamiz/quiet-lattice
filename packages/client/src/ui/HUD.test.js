// The HUD's gauge arcs (P1.E07.T02, P1.E07.T03): a gauge drawn for the first time or turned on lands on its value at once,
// in its value's colours, with no tween from where it stood; a jump (a server sync, a refill, an ability's chunk of heat)
// eases onto its value over ARC_EASE_MS, fast then settling, in its new colours at once; a cast's cost eases on or off
// whatever its size, its chunk of the fill drawn bright while it does; frame-to-frame changes tween; and the regen sheen
// waits for the fill to be drawn. (On stand-ins for the gauge's SVG elements: the client's tests run without a DOM.)
import { describe, expect, it } from 'vitest';
import { ARC_EASE_MS, countdown, HUD } from './HUD.js';

/** One gauge as HUD.arc and HUD.sheen reach it: the root, its `<g class="gauge">`, the fill and the sheen paths. */
function gauge(name = 'charge') {
  const classes = new Set(['gauge']);
  const g = {
    classList: {
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    querySelector: (q) => (q === '.sheen' ? sheen : q === '.chunk' ? chunk : null),
  };
  const fill = { style: {}, parentNode: g };
  const sheen = { style: {}, parentNode: g };
  const chunk = { style: {}, parentNode: g };
  const root = { querySelector: (q) => (q === `.g-${name}` ? fill : null) };
  /** the bright chunk as drawn: from `at` for `len` of the arc, at `opacity` */
  const drawnChunk = () => ({
    len: Number(String(chunk.style.strokeDasharray ?? '0').split(' ')[0]),
    at: -Number(chunk.style.strokeDashoffset ?? 0),
    opacity: Number(chunk.style.opacity ?? 0),
  });
  return { root, g, fill, sheen, chunk: drawnChunk, has: (c) => classes.has(c) };
}

/** A HUD with nothing but its clock (from half way through the sheen's climb). */
function hud() {
  const h = Object.create(HUD.prototype);
  h.t = 950;
  h.now = () => h.t;
  return h;
}

/** A frame of the Charge gauge as HUD.update draws it. */
function frame(h, x, fill, { shown = true, regen = true } = {}) {
  h.arc(x.root, 'charge', fill, shown, { low: fill < 0.25, regen, empty: fill <= 0 });
  h.sheen(x.root, 'charge', regen && shown, fill);
}

describe('the gauge arcs', () => {
  it('turned on at 58 draw 58 at once, not red, the sheen waiting a frame', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 0.58);
    expect(x.fill.style.strokeDashoffset).toBe('0.420');
    expect(x.has('snap')).toBe(true);
    expect(x.has('on')).toBe(true);
    expect(x.has('low')).toBe(false);
    expect(x.has('empty')).toBe(false);
    expect(Number(x.sheen.style.opacity ?? 0)).toBe(0);
    // the next frame: transitions back on, the sheen climbing the drawn fill
    frame(h, x, 0.581);
    expect(x.has('snap')).toBe(false);
    expect(Number(x.sheen.style.opacity)).toBeGreaterThan(0.5);
    expect(Number(x.sheen.style.strokeDashoffset)).toBeGreaterThan(0.035 - 0.581);
  });

  it('eases a jump from empty and red onto its value, fast then settling, in its new colours at once', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 0, { regen: false });
    frame(h, x, 0, { regen: false });
    expect(x.has('low')).toBe(true);
    expect(x.has('snap')).toBe(false);
    frame(h, x, 0.58);
    // (from where it stood, the CSS transition off while the HUD eases it)
    expect(x.fill.style.strokeDashoffset).toBe('1.000');
    expect(x.has('snap')).toBe(true);
    expect(x.has('low')).toBe(false);
    expect(Number(x.sheen.style.opacity ?? 0)).toBe(0);
    h.t += ARC_EASE_MS / 2;
    frame(h, x, 0.58);
    const half = 1 - Number(x.fill.style.strokeDashoffset);
    expect(half).toBeGreaterThan(0.58 * 0.75);
    expect(half).toBeLessThan(0.58);
    h.t += ARC_EASE_MS / 2;
    frame(h, x, 0.58);
    expect(x.fill.style.strokeDashoffset).toBe('0.420');
    expect(x.has('snap')).toBe(false);
  });

  it('eases a chunk of heat on, following the meter as it cools meanwhile', () => {
    const h = hud();
    const x = gauge('heat');
    const heat = (v) => h.arc(x.root, 'heat', v, true, { hot: v >= 0.75, over: false });
    heat(0.2);
    heat(0.2);
    // a cast's 25 heat in one go, then cooling a little every frame
    const drawn = [];
    const n = Math.ceil(ARC_EASE_MS / 16);
    for (let i = 0; i <= n; i++) {
      heat(0.45 - i * 0.003);
      drawn.push(1 - Number(x.fill.style.strokeDashoffset));
      h.t += 16;
    }
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeGreaterThanOrEqual(drawn[i - 1] - 0.004);
    // more of the way in its first half than its second (an ease out), and on the meter once it has run
    const mid = Math.floor(n / 2);
    expect(drawn[mid] - drawn[0]).toBeGreaterThan(drawn[n] - drawn[mid]);
    expect(drawn[n]).toBeCloseTo(0.45 - n * 0.003, 3);
    expect(x.has('snap')).toBe(false);
  });

  it('eases a cast’s small cost of heat on, the new chunk drawn bright from the old level to the tip until it lands', () => {
    const h = hud();
    const x = gauge('heat');
    const heat = (v, costAt = null) => h.arc(x.root, 'heat', v, true, { hot: false, over: false }, costAt);
    heat(0.2);
    heat(0.2);
    // (5 heat: under a jump's size, so without the cast it would tween frame to frame)
    const cast = h.t;
    heat(0.25, cast);
    expect(x.has('snap')).toBe(true);
    expect(1 - Number(x.fill.style.strokeDashoffset)).toBeCloseTo(0.2, 3);
    h.t += ARC_EASE_MS / 2;
    heat(0.25, cast);
    const half = 1 - Number(x.fill.style.strokeDashoffset);
    expect(half).toBeGreaterThan(0.2 + 0.05 * 0.75);
    expect(half).toBeLessThan(0.25);
    expect(x.chunk()).toMatchObject({ opacity: 1 });
    expect(x.chunk().at).toBeCloseTo(0.2, 3);
    expect(x.chunk().len).toBeCloseTo(half - 0.2, 3);
    h.t += ARC_EASE_MS / 2;
    heat(0.25, cast);
    expect(x.fill.style.strokeDashoffset).toBe('0.750');
    expect(x.has('snap')).toBe(false);
    expect(x.chunk()).toMatchObject({ len: 0, opacity: 0 });
  });

  it('takes a cast’s Charge off over the same ease, the cost draining bright from the tip down to the new level', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 0.8, { regen: false });
    frame(h, x, 0.8, { regen: false });
    const cast = h.t;
    h.arc(x.root, 'charge', 0.68, true, null, cast);
    expect(x.chunk().at).toBeCloseTo(0.68, 3);
    expect(x.chunk().len).toBeCloseTo(0.12, 3);
    h.t += ARC_EASE_MS * 0.7;
    h.arc(x.root, 'charge', 0.68, true, null, cast);
    const tip = 1 - Number(x.fill.style.strokeDashoffset);
    expect(tip).toBeGreaterThan(0.68);
    expect(x.chunk().len).toBeCloseTo(tip - 0.68, 3);
    expect(x.chunk().opacity).toBeGreaterThan(0);
    expect(x.chunk().opacity).toBeLessThan(1);
  });

  it('counts a jump as a cast’s cost when the cast’s answer comes the frame after it, and draws no chunk for any other', () => {
    const h = hud();
    const x = gauge('heat');
    const heat = (v, costAt = null) => h.arc(x.root, 'heat', v, true, { hot: false, over: false }, costAt);
    heat(0.2);
    heat(0.2);
    heat(0.5);
    expect(x.chunk().len).toBe(0);
    h.t += 16;
    heat(0.5, h.t);
    expect(x.chunk().at).toBeCloseTo(0.2, 3);
    expect(x.chunk().len).toBeGreaterThan(0);
    // a jump long after the cast is none of its cost
    h.t += 2000;
    heat(0.1, h.t - 1900);
    expect(x.chunk().len).toBe(0);
  });

  it('lands as it turns on after resting off, and tweens small changes from frame to frame', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 1, { shown: false, regen: false });
    frame(h, x, 1, { shown: false, regen: false });
    expect(x.has('on')).toBe(false);
    frame(h, x, 0.96);
    expect(x.has('snap')).toBe(true);
    expect(x.has('on')).toBe(true);
    frame(h, x, 0.962);
    frame(h, x, 0.964);
    expect(x.has('snap')).toBe(false);
    expect(x.fill.style.strokeDashoffset).toBe('0.036');
  });

  it('applies the same first-draw rule to the heat arc', () => {
    const h = hud();
    const x = gauge('heat');
    h.arc(x.root, 'heat', 0.4, true, { hot: false, over: false });
    expect(x.fill.style.strokeDashoffset).toBe('0.600');
    expect(x.has('snap')).toBe(true);
    h.arc(x.root, 'heat', 0.404, true, { hot: false, over: false });
    expect(x.has('snap')).toBe(false);
  });
});

describe('the ability bar’s countdown', () => {
  it('shows whole seconds from ten up and tenths under, never a lone digit a key could be read as', () => {
    expect(countdown(20)).toBe('20');
    expect(countdown(10.2)).toBe('11');
    expect(countdown(9.96)).toBe('10');
    expect(countdown(9.94)).toBe('10');
    expect(countdown(9.86)).toBe('9.9');
    expect(countdown(4)).toBe('4.0');
    expect(countdown(0.01)).toBe('0.1');
  });
});
