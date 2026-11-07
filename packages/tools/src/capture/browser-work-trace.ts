import { createHash } from 'node:crypto';
import { bounded } from './native-trace.ts';
import { nativeWorkClassOuterDeadlineMs, nativeWorkClassCancellationDrainMs } from './native-work-class-budget.ts';
import {
  observerBounds,
  observerPlan,
  observerProtocol,
  parseObserverPins,
  validateObserverHost,
  validateObserverPreparation,
  validateObserverControl,
  summarizeObserver,
  type ObserverArm,
  type ObserverWork,
  type ObserverCounts,
  type ObserverPins,
} from './trace-observer-report.ts';

export const workClasses = ['drained-empty', 'fence-only', 'frame-only', 'frame-plus-PNG'] as const;
export type WorkClass = (typeof workClasses)[number];
export const browserWorkPlan: readonly WorkClass[] = [
  'drained-empty',
  'fence-only',
  'frame-only',
  'frame-plus-PNG',
  'frame-plus-PNG',
  'frame-only',
  'frame-only',
  'frame-plus-PNG',
  'frame-plus-PNG',
  'frame-only',
  'frame-only',
  'frame-plus-PNG',
];
export type BrowserDiagnosticProtocol = 'frame-output' | 'cloud-march-reuse';
export const cloudMarchModes = [
  'drained-empty',
  'fence-only',
  'reference',
  'reuse',
  'reuse',
  'reference',
  'reference',
  'reuse',
  'reuse',
  'reference',
  'reference',
  'reuse',
] as const;
export type CloudMarchMode = (typeof cloudMarchModes)[number];
const cloudMarchWorkPlan: readonly WorkClass[] = cloudMarchModes.map((mode) => (mode === 'reference' || mode === 'reuse' ? 'frame-only' : mode));
function protocolPlan(protocol: BrowserDiagnosticProtocol): readonly WorkClass[] {
  switch (protocol) {
    case 'frame-output':
      return browserWorkPlan;
    case 'cloud-march-reuse':
      return cloudMarchWorkPlan;
    default: {
      const unexpected: never = protocol;
      throw new Error(`Unknown browser diagnostic protocol: ${unexpected}`);
    }
  }
}
export const traceLimits = Object.freeze({ bufferKiB: 32768, streamBytes: 64 * 1024 * 1024, chunkBytes: 512 * 1024, reads: 1024, events: 250000 });
export const categoryReplyBytes = 1024 * 1024;
export const browserTraceCategories = ['blink.user_timing', 'devtools.timeline', 'toplevel', 'v8.execute'] as const;
export type TraceCommand =
  | { method: 'Tracing.getCategories' | 'Tracing.end' }
  | {
      method: 'Tracing.start';
      params: {
        tracingBackend: 'chrome';
        transferMode: 'ReturnAsStream';
        streamFormat: 'json';
        streamCompression: 'none';
        bufferUsageReportingInterval: number;
        traceConfig: {
          recordMode: 'recordUntilFull';
          traceBufferSizeInKb: number;
          enableSystrace: false;
          enableSampling: false;
          includedCategories: string[];
          excludedCategories: string[];
        };
      };
    }
  | { method: 'IO.read'; params: { handle: string; size: number } }
  | { method: 'IO.close'; params: { handle: string } };
