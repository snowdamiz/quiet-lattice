// Season rules that read the galaxy and the glyph alphabet (DESIGN 16.4; P2.E22.T03; ARCHITECTURE §27): how long a season
// runs and where it ends, the map the next one opens with, and the title and glyph a season gives. Pure and deterministic:
// the server decides with them, and a client can draw what the server sent with the same functions.
import { countDigits, transliterate, type Stroke } from '../art/glyphs.ts';
import { EDGE_X } from '../world/edge.ts';
import { GALAXY_SEED } from '../world/galaxy.ts';
import { hashInts, Random } from '../world/rng.ts';
import { galaxyTiers } from '../world/tiers.ts';
import { DARK_SYSTEMS_MAX, SEASON_DAY_S, SEASON_LENGTH_S, SMALL_SEASON_LENGTH_S, type SeasonAward, type SeasonBucket, type SeasonOpening } from './schema.ts';

/** A season's length is chosen from the mean daily actives of this many meter days before it starts (DESIGN 16.4: "the
 * last month's daily actives"). */
export const ACTIVES_WINDOW_DAYS = 30;
/** A population is small (the season runs four weeks) while its mean daily actives over that month are under this: a
 * choice (DESIGN gives no number), between DESIGN 16.6's "three people are online" and a server that fills a capital. */
export const SMALL_POPULATION_ACTIVES = 100;

/**
 * A season's length (s) from the mean daily actives of the month before it (DESIGN 16.4): four weeks while that is under
 * SMALL_POPULATION_ACTIVES, eight otherwise. With no reading (null: the first season, which has no month before it) the
 * default, eight. Throws RangeError for a negative or non-finite mean.
 */
export function seasonLengthFor(meanActives: number | null): number {
  if (meanActives === null) return SEASON_LENGTH_S;
  if (!(meanActives >= 0 && Number.isFinite(meanActives))) throw new RangeError(`a mean of daily actives is a number from 0 up, not ${meanActives}`);
  return meanActives < SMALL_POPULATION_ACTIVES ? SMALL_SEASON_LENGTH_S : SEASON_LENGTH_S;
}

/** The mean of `activesOn(d)` (distinct accounts active on meter day d) over the ACTIVES_WINDOW_DAYS days before `day`; a
 * day nobody played counts as none. */
export function meanDailyActives(activesOn: (day: number) => number, day: number): number {
  let sum = 0;
  for (let d = day - ACTIVES_WINDOW_DAYS; d < day; d++) sum += activesOn(d);
  return sum / ACTIVES_WINDOW_DAYS;
}

/**
 * World time (s) a season that began at `start` and runs `length` seconds ends: the first meter midnight at or after
 * start + length. So every season after the first starts and ends on midnights, and each meter day, its votes and its
 * drift belong to one season; the first, which starts when its shard first booted, runs up to a day longer.
 */
export function seasonEndOf(start: number, length: number): number {
  if (!(Number.isFinite(start) && start >= 0)) throw new RangeError(`a season starts at a world time from 0, not ${start}`);
  if (!(Number.isInteger(length) && length > 0)) throw new RangeError(`a season's length is a whole number of seconds, not ${length}`);
  return Math.ceil((start + length) / SEASON_DAY_S) * SEASON_DAY_S;
}

/** How far the Edge stands out (Fed) or in (Broken) of its default at a season's opening, in light years: at seed 424242
 * the Edge-ward fringe goes from 6 systems to 1 as it recedes and to 10 as it advances (DESIGN 16.3 "a few systems"). */
export const SEASON_EDGE_SHIFT_LY = 10;
/** The fewest systems a Broken season's successor opens dark (DESIGN 16.4: "two or three"). */
export const DARK_SYSTEMS_MIN = 2;
const DARK_SALT = 0x5ea5;

/**
 * The 2–3 galaxy systems a season opens dark after a Broken one (DESIGN 16.3–16.4: "Edge-ward systems flip to Tier 5; their
 * Waystations go dark"): drawn from the Edge-ward fringe with the Edge advanced SEASON_EDGE_SHIFT_LY, by the galaxy's seed
 * and the season's number, so the same season darkens the same systems on every run. Ascending.
 */
