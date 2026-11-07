import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchBrowserDiagnostic, observerProbePageCall, captureBrowserWork } from './browser-work-probe.ts';
import { ObserverError, traceLimits, browserTraceCategories, type ObserverOptions, type ObserverPacket, type TraceCommand } from './browser-work-trace.ts';
import { observerAssetSha256, observerDigest, observerPlan, observerRequiredSources, observerScene, parseObserverPins } from './trace-observer-report.ts';
import { traceObserverEntry, traceObserverProposal } from './trace-observer.ts';
import { runAdapter, AdapterFailure } from './trace_observer_packet/adapter.ts';
import { EvidenceStore } from './trace_observer_packet/evidence.ts';
import { bounded } from './native-trace.ts';

const at = '2026-11-06T12:00:00.000Z';
const stamp = (monotonicMs: number) => ({ at, monotonicMs });
const device = {
  vendor: 'test vendor',
  renderer: 'test Metal device',
  version: 'WebGL2',
  shadingLanguage: 'GLSL',
  context: { alpha: true, antialias: true, depth: true, stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: true },
  contextLost: false,
};
function pins() {
  return parseObserverPins({
    source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), files: Object.fromEntries(observerRequiredSources.map((p) => [p, 'c'.repeat(64)])) },
    asset: { path: '/fixture/thalune.glb', sha256: observerAssetSha256 },
    scene: observerScene,
    browser: { version: 'HeadlessChrome fixture', executableSha256: 'd'.repeat(64), backend: 'metal' },
    device,
    loadCondition: { description: 'CPU fixture only; no actual hardware measured', logicalCores: 8, gpuReservation: 'CPU fixture only' },
    traceInitiallyIdle: true,
  });
}
function fence(label: string, elapsedMs = 2) {
  return {
    label,
    status: 'signaled',
    failure: null,
    startedAt: at,
    finishedAt: at,
    deletedAt: at,
    elapsedMs,
    polls: [
      { at, elapsedMs: 0, value: 37147, status: 'timeout-expired', yieldedBeforePoll: false },
      { at, elapsedMs, value: 37148, status: 'condition-satisfied', yieldedBeforePoll: true },
    ],
  };
}
function preparation(index: number) {
  return {
    diagnosticOnly: true,
    kind: 'native-work-class-control',
    contractVersion: 1,
    protocol: 'work-class',
    workClass: observerPlan[index].workClass,
    preparedAt: at,
    startedAt: null as string | null,
    finishedAt: null as string | null,
    timeOriginMs: 1,
    cancelled: false,
    failure: null,
    viewport: [1920, 1080],
    device,
    warm: { stable: true, underBudget: false, frames: 90, frameMs: 36 },
    glErrors: { before: [], after: [] },
    contextLostAfter: false,
    preflight: {
      disposed: true,
      settledAt: stamp(index * 1000 + 100),
      proof: {
        matches: true,
        steps: 4,
        side: 256,
        sampleChecksum: '00000000'.repeat(3),
        expectedSampleChecksum: '00000000'.repeat(3),
        points: [
          [0, 0],
          [17, 23],
          [255, 255],
        ].map(([x, y]) => ({ x, y, actual: [0, 0, 0, 0], expected: [0, 0, 0, 0], matches: true })),
      },
      passes: [1, 2, 3, 4].map((step) => ({ step, completed: true, calls: 1, triangles: 1 })),
      completions: ['after-work-class-warmup', 'after-work-class-dependent-preflight', 'after-work-class-preflight-disposal'].map((label) => fence(label)),
    },
    samples: [] as unknown[],
  };
}
function control(index: number, prepare: ReturnType<typeof preparation>, duration: number) {
  const r = structuredClone(prepare),
    frames = r.workClass === 'frame-only' ? 1 : 0,
    start = index * 1000 + 200;
  r.startedAt = at;
  r.finishedAt = at;
  const clocks = { pinned: 120, game: 120, base: 120, render: 120, flora: 120, weather: 120, grade: 120, atmosphere: 120 };
  const temporal = {
    frameIdx: prepare.warm.frames * (index + 1) + Math.max(0, index - 2),
    histIdx: (prepare.warm.frames * (index + 1) + Math.max(0, index - 2)) % 2,
    histValid: true,
    prevKey: 'noon',
    marchPlanet: 1,
    jitter: [0.2, 0.3],
    historyValidUniform: 1,
    blend: 0.15,
    historySizes: [
      [960, 540],
      [960, 540],
    ],
  };
  r.samples = [
    {
      workClass: r.workClass,
      failure: null,
      operations: { frames, png: 0, queries: 0 },
      frameCompleted: Boolean(frames),
      started: stamp(start),
      finished: stamp(start + duration),
      controlStarted: stamp(start),
      controlFinished: stamp(start + duration),
      frameStarted: frames ? stamp(start + 2) : null,
      frameFinished: frames ? stamp(start + 3) : null,
      rendered: frames ? { calls: 650, triangles: 3792981 } : null,
      clocksBefore: clocks,
      clocksAfter: { ...clocks },
      temporalBefore: temporal,
      temporalAfter: { ...temporal, frameIdx: temporal.frameIdx + frames, histIdx: (temporal.histIdx + frames) % 2 },
      countersBefore: { calls: 650, triangles: 3792981 },
      countersAfter: { calls: 650, triangles: 3792981 },
      completions: [fence('before-native-work-class'), fence('after-native-work-class', duration - 3)],
    },
  ];
  return r;
}
type Reply = { value: ReturnType<typeof preparation>; failure: string | null; markers: { name: string; monotonicMs: number }[]; pageErrors: unknown[] };
function fixture(
  config: {
    mutate?(reply: Reply, index: number, action: string): void;
    traceData?(data: { traceEvents: unknown[] }, index: number): unknown;
    onCommand?(command: TraceCommand, emitter: EventEmitter, index: number): void;
    duration?(index: number): number;
    warmFrames?: number;
  } = {},
) {
  const emitter = new EventEmitter(),
    abort = new AbortController(),
    sourcePins = pins();
  const commands: { index: number; command: TraceCommand }[] = [],
    calls: { index: number; action: string; work: string; arm: string; active: boolean }[] = [];
  const retained: unknown[] = [],
    reports: ObserverPacket[] = [],
    chunks = new Map<number, Buffer[]>();
  let index = 0,
    hosts = 0,
    now = 0,
    active = false,
    cancelled = 0,
    disconnected = 0;
  let marks: { name: string; monotonicMs: number }[] = [],
    prepared = preparation(0);
  const options: ObserverOptions & { retainReport(packet: ObserverPacket): void } = {
    protocol: 'trace-observer-v1',
    prefix: 'bwt-' + '1'.repeat(32),
    rendererPids: [12],
    pins: sourcePins,
    signal: abort.signal,
    clock: { now: () => now++, bound: bounded },
    observe: async () => {
      index = Math.floor(hosts++ / 2);
      return { at, monotonicMs: now, pinsSha256: observerDigest(sourcePins), logicalCores: 8, load: [1, 1, 1], errors: [] };
    },
    trace: {
      on: (event, cb) => {
        emitter.on(event, cb);
      },
      off: (event, cb) => {
        emitter.off(event, cb);
      },
      disconnect: async () => {
        disconnected++;
        active = false;
      },
      send: async (command) => {
        commands.push({ index, command });
        config.onCommand?.(command, emitter, index);
        if (command.method === 'Tracing.getCategories') return { categories: [...browserTraceCategories] };
        if (command.method === 'Tracing.start') {
          if (active) throw new Error('Trace already active');
          active = true;
          marks = [];
        }
        if (command.method === 'Tracing.end') {
          active = false;
          emitter.emit('Tracing.tracingComplete', { dataLossOccurred: false, stream: `s${index}` });
        }
        if (command.method === 'IO.read') {
          const data = {
            traceEvents: marks.map((m) => ({ name: m.name, cat: 'blink.user_timing', ph: 'I', s: 't', pid: 12, tid: 1, ts: m.monotonicMs * 1000 })),
          };
          return { data: JSON.stringify(config.traceData?.(data, index) ?? data), eof: true };
        }
        return {};
      },
    },
    probe: {
      call: async (action, work, id, arm) => {
        calls.push({ index, action, work, arm, active });
        if (active !== (arm === 'on')) throw new Error('Trace crossed arm boundary');
        if (action === 'prepare') {
          prepared = preparation(index);
          prepared.warm.frames = config.warmFrames ?? 90;
        }
        const value =
          action === 'prepare' ? structuredClone(prepared) : control(index, prepared, config.duration?.(index) ?? (index < 2 ? 8 : arm === 'on' ? 50 : 30));
        const start = index * 1000 + (action === 'prepare' ? 1 : 200),
          end = index * 1000 + (action === 'prepare' ? 150 : 400);
        const reply: Reply = {
          value,
          failure: null,
          markers: [
            { name: `${id}-start`, monotonicMs: start },
            { name: `${id}-end`, monotonicMs: end },
          ],
          pageErrors: [],
        };
        config.mutate?.(reply, index, action);
        if (active) marks.push(...reply.markers);
        return reply;
      },
      cancel: async () => {
        cancelled++;
      },
    },
    sink: {
      retainStep: (i, action, raw) => {
        retained.push(structuredClone({ i, action, raw }));
      },
      appendTrace: (i, bytes) => {
        const parts = chunks.get(i) ?? [];
        parts.push(bytes);
        chunks.set(i, parts);
      },
    },
    retainReport: (packet) => {
      reports.push(structuredClone(packet));
    },
  };
  return { options, commands, calls, retained, reports, chunks, abort, emitter, state: () => ({ active, cancelled, disconnected }) };
}
async function failed(f: ReturnType<typeof fixture>) {
  try {
    await dispatchBrowserDiagnostic(f.options);
    throw new Error('Expected failure');
  } catch (error) {
    if (!(error instanceof ObserverError)) throw error;
    expect(f.reports.at(-1)?.status).toBe('failed');
    return error.evidence;
  }
}
const methods = (f: ReturnType<typeof fixture>) => f.commands.map((c) => c.command.method);
const arrayFaults = ['all-holes', 'first-hole', 'last-hole', 'undefined', 'null', 'inherited-index'] as const;
function damageArray(values: unknown[], fault: (typeof arrayFaults)[number]) {
  if (fault === 'all-holes') for (let i = 0; i < values.length; i++) delete values[i];
  else if (fault === 'first-hole') delete values[0];
  else if (fault === 'last-hole') delete values[values.length - 1];
  else if (fault === 'inherited-index') {
    const first = values[0];
    delete values[0];
    Object.setPrototypeOf(values, Object.assign(Object.create(Array.prototype), { 0: first }));
  } else values[0] = fault === 'null' ? null : undefined;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fixed observer dispatcher and report with CPU ports', () => {
  it('does identical reference work in five alternating pairs, closes all six on streams, and makes zero off tracing calls', async () => {
    const f = fixture(),
      result = await dispatchBrowserDiagnostic(f.options);
    expect(result.status).toBe('observed');
    expect(result.totals).toMatchObject({
      preparations: 12,
      warmUpFrames: 1080,
      frames: 10,
      dependentPasses: 48,
      preflightFences: 36,
      controlFences: 24,
      png: 0,
      queries: 0,
      segments: 6,
      reads: 6,
      events: 24,
    });
    expect(f.calls).toHaveLength(24);
    expect(f.calls.map((c) => [c.arm, c.work])).toEqual(
      observerPlan.flatMap((p) => [
        [p.arm, p.workClass],
        [p.arm, p.workClass],
      ]),
    );
    expect(f.commands.every((c) => observerPlan[c.index].arm === 'on')).toBe(true);
    expect(methods(f).filter((m) => m === 'IO.close')).toHaveLength(6);
    expect(f.emitter.eventNames()).toEqual([]);
    expect(f.state().active).toBe(false);
    expect(result.summary).toMatchObject({ differences: { median: 20, min: 20, max: 20, range: 0 }, decision: 'observer-cost-issue', budgetQualified: false });
    expect(result.summary?.pairs).toHaveLength(5);
    expect(result.steps.filter((s) => s.arm === 'off').every((s) => s.receipt.kind === 'trace-off')).toBe(true);
    expect(
      result.steps
        .filter((s) => s.arm === 'on')
        .every((s) => s.receipt.kind === 'trace-on' && s.receipt.closedStreams.length === 1 && s.receipt.markers.length === 4),
    ).toBe(true);
    expect(f.retained).toHaveLength(24);
    expect(f.reports).toHaveLength(1);
  });
  it.each([
    ['similar arms', (i: number) => (i < 2 ? 8 : 30), 'targeted-workload-next'],
    ['long empty fences', (i: number) => (i < 2 ? 34.6 : 30), 'inconclusive'],
    ['unstable arms', (i: number) => (i < 2 ? 8 : i === 2 ? 100 : 30), 'inconclusive'],
  ] as const)('%s changes the diagnostic next step, never qualifies budget', async (_label, duration, decision) => {
    const result = await dispatchBrowserDiagnostic(fixture({ duration }).options);
    expect(result.summary?.decision).toBe(decision);
    expect(result.summary?.budgetQualified).toBe(false);
  });
  it.each([
    'missing-polls',
    'bad-poll-order',
    'missing-temporal',
    'query',
    'wrong-work',
    'missing-device',
    'warm-overflow',
    'page-error',
    'bad-reply',
    'changed-preparation',
  ])('stops first failure on %s and persists raw/report before returning', async (fault) => {
    const f = fixture({
      mutate(r, i, action) {
        if (i !== 2 || action !== 'run') return;
        const sample = r.value.samples[0] as Record<string, unknown>;
        const completions = sample.completions as ReturnType<typeof fence>[];
        if (fault === 'missing-polls') completions[0].polls = [];
        if (fault === 'bad-poll-order') completions[0].polls[0].elapsedMs = 10;
        if (fault === 'missing-temporal') delete sample.temporalAfter;
        if (fault === 'query') sample.operations = { frames: 1, png: 0, queries: 1 };
        if (fault === 'wrong-work') sample.rendered = { calls: 1, triangles: 1 };
        if (fault === 'missing-device') Reflect.deleteProperty(r.value, 'device');
        if (fault === 'warm-overflow') r.value.warm.frames = 601;
        if (fault === 'page-error') r.pageErrors.push('actual error');
        if (fault === 'bad-reply') r.markers.pop();
        if (fault === 'changed-preparation') r.value.warm.frames++;
      },
    });
    const result = await failed(f);
    expect(result.steps).toHaveLength(3);
    expect(methods(f).filter((m) => m === 'IO.close')).toHaveLength(2);
    expect(f.retained).toHaveLength(6);
  });
  it('rejects mismatched work immediately rather than completing later pairs', async () => {
    const f = fixture({
      mutate(r, i, action) {
        if (i === 3 && action === 'run') (r.value.samples[0] as Record<string, unknown>).rendered = { calls: 1, triangles: 1 };
      },
    });
    expect((await failed(f)).steps).toHaveLength(4);
  });
  it.each(['loss', 'missing-marker', 'duplicate-terminal', 'malformed-json', 'buffer-full', 'close-failure'])(
    'closes known streams and never retries on %s',
    async (fault) => {
      const f = fixture({
        onCommand(command, emitter, index) {
          if (index !== 0) return;
          if (command.method === 'Tracing.start' && fault === 'buffer-full') emitter.emit('Tracing.bufferUsage', { percentFull: 0.91 });
          if (command.method === 'Tracing.end' && fault === 'loss') emitter.emit('Tracing.tracingComplete', { stream: 'lost', dataLossOccurred: true });
          if (command.method === 'Tracing.end' && fault === 'duplicate-terminal')
            emitter.emit('Tracing.tracingComplete', { stream: 'duplicate', dataLossOccurred: false });
          if (command.method === 'IO.close' && fault === 'close-failure') throw new Error('close rejected');
        },
        traceData(data) {
          return fault === 'missing-marker' ? { traceEvents: data.traceEvents.slice(1) } : fault === 'malformed-json' ? { malformed: true } : data;
        },
      });
      const r = await failed(f);
      expect(r.steps).toHaveLength(1);
      expect(methods(f)).toContain('IO.close');
      expect(f.state().active).toBe(false);
    },
  );
  it.each([0, 1, 3])('cancellation at index %s retains late raw, closes on streams and calls no tracing in off arms', async (index) => {
    const f = fixture({
      mutate(_r, i, action) {
        if (i === index && action === 'prepare') f.abort.abort(new Error('cancelled fixture'));
      },
    });
    const r = await failed(f);
    expect(r.steps).toHaveLength(index + 1);
    expect(r.failure).toContain('cancelled fixture');
    expect(f.commands.every((c) => observerPlan[c.index].arm === 'on')).toBe(true);
    expect(f.state().active).toBe(false);
    const saved = JSON.stringify(r);
    await Promise.resolve();
    expect(JSON.stringify(r)).toBe(saved);
  });
  it('pre-cancel and malformed pins have zero port effects', async () => {
    const f = fixture();
    f.abort.abort(new Error('before'));
    await failed(f);
    expect(f.commands).toEqual([]);
    expect(f.calls).toEqual([]);
    const other = fixture();
    other.options.pins = {};
    await expect(dispatchBrowserDiagnostic(other.options)).rejects.toThrow('Missing');
    expect(other.commands).toEqual([]);
  });
  it('enforces aggregate event ceiling across segments, not per segment', async () => {
    const f = fixture({
      traceData(data) {
        return { traceEvents: [...data.traceEvents, ...Array(50000).fill({})] };
      },
    });
    const r = await failed(f);
    expect(r.failure).toContain('Aggregate trace event');
    expect(r.totals.segments).toBe(5);
    expect(methods(f).filter((m) => m === 'IO.close')).toHaveLength(5);
  });
  it('stops reading at aggregate 1024 calls and closes the stream', async () => {
    const f = fixture(),
      send = f.options.trace.send;
    f.options.trace.send = async (command) => (command.method === 'IO.read' ? { data: ' ', eof: false } : send(command));
    const r = await failed(f);
    expect(r.totals.reads).toBe(traceLimits.reads);
    expect(r.failure).toContain('read/deadline');
    expect(methods(f)).toContain('IO.close');
  });
});

