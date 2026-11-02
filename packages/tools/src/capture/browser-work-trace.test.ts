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
  it('missing marker coverage is inconclusive, not successful timing evidence', async () => {
    const f = fixture();
    f.setCommand((c) => (c.method === 'IO.read' ? Promise.resolve({ data: '{"traceEvents":[]}', eof: true }) : undefined));
    const log = await failure(f);
    expect(log.status).toBe('inconclusive');
    expect(log.markerCoverage.status).toBe('missing-or-ambiguous');
  });
});
describe('marker identity and observed schema', () => {
  const expected = [{ name: `${prefix}-s00-run-start`, monotonicMs: 1 }];
  const event = { name: expected[0].name, cat: 'blink.user_timing', ts: 1000, pid: 12, tid: 1, ph: 'R' };
  const check = (rows: unknown[]) => markerCoverage(Buffer.from(JSON.stringify({ traceEvents: rows })), expected, [12]);
  it('accepts exactly one observed marker in the verified renderer', () => {
    expect(check([event]).status).toBe('observed');
  });
  it.each([{ pid: 99 }, { ts: -1 }, { tid: 0 }, { cat: 'gpu' }, { name: event.name + '-wrong' }, { ph: '' }])('rejects wrong identity/schema %j', (change) => {
    expect(check([{ ...event, ...change }]).status).toBe('missing-or-ambiguous');
  });
  it('does not ignore an ambiguous duplicate', () => {
    expect(check([event, { ...event, cat: 'other' }]).status).toBe('missing-or-ambiguous');
  });
});
