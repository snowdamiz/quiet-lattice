// Reads completed or failed benchmark artifacts only; never imports the browser/capture runner.
// pnpm exec tsx packages/tools/src/capture/benchmark-report.ts <capture-directory> <new-report.json>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIGHTS = ['noon-lush', 'night-exotic', 'open-space'];
const BUDGET = 1000 / 60;

// The tools package has no schema-library dependency. Keep this JSON boundary small and cast-free; the report
// consumes only the fields it validates, while the unchanged input files retain every original field and sample.
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || !(key in value)) throw new Error(`Missing field: ${key}`);
  return Reflect.get(value, key);
}
function optionalField(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && key in value ? Reflect.get(value, key) : undefined;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected text');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite number');
  return value;
}
function nullableNumber(value: unknown): number | null {
  return value === null ? null : number(value);
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected a boolean');
  return value;
}
function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function fileHash(path: string): string | null {
  try {
    return hash(path);
  } catch {
    return null;
  }
}
function timestamp(value: unknown): number {
  const ms = Date.parse(text(value));
  if (!Number.isFinite(ms)) throw new Error('Expected a valid timestamp');
  return ms;
}

/** A phase label alone is not load evidence: require actual process rows and aggregate GPU counters. */
function inspectHostObservation(value: unknown, index: number) {
  const issues: string[] = [];
  const collectorError = optionalField(value, 'error');
  if (collectorError !== undefined) issues.push(`Collector error: ${String(collectorError)}`);
  let atMs: number | null = null;
  let phase: string | null = null;
  let processCount = 0;
  const gpuCounters: { name: string; percent: number }[] = [];
  try {
    atMs = timestamp(field(value, 'at'));
  } catch (error) {
    issues.push(String(error));
  }
  try {
    phase = text(field(value, 'phase'));
  } catch (error) {
    issues.push(String(error));
  }
  try {
    const load = list(field(value, 'load')).map(number);
    if (load.length !== 3 || load.some((n) => n < 0)) throw new Error('Invalid host load averages');
  } catch (error) {
    issues.push(String(error));
  }
  try {
    const processes = text(field(value, 'processes'));
    const rows = processes.split('\n');
    processCount = rows.filter((row) => /^\s*\d+\s+\d+\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\S+\s+\S/.test(row)).length;
    if (!/^\s*PID\s+PPID\s+%CPU\s+%MEM\s+ELAPSED\s+COMM(?:AND)?\s*$/m.test(processes) || !processCount)
      throw new Error(`No usable ps observation: ${processes}`);
  } catch (error) {
    issues.push(String(error));
  }
  try {
    const rawGpu = field(value, 'gpu');
    if (!Array.isArray(rawGpu)) throw new Error(`GPU collection error: ${String(rawGpu)}`);
    const gpu = list(rawGpu).map(text).join('\n');
    for (const name of ['Device', 'Renderer', 'Tiler']) {
      const match = new RegExp(`"${name} Utilization %"\\s*=\\s*(\\d+(?:\\.\\d+)?)`).exec(gpu);
      if (!match || +match[1] > 100) throw new Error(`No usable ${name} GPU utilization: ${gpu}`);
      gpuCounters.push({ name, percent: +match[1] });
    }
  } catch (error) {
    issues.push(String(error));
  }
  const measurementPhase = phase !== null && /^(?:current|baseline|candidate):(?:noon-lush|night-exotic|open-space):run-[1-5]$/.test(phase);
  return {
    index,
    atMs,
    phase,
    processCount,
    gpuCounters,
    issues,
    usable: measurementPhase && issues.length === 0,
    failedObservation: issues.length ? value : null,
  };
}

function hostEvidence(path: string) {
  try {
    return { observations: list(json(path)).map(inspectHostObservation), readError: null, sha256: fileHash(path) };
  } catch (error) {
    return { observations: [], readError: String(error), sha256: fileHash(path) };
  }
}

