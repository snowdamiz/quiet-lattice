// Tick timing for a zone: the last few hundred tick durations, for p50/p95 (the budget is 10 ms p95 at 200 entities,
// IMPLEMENTATION_PLAN 0.3).

export class TickTimes {
  private readonly ms: Float64Array;
  private next = 0;
  private filled = 0;
  /** every tick recorded, not only the ones still in the window */
  total = 0;

  constructor(readonly window = 400) {
    this.ms = new Float64Array(window);
  }

  record(ms: number): void {
    this.ms[this.next] = ms;
    this.next = (this.next + 1) % this.window;
    this.filled = Math.min(this.filled + 1, this.window);
    this.total++;
  }

  /** The p-th percentile (0–100, nearest rank) of the durations in the window, 0 when there are none. */
  percentile(p: number): number {
    return percentile(this.ms.subarray(0, this.filled), p);
  }

  max(): number {
    let m = 0;
    for (let i = 0; i < this.filled; i++) m = Math.max(m, this.ms[i]!);
    return m;
  }
}

/** Nearest-rank percentile of a list of samples (0–100). */
export function percentile(samples: ArrayLike<number>, p: number): number {
  if (samples.length === 0) return 0;
  const sorted = Float64Array.from(samples).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