type TraceEvent = 'Tracing.tracingComplete' | 'Tracing.bufferUsage' | 'close';
export interface TracePort {
  send(command: TraceCommand): Promise<unknown>;
  on(event: TraceEvent, listener: (value: unknown) => void): void;
  off(event: TraceEvent, listener: (value: unknown) => void): void;
  disconnect(): Promise<void>;
}
export interface ProbePort {
  call(action: 'prepare' | 'run', workClass: WorkClass, id: string): Promise<unknown>;
  cancel(): Promise<void>;
}
export interface TraceSink {
  append(bytes: Buffer): void;
  read(): Buffer;
  /** Persistence only. Also runs for a value returned while cancellation is settling. */
  retainStep(index: number, action: 'prepare' | 'run', workClass: WorkClass, id: string, value: unknown): void;
  validateStep(index: number, action: 'prepare' | 'run', workClass: WorkClass, id: string, value: unknown): void;
  retainSample(index: number, workClass: WorkClass, value: unknown): void;
}
interface Marker {
  name: string;
  monotonicMs: number;
}
interface Reply {
  value: unknown;
  failure: string | null;
  markers: [Marker, Marker];
}
interface Terminal {
  dataLossOccurred: boolean;
  stream: string | null;
}
interface CPUContextCoverage {
  status: 'uninspected' | 'inconclusive' | 'supported-context-observed';
  attribution: 'INCONCLUSIVE';
  reason: string;
  supportedEvents: number;
  unsupportedEvents: number;
  unknownNamedEvents: number;
  ambiguousWindowEvents: number;
  frameWindows: { index: number; workClass: WorkClass; startUs: number; endUs: number; supportedEvents: number }[];
}
export interface BrowserWorkLog {
  diagnosticOnly: true;
  protocol: BrowserDiagnosticProtocol;
  status: 'pending' | 'failed' | 'inconclusive' | 'observed';
  failure: string | null;
  cleanupErrors: string[];
  phase: string;
  preparation: { index: number; workClass: WorkClass; insideTrace: boolean; reply: unknown }[];
  controls: { index: number; workClass: WorkClass; reply: unknown }[];
  markers: Marker[];
  categories: string[];
  categoryDiscovery: { status: 'unrequested' } | { status: 'listed'; returned: string[]; unreportedSelectors: string[]; listingIsEmissionProof: false };
  cpuContext: CPUContextCoverage;
  trace: {
    started: boolean;
    endRequested: boolean;
    terminal: Terminal | null;
    bytes: number;
    reads: number;
    streamClosed: boolean;
    observations: unknown[];
    milestones: {
      startRequestedAt: string | null;
      startAcknowledgedAt: string | null;
      endRequestedAt: string | null;
      terminalAt: string | null;
      eofAt: string | null;
      streamClosedAt: string | null;
    };
  };
  markerCoverage: { status: 'uninspected' | 'missing-or-ambiguous' | 'observed'; events: unknown[] };
}
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function marker(value: unknown): Marker {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.monotonicMs !== 'number' || !Number.isFinite(value.monotonicMs))
    throw new Error('Invalid browser marker');
  return { name: value.name, monotonicMs: value.monotonicMs };
}
function reply(value: unknown, id: string): Reply {
  if (!isRecord(value) || !Array.isArray(value.markers) || value.markers.length !== 2 || !(value.failure === null || typeof value.failure === 'string'))
    throw new Error('Invalid browser probe reply');
  const start = marker(value.markers[0]),
    end = marker(value.markers[1]);
  if (start.name !== `${id}-start` || end.name !== `${id}-end` || end.monotonicMs < start.monotonicMs)
    throw new Error('Mismatched or reversed browser markers');
  return { value: value.value, failure: value.failure, markers: [start, end] };
}
function terminal(value: unknown): Terminal {
  if (
    !isRecord(value) ||
    typeof value.dataLossOccurred !== 'boolean' ||
    (value.stream !== undefined && (typeof value.stream !== 'string' || value.stream.length > 1024))
  )
    throw new Error('Invalid tracingComplete schema');
  return { dataLossOccurred: value.dataLossOccurred, stream: typeof value.stream === 'string' && value.stream.length > 0 ? value.stream : null };
}
function chunk(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.data !== 'string' ||
    typeof value.eof !== 'boolean' ||
    (value.base64Encoded !== undefined && typeof value.base64Encoded !== 'boolean')
  )
    throw new Error('Invalid IO.read schema');
  if (value.data.length > traceLimits.chunkBytes * 2) throw new Error('Trace chunk encoded size overflow');
  if (value.base64Encoded && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) throw new Error('Invalid trace base64');
  const bytes = Buffer.from(value.data, value.base64Encoded ? 'base64' : 'utf8');
  if (bytes.length > traceLimits.chunkBytes) throw new Error('Trace chunk decoded size overflow');
  return { bytes, eof: value.eof };
}
interface PointFields {
  name: string;
  cat: string;
  ts: number;
  pid: number;
  tid: number;
}
type PointMark = PointFields & ({ ph: 'R' } | { ph: 'I'; s: 't'; tts?: number });
function isPointMark(value: unknown, rendererPids: readonly number[]): value is PointMark {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.cat !== 'string' ||
    !value.cat.split(',').includes('blink.user_timing') ||
    typeof value.ts !== 'number' ||
    !Number.isFinite(value.ts) ||
    value.ts < 0 ||
    typeof value.pid !== 'number' ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 1 ||
    !rendererPids.includes(value.pid) ||
    typeof value.tid !== 'number' ||
    !Number.isSafeInteger(value.tid) ||
    value.tid <= 0
  )
    return false;
  if (value.ph === 'R') return (value.dur === undefined || value.dur === 0) && (value.tdur === undefined || value.tdur === 0);
  // Perfetto's synchronous thread-instant exporter emits I/s=t, optional tts,
  // and no duration or async identity/clock qualifiers. Unknown forms stay inconclusive.
  return (
    value.ph === 'I' &&
    value.s === 't' &&
    value.cat === 'blink.user_timing' &&
    !['dur', 'tdur', 'id', 'id2', 'bind_id', 'use_async_tts'].some((key) => Object.hasOwn(value, key)) &&
    (!Object.hasOwn(value, 'tts') || (typeof value.tts === 'number' && Number.isFinite(value.tts) && value.tts >= 0))
  );
}
export function markerCoverage(bytes: Buffer, expected: Marker[], rendererPids: readonly number[]) {
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isRecord(parsed) || !Array.isArray(parsed.traceEvents) || parsed.traceEvents.length > traceLimits.events)
    throw new Error('Trace event schema/count unavailable');
  const names = new Set(expected.map((m) => m.name));
  const events = parsed.traceEvents.filter((event) => isRecord(event) && typeof event.name === 'string' && names.has(event.name));
  // Accept only the reviewed R point form or the observed, validated I/thread form.
  // Neither phase establishes native execution identity or a calibrated cross-clock relation.
  const selected: PointMark[] = [];
  let valid = expected.length > 0 && expected.length % 2 === 0 && names.size === expected.length;
  for (const m of expected) {
    const matches = events.filter((e) => isRecord(e) && e.name === m.name);
    const e = matches[0];
    if (matches.length !== 1 || !isPointMark(e, rendererPids)) valid = false;
    else selected.push(e);
  }
  const first = selected[0];
  if (!first || selected.length !== expected.length) valid = false;
  else {
    let previousTraceEnd = -Infinity,
      previousPageEnd = -Infinity;
    const prefix = /^(bwt-[a-f0-9]{32})-/.exec(expected[0].name)?.[1];
    if (!prefix) valid = false;
    for (let i = 0; i + 1 < expected.length; i += 2) {
      const start = expected[i],
        end = expected[i + 1],
        a = selected[i],
        b = selected[i + 1];
      if (
        !new RegExp(`^${prefix}-s\\d{2}-(prepare|run)-start$`).test(start.name) ||
        end.name !== start.name.replace(/-start$/, '-end') ||
        !Number.isFinite(start.monotonicMs) ||
        !Number.isFinite(end.monotonicMs) ||
        start.monotonicMs < 0 ||
        start.monotonicMs > end.monotonicMs ||
        start.monotonicMs < previousPageEnd ||
        a.pid !== first.pid ||
        b.pid !== first.pid ||
        a.tid !== first.tid ||
        b.tid !== first.tid ||
        a.ts > b.ts ||
        a.ts < previousTraceEnd
      )
        valid = false;
      previousTraceEnd = b.ts;
      previousPageEnd = end.monotonicMs;
    }
  }
  return {
    status: valid ? 'observed' : 'missing-or-ambiguous',
    events: events.map((e) => (isRecord(e) ? { name: e.name, cat: e.cat, ph: e.ph, s: e.s, pid: e.pid, tid: e.tid, ts: e.ts, tts: e.tts } : null)),
  } satisfies BrowserWorkLog['markerCoverage'];
}
/** A recognized context subset, never a complete CPU cost, hotspot or native work identity. */
export function cpuContextCoverage(
  bytes: Buffer,
  coverage: BrowserWorkLog['markerCoverage'],
  prefix: string,
  protocol: BrowserDiagnosticProtocol = 'frame-output',
): CPUContextCoverage {
  const result: CPUContextCoverage = {
    status: 'inconclusive',
    attribution: 'INCONCLUSIVE',
    reason: 'Supported timeline identity/schema/context missing or ambiguous for frame windows',
    supportedEvents: 0,
    unsupportedEvents: 0,
    unknownNamedEvents: 0,
    ambiguousWindowEvents: 0,
    frameWindows: [],
  };
  if (coverage.status !== 'observed') return result;
  const points = coverage.events.filter(isRecord),
    first = points[0];
  if (!first || typeof first.pid !== 'number' || typeof first.tid !== 'number') return result;
  for (const [index, workClass] of protocolPlan(protocol).entries()) {
    if (workClass !== 'frame-only' && workClass !== 'frame-plus-PNG') continue;
    const id = `${prefix}-s${String(index).padStart(2, '0')}-run`;
    const a = points.find((p) => p.name === `${id}-start`),
      b = points.find((p) => p.name === `${id}-end`);
    if (!a || !b || typeof a.ts !== 'number' || typeof b.ts !== 'number') return result;
    result.frameWindows.push({ index, workClass, startUs: a.ts, endUs: b.ts, supportedEvents: 0 });
  }
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isRecord(parsed) || !Array.isArray(parsed.traceEvents) || parsed.traceEvents.length > traceLimits.events)
    throw new Error('CPU context trace schema/count unavailable');
  // Observed Chrome156 devtools.timeline X names on a pinned owned-renderer trace;
  // complete-event fields also follow the pinned Perfetto exporter. Other forms are not guessed.
  const supportedNames = new Set(['FunctionCall', 'Layout', 'Paint', 'PrePaint', 'UpdateLayoutTree']);
  for (const event of parsed.traceEvents) {
    if (
      !isRecord(event) ||
      event.pid !== first.pid ||
      event.tid !== first.tid ||
      typeof event.cat !== 'string' ||
      !event.cat.split(',').includes('devtools.timeline')
    )
      continue;
    if (typeof event.name !== 'string' || !supportedNames.has(event.name)) {
      result.unknownNamedEvents++;
      continue;
    }
    // The pinned thread-instant schema bounds this point without inventing a duration.
    // It supplies no positive context, including at a closed control-window boundary.
    const point = event.ts;
    if (
      event.ph === 'I' &&
      event.s === 't' &&
      event.cat === 'devtools.timeline' &&
      typeof point === 'number' &&
      Number.isFinite(point) &&
      point >= 0 &&
      typeof event.pid === 'number' &&
      Number.isSafeInteger(event.pid) &&
      event.pid > 1 &&
      typeof event.tid === 'number' &&
      Number.isSafeInteger(event.tid) &&
      event.tid > 0 &&
      Object.keys(event).every((key) => ['name', 'cat', 'ph', 's', 'pid', 'tid', 'ts', 'tts', 'args'].includes(key)) &&
      (!Object.hasOwn(event, 'tts') || (typeof event.tts === 'number' && Number.isFinite(event.tts) && event.tts >= 0)) &&
      result.frameWindows.every((window) => point < window.startUs || point > window.endUs)
    )
      continue;
    if (
      event.ph !== 'X' ||
      typeof event.ts !== 'number' ||
      !Number.isFinite(event.ts) ||
      event.ts < 0 ||
      typeof event.dur !== 'number' ||
      !Number.isFinite(event.dur) ||
      event.dur < 0 ||
      !Number.isFinite(event.ts + event.dur) ||
      ['id', 'id2', 'bind_id', 'use_async_tts'].some((key) => Object.hasOwn(event, key)) ||
      ['tts', 'tdur'].some((key) => Object.hasOwn(event, key) && (typeof event[key] !== 'number' || !Number.isFinite(event[key]) || event[key] < 0))
    ) {
      result.unsupportedEvents++;
      continue;
    }
    const start = event.ts,
      duration = event.dur,
      end = start + duration;
    const windows = result.frameWindows.filter((w) => (duration === 0 ? start >= w.startUs && start <= w.endUs : start < w.endUs && end > w.startUs));
    if (windows.length > 1) {
      result.ambiguousWindowEvents++;
      continue;
    }
    if (windows.length === 1) {
      windows[0].supportedEvents++;
      result.supportedEvents++;
    }
  }
  if (
    result.frameWindows.length === 10 &&
    result.frameWindows.every((w) => w.supportedEvents > 0) &&
    result.unsupportedEvents === 0 &&
    result.ambiguousWindowEvents === 0
  ) {
    result.status = 'supported-context-observed';
    result.reason = 'Recognized context overlaps each frame window; completeness, causal attribution and exclusive costs remain unqualified';
  }
  return result;
}

