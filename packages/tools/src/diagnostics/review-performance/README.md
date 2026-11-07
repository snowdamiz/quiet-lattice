# Review performance attribution preparation

Opt-in browser ES module; no imports into shipping code. Source basis:
`/private/tmp/lark-performance-source-analysis-hysamapc/report.md` and `evidence.json`.
The packet's hidden ground scenes exceed 16.67 ms. Bottleneck remains unproven.
No runtime admission or performance fix is claimed by this module.

## Admission recipe (not executed)

1. Obtain runtime admission for the native review backend and exact candidate. Record source revision, asset SHA256, runtime build, case, seed, camera, LOD, game time, streamed chunk/plant inventory and quality. Record actual OS/power/thermal/load/driver observations with their collection time separately; missing host fields remain unknown. Do not infer OS from user agent. Use the project's native review entrypoint; do not substitute a browser backend.
2. Ensure exclusive ownership: no capture, other console commands, `review.perf`, pass instrumentation or pending full-frame queries. This module guards concurrent matrices only; existing review internals expose no global query lease. Keep controls/camera/streaming fixed. Await readiness, hold and select the desired case with existing controls. Compilation/streaming/cloud history must settle. Each perf call uses existing warmup; inspect its settle evidence (stability does not establish budget compliance).
3. Serve this directory as a static ES module from the admitted review origin, without changing shipping source. In a native session backed by a Vite dev server that permits this checkout, the exact import URL is shown below. If `/@fs` is unavailable, explicitly arrange a same-origin static mount and substitute that URL; do not start another backend merely to load it.

```js
await window.review.ready;
window.review.hold();
window.review.overlay(false);
window.review.lod(0);
const diag = await import('/@fs/Users/andreyyurlov/.t3/worktrees/space/t3-92cb10ba/packages/tools/src/diagnostics/review-performance/index.mjs');
const rv = window.review;
// Fill only independently verified identity/host observations before measuring.
const host = { sourceRevision: 'REPLACE', assetSha256: 'REPLACE', runtimeBuild: 'REPLACE' };
const receipt = { runs: [], errors: [] };
try {
  await diag.runMatrix({
    review: rv, host, receipt, repetitions: 5,
    perfOptions: { pairs: 120, maxPairs: 720 },
    interventions: [diag.toggle('bloom-enabled', rv.game.engine.bloomPass, 'enabled')],
  });
} finally {
  // Preserve receipt even when an intervention or perf throws.
  globalThis.reviewAttributionReceipt = receipt;
  console.log(JSON.stringify(receipt, null, 2));
}
```

4. Save the complete JSON externally per case and candidate. Run baseline reproduction first for default, damaged and husk across noon-lush, night-exotic and open-space. The runner performs five separate baseline calls then five alternating AB/BA repetitions per intervention, restoring initial controls before each arm and in finally. These are repeated calls in one session, not independent launches. Inspect the returned case and inventories; mismatches invalidate comparisons. Repeat sessions separately to measure launch variability.
5. Run coarse atmosphere and flora toggles separately only after confirming actual API/control availability (`engine.atmoPass.enabled`, `game.flora.group.visible`). They change coupled scene behavior; enabled flags alone do not prove active work or attribute costs. The generic intervention interface is `{id, save(), restore(saved), apply(arm,saved), observe(), matches(arm,saved,observed)}`. `observe` must return detached JSON-compatible effective state; matches must verify both A and B. Readbacks before/after catch no-ops and update-driven reversions, but cannot prove the state held on every frame.
6. Coordinated 75% renderer/composer dimensions, both-target MSAA recreation, terrain material and asset LOD/material experiments remain pending adapters. Each adapter must save/restore every affected value, verify effective dimensions/sample counts, preserve camera/frustum/inventory, and rewarm both arms. Do not reduce shipping quality. Pass profiling remains explicitly pending: `passTimerPlan` specifies a separate exclusive lease interface and nonoverlapping queries; this module creates no GPU queries and never wraps review.perf with one.
7. Analyze scene and withoutAsset separately, preserving median/p95, paired asset CI, disjoint fields, settle state and raw result. Aggregate-only output cannot prove complete queries: review.perf does not export raw frames, pending/lost counts, or runtime error collection. Unknowns are not zeros. Collect console/GL errors separately in the admitted harness. Do not interpret asset reliability as scene compliance. Report repetition medians/ranges only after checking consistent configs and work; this module deliberately computes no speedup or causal verdict. Repeat acceptance runs without diagnostic instrumentation.

`capture` records exposed hardware/backend strings (possibly masked), viewport, composer targets and pass settings. Inaccessible values carry explicit unknown reasons. Root visibility and intervention controls are restored; caller-owned hold/overlay/LOD choices in the recipe must be restored manually when leaving the review session.

## Local verification

`node --test packages/tools/src/diagnostics/review-performance/index.test.mjs`

Only tiny fake-runtime tests are authorized/executed for this preparation. No browser,
native, GPU, render, full-suite or shipping qualification is included.
