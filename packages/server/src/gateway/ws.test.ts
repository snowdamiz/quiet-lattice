// The per-socket message budget against what an honest client sends (ARCHITECTURE §5: input at 20 Hz, an ack per
// snapshot, pings) and what a flooding one does.
import { Random } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { MESSAGE_LIMITS, MessageBudget, type Admission } from './ws.ts';

/** Messages at `every` ms from `phase`, each up to `jitter` ms late, for `seconds`. */
function stream(rng: Random, seconds: number, every: number, phase: number, jitter: number): number[] {
  const out: number[] = [];
  for (let t = phase; t < seconds * 1000; t += every) out.push(t + rng.float(0, jitter));
  return out;
}

function run(times: number[]): Record<Admission, number> & { firstDropS: number | null } {
  const sorted = [...times].sort((a, b) => a - b);
  const budget = new MessageBudget(0);
  const counts = { take: 0, drop: 0, close: 0, firstDropS: null as number | null };
  for (const t of sorted) {
    const verdict = budget.admit(t);
    counts[verdict]++;
    if (verdict !== 'take') counts.firstDropS ??= t / 1000;
    if (verdict === 'close') break;
  }
  return counts;
}

describe('message budget', () => {
  const MINUTES = 10;

  it('never limits a client sending 20 Hz input and acks, 1 Hz pings, heartbeat pongs and 5 casts a second', () => {
    const rng = new Random(5);
    const s = MINUTES * 60;
    const times = [
      ...stream(rng, s, 50, 0, 15), // input, once a tick
      ...stream(rng, s, 50, 20, 15), // an ack per snapshot
      ...stream(rng, s, 1000, 7, 5), // ping
      ...stream(rng, s, 30_000, 11, 5), // the heartbeat's pong
      ...stream(rng, s, 200, 13, 30), // casts
    ];
    expect(times.length).toBeGreaterThan(MINUTES * 60 * 45);
    expect(run(times)).toEqual({ take: times.length, drop: 0, close: 0, firstDropS: null });
  });

  it('takes the backlog of a 2.5 s network stall at once', () => {
    const rng = new Random(6);
    const steady = [...stream(rng, 60, 50, 0, 10), ...stream(rng, 60, 50, 20, 10), ...stream(rng, 60, 1000, 7, 5)];
    // nothing arrives from 30 s to 32.5 s, then all of it at 32.5 s
    const stalled = steady.map((t) => (t >= 30_000 && t < 32_500 ? 32_500 : t));
    expect(run(stalled).drop).toBe(0);
  });

  it('drops, then closes, a client sending well over the budget', () => {
    const rng = new Random(7);
    const flood = stream(rng, MINUTES * 60, 1000 / (MESSAGE_LIMITS.perSecond * 1.5), 0, 2);
    const r = run(flood);
    expect(r.drop).toBeGreaterThan(0);
    expect(r.close).toBe(1);
    expect(r.firstDropS).toBeLessThan(30);
  });
});
