// The chat and party UI's stepped moves (P1.E15.T03): a whole pixel on the HUD's ease every frame, at least one pixel on
// each frame until they land (no frame standing still, none going back), landing exactly on time and place.
import { describe, expect, it } from 'vitest';
import { MOVE_MS, ease, stepValue } from './motion.js';

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
