import { describe, expect, it } from 'vitest';
import { cpuContextCoverage, markerCoverage } from './browser-work-trace.ts';

const prefix = 'bwt-1e47cb7ad901411eb0e49ca69272f171';
const pid = 13776,
  tid = 126281537;
// Exact control marker times and the rejected point from the retained cloud03 trace.
const windows = [
  { index: 2, start: 1694082812657, end: 1694082872991 },
  { index: 3, start: 1694093294486, end: 1694094894290 },
  { index: 4, start: 1694103334631, end: 1694103387779 },
  { index: 5, start: 1694106856576, end: 1694106931686 },
  { index: 6, start: 1694110336767, end: 1694110400879 },
  { index: 7, start: 1694130917819, end: 1694131002956 },
  { index: 8, start: 1694148700591, end: 1694148760889 },
  { index: 9, start: 1694152802340, end: 1694152873145 },
  { index: 10, start: 1694159863504, end: 1694159938499 },
  { index: 11, start: 1694163721550, end: 1694163810747 },
];
const outsidePoint = { name: 'PrePaint', cat: 'devtools.timeline', ph: 'I', s: 't', pid, tid, ts: 1694150880428 };
const coverage: Parameters<typeof cpuContextCoverage>[1] = {
  status: 'observed',
  events: windows.flatMap((w) => [
    { name: `${prefix}-s${String(w.index).padStart(2, '0')}-run-start`, pid, tid, ts: w.start },
    { name: `${prefix}-s${String(w.index).padStart(2, '0')}-run-end`, pid, tid, ts: w.end },
  ]),
};
const positive = windows.map((w) => ({ name: 'FunctionCall', cat: 'devtools.timeline', ph: 'X', pid, tid, ts: w.start + 1, dur: 10 }));
const inspect = (extra: unknown[], context = positive, identity = coverage) =>
  cpuContextCoverage(Buffer.from(JSON.stringify({ traceEvents: [...context, ...extra] })), identity, prefix, 'cloud-march-reuse');

describe('CPU context scoped to declared control windows', () => {
  it('keeps the exact preparation09 thread point outside all control windows from invalidating X context', () => {
    expect(inspect([outsidePoint])).toMatchObject({
      status: 'supported-context-observed',
      supportedEvents: 10,
      unsupportedEvents: 0,
      attribution: 'INCONCLUSIVE',
    });
  });
  it.each([windows[0].start - 1, windows[0].start + 1, windows[0].start, windows[0].end, windows[0].end + 1])(
    'treats point timestamp %s against closed control boundaries',
    (ts) => {
      const outside = windows.every((w) => ts < w.start || ts > w.end);
      expect(inspect([{ ...outsidePoint, ts }])).toMatchObject({
        status: outside ? 'supported-context-observed' : 'inconclusive',
        unsupportedEvents: outside ? 0 : 1,
      });
    },
  );
  it.each([
    { ph: 'unknown' },
    { ph: 'B' },
    { ph: 'n' },
    { ph: 'R' },
    { s: 'g' },
    { s: 'p' },
    { s: undefined },
    { dur: 0 },
    { tdur: 0 },
    { id: null },
    { id2: null },
    { bind_id: false },
    { use_async_tts: false },
    { ts: -1 },
    { ts: null },
    { ts: '1694150880428' },
    { tts: -1 },
    { tts: null },
    { scope: 'async' },
    { unknownQualifier: false },
    { cat: 'devtools.timeline,unknown' },
  ])('retains unsupported or contradictory point fields %j as inconclusive even outside', (fields) => {
    expect(inspect([{ ...outsidePoint, ...fields }])).toMatchObject({ status: 'inconclusive', unsupportedEvents: 1 });
  });
  it.each([Number.NaN, Infinity, -Infinity])('does not bound nonfinite timestamp %s', (ts) => {
    expect(inspect([{ ...outsidePoint, ts }])).toMatchObject({ status: 'inconclusive', unsupportedEvents: 1 });
  });
  it.each([0, 12.5, Number.MAX_SAFE_INTEGER + 1])('does not ignore malformed owned identity %s', (invalid) => {
    const badMarkers = windows.flatMap((w) => [
      { name: `${prefix}-s${String(w.index).padStart(2, '0')}-run-start`, cat: 'blink.user_timing', ph: 'I', s: 't', pid: invalid, tid: invalid, ts: w.start },
      { name: `${prefix}-s${String(w.index).padStart(2, '0')}-run-end`, cat: 'blink.user_timing', ph: 'I', s: 't', pid: invalid, tid: invalid, ts: w.end },
    ]);
    const checked = markerCoverage(
      Buffer.from(JSON.stringify({ traceEvents: badMarkers })),
      badMarkers.map((m) => ({ name: m.name, monotonicMs: m.ts / 1000 })),
      [pid],
    );
    expect(inspect([{ ...outsidePoint, pid: invalid, tid: invalid }], positive, checked).status).toBe('inconclusive');
  });
  it('permits a valid optional thread timestamp only for out-of-window exclusion', () => {
    expect(inspect([{ ...outsidePoint, tts: 0 }]).status).toBe('supported-context-observed');
    expect(inspect([{ ...outsidePoint, tts: 1, ts: windows[0].start + 1 }]).status).toBe('inconclusive');
  });
  it('never counts an instant or an unknown name as positive context', () => {
    expect(inspect([outsidePoint], [])).toMatchObject({ status: 'inconclusive', supportedEvents: 0 });
    expect(inspect([{ ...outsidePoint, name: 'UnknownTimelineEvent' }], [])).toMatchObject({
      status: 'inconclusive',
      supportedEvents: 0,
      unknownNamedEvents: 1,
    });
  });
  it.each(['FunctionCall', 'Layout', 'Paint', 'PrePaint', 'UpdateLayoutTree'])('preserves supported X context %s', (name) => {
    expect(
      inspect(
        [],
        positive.map((e) => ({ ...e, name })),
      ),
    ).toMatchObject({ status: 'supported-context-observed', supportedEvents: 10 });
  });
});
