import { isRecord, type WorkClass } from './browser-work-trace.ts';

function number(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}
function stamp(value: unknown, name: string) {
  if (!isRecord(value)) throw new Error(`Missing ${name}`);
  return number(value.monotonicMs, name);
}
function completions(value: unknown, count: number) {
  if (!Array.isArray(value) || value.length !== count) throw new Error('Unexpected completion count');
  for (const c of value) {
    if (
      !isRecord(c) ||
      c.status !== 'signaled' ||
      c.failure !== null ||
      typeof c.deletedAt !== 'string' ||
      !Array.isArray(c.polls) ||
      !c.polls.length ||
      c.polls.length > 100
    )
      throw new Error('Missing signaled/deleted completion');
    const last = c.polls.at(-1);
    if (!isRecord(last) || !['already-signaled', 'condition-satisfied'].includes(String(last.status))) throw new Error('Missing terminal completion poll');
  }
  return count;
}
export function validatePreparation(value: unknown, workClass: WorkClass) {
  if (
    !isRecord(value) ||
    value.workClass !== workClass ||
    value.kind !== 'native-work-class-control' ||
    value.contractVersion !== 1 ||
    value.diagnosticOnly !== true ||
    value.cancelled !== false ||
    value.failure !== null ||
    typeof value.preparedAt !== 'string' ||
    !isRecord(value.warm) ||
    value.warm.stable !== true ||
    !isRecord(value.preflight) ||
    value.preflight.disposed !== true ||
    !isRecord(value.preflight.proof) ||
    value.preflight.proof.matches !== true ||
    !Array.isArray(value.preflight.passes) ||
    value.preflight.passes.length !== 4 ||
    !value.preflight.settledAt
  )
    throw new Error('Invalid completed preparation');
  checkErrors(value);
  const warmUpFrames = number(value.warm.frames, 'warm-up frames');
  if (!Number.isInteger(warmUpFrames) || warmUpFrames > 600) throw new Error('Unexpected warm-up frame count');
  return {
    warmUpFrames,
    dependentPasses: value.preflight.passes.length,
    completions: completions(value.preflight.completions, 3),
    preparedAt: value.preparedAt,
  };
}
function checkErrors(value: Record<string, unknown>) {
  if (
    !isRecord(value.glErrors) ||
    !Array.isArray(value.glErrors.before) ||
    value.glErrors.before.length ||
    !Array.isArray(value.glErrors.after) ||
    value.glErrors.after.length ||
    value.contextLostAfter !== false
  )
    throw new Error('GL error/context-loss evidence failed or missing');
  if (!Array.isArray(value.viewport) || value.viewport[0] !== 1920 || value.viewport[1] !== 1080 || value.viewport.length !== 2)
    throw new Error('Unexpected viewport');
}
export function validateControl(value: unknown, workClass: WorkClass) {
  const preparation = validatePreparation(value, workClass);
  if (!isRecord(value) || value.cancelled !== false || !Array.isArray(value.samples) || value.samples.length !== 1 || typeof value.finishedAt !== 'string')
    throw new Error('Missing completed control');
  const s = value.samples[0];
  const frames = workClass.startsWith('frame-') ? 1 : 0;
  const png = workClass === 'frame-plus-PNG' ? 1 : 0;
  if (
    !isRecord(s) ||
    s.workClass !== workClass ||
    s.failure !== null ||
    !isRecord(s.operations) ||
    s.operations.frames !== frames ||
    s.operations.png !== png ||
    s.operations.queries !== 0 ||
    s.frameCompleted !== Boolean(frames) ||
    !isRecord(s.controlStarted) ||
    !isRecord(s.controlFinished)
  )
    throw new Error('Unexpected control work/status');
  const start = number(s.controlStarted.monotonicMs, 'control start'),
    end = number(s.controlFinished.monotonicMs, 'control end');
  if (end < start) throw new Error('Reversed control clock');
  const syncs = completions(s.completions, workClass === 'drained-empty' ? 0 : 2);
  if (!png && ['png', 'output', 'readbackStarted', 'readbackFinished'].some((key) => key in s)) throw new Error('PNG structurally present in no-output path');
  if (png && (typeof s.png !== 'string' || !s.png.startsWith('data:image/png;base64,') || !isRecord(s.readbackStarted) || !isRecord(s.readbackFinished)))
    throw new Error('Immediate PNG evidence missing');
  if (frames && (!isRecord(s.rendered) || !isRecord(s.frameStarted) || !isRecord(s.frameFinished))) throw new Error('Frame work/boundaries missing');
  if (frames) {
    const begin = stamp(s.frameStarted, 'frame start'),
      finish = stamp(s.frameFinished, 'frame end');
    if (begin < start || finish < begin || finish > end) throw new Error('Frame boundary outside control');
    if (png) {
      const readStart = stamp(s.readbackStarted, 'PNG start'),
        readEnd = stamp(s.readbackFinished, 'PNG end');
      if (readStart < finish || readEnd < readStart || readEnd > end) throw new Error('PNG boundary outside same control task order');
    }
  }
  if (!isRecord(s.clocksBefore) || !isRecord(s.clocksAfter) || !isRecord(s.temporalBefore) || !isRecord(s.temporalAfter))
    throw new Error('Actual clock/temporal observations missing');
  const calls = isRecord(s.rendered) ? number(s.rendered.calls, 'draw calls') : 0;
  const triangles = isRecord(s.rendered) ? number(s.rendered.triangles, 'triangles') : 0;
  if (!Number.isInteger(calls) || !Number.isInteger(triangles) || (frames && (!calls || !triangles))) throw new Error('Missing actual rendered work');
  return {
    frames,
    png,
    queries: 0,
    syncs,
    calls,
    triangles,
    controlEnvelopeMs: end - start,
    preparation,
    limits: 'Traced observation, not exclusive GPU cost or unprofiled budget. Temporal counters do not establish full-state or output equality.',
  };
}
