// The Count meter's arithmetic (DESIGN 16.1–16.2: lean, not volume). Pure and deterministic: the same votes give the
// same numbers on any engine, using only + − × ÷, floor, round, min and max, which IEEE 754 makes exact.
//
// Every counted action is a vote tagged Feed, Hold or Break; per DESIGN 16.2, "a Hold counts as a full vote of which a
// third is Feed", so a day of only Hold choices leans a third Feed and targets 383, inside Held. A day's votes are summed
// in thirtieths of a vote, so the tally is whole numbers however many accounts voted: a vote weighs 30 (a tiny action,
// the monolith touch, weighs 3) and gives the Feed side 30 for Feed, 10 for Hold and 0 for Break. The lean is Feed's
// share of the weight, the same fraction of the same whole numbers at three accounts as at three thousand, hence the same
// double. One vote per account per action type per day is the ledger's rule (ledger.ts); this file never sees duplicates.
//
// Two clocks move the Count, both on shard world time from the epoch: the burn takes one measure every BURN_STEP_S
// (17,280 s, so 5 a day), and at each day's end the day's lean drifts the Count toward its target by up to 25. A burn
// tick that falls on a day's end belongs to the ending day and goes first, so the drift reads the Count after it.

/** The Count runs 0–1,000 measures (DESIGN 16.1); it is kept in whole measures. */
export const COUNT_MIN = 0;
export const COUNT_MAX = 1000;
/** Where a season starts the Count (DESIGN 16.4). */
export const COUNT_START = 500;
/** The middle of the meter: the target of an even split. */
export const COUNT_MIDDLE = 500;
/** The target at an all-Feed and at an all-Break lean (DESIGN 16.2). */
export const TARGET_ALL_FEED = 850;
export const TARGET_ALL_BREAK = 150;
/** The most the Count drifts toward its target in a day (DESIGN 16.2). */
export const DRIFT_PER_DAY = 25;
/** What the Count burns on its own every day (DESIGN 16.2), one measure at a time. */
export const BURN_PER_DAY = 5;
/** The underdog side earns bonus rep while the Count sits more than this far from the middle (DESIGN 16.2). */
export const UNDERDOG_DISTANCE = 200;
/** The rep multiplier the underdog side's counted actions earn (DESIGN gives no number). */
export const UNDERDOG_REP_MULTIPLIER = 1.5;
/** A meter day in world seconds: day d runs from world time d × DAY_S to (d + 1) × DAY_S. */
export const DAY_S = 86_400;
/** World seconds between burns: one measure every 4.8 hours (DESIGN 16.1–16.2). Burn tick k falls at k × BURN_STEP_S. */
export const BURN_STEP_S = DAY_S / BURN_PER_DAY;

export const COUNT_TAGS = ['feed', 'hold', 'break'] as const;
export type CountTag = (typeof COUNT_TAGS)[number];
/** A side of the lean. Hold sits between them. */
export type CountSide = 'feed' | 'break';

/** What each tag gives the Feed side, in thirds of a vote: a Hold is a full vote of which a third is Feed. */
const FEED_THIRDS: Readonly<Record<CountTag, number>> = { feed: 3, hold: 1, break: 0 };

/**
 * The counted actions of DESIGN 16.2: the tags each can carry and its weight in tenths of a vote. The tag is the
 * player's side when the action has one (the wall, an anchor); the monolith touch is "a tiny Feed", a tenth of a vote.
 */
export const COUNTED_ACTIONS = {
  /** A Passage convoy escorted to its destination. */
  'convoy-escorted': { tags: ['feed'], tenths: 10 },
  /** A Passage convoy raided and its pilots freed. */
  'convoy-raided': { tags: ['break'], tenths: 10 },
  /** A Feed, Hold or Break choice at the wall. */
  'wall-choice': { tags: ['feed', 'hold', 'break'], tenths: 10 },
  /** An anchor held by a philosophy at the week's end. */
  'anchor-held': { tags: ['feed', 'hold', 'break'], tenths: 10 },
  'hive-heart-shattered': { tags: ['break'], tenths: 10 },
  'warden-killed': { tags: ['break'], tenths: 10 },
  /** A monolith touched: everyone is copied. */
  'monolith-touched': { tags: ['feed'], tenths: 1 },
} as const satisfies Record<string, { tags: readonly CountTag[]; tenths: number }>;
export type CountedAction = keyof typeof COUNTED_ACTIONS;

/** A counted action by an account. */
export interface CountVote {
  accountId: string;
  action: CountedAction;
  tag: CountTag;
}

/** A day's votes summed. `weight` and `feed` are in thirtieths of a vote, so always whole numbers. */
export interface Tally {
  readonly votes: number;
  readonly weight: number;
  readonly feed: number;
}

export const EMPTY_TALLY: Tally = Object.freeze({ votes: 0, weight: 0, feed: 0 });

/** What one day's lean did to the Count at the day's end. */
export interface DayRoll {
  readonly votes: number;
  /** Feed's share of the day's weight, 0–1; null on a day with no votes. */
  readonly lean: number | null;
  /** The Count the lean pulls toward; null with no lean. */
  readonly target: number | null;
  /** The Count at the day's end, before the drift. */
  readonly from: number;
  /** Toward the target, at most DRIFT_PER_DAY either way, never past it; 0 with no lean. */
  readonly drift: number;
  /** The Count after the drift. */
  readonly count: number;
}

/** A day's roll, with its day. */
export interface RolledDay extends DayRoll {
  readonly day: number;
}

/** How far the meter has run: the Count, the last burn tick applied and the day whose votes are open. */
export interface MeterPosition {
  readonly count: number;
  /** Burn ticks up to and including this one are in the Count. */
  readonly burnStep: number;
  /** The open day: every day before it has rolled. */
  readonly day: number;
}