describe('disabled entry and actual page adapter', () => {
  it('imports and proposes with no browser launch, acquisition, grant or binding', async () => {
    const proposal = traceObserverEntry(['--proposal']);
    expect(proposal).toMatchObject({
      readiness: 'disabled',
      runtimeAuthorized: false,
      binding: null,
      grant: null,
      historical: { cloud03: 'FAILED', accepted: false },
    });
    expect(proposal).toEqual(traceObserverProposal());
    for (const args of [[], ['--run'], ['--proposal', '--grant', 'old'], ['--admission', 'old']]) expect(() => traceObserverEntry(args)).toThrow('disabled');
    // Existing cloud/browser caller cannot dispatch the new protocol even through an untyped caller.
    await expect(Reflect.apply(captureBrowserWork, undefined, [null, new AbortController().signal, 'trace-observer-v1'])).rejects.toThrow('Unknown fixed');
  });
  it.each(['on', 'off'] as const)('serialized page adapter calls unchanged prepare/run; %s emits only authorized markers', async (arm) => {
    const calls: unknown[] = [],
      marks: string[] = [];
    const pageCall: typeof observerProbePageCall = vm.runInNewContext('(' + observerProbePageCall.toString() + ')', {
      window: {
        review: {
          nativeWorkClassProbe: async (...args: unknown[]) => {
            calls.push(args);
            return { raw: true };
          },
        },
      },
      performance: {
        now: () => 2,
        mark: (name: string) => {
          marks.push(name);
          return { startTime: 2 };
        },
      },
    });
    for (const action of ['prepare', 'run'] as const) await pageCall({ action, workClass: 'frame-only', id: action, arm });
    expect(calls).toEqual([
      ['prepare', 'frame-only'],
      ['run', 'frame-only'],
    ]);
    expect(marks).toHaveLength(arm === 'on' ? 4 : 0);
  });
});

