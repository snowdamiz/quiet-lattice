import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureReview, captureUi, glArgs, startVite } from './capture.ts';

const ports = vi.hoisted(() => ({ createServer: vi.fn(), launch: vi.fn() }));
vi.mock('vite', () => ({ createServer: ports.createServer }));
vi.mock('@playwright/test', () => ({ chromium: { launch: ports.launch } }));

const DATA = 'data:image/png;base64,Y2FwdHVyZQ==';
const target = { asset: 'Ship', variant: 'Ship' };
const facts = () => Object.freeze({ bytes: Buffer.from([0, 255, 128]), ownership: Object.freeze({ known: false }) });
const failure = (message: string) => Object.freeze(Object.assign(new Error(message), { facts: facts() }));
const rawFailures = ['', null, undefined, false, 0, Object.freeze({ reason: 'native failure', facts: facts() }), failure('work')];

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  const outcome = await promise.then(
    (value) => ({ kind: 'success', value }) as const,
    (error: unknown) => ({ kind: 'failure', error }) as const,
  );
  expect(outcome.kind).toBe('failure');
  if (outcome.kind !== 'failure') throw new Error('capture unexpectedly succeeded');
  return outcome.error;
}

function aggregate(error: unknown, expected: unknown[]) {
  expect(error).toBeInstanceOf(AggregateError);
  if (!(error instanceof AggregateError)) throw new Error('missing AggregateError');
  expect(Object.hasOwn(error, 'cause')).toBe(true);
  expect(error.cause).toBe(expected[0]);
  expect(error.errors).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(error.errors[index]).toBe(value));
}

let outDir: string;
let trace: unknown[][];
let pageError: ((error: Error) => void) | undefined;
const listen = vi.fn();
const stop = vi.fn();
const close = vi.fn();
const pageClose = vi.fn();
const goto = vi.fn();
const evaluate = vi.fn();
const screenshot = vi.fn();
const newPage = vi.fn();
const cdpSend = vi.fn();
const frame = vi.fn();
const setPixelRatio = vi.fn();
const resize = vi.fn();
const sheetInputs: unknown[] = [];
const page = {
  on: vi.fn((event: string, listener: (error: Error) => void) => {
    if (event === 'pageerror') pageError = listener;
  }),
  addInitScript: vi.fn(),
  goto,
  waitForFunction: vi.fn(),
  waitForTimeout: vi.fn(),
  evaluate,
  screenshot,
  close: pageClose,
  context: () => ({ newCDPSession: async () => ({ send: cdpSend }) }),
};

