import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPlaythrough } from './playthrough-run.ts';

const ports = vi.hoisted(() => ({ startVite: vi.fn(), glArgs: vi.fn(), launch: vi.fn() }));
vi.mock('./capture.ts', () => ({ startVite: ports.startVite, glArgs: ports.glArgs }));
vi.mock('@playwright/test', () => ({ chromium: { launch: ports.launch } }));

const rawFailures = [undefined, null, false, 0, '', Object.freeze({ reason: 'failure' }), new Error('failure')];
const defaults = ['leave', 'descend', 'land', 'disembark', 'mine', 'analyze', 'board', 'climb', 'dock'];
const dockState = { mode: 'docked', pads: ['player', 'npc', 'free'], hud: 'Docked' };
const trace: string[] = [];
const faults = new Map<string, unknown>();
const close = vi.fn();
const stop = vi.fn();
const newPage = vi.fn();
const goto = vi.fn();
const waitForFunction = vi.fn();
const evaluate = vi.fn();
const on = vi.fn();

function visit(stage: string) {
  trace.push(stage);
  if (faults.has(stage)) throw faults.get(stage);
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  const outcome = await promise.then(
    () => ({ kind: 'success' as const }),
    (error: unknown) => ({ kind: 'failure' as const, error }),
  );
  expect(outcome.kind).toBe('failure');
  if (outcome.kind !== 'failure') throw new Error('playthrough unexpectedly succeeded');
  return outcome.error;
}

function expectAggregate(error: unknown, expected: unknown[]) {
  expect(error).toBeInstanceOf(AggregateError);
  if (!(error instanceof AggregateError)) throw new Error('missing AggregateError');
  expect(Object.hasOwn(error, 'cause')).toBe(true);
  expect(error.cause).toBe(expected[0]);
  expect(error.errors).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(error.errors[index]).toBe(value));
}

beforeEach(() => {
  vi.resetAllMocks();
  trace.length = 0;
  faults.clear();
  ports.startVite.mockImplementation(async () => {
    visit('startVite');
    return { url: 'http://fake-vite.invalid', stop };
  });
  ports.glArgs.mockImplementation(() => {
    visit('glArgs');
    return { args: ['--fake-gl'] };
  });
  ports.launch.mockImplementation(async () => {
    visit('launch');
    return { newPage, close };
  });
  newPage.mockImplementation(async () => {
    visit('newPage');
    return { on, goto, waitForFunction, evaluate };
  });
  goto.mockImplementation(async () => visit('goto'));
  waitForFunction.mockImplementation(async () => visit('waitForFunction'));
  evaluate.mockImplementationOnce(async () => visit('initialize'));
  evaluate.mockImplementation(async (_fn: unknown, phase?: string) => {
    visit(phase ? `phase:${phase}` : 'dockState');
    return phase ? `${phase} ok` : dockState;
  });
  close.mockImplementation(async () => visit('close'));
  stop.mockImplementation(async () => visit('stop'));
  vi.spyOn(Date, 'now').mockReturnValue(0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('must return or reject after cleanup, never process.exit');
  });
});

afterEach(() => vi.restoreAllMocks());

