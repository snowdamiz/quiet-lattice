// The HUD's gauge arcs (P1.E07.T02): a gauge drawn for the first time, turned on, or jumping (a server sync, a refill)
// lands on its value at once, in its value's colours, with no tween from where it stood; frame-to-frame changes tween;
// and the regen sheen waits for the fill to be drawn. (On stand-ins for the gauge's SVG elements: the client's tests run
// without a DOM.)
import { describe, expect, it } from 'vitest';
import { HUD } from './HUD.js';

/** One gauge as HUD.arc and HUD.sheen reach it: the root, its `<g class="gauge">`, the fill and the sheen paths. */
function gauge(name = 'charge') {
  const classes = new Set(['gauge']);
  const g = {
    classList: {
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    querySelector: (q) => (q === '.sheen' ? sheen : null),
  };
  const fill = { style: {}, parentNode: g };
  const sheen = { style: {}, parentNode: g };
  const root = { querySelector: (q) => (q === `.g-${name}` ? fill : null) };
  return { root, g, fill, sheen, has: (c) => classes.has(c) };
}

/** A HUD with nothing but its clock (half way through the sheen's climb). */
function hud() {
  const h = Object.create(HUD.prototype);
  h.now = () => 950;
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

  it('lands on a jump from empty and red, in its new colours at once', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 0, { regen: false });
    frame(h, x, 0, { regen: false });
    expect(x.has('low')).toBe(true);
    expect(x.has('snap')).toBe(false);
    frame(h, x, 0.58);
    expect(x.fill.style.strokeDashoffset).toBe('0.420');
    expect(x.has('snap')).toBe(true);
    expect(x.has('low')).toBe(false);
    expect(Number(x.sheen.style.opacity ?? 0)).toBe(0);
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
