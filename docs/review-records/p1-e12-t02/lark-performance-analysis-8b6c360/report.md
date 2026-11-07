# Lark performance source review

Verdict: attribution inconclusive; no performance fix is logically demonstrated. This is source/metadata preparation, not runtime qualification. No capture, build, Blender, GPU work, repository edits, or asset writes were performed.

## Verified packet evidence

Packet: /private/tmp/lark-visual-packet-8b6c360-la4haroc. INDEX hash verification of TIMING and all three indexed perf files is recorded in evidence.json. Identity pins revision 8b6c3604bb842019c899956a1b57d6a01385d6f3, GLB SHA256 659b084f2664b9f79d406a4c5abf2a425ba9e4dc2d1c533de467fecde6ba8836. Hardware device string explicitly was not collected. Native first startup failed for missing private tsconfig; subsequent attempt succeeded. This does not establish a clean reproducible build environment.

All nine records report empty errors, zero disjoint events, timer queries through Metal, 1920x1080, and reliable paired estimates. Reliable concerns precision of the paired asset difference, not scene budget, hardware suitability, or causal attribution. Ground shown medians are 23.050–27.464 ms; hidden medians 21.444–26.403 ms. Space shown is 3.843–4.141 ms; hidden 2.749–2.764 ms. Asset paired differences are 1.083–1.361 ms across these different configurations (not repeat-run spread). Removing the asset entirely in these recorded scenes already failed the 16.67 ms target. Optimizing only its measured incremental cost cannot establish scene compliance.

Base noon: shown 682 calls/3,621,771 triangles, hidden 670/3,514,717. Base night: 1310/3,955,106 versus 1298/3,848,052. Space: 44/155,659 versus 32/48,605. These are renderer counters, not hardware workload attribution. Variants' noon hidden baseline differs by several ms; do not interpret variant total-time differences as asset regressions. Husk noon used 240 pairs; other rows 120. ABBA blocks within one capture are not five independent runs.

## Exact source controls and hypotheses

- packages/client/src/dev/review.js:1189–1345: gpuTimer, sync, warmUp, sampleInterleaved, perf. GPU query surrounds frameOnce, while CPU timer covers JavaScript/WebGL submission. readPixels synchronization drains before and after frames. Fallback is CPU+GPU wall time, not equivalent GPU timing. Results can lose unresolved queries after the bounded drain. Preserve null/disjoint counts and raw records in future instrumentation. warmUp stable permits an over-budget scene. Small paired uncertainty does not imply low total scene variance.
- review.js:1103–1139: hold disables normal loop and Engine.adapt, sets maxPixelRatio, pins clocks; frameOnce still invokes realFrame. Cloud temporal jitter/history continues despite pinned game time. Review mode suppresses fauna, parked ship and tool (1047 onward); flora footprint/camera exclusions are applied at rebuild. Hidden baseline only hides review.root; it retains the review-specific world/exclusion setup. It is not an ordinary empty gameplay scene.
- packages/client/src/core/Engine.js:239–257: half-float render target, four MSAA samples, RenderPass → AtmospherePass → FxPass → ViewModelPass → UnrealBloomPass → GradePass. 299–303 resets counters and renders composer. Resolution controlled by resize (280 onward), with adaptive resolution normally at 260 onward. Hypothesis: pixel/sample bandwidth or fragment shading cost. Test coordinated renderer AND composer dimensions, with camera/frustum fixed. Pixel reduction alone cannot distinguish these causes.
- packages/client/src/render/AtmospherePass.js:502–553: cloud march has up to 72 iterations and nested light samples. 1008–1042: when marchPlanet >= 0, half-resolution cloud march plus temporal resolve precede full-screen composite; otherwise history invalidates. Hypothesis: atmosphere/cloud work contributes ground/space difference. Record marchPlanet and per-stage GPU times; confirm branch actually executes in each case before attribution.
- packages/client/src/terrain/PlanetTerrain.js, render/terrainMaterial.js, Game.js:1440 and flora group: world terrain/flora contribute geometry and shaded pixels absent in open space. Hypothesis: geometry processing, world material shading, or foliage overdraw. High calls alone proves none of these. Isolate flora visibility, then terrain material simplification in a disposable diagnostic copy; preserve camera and streamed chunk inventory. Terrain hiding changes depth and atmosphere integration, so it is a coupled intervention, not direct subtraction of terrain cost.
- Engine.js:224–225 enables PCFSoft shadows. Only test shadows after confirming active casting lights/receivers and actual shadow draws; enabled flag alone is not evidence of a costly shadow pass.

## Next admitted runtime: experiments and instrumentation

First record exact runtime/source and asset hashes, OS, GPU device/driver/ANGLE backend, browser/native build, power mode, display/DPR, drawing-buffer and composer sizes, host load and competing workloads, thermal/power state if available. Current host telemetry cannot recover capture-time contention. Freeze seed, case, camera, LOD, time, chunk/plant inventory and quality. Warm compilation, streaming and cloud history. Require no errors, completed samples, no disjoint, and matching work counts. Run five independent alternating A/B repetitions per intervention; report medians and ranges of repetitions, p95 frame times and paired CIs. Restore baseline between interventions. Profile separately from acceptance runs.

