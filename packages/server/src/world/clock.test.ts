import { describe, expect, it } from 'vitest';
import { createServerClock, DEFAULT_SHARD_EPOCH_MS } from './clock.ts';

describe('server clock', () => {
  it('starts at the wall time since the epoch and advances with the monotonic clock', () => {
    let mono = 500;
    const clock = createServerClock({ epochMs: 0, wallNow: () => 10_000, monoNow: () => mono });
    expect(clock.now()).toBe(10);
    mono += 2500;
    expect(clock.now()).toBe(12.5);
  });

  it('counts from 2026-01-01Z by default', () => {
    const clock = createServerClock({ wallNow: () => DEFAULT_SHARD_EPOCH_MS + 86_400_000, monoNow: () => 0 });
    expect(DEFAULT_SHARD_EPOCH_MS).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(clock.now()).toBe(86_400);
  });

  it('never starts below its floor, even when the wall clock has stepped back', () => {
    let mono = 0;
    const clock = createServerClock({ epochMs: 0, floor: 50, wallNow: () => 10_000, monoNow: () => mono });
    expect(clock.now()).toBe(50);
    mono += 1000;
    expect(clock.now()).toBe(51);
    // a floor behind the wall clock changes nothing
    expect(createServerClock({ epochMs: 0, floor: 5, wallNow: () => 10_000, monoNow: () => 0 }).now()).toBe(10);
  });

  it('never steps backwards', () => {
    const clock = createServerClock();
    let last = clock.now();
    for (let i = 0; i < 1000; i++) {
      const t = clock.now();
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
});
