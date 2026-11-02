import { gpuCompletion } from './gpu-completion.js';
import { dependentOutput } from './dependent-output.js';

export const NATIVE_WORK_CLASSES = ['drained-empty', 'fence-only', 'frame-only', 'frame-plus-PNG'];
const stamp = () => ({ at: new Date().toISOString(), monotonicMs: performance.now() });
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
const clocks = (review) => {
  const g = review.game;
  return { pinned: review.clock, game: g.time, base: g.timeBase, render: g.renderTime,
    flora: g.flora?.uniforms?.uTime?.value ?? null, weather: g.weather?.uniforms?.uTime?.value ?? null,
    grade: g.engine.gradePass.uniforms?.uTime?.value ?? null, atmosphere: g.engine.atmoPass.uniforms?.uTime?.value ?? null };
};
// Read actual public AtmospherePass state, without changing history, effects, counters or uniforms.
const temporal = (review) => {
  const a = review.game.engine.atmoPass;
  const jitter = a.uniforms?.uJitter?.value;
  return { frameIdx: a.frameIdx ?? null, histIdx: a.histIdx ?? null, histValid: a.histValid ?? null, prevKey: a.prevKey ?? null,
    marchPlanet: a.uniforms?.uMarchPlanet?.value ?? null, jitter: jitter ? [jitter.x, jitter.y] : null,
    historyValidUniform: a.resolveUniforms?.uHistValid?.value ?? null, blend: a.resolveUniforms?.uBlend?.value ?? null,
    historySizes: a.hist?.map((t) => [t.width, t.height]) ?? null };
};
const counters = (review) => {
  const r = review.game.engine.renderer.info.render;
  return { calls: r.calls, triangles: r.triangles };
};
function checkScene(review) {
  const canvas = review.game.engine.renderer.domElement;
  if (review.case !== 'noon-lush' || review.lodLevel !== 0 || !review.root.visible
    || canvas.width !== 1920 || canvas.height !== 1080 || !Number.isFinite(review.clock) || review.liveOn)
    throw new Error('Native work-class probe requires the shown pinned 1920x1080 noon-lush LOD0 review with live rendering off');
}
function checkCancelled(report) {
  if (report.cancelled) { report.failureKind = 'cancelled'; throw new Error('Native work-class probe cancelled'); }
}
function checkIdleQuery(review, gl) {
  const ext = review.gpuTimer();
  if (ext && gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw new Error('External query during queries-off work-class probe');
}
async function complete(gl, label, out, report) {
  checkCancelled(report);
  await gpuCompletion(gl, label, out);
  checkCancelled(report);
}
async function prepare(review, workClass, operation) {
  const report = review.lastNativeWorkClassProbe = {
    diagnosticOnly: true, kind: 'native-work-class-control', contractVersion: 1, protocol: 'work-class', workClass,
    preparedAt: null, startedAt: null, finishedAt: null, timeOriginMs: performance.timeOrigin,
    viewport: null, device: null, warm: null, cancelled: operation.cancelled, failure: null, failureKind: null,
    preflight: { completions: [], passes: [], proof: null, disposed: false, settledAt: null },
    samples: [], glErrors: { before: [], after: [] }, contextLostAfter: null,
    limits: 'Separate work-class observation only. No buffer/pass identity,exclusive subtraction cost,query causality,output equality,asset regression or budget verdict. Cross-trace temporal/native variation remains.',
    outputPolicy: workClass === 'frame-plus-PNG' ? 'Immediate same-task PNG only;no extra capture frame.'
      : 'PNG structurally absent;no later readback of a non-preserved frame and no output-equivalence claim.',
  };
  operation.report = report;
  let fixture = null;
  try {
    checkCancelled(report); checkScene(review);
    const renderer = review.game.engine.renderer;
    const gl = renderer.getContext();
    report.device = review.device();
    report.viewport = [renderer.domElement.width, renderer.domElement.height];
    report.glErrors.before = review.glErrors();
    if (report.glErrors.before.length || gl.isContextLost()) throw new Error('GL errors or context loss before work-class preparation');
    checkIdleQuery(review, gl);
    report.warm = await review.warmUp(1000 / 60, 30, 600);
    checkCancelled(report);
    if (!report.warm.stable) throw new Error('Native work-class warm-up did not stabilize');
    await complete(gl, 'after-work-class-warmup', report.preflight.completions, report);
    fixture = dependentOutput(renderer);
    fixture.render(4, report.preflight.passes);
    await complete(gl, 'after-work-class-dependent-preflight', report.preflight.completions, report);
    report.preflight.proof = fixture.read();
    if (!report.preflight.proof.matches) throw new Error('Dependent-output work-class preflight mismatch');
    fixture.dispose(); fixture = null; report.preflight.disposed = true;
    // The fixture read/disposal may issue commands. Observe its completion before the native capture starts.
    await complete(gl, 'after-work-class-preflight-disposal', report.preflight.completions, report);
    report.preflight.settledAt = stamp();
    report.glErrors.after = review.glErrors();
    report.contextLostAfter = gl.isContextLost();
    if (report.glErrors.after.length || report.contextLostAfter) throw new Error('GL errors or context loss during work-class preparation');
    report.preparedAt = stamp().at;
  } catch (error) {
    report.failure = String(error); report.failureKind ??= 'preflight-failed'; report.finishedAt = stamp().at;
    throw error;
  } finally {
    if (fixture) { fixture.dispose(); report.preflight.disposed = true; }
  }
  return report;
}
function submitFrame(review, sample) {
  sample.frameStarted = stamp();
  sample.operations.frames++;
  try { review.frameOnce(1 / 60); sample.frameCompleted = true; }
  finally { sample.frameFinished = stamp(); sample.rendered = counters(review); }
}
// Separate paths: the no-output function has no PNG API or deferred readback callback.
function frameWithoutOutput(review, sample) { submitFrame(review, sample); }
function frameWithPng(review, sample) {
  submitFrame(review, sample);
  sample.readbackStarted = stamp();
  sample.operations.png++;
  try {
    sample.png = review.game.engine.renderer.domElement.toDataURL('image/png');
    if (!sample.png.startsWith('data:image/png;base64,') || sample.png.length <= 22) throw new Error('Native work-class scene output is not a PNG');
  } finally { sample.readbackFinished = stamp(); }
}
async function run(review, workClass, operation) {
  const report = review.lastNativeWorkClassProbe;
  if (!report?.preparedAt || !report.preflight.disposed || !report.preflight.settledAt || report.startedAt || report.failure || report.workClass !== workClass)
    throw new Error('Prepare a fresh matching native work-class probe before running it');
  operation.report = report;
  report.cancelled ||= operation.cancelled;
  const gl = review.game.engine.renderer.getContext();
  report.startedAt = stamp().at;
  const sample = { workClass, started: stamp(), finished: null, controlStarted: null, controlFinished: null,
    clocksBefore: clocks(review), clocksAfter: null, temporalBefore: temporal(review), temporalAfter: null,
    countersBefore: counters(review), countersAfter: null, operations: { frames: 0, png: 0, queries: 0 },
    frameStarted: null, frameFinished: null, frameCompleted: false, rendered: null, completions: [], failure: null,
    ...(workClass === 'frame-plus-PNG' ? { readbackStarted: null, readbackFinished: null, png: null } : {}),
  };
  report.samples.push(sample);
  try {
    checkCancelled(report); checkScene(review); checkIdleQuery(review, gl);
    sample.controlStarted = stamp();
    if (workClass === 'drained-empty') {
      // No new fence, frame, readback or query in this bounded idle interval.
      await pause(); checkCancelled(report);
    } else {
      await complete(gl, 'before-native-work-class', sample.completions, report);
      checkScene(review); checkIdleQuery(review, gl);
      if (workClass === 'frame-only') frameWithoutOutput(review, sample);
      else if (workClass === 'frame-plus-PNG') frameWithPng(review, sample);
      await complete(gl, 'after-native-work-class', sample.completions, report);
    }
  } catch (error) {
    sample.failure = report.failure = String(error); report.failureKind ??= 'work-or-completion-failed';
  } finally {
    sample.controlFinished = stamp();
    sample.clocksAfter = clocks(review); sample.temporalAfter = temporal(review); sample.countersAfter = counters(review);
    report.glErrors.after = review.glErrors(); report.contextLostAfter = gl.isContextLost();
    if (!report.failure && (report.glErrors.after.length || report.contextLostAfter)) {
      report.failure = sample.failure = 'GL errors or context loss during native work-class probe'; report.failureKind = 'gl-error';
    }
    sample.finished = stamp(); report.finishedAt = stamp().at;
  }
  if (report.failure) throw new Error(report.failure);
  return report;
}

/** Candidate-only controls for separate native attempts. Existing standard/default probes are untouched. */
export function nativeWorkClassProbe(review, action, workClass) {
  if (action === 'cancel') {
    const operation = review.nativeWorkClassOperation;
    if (!operation) return Promise.resolve({ cancelled: true });
    operation.cancelled = true;
    if (operation.report && !operation.report.finishedAt) operation.report.cancelled = true;
    // Cancellation acknowledges terminal in-page settlement, not merely a flag.
    return operation.task.then(() => ({ cancelled: true }), () => ({ cancelled: true }));
  }
  if (!['prepare', 'run'].includes(action) || !NATIVE_WORK_CLASSES.includes(workClass)) throw new Error('Select prepare/run and one exact native work class');
  if (review.nativeWorkClassOperation) throw new Error('A native work-class operation is already pending');
  const operation = { cancelled: false, report: null, task: null };
  review.nativeWorkClassOperation = operation;
  const task = operation.task = review.serial(() => action === 'prepare' ? prepare(review, workClass, operation) : run(review, workClass, operation));
  const settled = () => { if (review.nativeWorkClassOperation === operation) review.nativeWorkClassOperation = null; };
  // Install both handlers immediately; callers still receive the original failure.
  void task.then(settled, settled);
  return task;
}
