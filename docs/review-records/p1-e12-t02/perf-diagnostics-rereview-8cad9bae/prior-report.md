# SEALED — REVISE

Independent, read-only review of bounded diagnostic preparation at **2a0c740fbc4d0b900451ba0d506575868590c83a** in `/Users/andreyyurlov/.t3/worktrees/space/t3-92cb10ba`.

This verdict concerns the preparation module, tests and recipe only. **Performance is not approved; no bottleneck, causal improvement, runtime admission, GPU correctness or scene-budget compliance is established.** The original source report's conclusion remains unchanged: hidden ground scenes are over budget and the bottleneck is unproven.

Three reproducible issues require revision. The five supplied tests pass; the separate 13-case adversarial suite has nine passes and four expected-contract failures covering these three issues. Test assertions deliberately require the intended behavior rather than asserting that the bugs exist.

## R1 — P2: restoration failure erases the original measurement failure

**Source:** `packages/tools/src/diagnostics/review-performance/index.mjs:101–108`; measurement failure originates through `:80–86`. README `:30–33` promises to preserve the receipt when perf or an intervention throws.

When `review.perf()` rejects and the awaited final `intervention.restore(saved)` also rejects, the second exception replaces the first before the outer catch can record it. The rejected measurement row has no `raw` or failure field; `receipt.errors` and the thrown error contain only the restoration failure. The same masking occurs when final restoration returns but its verification fails. The receipt therefore loses the original cause precisely when failure diagnosis matters most.

**Concrete reproduction:** `adversarial.test.mjs:44`. Under B, fake perf yields and rejects with `original GPU submission failure`. Final restore yields, restores the boolean, then rejects with `restoration failure`. Observed `receipt.errors` is only `["Error: restoration failure"]`; the assertion that the original cause survives fails. This uses asynchronous callbacks, with no browser or GPU.

**Required change:** retain the primary error before cleanup and preserve cleanup failures alongside it, with intervention/repetition/arm and phase. Continue attempting control/root restoration and releasing the active guard. An aggregate error or distinct receipt entries are both viable, provided the serializable receipt retains both causes. Add a dual-failure regression case; the existing single-perf-failure test does not cover it.

## R2 — P2: setup errors permanently retain the active-matrix guard

**Source:** `packages/tools/src/diagnostics/review-performance/index.mjs:70–72`; the protected block begins only at `:89`, and guard release is at `:111`.

The review is added to `active` before reading root state and cloning/assigning configuration. An exception in this preamble bypasses both receipt error recording and the guard's finally. No matrix is actually running, but all subsequent calls using the same review and imported module reject as already active. Correcting the inputs does not recover that session.

**Concrete reproductions:** `adversarial.test.mjs:59` passes a frozen receipt; its configuration assignment rejects, then a retry with an ordinary fresh receipt fails with `Diagnostic matrix already active`. The independent case at `:66` passes a noncloneable host observation, gets `DataCloneError`, then retries with the default host and gets the same false concurrency rejection. Both tests fail at the recovery assertion. Invalid initial input may be rejected; it must not leave a stale lock.

**Required change:** validate/clone caller inputs before acquiring the guard, or enter the outer try/finally immediately after acquisition so every post-acquisition exit releases it. Exercise both setup rejection and successful retry.

## R3 — P2: the available atmosphere branch is captured as an uncloneable function

**Source:** `packages/tools/src/diagnostics/review-performance/index.mjs:30` and cloning at `:3–4`. Owning runtime API: `packages/client/src/render/AtmospherePass.js:993–1005`; its render branch at `:1012–1014`.

`capture()` reads `engine.atmoPass?.marchPlanet` as a value. In the pinned runtime this is a method returning the selected planet index or `-1`, not a numeric property. Cloning the method throws, which `read()` turns into an unknown result. Consequently this evidence field is always unavailable for the real exposed API, even though its numeric value is obtainable. This is an adapter defect, not missing hardware evidence, and prevents the intended cloud-branch observation.

**Concrete reproduction:** `adversarial.test.mjs:72` supplies the real method shape. For `marchPlanet() { return -1; }`, capture returns `{status:"unknown", reason:"DataCloneError: ... could not be cloned."}` instead of `-1`. Source inspection confirms the same method shape in the actual pass. The first assertion fails; no renderer was instantiated.

**Required change:** record a numeric observation from the owning API. If invoking the selector, preserve its `this` binding and label it as current selection, not proof that the pass executed. If recording `uniforms.uMarchPlanet.value`, distinguish last-render state and disabled/stale passes. Before/after observations still do not establish execution on every measured frame. Cover both no-planet (`-1`) and selected-planet cases.

## Behavior verified within the fake-runtime boundary