describe('finite lifecycle failure boundaries', () => {
  it('drains a timed-out preparation and retains its late reply before returning', async () => {
    const f = fixture(),
      call = f.options.probe.call;
    let release = () => {},
      completed = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.options.probe.call = async (...args) => {
      await gate;
      const result = await call(...args);
      completed = true;
      return result;
    };
    f.options.probe.cancel = async () => {
      release();
    };
    f.options.clock = {
      now: () => 1,
      bound: async (task, ms, label, signal) => {
        if (label === 'prepare') {
          await Promise.resolve();
          throw new Error('injected preparation deadline');
        }
        return bounded(task, ms, label, signal);
      },
    };
    const r = await failed(f);
    expect(r.failure).toContain('injected preparation deadline');
    expect(completed).toBe(true);
    expect(f.retained).toHaveLength(1);
    expect(r.steps).toHaveLength(1);
    expect(methods(f)).toContain('IO.close');
    expect(f.emitter.eventNames()).toEqual([]);
  });
  it('closes a stream even if start acknowledgement fails', async () => {
    const f = fixture(),
      send = f.options.trace.send;
    f.options.trace.send = async (command) => {
      const result = await send(command);
      if (command.method === 'Tracing.start') throw new Error('lost start acknowledgement');
      return result;
    };
    const r = await failed(f);
    expect(r.failure).toContain('lost start');
    expect(methods(f)).toContain('Tracing.end');
    expect(methods(f)).toContain('IO.close');
    expect(f.calls).toHaveLength(0);
  });
  it('retains and closes terminal handles delivered during transport drain', async () => {
    const f = fixture(),
      send = f.options.trace.send;
    f.options.trace.send = async (command) => (command.method === 'Tracing.end' ? {} : send(command));
    f.options.trace.disconnect = async () => {
      f.emitter.emit('Tracing.tracingComplete', { dataLossOccurred: false, stream: 'late-handle' });
    };
    f.options.clock = {
      now: () => 1,
      bound: async (task, ms, label, signal) => {
        if (label === 'trace-end') {
          await Promise.resolve();
          throw new Error('injected end timeout');
        }
        return bounded(task, ms, label, signal);
      },
    };
    const r = await failed(f);
    expect(r.failure).toContain('injected end timeout');
    expect(f.commands.some((c) => c.command.method === 'IO.close' && c.command.params.handle === 'late-handle')).toBe(true);
    expect(f.emitter.eventNames()).toEqual([]);
  });
  it('enforces aggregate 64 MiB while closing the overflowing stream', async () => {
    const f = fixture(),
      send = f.options.trace.send;
    f.options.sink.appendTrace = () => {};
    f.options.trace.send = async (command) => (command.method === 'IO.read' ? { data: ' '.repeat(traceLimits.chunkBytes), eof: false } : send(command));
    const r = await failed(f);
    expect(r.failure).toContain('Aggregate trace byte');
    expect(r.totals.bytes).toBe(traceLimits.streamBytes);
    expect(r.totals.reads).toBe(129);
    expect(methods(f)).toContain('IO.close');
  });
  it('fails changed host pins after closing the first stream, without another preparation', async () => {
    const f = fixture(),
      observe = f.options.observe;
    let count = 0;
    f.options.observe = async () => {
      const raw = await observe();
      return ++count === 2 ? { ...Object(raw), pinsSha256: 'changed' } : raw;
    };
    const r = await failed(f);
    expect(r.failure).toContain('pins changed');
    expect(f.calls).toHaveLength(2);
    expect(methods(f)).toContain('IO.close');
  });
  it('uses the retained outer ceiling and does not issue work after expiry', async () => {
    const f = fixture();
    let clock = 0;
    f.options.clock = {
      now: () => {
        clock += 2000000;
        return clock;
      },
      bound: bounded,
    };
    const r = await failed(f);
    expect(r.failure).toContain('capture deadline');
    expect(f.calls).toHaveLength(0);
    expect(f.commands).toHaveLength(0);
  });
  it('does not retry a stream close failure', async () => {
    const f = fixture({
      onCommand(c) {
        if (c.method === 'IO.close') throw new Error('close failed');
      },
    });
    const r = await failed(f);
    expect(r.cleanupErrors.join()).toContain('close failed');
    expect(methods(f).filter((m) => m === 'IO.close')).toHaveLength(1);
  });
  it('retains malformed terminal payload and closes its known handle', async () => {
    const f = fixture(),
      send = f.options.trace.send;
    f.options.trace.send = async (c) => {
      if (c.method === 'Tracing.end') {
        f.emitter.emit('Tracing.tracingComplete', { dataLossOccurred: 'bad', stream: 'malformed' });
        return {};
      }
      return send(c);
    };
    const r = await failed(f);
    expect(r.failure).toContain('tracingComplete schema');
    expect(methods(f)).toContain('IO.close');
  });
  it('stops on raw persistence failure, closes the trace and keeps the partial value in the final packet', async () => {
    const f = fixture();
    f.options.sink.retainStep = () => {
      throw new Error('storage failed');
    };
    const r = await failed(f);
    expect(r.failure).toContain('storage failed');
    expect(r.steps[0].prepare).not.toBeNull();
    expect(methods(f)).toContain('IO.close');
  });
});

