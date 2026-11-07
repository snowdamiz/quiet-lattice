/** Opt-in only: importing this module never touches a runtime or starts rendering. */
export const unknown = (reason) => ({ status: 'unknown', reason });
const copy = (value) => value === undefined ? unknown('API unavailable') : structuredClone(value);
const errorText = (error) => {
  try { return String(error); } catch {
    try {
      const message = error?.message;
      return typeof message === 'string' ? message : 'Unprintable rejection value';
    } catch {
      return 'Unprintable rejection value';
    }
  }
};
const read = (fn) => { try { return copy(fn()); } catch (error) { return unknown(errorText(error)); } };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function capture(review, host = {}) {
  const engine = review.game?.engine;
  const renderer = engine?.renderer;
  const composer = engine?.composer;
  const parameter = (key) => read(() => {
    const gl = renderer.getContext();
    return gl.getParameter(gl[key]);
  });
  return {
    host: Object.fromEntries(['sourceRevision', 'assetSha256', 'runtimeBuild', 'os', 'power', 'thermal', 'hostLoad', 'driver'].map(key => [key, copy(host[key])])),
    case: copy(review.case), lod: copy(review.lodLevel),
    userAgent: read(() => globalThis.navigator?.userAgent),
    dpr: copy(globalThis.devicePixelRatio),
    hardwareConcurrency: read(() => globalThis.navigator?.hardwareConcurrency),
    backend: parameter('VERSION'), vendor: parameter('VENDOR'), renderer: parameter('RENDERER'),
    device: read(() => {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined;
    }),
    viewport: read(() => ({ width: renderer.domElement.width, height: renderer.domElement.height, pixelRatio: renderer.getPixelRatio() })),
    composer: read(() => [composer.renderTarget1, composer.renderTarget2].map(t => ({ width: t.width, height: t.height, samples: t.samples, type: t.texture.type }))),
    passes: read(() => composer.passes.map(p => ({ name: p.constructor.name, enabled: p.enabled, needsSwap: p.needsSwap }))),
    marchPlanet: read(() => engine?.atmoPass?.marchPlanet()),
    marchPlanetEvidence: { kind: 'current-selection', passExecution: 'unproven' },
    counters: read(() => renderer.info.render),
    shadows: read(() => ({ enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type })),
  };
}

/** A boolean intervention verifies both arms, including updates undoing a toggle. */
export function toggle(id, target, key) {
  if (!target || typeof target[key] !== 'boolean') throw new Error(`Unavailable boolean control: ${id}`);
  return {
    id, save: () => target[key], restore: value => { target[key] = value; },
    apply: (arm, saved) => { target[key] = arm === 'A' ? saved : !saved; },
    observe: () => target[key],
    matches: (arm, saved, observed) => observed === (arm === 'A' ? saved : !saved),
  };
}

export function timingEvidence(raw) {
  const reasons = [];
  if (!raw?.gpuTiming?.startsWith('EXT_disjoint_timer_query')) reasons.push('GPU timer provenance missing or wall-time fallback');
  for (const key of ['scene', 'withoutAsset']) {
    const s = raw?.[key];
    if (!Number.isFinite(s?.gpuMsMedian) || s.gpuMsMedian <= 0 || !Number.isFinite(s?.gpuMsP95) || s.gpuMsP95 < s.gpuMsMedian || !Number.isInteger(s?.gpuSamples) || s.gpuSamples <= 0) reasons.push(`${key}: missing/invalid timing`);
    if (s?.disjoint !== 0) reasons.push(`${key}: disjoint or unknown`);
  }
  return {
    status: reasons.length ? 'invalid-or-incomplete' : 'aggregate-only', reasons,
    pendingQueries: unknown('review.perf does not export pending queries'),
    lostQueries: unknown('review.perf does not export lost queries'),
    rawSamples: unknown('review.perf does not export raw samples'),
    runtimeErrors: raw?.errors === undefined ? unknown('review.perf does not export runtime errors') : copy(raw.errors),
    performanceFixed: false, attribution: 'unproven',
  };
}

