**SOURCE PREPARATION: REVISE — one P2 documentation/integration finding. R1, R2 and R3 are closed in the exact reviewed implementation.**

Read-only independent rereview of commit `1e293e75258b986501780713d2956a7e8cc80ec0`, tree `7ce3b00b287bda07b97b75336ed9ff399122bb4a`, in `/Users/andreyyurlov/.t3/worktrees/space/t3-15e5d4e1`. The guarded formatter and its relevant call paths pass this source-only review. The remaining finding is that the executable README recipe imports a different, known-unfixed module. This verdict does not admit a runtime or establish GPU safety, causality, scene-budget compliance or a performance improvement.

**D1 — P2: the documented import selects the unfixed reference checkout.**

Owning source: `packages/tools/src/diagnostics/review-performance/README.md:19`; explanatory claim at line 12.

The README calls the example an exact import URL for “this checkout,” but the URL is:

```js
await import('/@fs/Users/andreyyurlov/.t3/worktrees/space/t3-02adc2f8/packages/tools/src/diagnostics/review-performance/index.mjs');
```

That reference checkout is still clean at `8cad9bae11740fb607aa90da221256babe92bf62`. Its `index.mjs` SHA256 is `f1aa8537013e87d25fdb97f05fe7b859735653e35810b90074f03b6fe098f5d7`, whereas the reviewed module is `6ce1bc684d585956cc2e4cf52124b8fd7e9f979fbd66342af38f6d5a8ff31c37`. The reference still contains `error: String(error)` and lacks the guarded formatter. Thus, if this `/@fs` path is served as documented, following the recipe loads the version with R1 still open. If it is disallowed, the URL cannot load the candidate at all. No Vite/native/browser serving behavior was exercised; this is a source/path binding finding with a local fake-runtime reproduction.

To confirm the consequence without broad reruns, I copied the documented target's exact bytes to `documented-target/index.mjs`, redirected only the import of the sealed prior independent suite, and ran its single existing raw-root-cleanup contract probe. It failed:

```text
receipt failure summary missing: {"errors":[],"thrown":"TypeError: Cannot convert object to primitive value"}
```

The same case passes as part of the 28-case run against the pinned current source. `readme-binding.json` records both paths/hashes; `documented-target-r1.tap` records the old-target failure. Reproduce from this report directory:

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node \
  --test --test-reporter=tap '--test-name-pattern=R1 raw root-cleanup' \
  documented-target-r1.test.mjs