describe('raw observation validation', () => {
  it('accepts natural game clock progression and signed timeBase drift without resetting it', async () => {
    const f = fixture({
      mutate(reply, index, action) {
        if (index < 2 || action !== 'run') return;
        const s = reply.value.samples[0] as { clocksBefore: Record<string, number>; clocksAfter: Record<string, number> };
        s.clocksBefore.base = -1e-12;
        s.clocksAfter.base = -2e-12;
        s.clocksAfter.game += 1 / 60;
        s.clocksAfter.render += 1 / 60;
      },
    });
    expect((await dispatchBrowserDiagnostic(f.options)).status).toBe('observed');
  });
  it.each(['origin', 'history', 'proof', 'phase', 'pins', 'missing-errors'])('fails closed on %s observations', async (fault) => {
    const f = fixture({
      mutate(r, i, action) {
        if (i !== 3) return;
        if (action === 'prepare' && fault === 'origin') r.value.timeOriginMs++;
        if (action === 'prepare' && fault === 'proof') Reflect.deleteProperty(r.value.preflight.proof, 'points');
        if (action === 'run' && fault === 'history') {
          const s = r.value.samples[0] as { temporalBefore: { frameIdx: number }; temporalAfter: { frameIdx: number } };
          s.temporalBefore.frameIdx = 0;
          s.temporalAfter.frameIdx = 1;
        }
        if (action === 'run' && fault === 'phase') r.markers[1].monotonicMs = r.markers[0].monotonicMs;
        if (action === 'prepare' && fault === 'pins') r.value.device = { ...r.value.device, renderer: 'different' };
        if (action === 'prepare' && fault === 'missing-errors') Reflect.deleteProperty(r, 'pageErrors');
      },
    });
    expect((await failed(f)).steps).toHaveLength(4);
  });
  it('retains failure status if final report persistence fails', async () => {
    const f = fixture({
      mutate(r) {
        r.failure = 'primary failure';
      },
    });
    f.options.retainReport = () => {
      throw new Error('report store failed');
    };
    try {
      await dispatchBrowserDiagnostic(f.options);
      throw new Error('expected failure');
    } catch (error) {
      if (!(error instanceof ObserverError)) throw error;
      expect(error.message).toContain('primary failure');
      expect(error.evidence.cleanupErrors.join()).toContain('report store failed');
    }
  });
});

