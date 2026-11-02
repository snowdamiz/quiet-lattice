import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  BrowserWorkError,
  browserWorkPlan,
  markerCoverage,
  runBrowserWorkTrace,
  traceLimits,
  type ProbePort,
  type TraceCommand,
  type TracePort,
  type WorkClass,
} from './browser-work-trace.ts';

const prefix = 'bwt-' + '1'.repeat(32);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture() {
  const emitter = new EventEmitter();
  const calls: string[] = [],
    commands: TraceCommand[] = [],
    markers: { name: string; monotonicMs: number }[] = [],
    samples: unknown[] = [],
    steps: unknown[] = [],
    chunks: Buffer[] = [];
  let tracing = false,
    live = false,
    cancelCount = 0,
    disconnected = false;
  let rejectPending: (error: Error) => void = () => {};
  let onCall: ((action: string, workClass: WorkClass, id: string) => Promise<void>) | undefined;
  let onCommand: ((command: TraceCommand) => Promise<unknown> | undefined) | undefined;
  const events = () => markers.map((m) => ({ name: m.name, cat: 'blink.user_timing', ts: m.monotonicMs * 1000, pid: 12, tid: 1, ph: 'R' }));
  const trace: TracePort = {
    on: (event, fn) => {
      emitter.on(event, fn);
    },
    off: (event, fn) => {
      emitter.off(event, fn);
    },
    disconnect: async () => {
      disconnected = true;
      rejectPending(new Error('fake transport disconnected'));
    },
    send: async (command) => {
      commands.push(command);
      const custom = onCommand?.(command);
      if (custom) return custom;
      switch (command.method) {
        case 'Tracing.getCategories':
          return { categories: ['blink.user_timing', 'devtools.timeline', 'toplevel'] };
        case 'Tracing.start':
          tracing = true;
          return {};
        case 'Tracing.end':
          tracing = false;
          queueMicrotask(() => emitter.emit('Tracing.tracingComplete', { dataLossOccurred: false, stream: 's' }));
          return {};
        case 'IO.read':
          return { data: JSON.stringify({ traceEvents: events() }), eof: true };
        case 'IO.close':
          return {};
      }
    },
  };
  const probe: ProbePort = {
    call: async (action, workClass, id) => {
      calls.push(`${action}:${workClass}`);
      live = true;
      try {
        await onCall?.(action, workClass, id);
        const result = [
          { name: `${id}-start`, monotonicMs: markers.length + 1 },
          { name: `${id}-end`, monotonicMs: markers.length + 2 },
        ];
        if (tracing) markers.push(...result);
        return { value: { workClass, temporalPhase: calls.length }, failure: null, markers: result };
      } finally {
        live = false;
      }
    },
    cancel: async () => {
      cancelCount++;
      rejectPending(new Error('fake page closed'));
      await delay(1);
    },
  };
  const options: Parameters<typeof runBrowserWorkTrace>[0] & { limits: NonNullable<Parameters<typeof runBrowserWorkTrace>[0]['limits']> } = {
    trace,
    probe,
    prefix,
    rendererPids: [12],
    sink: {
      append: (b: Buffer) => {
        chunks.push(b);
      },
      read: () => Buffer.concat(chunks),
      retainStep: (...args) => {
        steps.push(args);
      },
      validateStep: () => {},
      retainSample: (index: number, workClass: WorkClass, value: unknown) => {
        samples.push({ index, workClass, value });
      },
    },
    limits: { prepareMs: 50, controlMs: 50, protocolMs: 20, flushMs: 20 },
  };
  return {
    options,
    calls,
    commands,
    markers,
    samples,
    steps,
    emitter,
    chunks,
    events,
    setCall: (fn: typeof onCall) => {
      onCall = fn;
    },
    setCommand: (fn: typeof onCommand) => {
      onCommand = fn;
    },
    pending: () =>
      new Promise<void>((_, reject) => {
        rejectPending = reject;
      }),
    state: () => ({ live, cancelCount, disconnected, listeners: emitter.eventNames().length }),
  };
}
async function failure(f: ReturnType<typeof fixture>) {
  try {
    await runBrowserWorkTrace(f.options);
    throw new Error('Expected diagnostic failure');
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserWorkError);
    if (!(error instanceof BrowserWorkError)) throw error;
    return error.evidence;
  }
}
describe('owned browser trace lifecycle, CPU providers only', () => {
  it('runs exactly five alternating pairs plus both controls, preserving later preparation windows', async () => {
    const f = fixture(),
      log = await runBrowserWorkTrace(f.options);
    expect(log.status).toBe('observed');
    expect(log.controls.map((v) => v.workClass)).toEqual(browserWorkPlan);
    expect(log.preparation).toHaveLength(12);
    expect(log.preparation.map((v) => v.insideTrace)).toEqual([false, ...Array(11).fill(true)]);
    expect(f.samples).toHaveLength(12);
    expect(log.markers).toHaveLength(46);
    expect(log.trace.streamClosed).toBe(true);
    expect(f.commands.find((v) => v.method === 'Tracing.start')).toMatchObject({
      params: { tracingBackend: 'chrome', traceConfig: { enableSystrace: false, enableSampling: false } },
    });
    expect(f.state()).toMatchObject({ live: false, listeners: 0 });
  });
  it('cancels and settles an in-flight callback before returning on early trace completion', async () => {
    const f = fixture();
    f.setCall(async (action) => {
      if (action === 'run') {
        queueMicrotask(() => f.emitter.emit('Tracing.tracingComplete', { dataLossOccurred: false, stream: 's' }));
        await f.pending();
      }
    });
    const log = await failure(f);
    expect(log.failure).toContain('Unexpected early');
    expect(f.calls).toEqual(['prepare:drained-empty', 'run:drained-empty']);
    expect(f.state().live).toBe(false);
    const saved = JSON.stringify(log);
    await delay(5);
    expect(JSON.stringify(log)).toBe(saved);
    expect(f.state().listeners).toBe(0);
  });
  it.each(['Tracing.bufferUsage', 'close'])('stops future frames after %s during preparation', async (event) => {
    const f = fixture();
    f.setCall(async (action, cls) => {
      if (action === 'prepare' && cls === 'fence-only') {
        queueMicrotask(() => f.emitter.emit(event, { percentFull: 0.95 }));
        await f.pending();
      }
    });
    const log = await failure(f);
    expect(log.status).toBe('failed');
    expect(f.calls).toEqual(['prepare:drained-empty', 'run:drained-empty', 'prepare:fence-only']);
    expect(f.state().live).toBe(false);
  });
  it('control timeout remains failed and waits for cancellation cleanup', async () => {
    const f = fixture();
    f.options.limits.controlMs = 2;
    f.setCall(async (action) => {
      if (action === 'run') await f.pending();
    });
    const log = await failure(f);
    expect(log.failure).toContain('exceeded');
    expect(log.trace.terminal).not.toBeNull();
    expect(f.state()).toMatchObject({ live: false, listeners: 0 });
  });
  it('preserves failed preparation and never launches its control', async () => {
    const f = fixture();
    f.setCall(async (action, cls) => {
      if (action === 'prepare' && cls === 'frame-only') throw new Error('prep failed');
    });
    const log = await failure(f);
    expect(log.failure).toContain('prep failed');
    expect(f.calls.filter((v) => v.startsWith('run:'))).toEqual(['run:drained-empty', 'run:fence-only']);
  });
  it('requires tracingComplete after a successful end acknowledgment', async () => {
    const f = fixture();
    f.setCommand((c) => (c.method === 'Tracing.end' ? Promise.resolve({}) : undefined));
    const log = await failure(f);
    expect(log.trace.terminal).toBeNull();
    expect(log.cleanupErrors.join()).toContain('exceeded');
    expect(f.state().disconnected).toBe(true);
  });
  it('retains a primary control failure independently of end and close failures', async () => {
    const f = fixture();
    f.setCall(async (a) => {
      if (a === 'run') throw new Error('PRIMARY');
    });
    f.setCommand((c) => (c.method === 'Tracing.end' ? Promise.reject(new Error('END FAIL')) : undefined));
    const log = await failure(f);
    expect(log.failure).toContain('PRIMARY');
    expect(log.cleanupErrors.join()).toContain('END FAIL');
  });
  it('known loss after end is failure even with a readable trace', async () => {
    const f = fixture();
    f.setCommand((c) => {
      if (c.method === 'Tracing.end') {
        queueMicrotask(() => f.emitter.emit('Tracing.tracingComplete', { dataLossOccurred: true, stream: 's' }));
        return Promise.resolve({});
      }
    });
    const log = await failure(f);
    expect(log.failure).toContain('data loss');
    expect(log.trace.streamClosed).toBe(true);
  });
  it.each(['bytes', 'chunk', 'schema', 'reads'])('bounds trace %s and closes its stream', async (mode) => {
    const f = fixture();
    if (mode === 'bytes') f.options.limits = { ...f.options.limits, streamBytes: 2 };
    if (mode === 'chunk')
      f.setCommand((c) => (c.method === 'IO.read' ? Promise.resolve({ data: 'x'.repeat(traceLimits.chunkBytes + 1), eof: true }) : undefined));
    if (mode === 'schema') f.setCommand((c) => (c.method === 'IO.read' ? Promise.resolve({ data: '', eof: 'no' }) : undefined));
    if (mode === 'reads') f.setCommand((c) => (c.method === 'IO.read' ? Promise.resolve({ data: '', eof: false }) : undefined));
    const log = await failure(f);
    expect(log.status).toBe('failed');
    expect(log.trace.streamClosed).toBe(true);
    expect(f.calls).toHaveLength(24); // overflow is detected in terminal reading, after controls; no later launch exists.
  });
  it('a hung stream read is disconnected and settled, not abandoned', async () => {
    const f = fixture();
    f.setCommand((c) => (c.method === 'IO.read' ? f.pending() : undefined));
    const log = await failure(f);
    expect(log.failure).toContain('IO.read exceeded');
    expect(f.state().disconnected).toBe(true);
    expect(log.trace.streamClosed).toBe(false);
  });
  it('reads bounded base64 chunks to EOF and closes the handle exactly once', async () => {
    const f = fixture();
    let offset = 0;
    f.setCommand((c) => {
      if (c.method !== 'IO.read') return;
      const bytes = Buffer.from(JSON.stringify({ traceEvents: f.events() }));
      const end = offset === 0 ? Math.ceil(bytes.length / 2) : bytes.length;
      const data = bytes.subarray(offset, end).toString('base64');
      offset = end;
      return Promise.resolve({ data, base64Encoded: true, eof: end === bytes.length });
    });
    const log = await runBrowserWorkTrace(f.options);
    expect(log.trace.reads).toBe(2);
    expect(log.trace.streamClosed).toBe(true);
    expect(f.commands.filter((c) => c.method === 'IO.close')).toHaveLength(1);
  });
  it('stream deadline failure still awaits the losing read before terminal evidence', async () => {
    const f = fixture();
    f.options.limits.streamMs = 2;
    let settled = false;
    f.setCommand((c) =>
      c.method === 'IO.read'
        ? (async () => {
            await delay(12);
            settled = true;
            return { data: '', eof: false };
          })()
        : undefined,
    );
    const log = await failure(f);
    expect(log.failure).toContain('IO.read exceeded');
    expect(settled).toBe(true);
    expect(f.state().listeners).toBe(0);
  });
  it('failed stream close remains failure despite a complete trace and marker coverage', async () => {
    const f = fixture();
    f.setCommand((c) => (c.method === 'IO.close' ? Promise.reject(new Error('CLOSE FAILED')) : undefined));
    const log = await failure(f);
    expect(log.failure).toContain('CLOSE FAILED');
    expect(log.cleanupErrors.join()).toContain('CLOSE FAILED');
    expect(log.markerCoverage.status).toBe('observed');
  });
  it('external cancellation before entry launches nothing', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const log = await failure({ ...f, options: { ...f.options, signal: controller.signal } });
    expect(log.failure).toContain('stop');
    expect(f.calls).toEqual([]);
    expect(f.commands).toEqual([]);
  });
  it('retains returned raw predicates before a reply/schema assertion fails', async () => {
    const f = fixture();
    const raw = { failure: null, value: { missingReadiness: true }, markers: [] };
    f.options.probe.call = async () => raw;
    const log = await failure(f);
    expect(log.failure).toContain('reply');
    expect(f.steps).toHaveLength(1);
    expect(f.steps[0]).toEqual([0, 'prepare', 'drained-empty', `${prefix}-s00-prepare`, raw]);
    expect(f.commands).toEqual([]);
  });
  it('retains a payload returned while cancellation settles, without validating or issuing another step', async () => {
    const f = fixture(),
      controller = new AbortController();
    f.options.signal = controller.signal;
    const raw = { failure: null, value: { partial: true, proof: { matches: false } }, markers: [] };
    let validated = 0;
    f.options.sink.validateStep = () => {
      validated++;
    };
    f.options.probe.call = async (action, cls) => {
      f.calls.push(`${action}:${cls}`);
      setTimeout(() => controller.abort(new Error('PRIMARY CANCELLATION')), 1);
      await delay(8);
      return raw;
    };
    const log = await failure(f);
    expect(log.failure).toContain('PRIMARY CANCELLATION');
    expect(f.steps).toHaveLength(1);
    expect(f.steps[0]).toEqual([0, 'prepare', 'drained-empty', `${prefix}-s00-prepare`, raw]);
    expect(validated).toBe(0);
    expect(f.calls).toEqual(['prepare:drained-empty']);
    expect(log.preparation).toEqual([]);
    const terminal = JSON.stringify(log);
    await delay(5);
    expect(JSON.stringify(log)).toBe(terminal);
    expect(f.steps).toHaveLength(1);
  });
  it('keeps cancellation primary and a returned-payload persistence failure as a separate settlement error', async () => {
    const f = fixture(),
      controller = new AbortController();
    f.options.signal = controller.signal;
    f.options.probe.call = async () => {
      setTimeout(() => controller.abort(new Error('PRIMARY CANCEL')), 1);
      await delay(8);
      return { partial: true };
    };
    f.options.sink.retainStep = () => {
      throw new Error('RAW PERSISTENCE FAILED');
    };
    f.options.sink.validateStep = () => {
      throw new Error('VALIDATION MUST NOT RUN');
    };
    const log = await failure(f);
    expect(log.failure).toContain('PRIMARY CANCEL');
    expect(log.cleanupErrors.join()).toContain('RAW PERSISTENCE FAILED');
    expect(log.cleanupErrors.join()).not.toContain('VALIDATION MUST NOT RUN');
    expect(f.commands).toEqual([]);
  });
  it('full lifecycle does not observe invalid phase/reversed/split-thread marker windows', async () => {
    const f = fixture();
    f.setCommand((c) =>
      c.method === 'IO.read'
        ? Promise.resolve({
            data: JSON.stringify({ traceEvents: f.events().map((e, i) => ({ ...e, ph: 'invalid-schema', ts: 1000000 - e.ts, tid: (i % 2) + 1 })) }),
            eof: true,
          })
        : undefined,
    );
    const log = await failure(f);
    expect(log.status).toBe('inconclusive');
    expect(log.markerCoverage.status).toBe('missing-or-ambiguous');
    expect(log.controls).toHaveLength(12);
  });
  it.each([false, true])('settles a full I/thread trace with contradictory qualifier=%s', async (invalid) => {
    const f = fixture();
    f.setCommand((c) =>
      c.method === 'IO.read'
        ? Promise.resolve({
            data: JSON.stringify({
              traceEvents: f.events().map((e, i) => ({ ...e, ph: 'I', s: 't', tts: e.ts, ...(invalid && i === 0 ? { use_async_tts: false } : {}) })),
            }),
            eof: true,
          })
        : undefined,
    );
    const log = invalid ? await failure(f) : await runBrowserWorkTrace(f.options);
    expect(log.status).toBe(invalid ? 'inconclusive' : 'observed');
    expect(log.markerCoverage.status).toBe(invalid ? 'missing-or-ambiguous' : 'observed');
    expect(log.controls).toHaveLength(12);
    expect(log.markers).toHaveLength(46);
    expect(log.trace.streamClosed).toBe(true);
    expect(f.state()).toMatchObject({ live: false, listeners: 0 });
  });
  it('missing marker coverage is inconclusive, not successful timing evidence', async () => {
    const f = fixture();
    f.setCommand((c) => (c.method === 'IO.read' ? Promise.resolve({ data: '{"traceEvents":[]}', eof: true }) : undefined));
    const log = await failure(f);
    expect(log.status).toBe('inconclusive');
    expect(log.markerCoverage.status).toBe('missing-or-ambiguous');
  });
});
describe('marker identity and observed schema', () => {
  const expected = [
    { name: `${prefix}-s00-run-start`, monotonicMs: 1 },
    { name: `${prefix}-s00-run-end`, monotonicMs: 2 },
  ];
  const event = { name: expected[0].name, cat: 'blink.user_timing', ts: 1000, pid: 12, tid: 1, ph: 'R' };
  const end = { ...event, name: expected[1].name, ts: 2000 };
  const check = (rows: unknown[]) => markerCoverage(Buffer.from(JSON.stringify({ traceEvents: rows })), expected, [12]);
  it('accepts exactly one observed marker in the verified renderer', () => {
    expect(check([event, end]).status).toBe('observed');
  });
  it.each([{ pid: 99 }, { ts: -1 }, { tid: 0 }, { cat: 'gpu' }, { name: event.name + '-wrong' }, { ph: '' }])('rejects wrong identity/schema %j', (change) => {
    expect(check([{ ...event, ...change }, end]).status).toBe('missing-or-ambiguous');
  });
  it('does not ignore an ambiguous duplicate', () => {
    expect(check([event, { ...event, cat: 'other' }, end]).status).toBe('missing-or-ambiguous');
  });
  it.each(['R', 'I'])('accepts the validated %s point representation', (ph) => {
    const fields = ph === 'I' ? { ph, s: 't' } : { ph };
    expect(
      check([
        { ...event, ...fields },
        { ...end, ...fields },
      ]).status,
    ).toBe('observed');
  });
  it('accepts the concrete saved Chrome156 I/thread shape, including its optional thread timestamp', () => {
    // Fields from marker task trace e89ab33e…; names alone are rebound to this diagnostic.
    const fields = { cat: 'blink.user_timing', ph: 'I', s: 't', pid: 60246, tid: 118016466 };
    const rows = [
      { ...fields, name: expected[0].name, ts: 1634879846733, tts: 1826241 },
      { ...fields, name: expected[1].name, ts: 1634879848511, tts: 1828010 },
    ];
    expect(markerCoverage(Buffer.from(JSON.stringify({ traceEvents: rows })), expected, [60246]).status).toBe('observed');
  });
  it.each(['n', 'i', 'X', 'B', 'E', 'unknown'])('leaves unsupported phase %s inconclusive', (ph) => {
    expect(
      check([
        { ...event, ph, s: 't' },
        { ...end, ph, s: 't' },
      ]).status,
    ).toBe('missing-or-ambiguous');
  });
  it.each([undefined, null, 'p', 'g', 'T', 0, {}])('refuses unsupported I scope %j', (scope) => {
    expect(
      check([
        { ...event, ph: 'I', s: scope },
        { ...end, ph: 'I', s: 't' },
      ]).status,
    ).toBe('missing-or-ambiguous');
  });
  it.each(['dur', 'tdur', 'id', 'id2', 'bind_id', 'use_async_tts'])('refuses every presence of I qualifier %s', (key) => {
    for (const value of [0, false, null, 'bad', 123, {}, []]) {
      expect(
        check([
          { ...event, ph: 'I', s: 't', [key]: value },
          { ...end, ph: 'I', s: 't' },
        ]).status,
      ).toBe('missing-or-ambiguous');
    }
  });
  it.each([null, false, '1', -1, Infinity, {}])('refuses malformed I thread timestamp %j', (tts) => {
    expect(
      check([
        { ...event, ph: 'I', s: 't', tts },
        { ...end, ph: 'I', s: 't' },
      ]).status,
    ).toBe('missing-or-ambiguous');
  });
  it.each([{ cat: 'blink.user_timing,other' }, { pid: 99 }, { pid: 1 }, { pid: 12.5 }, { tid: 0 }, { tid: 1.5 }, { ts: -1 }, { ts: null }, { ts: '1000' }])(
    'refuses I identity/category/time %j',
    (fields) => {
      expect(
        check([
          { ...event, ph: 'I', s: 't', ...fields },
          { ...end, ph: 'I', s: 't' },
        ]).status,
      ).toBe('missing-or-ambiguous');
    },
  );
  it.each([
    [{ ...event, ph: 'not-a-phase' }, end],
    [event, { ...end, ts: 500 }],
    [event, { ...end, tid: 2 }],
    [event, { ...end, pid: 13 }],
    [{ ...event, dur: 1 }, end],
  ])('does not accept invalid point/pair schema %j', (...rows) => {
    expect(markerCoverage(Buffer.from(JSON.stringify({ traceEvents: rows })), expected, [12, 13]).status).toBe('missing-or-ambiguous');
  });
  it('requires one renderer/thread and nonoverlapping sequential prepare/control windows', () => {
    const next = [
      { name: `${prefix}-s01-prepare-start`, monotonicMs: 3 },
      { name: `${prefix}-s01-prepare-end`, monotonicMs: 4 },
    ];
    const later = [
      { ...event, name: next[0].name, ts: 3000 },
      { ...end, name: next[1].name, ts: 4000 },
    ];
    const inspect = (rows: unknown[]) => markerCoverage(Buffer.from(JSON.stringify({ traceEvents: rows })), [...expected, ...next], [12, 13]);
    expect(inspect([event, end, ...later]).status).toBe('observed');
    expect(inspect([event, end, { ...later[0], ts: 1500 }, later[1]]).status).toBe('missing-or-ambiguous');
    expect(inspect([event, end, ...later.map((v) => ({ ...v, tid: 2 }))]).status).toBe('missing-or-ambiguous');
    expect(inspect([event, end, ...later.map((v) => ({ ...v, pid: 13 }))]).status).toBe('missing-or-ambiguous');
  });
});