```

Required change: make the example import the exact candidate's diagnostic module (the current checkout path, or an explicit same-origin mount for the verified candidate bytes). Preserve the old reference checkout. This requires a documentation correction, not a formatter or cleanup rewrite. I made no repository changes.

**R1 — closed in the reviewed source.**

Owning source: `packages/tools/src/diagnostics/review-performance/index.mjs:4`, `:14`, `:87`, `:91`, `:114`, `:153`, `:166`, `:174`.

The only implementation change is the guarded formatter used by capture `read()` and failure `record()`. It first uses `String(error)`, then tries a string-valued `message` only when conversion throws, then uses `Unprintable rejection value`. Both conversion and message access are contained. Raw originals enter the private error list before their receipt description is computed. Original identity and occurrence order survive into single rethrows or `AggregateError.errors`; conversion/getter exceptions do not replace or join those original causes. Failure phase and arm/repetition context remain correct.

All three previously failing null-prototype cases now pass: raw perf plus ordinary restore, ordinary perf plus raw restore, and raw root setter. The 15 hostile-value tests also pass, including throwing conversion hooks/getters, invalid conversion results, empty/missing/nonstring/throwing messages, hostile proxies, revoked proxies, capture failures and receipt-access failures.

I added only three targeted independent tests (`focused.test.mjs`):

- Two use distinct hostile originals at perf, capture-after, observe-after, restoration, restoration verification, root restoration and root verification; one additionally fails receipt writing with another distinct revoked proxy. They assert exact raw identity/order and safe phase descriptions across all seven/eight failures. The writable case JSON-serializes the entire receipt; the invalid-receipt case checks the available failure list and thrown aggregate without claiming successful persistence. Remaining cleanup is attempted and same-object retry succeeds.
- One proves successful coercion takes precedence over a throwing `message` getter in both capture and setup, with no message access, and proves setup failure still releases the guard.

The first two intentionally leave both the control and root unrestored when their setters/restorers reject. They assert that actual outcome rather than treating attempted cleanup as successful restoration. Their measurement-row failures contain the measurement/after-observation causes; final control/root cleanup causes remain in the top-level receipt. All three tests pass.

Descriptions can be opaque, empty, or `[object Object]`; arbitrary object fields and formatter exceptions are not serialized or promised. The original values remain available in the throw. Frozen, invalid or otherwise unwritable receipt access may prevent persistence, and available write failures remain in the thrown result. README lines 46–50 describe these limits honestly. This is bounded callback error handling, not a sandbox against arbitrary nonterminating or globally destructive user code.

**R2 — closed, no regression.**

Owning source: `packages/tools/src/diagnostics/review-performance/index.mjs:80` and `:182`.

The active guard enters `try/finally` immediately after acquisition; setup, execute, cleanup, receipt write and aggregate creation are within that protected region. The new diff does not change this sequence. Existing probes cover frozen receipts, noncloneable host/perf options, throwing initial root access, falsy setup/save failures, concurrent exclusion and corrected retries. The new distinct-hostile and setup probes also retry the same review successfully. The guard is per module instance and review object; this does not establish global GPU query ownership.

**R3 — closed, no regression.**

Owning source: `packages/tools/src/diagnostics/review-performance/index.mjs:40`. Related implementation: `packages/client/src/render/AtmospherePass.js:993` and `:1012`.

Capture still invokes `atmoPass.marchPlanet()` with its receiver, clones its result and labels it current selection with pass execution unproven. Source inspection confirms the real selector returns the selected index or `-1`, while the render method updates the separate last-render uniform afterward. Tests verify receiver binding, `-1`, zero and positive indices, disabled passes and stale uniforms. Missing/throwing method observations remain unknown with failure reasons; hostile selector rejections now format safely. An opaque reason may lose detailed provenance, but never asserts successful capture or pass execution. No actual renderer was instantiated.

**Verification and provenance.**

All independent executions used `/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node`, version `v22.23.3`, binary SHA256 `68f4d07ca49e0500cc135c7e0a445093e228e42e126ac22306d045f0a8c2636b`.

- Prior independent suite, copied with only its import redirected to the exact source snapshot: **28/28 pass**.
- Current author suites, byte-identical copies with unchanged local imports: **5/5 index, 13/13 adversarial, 10/10 regressions, 15/15 hostile-value tests pass**.
- New focused independent suite: **3/3 pass**.
- Existing single R1 probe against the documented old target: **0/1 pass**, reproducing D1; this is duplicate old-case confirmation, not an additional independent case or a failure of current `index.mjs`.

There were no cancelled/skipped/todo tests in these invocations. Each subprocess was bounded by 30 seconds. These are test records across overlapping suites, not a claim of 74 disjoint independent behaviors. No redundant R1-only or original-adversarial rerun was counted. All five current `.mjs` files passed explicit Node 22 syntax checks; the fix diff passed whitespace checks. No fresh lint/full-suite/build claim is made. TAP durations and synthetic timing values are not performance measurements.

The 97 author manifest entries, 26 prior independent entries and five original review entries matched their seals at both initial and final verification. Author `verification.json`, `commands.txt`, `fix.diff`, provenance and seals were inspected/copied. Fourteen sealed RED/GREEN author TAP summaries match the claimed counts, including independent 25/28→28/28, hostile 0/15→15/15 and R1-only 0/3→3/3; these are author historical receipts, distinct from my fresh runs. The author's current independent probe differs from the original only in its import URL.

All six current diagnostic files match the pinned Git blobs, author source-after snapshots and author SHA256 values. `fix.diff` exactly matches `git diff HEAD^ HEAD` for the owned directory; the commit changes only README, the formatter/call sites and the new hostile tests. Recovery `274f743128d46c69b95bceda58ac27dec4303582` has the same diagnostic-directory tree as `f4556abc5dca002569b367475dd61084738ebfd8`; `f4aaee716205c412dddcf8aacd9a5b4076a4de31` has the same diagnostic-directory tree as `8cad9bae11740fb607aa90da221256babe92bf62`. Both the candidate and reference checkout remain clean. Related selector/perf source excerpts were checked against the pinned blobs and hashed.

**Remaining gate and next prerequisite.**

After correcting D1, the next prerequisite already required by README lines 10–12 is explicit runtime admission for the native review backend and exact candidate, verified loaded source/asset/build identity, and exclusive idle review/query ownership before importing the verified module from that admitted origin. Establish the documented fixed case/seed/camera/clock/LOD/inventory/quality and timed host observations, readiness and settling. Subsequent measurements must preserve scene/withoutAsset results, configuration comparability and external console/GL errors; aggregate-only output still lacks raw-frame and pending/lost-query evidence. This review adds no acceptance thresholds and grants no runtime admission.

Pass timers and resolution/MSAA/material/LOD adapters remain pending preparation work, as already documented; they are not conditions imposed by this review. No browser, native/GPU session, Blender, render/export, full suite, child agent, push, PR, merge or Trunk action occurred. Only this new `/private/tmp` directory was written. `SHA256SUMS` seals this report, source hashes/snapshots, input copies, probes, scripts and receipts; artifact files are made read-only after sealing.
