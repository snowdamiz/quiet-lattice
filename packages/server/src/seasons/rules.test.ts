// A season's roll as the server decides it (DESIGN 16.4, P2.E22.T03): its end on a midnight, its bucket, the next season's
// length from the month's daily actives and its map, and the winning philosophy's players from their own lean.
import { darkSystems, SEASON_DAY_S, SEASON_EDGE_SHIFT_LY, SEASON_LENGTH_S, SMALL_POPULATION_ACTIVES, SMALL_SEASON_LENGTH_S } from '@astra/shared/seasons';
import { describe, expect, it } from 'vitest';
import type { CountVote } from '../count/meter.ts';
import { accountLeans, endSeason, seasonWinners, TITLE_MIN_WEIGHT, type SeasonPosition } from './rules.ts';

const FIRST: SeasonPosition = { season: 1, start: 10 * SEASON_DAY_S + 3600, length: SEASON_LENGTH_S, actives: null, opening: { from: null, edgeShiftLy: 0, dark: [] } };

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const E = '00000000-0000-4000-8000-00000000000e';
const F = '00000000-0000-4000-8000-00000000000f';

describe('ending a season', () => {
  it('ends on the midnight after its length, in the bucket of the Count there, and hands on to the next season', () => {
    const e = endSeason(FIRST, 742, 3.5);
    expect(e).toMatchObject({ ...FIRST, end: 67 * SEASON_DAY_S, count: 742, bucket: 'fed' });
    expect(e.next).toEqual({ season: 2, start: 67 * SEASON_DAY_S, length: SMALL_SEASON_LENGTH_S, actives: 3.5, opening: { from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] } });
  });

  it('pins the bucket edges: 700 is Fed, 699 and 300 Held, 299 Broken', () => {
    expect(endSeason(FIRST, 700, 0).bucket).toBe('fed');
    expect(endSeason(FIRST, 699, 0).bucket).toBe('held');
    expect(endSeason(FIRST, 300, 0).bucket).toBe('held');
    expect(endSeason(FIRST, 299, 0).bucket).toBe('broken');
  });

  it("chooses the next season's length from the month's mean daily actives: four weeks under the threshold, eight from it", () => {
    expect(endSeason(FIRST, 500, SMALL_POPULATION_ACTIVES - 1).next.length).toBe(SMALL_SEASON_LENGTH_S);
    expect(endSeason(FIRST, 500, SMALL_POPULATION_ACTIVES).next.length).toBe(SEASON_LENGTH_S);
    expect(endSeason(FIRST, 500, 0).next).toMatchObject({ length: SMALL_SEASON_LENGTH_S, actives: 0 });
  });

  it('leaves the next season the map its bucket makes: the Edge advanced and two or three systems dark after Broken', () => {
    const second = endSeason(FIRST, 150, 120).next;
    expect(second.opening).toEqual({ from: 'broken', edgeShiftLy: -SEASON_EDGE_SHIFT_LY, dark: darkSystems(2) });
    expect(endSeason(FIRST, 500, 120).next.opening).toEqual({ from: 'held', edgeShiftLy: 0, dark: [] });
    // a season after a Broken one that ends Held opens on the baseline again: the map is never cumulative
    const third = endSeason(second, 450, 120);
    expect(third).toMatchObject({ season: 2, end: second.start + SEASON_LENGTH_S, bucket: 'held' });
    expect(third.next).toMatchObject({ season: 3, start: third.end, opening: { from: 'held', edgeShiftLy: 0, dark: [] } });
  });
});

describe("the winning philosophy's players", () => {
  const vote = (accountId: string, action: CountVote['action'], tag: CountVote['tag']): CountVote => ({ accountId, action, tag });
  const votes: CountVote[] = [
    // A fed all season; B fed and held (lean 4/6: target 617, Held); C only held (target 383, Held); D broke
    vote(A, 'convoy-escorted', 'feed'),
    vote(A, 'wall-choice', 'feed'),
    vote(B, 'convoy-escorted', 'feed'),
    vote(B, 'wall-choice', 'hold'),
    vote(C, 'wall-choice', 'hold'),
    vote(C, 'anchor-held', 'hold'),
    vote(D, 'convoy-raided', 'break'),
    vote(D, 'warden-killed', 'break'),
    // E only touched monoliths: a tenth of a vote each, under one full vote's weight however it leans
    ...Array.from({ length: 9 }, () => vote(E, 'monolith-touched', 'feed')),
    // F fed once and broke once: an even split, target 500, Held
    vote(F, 'convoy-escorted', 'feed'),
    vote(F, 'convoy-raided', 'break'),
  ];

  it("are the accounts whose own season's lean lands in the bucket the season ended in", () => {
    expect(seasonWinners(votes, 'fed')).toEqual([A]);
    expect(seasonWinners(votes, 'held')).toEqual([B, C, F].sort());
    expect(seasonWinners(votes, 'broken')).toEqual([D]);
  });

  it('need one full vote of weight for their philosophy to count: ten monolith touches are one', () => {
    expect(TITLE_MIN_WEIGHT).toBe(30);
    expect(accountLeans(votes).find((a) => a.accountId === E)).toMatchObject({ lean: 1, bucket: null });
    const tenth = [...votes, vote(E, 'monolith-touched', 'feed')];
    expect(seasonWinners(tenth, 'fed')).toEqual([A, E]);
  });

  it('skip a stored vote the meter no longer knows, and name nobody when nobody voted', () => {
    const odd = [...votes, { accountId: D, action: 'retired-action', tag: 'feed' } as unknown as CountVote, vote(D, 'convoy-raided', 'feed' as 'break')];
    expect(seasonWinners(odd, 'broken')).toEqual([D]);
    expect(seasonWinners([], 'held')).toEqual([]);
  });
});
