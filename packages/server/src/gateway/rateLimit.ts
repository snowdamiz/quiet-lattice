// In-memory token buckets keyed by client (IP). One process in Phase 1, so memory is enough; P3.E37 moves this to Redis
// when the gateway is split across processes.

export interface RateLimiterOptions {
  /** Bucket size: how many requests may arrive at once. */
  burst: number;
  /** Steady refill, tokens per second. */
  refillPerSecond: number;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
}

export type TakeResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  at: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
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
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.rate);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, remaining: Math.floor(b.tokens) };
    }
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / this.rate)) };
  }

  /** Buckets currently tracked (full buckets are forgotten by the periodic sweep). */
  get size(): number {
    return this.buckets.size;
  }

  /** Drops buckets that have refilled completely: they behave exactly like a missing one. */
  sweep(now = this.now()): void {
    this.lastSweep = now;
    for (const [key, b] of this.buckets) {
      if (b.tokens + ((now - b.at) / 1000) * this.rate >= this.burst) this.buckets.delete(key);
    }
  }
}
