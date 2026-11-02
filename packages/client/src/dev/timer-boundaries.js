// Diagnostic controls for timer attribution. Never called by perf(), profile() or the game frame loop.
import { gpuCompletion } from './gpu-completion.js';
import { dependentOutput } from './dependent-output.js';

const CONTROLS = [
  { name: 'idle-empty', queued: 0, drain: false, timed: 0 },
  { name: 'queued-frame-empty', queued: 1, drain: false, timed: 0 },
  { name: 'drained-frame-empty', queued: 1, drain: true, timed: 0 },
  { name: 'isolated-one-frame', queued: 0, drain: false, timed: 1 },
  { name: 'isolated-four-frames', queued: 0, drain: false, timed: 4 },
  { name: 'dependent-one-pass', queued: 0, drain: false, timed: 0, dependent: 1 },
  { name: 'dependent-four-passes', queued: 0, drain: false, timed: 0, dependent: 4 },
];
const now = () => new Date().toISOString();
const yieldResult = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Bounded diagnostic controls. A signal/output match does not by itself validate timer-query durations. */
export function timerBoundaries(review, { blocks = 5 } = {}) {
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 5) throw new Error('Timer-boundary blocks must be an integer from 1 to 5');
  return review.serial(async () => {
    const reportStart = performance.now();
    const report = review.lastTimerBoundaries = {
      diagnosticOnly: true, kind: 'timer-boundary-controls', contractVersion: 2,
      startedAt: now(), finishedAt: null, case: review.case, lod: review.lodLevel,
      blocks, maxControlFrames: blocks * 7, maxDependentControlPasses: blocks * 5, device: null, viewport: null, warm: null,
      warmupCompletions: [], dependentWarmup: { passes: [], completions: [], proof: null }, dependentDisposed: false, cpuElapsedMs: null,
      samples: [], disjointObservations: 0, glErrors: { before: [], after: [] }, contextLostAfter: null, failure: null,
      premise: 'Timer-query durations may not be trustworthy exclusive elapsed time on this executing backend. A different fence does not make them valid.',
      method: 'Bounded WebGLSync signal polling is outside queries. Real shown-frame controls retain original work. Separate same-context offscreen passes consume previous GPU output; readbacks/checksums are outside queries after observed completion. Compare query values with monotonic completion/availability bounds; never qualify a scene budget here.',
    };
    const visible = review.root.visible;
    let gl = null;
    let dependent = null;
    try {
      const renderer = review.game.engine.renderer;
      gl = renderer.getContext();
      report.device = review.device();
      report.viewport = [renderer.domElement.width, renderer.domElement.height];
      report.glErrors.before = review.glErrors();
      if (report.glErrors.before.length || gl.isContextLost()) throw new Error('GL errors or context loss before timer-boundary controls');
      const ext = review.gpuTimer();
      if (!ext) throw new Error('Timer-boundary controls require EXT_disjoint_timer_query_webgl2');
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw new Error('An external TIME_ELAPSED query is already active');
      review.root.visible = true;
      report.warm = await review.warmUp(1000 / 60, 30, 600);
      await gpuCompletion(gl, 'after-scene-warmup', report.warmupCompletions);
      dependent = dependentOutput(renderer);
      dependent.render(4, report.dependentWarmup.passes);
      await gpuCompletion(gl, 'after-dependent-warmup', report.dependentWarmup.completions);
      report.dependentWarmup.proof = dependent.read();
      if (!report.dependentWarmup.proof.matches) throw new Error('Dependent-output warm-up readback mismatch');
      const frame = (work) => {
        const rec = { startedAt: now(), completed: false, cpuMs: null, calls: null, triangles: null };
        work.push(rec);
        const start = performance.now();
        try {
          review.frameOnce(1 / 60);
          rec.completed = true;
        } finally {
          rec.cpuMs = performance.now() - start;
          rec.calls = renderer.info.render.calls;
          rec.triangles = renderer.info.render.triangles;
        }
      };
      for (let block = 1; block <= blocks; block++) {
        const order = block % 2 ? CONTROLS : [...CONTROLS].reverse();
        for (const control of order) {
          const controlStart = performance.now();
          const rec = {
            block, control: control.name, startedAt: now(), finishedAt: null,
            queuedWork: [], timedWork: [], completions: [], queryStartedAt: null, queryEndedAt: null, queryDeletedAt: null,
            dependentWork: { passes: [], proof: null }, queryPolls: [], queryAvailableAtEnd: null, queryAvailableAfterCompletion: null,
            cpuWallThroughObservedCompletionMs: null, cpuWallThroughQueryAvailabilityMs: null, cpuElapsedMs: null,
            gpuResultNs: null, gpuMs: null, gpuStatus: 'pending', failure: null,
          };
          report.samples.push(rec);
          let query = null;
          let active = false;
          try {
            await gpuCompletion(gl, 'before-queued-work', rec.completions);
            for (let i = 0; i < control.queued; i++) frame(rec.queuedWork);
            if (control.drain) await gpuCompletion(gl, 'drain-queued-work-before-query', rec.completions);
            query = gl.createQuery();
            if (!query) rec.gpuStatus = 'unavailable';
            const start = performance.now();
            if (query) {
              rec.queryStartedAt = now();
              gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
              active = true;
            }
            try {
              for (let i = 0; i < control.timed; i++) frame(rec.timedWork);
              if (control.dependent) dependent.render(control.dependent, rec.dependentWork.passes);
            } finally {
              if (active) {
                gl.endQuery(ext.TIME_ELAPSED_EXT);
                active = false;
                rec.queryEndedAt = now();
              }
            }
            if (query) rec.queryAvailableAtEnd = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
            await gpuCompletion(gl, 'after-query', rec.completions);
            rec.cpuWallThroughObservedCompletionMs = performance.now() - start;
            if (query) {
              rec.queryAvailableAfterCompletion = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
              for (let poll = 0; poll < 100; poll++) {
                const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
                const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
                rec.queryPolls.push({ at: now(), elapsedMs: performance.now() - start, available, disjoint });
                if (disjoint) {
                  report.disjointObservations++;
                  rec.gpuStatus = 'disjoint';
                  break;
                }
                if (available) {
                  const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
                  const valid = typeof ns === 'number' && Number.isFinite(ns) && ns >= 0;
                  rec.gpuResultNs = valid ? ns : String(ns);
                  rec.gpuMs = valid ? ns / 1e6 : null;
                  rec.gpuStatus = valid ? 'timer' : 'invalid';
                  rec.cpuWallThroughQueryAvailabilityMs = performance.now() - start;
                  break;
                }
                await yieldResult();
              }
              if (rec.gpuStatus === 'pending') rec.gpuStatus = 'timeout';
            }
            if (control.dependent) {
              rec.dependentWork.proof = dependent.read();
              if (!rec.dependentWork.proof.matches) throw new Error('Dependent-output readback mismatch');
            }
          } catch (error) {
            rec.failure = String(error);
            if (rec.gpuStatus === 'pending') rec.gpuStatus = 'failed';
            throw error;
          } finally {
            if (active) gl.endQuery(ext.TIME_ELAPSED_EXT);
            if (query) {
              gl.deleteQuery(query);
              rec.queryDeletedAt = now();
            }
            rec.finishedAt = now();
            rec.cpuElapsedMs = performance.now() - controlStart;
          }
        }
      }
    } catch (error) {
      report.failure = String(error);
    } finally {
      review.root.visible = visible;
      if (dependent) {
        dependent.dispose();
        report.dependentDisposed = true;
      }
      if (gl) {
        report.glErrors.after = review.glErrors();
        report.contextLostAfter = gl.isContextLost();
        if (!report.failure && (report.glErrors.after.length || report.contextLostAfter)) report.failure = 'GL errors or context loss during timer-boundary controls';
      }
      report.finishedAt = now();
      report.cpuElapsedMs = performance.now() - reportStart;
    }
    if (report.failure) throw new Error(report.failure);
    return report;
  });
}