/** Median and full range across runs; nulls remain visible in the missing count. */
export function runRange(values: (number | null)[]) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    missing: values.length - n,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    min: sorted[0] ?? null,
    max: sorted[n - 1] ?? null,
  };
}

function parseSample(value: unknown) {
  return {
    shown: boolean(field(value, 'shown')),
    cpu: nullableNumber(field(value, 'cpu')),
    gpu: nullableNumber(field(value, 'gpu')),
    calls: nullableNumber(field(value, 'calls')),
    tris: nullableNumber(field(value, 'tris')),
    gpuStatus: text(field(value, 'gpuStatus')),
  };
}

function frameSummary(samples: ReturnType<typeof parseSample>[]) {
  const percentile = (key: 'cpu' | 'gpu' | 'calls' | 'tris', p: number) => {
    const values = samples
      .map((sample) => sample[key])
      .filter((value) => value !== null)
      .sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? null;
  };
  return {
    frames: samples.length,
    cpuMsMedian: percentile('cpu', 0.5),
    cpuMsP95: percentile('cpu', 0.95),
    gpuMsMedian: percentile('gpu', 0.5),
    gpuMsP95: percentile('gpu', 0.95),
    drawCalls: percentile('calls', 0.5),
    triangles: percentile('tris', 0.5),
    missingCpu: samples.filter((sample) => sample.cpu === null).length,
    missingGpu: samples.filter((sample) => sample.gpu === null).length,
    missingWork: samples.filter((sample) => sample.calls === null || sample.tris === null).length,
  };
}

