// The Count meter's arithmetic and the day ledger (DESIGN 16.2): lean, not volume. Synthetic action logs at 3 and 3,000
// accounts lean the world exactly as hard; one vote per account per action type per day; the target, the 25-a-day
// drift, the 5-a-day burn and the underdog bonus.
import { describe, expect, it } from 'vitest';
import { DayLedger } from './ledger.ts';
import {
  addVote,
  BURN_PER_DAY,
  checkVote,
  COUNT_MAX,
  COUNTED_ACTIONS,
  dayOf,
  DRIFT_PER_DAY,
  earnsUnderdogBonus,
  EMPTY_TALLY,
  leanOf,
  rollDay,
  targetOf,
  underdogRepMultiplier,
  underdogSide,
  type CountedAction,
  type CountTag,
  type CountVote,
  type Tally,
} from './meter.ts';

/** A small deterministic generator (mulberry32), so the synthetic logs are the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** One account's votes on the day: the action types it acted on and the side it took on each. */
type Voter = readonly (readonly [CountedAction, CountTag])[];

/**
 * A day's action log for `scale` copies of each voter in `mix`, so 3 voters at scale 1000 are 3,000 accounts. Each
 * account's counted votes come first, in a shuffled order across accounts; then come up to `grind` repeats per account on
 * the same action types, with any tag the action can carry, shuffled: grinding the meter, which must change nothing.
 */
function syntheticLog(mix: readonly Voter[], scale: number, seed: number, grind = 40): CountVote[] {
  const next = rng(seed);
  const first: CountVote[] = [];
  const repeats: CountVote[] = [];
  for (let copy = 0; copy < scale; copy++) {
    mix.forEach((voter, v) => {
      const accountId = `acct-${v}-${copy}`;
      for (const [action, tag] of voter) {
        first.push({ accountId, action, tag });
        const tags = COUNTED_ACTIONS[action].tags;
        const n = Math.floor(next() * grind);
        for (let r = 0; r < n; r++) repeats.push({ accountId, action, tag: tags[Math.floor(next() * tags.length)]! });
      }
    });
  }
  return [...shuffle(first, next), ...shuffle(repeats, next)];
}

function tallyOf(log: Iterable<CountVote>): Tally {
  return new DayLedger(0, log).tally();
}

const F: Voter = [['wall-choice', 'feed']];
const H: Voter = [['wall-choice', 'hold']];
const B: Voter = [['wall-choice', 'break']];

/** Three-account days and the lean each must give, whatever the population. */
const MIXES: { name: string; mix: Voter[]; lean: number }[] = [
  { name: 'all Feed', mix: [F, F, F], lean: 1 },
  { name: 'two Feed, one Break', mix: [F, F, B], lean: 2 / 3 },
  { name: 'one Feed, two Break', mix: [F, B, B], lean: 1 / 3 },
  { name: 'all Break', mix: [B, B, B], lean: 0 },
  { name: 'Feed, Hold, Break', mix: [F, H, B], lean: 4 / 9 },
  { name: 'all Hold', mix: [H, H, H], lean: 1 / 3 },
  {
    name: 'mixed actions',
    mix: [
      [
        ['convoy-escorted', 'feed'],
        ['monolith-touched', 'feed'],
      ],
      [
        ['convoy-raided', 'break'],
        ['warden-killed', 'break'],
      ],
      [
        ['anchor-held', 'hold'],
        ['hive-heart-shattered', 'break'],
      ],
    ],
    // weights in thirtieths: Feed 30 + 3, Break 30 + 30, Hold 30 (10 to Feed) + Break 30
    lean: (30 + 3 + 10) / (33 + 60 + 60),
  },
];

const COUNTS = [0, 3, 140, 299, 300, 380, 480, 500, 512, 700, 701, 840, 850, 975, 1000];