const active = new WeakSet();
/** Caller must own an admitted, idle review session exclusively. No GPU queries created here. */
export async function runMatrix({ review, interventions, host = {}, repetitions = 5, perfOptions = { pairs: 120, maxPairs: 720 }, receipt = { runs: [], errors: [] } }) {
  if (!Number.isInteger(repetitions) || repetitions < 2) throw new Error('At least two alternating repetitions required');
  if (active.has(review)) throw new Error('Diagnostic matrix already active');
  active.add(review);
  try {
    let root, rootVisible;
    let context = { id: 'matrix', repetition: null, arm: null, phase: 'setup' };
    const errors = [];
    const failures = [];
    const record = (error, phase = context.phase) => {
      errors.push(error);
      failures.push({ ...context, phase, error: errorText(error) });
    };
    const cleanup = async (phase, fn) => {
      try { await fn(); } catch (error) { record(error, phase); }
    };
    const measure = async (id, repetition, arm, intervention, saved) => {
      context = { id, repetition, arm, phase: 'capture-before' };
      const row = { id, repetition, arm };
      const firstFailure = failures.length;
      let observedBefore = false, observedAfter = false;
      try {
        receipt.runs.push(row);
        row.before = capture(review, host);
        if (intervention) {
          context.phase = 'observe-before';
          row.controlBefore = copy(intervention.observe());
          observedBefore = true;
          if (!intervention.matches(arm, saved, row.controlBefore)) throw new Error(`${id}: ineffective ${arm} intervention`);
        }
        context.phase = 'perf';
        row.raw = copy(await review.perf(copy(perfOptions)));
        context.phase = 'timing-evidence';
        row.timing = timingEvidence(row.raw);
      } catch (error) {
        record(error);
      } finally {
        await cleanup('capture-after', () => { row.after = capture(review, host); });
        if (intervention) {
          await cleanup('observe-after', () => {
            row.controlAfter = copy(intervention.observe());
            observedAfter = true;
          });
          if (observedBefore && observedAfter) {
            await cleanup('verify-control', () => {
              if (!equal(row.controlBefore, row.controlAfter) || !intervention.matches(arm, saved, row.controlAfter)) throw new Error(`${id}: control changed during measurement`);
            });
          }
        }
        row.failures = failures.slice(firstFailure);
      }
      return failures.length === firstFailure;
    };
    const execute = async () => {
      root = review.root;
      rootVisible = root?.visible;
      receipt.configuration = { host: copy(host), repetitions, perfOptions: copy(perfOptions) };
      for (let i = 0; i < repetitions; i++) {
        if (!await measure('baseline-reproduction', i, 'A')) return;
      }
      for (const intervention of interventions) {
        context = { id: intervention.id, repetition: null, arm: null, phase: 'save' };
        const saved = copy(intervention.save());
        try {
          for (let i = 0; i < repetitions; i++) {
            for (const arm of i % 2 ? ['B', 'A'] : ['A', 'B']) {
              context = { id: intervention.id, repetition: i, arm, phase: 'restore-before-arm' };
              await intervention.restore(saved);
              context.phase = 'apply';
              await intervention.apply(arm, saved);
              if (!await measure(intervention.id, i, arm, intervention, saved)) return;
            }
          }
        } catch (error) {
          record(error);
        } finally {
          await cleanup('restore', () => intervention.restore(saved));
          await cleanup('verify-restoration', () => {
            if (!intervention.matches('A', saved, intervention.observe())) throw new Error(`${intervention.id}: restoration failed`);
          });
        }
        if (failures.length) return;
      }
    };
    try {
      await execute();
    } catch (error) {
      record(error);
    } finally {
      if (root && rootVisible !== undefined) {
        await cleanup('restore-root', () => { root.visible = rootVisible; });
        await cleanup('verify-root-restoration', () => {
          if (root.visible !== rootVisible) throw new Error('Root visibility restoration failed');
        });
      }
    }
    const describe = f => `${f.id} repetition=${f.repetition} arm=${f.arm} phase=${f.phase}: ${f.error}`;
    await cleanup('receipt-write', () => {
      receipt.failures = failures;
      receipt.errors.push(...failures.map(describe));
    });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, failures.map(describe).join('\n'));
    return receipt;
  } finally {
    active.delete(review);
  }
}

export const passTimerPlan = Object.freeze({
  status: 'pending',
  interface: 'runExclusivePassProfile({ acquireFrameQueryLease, stages, drain, restore })',
  requirements: [
    'Lease must reject active review.perf, full-frame queries, or another profile; release in finally.',
    'One TIME_ELAPSED query at a time; never wrap review.perf or nest composer and atmosphere stage queries.',
    'Separate march, resolve, composite runs; asynchronous drain exports issued/completed/pending/disjoint/lost counts and raw samples.',
    'Restore renderer.info.autoReset, pass hooks, render targets and query state in finally; record call/triangle deltas.',
  ],
});
