# SEALED — REVISE

Independent read-only rereview of **8cad9bae11740fb607aa90da221256babe92bf62** in `/Users/andreyyurlov/.t3/worktrees/space/t3-02adc2f8`.

**R2 and R3 are closed within this preparation scope. R1's original reproductions are fixed, but R1 is not fully closed: error recording can itself throw for a raw rejection value, losing serializable causes and skipping subsequent cleanup.** This is one unresolved P2 objection, demonstrated by three independent failing contract tests and confirmed in a separate run.

The intended result remains bounded opt-in configuration capture and alternating AB/BA runs with restoration and honest evidence limits. This verdict does not approve runtime admission, GPU correctness, scene-budget compliance, causal attribution or a performance fix. The supplied premise that hidden ground scenes exceed budget and the bottleneck is unproven is unchanged; no new measurements were taken. Shipping performance is not an additional requirement for this preparation review.

## Unresolved R1 — P2: formatting a raw rejection can break the error/cleanup path

**Owning source:** `packages/tools/src/diagnostics/review-performance/index.mjs:77–83`, especially `error: String(error)` at line 79; affected cleanup sequencing at lines 143–147 and 156–170. README lines 46–48 promise retained primary/cleanup causes and independently attempted cleanup steps.

A JavaScript callback may reject with a non-Error value. The failing probes use an otherwise ordinary raw error record:

```js
Object.assign(Object.create(null), { message: 'raw cleanup cause', code: 'E_RAW' })
```

This record has no string conversion. `record()` appends it to its private `errors` array and then throws `TypeError: Cannot convert object to primitive value` while constructing the failure record. `cleanup()` does not contain that secondary exception. All receipts in these three probes are ordinary writable objects; this is not the documented unwritable-receipt limitation.

Observed consequences:

1. **Async raw primary rejection plus ordinary final-restore rejection:** the raw original survives by identity in `AggregateError.errors`, but the serializable receipt substitutes the formatting TypeError for its cause. The measurement row's `failures` is empty. Its original `raw primary cause` is absent from both top-level failure text and the aggregate message. Control/root restoration and guard release still succeed.
2. **Ordinary primary rejection plus async raw final-restore rejection:** restoration mutates the control back successfully and then rejects. The separate restoration verification is never called. The raw cleanup cause is absent from the failure receipt; the formatting TypeError is misleadingly attributed to `phase=perf` rather than restore. Root restoration and guard release still succeed.
3. **Ordinary primary rejection plus raw root-setter rejection:** execution exits with only the formatting TypeError. Root verification and the final receipt-write block are skipped. `receipt.errors` is empty and `receipt.failures` is absent; the primary remains only in the measurement row, and the root failure is absent from the persistent receipt. The thrown result has neither original cause. The failing setter leaves visibility unchanged, and the guard nevertheless releases. A failed setter need not restore state; losing the causes and skipping verification/persistence is the defect.

**Expected:** recording any rejection must itself be nonthrowing. Retain original rejection values in the thrown result, retain safely formatted causes and phase context in the writable receipt, and attempt the remaining cleanup/persistence steps even when a value cannot be coerced to a string. A safe fallback is acceptable for an opaque value; an available plain string `message` can retain useful detail. No expansion to real GPU cleanup or runtime acceptance is required to address this finding.

**Reproduce the three failing contract tests:**

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node \
  --test --test-reporter=tap '--test-name-pattern=R1 raw' \
  /tmp/review-performance-8cad9bae-independent-YzSq0S/independent.test.mjs