describe('lean, not volume', () => {
  it('gives the same lean, target and drift for the same lean at 3 accounts as at 3,000', () => {
    for (const [i, { name, mix, lean }] of MIXES.entries()) {
      const few = syntheticLog(mix, 1, 100 + i);
      const many = syntheticLog(mix, 1000, 200 + i);
      expect(new Set(few.map((v) => v.accountId)).size, name).toBe(3);
      expect(new Set(many.map((v) => v.accountId)).size, name).toBe(3000);
      expect(many.length, name).toBeGreaterThan(10 * 3000); // the 3,000 grind as well

      const a = tallyOf(few);
      const b = tallyOf(many);
      expect(b.votes, name).toBe(a.votes * 1000);
      expect(leanOf(a), name).toBe(lean);
      expect(leanOf(b), name).toBe(leanOf(a)); // bit for bit, not to a tolerance
      for (const count of COUNTS) {
        const ra = rollDay(count, a);
        const rb = rollDay(count, b);
        expect({ ...rb, votes: 0 }, `${name} from ${count}`).toEqual({ ...ra, votes: 0 });
      }
    }
  });

  it('keeps the same drift over a season of days, whatever the population', () => {
    // 56 days of shifting leans, played out by 3 accounts and by 3,000: the Count walks the same path.
    const next = rng(7);
    let few = 500;
    let many = 500;
    for (let day = 0; day < 56; day++) {
      const { mix } = MIXES[Math.floor(next() * MIXES.length)]!;
      few = rollDay(few, tallyOf(syntheticLog(mix, 1, day, 3))).count;
      many = rollDay(many, tallyOf(syntheticLog(mix, 1000, 1000 + day, 3))).count;
      expect(many, `day ${day}`).toBe(few);
    }
  });

  it('counts one vote per account per action type per day, the first one cast', () => {
    const ledger = new DayLedger(3);
    expect(ledger.vote({ accountId: 'a', action: 'convoy-raided', tag: 'break' })).toBe(true);
    for (let i = 0; i < 1000; i++) expect(ledger.vote({ accountId: 'a', action: 'convoy-raided', tag: 'break' })).toBe(false);
    // the same account on another action type is another vote
    expect(ledger.vote({ accountId: 'a', action: 'wall-choice', tag: 'feed' })).toBe(true);
    // changing sides on an action it already voted on changes nothing
    expect(ledger.vote({ accountId: 'a', action: 'wall-choice', tag: 'break' })).toBe(false);
    expect(ledger.vote({ accountId: 'b', action: 'wall-choice', tag: 'hold' })).toBe(true);
    expect(ledger.has('a', 'wall-choice') && ledger.has('b', 'wall-choice')).toBe(true);
    expect(ledger.has('b', 'convoy-raided')).toBe(false);
    expect(ledger.day).toBe(3);
    // a: Break 30 + Feed 30, b: Hold 30 (10 to Feed)
    expect(ledger.tally()).toEqual({ votes: 3, weight: 90, feed: 40 });

    // one grinder against two who acted once lean the day as three votes
    const grinder: CountVote = { accountId: 'g', action: 'convoy-raided', tag: 'break' };
    const log: CountVote[] = [
      { accountId: 'x', action: 'convoy-escorted', tag: 'feed' },
      { accountId: 'y', action: 'convoy-escorted', tag: 'feed' },
      ...Array.from({ length: 10_000 }, () => grinder),
    ];
    expect(leanOf(tallyOf(log))).toBe(2 / 3);
  });

  it('refuses actions that are not counted and tags an action cannot carry', () => {
    const ledger = new DayLedger(0);
    expect(() => ledger.vote({ accountId: 'a', action: 'sunbathing' as CountedAction, tag: 'feed' })).toThrow(RangeError);
    expect(() => ledger.vote({ accountId: 'a', action: 'warden-killed', tag: 'feed' })).toThrow(RangeError);
    expect(() => ledger.vote({ accountId: 'a', action: 'convoy-raided', tag: 'hold' })).toThrow(RangeError);
    expect(() => ledger.vote({ accountId: 'a', action: 'wall-choice', tag: 'pass' as CountTag })).toThrow(RangeError);
    expect(() => checkVote('toString', 'feed')).toThrow(RangeError); // not a key of the table's prototype either
    expect(ledger.tally()).toEqual(EMPTY_TALLY);
    // a refused vote does not use up the account's vote
    expect(ledger.vote({ accountId: 'a', action: 'warden-killed', tag: 'break' })).toBe(true);
  });
});

describe('lean and target', () => {
  it('has no lean on a day with no votes', () => {
    expect(leanOf(EMPTY_TALLY)).toBeNull();
    expect(rollDay(500, EMPTY_TALLY)).toMatchObject({ votes: 0, lean: null, target: null, drift: 0, burn: 5, count: 495 });
  });

  it('targets 850 at all-Feed, 150 at all-Break and 500 at an even split, in whole measures', () => {
    expect(targetOf(1)).toBe(850);
    expect(targetOf(0)).toBe(150);
    expect(targetOf(0.5)).toBe(500);
    expect(targetOf(2 / 3)).toBe(617); // 616.67
    for (let i = 0; i <= 100; i++) {
      const t = targetOf(i / 100);
      expect(Number.isInteger(t)).toBe(true);
      if (i > 0) expect(t).toBeGreaterThanOrEqual(targetOf((i - 1) / 100));
    }
    expect(() => targetOf(1.01)).toThrow(RangeError);
    expect(() => targetOf(Number.NaN)).toThrow(RangeError);
  });

  it('counts a Hold as a third of a Feed, and a monolith touch as a tenth of a vote', () => {
    const hold = addVote(EMPTY_TALLY, 'wall-choice', 'hold');
    expect(leanOf(hold)).toBe(1 / 3);
    expect(targetOf(leanOf(hold)!)).toBe(383); // an all-Hold world sits inside Held
    // a Feed and a Hold against two Breaks: (1 + 1/3) / 4
    let t = addVote(hold, 'wall-choice', 'feed');
    t = addVote(addVote(t, 'convoy-raided', 'break'), 'warden-killed', 'break');
    expect(leanOf(t)).toBe(1 / 3);
    // ten monolith touches weigh one Break's vote
    let m = addVote(EMPTY_TALLY, 'convoy-raided', 'break');
    for (let i = 0; i < 10; i++) m = addVote(m, 'monolith-touched', 'feed');
    expect(m).toEqual({ votes: 11, weight: 60, feed: 30 });
    expect(leanOf(m)).toBe(0.5);
    // on a day of nothing but touches, the explorers lean the world to Feed
    expect(leanOf(addVote(EMPTY_TALLY, 'monolith-touched', 'feed'))).toBe(1);
  });
});

