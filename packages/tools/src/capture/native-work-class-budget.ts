// Conservative sum of the existing finite waits, including cleanup after each failure.
// This is an outer-controller ceiling, not a new timeout for any capture phase.
// Synchronous filesystem/event-loop stalls are not bounded by JS timers; the external
// owned-process controller must enforce this ceiling and retain/drain a failed attempt.
const helperDrainMs = 3000 + 2000 + 2000 + 2000;
export const nativeWorkClassBudget = Object.freeze({
  discoveryMs: 4 * (10_000 + helperDrainMs),
  provenanceMs: 2 * (5000 + helperDrainMs),
  initialHostMs: 1000 + helperDrainMs,
  serverStartupMs: 30_000 + helperDrainMs,
  browserStartupMs: 30_000 + 30_000 + 10_000 + 10_000,
  reviewPreparationMs: 240_000 + 120_000 + 90_000,
  initialGpuIdentityMs: 10_000 + 1000 + helperDrainMs,
  nativeMs: 100 + 15_000 + 10_000 + (5000 + 5000 + 5000 + 10_000) + 10_000 + 25_000 + 60_000 + 4 * helperDrainMs,
  cleanupMs: 5000 + 30_000 + 30_000 + 10_000 + 30_000 + 2 * (1000 + helperDrainMs),
});
export const nativeWorkClassOuterDeadlineMs = Object.values(nativeWorkClassBudget).reduce((a, b) => a + b, 0);

// Expiry requests cancellation; it never abandons a losing callback. The capture's
// existing finally owns page/helper/browser/native drain and terminal serialization.
// Worst-case cancellation may require native finalization/TOC plus ordinary cleanup,
// even if those terms already appeared in the conservative normal-path sum.
export const nativeWorkClassCancellationDrainMs = nativeWorkClassBudget.nativeMs + nativeWorkClassBudget.cleanupMs;
export const nativeWorkClassTerminalEnvelopeMs = nativeWorkClassOuterDeadlineMs + nativeWorkClassCancellationDrainMs;
export async function withNativeWorkClassDeadline<T>(work: (signal: AbortSignal) => Promise<T>, deadlineMs = nativeWorkClassOuterDeadlineMs): Promise<T> {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > nativeWorkClassOuterDeadlineMs) throw new Error('Invalid work-class outer deadline');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Native work-class outer deadline exceeded ${deadlineMs}ms`)), deadlineMs);
  try {
    const result = await work(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
  }
}