export function darkSystems(season: number, galaxySeed: number = GALAXY_SEED): number[] {
  if (!(Number.isInteger(season) && season >= 1)) throw new RangeError(`a season is a whole number from 1, not ${season}`);
  const candidates = galaxyTiers(EDGE_X - SEASON_EDGE_SHIFT_LY, galaxySeed)
    .filter((s) => s.edgeWard && s.tier === 5)
    .map((s) => s.id);
  const rng = new Random(hashInts(galaxySeed, season, DARK_SALT));
  const n = Math.min(candidates.length, rng.int(DARK_SYSTEMS_MIN, DARK_SYSTEMS_MAX));
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng.next() * (candidates.length - i));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  return candidates.slice(0, n).sort((a, b) => a - b);
}

/**
 * The map season `season` opens with after a season that ended in `from` (DESIGN 16.4; null: nothing ended before it):
 * after Fed the Edge recedes SEASON_EDGE_SHIFT_LY; after Broken it advances as far and 2–3 systems start dark
 * (darkSystems); after Held, and for the first season, the baseline. Never cumulative: each season's map comes from the
 * one season before it.
 */
export function seasonOpening(from: SeasonBucket | null, season: number, galaxySeed: number = GALAXY_SEED): SeasonOpening {
  switch (from) {
    case 'fed':
      return { from, edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] };
    case 'broken':
      return { from, edgeShiftLy: -SEASON_EDGE_SHIFT_LY, dark: darkSystems(season, galaxySeed) };
    case 'held':
    case null:
      return { from, edgeShiftLy: 0, dark: [] };
  }
}

/** What a season gives its winning philosophy's players (DESIGN 16.4): the title, and the word its glyph writes in the
 * Cartographer alphabet (Fed: your copy goes with the seed; Held: the long middle; Broken: the living are free). */
export const SEASON_HONOURS: Readonly<Record<SeasonBucket, { readonly title: string; readonly word: string }>> = Object.freeze({
  fed: Object.freeze({ title: 'Seedbearer', word: 'seed' }),
  held: Object.freeze({ title: 'Keeper of the Middle', word: 'hold' }),
  broken: Object.freeze({ title: 'Anchorbreaker', word: 'free' }),
});

/** Where a season glyph is worn: a suit glyph and a hull glyph seam (DESIGN 15.7). */
export const SEASON_GLYPH_PLACES = Object.freeze(['suit', 'hull'] as const);

/** A season's glyph as a cosmetic record (DESIGN 16.4; drawn by the client, art-bible §3): the philosophy's word in signs,
 * ringed by the season's number as a Count numeral (base-6 digits, units first), worn on the suit and the hull. */
export interface SeasonGlyph {
  readonly id: string;
  readonly season: number;
  readonly bucket: SeasonBucket;
  readonly word: string;
  /** Each sign's strokes, in reading order. */
  readonly signs: readonly (readonly Stroke[])[];
  readonly numeral: readonly number[];
  readonly places: typeof SEASON_GLYPH_PLACES;
}

export function seasonGlyphId(season: number, bucket: SeasonBucket): string {
  return `season_${season}_${bucket}`;
}

/** Season `season`'s glyph for a season that ended in `bucket`. */
export function seasonGlyph(season: number, bucket: SeasonBucket): SeasonGlyph {
  if (!(Number.isInteger(season) && season >= 1)) throw new RangeError(`a season is a whole number from 1, not ${season}`);
  const { word } = SEASON_HONOURS[bucket];
  return {
    id: seasonGlyphId(season, bucket),
    season,
    bucket,
    word,
    signs: transliterate(word).map((s) => s.strokes),
    numeral: countDigits(season),
    places: SEASON_GLYPH_PLACES,
  };
}

/** The glyph an award names (`season_<n>_<bucket>`), or null for an id that names none. */
export function seasonGlyphOf(id: string): SeasonGlyph | null {
  const m = /^season_([1-9]\d{0,6})_(fed|held|broken)$/.exec(id);
  return m ? seasonGlyph(Number(m[1]), m[2] as SeasonBucket) : null;
}

/** What season `season`, ended in `bucket`, awards each of its winning philosophy's players. */
export function seasonAward(season: number, bucket: SeasonBucket): SeasonAward {
  return { season, bucket, title: SEASON_HONOURS[bucket].title, glyph: seasonGlyph(season, bucket).id };
}
