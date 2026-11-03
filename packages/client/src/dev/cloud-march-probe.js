import { AtmospherePass } from '../render/AtmospherePass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { nativeWorkClassProbe } from './native-work-class-probe.js';

export const CLOUD_MARCH_MODES = ['drained-empty', 'fence-only', 'reference', 'reuse'];
const stamp = () => ({ at: new Date().toISOString(), monotonicMs: performance.now() });
const workClass = (mode) => mode === 'reference' || mode === 'reuse' ? 'frame-only' : mode;
const target = (t) => ({ width: t.width, height: t.height, textures: t.textures.map((x) => x.uuid) });
function passState(a) {
  return { frameIdx: a.frameIdx, histIdx: a.histIdx, histValid: a.histValid, needsSwap: a.needsSwap,
    marchPlanet: a.uniforms.uMarchPlanet.value, jitter: a.uniforms.uJitter.value.toArray(),
    cloudTarget: target(a.cloudTarget), history: a.hist.map(target),
    selectedHistory: a.uniforms.tCloud.value?.uuid ?? null };
}
function binding(review) {
  const engine = review.game.engine, a = engine.atmoPass, quad = a?.marchQuad;
  if (!(a instanceof AtmospherePass) || !(quad instanceof FullScreenQuad) || quad.render !== FullScreenQuad.prototype.render
    || a.needsSwap !== true || !engine.composer?.passes.includes(a)) throw new Error('Exact unwrapped AtmospherePass march binding required');
  const descriptor = Object.getOwnPropertyDescriptor(quad, 'render');
  if (descriptor && (!descriptor.configurable || !descriptor.writable || descriptor.value !== quad.render))
    throw new Error('March method descriptor cannot be restored exactly');
  return { engine, a, quad, original: quad.render, descriptor, target: a.cloudTarget, textures: [...a.cloudTarget.textures] };
}
function validTarget(b, renderer) {
  const t = b.a.cloudTarget;
  if (renderer !== b.engine.renderer || b.target !== t || t.textures.some((x, i) => x !== b.textures[i])
    || renderer.getRenderTarget() !== t || t.width !== 960 || t.height !== 540
    || t.textures.length !== 2 || !Number.isInteger(b.a.uniforms.uMarchPlanet.value) || b.a.uniforms.uMarchPlanet.value < 0)
    throw new Error('Ambiguous cloud march renderer/target/dimensions/active branch');
}

