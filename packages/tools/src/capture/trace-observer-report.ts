import { createHash } from 'node:crypto';
import { validateControl, validatePreparation } from './browser-work-report.ts';
import { isRecord } from './browser-work-trace.ts';

export type ObserverArm = 'on' | 'off';
export type ObserverWork = 'fence-only' | 'frame-only';
export const observerProtocol = 'trace-observer-v1';
export const observerScene = Object.freeze({ spec: 'characters/thalune:thalune/thalune_suit2', light: 'noon-lush', width: 1920, height: 1080, lod: 0 });
export const observerAssetSha256 = 'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27';
const fixedSteps: { arm: ObserverArm; workClass: ObserverWork; pair: number | null }[] = [
  { arm: 'on', workClass: 'fence-only', pair: null },
  { arm: 'off', workClass: 'fence-only', pair: null },
  { arm: 'on', workClass: 'frame-only', pair: 0 },
  { arm: 'off', workClass: 'frame-only', pair: 0 },
  { arm: 'off', workClass: 'frame-only', pair: 1 },
  { arm: 'on', workClass: 'frame-only', pair: 1 },
  { arm: 'on', workClass: 'frame-only', pair: 2 },
  { arm: 'off', workClass: 'frame-only', pair: 2 },
  { arm: 'off', workClass: 'frame-only', pair: 3 },
  { arm: 'on', workClass: 'frame-only', pair: 3 },
  { arm: 'on', workClass: 'frame-only', pair: 4 },
  { arm: 'off', workClass: 'frame-only', pair: 4 },
];
export const observerPlan = Object.freeze(fixedSteps.map((step) => Object.freeze(step)));
export const observerBounds = Object.freeze({
  preparations: 12,
  warmUpFrames: 7200,
  frames: 10,
  dependentPasses: 48,
  preflightFences: 36,
  controlFences: 24,
  png: 0,
  queries: 0,
  segments: 6,
});
export const observerRequiredSources = [
  'packages/tools/src/capture/browser-work-trace.ts',
  'packages/tools/src/capture/browser-work-probe.ts',
  'packages/tools/src/capture/trace-observer-report.ts',
  'packages/tools/src/capture/trace-observer.ts',
  'packages/client/src/dev/review.js',
  'packages/client/src/dev/native-work-class-probe.js',
  'packages/client/src/dev/gpu-completion.js',
  'packages/client/src/dev/dependent-output.js',
  'packages/client/src/core/Engine.js',
  'packages/client/src/render/AtmospherePass.js',
] as const;
const record = (v: unknown, name: string) => {
  if (!isRecord(v)) throw new Error(`Missing ${name}`);
  return v;
};
const numeric = (v: unknown, name: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`Invalid ${name}`);
  return v;
};
const integer = (v: unknown, name: string) => {
  const n = numeric(v, name);
  if (!Number.isSafeInteger(n)) throw new Error(`Invalid ${name}`);
  return n;
};
const nonempty = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v.length || v.length > 4096) throw new Error(`Missing ${name}`);
  return v;
};
const hash = (v: unknown, length: number) => {
  const s = nonempty(v, 'hash');
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(s)) throw new Error('Invalid hash');
  return s;
};
const date = (v: unknown) => {
  const s = nonempty(v, 'wall time');
  if (!Number.isFinite(Date.parse(s))) throw new Error('Invalid wall time');
  return s;
};
const stamp = (v: unknown) => {
  const s = record(v, 'phase stamp');
  date(s.at);
  return numeric(s.monotonicMs, 'phase clock');
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isRecord(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Unserializable evidence');
  return result;
}
export const observerDigest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function parseObserverPins(value: unknown) {
  const p = record(value, 'pins'),
    source = record(p.source, 'source pins'),
    files = record(source.files, 'source hashes');
  const sourceFiles: Record<string, string> = {};
  for (const [path, digest] of Object.entries(files)) sourceFiles[nonempty(path, 'source path')] = hash(digest, 64);
  for (const path of observerRequiredSources) if (!sourceFiles[path]) throw new Error(`Missing source pin: ${path}`);
  const asset = record(p.asset, 'asset'),
    browser = record(p.browser, 'browser'),
    load = record(p.loadCondition, 'load condition');
  if (canonical(p.scene) !== canonical(observerScene) || asset.sha256 !== observerAssetSha256 || p.traceInitiallyIdle !== true)
    throw new Error('Unchanged scene/asset and exclusive idle tracing ownership required');
  if (browser.backend !== 'metal') throw new Error('Metal device pin required');
  const cores = integer(load.logicalCores, 'logical cores');
  if (!cores) throw new Error('Missing logical cores');
  return {
    source: { commit: hash(source.commit, 40), tree: hash(source.tree, 40), files: sourceFiles },
    asset: { path: nonempty(asset.path, 'asset path'), sha256: observerAssetSha256 },
    scene: observerScene,
    browser: { version: nonempty(browser.version, 'browser version'), executableSha256: hash(browser.executableSha256, 64), backend: 'metal' },
    device: parseDevice(p.device),
    loadCondition: {
      description: nonempty(load.description, 'controlled load description'),
      logicalCores: cores,
      gpuReservation: nonempty(load.gpuReservation, 'GPU reservation observation'),
    },
    traceInitiallyIdle: true,
  };
}
function parseDevice(value: unknown) {
  const d = record(value, 'device'),
    context = record(d.context, 'context attributes');
  if (d.contextLost !== false) throw new Error('Missing/lost device context');
  for (const key of ['alpha', 'antialias', 'depth', 'stencil', 'preserveDrawingBuffer', 'premultipliedAlpha'])
    if (typeof context[key] !== 'boolean') throw new Error(`Missing device context ${key}`);
  return {
    vendor: nonempty(d.vendor, 'vendor'),
    renderer: nonempty(d.renderer, 'renderer'),
    version: nonempty(d.version, 'GL version'),
    shadingLanguage: nonempty(d.shadingLanguage, 'shading language'),
    context,
    contextLost: false,
  };
}
export type ObserverPins = ReturnType<typeof parseObserverPins>;
export function validateObserverHost(value: unknown, pins: ObserverPins) {
  const h = record(value, 'host observation');
  date(h.at);
  numeric(h.monotonicMs, 'host clock');
  if (h.pinsSha256 !== observerDigest(pins) || h.logicalCores !== pins.loadCondition.logicalCores || !Array.isArray(h.load) || h.load.length !== 3)
    throw new Error('Source/asset/device/load pins changed or missing');
  h.load.forEach((n) => numeric(n, 'host load'));
  if (!Array.isArray(h.errors) || h.errors.length) throw new Error('Host/page errors missing or present');
}
function fences(value: unknown, labels: string[]) {
  if (!Array.isArray(value) || value.length !== labels.length) throw new Error('Missing fences');
  return value.map((v, index) => {
    const c = record(v, 'fence');
    if (c.label !== labels[index] || c.status !== 'signaled' || c.failure !== null || !Array.isArray(c.polls) || c.polls.length < 1 || c.polls.length > 100)
      throw new Error('Invalid fence/polls');
    const start = Date.parse(date(c.startedAt)),
      finish = Date.parse(date(c.finishedAt));
    date(c.deletedAt);
    const elapsed = numeric(c.elapsedMs, 'fence elapsed');
    if (finish < start) throw new Error('Reversed fence');
    let previous = 0;
    const polls = c.polls;
    polls.forEach((v, i) => {
      const p = record(v, 'poll'),
        ms = numeric(p.elapsedMs, 'poll clock');
      date(p.at);
      if (
        ms < previous ||
        ms > elapsed ||
        p.yieldedBeforePoll !== i > 0 ||
        !Number.isInteger(p.value) ||
        (i === polls.length - 1 ? !['already-signaled', 'condition-satisfied'].includes(String(p.status)) : p.status !== 'timeout-expired')
      )
        throw new Error('Malformed or missing poll');
      previous = ms;
    });
    return elapsed;
  });
}
export function validateObserverPreparation(value: unknown, work: ObserverWork, pins: ObserverPins) {
  const counts = validatePreparation(value, work),
    r = record(value, 'preparation');
  if (canonical(parseDevice(r.device)) !== canonical(pins.device)) throw new Error('Device changed');
  numeric(r.timeOriginMs, 'page origin');
  date(r.preparedAt);
  const warm = record(r.warm, 'warm-up');
  numeric(warm.frameMs, 'warm frame');
  if (typeof warm.underBudget !== 'boolean' || counts.warmUpFrames < 1) throw new Error('Missing warm-up observations');
  const pre = record(r.preflight, 'preflight');
  const preflightSettledMs = stamp(pre.settledAt);
  fences(pre.completions, ['after-work-class-warmup', 'after-work-class-dependent-preflight', 'after-work-class-preflight-disposal']);
  if (!Array.isArray(pre.passes)) throw new Error('Missing preflight passes');
  pre.passes.forEach((v, i) => {
    const p = record(v, 'pass');
    if (p.step !== i + 1 || p.completed !== true || p.calls !== 1 || p.triangles !== 1) throw new Error('Preflight work mismatch');
  });
  const proof = record(pre.proof, 'dependent proof');
  if (proof.steps !== 4 || proof.side !== 256 || !Array.isArray(proof.points) || proof.points.length !== 3)
    throw new Error('Missing dependent proof observations');
  const coordinates = [
    [0, 0],
    [17, 23],
    [255, 255],
  ];
  const bytes: number[] = [];
  for (const [i, value] of proof.points.entries()) {
    const point = record(value, 'dependent point');
    if (
      point.x !== coordinates[i][0] ||
      point.y !== coordinates[i][1] ||
      point.matches !== true ||
      !Array.isArray(point.actual) ||
      !Array.isArray(point.expected) ||
      point.actual.length !== 4 ||
      point.expected.length !== 4 ||
      !point.actual.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) ||
      canonical(point.actual) !== canonical(point.expected)
    )
      throw new Error('Malformed dependent proof');
    bytes.push(...point.actual);
  }
  const checksum = bytes.map((v) => v.toString(16).padStart(2, '0')).join('');
  if (proof.sampleChecksum !== checksum || proof.expectedSampleChecksum !== checksum) throw new Error('Dependent proof checksum missing/mismatched');
  return { ...counts, preflightSettledMs, timeOriginMs: numeric(r.timeOriginMs, 'page origin') };
}
export function validateObserverControl(value: unknown, prepared: unknown, work: ObserverWork, pins: ObserverPins) {
  validateObserverPreparation(value, work, pins);
  const counted = validateControl(value, work),
    r = record(value, 'control'),
    p = record(prepared, 'prepared');
  for (const field of ['preparedAt', 'warm', 'preflight', 'device', 'timeOriginMs'])
    if (canonical(r[field]) !== canonical(p[field])) throw new Error('Preparation changed between prepare/run');
  date(r.startedAt);
  date(r.finishedAt);
  if (!Array.isArray(r.samples)) throw new Error('Missing sample');
  const s = record(r.samples[0], 'sample');
  const start = stamp(s.controlStarted),
    end = stamp(s.controlFinished);
  if (stamp(s.started) > start || stamp(s.finished) < end || end < start) throw new Error('Sample/control phase order mismatch');
  const elapsed = fences(s.completions, ['before-native-work-class', 'after-native-work-class']);
  const before = record(s.temporalBefore, 'temporal before'),
    after = record(s.temporalAfter, 'temporal after');
  const b = integer(before.frameIdx, 'frame index'),
    a = integer(after.frameIdx, 'frame index');
  const frames = work === 'frame-only' ? 1 : 0;
  if (a !== b + frames || ![0, 1].includes(Number(before.histIdx)) || after.histIdx !== (frames ? 1 - Number(before.histIdx) : before.histIdx))
    throw new Error('Unexpected natural history progression');
  for (const t of [before, after]) {
    if (
      typeof t.histValid !== 'boolean' ||
      !Array.isArray(t.jitter) ||
      t.jitter.length !== 2 ||
      !t.jitter.every((v) => typeof v === 'number' && Number.isFinite(v))
    )
      throw new Error('Missing temporal observations');
    for (const key of ['prevKey', 'marchPlanet', 'historyValidUniform', 'blend', 'historySizes'])
      if (!(key in t) || t[key] === undefined || t[key] === null) throw new Error(`Missing temporal ${key}`);
  }
  const clockBefore = record(s.clocksBefore, 'clock'),
    clockAfter = record(s.clocksAfter, 'clock');
  for (const c of [clockBefore, clockAfter]) {
    for (const key of ['pinned', 'game', 'base', 'render', 'flora', 'weather', 'grade', 'atmosphere'])
      if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) throw new Error(`Missing scene clock ${key}`);
  }
  // realFrame advances the game/render clocks naturally, including floating-point timeBase drift.
  if (clockBefore.pinned !== clockAfter.pinned || (!frames && canonical(clockBefore) !== canonical(clockAfter))) throw new Error('Pinned scene clock changed');
  for (const c of [s.countersBefore, s.countersAfter]) {
    const n = record(c, 'work counters');
    integer(n.calls, 'draws');
    integer(n.triangles, 'triangles');
  }
  if (frames && canonical(s.rendered) !== canonical(s.countersAfter)) throw new Error('Rendered work does not match final counters');
  const frameMs = frames ? stamp(s.frameFinished) - stamp(s.frameStarted) : 0;
  if (!frames && (s.frameStarted !== null || s.frameFinished !== null || s.rendered !== null || canonical(before) !== canonical(after)))
    throw new Error('Fence-only control issued frame work');
  if (elapsed[0] + elapsed[1] + frameMs > end - start + 0.001) throw new Error('Fence/frame intervals exceed control envelope');
  return {
    ...counted,
    frameMs,
    preFenceMs: elapsed[0],
    postFenceMs: elapsed[1],
    temporalFrames: a - b,
    temporalBefore: b,
    temporalAfter: a,
    controlStartedMs: start,
    controlFinishedMs: end,
  };
}
export type ObserverCounts = ReturnType<typeof validateObserverControl>;
export function summarizeObserver(controls: { arm: ObserverArm; pair: number | null; counts: ObserverCounts }[]) {
  if (controls.length !== 12) throw new Error('Incomplete observer controls');
  const stats = (v: number[]) => {
    const sorted = [...v].sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1)!, range: sorted.at(-1)! - sorted[0] };
  };
  const pairs = Array.from({ length: 5 }, (_, pair) => {
    const on = controls.find((c) => c.pair === pair && c.arm === 'on'),
      off = controls.find((c) => c.pair === pair && c.arm === 'off');
    if (!on || !off) throw new Error('Missing paired arm');
    if (on.counts.calls !== off.counts.calls || on.counts.triangles !== off.counts.triangles) throw new Error('Paired reference work differs');
    return {
      pair,
      onMs: on.counts.controlEnvelopeMs,
      offMs: off.counts.controlEnvelopeMs,
      onMinusOffMs: on.counts.controlEnvelopeMs - off.counts.controlEnvelopeMs,
    };
  });
  const on = stats(pairs.map((p) => p.onMs)),
    off = stats(pairs.map((p) => p.offMs)),
    differences = stats(pairs.map((p) => p.onMinusOffMs));
  const fences = controls.filter((c) => c.pair === null).map((c) => ({ arm: c.arm, envelopeMs: c.counts.controlEnvelopeMs }));
  // Predeclared conservative diagnostic thresholds, not GPU timestamps or budget acceptance.
  const within = Math.max(on.range, off.range),
    toleranceMs = 5,
    emptyFenceLimitMs = 20;
  const unstable = on.range > Math.max(toleranceMs, on.median * 0.15) || off.range > Math.max(toleranceMs, off.median * 0.15);
  const longEmptyFence = fences.some((f) => f.envelopeMs > emptyFenceLimitMs);
  const reproducibleGap = differences.min > Math.max(within, toleranceMs) || differences.max < -Math.max(within, toleranceMs);
  const similar = pairs.every((p) => Math.abs(p.onMinusOffMs) <= Math.max(within, toleranceMs));
  const decision = unstable || longEmptyFence ? 'inconclusive' : reproducibleGap ? 'observer-cost-issue' : similar ? 'targeted-workload-next' : 'inconclusive';
  return {
    pairs,
    on,
    off,
    differences,
    fences,
    decision,
    criteria: { toleranceMs, emptyFenceLimitMs, stableRelativeRange: 0.15, withinArmRangeMs: within, unstable, longEmptyFence, reproducibleGap, similar },
    budgetQualified: false,
    limits: 'Observed completion envelopes; no exclusive GPU attribution, complete CPU coverage, output equality or 16.67 ms budget verdict.',
  };
}