- The supplied five tests pass. A separate test verifies default execution is five baseline calls followed by ten intervention calls in AB/BA alternating repetitions, including an initially false control.
- An asynchronous measurement rejection restores initial root visibility and the boolean control, retains its error when cleanup succeeds, and releases the guard so a new matrix can run.
- An asynchronous apply rejection restores a partially mutated control. An asynchronous restore rejection is surfaced and still allows root restoration and guard release. Restoration success cannot be guaranteed when an adapter itself fails.
- Concurrent matrices on the same review are rejected while a run is actually pending, and ordinary successful completion releases the guard.
- No-op application and persistent runtime reversal of the observed boolean are rejected. Silent failure of final restoration is detected. These observations do not prove that a boolean remained effective on every frame or changed any rendered work.
- Supported captured counter data is detached. Missing host/device fields are explicit unknowns. Valid-looking aggregate timings remain `aggregate-only`, pending/lost/raw/runtime-error evidence remains unknown, `performanceFixed` remains false, and attribution remains unproven.

## Baseline identity, comparability and evidence limits

`capture()` (`index.mjs:15–33`) records case/LOD, caller-supplied host identities, viewport, composer targets, pass flags, counters and shadows. The raw perf result preserves case/LOD/viewport, settle summary, asset statistics and timing aggregates (`packages/client/src/dev/review.js:1328–1339`). The host revision/hash/build are declarations, not independently checked runtime identities. No in-module gate requires populated identities or confirms their match to the loaded candidate.

The recipe explicitly places fixed seed/camera/time/inventory/quality and comparison checks on the operator (README `:10–11`, `:37`, `:40`). This is a limitation, not an additional blocker for the stated preparation-only scope. The runner never compares before/after or cross-row configurations; it checks only the intervention's observations. Camera/clock/inventory changes can escape its snapshots, and even captured case/viewport differences do not automatically stop or invalidate a run. The adversarial suite characterizes this omission with a fake changed camera/clock/inventory. Do not claim that successful completion certifies comparable configurations. Required external state records must accompany the receipt before any comparison is accepted; counters alone cannot identify the same chunk/plant inventory.

Hardware absence is handled conservatively: backend/vendor/renderer may be masked, device/debug information may be unavailable, and OS/driver/power/thermal/load require separately collected evidence. No actual hardware was queried in this review. The module does not establish completed query counts, raw samples, console/GL error freedom or an actual global query lease. `timingEvidence()` checks aggregate field shape/provenance and disjoint values; it is not an acceptance gate. Missing hardware and query evidence is not fabricated as zero or treated as a performance pass.

No false performance-fixed, reliable-scene or causal claim was found in the diagnostic module/README. Asset reliability in the underlying perf output concerns its paired difference; the recipe explicitly forbids treating it as scene compliance. The README correctly distinguishes repeated calls in one session from independent launches. Resolution/MSAA/material/LOD adapters and separate pass timing are explicitly pending (`README:39`, `index.mjs:116–125`); no GPU queries are created by this module. These pending items were not counted as implemented or as new review defects.

The boolean/root cleanup tested here is not proof of GPU-state cleanup after a real frame throws. The underlying `sampleInterleaved()` begins a query before `frameOnce()` and ends it afterward (`packages/client/src/dev/review.js:1261–1273`); no actual fault or query lifecycle was exercised. Existing query leases, pending/lost counts and runtime error collection remain outside this preparation.

## Reproduction and scope seal

From the reviewed checkout:

```sh
node --test packages/tools/src/diagnostics/review-performance/index.test.mjs
node --test /tmp/review-performance-2a0c740-independent-1cym8r0z/adversarial.test.mjs
```

Expected at the reviewed commit: supplied suite exit 0 (5/5 pass); adversarial suite exit 1 (9 pass, 4 fail). Failure names R1, R2 and R3 correspond to the findings above; R2 has two reproductions. Logs are `supplied.tap` and `adversarial.tap` (Node's default reporter text). The `.tap` filenames do not imply a machine-parsed TAP format.

Runtime: Node v22.23.3 on the local Mac. Each suite was bounded by a 30-second subprocess timeout and completed without timeout. Timing values in fake inputs are synthetic; test durations are not performance measurements. Only source inspection and tiny Node fake-runtime tests ran. No browser, GPU, native launch, capture, build, full suite, asset writes, push, PR or merge occurred. No fixes were applied. Both initial and final checkout status were clean; HEAD and all reviewed source hashes matched at sealing.

`review-context.json` records exact source hashes, environment, source-report hash, test counts and UTC sealing time. `SHA256SUMS` seals this report, the reproduction source, logs and context. This report is final for the pinned commit; a changed implementation requires a new review artifact.
