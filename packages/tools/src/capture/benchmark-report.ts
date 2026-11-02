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
  if (!list(json(join(directory, 'host-samples.json'))).length) globalIssues.push('No competing-load samples were recorded');
  const labels = list(field(context, 'sourceTrees')).map((tree) => text(field(tree, 'label')));
  if (!labels.length || new Set(labels).size !== labels.length || labels.some((label) => !['current', 'baseline', 'candidate'].includes(label)))
    throw new Error('Invalid source-tree labels');
  const groups = labels.flatMap((label) =>
    LIGHTS.map((light) => {
      const runs = Array.from({ length: 5 }, (_, i) => {
        const file = `${label}-${light}-${i + 1}.json`;
        const path = join(directory, file);
        try {
          return { file, sha256: hash(path), result: inspectRun(json(path), light), readError: null };
        } catch (error) {
          return {
            file,
            sha256: (() => {
              try {
                return hash(path);
              } catch {
                return null;
              }
            })(),
            result: null,
            readError: String(error),
          };
        }
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
      const invalid = globalIssues.length > 0 || runs.some((run) => !run.result || run.result.issues.length > 0);
      const exceeds = runs.some((run) => (run.result?.scene.cpuMsP95 ?? Infinity) > BUDGET || (run.result?.scene.gpuMsP95 ?? Infinity) > BUDGET);
      return {
        label,
        light,
        budgetObservation: invalid ? 'inconclusive' : exceeds ? 'exceeds' : 'within',
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
    hostSamplesSha256: hash(join(directory, 'host-samples.json')),
    groups,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output) throw new Error('Usage: benchmark-report.ts <capture-directory> <new-report.json>');
  writeFileSync(output, JSON.stringify(benchmarkReport(directory), null, 2) + '\n', { flag: 'wx' });
}