/** What playing the meter forward did. */
export interface MeterRun {
  readonly position: MeterPosition;
  /** The days that rolled, oldest first. */
  readonly rolls: readonly RolledDay[];
  /** Burn ticks that fell (a tick at 0 burns nothing). */
  readonly burns: number;
}

/** The meter day world time `time` (s) falls in. */
export function dayOf(time: number): number {
  return Math.floor(time / DAY_S);
}

/** The last burn tick at or before world time `time` (s). */
export function burnStepOf(time: number): number {
  return Math.floor(time / BURN_STEP_S);
}

export function isCountedAction(action: string): action is CountedAction {
  return Object.hasOwn(COUNTED_ACTIONS, action);
}

/** Throws RangeError unless `action` is a counted action that can carry `tag`. */
export function checkVote(action: string, tag: string): asserts action is CountedAction {
  if (!isCountedAction(action)) throw new RangeError(`"${action}" is not a counted action`);
  if (!(COUNTED_ACTIONS[action].tags as readonly string[]).includes(tag)) throw new RangeError(`"${action}" cannot be tagged "${tag}"`);
}

/** `t` with one more vote. Throws RangeError for an action that does not exist or cannot carry the tag. */
export function addVote(t: Tally, action: CountedAction, tag: CountTag): Tally {
  checkVote(action, tag);
  const tenths = COUNTED_ACTIONS[action].tenths;
  return { votes: t.votes + 1, weight: t.weight + tenths * 3, feed: t.feed + tenths * FEED_THIRDS[tag] };
}

/** Feed's share of the tally's weight, 0–1 (DESIGN 16.2); null for a day with no votes, which has no lean. */
export function leanOf(t: Tally): number | null {
  return t.weight > 0 ? t.feed / t.weight : null;
}

/** The Count a lean pulls toward, in whole measures: 850 at all-Feed, 150 at all-Break, 500 at an even split. */
export function targetOf(lean: number): number {
  if (!(lean >= 0 && lean <= 1)) throw new RangeError(`a lean is 0–1, not ${lean}`);
  return Math.round(TARGET_ALL_BREAK + (TARGET_ALL_FEED - TARGET_ALL_BREAK) * lean);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function checkCount(count: number): void {
  if (!(Number.isInteger(count) && count >= COUNT_MIN && count <= COUNT_MAX)) {
    throw new RangeError(`the Count is a whole number of measures in ${COUNT_MIN}–${COUNT_MAX}, not ${count}`);
  }
}

/**
 * A day's end (DESIGN 16.2): the Count drifts toward the day's lean's target by up to DRIFT_PER_DAY, never past it. A day
 * with no votes has no lean and no drift. Throws RangeError for a Count that is not a whole number of measures in 0–1,000.
 */
export function rollDay(count: number, tally: Tally): DayRoll {
  checkCount(count);
  const lean = leanOf(tally);
  const target = lean === null ? null : targetOf(lean);
  const drift = target === null ? 0 : clamp(target - count, -DRIFT_PER_DAY, DRIFT_PER_DAY);
  return { votes: tally.votes, lean, target, from: count, drift, count: count + drift };
}

/** One burn tick: a measure less, never below 0. */
export function burnOnce(count: number): number {
  checkCount(count);
  return Math.max(COUNT_MIN, count - 1);
}

/**
 * Plays the meter forward from `from` to world time `until` (s): every burn tick and every day's end at or before it, in
 * time order, a burn first when both fall at once. `tally(day)` gives an ended day's votes; it is asked for each day in
 * turn, oldest first. Returns where the meter stands, the days that rolled and the burn ticks that fell.
 */
export function runMeter(from: MeterPosition, until: number, tally: (day: number) => Tally): MeterRun {
  let { count, burnStep, day } = from;
  checkCount(count);
  const rolls: RolledDay[] = [];
  let burns = 0;
  for (;;) {
    const burnAt = (burnStep + 1) * BURN_STEP_S;
    const dayEnd = (day + 1) * DAY_S;
    if (burnAt <= dayEnd && burnAt <= until) {
      count = burnOnce(count);
      burnStep++;
      burns++;
    } else if (dayEnd <= until) {
      const roll = rollDay(count, tally(day));
      rolls.push({ day, ...roll });
      count = roll.count;
      day++;
    } else {
      return { position: { count, burnStep, day }, rolls, burns };
    }
  }
}

/**
 * The side the lean is against while the Count sits more than UNDERDOG_DISTANCE from the middle (DESIGN 16.2): Break
 * above 700, Feed below 300, otherwise none. The Count is the lean accumulated, so it names the side the lean has been
 * against, and it is the side that pulls the meter back toward the middle.
 */
export function underdogSide(count: number): CountSide | null {
  if (count > COUNT_MIDDLE + UNDERDOG_DISTANCE) return 'break';
  if (count < COUNT_MIDDLE - UNDERDOG_DISTANCE) return 'feed';
  return null;
}

/**
 * Whether a counted action tagged `tag` earns the underdog's bonus rep with the Count at `count`: the underdog side's
 * own tag does, and so does Hold on either side, because an all-Hold lean targets 383, inside Held, so a Hold vote always
 * pulls the meter back toward the middle.
 */
export function earnsUnderdogBonus(count: number, tag: CountTag): boolean {
  const side = underdogSide(count);
  return side !== null && (tag === side || tag === 'hold');
}

/** The multiplier on rep earned by a counted action tagged `tag` with the Count at `count`. */
export function underdogRepMultiplier(count: number, tag: CountTag): number {
  return earnsUnderdogBonus(count, tag) ? UNDERDOG_REP_MULTIPLIER : 1;
}