beforeEach(() => {
  vi.resetAllMocks();
  outDir = mkdtempSync(join(tmpdir(), 'capture-lifecycle-test-'));
  trace = [];
  pageError = undefined;
  sheetInputs.length = 0;
  ports.createServer.mockImplementation(async () => {
    trace.push(['create']);
    return { listen, close: stop };
  });
  listen.mockImplementation(async () => {
    trace.push(['listen']);
  });
  stop.mockImplementation(async () => {
    trace.push(['stop']);
  });
  ports.launch.mockImplementation(async () => {
    trace.push(['launch']);
    return { newPage, close };
  });
  close.mockImplementation(async () => {
    trace.push(['close']);
  });
  newPage.mockImplementation(async (options) => {
    trace.push(['newPage', options]);
    return page;
  });
  goto.mockImplementation(async (url) => {
    trace.push(['goto', url]);
  });
  pageClose.mockImplementation(async () => {
    trace.push(['pageClose']);
  });
  screenshot.mockImplementation(async (options) => {
    trace.push(['screenshot', options]);
    return Buffer.from('capture');
  });
  const record =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      trace.push([name, ...args]);
      return result;
    };
  vi.stubGlobal('window', {
    review: {
      ready: Promise.resolve(),
      targets: record('targets', [target]),
      select: record('select', target),
      light: record('light'),
      lod: record('lod'),
      wireframe: record('wireframe'),
      overlay: record('overlay'),
      capture: record('capture', DATA),
      captureOverlay: record('captureOverlay', DATA),
      lastOverlay: { markers: 2 },
      far: record('far', { distance: 'fixture' }),
      near: record('near'),
      perf: record('perf', { paired: 120 }),
      stats: record('stats', { triangles: 42 }),
      spot: { planet: 'fixture' },
      settled: { frames: 5 },
    },
    game: { engine: { adapt() {}, maxPixelRatio: 2, pixelRatio: 2, renderer: { setPixelRatio }, resize }, frame },
    step: record('step'),
  });
  vi.stubGlobal('document', { querySelector: () => ({ getAnimations: () => [] }) });
  evaluate.mockImplementation(async (fn: (arg: unknown) => unknown, arg?: unknown) => {
    if (arg && typeof arg === 'object' && 'items' in arg) {
      sheetInputs.push(arg);
      trace.push(['sheet']);
      return DATA;
    }
    return fn(arg);
  });
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

describe('startVite ownership', () => {
  it('returns the created server stop handle after listen succeeds', async () => {
    const vite = await startVite();
    expect(vite.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(stop).not.toHaveBeenCalled();
    await vite.stop();
    expect(trace).toEqual([['create'], ['listen'], ['stop']]);
    expect(ports.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        server: { port: Number(new URL(vite.url).port), strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
      }),
    );
  });

  it('does not invent a resource when createServer rejects', async () => {
    const original = failure('create');
    ports.createServer.mockRejectedValueOnce(original);
    expect(await rejected(startVite())).toBe(original);
    expect(listen).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it.each(rawFailures)('closes the actual created server on listen rejection %#', async (original) => {
    listen.mockRejectedValueOnce(original);
    expect(await rejected(startVite())).toBe(original);
    expect(stop).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(rawFailures)('retains listen and close failures by identity %#', async (original) => {
    const cleanup = failure('vite close');
    listen.mockRejectedValueOnce(original);
    stop.mockRejectedValueOnce(cleanup);
    aggregate(await rejected(startVite()), [original, cleanup]);
  });
});

const captures = [
  { name: 'Review', run: () => captureReview('ship', { outDir }) },
  { name: 'UI', run: () => captureUi('title', outDir) },
];

describe.each(captures)('$name capture ownership', ({ run }) => {
  it('owns listen failure cleanup without launching a browser', async () => {
    const original = failure('listen');
    const cleanup = failure('stop');
    listen.mockRejectedValueOnce(original);
    stop.mockRejectedValueOnce(cleanup);
    aggregate(await rejected(run()), [original, cleanup]);
    expect(ports.launch).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops Vite if glArgs throws before browser launch', async () => {
    const original = failure('glArgs');
    const env = process.env;
    process.env = new Proxy(env, {
      get(target, key) {
        if (key === 'SMOKE_GL') throw original;
        return Reflect.get(target, key);
      },
    });
    let error: unknown;
    try {
      error = await rejected(run());
    } finally {
      process.env = env;
    }
    expect(error).toBe(original);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(ports.launch).not.toHaveBeenCalled();
  });

  it.each(rawFailures)('stops Vite after launch rejection %#', async (original) => {
    ports.launch.mockRejectedValueOnce(original);
    expect(await rejected(run())).toBe(original);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('retains launch failure and Vite cleanup failure', async () => {
    const original = failure('launch');
    const cleanup = failure('stop');
    ports.launch.mockRejectedValueOnce(original);
    stop.mockRejectedValueOnce(cleanup);
    aggregate(await rejected(run()), [original, cleanup]);
    expect(close).not.toHaveBeenCalled();
  });

  it.each(rawFailures)('retains raw navigation rejection with successful cleanup %#', async (original) => {
    goto.mockRejectedValueOnce(original);
    expect(await rejected(run())).toBe(original);
    expect(trace.slice(-2)).toEqual([['close'], ['stop']]);
  });

  it.each(rawFailures)('retains raw work and every cleanup failure %#', async (original) => {
    const browserFailure = failure('browser close');
    const viteFailure = failure('vite stop');
    goto.mockRejectedValueOnce(original);
    close.mockRejectedValueOnce(browserFailure);
    stop.mockRejectedValueOnce(viteFailure);
    aggregate(await rejected(run()), [original, browserFailure, viteFailure]);
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(stop).toHaveBeenCalledExactlyOnceWith();
  });

  it('retains navigation and Vite cleanup failure after browser closes', async () => {
    const original = failure('goto');
    const cleanup = failure('stop');
    goto.mockRejectedValueOnce(original);
    stop.mockRejectedValueOnce(cleanup);
    aggregate(await rejected(run()), [original, cleanup]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(rawFailures)('rejects a successful capture when browser cleanup fails %#', async (cleanup) => {
    close.mockRejectedValueOnce(cleanup);
    expect(await rejected(run())).toBe(cleanup);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it.each(rawFailures)('rejects a successful capture when Vite cleanup fails %#', async (cleanup) => {
    stop.mockRejectedValueOnce(cleanup);
    expect(await rejected(run())).toBe(cleanup);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retains both cleanup failures after successful work', async () => {
    close.mockRejectedValueOnce(undefined);
    stop.mockRejectedValueOnce(false);
    aggregate(await rejected(run()), [undefined, false]);
  });

  it('retains page errors together with both cleanup failures', async () => {
    goto.mockImplementation(async () => {
      pageError?.(new Error('page broke'));
    });
    const browserFailure = failure('browser close');
    const viteFailure = failure('vite stop');
    close.mockRejectedValueOnce(browserFailure);
    stop.mockRejectedValueOnce(viteFailure);
    const error = await rejected(run());
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw new Error('missing AggregateError');
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause).toHaveProperty('message', expect.stringContaining('page broke'));
    aggregate(error, [error.cause, browserFailure, viteFailure]);
  });
});

describe('successful capture protocol', () => {
  it('keeps Review selection, shot/perf order, filenames, sheet and stats', async () => {
    const written = await captureReview('ship', { outDir, asset: 'Ship', variant: 'Ship' });
    expect(written.map((path) => basename(path))).toEqual([
      'noon-lush_lod0.png',
      'noon-lush_lod2.png',
      'wireframe_lod0.png',
      'wireframe_lod2.png',
      'overlay.png',
      'far_lod2.png',
      'far200_lod2.png',
      'night-exotic_lod0.png',
      'night-exotic_lod2.png',
      'open-space_lod0.png',
      'open-space_lod2.png',
      'perf.json',
      'sheet.png',
    ]);
    expect(readdirSync(outDir).sort()).toEqual(written.map((path) => basename(path)).sort());
    for (const path of written.filter((path) => path.endsWith('.png'))) expect(readFileSync(path).toString()).toBe('capture');
    const work = trace.filter(([name]) =>
      ['targets', 'select', 'light', 'lod', 'wireframe', 'overlay', 'capture', 'captureOverlay', 'perf', 'far', 'near', 'stats', 'sheet'].includes(
        String(name),
      ),
    );
    const shot = (lod: number, wire: boolean) => [['lod', lod], ['wireframe', wire], ['capture']];
    const perf = [
      ['wireframe', false],
      ['lod', 0],
      ['perf', { pairs: 120 }],
    ];
    expect(work).toEqual([
      ['targets'],
      ['select', 'Ship', 'Ship'],
      ['light', 'noon-lush'],
      ...shot(0, false),
      ...shot(2, false),
      ...shot(0, true),
      ...shot(2, true),
      ['wireframe', false],
      ['lod', 0],
      ['overlay', true],
      ['captureOverlay'],
      ['overlay', false],
      ...perf,
      ['far', 100, { lod: 2 }],
      ['capture'],
      ['far', 200, { lod: 2 }],
      ['capture'],
      ['near'],
      ['light', 'night-exotic'],
      ...shot(0, false),
      ...shot(2, false),
      ...perf,
      ['light', 'open-space'],
      ...shot(0, false),
      ...shot(2, false),
      ...perf,
      ['lod', 0],
      ['stats'],
      ['sheet'],
    ]);
    expect(JSON.parse(readFileSync(join(outDir, 'perf.json'), 'utf8'))).toEqual({
      file: 'ship',
      asset: 'Ship',
      variant: 'Ship',
      class: 'hero',
      gl: glArgs().gl,
      viewport: [1920, 1080],
      stats: { triangles: 42 },
      spots: Object.fromEntries(['noon-lush', 'night-exotic', 'open-space'].map((light) => [light, { planet: 'fixture', settled: { frames: 5 } }])),
      perf: Array(3).fill({ paired: 120 }),
      far: Array(2).fill({ distance: 'fixture' }),
      overlay: { markers: 2 },
      errors: [],
    });
    expect(sheetInputs).toEqual([expect.objectContaining({ cols: 2, cellW: 960, title: 'ship  Ship', pixelated: false, items: expect.any(Array) })]);
    expect(trace.slice(-2)).toEqual([['close'], ['stop']]);
    expect(ports.launch).toHaveBeenCalledExactlyOnceWith({ args: glArgs().args });
    expect(goto).toHaveBeenCalledWith(expect.stringMatching(/\/#review:ship%3AShip%2FShip$/));
  });

  it('keeps the real title screen, both aspects, 216 frame steps and clip ordering', async () => {
    const written = await captureUi('title', outDir);
    expect(written).toEqual(['16x9.png', 'clip-sheet.png', '_frames', '21x9.png'].map((name) => join(outDir, name)));
    expect(newPage.mock.calls).toEqual([[{ viewport: { width: 1920, height: 1080 } }], [{ viewport: { width: 2520, height: 1080 } }]]);
    expect(screenshot.mock.calls).toEqual([
      [{ path: join(outDir, '16x9.png') }],
      ...Array.from({ length: 216 }, (_, i) => [{ path: join(outDir, '_frames', `${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 85 }]),
      [{ path: join(outDir, '21x9.png') }],
    ]);
    expect(frame.mock.calls).toEqual(Array.from({ length: 216 }, () => [1 / 60]));
    expect(setPixelRatio.mock.calls).toEqual([[1], [1]]);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(cdpSend.mock.calls).toEqual([
      ['Animation.enable'],
      ['Animation.setPlaybackRate', { playbackRate: 0.1 }],
      ['Animation.setPlaybackRate', { playbackRate: 1 }],
    ]);
    expect(page.waitForTimeout.mock.calls).toEqual([[1200], [2500], [1200], [2500]]);
    expect(pageClose).toHaveBeenCalledTimes(2);
    expect(sheetInputs).toEqual([expect.objectContaining({ cols: 5, cellW: 480, title: '', pixelated: false })]);
    expect(trace.filter(([name]) => ['sheet', 'pageClose', 'close', 'stop'].includes(String(name)))).toEqual([
      ['sheet'],
      ['pageClose'],
      ['pageClose'],
      ['close'],
      ['stop'],
    ]);
    expect(ports.launch).toHaveBeenCalledExactlyOnceWith({ args: glArgs().args, ignoreDefaultArgs: [] });
  });
});
