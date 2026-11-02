import { bounded } from './native-trace.ts';

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
export const traceLimits = Object.freeze({ bufferKiB: 32768, streamBytes: 64 * 1024 * 1024, chunkBytes: 512 * 1024, reads: 1024, events: 250000 });
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
export interface BrowserWorkLog {
  diagnosticOnly: true;
  status: 'pending' | 'failed' | 'inconclusive' | 'observed';
  failure: string | null;
  cleanupErrors: string[];
  phase: string;
  preparation: { index: number; workClass: WorkClass; insideTrace: boolean; reply: unknown }[];
  controls: { index: number; workClass: WorkClass; reply: unknown }[];
  markers: Marker[];
  categories: string[];
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
  limits?: { prepareMs: number; controlMs: number; protocolMs: number; flushMs: number; streamBytes?: number; streamMs?: number };
}): Promise<BrowserWorkLog> {
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
    status: 'pending',
    failure: null,
    cleanupErrors: [],
    phase: 'preparing',
    preparation: [],
    controls: [],
    markers: [],
    categories: [],
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
      log.markerCoverage = markerCoverage(options.sink.read(), log.markers, options.rendererPids);
      if (log.markerCoverage.status !== 'observed') log.status = 'inconclusive';
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
    await call('prepare', browserWorkPlan[0], 0);
    const categories = await send({ method: 'Tracing.getCategories' });
    if (!isRecord(categories) || !Array.isArray(categories.categories) || !categories.categories.every((v) => typeof v === 'string'))
      throw new Error('Missing supported trace categories');
    const supported = categories.categories;
    log.categories = ['blink.user_timing', 'devtools.timeline', 'toplevel', 'v8.execute'].filter((name) => supported.includes(name));
    if (!log.categories.includes('blink.user_timing') || !log.categories.includes('devtools.timeline'))
      throw new Error('Required browser trace categories unavailable');
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
    for (const [index, workClass] of browserWorkPlan.entries()) {
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
