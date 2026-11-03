import { cloudMarchModes, isRecord, type CloudMarchMode, type WorkClass } from './browser-work-trace.ts';
import { validateControl, validatePreparation } from './browser-work-report.ts';

export function cloudModeForId(id: string): CloudMarchMode {
  const match = /^bwt-[a-f0-9]{32}-s(\d{2})-(prepare|run)$/.exec(id);
  const mode = match ? cloudMarchModes[Number(match[1])] : undefined;
  if (!mode) throw new Error('Unknown fixed cloud march step identity');
  return mode;
}
function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
type TargetFact = { width: 960; height: 540; textures: [string, string] };
function target(value: unknown): value is TargetFact {
  return (
    isRecord(value) &&
    value.width === 960 &&
    value.height === 540 &&
    Array.isArray(value.textures) &&
    value.textures.length === 2 &&
    value.textures.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 64)
  );
}
function stamp(value: unknown): value is { at: string; monotonicMs: number } {
  return (
    isRecord(value) &&
    typeof value.at === 'string' &&
    value.at.length <= 40 &&
    Number.isFinite(Date.parse(value.at)) &&
    typeof value.monotonicMs === 'number' &&
    Number.isFinite(value.monotonicMs) &&
    value.monotonicMs >= 0
  );
}
export function validateCloudMarch(value: unknown, action: 'prepare' | 'run', mode: CloudMarchMode, workClass: WorkClass) {
  if (
    !isRecord(value) ||
    value.kind !== 'cloud-march-work-control' ||
    value.contractVersion !== 1 ||
    value.diagnosticOnly !== true ||
    value.action !== action ||
    value.mode !== mode ||
    value.workClass !== workClass ||
    value.failure !== null ||
    value.cancelled !== false ||
    value.wrapperRestored !== true ||
    !Array.isArray(value.cleanupErrors) ||
    value.cleanupErrors.length ||
    !stamp(value.started) ||
    !stamp(value.finished) ||
    value.finished.monotonicMs < value.started.monotonicMs ||
    !isRecord(value.before) ||
    !isRecord(value.after) ||
    !isRecord(value.work)
  )
    throw new Error('Cloud march completed/restored control missing or invalid');
  const expectedClass = mode === 'reference' || mode === 'reuse' ? 'frame-only' : mode;
  if (workClass !== expectedClass) throw new Error('Cloud protocol must omit PNG and use its exact fixed work class');
  const work = value.work;
  if (
    !safeCount(work.preparationOriginalCalls) ||
    !safeCount(work.controlOriginalCalls) ||
    !safeCount(work.suppressedCalls) ||
    work.outsideOperationCalls !== 0 ||
    !Array.isArray(work.observations) ||
    work.observations.length > 600
  )
    throw new Error('Cloud march raw work evidence missing or ambiguous');
  const completedTarget = value.after.cloudTarget;
  const initialTarget = value.before.cloudTarget;
  if (
    !target(completedTarget) ||
    !isRecord(initialTarget) ||
    !Array.isArray(initialTarget.textures) ||
    initialTarget.textures.length !== 2 ||
    !initialTarget.textures.every((v, i) => v === completedTarget.textures[i])
  )
    throw new Error('Prepared cloud target identity changed');
  const expectedOriginal = action === 'prepare' ? work.preparationOriginalCalls : mode === 'reference' ? 1 : 0;
  const expectedSuppressed = action === 'run' && mode === 'reuse' ? 1 : 0;
  if (action === 'prepare' ? work.controlOriginalCalls !== 0 : work.preparationOriginalCalls !== 0 || work.controlOriginalCalls !== expectedOriginal)
    throw new Error('Unexpected cloud original-call count');
  if (work.suppressedCalls !== expectedSuppressed || work.observations.length !== Number(expectedOriginal) + expectedSuppressed)
    throw new Error('Unexpected cloud suppressed-call count');
  for (const observation of work.observations) {
    if (
      !isRecord(observation) ||
      !target(observation.target) ||
      !safeCount(observation.frameIdx) ||
      !safeCount(observation.marchPlanet) ||
      observation.marchPlanet > 3 ||
      observation.receiverMatches !== true ||
      observation.argumentCount !== 1 ||
      !stamp(observation.at) ||
      observation.at.monotonicMs < value.started.monotonicMs ||
      observation.at.monotonicMs > value.finished.monotonicMs ||
      !observation.target.textures.every((v, i) => v === completedTarget.textures[i]) ||
      observation.suppressed !== (action === 'run' && mode === 'reuse')
    )
      throw new Error('Cloud march target/branch observation invalid');
  }
  if (
    !target(value.after.cloudTarget) ||
    value.after.needsSwap !== true ||
    value.after.histValid !== true ||
    !Array.isArray(value.after.history) ||
    value.after.history.length !== 2 ||
    !value.after.history.every(target)
  )
    throw new Error('Cloud march prepared target/resolve/history state missing');
  if (
    (value.before.histIdx !== 0 && value.before.histIdx !== 1) ||
    (value.after.histIdx !== 0 && value.after.histIdx !== 1) ||
    !safeCount(value.before.frameIdx) ||
    !safeCount(value.after.frameIdx)
  )
    throw new Error('Cloud temporal state invalid');
  const history = value.after.history;
  const selected = Array.isArray(history) ? history[value.after.histIdx] : undefined;
  if (!target(selected) || value.after.selectedHistory !== selected.textures[0]) throw new Error('Resolved cloud history binding missing');
  if (action === 'prepare') {
    const counted = validatePreparation(value.native, workClass);
    if (work.preparationOriginalCalls !== counted.warmUpFrames || Number(work.preparationOriginalCalls) < 1)
      throw new Error('Full normal cloud preparation missing');
    if (value.after.frameIdx !== value.before.frameIdx + counted.warmUpFrames || value.after.histIdx !== (value.before.histIdx + counted.warmUpFrames) % 2)
      throw new Error('Normal preparation temporal progression changed');
    return { preparation: counted, mode, originalMarchCalls: work.preparationOriginalCalls, suppressedMarchCalls: 0 };
  }
  const counted = validateControl(value.native, workClass);
  const frame = mode === 'reference' || mode === 'reuse';
  if (frame && (counted.calls !== (mode === 'reuse' ? 649 : 650) || counted.triangles !== (mode === 'reuse' ? 3792980 : 3792981)))
    throw new Error('Exact frozen cloud variant draw/triangle work differs');
  if (
    frame &&
    (!safeCount(value.before.frameIdx) ||
      value.after.frameIdx !== Number(value.before.frameIdx) + 1 ||
      value.after.histIdx !== 1 - Number(value.before.histIdx))
  )
    throw new Error('Cloud temporal progression missing');
  if (!frame && (value.after.frameIdx !== value.before.frameIdx || value.after.histIdx !== value.before.histIdx))
    throw new Error('Empty/fence cloud state unexpectedly advanced');
  return { ...counted, mode, originalMarchCalls: work.controlOriginalCalls, suppressedMarchCalls: work.suppressedCalls };
}
