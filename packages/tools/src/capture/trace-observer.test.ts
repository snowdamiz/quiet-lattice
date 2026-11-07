import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchBrowserDiagnostic, observerProbePageCall, captureBrowserWork } from './browser-work-probe.ts';
import { ObserverError, traceLimits, type ObserverOptions, type ObserverPacket, type TraceCommand } from './browser-work-trace.ts';
import { observerAssetSha256, observerDigest, observerPlan, observerRequiredSources, observerScene, parseObserverPins } from './trace-observer-report.ts';
import { traceObserverEntry, traceObserverProposal } from './trace-observer.ts';
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
    frameIdx: 90 * (index + 1) + Math.max(0, index - 2),
    histIdx: 0,
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
      temporalAfter: { ...temporal, frameIdx: temporal.frameIdx + frames, histIdx: frames },
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
        if (command.method === 'Tracing.getCategories') return { categories: [] };
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
        if (action === 'prepare') prepared = preparation(index);
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
