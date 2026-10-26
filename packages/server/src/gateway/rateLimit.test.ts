import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimit.ts';

function limiter(burst: number, refillPerSecond: number) {
  const clock = { t: 1_000_000 };
  const rl = new RateLimiter({ burst, refillPerSecond, now: () => clock.t });
  return { rl, clock };
}

describe('RateLimiter', () => {
  it('allows a burst, then refuses with a retry delay', () => {
    const { rl } = limiter(3, 0.5);
    expect(rl.take('a')).toEqual({ ok: true, remaining: 2 });
    expect(rl.take('a')).toEqual({ ok: true, remaining: 1 });
    expect(rl.take('a')).toEqual({ ok: true, remaining: 0 });
    expect(rl.take('a')).toEqual({ ok: false, retryAfterSeconds: 2 });
  });

  it('refills at the steady rate and caps at the burst', () => {
    const { rl, clock } = limiter(2, 1);
    rl.take('a');
    rl.take('a');
    expect(rl.take('a').ok).toBe(false);
    clock.t += 1000;
    expect(rl.take('a').ok).toBe(true);
    expect(rl.take('a').ok).toBe(false);
    clock.t += 60_000;
    expect(rl.take('a')).toEqual({ ok: true, remaining: 1 });
  });

  it('keeps one bucket per key', () => {
    const { rl } = limiter(1, 0.1);
    expect(rl.take('a').ok).toBe(true);
    expect(rl.take('a').ok).toBe(false);
    expect(rl.take('b').ok).toBe(true);
  });

  it('forgets buckets that have refilled', () => {
    const { rl, clock } = limiter(2, 1);
    rl.take('a');
    rl.take('b');
    rl.take('b');
    clock.t += 1500;
    rl.sweep();
    expect(rl.size).toBe(1); // a is full again; b still has 1.5 of 2
    clock.t += 61_000;
    rl.take('c'); // a sweep runs at most once a minute, on take
    expect(rl.size).toBe(1);
  });

  it('rejects nonsense options', () => {
    expect(() => new RateLimiter({ burst: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new RateLimiter({ burst: 1, refillPerSecond: 0 })).toThrow();
  });
});