it('refuses a preparation that already contains a control before issuing run', async () => {
  const f = fixture({
    mutate(r, index, action) {
      if (index === 0 && action === 'prepare') r.value.samples.push({ previous: true });
    },
  });
  const result = await failed(f);
  expect(result.failure).toContain('previous control');
  expect(f.calls.map((c) => c.action)).toEqual(['prepare']);
  expect(methods(f)).toContain('IO.close');
});
it('treats malformed trace buffer event counts as failure and closes the segment', async () => {
  const f = fixture({
    onCommand(c, emitter) {
      if (c.method === 'Tracing.start') emitter.emit('Tracing.bufferUsage', { percentFull: 0.1, eventCount: -1 });
    },
  });
  const result = await failed(f);
  expect(result.failure).toContain('trace event count');
  expect(f.calls).toEqual([]);
  expect(methods(f)).toContain('IO.close');
});

describe('independent review regressions at the actual dispatcher/report boundary', () => {
  it.each(['pre-abort', 'prepare-reject', 'off-abort', 'deadline-reject', 'reply-failure'])(
    'empty %s never resolves an incomplete observed packet',
    async (fault) => {
      const f = fixture();
      if (fault === 'pre-abort') f.abort.abort('');
      if (fault === 'prepare-reject')
        f.options.probe.call = async () => {
          throw '';
        };
      if (fault === 'off-abort' || fault === 'reply-failure') {
        const call = f.options.probe.call;
        f.options.probe.call = async (...args) => {
          const raw = await call(...args);
          if (fault === 'off-abort' && args[3] === 'off') f.abort.abort('');
          return fault === 'reply-failure' ? { ...Object(raw), failure: '' } : raw;
        };
      }
      if (fault === 'deadline-reject')
        f.options.clock = {
          now: () => 1,
          bound: async (task, ms, label, signal) => {
            if (label === 'host-before') {
              await task;
              throw '';
            }
            return bounded(task, ms, label, signal);
          },
        };
      const r = await failed(f);
      expect(r.status).toBe('failed');
      expect(r.summary).toBeNull();
      expect(r.steps.length).toBeLessThan(12);
      expect(f.reports[0].status).toBe('failed');
      if (fault !== 'reply-failure') expect(r.failure).toBe('');
      if (fault === 'pre-abort' || fault === 'deadline-reject') {
        expect(f.calls).toEqual([]);
        expect(f.commands).toEqual([]);
      }
      expect(f.commands.filter((c) => c.command.method === 'Tracing.start')).toHaveLength(fault === 'pre-abort' || fault === 'deadline-reject' ? 0 : 1);
    },
  );
  it.each(['calls', 'triangles'])('rejects fence-only %s increments before the next control', async (key) => {
    const f = fixture({
      mutate(r, i, action) {
        if (i === 0 && action === 'run') {
          const s = r.value.samples[0] as { countersAfter: Record<string, number> };
          s.countersAfter[key]++;
        }
      },
    });
    const r = await failed(f);
    expect(r.failure).toContain('Fence-only');
    expect(r.steps).toHaveLength(1);
    expect(f.calls).toHaveLength(2);
  });
  it.each(['prepare', 'run'] as const)('reconciles raw fence enums with labels in %s, not just signaled metadata', async (action) => {
    const f = fixture({
      mutate(r, i, actual) {
        if (i !== 0 || actual !== action) return;
        const records = action === 'prepare' ? r.value.preflight.completions : (r.value.samples[0] as { completions: ReturnType<typeof fence>[] }).completions;
        records[0].polls[1].value = 37149;
      },
    });
    const r = await failed(f);
    expect(r.failure).toContain('poll');
    expect(r.steps).toHaveLength(1);
    expect(f.calls).toHaveLength(action === 'prepare' ? 1 : 2);
  });
  it('accepts matching ALREADY_SIGNALED while rejecting mismatched successful labels', async () => {
    for (const status of ['already-signaled', 'condition-satisfied']) {
      const f = fixture({
        mutate(r, i, action) {
          if (i !== 0 || action !== 'run') return;
          const c = (r.value.samples[0] as { completions: ReturnType<typeof fence>[] }).completions[0];
          c.polls[1].value = 37146;
          c.polls[1].status = status;
        },
      });
      if (status === 'already-signaled') expect((await dispatchBrowserDiagnostic(f.options)).status).toBe('observed');
      else expect((await failed(f)).steps).toHaveLength(1);
    }
  });
  it.each([
    ['historySizes', {}],
    ['historySizes', [[960, 540]]],
    [
      'historySizes',
      [
        [960, 540],
        [960.5, 540],
      ],
    ],
    ['histIdx', '0'],
    ['historyValidUniform', true],
    ['historyValidUniform', 2],
    ['blend', {}],
    ['blend', NaN],
    ['blend', Infinity],
    ['blend', 1.1],
    ['prevKey', false],
    ['marchPlanet', {}],
    ['marchPlanet', 0.5],
    ['jitter', [0, Infinity]],
    ['jitter', [0, 0, 0]],
  ])('rejects malformed temporal %s: %j before the next preparation', async (key, value) => {
    const f = fixture({
      mutate(r, i, action) {
        if (i === 2 && action === 'run') {
          const s = r.value.samples[0] as { temporalBefore: Record<string, unknown> };
          s.temporalBefore[String(key)] = value;
        }
      },
    });
    const r = await failed(f);
    expect(r.failure).toMatch(/temporal|history index/i);
    expect(r.steps).toHaveLength(3);
    expect(f.calls).toHaveLength(6);
  });
  it.each([90, 91, 600])('accepts parity-correct history through %s warm-up frames per preparation', async (warmFrames) => {
    const result = await dispatchBrowserDiagnostic(fixture({ warmFrames }).options);
    expect(result.status).toBe('observed');
    expect(result.portSettlement.kind).toBe('ports-settled');
    expect(result.totals.warmUpFrames).toBe(warmFrames * 12);
    for (const step of result.steps.slice(1)) {
      const previous = result.steps[step.index - 1];
      expect(step.counts?.historyIndexBefore).toBe((Number(previous.counts?.historyIndexAfter) + warmFrames) % 2);
    }
  });
  it.each([90, 91])('rejects a history-index reset despite correct frameIdx and %s intervening warm-ups', async (warmFrames) => {
    const f = fixture({
      warmFrames,
      mutate(r, i, action) {
        if (i === 3 && action === 'run') {
          const s = r.value.samples[0] as { temporalBefore: { histIdx: number }; temporalAfter: { histIdx: number } };
          s.temporalBefore.histIdx = 1 - s.temporalBefore.histIdx;
          s.temporalAfter.histIdx = 1 - s.temporalAfter.histIdx;
        }
      },
    });
    const r = await failed(f);
    expect(r.failure).toContain('History progression');
    expect(r.steps).toHaveLength(4);
  });
  it.each([5, 6, 8.999, 9, 9.001, 10, -5, -6, -8.999, -9, -9.001, -10])('compares every signed %sms gap against max(range)+5', async (gap) => {
    const result = await dispatchBrowserDiagnostic(
      fixture({
        duration(i) {
          const step = observerPlan[i];
          return step.pair === null ? 8 : 30 + step.pair + (step.arm === 'on' ? gap : 0);
        },
      }).options,
    );
    expect(result.summary?.criteria.gapThresholdMs).toBeCloseTo(9, 8);
    expect(result.summary?.decision).toBe(Math.abs(gap) > 9 ? 'observer-cost-issue' : Math.abs(gap) <= 5 ? 'targeted-workload-next' : 'inconclusive');
    expect(result.summary?.budgetQualified).toBe(false);
  });
  it.each(['before', 'after'] as const)('retains a returned host-%s fact before concurrent cancellation', async (position) => {
    const f = fixture(),
      observe = f.options.observe;
    let count = 0,
      returned: unknown;
    f.options.observe = async () => {
      const value = await observe();
      if (++count === (position === 'before' ? 1 : 2)) {
        returned = value;
        f.abort.abort(new Error('cancel with returned host'));
      }
      return value;
    };
    const r = await failed(f);
    expect(r.failure).toContain('cancel with returned host');
    expect(r.steps[0][position]).toEqual(returned);
    expect(f.reports[0].steps[0][position]).toEqual(returned);
    expect(f.calls).toHaveLength(position === 'before' ? 0 : 2);
  });
  it.each(['before', 'after'] as const)('retains a draining host-%s reply after its deadline but before publication', async (position) => {
    const f = fixture(),
      observe = f.options.observe;
    let count = 0,
      returned: unknown,
      release = () => {},
      started = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    f.options.observe = async () => {
      const value = await observe();
      if (++count === (position === 'before' ? 1 : 2)) {
        returned = value;
        started();
        await gate;
      }
      return value;
    };
    f.options.probe.cancel = async () => {
      release();
    };
    f.options.clock = {
      now: () => 1,
      bound: async (task, ms, label, signal) => {
        if (label === `host-${position}`) {
          await entered;
          throw new Error('host deadline');
        }
        return bounded(task, ms, label, signal);
      },
    };
    const r = await failed(f);
    expect(r.steps[0][position]).toEqual(returned);
    expect(r.portSettlement.kind).toBe('ports-settled');
  });
  it.each(['prepare', 'host-after'] as const)('publishes an explicit detached unsettled snapshot when %s ignores cancellation', async (label) => {
    const f = fixture();
    let release = () => {},
      started = () => {},
      lateTask: Promise<unknown> = Promise.resolve();
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    if (label === 'prepare') {
      const call = f.options.probe.call;
      f.options.probe.call = (...args) => {
        lateTask = (async () => {
          const raw = await call(...args);
          started();
          await gate;
          return raw;
        })();
        return lateTask;
      };
    } else {
      const observe = f.options.observe;
      let count = 0;
      f.options.observe = () => {
        lateTask = (async () => {
          const raw = await observe();
          if (++count === 2) {
            started();
            await gate;
          }
          return raw;
        })();
        return lateTask;
      };
    }
    f.options.probe.cancel = async () => {};
    f.options.clock = {
      now: () => 1,
      bound: async (task, ms, phase, signal) => {
        if (phase === label) {
          await entered;
          throw new Error('port deadline');
        }
        if (phase.includes('callbacks-drain')) throw new Error('port still pending');
        return bounded(task, ms, phase, signal);
      },
    };
    const r = await failed(f),
      saved = JSON.stringify(r),
      report = JSON.stringify(f.reports[0]),
      retained = f.retained.length;
    expect(r.portSettlement).toMatchObject({ kind: 'ports-unsettled', requiresController: true });
    expect(r.finishedMs).toBeNull();
    expect(r.snapshotAtMs).toBe(1);
    release();
    await lateTask;
    await Promise.resolve();
    expect(JSON.stringify(r)).toBe(saved);
    expect(JSON.stringify(f.reports[0])).toBe(report);
    expect(f.retained).toHaveLength(retained);
    expect(f.emitter.eventNames()).toEqual([]);
  });
  it('separates a retained report from the returned packet and from port-owned raw objects', async () => {
    const raw: Reply[] = [],
      f = fixture({
        mutate(reply) {
          raw.push(reply);
        },
      });
    let saved: ObserverPacket | undefined;
    f.options.retainReport = (packet) => {
      saved = packet;
    };
    const result = await dispatchBrowserDiagnostic(f.options),
      original = JSON.stringify(result);
    raw[0].value.warm.frames = 999;
    expect(JSON.stringify(result)).toBe(original);
    expect(JSON.stringify(saved)).toBe(original);
    if (!saved) throw new Error('Missing saved report');
    saved.steps.length = 0;
    expect(result.steps).toHaveLength(12);
  });
});

