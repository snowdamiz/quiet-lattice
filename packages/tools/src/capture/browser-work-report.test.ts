import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserProbePageCall, browserWorkAdmission, retainBrowserStep } from './browser-work-probe.ts';
import { validateControl, validatePreparation } from './browser-work-report.ts';
import { workClasses, type WorkClass } from './browser-work-trace.ts';

function completion() {
  return { status: 'signaled', failure: null, deletedAt: 'at', polls: [{ status: 'condition-satisfied' }] };
}
function report(workClass: WorkClass) {
  const frames = workClass.startsWith('frame-') ? 1 : 0,
    png = workClass === 'frame-plus-PNG' ? 1 : 0;
  return {
    diagnosticOnly: true,
    kind: 'native-work-class-control',
    contractVersion: 1,
    workClass,
    preparedAt: 'prepared',
    finishedAt: 'finished',
    cancelled: false,
    failure: null,
    warm: { stable: true, frames: 90 },
    viewport: [1920, 1080],
    glErrors: { before: [], after: [] },
    contextLostAfter: false,
    preflight: { disposed: true, settledAt: {}, proof: { matches: true }, passes: [{}, {}, {}, {}], completions: [completion(), completion(), completion()] },
    samples: [
      {
        workClass,
        failure: null,
        operations: { frames, png, queries: 0 },
        frameCompleted: Boolean(frames),
        controlStarted: { monotonicMs: 1 },
        controlFinished: { monotonicMs: 8 },
        frameStarted: frames ? { monotonicMs: 2 } : null,
        frameFinished: frames ? { monotonicMs: 3 } : null,
        rendered: frames ? { calls: 650, triangles: 3792981 } : null,
        clocksBefore: { game: 120 },
        clocksAfter: { game: 120 },
        temporalBefore: { frameIdx: 457, histIdx: 1 },
        temporalAfter: { frameIdx: frames ? 458 : 457, histIdx: frames ? 0 : 1 },
        completions: workClass === 'drained-empty' ? [] : [completion(), completion()],
        ...(png ? { png: 'data:image/png;base64,CPU_FIXTURE', readbackStarted: { monotonicMs: 3 }, readbackFinished: { monotonicMs: 4 } } : {}),
      },
    ],
  };
}
describe('actual work and completion report boundaries', () => {
  it.each(workClasses)('counts %s with its actual temporal observations', (cls) => {
    const r = report(cls),
      counted = validateControl(r, cls);
    expect(counted.queries).toBe(0);
    expect(counted.frames).toBe(cls.startsWith('frame-') ? 1 : 0);
    expect(counted.png).toBe(cls === 'frame-plus-PNG' ? 1 : 0);
    expect(counted.syncs).toBe(cls === 'drained-empty' ? 0 : 2);
    expect(counted.preparation).toMatchObject({ warmUpFrames: 90, dependentPasses: 4, completions: 3 });
  });
  it('rejects any hidden PNG/readback field in a frame-only result', () => {
    for (const key of ['png', 'output', 'readbackStarted', 'readbackFinished']) {
      const r = report('frame-only');
      Object.assign(r.samples[0], { [key]: null });
      expect(() => validateControl(r, 'frame-only')).toThrow('structurally');
    }
  });
  it('rejects a query, missing frame or unsignaled completion', () => {
    const r = report('frame-only');
    r.samples[0].operations.queries = 1;
    expect(() => validateControl(r, 'frame-only')).toThrow();
    r.samples[0].operations.queries = 0;
    r.samples[0].frameCompleted = false;
    expect(() => validateControl(r, 'frame-only')).toThrow();
    r.samples[0].frameCompleted = true;
    r.samples[0].completions[0].status = 'pending';
    expect(() => validateControl(r, 'frame-only')).toThrow('completion');
  });
  it('fails GL/context/readiness evidence independently of output variation', () => {
    const r = report('frame-plus-PNG');
    r.contextLostAfter = true;
    expect(() => validateControl(r, 'frame-plus-PNG')).toThrow('GL');
    r.contextLostAfter = false;
    r.warm.stable = false;
    expect(() => validatePreparation(r, 'frame-plus-PNG')).toThrow('preparation');
  });
  it('does not impose adjacent-image equality or reset naturally progressing history', () => {
    const a = report('frame-plus-PNG'),
      b = report('frame-plus-PNG');
    b.samples[0].temporalBefore.frameIdx++;
    b.samples[0].temporalAfter.frameIdx++;
    b.samples[0].png = 'data:image/png;base64,DIFFERENT';
    const before = structuredClone(b);
    expect(validateControl(a, 'frame-plus-PNG').frames).toBe(1);
    expect(validateControl(b, 'frame-plus-PNG').frames).toBe(1);
    expect(b).toEqual(before);
  });
  it('rejects impossible PNG/frame clock order and zero submitted work', () => {
    const r = report('frame-plus-PNG');
    if (!r.samples[0].readbackStarted || !r.samples[0].rendered) throw new Error('Fixture missing');
    r.samples[0].readbackStarted.monotonicMs = 1;
    expect(() => validateControl(r, 'frame-plus-PNG')).toThrow('PNG boundary');
    r.samples[0].readbackStarted.monotonicMs = 3;
    r.samples[0].rendered.calls = 0;
    expect(() => validateControl(r, 'frame-plus-PNG')).toThrow('actual rendered work');
  });
});
const fixtureRoots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  performance.clearMarks();
  for (const path of fixtureRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});
