import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { observeBrowserCategories } from './browser-work-probe.ts';
import { BrowserWorkError, browserTraceCategories, categoryReplyBytes, runBrowserWorkTrace, type TraceCommand, type WorkClass } from './browser-work-trace.ts';

const directories: string[] = [];
const fresh = () => {
  const out = mkdtempSync(join(tmpdir(), 't13-category-cpu-'));
  directories.push(out);
  return out;
};
const receipt = (out: string) => JSON.parse(readFileSync(join(out, 'protocol-categories.json'), 'utf8'));
afterEach(() => {
  for (const out of directories.splice(0)) {
    chmodSync(out, 0o700);
    rmSync(out, { recursive: true, force: true });
  }
});

describe('actual category provider, CPU/file fixtures only', () => {
  it.each([{ categories: [] }, { categories: ['unrelated'], extra: { full: 'kept' } }, { categories: [...browserTraceCategories] }, null, { categories: 4 }])(
    'retains complete returned JSON before a caller can validate %j',
    async (response) => {
      const out = fresh(),
        errors = ['OBSERVED PAGE ERROR'];
      const returned = await observeBrowserCategories({ out, send: async () => response, pageErrors: () => [...errors], cleanupErrors: [] });
      expect(returned).toBe(response);
      expect(receipt(out)).toMatchObject({ method: 'Tracing.getCategories', response, protocolFailure: null, pageErrors: errors });
      expect(receipt(out).requested).toHaveProperty('monotonicNs');
      expect(receipt(out).received).toHaveProperty('at');
      expect(existsSync(join(out, 'protocol-categories.json.writing'))).toBe(false);
      expect(statSync(join(out, 'protocol-categories.json')).mode & 0o777).toBe(0o600);
    },
  );
  it('keeps a protocol rejection primary when real failure-receipt creation is refused', async () => {
    const out = fresh(),
      original = new Error('PRIMARY CDP FAILURE'),
      cleanupErrors: string[] = [];
    chmodSync(out, 0o500);
    await expect(
      observeBrowserCategories({
        out,
        send: async () => {
          throw original;
        },
        pageErrors: () => [],
        cleanupErrors,
      }),
    ).rejects.toBe(original);
    expect(cleanupErrors).toHaveLength(1);
    expect(cleanupErrors[0]).toContain('EACCES');
    expect(existsSync(join(out, 'protocol-categories.json'))).toBe(false);
  });
  it('retains protocol rejection and page errors when the failure receipt succeeds', async () => {
    const out = fresh(),
      original = new Error('PRIMARY CDP FAILURE');
    await expect(
      observeBrowserCategories({
        out,
        send: async () => {
          throw original;
        },
        pageErrors: () => ['PAGE'],
        cleanupErrors: [],
      }),
    ).rejects.toBe(original);
    expect(receipt(out)).toMatchObject({ response: null, protocolFailure: 'Error: PRIMARY CDP FAILURE', pageErrors: ['PAGE'] });
  });
  it('a successful reply with refused persistence fails instead of silently proceeding', async () => {
    const out = fresh();
    chmodSync(out, 0o500);
    await expect(observeBrowserCategories({ out, send: async () => ({ categories: [] }), pageErrors: () => [], cleanupErrors: [] })).rejects.toThrow('EACCES');
  });
  it('retains bounded prefix/hash and fails on protocol receipt overflow', async () => {
    const out = fresh();
    await expect(
      observeBrowserCategories({ out, send: async () => ({ categories: [], extra: 'x'.repeat(categoryReplyBytes) }), pageErrors: () => [], cleanupErrors: [] }),
    ).rejects.toThrow('overflow');
    expect(statSync(join(out, 'protocol-categories.json.prefix')).size).toBe(categoryReplyBytes);
    const info = JSON.parse(readFileSync(join(out, 'protocol-categories.json.overflow.json'), 'utf8'));
    expect(info).toMatchObject({ retainedBytes: categoryReplyBytes, complete: false });
    expect(info.bytes).toBeGreaterThan(categoryReplyBytes);
    expect(info.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(out, 'protocol-categories.json'))).toBe(false);
  });
  it('refuses a second publication without overwriting the first returned facts', async () => {
    const out = fresh(),
      options = { out, send: async () => ({ categories: [] }), pageErrors: () => [], cleanupErrors: [] };
    await observeBrowserCategories(options);
    const saved = readFileSync(join(out, 'protocol-categories.json'));
    await expect(observeBrowserCategories(options)).rejects.toThrow('EEXIST');
    expect(readFileSync(join(out, 'protocol-categories.json'))).toEqual(saved);
  });
});