/** Recompute whole-scene statistics from raw frames, keeping invalid runs in the report. */
export function inspectRun(value: unknown, expectedCase: string) {
  const issues: string[] = [];
  const samples = list(field(value, 'samples')).map(parseSample);
  const scene = frameSummary(samples.filter((sample) => sample.shown));
  const hidden = frameSummary(samples.filter((sample) => !sample.shown));
  const warm = field(value, 'settle');
  const asset = field(value, 'asset');
  const device = field(value, 'device');
  const glErrors = field(value, 'glErrors');
  const disjoint = number(field(field(value, 'scene'), 'disjoint'));
  const startedAt = timestamp(field(value, 'startedAt'));
  const finishedAt = timestamp(field(value, 'finishedAt'));
  if (finishedAt < startedAt) issues.push('Run finished before it started');
  let samplingWindows: { startedAt: number; finishedAt: number; firstSample: number; sampleCount: number }[];
  try {
    samplingWindows = list(field(value, 'samplingWindows')).map((window) => ({
      startedAt: timestamp(field(window, 'startedAt')),
      finishedAt: timestamp(field(window, 'finishedAt')),
      firstSample: number(field(window, 'firstSample')),
      sampleCount: number(field(window, 'sampleCount')),
    }));
    let nextSample = 0;
    let previousEnd = startedAt;
    for (const window of samplingWindows) {
      if (
        window.startedAt < previousEnd ||
        window.finishedAt <= window.startedAt ||
        window.finishedAt > finishedAt ||
        window.firstSample !== nextSample ||
        !Number.isInteger(window.sampleCount) ||
        window.sampleCount <= 0
      )
        throw new Error('Sampling windows do not describe ordered measured-frame ranges inside the attempt');
      nextSample += window.sampleCount;
      previousEnd = window.finishedAt;
    }
    if (!samplingWindows.length || nextSample !== samples.length) throw new Error('Sampling windows do not cover all raw frames');
  } catch (error) {
    issues.push(`Invalid sampling boundaries: ${String(error)}`);
    samplingWindows = [];
  }
  if (field(value, 'case') !== expectedCase) issues.push('Lighting case differs from the expected case');
  if (JSON.stringify(field(value, 'viewport')) !== '[1920,1080]' || field(value, 'lod') !== 0) issues.push('Not the standard 1080p LOD0 measurement');
  if (!text(field(value, 'gpuTiming')).startsWith('EXT_disjoint_timer_query_webgl2')) issues.push('GPU timings are not timer-query measurements');
  if (field(value, 'failure') !== null) issues.push(`Measurement failure: ${String(field(value, 'failure'))}`);
  if (!boolean(field(warm, 'stable'))) issues.push('Warm-up did not stabilize');
  if (boolean(field(device, 'contextLost'))) issues.push('WebGL context was lost');
  if (list(field(glErrors, 'before')).length || list(field(glErrors, 'after')).length) issues.push('GL errors were recorded');
  if (disjoint) issues.push(`${disjoint} disjoint events`);
  if (samples.length < 240 || samples.length % 4 !== 0) issues.push('Fewer than 120 complete ABBA pairs');
  if (samples.some((sample, i) => sample.shown !== (i % 4 === 0 || i % 4 === 3))) issues.push('Shown/hidden order is not ABBA');
  if (samples.some((sample) => sample.gpuStatus !== 'timer')) issues.push('Missing, invalidated, or fallback GPU samples');
  if (scene.missingCpu + hidden.missingCpu + scene.missingGpu + hidden.missingGpu + scene.missingWork + hidden.missingWork)
    issues.push('Missing timing or rendered-work samples');
  if (
    samples.some(
      (sample) => (sample.cpu !== null && sample.cpu < 0) || (sample.gpu !== null && sample.gpu < 0) || (sample.calls ?? 0) <= 0 || (sample.tris ?? 0) <= 0,
    )
  )
    issues.push('Invalid timings or empty rendered work');
  if ((scene.drawCalls ?? 0) <= (hidden.drawCalls ?? 0) || (scene.triangles ?? 0) <= (hidden.triangles ?? 0))
    issues.push('The shown asset did not add measured draw and triangle work');
  return {
    issues,
    startedAt,
    finishedAt,
    samplingWindows,
    scene,
    hidden,
    disjoint,
    warmup: { frames: number(field(warm, 'frames')), stable: boolean(field(warm, 'stable')), underBudget: boolean(field(warm, 'underBudget')) },
    renderer: text(field(device, 'renderer')),
    pairedAssetGpuMs: nullableNumber(field(asset, 'gpuMs')),
    pairedAssetCpuMs: nullableNumber(field(asset, 'cpuMs')),
    pairedAssetReliable: boolean(field(asset, 'reliable')),
  };
}

