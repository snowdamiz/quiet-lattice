// Token buckets: one per client IP for /auth (RateLimiter) and one per socket for incoming messages (TokenBucket). One
// process in Phase 1, so memory is enough; P3.E37 moves the per-IP buckets to Redis when the gateway is split.
import { isIPv6 } from 'node:net';

/** A single bucket: `burst` tokens, refilled at `refillPerSecond`. Times are milliseconds. */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    readonly burst: number,
    readonly refillPerSecond: number,
    now: number,
  ) {
    if (!(burst >= 1) || !(refillPerSecond > 0)) throw new Error('a token bucket needs burst >= 1 and refillPerSecond > 0');
    this.tokens = burst;
    this.at = now;
  }

  /** Tokens available at `now` (fractional). */
  level(now: number): number {
    return Math.min(this.burst, this.tokens + (Math.max(0, now - this.at) / 1000) * this.refillPerSecond);
  }

  /** Takes one token if there is one. */
  take(now: number): boolean {
    this.tokens = this.level(now);
    this.at = Math.max(this.at, now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Seconds until a token is available. */
  retryAfterSeconds(now: number): number {
    return Math.max(1, Math.ceil((1 - this.level(now)) / this.refillPerSecond));
  }
}

export interface RateLimiterOptions {
  /** Bucket size: how many requests may arrive at once. */
  burst: number;
  /** Steady refill, tokens per second. */
  refillPerSecond: number;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
}

export type TakeResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

/** Token buckets keyed by client. */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly burst: number;
  private readonly rate: number;
  private readonly now: () => number;
  private lastSweep: number;

  constructor(opts: RateLimiterOptions) {
    if (!(opts.burst >= 1) || !(opts.refillPerSecond > 0)) throw new Error('rate limiter needs burst >= 1 and refillPerSecond > 0');
    this.burst = opts.burst;
    this.rate = opts.refillPerSecond;
    this.now = opts.now ?? Date.now;
    this.lastSweep = this.now();
  }

  take(key: string): TakeResult {
    const now = this.now();
    if (now - this.lastSweep > 60_000) this.sweep(now);
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = new TokenBucket(this.burst, this.rate, now)));
    return b.take(now) ? { ok: true, remaining: Math.floor(b.level(now)) } : { ok: false, retryAfterSeconds: b.retryAfterSeconds(now) };
  }

  /** Buckets currently tracked (full buckets are forgotten by the periodic sweep). */
  get size(): number {
    return this.buckets.size;
  }

  /** Drops buckets that have refilled completely: they behave exactly like a missing one. */
  sweep(now = this.now()): void {
    this.lastSweep = now;
    for (const [key, b] of this.buckets) if (b.level(now) >= this.burst) this.buckets.delete(key);
  }
}

/**
 * The key a client is limited by: its IPv4 address, or its IPv6 /64 (one subscriber usually holds a whole /64, so
 * per-address limits would be trivial to dodge). IPv4-mapped IPv6 addresses count as IPv4.
 */
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!isIPv6(ip)) return ip;
  const [head = '', tail = ''] = ip.split('%')[0]!.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