describe('R2 indexed evidence and decision boundaries', () => {
  const preflightArrays = [
    ['passes', (r: Reply) => r.value.preflight.passes],
    ['preflight fences', (r: Reply) => r.value.preflight.completions],
    ['preflight polls', (r: Reply) => r.value.preflight.completions[0].polls],
    ['proof points', (r: Reply) => r.value.preflight.proof.points],
    ['proof actual', (r: Reply) => r.value.preflight.proof.points[0].actual],
    ['proof expected', (r: Reply) => r.value.preflight.proof.points[0].expected],
    ['viewport', (r: Reply) => r.value.viewport],
  ] as const;
  type SampleArrays = {
    completions: ReturnType<typeof fence>[];
    temporalBefore: { jitter: number[]; historySizes: number[][] };
    temporalAfter: { jitter: number[]; historySizes: number[][] };
  };
  const sampleArrays = [
    ['control fences', (s: SampleArrays) => s.completions],
    ['control polls', (s: SampleArrays) => s.completions[0].polls],
    ['before jitter', (s: SampleArrays) => s.temporalBefore.jitter],
    ['after jitter', (s: SampleArrays) => s.temporalAfter.jitter],
    ['before history targets', (s: SampleArrays) => s.temporalBefore.historySizes],
    ['after history targets', (s: SampleArrays) => s.temporalAfter.historySizes],
    ['before history dimensions', (s: SampleArrays) => s.temporalBefore.historySizes[0]],
    ['after history dimensions', (s: SampleArrays) => s.temporalAfter.historySizes[0]],
  ] as const;
  const cases = [
    ...(['prepare', 'run'] as const).flatMap((action) => preflightArrays.map(([name, select]) => ({ name, action, select }))),
    { name: 'samples', action: 'run', select: (r: Reply) => r.value.samples },
    ...sampleArrays.map(([name, select]) => ({ name, action: 'run', select: (r: Reply) => select(r.value.samples[0] as SampleArrays) })),
  ];
  it.each(cases.flatMap((test) => arrayFaults.map((fault) => ({ ...test, fault }))))(
    'rejects $fault in $action $name before counting incomplete work or issuing another control',
    async ({ action, select, fault }) => {
      const f = fixture({
        mutate(r, i, actual) {
          if (i === 0 && actual === action) damageArray(select(r), fault);
        },
      });
      const r = await failed(f);
      expect(r.summary).toBeNull();
      expect(r.steps).toHaveLength(1);
      expect(r.steps[0].counts).toBeNull();
      expect(r.totals.dependentPasses).toBe(action === 'prepare' ? 0 : 4);
      expect(r.totals.preflightFences).toBe(action === 'prepare' ? 0 : 3);
      expect(r.totals.controlFences).toBe(0);
      expect(f.calls.map((c) => c.action)).toEqual(action === 'prepare' ? ['prepare'] : ['prepare', 'run']);
      expect(f.retained).toHaveLength(action === 'prepare' ? 1 : 2);
      expect(r.steps[0][action === 'prepare' ? 'prepare' : 'run']).not.toBeNull();
      expect(methods(f).filter((m) => m === 'IO.close')).toHaveLength(1);
      expect(f.state().active).toBe(false);
    },
  );
  it.each((['before', 'after'] as const).flatMap((position) => arrayFaults.map((fault) => ({ position, fault }))))(
    'rejects $fault in host $position load without losing returned facts',
    async ({ position, fault }) => {
      const f = fixture(),
        observe = f.options.observe;
      let calls = 0;
      f.options.observe = async () => {
        const value = await observe();
        if (++calls === (position === 'before' ? 1 : 2)) damageArray((value as { load: number[] }).load, fault);
        return value;
      };
      const r = await failed(f);
      expect(r.steps).toHaveLength(1);
      expect(r.steps[0][position]).not.toBeNull();
      expect(r.summary).toBeNull();
      expect(f.calls).toHaveLength(position === 'before' ? 0 : 2);
    },
  );
  it.each([
    { gaps: [1, -1, 1, -1, 1], mixed: true, decision: 'inconclusive' },
    { gaps: [1, 0, -1, 0, 1], mixed: true, decision: 'inconclusive' },
    { gaps: [0, 0, 0, 0, 0], mixed: false, decision: 'targeted-workload-next' },
    { gaps: [1, 0, 1, 0, 1], mixed: false, decision: 'targeted-workload-next' },
    { gaps: [-1, 0, -1, 0, -1], mixed: false, decision: 'targeted-workload-next' },
    { gaps: [5, 5, 5, 5, 5], mixed: false, decision: 'targeted-workload-next' },
    { gaps: [5.001, 5.001, 5.001, 5.001, 5.001], mixed: false, decision: 'observer-cost-issue' },
    { gaps: [-5.001, -5.001, -5.001, -5.001, -5.001], mixed: false, decision: 'observer-cost-issue' },
  ])('classifies signed gaps $gaps as $decision with zero gaps neutral', async ({ gaps, mixed, decision }) => {
    const r = await dispatchBrowserDiagnostic(
      fixture({
        duration(i) {
          const step = observerPlan[i];
          return step.pair === null ? 8 : 30 + (step.arm === 'on' ? gaps[step.pair] : 0);
        },
      }).options,
    );
    expect(r.summary?.decision).toBe(decision);
    expect(r.summary?.criteria).toMatchObject({ mixedSigns: mixed, similar: decision === 'targeted-workload-next' });
    expect(r.summary?.budgetQualified).toBe(false);
  });
});

