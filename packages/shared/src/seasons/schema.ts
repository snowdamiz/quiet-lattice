// Seasons as data (DESIGN 16.4; P2.E22.T03; ARCHITECTURE §27): the buckets a season ends in, the map a season opens with,
// the titles and glyphs a season awards, and the chronicle a finished season leaves. Zod schemas both ends validate with,
// and the constants they bound.
//
// This module imports nothing of the world: the protocol imports it, never the other way round (rules.ts holds what reads
// the galaxy and the glyph alphabet).
import { z } from 'zod';

/** A meter day, in world seconds (the server's count/meter.ts DAY_S): a season starts and ends on one of its midnights. */
export const SEASON_DAY_S = 86_400;
export const SEASON_WEEK_S = 7 * SEASON_DAY_S;
/** A season's length by default (DESIGN 16.4): eight weeks. */
export const SEASON_WEEKS = 8;
/** A season's length while the active population is small (DESIGN 16.4): four weeks. */
export const SMALL_SEASON_WEEKS = 4;
export const SEASON_LENGTH_S = SEASON_WEEKS * SEASON_WEEK_S;
export const SMALL_SEASON_LENGTH_S = SMALL_SEASON_WEEKS * SEASON_WEEK_S;

/** The ways a season can end (DESIGN 16.4), by where the Count stands at its end. */
export const SEASON_BUCKETS = ['fed', 'held', 'broken'] as const;
export const seasonBucketSchema = z.enum(SEASON_BUCKETS);
export type SeasonBucket = z.infer<typeof seasonBucketSchema>;
/** Fed is 700 and up (DESIGN 16.4 "700+"); Held 300–699; Broken under 300. */
export const FED_FROM = 700;
export const BROKEN_BELOW = 300;

/** The three philosophies of the wall (DESIGN 8, ch. 25), each the way to one bucket. */
export const PHILOSOPHIES = ['feed', 'hold', 'break'] as const;
export const philosophySchema = z.enum(PHILOSOPHIES);
export type Philosophy = z.infer<typeof philosophySchema>;
/** Whose way a bucket is: Fed the Patient's (Feed), Held the long middle (Hold), Broken the Reaches' (Break). */
export const BUCKET_PHILOSOPHY: Readonly<Record<SeasonBucket, Philosophy>> = Object.freeze({ fed: 'feed', held: 'hold', broken: 'break' });

/** The bucket the Count ends a season in: Fed at FED_FROM and up, Broken below BROKEN_BELOW, Held between. */
export function bucketOf(count: number): SeasonBucket {
  if (!Number.isFinite(count)) throw new RangeError(`the Count is a number of measures, not ${count}`);
  if (count >= FED_FROM) return 'fed';
  if (count < BROKEN_BELOW) return 'broken';
  return 'held';
}

/** The most systems a season opens dark: Broken darkens two or three (DESIGN 16.4). */
export const DARK_SYSTEMS_MAX = 3;
/** Galaxy system indices are under this (the protocol's bound). */
const SYSTEM_MAX = 1023;

/**
 * The map a season opens with (DESIGN 16.4), from how the season before it ended (`from`; null for the first season):
 * how far the Edge stands from where it would by default (light years along +X: out, it recedes; in, it advances) and
 * the galaxy systems that start dark. It is data: the Edge following the meter (P2.E22.T02) applies it.
 */
export const seasonOpeningSchema = z.strictObject({
  from: seasonBucketSchema.nullable(),
  edgeShiftLy: z.number().min(-1000).max(1000),
  dark: z
    .array(z.int().min(0).max(SYSTEM_MAX))
    .max(DARK_SYSTEMS_MAX)
    .refine((d) => new Set(d).size === d.length, 'a system is dark once'),
});
export type SeasonOpening = z.infer<typeof seasonOpeningSchema>;

/** A season's number: from 1. */
export const seasonNumberSchema = z.int().min(1).max(1_000_000);
/** A season glyph's id: `season_<n>_<bucket>` (rules.ts seasonGlyph draws it). */
export const seasonGlyphIdSchema = z.string().regex(/^season_[1-9]\d{0,6}_(fed|held|broken)$/);
/** A season title's words, as the server names it (SEASON_HONOURS). */
export const seasonTitleSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[A-Za-z]+(?: [A-Za-z]+)*$/);

/** What a season gave a character of its winning philosophy (DESIGN 16.4): the season, how it ended, its title and glyph. */
export const seasonAwardSchema = z.strictObject({
  season: seasonNumberSchema,
  bucket: seasonBucketSchema,
  title: seasonTitleSchema,
  glyph: seasonGlyphIdSchema,
});
export type SeasonAward = z.infer<typeof seasonAwardSchema>;
/** The most season awards a character holds: one a season, for decades of eight-week seasons. */
export const AWARDS_MAX = 256;
/** A character's season awards, oldest season first, one per season. */
export const seasonAwardListSchema = z
  .array(seasonAwardSchema)
  .max(AWARDS_MAX)
  .refine((a) => a.every((x, i) => i === 0 || a[i - 1]!.season < x.season), 'one award a season, oldest first');
/** The `seasonAwards` persistence component's value (v1). */
export const storedSeasonAwardsSchema = z.strictObject({ awards: seasonAwardListSchema });
export type StoredSeasonAwards = z.infer<typeof storedSeasonAwardsSchema>;

/** One day of a season's meter (the day's roll, DESIGN 16.2): the Count after it, its drift, lean and votes. */
export const chronicleDaySchema = z.strictObject({
  day: z.int().min(0),
  count: z.int().min(0).max(1000),
  drift: z.int().min(-25).max(25),
  lean: z.number().min(0).max(1).nullable(),
  votes: z.int().min(0),
});
export type ChronicleDay = z.infer<typeof chronicleDaySchema>;
/** A notable first find of the season (P2.E29.T01 names them): what it is, its name, who named it and when. */
export const chronicleFindSchema = z.strictObject({
  kind: z.string().min(1).max(24),
  name: z.string().min(1).max(64),
  by: z.string().max(64).nullable(),
  at: z.number().min(0),
});
export type ChronicleFind = z.infer<typeof chronicleFindSchema>;
/** The most days a chronicle's path holds: an eight-week season and the first one's partial day, with room. */
export const CHRONICLE_DAYS_MAX = 128;
/** The most first finds a chronicle names. */
export const CHRONICLE_FINDS_MAX = 64;

/**
 * A finished season's chronicle (DESIGN 16.4, `GET /seasons/:season/chronicle`): what the server did. When it ran (world
 * times), how long it was and the mean daily actives that length was chosen from (null: the first season, which took the
 * default), the map it opened with, the meter's path (each day's roll), where the Count ended and so the bucket, whose way
 * won and the title and glyph it gave to how many accounts, the map the next season opens with, and the season's notable
 * first finds.
 */
export const seasonChronicleSchema = z.strictObject({
  season: seasonNumberSchema,
  start: z.number().min(0),
  end: z.number().min(0),
  length: z.int().positive(),
  actives: z.number().min(0).nullable(),
  opening: seasonOpeningSchema,
  path: z.array(chronicleDaySchema).max(CHRONICLE_DAYS_MAX),
  count: z.int().min(0).max(1000),
  bucket: seasonBucketSchema,
  philosophy: philosophySchema,
  title: seasonTitleSchema,
  glyph: seasonGlyphIdSchema,
  awarded: z.int().min(0),
  next: seasonOpeningSchema,
  finds: z.array(chronicleFindSchema).max(CHRONICLE_FINDS_MAX),
});
export type SeasonChronicle = z.infer<typeof seasonChronicleSchema>;
