// Diagnostic controls for timer attribution. Never called by perf(), profile() or the game frame loop.
const CONTROLS = [
  { name: 'idle-empty', queued: 0, drain: false, timed: 0 },
  { name: 'queued-frame-empty', queued: 1, drain: false, timed: 0 },
  { name: 'drained-frame-empty', queued: 1, drain: true, timed: 0 },
  { name: 'isolated-one-frame', queued: 0, drain: false, timed: 1 },
  { name: 'isolated-four-frames', queued: 0, drain: false, timed: 4 },
];
const now = () => new Date().toISOString();
const yieldResult = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Five alternating blocks at most, 35 actual shown-asset frames plus the standard bounded warm-up. */
export function timerBoundaries(review, { blocks = 5 } = {}) {
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 5) throw new Error('Timer-boundary blocks must be an integer from 1 to 5');
  return review.serial(async () => {
    const report = review.lastTimerBoundaries = {
      diagnosticOnly: true, kind: 'timer-boundary-controls', contractVersion: 1,
      startedAt: now(), finishedAt: null, case: review.case, lod: review.lodLevel,
      blocks, maxControlFrames: blocks * 7, device: null, viewport: null, warm: null,
      samples: [], disjointObservations: 0, glErrors: { before: [], after: [] }, contextLostAfter: null, failure: null,
      method: 'Real shown review frames. Every control starts drained. Queued-frame-empty deliberately omits the fence between its preceding frame and empty query. Other query starts are drained. All gl.finish fences are outside query brackets. These observations never qualify a scene budget.',
    };
    const visible = review.root.visible;
    let gl = null;
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
          const rec = {
            block, control: control.name, startedAt: now(), finishedAt: null,
            queuedWork: [], timedWork: [], fences: [], queryStartedAt: null, queryEndedAt: null,
            wallThroughCompletionFenceMs: null, gpuResultNs: null, gpuMs: null, gpuStatus: 'pending', failure: null,
          };
          report.samples.push(rec);
          let query = null;
          let active = false;
          const finish = (label) => {
            const start = performance.now();
            gl.finish();
            rec.fences.push({ label, at: now(), cpuMs: performance.now() - start });
          };
          try {
            finish('before-queued-work');
            for (let i = 0; i < control.queued; i++) frame(rec.queuedWork);
            if (control.drain) finish('drain-queued-work-before-query');
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
            } finally {
              if (active) {
                gl.endQuery(ext.TIME_ELAPSED_EXT);
                active = false;
                rec.queryEndedAt = now();
              }
            }
            finish('after-query');
            rec.wallThroughCompletionFenceMs = performance.now() - start;
            if (query) {
              for (let poll = 0; poll < 100; poll++) {
                if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
                  report.disjointObservations++;
                  rec.gpuStatus = 'disjoint';
                  break;
                }
                if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
                  const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
                  const valid = typeof ns === 'number' && Number.isFinite(ns) && ns >= 0;
                  rec.gpuResultNs = valid ? ns : String(ns);
                  rec.gpuMs = valid ? ns / 1e6 : null;
                  rec.gpuStatus = valid ? 'timer' : 'invalid';
                  break;
                }
                await yieldResult();
              }
              if (rec.gpuStatus === 'pending') rec.gpuStatus = 'timeout';
            }
          } catch (error) {
            rec.failure = String(error);
            if (rec.gpuStatus === 'pending') rec.gpuStatus = 'failed';
            throw error;
          } finally {
            if (active) gl.endQuery(ext.TIME_ELAPSED_EXT);
            if (query) gl.deleteQuery(query);
            rec.finishedAt = now();
          }
        }
      }
    } catch (error) {
      report.failure = String(error);
    } finally {
      review.root.visible = visible;
      if (gl) {
        report.glErrors.after = review.glErrors();
        report.contextLostAfter = gl.isContextLost();
        if (!report.failure && (report.glErrors.after.length || report.contextLostAfter)) report.failure = 'GL errors or context loss during timer-boundary controls';
      }
      report.finishedAt = now();
    }
    if (report.failure) throw new Error(report.failure);
    return report;
  });
}
