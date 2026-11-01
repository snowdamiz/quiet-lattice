// Season rules (DESIGN 16.4, P2.E22.T03): the buckets' edges, a season's length from its month of daily actives and its
// end on a meter midnight, the map the next season opens with, and the titles and glyphs a season awards.
import { describe, expect, it } from 'vitest';
import { countDigits, transliterate } from '../src/art/index.ts';
import {
  ACTIVES_WINDOW_DAYS,
  BUCKET_PHILOSOPHY,
  bucketOf,
  darkSystems,
  meanDailyActives,
  SEASON_DAY_S,
  SEASON_EDGE_SHIFT_LY,
  SEASON_LENGTH_S,
  SMALL_POPULATION_ACTIVES,
  SMALL_SEASON_LENGTH_S,
  seasonAward,
  seasonAwardListSchema,
  seasonAwardSchema,
  seasonEndOf,
  seasonGlyph,
  seasonGlyphOf,
  seasonLengthFor,
  seasonOpening,
  seasonOpeningSchema,
} from '../src/seasons/index.ts';
import { EDGE_X, galaxyTiers, homeSystems } from '../src/world/index.ts';

describe('season buckets', () => {
  it('puts 700 and up in Fed, 300–699 in Held and under 300 in Broken', () => {
    expect([1000, 850, 700].map(bucketOf)).toEqual(['fed', 'fed', 'fed']);
    expect([699, 500, 383, 300].map(bucketOf)).toEqual(['held', 'held', 'held', 'held']);
    expect([299, 150, 0].map(bucketOf)).toEqual(['broken', 'broken', 'broken']);
    expect(() => bucketOf(Number.NaN)).toThrow(RangeError);
  });

  it("names each bucket's philosophy: Fed the Patient's Feed, Held the middle's Hold, Broken the Reaches' Break", () => {
    expect(BUCKET_PHILOSOPHY).toEqual({ fed: 'feed', held: 'hold', broken: 'break' });
  });
});

describe("a season's length and end", () => {
  it('runs four weeks while the mean daily actives are under the threshold, eight from it, eight with no reading', () => {
    expect(SEASON_LENGTH_S).toBe(8 * 7 * 86_400);
    expect(SMALL_SEASON_LENGTH_S).toBe(4 * 7 * 86_400);
    expect(seasonLengthFor(null)).toBe(SEASON_LENGTH_S);
    expect(seasonLengthFor(0)).toBe(SMALL_SEASON_LENGTH_S);
    expect(seasonLengthFor(SMALL_POPULATION_ACTIVES - 0.01)).toBe(SMALL_SEASON_LENGTH_S);
    expect(seasonLengthFor(SMALL_POPULATION_ACTIVES)).toBe(SEASON_LENGTH_S);
    expect(seasonLengthFor(5000)).toBe(SEASON_LENGTH_S);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => seasonLengthFor(bad)).toThrow(RangeError);
  });

  it('takes the mean over the month of meter days before the start day, counting a day nobody played as none', () => {
    const actives = new Map([
      [69, 1000], // the start day itself: not in the window
      [68, 30],
      [40, 60],
      [38, 9000], // a day before the window (days 39–68 are in it)
    ]);
    const at = (d: number) => actives.get(d) ?? 0;
    expect(ACTIVES_WINDOW_DAYS).toBe(30);
    expect(meanDailyActives(at, 69)).toBe(3);
    expect(meanDailyActives(() => 120, 10)).toBe(120);
  });

  it('ends on the first meter midnight at or after its start plus its length', () => {
    expect(seasonEndOf(10 * SEASON_DAY_S, SMALL_SEASON_LENGTH_S)).toBe(38 * SEASON_DAY_S);
    // a first season, begun when its shard first booted at 01:00, runs to the midnight after its eighth week
    expect(seasonEndOf(10 * SEASON_DAY_S + 3600, SEASON_LENGTH_S)).toBe(67 * SEASON_DAY_S);
    expect(seasonEndOf(10 * SEASON_DAY_S + 0.25, SEASON_LENGTH_S)).toBe(67 * SEASON_DAY_S);
    expect(() => seasonEndOf(-1, SEASON_LENGTH_S)).toThrow(RangeError);
    expect(() => seasonEndOf(0, 0)).toThrow(RangeError);
    expect(() => seasonEndOf(0, 1.5)).toThrow(RangeError);
  });
});

