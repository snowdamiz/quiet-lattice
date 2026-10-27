// The daily actives tally (P2.E22.T03): an account counted once a meter day, days closing as the clock moves on, and the
// mean of the month before a day.
import { ACTIVES_WINDOW_DAYS } from '@astra/shared/seasons';
import { describe, expect, it } from 'vitest';
import { DailyActives } from './actives.ts';

describe('the daily actives tally', () => {
  it('counts an account once a day and closes a day when the next one comes', () => {
    const t = new DailyActives(100);
    expect(t.mark('a', 100)).toBe(true);
    expect(t.mark('a', 100)).toBe(false);
    expect(t.mark('b', 100)).toBe(true);
    expect(t.on(100)).toBe(2);
    expect(t.mark('a', 101)).toBe(true);
    expect([t.on(100), t.on(101), t.on(99)]).toEqual([2, 1, 0]);
    expect(() => t.mark('c', 100)).toThrow(RangeError);
    // a day nobody played is a zero, and the mean takes the month before the day asked for
    expect(t.mark('c', 104)).toBe(true);
    expect(t.meanBefore(104)).toBe(3 / ACTIVES_WINDOW_DAYS);
    expect(t.meanBefore(105)).toBe(4 / ACTIVES_WINDOW_DAYS);
  });

  it('takes earlier counts and the open day accounts back, so an account counted before a restart is not counted again', () => {
    const t = new DailyActives(200, { counts: [[170, 300], [199, 60], [150, 9000], [200, 1]], today: ['a', 'b'] });
    expect([t.on(170), t.on(199), t.on(150), t.on(200)]).toEqual([300, 60, 9000, 2]);
    expect(t.mark('a', 200)).toBe(false);
    expect(t.mark('c', 200)).toBe(true);
    expect(t.meanBefore(200)).toBe((300 + 60) / ACTIVES_WINDOW_DAYS);
  });

  it('forgets closed days older than a season reads as the days go by', () => {
    const t = new DailyActives(10, { counts: [[5, 7]] });
    t.mark('a', 10);
    t.mark('a', 10 + ACTIVES_WINDOW_DAYS);
    expect(t.on(10)).toBe(1);
    t.mark('a', 11 + ACTIVES_WINDOW_DAYS);
    expect([t.on(5), t.on(10)]).toEqual([0, 0]);
  });
});