export function benchmarkReport(directory: string) {
  const context = json(join(directory, 'context.json'));
  if (field(context, 'mode') !== 'measure') throw new Error('Diagnostic profiles cannot be aggregated as budget measurements');
  const status = json(join(directory, 'status.json'));
  const globalIssues: string[] = [];
  if (list(field(status, 'errors')).length || list(field(status, 'pageErrors')).some((page) => list(field(page, 'errors')).length))
    globalIssues.push('Capture session recorded errors');
  const loadEvidence = hostEvidence(join(directory, 'host-samples.json'));
  if (loadEvidence.readError) globalIssues.push(`Competing-load evidence could not be read: ${loadEvidence.readError}`);
  const failedObservations = loadEvidence.observations.filter((observation) => observation.issues.length);
  if (failedObservations.length) globalIssues.push(`Competing-load collection failed in ${failedObservations.length} observations`);
  if (!loadEvidence.observations.some((observation) => observation.usable)) globalIssues.push('No usable measurement-period competing-load observations');
  const labels = list(field(context, 'sourceTrees')).map((tree) => text(field(tree, 'label')));
  if (!labels.length || new Set(labels).size !== labels.length || labels.some((label) => !['current', 'baseline', 'candidate'].includes(label)))
    throw new Error('Invalid source-tree labels');
  const groups = labels.flatMap((label) =>
    LIGHTS.map((light) => {
      const runs = Array.from({ length: 5 }, (_, i) => {
        const file = `${label}-${light}-${i + 1}.json`;
        const path = join(directory, file);
        try {
          const value = json(path);
          if (optionalField(value, 'failed') === true) return { file, sha256: hash(path), result: null, readError: null, captureFailure: value };
          return { file, sha256: hash(path), result: inspectRun(value, light), readError: null, captureFailure: null };
        } catch (error) {
          return {
            file,
            sha256: fileHash(path),
            result: null,
            readError: String(error),
            captureFailure: null,
          };
        }
      }).map((run, i) => {
        const hostObservationIndices = loadEvidence.observations
          .filter(
            (observation) =>
              observation.usable &&
              observation.phase === `${label}:${light}:run-${i + 1}` &&
              run.result?.samplingWindows.some(
                (window) => observation.atMs !== null && observation.atMs >= window.startedAt && observation.atMs < window.finishedAt,
              ),
          )
          .map((observation) => observation.index);
        return {
          ...run,
          hostObservationIndices,
          hostEvidenceIssue: hostObservationIndices.length ? null : "No usable competing-load observation during this run's measured sampling",
        };
      });
      const range = (side: 'scene' | 'hidden', metric: 'cpuMsMedian' | 'cpuMsP95' | 'gpuMsMedian' | 'gpuMsP95' | 'drawCalls' | 'triangles') =>
        runRange(runs.map((run) => run.result?.[side][metric] ?? null));
      const summary = (side: 'scene' | 'hidden') => ({
        cpuMsMedian: range(side, 'cpuMsMedian'),
        cpuMsP95: range(side, 'cpuMsP95'),
        gpuMsMedian: range(side, 'gpuMsMedian'),
        gpuMsP95: range(side, 'gpuMsP95'),
        drawCalls: range(side, 'drawCalls'),
        triangles: range(side, 'triangles'),
      });
      const issues = runs.flatMap((run) => (run.hostEvidenceIssue ? [`${run.file}: ${run.hostEvidenceIssue}`] : []));
      const invalid = globalIssues.length > 0 || issues.length > 0 || runs.some((run) => !run.result || run.result.issues.length > 0);
      const budgetObservation = (side: 'scene' | 'hidden') => {
        const exceeds = runs.some((run) => (run.result?.[side].cpuMsP95 ?? Infinity) > BUDGET || (run.result?.[side].gpuMsP95 ?? Infinity) > BUDGET);
        return invalid ? 'inconclusive' : exceeds ? 'exceeds' : 'within';
      };
      return {
        label,
        light,
        issues,
        hostObservationIndices: runs.flatMap((run) => run.hostObservationIndices),
        shownBudgetObservation: budgetObservation('scene'),
        hiddenBudgetObservation: budgetObservation('hidden'),
        scene: summary('scene'),
        hidden: summary('hidden'),
        pairedAssetGpuMs: runRange(runs.map((run) => run.result?.pairedAssetGpuMs ?? null)),
        pairedAssetCpuMs: runRange(runs.map((run) => run.result?.pairedAssetCpuMs ?? null)),
        pairedAssetReliableRuns: runs.filter((run) => run.result?.pairedAssetReliable).length,
        runs,
      };
    }),
  );
  return {
    scope: 'Standard fixed 1080p offline development review scene only. No production or whole-game FPS claim.',
    taskVerdict: 'Pending separate limiter evidence and independent code/visual review; budget observations alone do not complete the task.',
    directory: resolve(directory),
    budgetMs: BUDGET,
    globalIssues,
    context,
    contextSha256: hash(join(directory, 'context.json')),
    statusSha256: hash(join(directory, 'status.json')),
    hostEvidence: loadEvidence,
    groups,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output) throw new Error('Usage: benchmark-report.ts <capture-directory> <new-report.json>');
  writeFileSync(output, JSON.stringify(benchmarkReport(directory), null, 2) + '\n', { flag: 'wx' });
}
