// The chat and party UI's stepped moves (P1.E15.T03): a whole pixel on the HUD's ease every frame, at least one pixel on
// each frame until they land (no frame standing still, none going back), landing exactly on time and place.
import { describe, expect, it, vi } from 'vitest';
import { MOVE_MS, Motion, ease, stepValue } from './motion.js';

/** The values a move shows frame by frame at 60 fps, from the frame it starts (which shows `from`). */
function frames(from, to, fps = 60) {
  const out = [from];
  let last = from;
  for (let t = 1000 / fps; ; t += 1000 / fps) {
    const p = Math.min(1, t / MOVE_MS);
    last = stepValue(from, to, p, last);
    out.push(last);
    if (p >= 1) return out;
  }
}

describe('the moves', () => {
  it('ease out from 0 to 1, never going back', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let prev = 0;
    for (let t = 0.01; t <= 1; t += 0.01) {
      const v = ease(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(ease(0.1)).toBeGreaterThan(0.3);
  });

  it('move a card down 107 px a whole pixel and at least one pixel every frame, landing on time', () => {
    const f = frames(120, 227);
    expect(f[0]).toBe(120);
    expect(f.at(-1)).toBe(227);
    for (let i = 1; i < f.length; i++) {
      expect(Number.isInteger(f[i])).toBe(true);
      if (f[i - 1] !== 227) expect(f[i] - f[i - 1]).toBeGreaterThanOrEqual(1);
      expect(f[i]).toBeLessThanOrEqual(227);
    }
    expect(f.length).toBe(16);
  });

  it('close a box the same way, and land early on a short move, holding there', () => {
    const shrink = frames(34, 0);
    for (let i = 1; i < shrink.length; i++) if (shrink[i - 1] !== 0) expect(shrink[i - 1] - shrink[i]).toBeGreaterThanOrEqual(1);
    expect(shrink.at(-1)).toBe(0);
    const short = frames(0, 3);
    expect(short.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(new Set(short.slice(3))).toEqual(new Set([3]));
  });

  it('hold before they start, and land on a fraction a box lays out at', () => {
    expect(stepValue(0, 50, 0, 0)).toBe(0);
    expect(stepValue(10, 42.5, 1, 41)).toBe(42.5);
  });
});

/** A box as `Motion` sees it, in a page of none. */
function box(width, height) {
  return {
    style: {},
    hidden: false,
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ width, height }),
  };
}

describe('a badge clearing', () => {
  function clear() {
    vi.stubGlobal('getComputedStyle', () => ({ paddingLeft: '4px', paddingRight: '4px', borderLeftWidth: '0px', borderRightWidth: '0px' }));
    let t = 0;
    const motion = new Motion(() => t);
    const e = box(21, 15);
    motion.toggle(e, false, true, { across: true, ms: 150, gap: 7, quick: true, whole: true, keep: 18 });
    const seen = [];
    for (let i = 0; i < 12 && motion.moving(e); i++) {
      t += 1000 / 60;
      motion.step();
      seen.push({ width: e.style.width, shift: parseFloat((e.style.transform || '').replace(/[^0-9.-]/g, '')) || 0, room: parseFloat(e.style.width) + 7 + parseFloat(e.style.marginRight), opacity: Number(e.style.opacity) });
    }
    vi.unstubAllGlobals();
    return { e, seen };
  }

  it('keeps its face whole while its room closes, over the same few frames', () => {
    const { e, seen } = clear();
    expect(e.hidden).toBe(true);
    const closed = seen.findIndex((f) => f.room === 0);
    expect(closed).toBe(5);
    for (const f of seen.filter((f) => f.width)) expect(f.width).toBe('21px');
    // (what follows is never nearer than `keep` to the face's far edge: the face slides left as it comes)
    for (const f of seen.filter((f) => f.width)) expect(7 + 21 + f.shift).toBeLessThanOrEqual(f.room + 18 + 0.001);
    // (the room is given up from the right, a pixel or more on every frame)
    for (let i = 1; i <= closed; i++) expect(seen[i].room).toBeLessThan(seen[i - 1].room);
  });

  it('fades evenly over those frames, each showing it, and is all but gone on the frame after the room is', () => {
    const { seen } = clear();
    const closed = seen.findIndex((f) => f.room === 0);
    expect(seen.slice(0, closed + 1).every((f) => f.opacity > 0.05 && f.opacity < 1)).toBe(true);
    for (let i = 1; i <= closed + 1; i++) expect(seen[i].opacity).toBeLessThan(seen[i - 1].opacity);
    expect(seen[closed + 1].opacity).toBeLessThan(0.02);
    // (no frame loses much more than a fifth of its brightness, none stands still)
    const steps = seen.slice(0, closed + 1).map((f, i) => (i ? seen[i - 1].opacity - f.opacity : 1 - f.opacity));
    expect(Math.max(...steps)).toBeLessThan(0.25);
    expect(Math.min(...steps)).toBeGreaterThan(0.03);
  });
});

describe('an eased value', () => {
  it('stays where it came to rest when asked for again, and eases only from there', () => {
    let t = 0;
    const motion = new Motion(() => t);
    const key = {};
    const shown = [];
    const apply = (v) => shown.push(v);
    motion.value(key, 1, apply);
    for (let i = 0; i < 10; i++) {
      t += 1000 / 60;
      motion.step();
    }
    expect(shown.at(-1)).toBe(1);
    const before = shown.length;
    for (let i = 0; i < 40; i++) {
      motion.value(key, 1, apply);
      t += 1000 / 60;
      motion.step();
    }
    expect(shown).toHaveLength(before);
    motion.value(key, 0, apply);
    t += 1000 / 60;
    motion.step();
    expect(shown.at(-1)).toBeLessThan(1);
    expect(shown.at(-1)).toBeGreaterThan(0.8);
  });

  it('writes the value it starts at once, and nothing for asking again', () => {
    const motion = new Motion(() => 0);
    const shown = [];
    for (let i = 0; i < 5; i++) motion.value({}, 0, (v) => shown.push(v));
    const key = {};
    for (let i = 0; i < 5; i++) motion.value(key, 0, (v) => shown.push(v));
    expect(shown).toEqual([0, 0, 0, 0, 0, 0]);
    motion.value(key, 0, (v) => shown.push(v));
    expect(shown).toHaveLength(6);
  });
});
