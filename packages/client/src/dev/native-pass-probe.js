import { gpuCompletion } from './gpu-completion.js';
import { dependentOutput } from './dependent-output.js';

const STAGES = ['renderPass', 'atmoPass', 'fxPass', 'viewPass', 'bloomPass', 'gradePass'];
const now = () => new Date().toISOString();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => ({ at: now(), monotonicMs: performance.now() });
const clocks = (review) => {
  const g = review.game;
  return { pinned: review.clock, game: g.time, base: g.timeBase, render: g.renderTime,
    flora: g.flora?.uniforms?.uTime?.value ?? null, weather: g.weather?.uniforms?.uTime?.value ?? null,
    grade: g.engine.gradePass.uniforms?.uTime?.value ?? null, atmosphere: g.engine.atmoPass.uniforms?.uTime?.value ?? null };
};

function checkScene(review) {
  const canvas = review.game.engine.renderer.domElement;
  if (review.case !== 'noon-lush' || review.lodLevel !== 0 || !review.root.visible
    || canvas.width !== 1920 || canvas.height !== 1080 || !Number.isFinite(review.clock) || review.liveOn)
    throw new Error('Native pass probe requires the shown pinned 1920x1080 noon-lush LOD0 review with live rendering off');
}

async function prepare(review) {
  const report = review.lastNativePassProbe = {
    diagnosticOnly: true, kind: 'native-pass-query-controls', contractVersion: 1,
    preparedAt: null, startedAt: null, finishedAt: null, timeOriginMs: performance.timeOrigin,
    case: review.case, lod: review.lodLevel, viewport: null, device: null, warm: null,
    preflight: { completions: [], passes: [], proof: null, disposed: false, clocks: null },
    samples: [], pairMatches: [], cancelled: false, failure: null, failureKind: null,
    glErrors: { before: [], after: [] }, contextLostAfter: null,
    premise: 'Query brackets may alter command-buffer structure/work, or durations may sum overlapping lifetimes. Wall differences alone cannot identify a real no-query hotspot.',
    outputLimit: 'Same-task PNG readback is outside frame/query brackets and can force completion or add encoder work. It is identical in both conditions, timed separately, and not unprofiled rendering.',
    traceVerdict: 'unobserved: native lifecycle events, ownership, frame/readback mapping and actual encoder work require independent trace inspection',
  };
  let fixture = null;
  try {
    checkScene(review);
    const renderer = review.game.engine.renderer;
    const gl = renderer.getContext();
    report.device = review.device();
    report.viewport = [renderer.domElement.width, renderer.domElement.height];
    report.glErrors.before = review.glErrors();
    if (report.glErrors.before.length || gl.isContextLost()) throw new Error('GL errors or context loss before native pass probe');
    const ext = review.gpuTimer();
    if (!ext || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw new Error('Native probe requires idle timer-query support');
    report.warm = await review.warmUp(1000 / 60, 30, 600);
    if (!report.warm.stable) throw new Error('Native probe warm-up did not stabilize');
    await gpuCompletion(gl, 'after-native-scene-warmup', report.preflight.completions);
    fixture = dependentOutput(renderer);
    fixture.render(4, report.preflight.passes);
    await gpuCompletion(gl, 'after-native-dependent-preflight', report.preflight.completions);
    report.preflight.proof = fixture.read();
    if (!report.preflight.proof.matches) throw new Error('Dependent-output preflight mismatch');
    report.glErrors.after = review.glErrors();
    report.contextLostAfter = gl.isContextLost();
    if (report.glErrors.after.length || report.contextLostAfter) throw new Error('GL errors or context loss during native preflight');
    report.preflight.clocks = clocks(review);
    report.preparedAt = now();
  } catch (error) {
    report.failure = String(error);
    report.failureKind = 'preflight-failed';
    throw error;
  } finally {
    if (fixture) { fixture.dispose(); report.preflight.disposed = true; }
  }
  return report;
}

async function collect(gl, ext, queries) {
  for (const entry of queries) {
    for (let i = 0; i < 100; i++) {
      const available = gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      entry.record.polls.push({ ...stamp(), available, disjoint });
      if (disjoint) { entry.record.status = 'disjoint'; break; }
      if (available) {
        const ns = gl.getQueryParameter(entry.query, gl.QUERY_RESULT);
        const valid = typeof ns === 'number' && Number.isFinite(ns) && ns >= 0;
        entry.record.rawNs = valid ? ns : String(ns);
        entry.record.status = valid ? 'timer' : 'invalid';
        break;
      }
      await pause(5);
    }
    if (entry.record.status === 'pending') entry.record.status = 'timeout';
  }
}

async function run(review) {
  const report = review.lastNativePassProbe;
  if (!report?.preparedAt || report.startedAt || report.failure || !report.preflight.disposed)
    throw new Error('Prepare a fresh native pass probe before running it');
  const renderer = review.game.engine.renderer;
  const gl = renderer.getContext();
  const ext = review.gpuTimer();
  report.startedAt = now();
  try {
    checkScene(review);
    for (let pair = 1; pair <= 5; pair++) {
      const order = pair % 2 ? ['off', 'passes'] : ['passes', 'off'];
      for (const mode of order) {
        if (report.cancelled) { report.failureKind = 'cancelled'; throw new Error('Native pass probe cancelled'); }
        checkScene(review);
        const sample = { pair, mode, started: stamp(), frameStarted: null, frameFinished: null,
          readbackStarted: null, readbackFinished: null, finished: null, clocksBefore: clocks(review), clocksAfter: null,
          frameCompleted: false, calls: null, triangles: null, png: null, queries: [], completions: [], failure: null };
        report.samples.push(sample);
        const queries = [];
        const restore = [];
        try {
          await gpuCompletion(gl, 'before-native-frame', sample.completions);
          if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw new Error('External query before native frame');
          if (mode === 'passes') for (const stage of STAGES) {
            const owner = review.game.engine[stage];
            const descriptor = Object.getOwnPropertyDescriptor(owner, 'render');
            const render = owner.render;
            restore.push(() => descriptor ? Object.defineProperty(owner, 'render', descriptor) : delete owner.render);
            owner.render = function (...args) {
              const query = gl.createQuery();
              if (!query) throw new Error('Native pass query allocation failed');
              const record = { stage, started: stamp(), ended: null, deletedAt: null, rawNs: null, status: 'pending', polls: [], calls: null, triangles: null };
              sample.queries.push(record);
              queries.push({ query, record });
              const calls = renderer.info.render.calls;
              const triangles = renderer.info.render.triangles;
              let active = false;
              try {
                gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
                active = true;
                return render.apply(this, args);
              } finally {
                if (active) gl.endQuery(ext.TIME_ELAPSED_EXT);
                record.ended = stamp();
                record.calls = renderer.info.render.calls - calls;
                record.triangles = renderer.info.render.triangles - triangles;
              }
            };
          }
          sample.frameStarted = stamp();
          try {
            review.frameOnce(1 / 60);
            sample.frameCompleted = true;
          } finally {
            sample.frameFinished = stamp();
            sample.calls = renderer.info.render.calls;
            sample.triangles = renderer.info.render.triangles;
            for (const reset of restore.splice(0).reverse()) reset();
          }
          // The default framebuffer is not preserved across tasks. Never render an extra capture frame.
          sample.readbackStarted = stamp();
          sample.png = renderer.domElement.toDataURL('image/png');
          sample.readbackFinished = stamp();
          if (!sample.png.startsWith('data:image/png;base64,') || sample.png.length <= 22) throw new Error('Native scene output is not a PNG');
          sample.clocksAfter = clocks(review);
          await gpuCompletion(gl, 'after-native-frame-and-readback', sample.completions);
          await collect(gl, ext, queries);
          if (sample.queries.some((q) => q.status !== 'timer')) { report.failureKind = 'query-unobserved'; throw new Error('Native pass query result missing, disjoint or invalid'); }
          if (mode === 'passes' && (sample.queries.length !== STAGES.length || sample.queries.some((q, i) => q.stage !== STAGES[i]))) {
            report.failureKind = 'work-structure-mismatch'; throw new Error('Existing six pass bracket locations were not each invoked once in order');
          }
        } catch (error) {
          sample.failure = String(error);
          throw error;
        } finally {
          for (const reset of restore.reverse()) reset();
          for (const { query, record } of queries) { gl.deleteQuery(query); record.deletedAt = now(); }
          sample.finished = stamp();
        }
        await pause(100);
      }
      const [a, b] = report.samples.slice(-2);
      const match = { pair, calls: a.calls === b.calls, triangles: a.triangles === b.triangles, png: a.png === b.png };
      report.pairMatches.push(match);
      if (!match.calls || !match.triangles) { report.failureKind = 'work-count-mismatch'; throw new Error('Rendered work counts differ within the native pair'); }
      if (!match.png) { report.failureKind = 'scene-output-mismatch'; throw new Error('Scene output differs within the native pair; legitimate animation/easing and query effects remain distinct possibilities'); }
    }
  } catch (error) {
    report.failure = String(error);
    report.failureKind ??= 'frame-or-completion-failed';
  } finally {
    report.glErrors.after = review.glErrors();
    report.contextLostAfter = gl.isContextLost();
    if (!report.failure && (report.glErrors.after.length || report.contextLostAfter)) {
      report.failure = 'GL errors or context loss during native pass probe'; report.failureKind = 'gl-error';
    }
    report.finishedAt = now();
  }
  if (report.failure) throw new Error(report.failure);
  return report;
}

/** Only preparation/execution for an external native trace. No timing validity or budget classification. */
export function nativePassProbe(review, action) {
  if (!['prepare', 'run', 'cancel'].includes(action)) throw new Error('Native pass probe action must be prepare, run or cancel');
  if (action === 'cancel') {
    if (review.lastNativePassProbe) review.lastNativePassProbe.cancelled = true;
    return Promise.resolve({ cancelled: true });
  }
  return review.serial(() => action === 'prepare' ? prepare(review) : run(review));
}