describe("the next season's map", () => {
  const edgeWardAdvanced = new Set(
    galaxyTiers(EDGE_X - SEASON_EDGE_SHIFT_LY)
      .filter((s) => s.edgeWard && s.tier === 5)
      .map((s) => s.id),
  );

  it('recedes the Edge after Fed, advances it after Broken, and keeps the baseline after Held and for the first season', () => {
    expect(seasonOpening('fed', 2)).toEqual({ from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] });
    expect(seasonOpening('held', 2)).toEqual({ from: 'held', edgeShiftLy: 0, dark: [] });
    expect(seasonOpening(null, 1)).toEqual({ from: null, edgeShiftLy: 0, dark: [] });
    const broken = seasonOpening('broken', 2);
    expect(broken).toMatchObject({ from: 'broken', edgeShiftLy: -SEASON_EDGE_SHIFT_LY });
    expect(broken.dark).toEqual(darkSystems(2));
    for (const o of [seasonOpening('fed', 2), broken]) expect(seasonOpeningSchema.parse(o)).toEqual(o);
  });

  it('darkens two or three Edge-ward systems of the advanced Edge, the same ones for the same season every time', () => {
    const homes = new Set(homeSystems().map((h) => h.systemIndex));
    const sizes = new Set<number>();
    const sets = new Set<string>();
    for (let season = 1; season <= 40; season++) {
      const dark = darkSystems(season);
      expect(dark).toEqual(darkSystems(season));
      expect(dark.length === 2 || dark.length === 3).toBe(true);
      expect(dark).toEqual([...dark].sort((a, b) => a - b));
      expect(new Set(dark).size).toBe(dark.length);
      for (const id of dark) {
        expect(edgeWardAdvanced.has(id), `system ${id} in season ${season}`).toBe(true);
        expect(homes.has(id)).toBe(false);
      }
      sizes.add(dark.length);
      sets.add(dark.join(','));
    }
    expect([...sizes].sort()).toEqual([2, 3]);
    expect(sets.size).toBeGreaterThan(10);
    expect(() => darkSystems(0)).toThrow(RangeError);
  });
});

describe('season titles and glyphs', () => {
  it("awards the winning philosophy's title and a glyph that writes its word ringed by the season's numeral", () => {
    expect(seasonAward(3, 'fed')).toEqual({ season: 3, bucket: 'fed', title: 'Seedbearer', glyph: 'season_3_fed' });
    expect(seasonAward(3, 'held')).toEqual({ season: 3, bucket: 'held', title: 'Keeper of the Middle', glyph: 'season_3_held' });
    expect(seasonAward(14, 'broken')).toEqual({ season: 14, bucket: 'broken', title: 'Anchorbreaker', glyph: 'season_14_broken' });
    for (const b of ['fed', 'held', 'broken'] as const) expect(seasonAwardSchema.parse(seasonAward(9, b))).toEqual(seasonAward(9, b));

    const g = seasonGlyph(14, 'broken');
    expect(g).toMatchObject({ id: 'season_14_broken', season: 14, bucket: 'broken', word: 'free', places: ['suit', 'hull'] });
    expect(g.signs).toEqual(transliterate('free').map((s) => s.strokes));
    expect(g.numeral).toEqual(countDigits(14));
    expect(seasonGlyphOf('season_14_broken')).toEqual(g);
    for (const bad of ['season_0_fed', 'season_3_lost', 'season_3', 'Season_3_fed', 'season_03_fed']) expect(seasonGlyphOf(bad), bad).toBeNull();
    expect(() => seasonGlyph(0, 'fed')).toThrow(RangeError);
  });

  it('holds one award a season, oldest first', () => {
    const list = [seasonAward(1, 'fed'), seasonAward(4, 'broken')];
    expect(seasonAwardListSchema.parse(list)).toEqual(list);
    expect(seasonAwardListSchema.safeParse([...list].reverse()).success).toBe(false);
    expect(seasonAwardListSchema.safeParse([list[0], list[0]]).success).toBe(false);
  });
});