Ordered matrix (one factor at a time):
1. Reproduce unmodified baseline for all three cases; default then damaged/husk, without ranking variants from the old packet.
2. Baseline vs 75% drawing-buffer width/height, resizing renderer and composer together. Pixel-sensitive reduction narrows the search to fragment/sample/full-screen costs; it does not name a pass.
3. Instrument composer passes individually with non-overlapping GPU queries. Do not nest TIME_ELAPSED queries inside sampleInterleaved's full-frame query: use a separate diagnostic mode. Within atmosphere separately query march, resolve and composite. Read results asynchronously; record pending/disjoint/lost counts. Record per-pass call/triangle deltas with renderer.info.autoReset disabled for the diagnostic run, then restore it.
4. Baseline vs bloomPass.enabled=false, then restore. Baseline vs atmoPass.enabled=false only as a coarse intervention; missing depth/atmosphere and temporal history change appearance, so compare actual per-stage timings before proposing quality changes.
5. Baseline vs game.flora.group.visible=false, restore; separately inspect terrain material cost and chunk LOD in disposable code. Capture visibility/work counters to detect no-op interventions or update code restoring visibility.
6. Four versus zero MSAA samples in BOTH composer render targets, with explicit recreation/recompile/warmup in disposable setup. Do not mutate only one ping-pong target or compare cold against warm.
7. Asset LOD0/LOD2 at fixed distance, then asset material simplification in a diagnostic clone. This diagnoses the incremental asset expense; it cannot by itself cure the over-budget hidden scene.

Minimum instrumentation patch proposal (not implemented): add optional raw sample export to review.perf and separate diagnostic pass timer wrapper at Engine.render/AtmospherePass.render; include viewport/composer dimensions, active pass list, marchPlanet, sample count and host identity in receipts. No shipping quality reduction is justified yet.

## Runnable commands for the next authorized session

These are browser-console commands on an already admitted review page with the pinned Lark candidate loaded, not a command to launch capture now. Use the project's native review entrypoint; do not substitute a different backend. They reuse existing API and restore toggles:

```js
await window.review.ready;
window.review.hold();
window.review.overlay(false);
window.review.lod(0);
JSON.stringify(await window.review.perf({pairs:120,maxPairs:720}), null, 2);
```

Coarse bloom A/B (repeat five times, save every JSON with case, pin and run ordinal):

```js
const rv = window.review;
const ep = rv.game.engine.bloomPass;
const saved = ep.enabled;
const results = [];
try {
  for (let i=0;i<5;i++) {
    for (const enabled of (i%2 ? [false,true] : [true,false])) {
      ep.enabled=enabled;
      results.push({run:i,enabled,result:await rv.perf({pairs:120,maxPairs:720})});
    }
  }
} finally { ep.enabled=saved; }
JSON.stringify(results,null,2);
```

Use case selection controls already provided by review scene; record case from each perf result rather than assuming navigation succeeded. Repeat acceptance measurements with instrumentation removed. These commands were inspected against source, not executed.

## Geometry audit integration and proxy limits

Preserved older scratch: /private/tmp/lark-geometry-source-audit-20261107-r5/{glb-metrics.json,construction-prediction.json,localize.json,localize.mjs}. Cancelled child activity reviewed; cancellation was reassignment, not a finding. Its GLB source was the separate t3-144aa640 checkpoint, not necessarily the timing packet or current author candidate. Do not carry its numerical conclusions onto a new candidate without exact hash matching.

Independent inspection of localize.mjs confirms its cracksM measure is nearest component VERTEX distance. This does not equal minimum surface separation or screen-visible opening: edges can approach between vertices, and a frame can cover the interval. Its six-pane records are useful component hypotheses, not a failed exposure test. Earlier activity explicitly corrected a Blender/glTF axis classification error; do not reuse older region labels. construction-prediction.json itself says generator prediction differs from saved mesh, so procedural source dimensions are not current geometry proof.

Candidate review must resolve primitive material indices, not names (multiple Glass materials can exist), node/world transforms, normalized accessor decoding, triangle winding and the tangent frame. Flat normal/face agreement plus a sharp clearcoat is a plausible facet mechanism; normal maps, environment, coverage and viewing direction still determine the rendered result. UV/tangent discontinuities can be legitimate seams; normal-vs-face disagreement can be intentional smooth shading. Neither statistic independently demonstrates a defect.

Material surface area, triangle counts, material names and husk-removal ratios measure construction, not visible exposure. Hidden backfaces/interior faces can dominate area. AABB overlap or proximity cannot prove frame coverage. Frame-to-glass nearest distance can describe intentional trim offset. Require exact candidate pin and projected material-ID/depth masks from specified front/side/top cameras at actual LOD distances, with occlusion and front-facing tests; distinguish visible frame, bare hull, husk and glazing pixels. A material-ID mask still does not establish finished shading/readability. Verify final lit images independently after runtime admission. No geometry or material fix is recommended solely from these proxies.