```

Observed: exit 1; 3 tests, 0 pass, 3 fail. The tests are at `independent.test.mjs:166`, `:178`, and `:192`. `r1-confirmation.tap` records the second run. `raw-errors-repro.mjs` prints the actual errors, phases, cleanup attempts and retry outcomes; `raw-errors-repro.jsonl` contains its output. Its exit 0 means that the observation script completed, not that the contract passed.

## Closure and behavior verified

- **R1 original Error-based paths:** the original dual-failure reproduction passes. Primary perf/apply errors survive rejecting or ineffective restoration with intervention, repetition, arm and phase. Failed post-capture/readback, restoration verification and root cleanup retain their causes in the covered ordinary-error paths. Async falsy perf rejections (`undefined`, `null`, `false`, `0`, `NaN`, empty string), both alone and paired with falsy cleanup rejection, remain rejected and retain the original values. Raw strings, ordinary objects, symbols and bigint apply rejections preserve identity and phase. An ordinary object is described as `[object Object]`; arbitrary object fields are not claimed to be serialized. The null-prototype cases above remain unresolved.
- **Cleanup mutation:** a final restore that changes and rethrows the same Error object keeps the earlier primary string snapshot and the later cleanup string snapshot, plus original object identities in the aggregate. Async restoration that mutates the control and then rejects still receives independent verification for normal Error values. A root setter that mutates then throws a falsy value is likewise verified. Freezing the receipt's errors array during cleanup retains the primary and receipt-write failure in the thrown aggregate; receipt-write limitations are documented.
- **R2 closed:** the active-guard `try/finally` begins immediately after acquisition (lines 71–72, 172–174). Frozen receipt, noncloneable host/perf options, throwing initial root access, and falsy setup failures all release it. Corrected retries on the same review object succeed, including after the three raw-error reproductions. Genuine concurrent runs remain rejected while a run is pending. This guard covers matrices using this module instance, not all query producers.
- **R3 closed:** line 30 invokes `atmoPass.marchPlanet()` with its receiver. Independent observations return `-1`, `0` and a selected positive index correctly; a disabled pass and stale uniform do not replace the current selection. `marchPlanetEvidence` still says current selection and pass execution unproven. Missing engine/pass yields unavailable evidence; a present throwing selector records its error reason, and a missing method on a present pass records the method-shape error. These adapter errors must not be interpreted as hardware unavailability or successful evidence capture. No live renderer was instantiated.
- **Normal flow:** the independent default run with two interventions performs five baseline calls and ten alternating AB/BA calls per intervention (25 total), awaits async apply/restore callbacks, preserves initially true and false controls, restores the original root visibility, and leaves detached raw observations/options. Baseline and intervention order, no-op rejection and runtime-reversal detection pass. Valid-looking synthetic timing remains aggregate-only, `performanceFixed=false`, and attribution unproven. No normal-flow regression was found in these bounded fake-runtime tests.

## Node 22 verification

Every command used the known local binary `/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node`, reporting **v22.23.3** on this Mac. Repository `package.json` requires Node >=22; CI selects Node 22. The author supplied Node 26 results were treated as claims and not used as proof.

| Suite | Pass | Fail | Result |
| --- | ---: | ---: | --- |
| Supplied `index.test.mjs` | 5 | 0 | exit 0 |
| Retained `adversarial.test.mjs` | 13 | 0 | exit 0 |
| Author `regressions.test.mjs` | 10 | 0 | exit 0 |
| Original prior adversarial file, import redirected only | 13 | 0 | exit 0; duplicate coverage, not 13 additional independent cases |
| Fresh `independent.test.mjs` | 25 | 3 | exit 1; the R1 cases above |
| R1-only confirmation rerun | 0 | 3 | exit 1; duplicate confirmation |

The retained adversarial source matches the original exactly after normalizing only its module import. All suites completed within their 30-second subprocess timeout, with no cancelled/skipped/todo tests. Node 22 syntax checks passed for all four repository `.mjs` files, and the scoped diff whitespace check passed. **No Node 22 compatibility issue was observed.** The new failing cases concern the module's error handling, not a missing Node API. Logs use the explicit TAP reporter; test durations and synthetic timing inputs are not performance measurements. No full suite, build, browser, GPU, native session, capture or Blender execution occurred.

## Evidence limits retained

Unavailable/masked hardware strings and absent OS/driver/power/thermal/load observations remain explicit unknowns, not zero-valued measurements. A failed selector or adapter is failed observation, not proof that its API or hardware is unavailable. The corrected selector proves a current selection only; neither snapshots nor enabled flags prove execution on every measured frame.

The module still supplies no actual global query lease, issued/completed/pending/lost query accounting, raw frame samples, console/GL error collection or verified GPU-state restoration. Pass-specific timings and resolution/MSAA/material/LOD adapters remain pending. Those limitations are not counted as newly required features.

The runner does not enforce before/after or cross-row configuration comparability. Camera/time/inventory can drift outside the captured fields; counters are not inventory identity. Source revision, asset hash and runtime build are caller declarations, not verified loaded-runtime identities. External case/seed/camera/clock/inventory/quality, identity, and timed host observations remain necessary before accepting comparisons. Repeated calls are not independent launches, aggregate timings are not query completeness, and asset reliability is not scene-budget compliance.

## Integrity and scope seal

The checkout was clean at the specified commit before and after the review. All five files in the reviewed module directory match their initial SHA256 values and the exact pinned commit's blobs. `initial-context.json` and `review-context.json` record identity, source hashes and verification results. `source-snapshot/` preserves the reviewed files without modifying the checkout. `prior-report.md`, `author-verification.json`, and `original-import-adaptation.json` preserve the supplied review context and the test-import adaptation.

`SHA256SUMS` seals this report, copied context, source snapshot, independent probes, runners and test receipts. Only unique `/tmp` artifacts were written. No source edits, PR work, push, merge, runtime admission or shipping qualification occurred. This report is final for the exact commit above; changing the implementation requires a new review.
