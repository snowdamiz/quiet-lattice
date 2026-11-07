import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observerBounds, observerPlan, observerProtocol, observerScene } from './trace-observer-report.ts';
import { traceLimits } from './browser-work-trace.ts';
import { nativeWorkClassOuterDeadlineMs, nativeWorkClassCancellationDrainMs, nativeWorkClassTerminalEnvelopeMs } from './native-work-class-budget.ts';

export function traceObserverProposal() {
  return {
    kind: 'T13_TRACE_OBSERVER_DISABLED_PROPOSAL_V1',
    protocol: observerProtocol,
    readiness: 'disabled',
    runtimeAuthorized: false,
    binding: null,
    grant: null,
    scene: observerScene,
    plan: observerPlan,
    bounds: observerBounds,
    traceLimits,
    decisionRule:
      'Observer cost requires every same-sign paired gap to satisfy abs(gap) > max(onRange, offRange) + 5ms, with stable arms and short empty fences. Mixed positive/negative gaps are inconclusive before considering similarity. Zero gaps are neutral: they may support stable similarity but never meet the strict gap threshold. Neither outcome qualifies the frame budget.',
    sourcePortLimits:
      'Returned evidence is a detached snapshot. Unsettled ports remain failed with no finished time; replies after the cutoff are excluded. Settled port promises do not prove physical process settlement.',
    deadlines: {
      captureMs: nativeWorkClassOuterDeadlineMs,
      cancellationDrainMs: nativeWorkClassCancellationDrainMs,
      terminalEnvelopeMs: nativeWorkClassTerminalEnvelopeMs,
    },
    requiredBeforeRuntime: [
      'independent source review',
      'new disabled caller binding with exact source/asset/device/load pins',
      'fresh one-use grant',
      'capacity and reserved GPU slot',
      'native/runtime authorization',
      'owned process controller proving physical settlement',
    ],
    historical: { cloud03: 'FAILED', accepted: false, offlineReclassification: 'not fresh performance evidence' },
  };
}
/** No runtime flag or grant is accepted here. Even the proposal is an in-memory, zero-effect value. */
export function traceObserverEntry(args: readonly string[]) {
  if (args.length !== 1 || args[0] !== '--proposal') throw new Error('Trace observer readiness disabled; only --proposal is supported');
  return traceObserverProposal();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(traceObserverEntry(process.argv.slice(2)), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  }
}
