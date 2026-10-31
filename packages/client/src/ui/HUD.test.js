// The HUD's gauge arcs (P1.E07.T02, P1.E07.T03): a gauge drawn for the first time or turned on lands on its value at once,
// in its value's colours, with no tween from where it stood; a jump (a server sync, a refill, an ability's chunk of heat)
// eases onto its value over ARC_EASE_MS, fast then settling, in its new colours at once; frame-to-frame changes tween; and
// the regen sheen waits for the fill to be drawn. (On stand-ins for the gauge's SVG elements: the client's tests run
// without a DOM.)
import { describe, expect, it } from 'vitest';
import { ARC_EASE_MS, HUD } from './HUD.js';

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
    for (let i = 0; i <= 10; i++) {
      heat(0.45 - i * 0.003);
      drawn.push(1 - Number(x.fill.style.strokeDashoffset));
      h.t += 16;
    }
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeGreaterThanOrEqual(drawn[i - 1] - 0.004);
    // more of the way in its first half than its second (an ease out), and on the meter once it has run
    expect(drawn[4] - drawn[0]).toBeGreaterThan(drawn[9] - drawn[5]);
    expect(drawn[10]).toBeCloseTo(0.45 - 10 * 0.003, 3);
    expect(x.has('snap')).toBe(false);
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
