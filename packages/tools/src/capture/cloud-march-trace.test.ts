import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  BrowserWorkError,
  browserWorkPlan,
  cloudMarchModes,
  runBrowserWorkTrace,
  type BrowserDiagnosticProtocol,
  type WorkClass,
} from './browser-work-trace.ts';

function fixture(protocol?: BrowserDiagnosticProtocol, failAt?: string) {
  const emitter = new EventEmitter(),
    calls: { action: string; workClass: WorkClass; id: string }[] = [],
    marks: { name: string; monotonicMs: number }[] = [],
    chunks: Buffer[] = [];
  let tracing = false,
    closed = false;
  const options: Parameters<typeof runBrowserWorkTrace>[0] = {
    protocol,
    prefix: 'bwt-' + 'a'.repeat(32),
    rendererPids: [12],
    trace: {
      on: (name, listener) => {
        emitter.on(name, listener);
      },
      off: (name, listener) => {
        emitter.off(name, listener);
      },
      disconnect: async () => {},
      send: async (command) => {
        switch (command.method) {
          case 'Tracing.getCategories':
            return { categories: [] };
          case 'Tracing.start':
            tracing = true;
            return {};
          case 'Tracing.end':
            tracing = false;
            queueMicrotask(() => emitter.emit('Tracing.tracingComplete', { dataLossOccurred: false, stream: 'owned' }));
            return {};
          case 'IO.close':
            closed = true;
            return {};
          case 'IO.read':
            return {
              data: JSON.stringify({
                traceEvents: [
                  ...marks.map((m) => ({ name: m.name, cat: 'blink.user_timing', ph: 'I', s: 't', pid: 12, tid: 1, ts: m.monotonicMs * 1000 })),
                  ...marks
                    .filter((m) => /-s(0[2-9]|1[01])-run-start$/.test(m.name))
                    .map((m) => ({ name: 'FunctionCall', cat: 'devtools.timeline', ph: 'X', pid: 12, tid: 1, ts: m.monotonicMs * 1000 + 1, dur: 1 })),
                ],
              }),
              eof: true,
            };
        }
      },
    },
    probe: {
      call: async (action, workClass, id) => {
        calls.push({ action, workClass, id });
        const markers = [
          { name: id + '-start', monotonicMs: calls.length * 3 },
          { name: id + '-end', monotonicMs: calls.length * 3 + 1 },
        ];
        if (tracing) marks.push(...markers);
        return { value: { workClass }, markers, failure: id.includes(failAt ?? 'NEVER') ? 'PRIMARY CONTROL FAILURE' : null };
      },
      cancel: async () => {},
    },
    sink: {
      append: (b) => {
        chunks.push(b);
      },
      read: () => Buffer.concat(chunks),
      retainStep: () => {},
      validateStep: () => {},
      retainSample: () => {},
    },
  };
  return { options, calls, isClosed: () => closed };
}
describe('two explicit protocols reuse the same accepted trace lifecycle', () => {
  it('keeps the default exact original output protocol and all marker/window semantics', async () => {
    const f = fixture(),
      result = await runBrowserWorkTrace(f.options);
    expect(result.protocol).toBe('frame-output');
    expect(f.calls.map((c) => c.workClass)).toEqual(browserWorkPlan.flatMap((v) => [v, v]));
    expect(result.controls).toHaveLength(12);
    expect(result.preparation).toHaveLength(12);
    expect(result.controls.filter((c) => c.workClass === 'frame-plus-PNG')).toHaveLength(5);
    expect(result.cpuContext.frameWindows.filter((w) => w.workClass === 'frame-plus-PNG')).toHaveLength(5);
    expect(result.markerCoverage.events).toHaveLength(46);
    expect(f.isClosed()).toBe(true);
  });
  it('selects only empty/fence/ten frame-only operations with correct new context labels', async () => {
    const f = fixture('cloud-march-reuse'),
      result = await runBrowserWorkTrace(f.options);
    expect(result.protocol).toBe('cloud-march-reuse');
    expect(f.calls.map((c) => c.workClass)).toEqual(
      cloudMarchModes.flatMap((v) => [v === 'reference' || v === 'reuse' ? 'frame-only' : v, v === 'reference' || v === 'reuse' ? 'frame-only' : v]),
    );
    expect(result.controls.filter((c) => c.workClass === 'frame-only')).toHaveLength(10);
    expect(result.controls.some((c) => c.workClass === 'frame-plus-PNG')).toBe(false);
    expect(result.cpuContext.frameWindows.every((w) => w.workClass === 'frame-only')).toBe(true);
    expect(result.cpuContext.status).toBe('supported-context-observed');
    expect(result.trace.streamClosed).toBe(true);
  });
  it('settles the same lifecycle and issues no later control after cloud protocol failure', async () => {
    const f = fixture('cloud-march-reuse', '-s02-run');
    await expect(runBrowserWorkTrace(f.options)).rejects.toBeInstanceOf(BrowserWorkError);
    expect(f.calls.at(-1)?.id).toContain('-s02-run');
    expect(f.calls).toHaveLength(6);
    expect(f.isClosed()).toBe(true);
  });
});