describe('R3 advisory admission boundaries in the new native caller unit', () => {
  it.each([Array(3), Object.assign(Array(3), { 0: 12, 2: 13 }), [NaN], [Infinity], [0], [1], [2147483648]].map((value) => ({ value })))(
    'rejects invalid real renderer PIDs $value before port effects',
    async ({ value: rendererPids }) => {
      const f = fixture();
      f.options.rendererPids = rendererPids as number[];
      await expect(dispatchBrowserDiagnostic(f.options)).rejects.toThrow();
      expect(f.commands).toEqual([]);
      expect(f.calls).toEqual([]);
    },
  );
  it.each([Array(3), Object.assign(Array(3), { 0: 'blink.user_timing', 2: 'v8.execute' }), [NaN], [], ['blink.user_timing']].map((value) => ({ value })))(
    'rejects incomplete category receipt $value before tracing starts',
    async ({ value: categories }) => {
      const f = fixture(),
        send = f.options.trace.send;
      f.options.trace.send = (command) => (command.method === 'Tracing.getCategories' ? Promise.resolve({ categories }) : send(command));
      const r = await failed(f);
      expect(r.steps).toHaveLength(1);
      expect(methods(f)).not.toContain('Tracing.start');
      expect(f.calls).toEqual([]);
    },
  );
});

