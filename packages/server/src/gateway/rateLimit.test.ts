import { describe, expect, it } from 'vitest';
import { clientKey, RateLimiter, TokenBucket } from './rateLimit.ts';

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
    expect(() => new TokenBucket(1, -1, 0)).toThrow();
  });
});

describe('TokenBucket', () => {
  it('admits a burst, then the steady rate', () => {
    const b = new TokenBucket(60, 40, 0);
    let admitted = 0;
    for (let i = 0; i < 1000; i++) if (b.take(0)) admitted++;
    expect(admitted).toBe(60);
    // one second at 20 Hz input plus a few extras never runs dry once the burst is back
    let t = 0;
    const steady = new TokenBucket(60, 40, 0);
    for (let i = 0; i < 2000; i++, t += 1000 / 30) expect(steady.take(t)).toBe(true);
  });

  it('never runs backwards on a clock that does', () => {
    const b = new TokenBucket(2, 1, 1000);
    b.take(1000);
    b.take(1000);
    expect(b.take(500)).toBe(false);
    expect(b.take(2000)).toBe(true);
  });
});

describe('clientKey', () => {
  it('keys IPv4 by address, including IPv4-mapped IPv6', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys IPv6 by its /64', () => {
    expect(clientKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
  });

  it('passes anything else through', () => {
    expect(clientKey('unknown')).toBe('unknown');
  });
});