function lifecycle(out: string, response: unknown, discover?: () => Promise<unknown>) {
  const prefix = 'bwt-' + 'a'.repeat(32),
    emitter = new EventEmitter(),
    commands: TraceCommand[] = [],
    calls: string[] = [],
    chunks: Buffer[] = [];
  const marks: { name: string; monotonicMs: number }[] = [];
  let tracing = false;
  const options: Parameters<typeof runBrowserWorkTrace>[0] = {
    prefix,
    rendererPids: [12],
    limits: { prepareMs: 100, controlMs: 100, protocolMs: 100, flushMs: 100 },
    trace: {
      on: (e, fn) => {
        emitter.on(e, fn);
      },
      off: (e, fn) => {
        emitter.off(e, fn);
      },
      disconnect: async () => {},
      send: async (c) => {
        commands.push(c);
        if (c.method === 'Tracing.getCategories')
          return observeBrowserCategories({ out, send: discover ?? (async () => response), pageErrors: () => [], cleanupErrors: [] });
        if (c.method === 'Tracing.start') {
          tracing = true;
          return {};
        }
        if (c.method === 'Tracing.end') {
          queueMicrotask(() => emitter.emit('Tracing.tracingComplete', { dataLossOccurred: false, stream: 's' }));
          return {};
        }
        if (c.method === 'IO.read') {
          const points = marks.map((m) => ({ name: m.name, cat: 'blink.user_timing', ph: 'I', s: 't', ts: m.monotonicMs * 1000, pid: 12, tid: 1 }));
          const cpu = marks
            .filter((m) => /-s(0[2-9]|1[01])-run-start$/.test(m.name))
            .map((m) => ({ name: 'FunctionCall', cat: 'devtools.timeline', ph: 'X', ts: m.monotonicMs * 1000 + 100, dur: 100, pid: 12, tid: 1 }));
          return { data: JSON.stringify({ traceEvents: [...points, ...cpu] }), eof: true };
        }
        return {};
      },
    },
    probe: {
      call: async (action: string, workClass: WorkClass, id: string) => {
        calls.push(`${action}:${workClass}`);
        const points = [
          { name: `${id}-start`, monotonicMs: marks.length + 1 },
          { name: `${id}-end`, monotonicMs: marks.length + 2 },
        ];
        if (tracing) marks.push(...points);
        return { value: { CPU_PROVIDER: true }, failure: null, markers: points };
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
  return { options, commands, calls };
}
describe('actual category provider inside the owned trace lifecycle, CPU providers only', () => {
  it('empty enumeration retains raw extra fields then uses fixed selectors and actual context gates', async () => {
    const out = fresh(),
      raw = { categories: [], extra: 'complete raw field' },
      f = lifecycle(out, raw);
    const log = await runBrowserWorkTrace(f.options);
    expect(receipt(out).response).toEqual(raw);
    expect(log.status).toBe('observed');
    expect(log.cpuContext).toMatchObject({ status: 'supported-context-observed', attribution: 'INCONCLUSIVE' });
    expect(log.controls).toHaveLength(12);
    expect(log.preparation).toHaveLength(12);
    expect(log.trace.streamClosed).toBe(true);
    expect(f.commands.find((c) => c.method === 'Tracing.start')).toMatchObject({ params: { traceConfig: { includedCategories: browserTraceCategories } } });
  });
  it('returned malformed raw survives validation failure with no subsequent start/control', async () => {
    const out = fresh(),
      raw = { categories: 3, retainedPredicate: 'wrong type' },
      f = lifecycle(out, raw);
    await expect(runBrowserWorkTrace(f.options)).rejects.toBeInstanceOf(BrowserWorkError);
    expect(receipt(out).response).toEqual(raw);
    expect(f.commands.map((c) => c.method)).toEqual(['Tracing.getCategories']);
    expect(f.calls).toEqual(['prepare:drained-empty']);
  });
  it('a late reply is persisted during cancellation settlement before stable terminal evidence, with no later start/control', async () => {
    const out = fresh(),
      controller = new AbortController(),
      raw = { categories: [], late: 'returned during cancel' };
    const f = lifecycle(out, raw, async () => {
      controller.abort(new Error('PRIMARY CANCEL'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      return raw;
    });
    f.options.signal = controller.signal;
    let evidence;
    try {
      await runBrowserWorkTrace(f.options);
      throw new Error('Expected cancellation');
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserWorkError);
      if (!(error instanceof BrowserWorkError)) throw error;
      evidence = error.evidence;
    }
    expect(evidence.failure).toContain('PRIMARY CANCEL');
    expect(receipt(out).response).toEqual(raw);
    expect(f.commands.map((c) => c.method)).toEqual(['Tracing.getCategories']);
    expect(f.calls).toEqual(['prepare:drained-empty']);
    const terminal = JSON.stringify(evidence),
      saved = readFileSync(join(out, 'protocol-categories.json'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(JSON.stringify(evidence)).toBe(terminal);
    expect(readFileSync(join(out, 'protocol-categories.json'))).toEqual(saved);
  });
  it('a discovery timeout remains primary while retaining its returned raw during drain', async () => {
    const out = fresh(),
      raw = { categories: [], delayed: true },
      f = lifecycle(out, raw, async () => {
        await new Promise((r) => setTimeout(r, 15));
        return raw;
      });
    f.options.limits = { prepareMs: 100, controlMs: 100, protocolMs: 2, flushMs: 100 };
    let evidence;
    try {
      await runBrowserWorkTrace(f.options);
      throw new Error('Expected timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserWorkError);
      if (!(error instanceof BrowserWorkError)) throw error;
      evidence = error.evidence;
    }
    expect(evidence.failure).toContain('Tracing.getCategories exceeded');
    expect(receipt(out).response).toEqual(raw);
    expect(f.commands.map((c) => c.method)).toEqual(['Tracing.getCategories']);
    expect(f.calls).toEqual(['prepare:drained-empty']);
  });
});