async function execute(review, operation, action, mode) {
  let b, installed = false, primary = null;
  const report = review.lastCloudMarchProbe = { diagnosticOnly: true, kind: 'cloud-march-work-control', contractVersion: 1,
    action, mode, workClass: workClass(mode), started: stamp(), finished: null, native: null, before: null, after: null,
    work: { preparationOriginalCalls: 0, controlOriginalCalls: 0, suppressedCalls: 0, outsideOperationCalls: 0, observations: [] },
    wrapperRestored: false, cancelled: false, failure: null, cleanupErrors: [],
    limitation: 'The reuse variant deliberately retains older cloud target content. No full-state/output equality, exclusive pass time or standard-scene budget claim.' };
  operation.report = report;
  let nativeOperation;
  const observations = report.work.observations;
  const invoke = function(...args) {
    const renderer = args[0];
    const owning = review.nativeWorkClassOperation === nativeOperation && nativeOperation?.report;
    if (!owning) {
      report.work.outsideOperationCalls++;
      const error = new Error('Cloud march outside the owned native operation');
      operation.ambiguity = error; operation.cancelled = true;
      if (nativeOperation) { nativeOperation.cancelled = true; if (nativeOperation.report) nativeOperation.report.cancelled = true; }
      throw error;
    }
    const n = nativeOperation.report;
    const sample = n.samples[0];
    const inFrame = action === 'run' && sample?.frameStarted && !sample.frameFinished && sample.operations.frames === 1;
    if (action === 'run' && !inFrame) throw new Error('Cloud march outside the recorded control frame');
    if (this !== b.quad || args.length !== 1 || observations.length >= (action === 'run' ? 1 : 600)) throw new Error('Cloud march receiver/count ambiguous');
    validTarget(b, renderer);
    const observed = { at: stamp(), target: target(b.a.cloudTarget), frameIdx: b.a.frameIdx,
      marchPlanet: b.a.uniforms.uMarchPlanet.value, receiverMatches: this === b.quad, argumentCount: args.length, suppressed: action === 'run' && mode === 'reuse' };
    observations.push(observed);
    if (observed.suppressed) { report.work.suppressedCalls++; return; }
    if (action === 'prepare') report.work.preparationOriginalCalls++;
    else report.work.controlOriginalCalls++;
    return b.original.apply(this, args);
  };
  try {
    b = binding(review);
    report.before = passState(b.a);
    const previous = review.cloudMarchPrepared;
    if (action === 'run' && (!previous || previous.mode !== mode || previous.native !== review.lastNativeWorkClassProbe
      || previous.quad !== b.quad || previous.target !== b.a.cloudTarget || previous.original !== b.original))
      throw new Error('Prepare a fresh matching full cloud march before its control');
    Object.defineProperty(b.quad, 'render', { value: invoke, configurable: true, writable: true });
    installed = true;
    const task = nativeWorkClassProbe(review, action, workClass(mode));
    nativeOperation = review.nativeWorkClassOperation;
    report.native = await task;
    report.cancelled = operation.cancelled || report.native.cancelled;
    if (report.cancelled || report.native.failure) throw new Error(report.native.failure || 'Cloud march control cancelled');
    if (report.work.outsideOperationCalls) throw new Error('Unobserved extra cloud march work outside operation');
    if (action === 'prepare') {
      if (report.work.preparationOriginalCalls !== report.native.warm.frames || report.work.preparationOriginalCalls < 1
        || report.work.controlOriginalCalls || report.work.suppressedCalls) throw new Error('Full cloud preparation work missing or changed');
      validPrepared(b);
      review.cloudMarchPrepared = { mode, native: report.native, quad: b.quad, target: b.a.cloudTarget, original: b.original };
    } else {
      const frame = mode === 'reference' || mode === 'reuse';
      const expectedOriginal = mode === 'reference' ? 1 : 0, expectedSuppressed = mode === 'reuse' ? 1 : 0;
      if (report.work.controlOriginalCalls !== expectedOriginal || report.work.suppressedCalls !== expectedSuppressed
        || report.work.preparationOriginalCalls) throw new Error('Expected cloud march control draw count not observed');
      if (frame && (report.native.samples[0].rendered.calls !== (mode === 'reuse' ? 649 : 650)
        || report.native.samples[0].rendered.triangles !== (mode === 'reuse' ? 3792980 : 3792981)))
        throw new Error('Cloud variant rendered work differs from exact frozen scene');
      if (frame && (b.a.frameIdx !== report.before.frameIdx + 1 || b.a.histIdx !== 1 - report.before.histIdx
        || !b.a.histValid || b.a.uniforms.tCloud.value !== b.a.hist[b.a.histIdx].textures[0]))
        throw new Error('Cloud resolve/history progression missing or changed');
      if (b.a.needsSwap !== true) throw new Error('Atmosphere composer swap changed');
    }
  } catch (error) {
    report.native ??= nativeOperation?.report ?? null;
    report.cancelled = operation.cancelled || !!report.native?.cancelled;
    report.failure = String(operation.ambiguity ?? error);
    primary = { error: operation.ambiguity ?? error };
  } finally {
    try {
      if (b && installed) {
        if (b.descriptor) Object.defineProperty(b.quad, 'render', b.descriptor);
        else delete b.quad.render;
      }
      report.wrapperRestored = !!b && b.quad.render === b.original && (Object.hasOwn(b.quad, 'render') === !!b.descriptor);
      if (b) report.after = passState(b.a);
    } catch (error) {
      report.cleanupErrors.push(String(error));
      report.failure ??= String(error);
      primary ??= { error };
    }
    report.finished = stamp();
    if (action === 'run' || report.failure) review.cloudMarchPrepared = null;
  }
  if (primary) throw primary.error;
  return report;
}
function validPrepared(b) {
  const a = b.a;
  if (a.cloudTarget.width !== 960 || a.cloudTarget.height !== 540 || !a.histValid || a.hist.length !== 2
    || a.hist.some((t) => t.width !== 960 || t.height !== 540 || t.textures.length !== 2)
    || a.uniforms.uMarchPlanet.value < 0) throw new Error('Full prepared cloud target/history unavailable');
}

export function cloudMarchProbe(review, action, mode) {
  if (action === 'cancel') {
    const operation = review.cloudMarchOperation;
    if (!operation) return Promise.resolve({ cancelled: true });
    operation.cancelled = true;
    return nativeWorkClassProbe(review, 'cancel').then(() => operation.task.then(() => ({ cancelled: true }), () => ({ cancelled: true })));
  }
  if (!['prepare', 'run'].includes(action) || !CLOUD_MARCH_MODES.includes(mode)) throw new Error('Select exact cloud march prepare/run/mode');
  if (review.cloudMarchOperation || review.nativeWorkClassOperation || review.busy) throw new Error('Cloud march diagnostic operation already pending');
  const operation = { cancelled: false, task: null, report: null };
  review.cloudMarchOperation = operation;
  const task = operation.task = execute(review, operation, action, mode);
  const settled = () => { if (review.cloudMarchOperation === operation) review.cloudMarchOperation = null; };
  void task.then(settled, settled);
  return task;
}