export class BrowserWorkError extends Error {
  constructor(readonly evidence: BrowserWorkLog) {
    super(evidence.failure ?? 'Browser diagnostic inconclusive');
  }
}

/** Owns pending callbacks through cancellation and final trace settlement. No renderer or public Review mutation. */
export async function runBrowserWorkTrace(options: {
  trace: TracePort;
  probe: ProbePort;
  sink: TraceSink;
  prefix: string;
  rendererPids: readonly number[];
  signal?: AbortSignal;
  protocol?: BrowserDiagnosticProtocol;
  limits?: { prepareMs: number; controlMs: number; protocolMs: number; flushMs: number; streamBytes?: number; streamMs?: number };
}): Promise<BrowserWorkLog> {
  const protocol = options.protocol ?? 'frame-output';
  const plan = protocolPlan(protocol);
  if (!/^bwt-[a-f0-9]{32}$/.test(options.prefix)) throw new Error('Invalid unique browser marker prefix');
  if (!options.rendererPids.length || !options.rendererPids.every((v) => Number.isSafeInteger(v) && v > 1)) throw new Error('Verified renderer PIDs required');
  const limits = options.limits ?? { prepareMs: 90000, controlMs: 10000, protocolMs: 5000, flushMs: 10000 };
  const maxBytes = limits.streamBytes ?? traceLimits.streamBytes;
  const streamMs = limits.streamMs ?? 60000;
  if (
    !Object.values(limits).every((v) => Number.isSafeInteger(v) && v > 0) ||
    maxBytes > traceLimits.streamBytes ||
    limits.prepareMs > 90000 ||
    limits.controlMs > 10000 ||
    limits.protocolMs > 5000 ||
    limits.flushMs > 10000 ||
    streamMs > 60000
  )
    throw new Error('Invalid browser diagnostic limits');
  const log: BrowserWorkLog = {
    diagnosticOnly: true,
    protocol,
    status: 'pending',
    failure: null,
    cleanupErrors: [],
    phase: 'preparing',
    preparation: [],
    controls: [],
    markers: [],
    categories: [],
    categoryDiscovery: { status: 'unrequested' },
    cpuContext: {
      status: 'uninspected',
      attribution: 'INCONCLUSIVE',
      reason: 'No retained trace inspected',
      supportedEvents: 0,
      unsupportedEvents: 0,
      unknownNamedEvents: 0,
      ambiguousWindowEvents: 0,
      frameWindows: [],
    },
    trace: {
      started: false,
      endRequested: false,
      terminal: null,
      bytes: 0,
      reads: 0,
      streamClosed: false,
      observations: [],
      milestones: { startRequestedAt: null, startAcknowledgedAt: null, endRequestedAt: null, terminalAt: null, eofAt: null, streamClosedAt: null },
    },
    markerCoverage: { status: 'uninspected', events: [] },
  };
  const controller = new AbortController();
  const abort = (error: unknown) => {
    log.failure ??= String(error);
    controller.abort(error);
  };
  const externalAbort = () => abort(options.signal?.reason ?? new Error('Browser diagnostic cancelled'));
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();
  let resolveTerminal: (value: Terminal) => void = () => {};
  let rejectTerminal: (error: Error) => void = () => {};
  const terminalTask = new Promise<Terminal>((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  void terminalTask.catch(() => {});
  const completed = (value: unknown) => {
    try {
      if (log.trace.terminal) throw new Error('Duplicate tracingComplete');
      log.trace.terminal = terminal(value);
      log.trace.milestones.terminalAt = new Date().toISOString();
      resolveTerminal(log.trace.terminal);
      if (!log.trace.endRequested) abort(new Error('Unexpected early tracingComplete'));
      if (log.trace.terminal.dataLossOccurred) abort(new Error('Trace data loss reported'));
    } catch (error) {
      abort(error);
    }
  };
  const usage = (value: unknown) => {
    if (log.trace.observations.length >= 256) {
      abort(new Error('Trace buffer observation overflow'));
      return;
    }
    if (!isRecord(value)) {
      abort(new Error('Invalid trace buffer usage schema'));
      return;
    }
    const full = value.percentFull ?? value.value;
    log.trace.observations.push({
      percentFull: typeof full === 'number' ? full : null,
      eventCount: typeof value.eventCount === 'number' ? value.eventCount : null,
    });
    if (typeof full !== 'number' || !Number.isFinite(full) || full < 0 || full > 1) abort(new Error('Invalid trace buffer fill value'));
    else if (full >= 0.9) abort(new Error('Trace buffer threshold exceeded'));
  };
  options.trace.on('Tracing.tracingComplete', completed);
  options.trace.on('Tracing.bufferUsage', usage);
  const lost = () => abort(new Error('Browser CDP transport lost'));
  options.trace.on('close', lost);
  const active = new Set<Promise<unknown>>();
  let transportDisconnected = false;
  const disconnect = async () => {
    if (transportDisconnected) return;
    transportDisconnected = true;
    try {
      await options.trace.disconnect();
    } catch (error) {
      log.cleanupErrors.push(`CDP disconnect: ${String(error)}`);
    } finally {
      rejectTerminal(new Error('CDP disconnected before trace settlement'));
    }
  };
  const own = async <T>(operation: () => Promise<T>, ms: number, label: string, cancellable = true): Promise<T> => {
    if (cancellable) controller.signal.throwIfAborted();
    const task = Promise.resolve().then(() => {
      if (cancellable) controller.signal.throwIfAborted();
      return operation();
    });
    active.add(task);
    void task.then(
      () => active.delete(task),
      () => active.delete(task),
    );
    try {
      return await bounded(task, ms, label, cancellable ? controller.signal : undefined);
    } catch (error) {
      abort(error);
      // Provider cancellation closes/drains the in-page realm. Protocol loss also disconnects the transport.
      if (label.startsWith('probe')) {
        try {
          await options.probe.cancel();
        } catch (cleanup) {
          log.cleanupErrors.push(`Probe cancellation: ${String(cleanup)}`);
        }
      } else await disconnect();
      await task.catch((settlement) => {
        if (settlement !== error) log.cleanupErrors.push(`${label} settlement: ${String(settlement)}`);
      });
      throw error;
    }
  };
  const send = (command: TraceCommand, cleanup = false, ms = limits.protocolMs) => own(() => options.trace.send(command), ms, command.method, !cleanup);
  const call = async (action: 'prepare' | 'run', workClass: WorkClass, index: number) => {
    const id = `${options.prefix}-s${String(index).padStart(2, '0')}-${action}`;
    const raw = await own(
      async () => {
        const returned = await options.probe.call(action, workClass, id);
        options.sink.retainStep(index, action, workClass, id, returned);
        return returned;
      },
      action === 'prepare' ? limits.prepareMs : limits.controlMs,
      `probe ${action}`,
    );
    controller.signal.throwIfAborted();
    options.sink.validateStep(index, action, workClass, id, raw);
    const result = reply(raw, id);
    if (action === 'prepare') log.preparation.push({ index, workClass, insideTrace: log.trace.started, reply: result });
    else log.controls.push({ index, workClass, reply: result });
    if (log.trace.started) log.markers.push(...result.markers);
    if (result.failure) throw new Error(result.failure);
    controller.signal.throwIfAborted();
    return result.value;
  };
  const readStream = async (stream: string) => {
    log.phase = 'trace-stream';
    try {
      const streamDeadline = performance.now() + streamMs;
      let eof = false;
      while (!eof) {
        options.signal?.throwIfAborted();
        const remaining = streamDeadline - performance.now();
        if (remaining <= 0) throw new Error('Trace stream total deadline exceeded');
        if (++log.trace.reads > traceLimits.reads) throw new Error('Trace stream read-count overflow');
        const part = chunk(
          await send({ method: 'IO.read', params: { handle: stream, size: traceLimits.chunkBytes } }, true, Math.min(limits.protocolMs, remaining)),
        );
        if (log.trace.bytes + part.bytes.length > maxBytes) throw new Error('Trace stream byte overflow');
        options.sink.append(part.bytes);
        log.trace.bytes += part.bytes.length;
        eof = part.eof;
      }
      log.trace.milestones.eofAt = new Date().toISOString();
      const retained = options.sink.read();
      log.markerCoverage = markerCoverage(retained, log.markers, options.rendererPids);
      log.cpuContext = cpuContextCoverage(retained, log.markerCoverage, options.prefix, protocol);
      if (log.markerCoverage.status !== 'observed' || log.cpuContext.status !== 'supported-context-observed') log.status = 'inconclusive';
    } catch (error) {
      abort(error);
    }
    if (transportDisconnected) log.cleanupErrors.push('CDP unavailable before stream close');
    else {
      try {
        await send({ method: 'IO.close', params: { handle: stream } }, true);
        log.trace.streamClosed = true;
        log.trace.milestones.streamClosedAt = new Date().toISOString();
      } catch (error) {
        log.cleanupErrors.push(`Trace stream close: ${String(error)}`);
      }
    }
  };
  try {
    await call('prepare', plan[0], 0);
    const categories = await send({ method: 'Tracing.getCategories' });
    if (!isRecord(categories) || !Array.isArray(categories.categories)) throw new Error('Invalid supported trace category listing');
    const returned: string[] = [];
    for (const value of categories.categories) {
      if (typeof value !== 'string') throw new Error('Invalid trace category name');
      returned.push(value);
    }
    if (Buffer.byteLength(JSON.stringify(returned)) > categoryReplyBytes) throw new Error('Trace category listing byte overflow');
    log.categories = [...browserTraceCategories];
    log.categoryDiscovery = {
      status: 'listed',
      returned: [...returned],
      unreportedSelectors: log.categories.filter((name) => !returned.includes(name)),
      listingIsEmissionProof: false,
    };
    log.phase = 'tracing';
    // Set before awaiting start, so cleanup ends a trace whose start reply was lost.
    log.trace.started = true;
    log.trace.milestones.startRequestedAt = new Date().toISOString();
    await send({
      method: 'Tracing.start',
      params: {
        tracingBackend: 'chrome',
        transferMode: 'ReturnAsStream',
        streamFormat: 'json',
        streamCompression: 'none',
        bufferUsageReportingInterval: 5000,
        traceConfig: {
          recordMode: 'recordUntilFull',
          traceBufferSizeInKb: traceLimits.bufferKiB,
          enableSystrace: false,
          enableSampling: false,
          includedCategories: log.categories,
          excludedCategories: ['*screenshot*', '*memory*', '*system*'],
        },
      },
    });
    log.trace.milestones.startAcknowledgedAt = new Date().toISOString();
    for (const [index, workClass] of plan.entries()) {
      controller.signal.throwIfAborted();
      if (index > 0) {
        log.phase = 'preparing-inside-trace';
        await call('prepare', workClass, index);
      }
      log.phase = 'control';
      const value = await call('run', workClass, index);
      options.sink.retainSample(index, workClass, value);
      controller.signal.throwIfAborted();
    }
  } catch (error) {
    abort(error);
  } finally {
    if (log.failure) {
      try {
        await options.probe.cancel();
      } catch (error) {
        log.cleanupErrors.push(`Final probe cancellation: ${String(error)}`);
      }
    }
    if (log.trace.started && !log.trace.terminal && !transportDisconnected) {
      log.phase = 'trace-settlement';
      log.trace.endRequested = true;
      log.trace.milestones.endRequestedAt = new Date().toISOString();
      try {
        await own(
          async () => {
            await options.trace.send({ method: 'Tracing.end' });
            await terminalTask;
          },
          limits.flushMs,
          'Tracing.end/complete',
          false,
        );
      } catch (error) {
        log.cleanupErrors.push(`Trace settlement: ${String(error)}`);
      }
    }
    const stream = log.trace.terminal?.stream;
    if (stream && !transportDisconnected) await readStream(stream);
    else if (log.trace.started) abort(new Error('Missing terminal trace stream'));
    await Promise.allSettled([...active]);
    options.trace.off('Tracing.tracingComplete', completed);
    options.trace.off('Tracing.bufferUsage', usage);
    options.trace.off('close', lost);
    options.signal?.removeEventListener('abort', externalAbort);
    if (log.cleanupErrors.length) log.failure ??= 'Browser diagnostic cleanup failed';
    if (log.failure) log.status = 'failed';
    else if (log.status !== 'inconclusive') log.status = 'observed';
    log.phase = 'terminal';
  }
  if (log.status !== 'observed') throw new BrowserWorkError(log);
  return log;
}

export interface ObserverClock {
  now(): number;
  bound<T>(task: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T>;
}
export const observerClock: ObserverClock = { now: () => performance.now(), bound: bounded };
export interface ObserverTraceReceipt {
  kind: 'trace-on';
  sha256: string | null;
  startRequested: boolean;
  endRequested: boolean;
  categories: unknown;
  terminals: unknown[];
  usage: unknown[];
  markers: Marker[];
  markerCoverage: ReturnType<typeof markerCoverage> | null;
  bytes: number;
  reads: number;
  events: number;
  eof: boolean;
  closedStreams: string[];
}
export interface ObserverStep {
  index: number;
  arm: ObserverArm;
  pair: number | null;
  workClass: ObserverWork;
  phases: { name: string; startMs: number; endMs: number; outcome: 'returned' | 'failed' }[];
  before: unknown;
  after: unknown;
  prepare: unknown;
  run: unknown;
  counts: ObserverCounts | null;
  receipt: ObserverTraceReceipt | { kind: 'trace-off'; sessions: 0; tracingCalls: 0; tracingActive: false; pageMarks: 0 };
}
export interface ObserverPacket {
  kind: 'T13_TRACE_OBSERVER_V1';
  protocol: typeof observerProtocol;
  diagnosticOnly: true;
  status: 'pending' | 'failed' | 'observed';
  failure: string | null;
  cleanupErrors: string[];
  pins: ObserverPins;
  startedMs: number;
  finishedMs: number | null;
  snapshotAtMs: number | null;
  portSettlement: { kind: 'pending' } | { kind: 'ports-settled' } | { kind: 'ports-unsettled'; pendingCallbacks: number; requiresController: true };
  steps: ObserverStep[];
  totals: {
    preparations: number;
    warmUpFrames: number;
    frames: number;
    dependentPasses: number;
    preflightFences: number;
    controlFences: number;
    png: number;
    queries: number;
    segments: number;
    bytes: number;
    reads: number;
    events: number;
  };
  summary: ReturnType<typeof summarizeObserver> | null;
  applicability: { gpuTimerDisjoint: 'not-applicable-queries-absent'; gpuTime: 'not-measured'; missingControls: number; budgetQualified: false };
}
export class ObserverError extends Error {
  constructor(readonly evidence: ObserverPacket) {
    super(evidence.failure ?? 'Observer diagnostic failed');
  }
}
export interface ObserverOptions {
  protocol: typeof observerProtocol;
  prefix: string;
  rendererPids: readonly number[];
  pins: unknown;
  trace: TracePort;
  probe: { call(action: 'prepare' | 'run', workClass: ObserverWork, id: string, arm: ObserverArm): Promise<unknown>; cancel(): Promise<void> };
  observe(): Promise<unknown>;
  sink: { retainStep(index: number, action: 'prepare' | 'run', raw: unknown): void; appendTrace(index: number, bytes: Buffer): void };
  clock?: ObserverClock;
  signal?: AbortSignal;
}
function requireCompleteObserver(packet: ObserverPacket) {
  if (
    packet.portSettlement.kind !== 'ports-settled' ||
    packet.cleanupErrors.length ||
    packet.failure !== null ||
    packet.steps.length !== observerPlan.length ||
    packet.applicability.missingControls !== 0 ||
    packet.summary === null ||
    packet.summary.pairs.length !== 5
  )
    throw new Error('Incomplete observer packet');
  for (const key of ['preparations', 'warmUpFrames', 'frames', 'dependentPasses', 'preflightFences', 'controlFences', 'png', 'queries', 'segments'] as const) {
    const expected = observerBounds[key],
      count = packet.totals[key];
    if (key === 'warmUpFrames' ? count < 12 || count > expected : count !== expected) throw new Error(`Observer work bound mismatch: ${key}`);
  }
  const traceTotals = { bytes: 0, reads: 0, events: 0 };
  for (const [index, step] of packet.steps.entries()) {
    const plan = observerPlan[index];
    if (
      step.index !== index ||
      step.arm !== plan.arm ||
      step.pair !== plan.pair ||
      step.workClass !== plan.workClass ||
      step.before == null ||
      step.after == null ||
      step.prepare == null ||
      step.run == null ||
      step.counts === null ||
      step.phases.some((phase) => phase.outcome !== 'returned')
    )
      throw new Error('Incomplete observer step');
    const receipt = step.receipt;
    if (step.arm === 'off') {
      if (receipt.kind !== 'trace-off' || receipt.sessions !== 0 || receipt.tracingCalls !== 0 || receipt.tracingActive || receipt.pageMarks !== 0)
        throw new Error('Incomplete trace-off receipt');
      continue;
    }
    if (
      receipt.kind !== 'trace-on' ||
      !receipt.startRequested ||
      !receipt.endRequested ||
      !receipt.eof ||
      receipt.markers.length !== 4 ||
      receipt.markerCoverage?.status !== 'observed' ||
      receipt.terminals.length !== 1 ||
      !receipt.sha256 ||
      receipt.bytes < 1 ||
      receipt.reads < 1 ||
      receipt.events < 4
    )
      throw new Error('Incomplete trace-on receipt');
    const closed = terminal(receipt.terminals[0]);
    if (closed.dataLossOccurred || closed.stream === null || receipt.closedStreams.length !== 1 || receipt.closedStreams[0] !== closed.stream)
      throw new Error('Unclosed/lost observer trace');
    for (const key of ['bytes', 'reads', 'events'] as const) traceTotals[key] += receipt[key];
  }
  for (const key of ['bytes', 'reads', 'events'] as const) if (packet.totals[key] !== traceTotals[key]) throw new Error('Incomplete aggregate trace receipt');
  if (traceTotals.bytes > traceLimits.streamBytes || traceTotals.reads > traceLimits.reads || traceTotals.events > traceLimits.events)
    throw new Error('Aggregate trace limits exceeded');
}
/** Fixed reference experiment only. Ports own cancellation/drain; no process, browser or resource is constructed here. */
export async function runTraceObserver(options: ObserverOptions): Promise<ObserverPacket> {
  if (
    options.protocol !== observerProtocol ||
    !/^bwt-[a-f0-9]{32}$/.test(options.prefix) ||
    !options.rendererPids.length ||
    !options.rendererPids.every((pid) => Number.isSafeInteger(pid) && pid > 1)
  )
    throw new Error('Invalid fixed observer protocol/identity');
  const pins = parseObserverPins(options.pins),
    clock = options.clock ?? observerClock;
  const packet: ObserverPacket = {
    kind: 'T13_TRACE_OBSERVER_V1',
    protocol: observerProtocol,
    diagnosticOnly: true,
    status: 'pending',
    failure: null,
    cleanupErrors: [],
    pins,
    startedMs: clock.now(),
    finishedMs: null,
    snapshotAtMs: null,
    portSettlement: { kind: 'pending' },
    steps: [],
    totals: {
      preparations: 0,
      warmUpFrames: 0,
      frames: 0,
      dependentPasses: 0,
      preflightFences: 0,
      controlFences: 0,
      png: 0,
      queries: 0,
      segments: 0,
      bytes: 0,
      reads: 0,
      events: 0,
    },
    summary: null,
    applicability: { gpuTimerDisjoint: 'not-applicable-queries-absent', gpuTime: 'not-measured', missingControls: 12, budgetQualified: false },
  };
  const cancellation = new AbortController(),
    signal = options.signal ? AbortSignal.any([options.signal, cancellation.signal]) : cancellation.signal;
  let hasFailed = false,
    acceptingEvidence = true;
  const fail = (error: unknown) => {
    hasFailed = true;
    packet.failure ??= String(error);
    cancellation.abort(error);
  };
  const captureEnd = packet.startedMs + nativeWorkClassOuterDeadlineMs;
  let drainEnd = Infinity;
  const pending = new Set<Promise<unknown>>();
  let pageOrigin: number | null = null,
    lastPageMarkMs = -1;
  const owned = async <T>(op: () => Promise<T>, ms: number, name: string, step: ObserverStep, cleanup = false): Promise<T> => {
    if (!cleanup) signal.throwIfAborted();
    const startMs = clock.now(),
      remaining = (cleanup ? drainEnd : captureEnd) - startMs;
    if (remaining <= 0) throw new Error(`${name}: total ${cleanup ? 'drain' : 'capture'} deadline exceeded`);
    const phase: ObserverStep['phases'][number] = { name, startMs, endMs: startMs, outcome: 'failed' };
    step.phases.push(phase);
    const task = Promise.resolve().then(() => {
      if (!acceptingEvidence) throw new Error('Observer evidence cutoff reached');
      if (!cleanup) signal.throwIfAborted();
      return op();
    });
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    try {
      const result = await clock.bound(task, Math.min(ms, remaining), name, cleanup ? undefined : signal);
      if (!cleanup) signal.throwIfAborted();
      phase.outcome = 'returned';
      return result;
    } finally {
      phase.endMs = clock.now();
    }
  };
  const cleanup = async (op: () => Promise<unknown>, name: string, step: ObserverStep) => {
    try {
      await owned(op, 10000, name, step, true);
    } catch (error) {
      packet.cleanupErrors.push(`${name}: ${String(error)}`);
      fail(error);
    }
  };
  const observeHost = (step: ObserverStep, position: 'before' | 'after') =>
    owned(
      async () => {
        const raw = structuredClone(await options.observe());
        // Keep a returned or draining host reply before owned() checks cancellation.
        if (acceptingEvidence) step[position] = raw;
        return raw;
      },
      5000,
      `host-${position}`,
      step,
    );
  try {
    for (const [index, plan] of observerPlan.entries()) {
      signal.throwIfAborted();
      const receipt: ObserverStep['receipt'] =
        plan.arm === 'off'
          ? { kind: 'trace-off', sessions: 0, tracingCalls: 0, tracingActive: false, pageMarks: 0 }
          : {
              kind: 'trace-on',
              sha256: null,
              startRequested: false,
              endRequested: false,
              categories: null,
              terminals: [],
              usage: [],
              markers: [],
              markerCoverage: null,
              bytes: 0,
              reads: 0,
              events: 0,
              eof: false,
              closedStreams: [],
            };
      const step: ObserverStep = { index, ...plan, phases: [], before: null, after: null, prepare: null, run: null, counts: null, receipt };
      packet.steps.push(step);
      const streams = new Set<string>(),
        closeAttempted = new Set<string>();
      let resolveTerminal: () => void = () => {},
        terminalSeen = false;
      const terminalTask = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      const complete = (raw: unknown) => {
        if (receipt.kind !== 'trace-on') return;
        if (isRecord(raw) && typeof raw.stream === 'string' && raw.stream.length > 0 && raw.stream.length <= 1024) streams.add(raw.stream);
        if (receipt.terminals.length < 8) receipt.terminals.push(raw);
        try {
          const value = terminal(raw);
          if (terminalSeen || !receipt.endRequested || value.dataLossOccurred || !value.stream) throw new Error('Duplicate/early/lost/missing terminal trace');
        } catch (error) {
          fail(error);
        }
        terminalSeen = true;
        resolveTerminal();
      };
      const usage = (raw: unknown) => {
        if (receipt.kind !== 'trace-on') return;
        if (receipt.usage.length >= 256) {
          fail(new Error('Trace usage observation overflow'));
          return;
        }
        receipt.usage.push(raw);
        const full = isRecord(raw) ? (raw.percentFull ?? raw.value) : null;
        if (typeof full !== 'number' || !Number.isFinite(full) || full < 0 || full >= 0.9) fail(new Error('Trace buffer loss/usage threshold'));
        if (
          isRecord(raw) &&
          raw.eventCount !== undefined &&
          (typeof raw.eventCount !== 'number' ||
            !Number.isSafeInteger(raw.eventCount) ||
            raw.eventCount < 0 ||
            raw.eventCount + packet.totals.events > traceLimits.events)
        )
          fail(new Error('Malformed/overflowing trace event count'));
      };
      const lost = () => fail(new Error('Observer trace transport lost'));
      let listening = false;
      try {
        await observeHost(step, 'before');
        validateObserverHost(step.before, pins);
        if (receipt.kind === 'trace-on') {
          options.trace.on('Tracing.tracingComplete', complete);
          options.trace.on('Tracing.bufferUsage', usage);
          options.trace.on('close', lost);
          listening = true;
          receipt.categories = await owned(() => options.trace.send({ method: 'Tracing.getCategories' }), 5000, 'categories', step);
          if (
            !isRecord(receipt.categories) ||
            !Array.isArray(receipt.categories.categories) ||
            !receipt.categories.categories.every((v) => typeof v === 'string') ||
            Buffer.byteLength(JSON.stringify(receipt.categories)) > categoryReplyBytes
          )
            throw new Error('Malformed category receipt');
          if (++packet.totals.segments > observerBounds.segments) throw new Error('Trace segment overflow');
          receipt.startRequested = true;
          await owned(
            () =>
              options.trace.send({
                method: 'Tracing.start',
                params: {
                  tracingBackend: 'chrome',
                  transferMode: 'ReturnAsStream',
                  streamFormat: 'json',
                  streamCompression: 'none',
                  bufferUsageReportingInterval: 5000,
                  traceConfig: {
                    recordMode: 'recordUntilFull',
                    traceBufferSizeInKb: traceLimits.bufferKiB,
                    enableSystrace: false,
                    enableSampling: false,
                    includedCategories: [...browserTraceCategories],
                    excludedCategories: ['*screenshot*', '*memory*', '*system*'],
                  },
                },
              }),
            5000,
            'trace-start',
            step,
          );
        }
        for (const action of ['prepare', 'run'] as const) {
          const id = `${options.prefix}-s${String(index).padStart(2, '0')}-${action}`;
          const raw = await owned(
            async () => {
              const value = structuredClone(await options.probe.call(action, plan.workClass, id, plan.arm));
              // Preserve late/cancelled replies before schema checks, as in the retained protocol.
              if (acceptingEvidence) {
                step[action] = value;
                options.sink.retainStep(index, action, structuredClone(value));
              }
              return value;
            },
            action === 'prepare' ? 90000 : 10000,
            action,
            step,
          );
          const result = reply(raw, id);
          if (result.markers[0].monotonicMs < 0 || result.markers[0].monotonicMs < lastPageMarkMs) throw new Error('Reversed page phase clock');
          lastPageMarkMs = result.markers[1].monotonicMs;
          if (receipt.kind === 'trace-on') receipt.markers.push(...result.markers);
          if (result.failure !== null) throw new Error(result.failure);
          if (!isRecord(raw) || !Array.isArray(raw.pageErrors) || raw.pageErrors.length) throw new Error('Page errors missing or present');
          if (action === 'prepare') {
            if (
              !isRecord(result.value) ||
              result.value.startedAt !== null ||
              result.value.finishedAt !== null ||
              !Array.isArray(result.value.samples) ||
              result.value.samples.length
            )
              throw new Error('Preparation contains missing/previous control records');
            const counts = validateObserverPreparation(result.value, plan.workClass, pins);
            if (counts.preflightSettledMs < result.markers[0].monotonicMs || counts.preflightSettledMs > result.markers[1].monotonicMs)
              throw new Error('Preparation outside page markers');
            pageOrigin ??= counts.timeOriginMs;
            if (pageOrigin !== counts.timeOriginMs) throw new Error('Page clock origin changed');
            packet.totals.preparations++;
            packet.totals.warmUpFrames += counts.warmUpFrames;
            packet.totals.dependentPasses += counts.dependentPasses;
            packet.totals.preflightFences += counts.completions;
          } else {
            const prepared = reply(step.prepare, `${options.prefix}-s${String(index).padStart(2, '0')}-prepare`).value;
            step.counts = validateObserverControl(result.value, prepared, plan.workClass, pins);
            if (step.counts.controlStartedMs < result.markers[0].monotonicMs || step.counts.controlFinishedMs > result.markers[1].monotonicMs)
              throw new Error('Control outside page markers');
            const previousControl = packet.steps[index - 1]?.counts;
            if (
              previousControl &&
              (step.counts.temporalBefore !== previousControl.temporalAfter + step.counts.preparation.warmUpFrames ||
                step.counts.historyIndexBefore !== (previousControl.historyIndexAfter + step.counts.preparation.warmUpFrames) % 2)
            )
              throw new Error('History progression between preparations changed');
            const reference = packet.steps.find((previous) => previous.index < index && previous.workClass === 'frame-only' && previous.counts)?.counts;
            if (plan.workClass === 'frame-only' && reference && (step.counts.calls !== reference.calls || step.counts.triangles !== reference.triangles))
              throw new Error('Reference work changed between controls');
            packet.totals.frames += step.counts.frames;
            packet.totals.controlFences += step.counts.syncs;
            packet.applicability.missingControls--;
          }
        }
      } catch (error) {
        fail(error);
      }
      {
        drainEnd = Math.min(captureEnd + nativeWorkClassCancellationDrainMs, clock.now() + nativeWorkClassCancellationDrainMs);
        if (signal.aborted) {
          fail(signal.reason);
          await cleanup(() => options.probe.cancel(), 'probe-cancel', step);
        }
        if (receipt.kind === 'trace-on') {
          if (receipt.startRequested && !terminalSeen) {
            receipt.endRequested = true;
            await cleanup(
              async () => {
                await options.trace.send({ method: 'Tracing.end' });
                await terminalTask;
              },
              'trace-end',
              step,
            );
          }
          try {
            if (receipt.startRequested && !terminalSeen) throw new Error('Missing terminal trace');
            if (receipt.startRequested && streams.size !== 1) throw new Error('Missing/ambiguous trace stream');
            if (streams.size === 1) {
              const stream = [...streams][0],
                chunks: Buffer[] = [],
                readEnd = Math.min(clock.now() + 60000, drainEnd);
              while (!receipt.eof) {
                if (packet.totals.reads >= traceLimits.reads || clock.now() >= readEnd) throw new Error('Aggregate trace read/deadline overflow');
                packet.totals.reads++;
                receipt.reads++;
                const part = chunk(
                  await owned(
                    () => options.trace.send({ method: 'IO.read', params: { handle: stream, size: traceLimits.chunkBytes } }),
                    Math.min(5000, readEnd - clock.now()),
                    'trace-read',
                    step,
                    true,
                  ),
                );
                if (packet.totals.bytes + part.bytes.length > traceLimits.streamBytes) throw new Error('Aggregate trace byte overflow');
                packet.totals.bytes += part.bytes.length;
                receipt.bytes += part.bytes.length;
                options.sink.appendTrace(index, part.bytes);
                chunks.push(part.bytes);
                receipt.eof = part.eof;
              }
              const bytes = Buffer.concat(chunks);
              receipt.sha256 = createHash('sha256').update(bytes).digest('hex');
              const parsed: unknown = JSON.parse(bytes.toString('utf8'));
              if (!isRecord(parsed) || !Array.isArray(parsed.traceEvents)) throw new Error('Malformed trace events');
              receipt.events = parsed.traceEvents.length;
              packet.totals.events += receipt.events;
              if (packet.totals.events > traceLimits.events) throw new Error('Aggregate trace event overflow');
              receipt.markerCoverage = markerCoverage(bytes, receipt.markers, options.rendererPids);
              if (receipt.markers.length !== 4 || receipt.markerCoverage.status !== 'observed') throw new Error('Missing/ambiguous segment markers');
            }
          } catch (error) {
            fail(error);
          } finally {
            for (const stream of streams)
              await cleanup(
                async () => {
                  closeAttempted.add(stream);
                  await options.trace.send({ method: 'IO.close', params: { handle: stream } });
                  receipt.closedStreams.push(stream);
                },
                'stream-close',
                step,
              );
          }
        }
        if (hasFailed || pending.size) {
          if (receipt.kind === 'trace-on') await cleanup(() => options.trace.disconnect(), 'transport-drain', step);
          await cleanup(() => options.probe.cancel(), 'probe-drain', step);
          const tasks = [...pending];
          await cleanup(() => Promise.allSettled(tasks), 'callbacks-drain', step);
        }
        if (receipt.kind === 'trace-on' && listening) {
          // Retain/close even a terminal delivered while the owned transport drains.
          for (const stream of streams) {
            if (closeAttempted.has(stream)) continue;
            await cleanup(
              async () => {
                closeAttempted.add(stream);
                await options.trace.send({ method: 'IO.close', params: { handle: stream } });
                receipt.closedStreams.push(stream);
              },
              'late-stream-close',
              step,
            );
          }
          options.trace.off('Tracing.tracingComplete', complete);
          options.trace.off('Tracing.bufferUsage', usage);
          options.trace.off('close', lost);
        }
      }
      if (hasFailed) break;
      await observeHost(step, 'after');
      validateObserverHost(step.after, pins);
      signal.throwIfAborted();
    }
    signal.throwIfAborted();
    if (!hasFailed) {
      packet.summary = summarizeObserver(
        packet.steps.map((step) => {
          if (!step.counts) throw new Error('Missing control');
          return { arm: step.arm, pair: step.pair, counts: step.counts };
        }),
      );
    }
  } catch (error) {
    fail(error);
  } finally {
    const last = packet.steps.at(-1);
    if (last && pending.size) {
      drainEnd = Math.min(captureEnd + nativeWorkClassCancellationDrainMs, clock.now() + nativeWorkClassCancellationDrainMs);
      await cleanup(() => options.probe.cancel(), 'final-probe-drain', last);
      const tasks = [...pending];
      await cleanup(() => Promise.allSettled(tasks), 'final-callbacks-drain', last);
    }
    packet.snapshotAtMs = clock.now();
    if (pending.size) {
      packet.portSettlement = { kind: 'ports-unsettled', pendingCallbacks: pending.size, requiresController: true };
      fail(new Error('Observer ports did not settle within drain envelope'));
    } else {
      packet.portSettlement = { kind: 'ports-settled' };
      packet.finishedMs = packet.snapshotAtMs;
    }
    if (!hasFailed) {
      try {
        requireCompleteObserver(packet);
      } catch (error) {
        fail(error);
      }
    }
    packet.status = hasFailed ? 'failed' : 'observed';
    acceptingEvidence = false;
  }
  // This is a detached cutoff snapshot. Unsettled ports can still act externally; their
  // later replies cannot update this packet or its sinks. Only the future owned process
  // controller can establish physical settlement; no controller is created here.
  const snapshot = structuredClone(packet);
  if (snapshot.status !== 'observed') throw new ObserverError(snapshot);
  return snapshot;
}