describe('durable raw step evidence before assertions', () => {
  const id = 'bwt-' + '1'.repeat(32) + '-s00-prepare';
  it('retains returned invalid predicates and all bounded error fields without overwrite', () => {
    const out = mkdtempSync(join(tmpdir(), 't13-browser-step-'));
    fixtureRoots.push(out);
    const raw = {
      response: { value: { warm: { stable: false }, glErrors: { before: [1280] } }, failure: null },
      pageErrors: { total: 1, retained: ['actual console failure'] },
    };
    retainBrowserStep(out, id, raw);
    expect(JSON.parse(readFileSync(join(out, 'steps', id + '.json'), 'utf8'))).toEqual(raw);
    expect(() => retainBrowserStep(out, id, {})).toThrow();
    expect(JSON.parse(readFileSync(join(out, 'steps', id + '.json'), 'utf8'))).toEqual(raw);
  });
  it('retains an explicit prefix and full-byte hash if raw evidence exceeds its cap', () => {
    const out = mkdtempSync(join(tmpdir(), 't13-browser-step-'));
    fixtureRoots.push(out);
    expect(() => retainBrowserStep(out, id, { raw: 'x'.repeat(16 * 1024 * 1024) })).toThrow('overflow');
    expect(readdirSync(join(out, 'steps')).sort()).toEqual([id + '.json.prefix', id + '.overflow.json'].sort());
    expect(JSON.parse(readFileSync(join(out, 'steps', id + '.overflow.json'), 'utf8'))).toMatchObject({ complete: false, retainedBytes: 16 * 1024 * 1024 });
  });
});
describe('actual in-page adapter, CPU fake Review', () => {
  it('calls exactly the accepted action and work class, retaining real mark identities', async () => {
    const value = report('frame-only'),
      calls: unknown[] = [];
    vi.stubGlobal('window', {
      review: {
        nativeWorkClassProbe: async (...args: unknown[]) => {
          calls.push(args);
          return value;
        },
      },
    });
    const reply = await browserProbePageCall({ action: 'run', workClass: 'frame-only', id: 'sample-1-run' });
    expect(calls).toEqual([['run', 'frame-only']]);
    expect(reply.value).toBe(value);
    expect(reply.failure).toBeNull();
    expect(reply.markers.map((m) => m.name)).toEqual(['sample-1-run-start', 'sample-1-run-end']);
    expect(reply.markers[1].monotonicMs).toBeGreaterThanOrEqual(reply.markers[0].monotonicMs);
  });
  it('retains a failed action and partial accepted report without another frame/readback', async () => {
    const calls: unknown[] = [],
      partial = { failure: 'actual failure' };
    vi.stubGlobal('window', {
      review: {
        lastNativeWorkClassProbe: partial,
        nativeWorkClassProbe: async (...args: unknown[]) => {
          calls.push(args);
          throw new Error('primary');
        },
      },
    });
    const reply = await browserProbePageCall({ action: 'prepare', workClass: 'frame-plus-PNG', id: 'failed-prepare' });
    expect(reply.failure).toContain('primary');
    expect(reply.value).toBe(partial);
    expect(calls).toHaveLength(1);
    expect(reply.markers).toHaveLength(2);
  });
  it('denies the direct CLI without admission before any resource construction', () => {
    expect(() => browserWorkAdmission([])).toThrow('Required task-owned');
  });
});
