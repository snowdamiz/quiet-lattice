// The Edge following the Count (DESIGN 16.3, P2.E22.T02): the Edge's position, the tiers and the dark stations as functions of
// the meter and of the map the season opened with, and the wall the map and sky draw moving with the Edge.
import { describe, expect, it } from 'vitest';
import {
  BROKEN_BELOW,
  COUNT_EDGE_SHIFT_LY,
  FED_FROM,
  SEASON_EDGE_SHIFT_LY,
  countShiftLy,
  darkAt,
  darkSystems,
  edgeAt,
  seasonOpening,
} from '../src/seasons/index.ts';
import { EDGE_WALL_LY_PER_LY, EDGE_X, edgeX, galaxyTiers, wallX } from '../src/world/index.ts';

const tiersAt = (edge: number) => galaxyTiers(edge).map((t) => t.tier);
const fringe = (edge: number) => galaxyTiers(edge).filter((t) => t.edgeWard).length;
const NONE = { edgeShiftLy: 0, dark: [] };

describe('the Count moving the Edge', () => {
  it('leaves the Edge where it stands through the middle of the meter and moves it out above Fed and in below Broken', () => {
    for (const count of [BROKEN_BELOW, 400, 500, 600, FED_FROM]) expect(countShiftLy(count)).toBe(0);
    expect(countShiftLy(1000)).toBe(COUNT_EDGE_SHIFT_LY);
    expect(countShiftLy(0)).toBe(-COUNT_EDGE_SHIFT_LY);
    expect(countShiftLy(850)).toBe(COUNT_EDGE_SHIFT_LY / 2);
    expect(countShiftLy(150)).toBe(-COUNT_EDGE_SHIFT_LY / 2);
  });

  it('is continuous and never lowers the Edge as the Count climbs', () => {
    let last = countShiftLy(0);
    for (let c = 1; c <= 1000; c++) {
      const now = countShiftLy(c);
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now - last).toBeLessThan(0.05);
      last = now;
    }
  });

  it('refuses a Count that is not a number', () => {
    expect(() => countShiftLy(Number.NaN)).toThrow(RangeError);
    expect(() => darkAt(Number.POSITIVE_INFINITY, NONE)).toThrow(RangeError);
  });

  it("adds the season's opening to the Count's shift", () => {
    expect(edgeAt(500, NONE)).toBe(EDGE_X);
    expect(edgeAt(500, seasonOpening('fed', 2))).toBe(EDGE_X + SEASON_EDGE_SHIFT_LY);
    expect(edgeAt(500, seasonOpening('broken', 2))).toBe(EDGE_X - SEASON_EDGE_SHIFT_LY);
    expect(edgeAt(1000, seasonOpening('fed', 2))).toBe(EDGE_X + SEASON_EDGE_SHIFT_LY + COUNT_EDGE_SHIFT_LY);
    expect(edgeAt(0, seasonOpening('broken', 2))).toBe(EDGE_X - SEASON_EDGE_SHIFT_LY - COUNT_EDGE_SHIFT_LY);
    expect(edgeAt(500, seasonOpening('held', 2))).toBe(EDGE_X);
  });

  it('takes the Edge-ward fringe in as the Edge advances and out as it recedes, and never raises a tier when it recedes', () => {
    const [low, mid, high] = [edgeAt(0, NONE), edgeAt(500, NONE), edgeAt(1000, NONE)];
    expect(fringe(low)).toBeGreaterThan(fringe(mid));
    expect(fringe(mid)).toBeGreaterThan(fringe(high));
    const [tl, tm, th] = [low, mid, high].map(tiersAt) as [number[], number[], number[]];
    expect(tl.some((t, i) => t !== tm[i])).toBe(true);
    expect(th.some((t, i) => t !== tm[i])).toBe(true);
    // (an advancing Edge only ever raises a tier, a receding one only lowers it)
    expect(tl.every((t, i) => t >= tm[i]!)).toBe(true);
    expect(th.every((t, i) => t <= tm[i]!)).toBe(true);
    // the three home systems stay Tier 0 wherever the Edge goes
    for (const t of [tl, tm, th]) expect(t.filter((x) => x === 0)).toHaveLength(3);
  });

  it('opens a Broken season with its dark systems on the Edge-ward fringe, and relights them at Fed', () => {
    const opening = seasonOpening('broken', 5);
    expect(opening.dark.length).toBeGreaterThanOrEqual(2);
    expect(opening.dark).toEqual(darkSystems(5));
    const tiers = tiersAt(edgeAt(500, opening));
    for (const id of opening.dark) expect(tiers[id]).toBe(5);
    expect(darkAt(500, opening)).toEqual(opening.dark);
    expect(darkAt(FED_FROM - 1, opening)).toEqual(opening.dark);
    expect(darkAt(FED_FROM, opening)).toEqual([]);
    expect(darkAt(1000, opening)).toEqual([]);
    expect(darkAt(0, seasonOpening('held', 5))).toEqual([]);
  });
});

describe('the wall the map and the sky draw', () => {
  it('stands where it did with the Edge at its default, and moves EDGE_WALL_LY_PER_LY for each ly the Edge moves', () => {
    expect(wallX()).toBe(EDGE_X);
    expect(edgeX(0, 0)).toBe(EDGE_X);
    expect(edgeX(0, 0, EDGE_X)).toBe(EDGE_X);
    expect(wallX(EDGE_X + 10)).toBe(EDGE_X + 10 * EDGE_WALL_LY_PER_LY);
    expect(edgeX(3e5, -2e5, EDGE_X - 10) - edgeX(3e5, -2e5)).toBe(-10 * EDGE_WALL_LY_PER_LY);
  });

  it("stays beyond the farthest galaxy and visibly apart at the meter's ends", () => {
    const farthestGalaxy = EDGE_X * 0.8;
    const most = SEASON_EDGE_SHIFT_LY + COUNT_EDGE_SHIFT_LY;
    expect(wallX(EDGE_X - most)).toBeGreaterThan(farthestGalaxy * 1.05);
    // a tenth of the way across the gap to the wall at least, between a Broken and a Fed Count
    expect(wallX(edgeAt(1000, NONE)) - wallX(edgeAt(0, NONE))).toBeGreaterThan(EDGE_X * 0.05);
  });
});