describe('playthrough resource ownership', () => {
  it.each(rawFailures)('does not clean up resources that were never acquired %#', async (original) => {
    faults.set('startVite', original);
    expect(await rejected(runPlaythrough(['leave']))).toBe(original);
    expect(trace).toEqual(['startVite']);
    expect(close).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  describe.each(['glArgs', 'launch'])('%s before browser acquisition', (stage) => {
    it.each(rawFailures)('retains raw failure and stops Vite exactly once %#', async (original) => {
      faults.set(stage, original);
      expect(await rejected(runPlaythrough(['leave']))).toBe(original);
      expect(close).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledExactlyOnceWith();
      expect(trace.at(-1)).toBe('stop');
      if (stage === 'glArgs') expect(ports.launch).not.toHaveBeenCalled();
    });

    it.each(rawFailures)('retains raw setup failure before stop failure %#', async (original) => {
      const cleanup = new Error('stop');
      faults.set(stage, original);
      faults.set('stop', cleanup);
      expectAggregate(await rejected(runPlaythrough(['leave'])), [original, cleanup]);
      expect(close).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledExactlyOnceWith();
    });
  });

  describe.each(['goto', 'close', 'stop'])('%s after browser acquisition', (stage) => {
    it.each(rawFailures)('retains a single raw failure and attempts every cleanup once %#', async (original) => {
      faults.set(stage, original);
      expect(await rejected(runPlaythrough(['leave']))).toBe(original);
      expect(close).toHaveBeenCalledExactlyOnceWith();
      expect(stop).toHaveBeenCalledExactlyOnceWith();
      expect(trace.slice(-2)).toEqual(['close', 'stop']);
    });
  });

  it.each(['newPage', 'waitForFunction', 'initialize', 'phase:leave', 'dockState'])('cleans up after %s fails', async (stage) => {
    const original = new Error(stage);
    faults.set(stage, original);
    expect(await rejected(runPlaythrough(['leave', 'dock']))).toBe(original);
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(stop).toHaveBeenCalledExactlyOnceWith();
    expect(trace.slice(-2)).toEqual(['close', 'stop']);
  });

  it.each(rawFailures)('retains raw work failure before both cleanup failures %#', async (original) => {
    const browserFailure = new Error('close');
    const viteFailure = new Error('stop');
    faults.set('goto', original);
    faults.set('close', browserFailure);
    faults.set('stop', viteFailure);
    expectAggregate(await rejected(runPlaythrough(['leave'])), [original, browserFailure, viteFailure]);
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(stop).toHaveBeenCalledExactlyOnceWith();
    expect(trace.slice(-2)).toEqual(['close', 'stop']);
  });

  it.each(['close', 'stop'])('retains work failure before the sole %s failure', async (stage) => {
    const original = new Error('work');
    faults.set('goto', original);
    faults.set(stage, false);
    expectAggregate(await rejected(runPlaythrough(['leave'])), [original, false]);
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(stop).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(rawFailures)('retains raw cleanup failures after successful work %#', async (original) => {
    faults.set('close', original);
    faults.set('stop', false);
    expectAggregate(await rejected(runPlaythrough(['leave'])), [original, false]);
    expect(trace.slice(-2)).toEqual(['close', 'stop']);
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(stop).toHaveBeenCalledExactlyOnceWith();
  });

  it('retains simultaneous falsy work, close, and stop failures', async () => {
    faults.set('goto', undefined);
    faults.set('close', null);
    faults.set('stop', 0);
    expectAggregate(await rejected(runPlaythrough(['leave'])), [undefined, null, 0]);
    expect(trace.slice(-2)).toEqual(['close', 'stop']);
  });
});

describe('playthrough protocol', () => {
  it('preserves default phases, viewport, readiness, printed results, and dock state', async () => {
    expect(await runPlaythrough([])).toBe(0);
    expect(trace).toEqual([
      'startVite',
      'glArgs',
      'launch',
      'newPage',
      'goto',
      'waitForFunction',
      'initialize',
      ...defaults.map((phase) => `phase:${phase}`),
      'dockState',
      'close',
      'stop',
    ]);
    expect(ports.launch).toHaveBeenCalledExactlyOnceWith({ args: ['--fake-gl'] });
    expect(newPage).toHaveBeenCalledExactlyOnceWith({ viewport: { width: 640, height: 360 } });
    expect(goto).toHaveBeenCalledExactlyOnceWith('http://fake-vite.invalid/');
    expect(waitForFunction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), null, { timeout: 120_000 });
    expect(console.log).toHaveBeenCalledTimes(defaults.length + 1);
    defaults.forEach((phase, index) => expect(console.log).toHaveBeenNthCalledWith(index + 1, `[${phase}] (0s) ${phase} ok`));
    expect(console.log).toHaveBeenLastCalledWith('  dock state:', JSON.stringify(dockState));
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(stop).toHaveBeenCalledExactlyOnceWith();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('preserves requested phase order and ignores argument separators', async () => {
    expect(await runPlaythrough(['--', 'mine', '--', 'board'])).toBe(0);
    expect(trace.filter((step) => step.startsWith('phase:'))).toEqual(['phase:mine', 'phase:board']);
    expect(trace).not.toContain('dockState');
  });

  it.each(['THREW boom', 'fail', 'timed out', 'stuck'])('returns failure status for %s after completing phases and cleanup', async (result) => {
    evaluate.mockImplementation(async (_fn: unknown, phase?: string) => (phase === 'leave' ? result : 'ok'));
    expect(await runPlaythrough(['leave', 'mine'])).toBe(1);
    expect(console.log).toHaveBeenCalledWith(`[leave] (0s) ${result}`);
    expect(console.log).toHaveBeenCalledWith('[mine] (0s) ok');
    expect(trace.slice(-2)).toEqual(['close', 'stop']);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('prints page and console errors and returns failure after cleanup', async () => {
    on.mockImplementation((event: string, listener: (value: unknown) => void) => {
      if (event === 'pageerror') listener(new Error('page broke'));
      if (event === 'console') {
        listener({ type: () => 'warning', text: () => 'ignored' });
        listener({ type: () => 'error', text: () => 'console broke' });
      }
    });
    expect(await runPlaythrough(['leave'])).toBe(1);
    expect(console.log).toHaveBeenCalledWith('errors:', 'page broke\nconsole broke');
    expect(trace.slice(-2)).toEqual(['close', 'stop']);
  });
});