describe('drift and burn', () => {
  const allFeed = addVote(EMPTY_TALLY, 'wall-choice', 'feed');
  const allBreak = addVote(EMPTY_TALLY, 'wall-choice', 'break');
  const even = addVote(allFeed, 'wall-choice', 'break');

  it('drifts at most 25 a day toward the target and burns 5 under it', () => {
    expect(DRIFT_PER_DAY).toBe(25);
    expect(BURN_PER_DAY).toBe(5);
    expect(rollDay(500, allFeed)).toEqual({ votes: 1, lean: 1, target: 850, from: 500, drift: 25, burn: 5, count: 520 });
    expect(rollDay(500, allBreak)).toEqual({ votes: 1, lean: 0, target: 150, from: 500, drift: -25, burn: 5, count: 470 });
    expect(rollDay(300, even)).toMatchObject({ target: 500, drift: 25, count: 320 });
    expect(rollDay(700, even)).toMatchObject({ target: 500, drift: -25, count: 670 });
  });

  it('never drifts past the target', () => {
    expect(rollDay(840, allFeed)).toMatchObject({ drift: 10, burn: 5, count: 845 });
    expect(rollDay(510, even)).toMatchObject({ drift: -10, burn: 5, count: 495 });
    expect(rollDay(500, even)).toMatchObject({ drift: 0, burn: 5, count: 495 });
    expect(rollDay(495, even)).toMatchObject({ drift: 5, burn: 5, count: 495 });
    expect(rollDay(160, allBreak)).toMatchObject({ drift: -10, burn: 5, count: 145 });
  });

  it('settles 5 below a steady lean’s target, and a quiet world slides to 0 at 5 a day', () => {
    for (const [tally, settle] of [
      [allFeed, 845],
      [even, 495],
      [allBreak, 145],
    ] as const) {
      for (const start of [0, 500, 1000]) {
        let count = start;
        for (let day = 0; day < 60; day++) count = rollDay(count, tally).count;
        expect(count).toBe(settle);
      }
    }
    let count = 500;
    for (let day = 1; day <= 100; day++) {
      count = rollDay(count, EMPTY_TALLY).count;
      expect(count).toBe(500 - 5 * day);
    }
    expect(rollDay(0, EMPTY_TALLY)).toMatchObject({ drift: 0, burn: 0, count: 0 });
    expect(rollDay(3, EMPTY_TALLY)).toMatchObject({ burn: 3, count: 0 });
  });

  it('keeps the Count within 0–1,000 and in whole measures', () => {
    expect(rollDay(COUNT_MAX, allFeed)).toMatchObject({ target: 850, drift: -25, count: 970 });
    expect(rollDay(0, allBreak)).toMatchObject({ target: 150, drift: 25, count: 20 });
    const third = addVote(addVote(EMPTY_TALLY, 'wall-choice', 'feed'), 'wall-choice', 'hold'); // lean 2/3 → 617
    expect(rollDay(600, third)).toMatchObject({ target: 617, drift: 17, count: 612 });
    expect(() => rollDay(500.5, allFeed)).toThrow(RangeError);
    expect(() => rollDay(-1, allFeed)).toThrow(RangeError);
    expect(() => rollDay(1001, allFeed)).toThrow(RangeError);
  });

  it('counts meter days from world time 0 in 86,400 s', () => {
    expect(dayOf(0)).toBe(0);
    expect(dayOf(86_399.999)).toBe(0);
    expect(dayOf(86_400)).toBe(1);
    expect(dayOf(300 * 86_400 + 5)).toBe(300);
  });
});

describe('the underdog', () => {
  it('is the side the meter is against while it sits more than 200 from the middle', () => {
    expect(underdogSide(500)).toBeNull();
    expect(underdogSide(700)).toBeNull();
    expect(underdogSide(300)).toBeNull();
    expect(underdogSide(701)).toBe('break');
    expect(underdogSide(1000)).toBe('break');
    expect(underdogSide(299)).toBe('feed');
    expect(underdogSide(0)).toBe('feed');
  });

  it('earns bonus rep on its own actions, and Hold earns it on either side', () => {
    const cases: [number, CountTag, number][] = [
      [500, 'feed', 1],
      [500, 'hold', 1],
      [500, 'break', 1],
      [750, 'break', 1.5],
      [750, 'hold', 1.5],
      [750, 'feed', 1],
      [250, 'feed', 1.5],
      [250, 'hold', 1.5],
      [250, 'break', 1],
    ];
    for (const [count, tag, multiplier] of cases) {
      expect(underdogRepMultiplier(count, tag), `${tag} at ${count}`).toBe(multiplier);
      expect(earnsUnderdogBonus(count, tag), `${tag} at ${count}`).toBe(multiplier > 1);
    }
  });
});