describe('concrete adapter with inert native ports', () => {
  function adapterFixture(config: Parameters<typeof fixture>[0] = {}) {
    const f = fixture(config),
      files = new Map<string, Buffer>();
    const store = new EvidenceStore(['/synthetic/primary', '/synthetic/fallback'], (path, bytes) => {
      files.set(path, bytes);
    });
    const ports = {
      trace: f.options.trace,
      pageCall: (input: Parameters<typeof observerProbePageCall>[0]) => f.options.probe.call(input.action, input.workClass, input.id, input.arm),
      cancel: f.options.probe.cancel,
      observeDevice: async () => device,
      host: async () => ({
        ...((await f.options.observe()) as { at: string; monotonicMs: number; logicalCores: number; load: number[]; errors: unknown[] }),
        externalContenders: 'unknown-not-excluded' as const,
      }),
      close: async () => {},
    };
    const admission = { prefix: f.options.prefix, rendererPids: [12], pins: pins(), maxLoad: [2, 2, 2] };
    return { f, ports, admission, store, files };
  }
  it('uses the actual dispatcher, fixed inventory, zero off trace calls, and closes all on streams', async () => {
    const { f, ports, admission, store, files } = adapterFixture();
    const packet = await runAdapter(admission, ports, store, f.abort.signal);
    expect(packet.status).toBe('observed');
    expect(packet.totals).toMatchObject({
      preparations: 12,
      frames: 10,
      dependentPasses: 48,
      preflightFences: 36,
      controlFences: 24,
      png: 0,
      queries: 0,
      segments: 6,
    });
    expect(f.commands.every((c) => observerPlan[c.index].arm === 'on')).toBe(true);
    expect(methods(f).filter((m) => m === 'IO.close')).toHaveLength(6);
    expect(files.has('/synthetic/primary/packet.json')).toBe(true);
    expect(files.get('/synthetic/primary/adapter-terminal.json')?.toString()).toContain('EXTERNAL_CONTROLLER_REQUIRED');
  });
  it.each(['load', 'device', 'page', 'cancel', 'write', 'all-sinks', 'close'])(
    'retains failed %s facts without claiming physical settlement',
    async (fault) => {
      const { f, ports, admission, store } = adapterFixture();
      let active = store;
      if (fault === 'load')
        ports.host = async () => ({
          ...((await f.options.observe()) as Awaited<ReturnType<typeof ports.host>>),
          load: [NaN, 1, 1],
          externalContenders: 'unknown-not-excluded',
        });
      if (fault === 'device') ports.observeDevice = async () => ({ ...device, renderer: 'changed' });
      if (fault === 'page') ports.pageCall = async () => ({ value: null, failure: '', markers: [], pageErrors: [] });
      if (fault === 'cancel') f.abort.abort('');
      if (fault === 'write' || fault === 'all-sinks')
        active = new EvidenceStore(['/primary', '/fallback'], (path) => {
          if (fault === 'all-sinks' || path.startsWith('/primary')) throw new Error('injected write/close/publication failure');
        });
      if (fault === 'close')
        ports.close = async () => {
          throw new Error('close failure');
        };
      await expect(runAdapter(admission, ports, active, f.abort.signal)).rejects.toBeInstanceOf(AdapterFailure);
      expect(active.raw.size).toBeGreaterThan(0);
      expect(f.calls.length).toBeLessThanOrEqual(24);
      if (fault === 'all-sinks') expect(Object.keys(active.receipt().undurable).length).toBeGreaterThan(0);
    },
  );
  it('cuts off late host replies before new device work and keeps failure snapshots detached', async () => {
    vi.useFakeTimers();
    const { f, ports, admission, store } = adapterFixture();
    let release = (_value: Awaited<ReturnType<typeof ports.host>>) => {};
    const raw = await ports.host();
    ports.host = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const deviceCall = vi.fn(ports.observeDevice);
    ports.observeDevice = deviceCall;
    const pending = runAdapter(admission, ports, store, f.abort.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    f.abort.abort(new Error('cancel pending host'));
    await vi.runAllTimersAsync();
    const failure = await pending;
    expect(failure).toBeInstanceOf(AdapterFailure);
    if (!(failure instanceof AdapterFailure)) throw new Error('Expected detached adapter failure');
    const saved = JSON.stringify(failure.facts),
      count = store.raw.size;
    release(raw);
    await vi.advanceTimersByTimeAsync(1);
    expect(deviceCall).not.toHaveBeenCalled();
    expect(store.raw.size).toBe(count);
    expect(JSON.stringify(failure.facts)).toBe(saved);
    expect(JSON.stringify(failure.facts)).toContain('ports-unsettled');
  });
});
