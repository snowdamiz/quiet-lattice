# Appendix C.2 — P1.E14.T13 category receipt and page-drain correction

TASK: P1.E14.T13, bounded SOURCE/CPU correction after native attempt3.
STATUS: DONE for this implementation unit. Whole T13 timing/budget remains INCONCLUSIVE; parent-owned independent review and any new native authorization remain outstanding. No self-review grade.

SUMMARY: The authentic native response was `{"categories":[]}`, not a malformed array. The T13 consumer incorrectly required all requested selectors to be advertised. It now retains a bounded dense own string-array listing and reports unadvertised selectors separately, while requesting the same exact four selectors and requiring the unchanged actual emitted-marker/stream/work evidence. The worker's transport disconnect now detaches its CDP session; adapter finalization retains ownership of browser/server/Vite closure, so later probe cancellation can still use the page. A six-case exact-base regression and focused malformed/cleanup controls exercise actual dispatcher and nativeMain→adapter→dispatcher bodies with inert native ports. No native capture, browser, service, codec, Blender, GPU work or real grant occurred.

## Exact provenance and scope

- Worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8`; branch `codex/task/P1-E14-T13-trace-observer`.
- Base: `dd070eb0233e242eed6ec4e62d5d7f8857d6dc21`, tree `55425ed6c5d0fed5d0b04cbec30dca2c3bd0692c`.
- Clean committed head: `54a36dc47e0429f6aeb057fa9aba4ff421f8b9c9`, tree `3b3bf250cf9a1ea4091e1cd1520f994a27ea28b7`.
- Commit: `P1.E14.T13: accept category discovery receipts and drain before browser close`.
- Exactly six files, 290 insertions / 15 deletions. No recovery needed. Full `correction.patch` and `source-hashes.json` retain base/current identities; two new files have no base blob.

FILES CHANGED / final SHA256:
- `packages/tools/src/capture/browser-work-trace.ts`: `86339ea514767fd824b7efa83887f00bff1ad593121127ad12dc225689a2613f`
- `packages/tools/src/capture/trace-observer.test.ts`: `82f1e6e530cb46c7f32209e98c5ac7cae62dc9df1671064502e02a258970b73c`
- `packages/tools/src/capture/trace_observer_packet/worker.ts`: `112fa6324d71596c01141db118c6e68a4c30c795e67337bf4032934e643f6f70`
- `packages/tools/src/capture/trace_observer_packet/worker.drain.test.ts`: `abad68374f2227d1f02b70c86f5955718ef4abbd800e21a3b1ce2aeb636305a9`
- `packages/tools/src/capture/trace_observer_packet/fixtures/native-attempt3-categories.json`: `d409cb3dd2bdfdc202cefe1d1f190238feb4f2677c2532717fd42217c3f22b1d`
- `packages/tools/src/capture/trace_observer_packet/local-binding.json`: `6c63cf528a7cf1553a1a4563b24e19e9a35d1c28a8b9b8bf8c2897d04fc46f4d`

`browser-work-trace.ts` changes only the new observer receipt, category-admission/discovery block, and the complete-packet requirement that discovery actually returned. Both old algorithms are byte-identical: the entire prefix before ObserverClock hashes `aaaef3705f0da62b15b72187f30c5cc1f6e8350f281727322906951200554f52` at both pins. `worker.ts` has exactly the one-line `disconnect: () => cdp.detach()` change. Binding JSON changes exactly prefix/output/fallback/consumption/grant; all 548 binary bindings, signed Apple identities, launch tools, expected device, controlled-load contract and false readiness are identical. Dedicated saved-category fixture and three worker-drain controls were added; existing observer tests now distinguish valid empty/partial listings from malformed/sparse replies.

## Original failed attempt — unchanged

- Parent: `/private/tmp/space-t13-parent-native-r3-tfaxf5oh`; OS exit1 after35.477066999999806s, finished2026-11-07T11:56:12.501365+00:00. Parent release2026-11-07T11:57:00.231437+00:00.
- Output: `/private/tmp/t13-observer-native-161689e0`.
- `result.json` SHA256 `f1d8cd7ce85143b49f5c52d202d39559cb734320986ab123c1cfba12b1742c6b`; packet SHA256 `62754edcdb44872b48478c4f097f770ff8c1544224f08c9866c43670ad736271`.
- Packet failure `Error: Malformed category receipt`; secondary `probe-drain: Error: page.evaluate: Target page, context or browser has been closed`. All totals zero, one failed step, summary:null. Raw category receipt exactly `{"categories":[]}`. Browser pin Chrome/156.0.8078.4, executable SHA256 c8509aee32abd6977968e9999769980b7a420dea05402d90042d9e5b41db15ef. Device records are retained; no performance conclusion follows from device admission.
- Controller primary `Refused: Capture did not exit normally`; controller secondary array empty; captureExit1. Result's literal outcome is `completed`, accepted:false, candidate:false. Parent authority remains FAILED/SPENT. PhysicalSettlement is DRAINED_ARCHIVED_AUDITED, lifecycle clean:true/drained:true, kernel_terminal coalition_absent:true/live:0. Serialized terminalPublication is durable:false/provisional:true. None is rewritten as success or used to admit a successor.
- Original phase order substantiates cleanup: host-before returned; categories returned; probe-cancel returned; transport-drain returned; probe-drain failed after whole-browser closure; callbacks-drain returned. Original worker-close reported no close failures. The correction does not erase these recorded facts.
- `originals-before.json`, `originals-final.json` authenticate24 original metadata files, including spent grant/readiness/consumption and parent facts. `packet-audit-*` extends verification to all original attempt142 records/49,076,828 bytes, parent13/19,734,488 bytes, consumed grant1/746 bytes, empty fallback. All original paths are preserved. No screenshots, namespace or historical data were deleted or overwritten.

## Premise and actual CPU boundary proof

The prior listing check conflated supported-category discovery with emission proof. The pinned local Playwright CDP schema defines Tracing.getCategories as `categories: string[]`, without a nonempty requirement. The already accepted old protocol explicitly records unreportedSelectors/listingIsEmissionProof:false and has empty-list controls. Actual attempt3 supplies the exact producer counterexample. The correction retains mandatory receipt shape/own property, dense own entries, nonempty bounded strings/noNUL, maximum4096 entries and1MiB entire raw reply. Empty or partial discovery does not authorize missing trace work: explicit requested selectors remain blink.user_timing/devtools.timeline/toplevel/v8.execute, and all actual markers, current renderer PIDs, closure, terminal/loss and complete-work constraints remain.

Before production edits, exact-base-red-2 exited1 with six expected failures: empty/partial valid listings rejected; absent-emission test stopped at discovery instead of marker validation; malformed worker reply reproduced page-closed secondary; empty worker reply never reached the next deliberately failed prepare; detach-failure control exposed whole-browser close instead of CDP detachment. Production-before-fix.patch is empty. Archived red test sources identify the precise harness version. One earlier fixture run had missing device context.alpha, so its worker results were not counted as boundary reproduction; it is retained.

GREEN: same six controls pass after correction. Final395 tests across six focused files pass, including290 observer/actual-adapter tests, three actual-nativeMain drain controls, existing worker failure/sink/disabled controls, dedicated entry, old frame-output and cloud-march lifecycle tests. New negative shapes cover null/missing/non-array/inherited field, full/partial/inherited sparse entries, undefined/null/NaN, invalid strings, array/count/byte overflow. The actual empty listing plus absent emitted markers still fails, summary remains null, and its opened stream is closed. Valid empty/partial listings complete exactly12 preparations/10frames/48dependentpasses/36preflightfences/24controlfences/6segments with0PNG/queries; off-arm commands remain zero. Worker controls retain primary malformed/prepare failures, raw unknown replies/partial work and secondary detach failure; both page cancellations occur before exactly one browser close, then server/Vite stop. Native acquisition ports are inert; page evaluate invokes the real probe callback against a CPU fixture. Physical native cleanup is not simulated as a successful real outcome.

Unchanged invariants: standard1920×1080 Thalune suit2/noon-lush scene, natural history and reference work;12preps≤7200warmups;10measuredframes;48dependentpasses;36preflightfences;24controlfences;6onsegments;0PNG/timerqueries;aggregate64MiB/250000events/1024reads. Fixed first-failure stop/no retry. Strict paired-gap rule >max(onRange,offRange)+5, same sign for all five; mixed sign/incomplete/unstable/long empty-fence controls inconclusive, stable zero neutral. No history reset, optimization, cloud suppression or16.67ms qualification.

## VERIFY

Exact argv/cwd/exits/elapsed times are in `commands.jsonl`, `commands.md`, `final-freeze-command.json` and `disabled-commands.json`. Node22.23.3 and the existing pinned Python3.14.8 were used. No install, broad full suite, art/profile/smoke/DB run. The focused run is395 tests, not a claim to rerun632+64 or490+64. Unaffected controller/metadata/T15/renderer tests are reused only at protected hashes. Each owned test worker completed normally. `retained-cpu-fixtures.json` records25 retained synthetic worker fixture roots/743,901bytes; their fake head/binary identities are not usable native grants.

- Exact-base RED2: exit1, six substantive boundary failures before production edits.
- GREEN first replay: exit0, six controls. Final focused run `focused-green-2`: exit0,395/395 in2.80s withmaxWorkers2.
- Final tools typecheck, scoped ESLint, scoped Prettier, git diff --check: exit0.
- First expanded focused run's six failures were only a test recorder assertion: the override returned a category reply without calling the fixture's original recorder. A spy on the actual boundary fixed the observation; production rejection behavior was already correct. The failed source snapshot and logs remain.
- First binding format check failed after Python JSON serialization expanded six existing stamp arrays; Prettier restored repository style, leaving exactly five binding-field substitutions. Final formatting passes.
- Initial preservation script asserted that every current dependency record still equaled the old freeze. It correctly exposed changed/added Vitest caches. The final audit records rather than conceals this drift; no dependency payload or old frozen file was replaced.
- One fresh freeze exit0 (14.220s), full verify_freeze exit0; disabled Python CLI exits2 with readiness-disabled refusal, disabled worker exits1 with same refusal, launch shell syntax exits0. All prospective grant/output/consumption/fallback/enabled-readiness paths remain absent. These expected refusal exits are not runtime qualification.

## Preservation and drift

`protected-final.json` freshly hashes515 unaffected selected source/docs records against the exact prior readiness/Git base, including all four retained helpers, T15 capture/openReview, browser-work-probe, report/classification code, renderer/Engine/Atmosphere/Review, selected runtime assets, task metadata/freezer/controller and orchestration docs. Scope excludes unrelated large historical art payloads. Old protocol-prefix comparison is exact bytes, not a textual claim.

Old frozen source/dependency inventory exactly equals attempt3's recorded complete terminal ledger:15820entries,299,356,334 inventory bytes. Its37 extra Vite cache regular files/8,099,054 bytes remain intact; no cleanup or rewrite. Current checkout dependencies:13221 old records unchanged; one Vitest results.json changes from1935 to2195bytes, and100 `.vitest-cache` files add3,931,113bytes. All changes are classified in dependency-drift-final.json, with exact old/current hashes/stamps and extra-file hashes. Fresh freeze includes this current13322-record inventory. No unverified current-dependency identity is claimed. Prior frozen attempts, source-review reports and original cloud03 FAILED/accepted:false remain untouched; no large historical traces were read.

## Fresh disabled freeze and NEXT_LAUNCH

- Frozen source: `/private/tmp/p1-e14-t13-category-mtplvy3b/frozen-54a36dc47/source`.
- Readiness: `/private/tmp/p1-e14-t13-category-mtplvy3b/frozen-54a36dc47/readiness.json`; SHA256 `3a31267458ac2604282719ed12c025f66fa93a068fc468b5d6c2c1278c4756c5`;7,949,751bytes.
- Binding SHA256 `6c63cf528a7cf1553a1a4563b24e19e9a35d1c28a8b9b8bf8c2897d04fc46f4d`; plan SHA256 `73522bd42bd66eb35e9f94fcaa6f8813c2b5738be8ee9d34553ca14c50c7abed`.
-516source records/47,600,957bytes;13322dependency records/247,567,641regular bytes;548binary records. Both readiness flags false. Full manifests reside in readiness; no extra freeze copies were made during iterations.
- Fresh identity `bwt-d72c8e6226c040d7b94c8f28cb42447c`. New absent paths: `/private/tmp/t13-observer-enabled-readiness-d72c8e62.json`, `/private/tmp/t13-observer-grant-d72c8e62.json`, `/private/tmp/t13-observer-consumed-d72c8e62`, `/private/tmp/t13-observer-native-d72c8e62`, `/private/tmp/t13-observer-fallback-d72c8e62`.
- Actual proposal: `/private/tmp/p1-e14-t13-category-mtplvy3b/NEXT_LAUNCH.sh <parent-enabled-readiness-sha256> <fresh-grant-sha256>`. The wrapper neither issues a grant nor enables readiness; hashes are deliberately not fabricated. NEXT_LAUNCH.json includes every executable/path, purpose/head/tree/readiness/plan/output/consumption identity and one-use expiry≤3600s. Fresh independent review must precede parent enablement/grant/native execution.
- Capture1009100ms/drain306100ms/terminal1315200ms; predrain evidence2s, inventory28s, publication2s and stderr2s inside the existing32s terminal reserve. Same caps: source6000files/256MiB, dependencies30000/512MiB, frozen40000/768MiB, output/profile each20000/512MiB, logs256MiB, metadata16MiB, minimumfree8GiB. The >16MiB original result was read only with an explicit32MiB offline audit cap; runtime admission cap is unchanged.
- Fresh statvfs observation: 50753531904available bytes at epoch1794053517.7882051; recheck at actual launch. These are admission ceilings and samples, never OS quota guarantees. Small CPU test fixtures stayed under256MiB; the separately requested frozen closure follows its existing768MiB cap.
- Parent must reserve GPU/quiesce our heavy CPU jobs, record reservation plus external contenders unknown-not-excluded, and satisfy15logicalcores/load≤[7.5,10,15]. Future backend/device must be observed (Metal/Apple M5 Pro expectation), with pre/post host/device observations for every step. Past device data is not a replacement.
- Physical settlement remains the existing native controller's actual UID/birth/coalition/drain/profile/TMP/archive/terminal evidence. Pending callbacks or ports-settled never prove it. Parent must observe actual launcher OSexit0 and authenticate bounded result/output hashes; disk accepted/candidate/provisional flags cannot admit a successor. All three prior grants remain spent.

DECISIONS: Discovery is advisory about advertised selectors; actual emitted trace evidence stays mandatory. CDP disconnect releases only its session; adapter finalization owns whole-browser disposal after dispatcher drain. No plan/spec/threshold changes; parent owns orchestration documents. The latest task's CPU-only limits override plan-wide native/smoke expectations.

OUT OF SCOPE FOUND: No new optimization or grant. Future trace emission, real CDP-detach/browser lifecycle, controlled native capture completion, limiter evidence and repeated unprofiled three-light16.67ms results remain unproved. Historical cloud03/offline classification and prior source PASS are not fresh performance evidence.

ARTIFACTS: this report; delivery.json; source-hashes.json/correction.patch; originals and protected/frozen/dependency manifests; authentic category fixture; exact command logs/stdout/stderr/red snapshots; verification.json; disabled NEXT_LAUNCH.json/sh and frozen readiness/source. Source-only handoff for a fresh independent parent review.

## Retained failure/refusal tails (last20lines)

### exact-base-red (exit 1)
```text
    1145|     expect(packet.failure).toContain('Missing/ambiguous segment marker…
       |                            ^
    1146|     expect(packet.summary).toBeNull();
    1147|     expect(packet.totals.segments).toBe(1);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  |@astra/tools| src/capture/trace_observer_packet/worker.drain.test.ts > drains the page before browser disposal through nativeMain, actual adapter and dispatcher: malformed
 FAIL  |@astra/tools| src/capture/trace_observer_packet/worker.drain.test.ts > drains the page before browser disposal through nativeMain, actual adapter and dispatcher: empty
 FAIL  |@astra/tools| src/capture/trace_observer_packet/worker.drain.test.ts > drains the page before browser disposal through nativeMain, actual adapter and dispatcher: detach-failure
AssertionError: expected [Function] to throw error including 'adapter failed' but got 'Missing device context alpha'

Expected: "adapter failed"
Received: "Missing device context alpha"

 ❯ src/capture/trace_observer_packet/worker.drain.test.ts:71:59


⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

```

### exact-base-red-2 (exit 1)
```text
AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ]

- Expected
+ Received

  [
-   "transport-drain: Error: SECONDARY_DETACH",
+   "probe-drain: Error: page.evaluate: Target page, context or browser has been closed",
  ]

 ❯ src/capture/trace_observer_packet/worker.drain.test.ts:76:32
     74|   expect(packet.steps[0].receipt.categories).toEqual(state.categories);
     75|   expect(packet.status).toBe('failed'); expect(packet.summary).toBeNul…
     76|   expect(packet.cleanupErrors).toEqual(mode === 'detach-failure' ? ['t…
       |                                ^
     77|   expect(state.calls.filter((x) => x === 'probe.cancel')).toHaveLength…
     78|   expect(state.calls.indexOf('cdp.detach')).toBeGreaterThan(state.call…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

```

### focused-green (exit 1)
```text
AssertionError: expected [] to deeply equal [ 'Tracing.getCategories' ]

- Expected
+ Received

- [
-   "Tracing.getCategories",
- ]
+ []

 ❯ src/capture/trace-observer.test.ts:1150:24
    1148|     expect(packet.totals.segments).toBe(0);
    1149|     expect(f.calls).toEqual([]);
    1150|     expect(methods(f)).toEqual(['Tracing.getCategories']);
       |                        ^
    1151|   });
    1152|   it.each([nativeCategoryReceipt.response, { categories: ['blink.user_…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

```

### preservation-before-freeze (exit 1)
```text
Traceback (most recent call last):
  File "/private/tmp/p1-e14-t13-category-mtplvy3b/audit.py", line 30, in <module>
    assert comparison['sameRecordedRows'];(out/('dependency-drift-'+phase+'.json')).write_text(json.dumps(comparison,indent=2)+'\n')
           ~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^
AssertionError
```

### scoped-format (exit 1)
```text
[warn] packages/tools/src/capture/trace_observer_packet/local-binding.json
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

### disabled-python (exit 2)
```text
{"accepted": false, "candidate": false, "failure": {"type": "Refused", "message": "Trace observer readiness disabled", "args": ["Trace observer readiness disabled"], "attributes": {}, "facts": null, "allocation": null, "cause": null, "context": null, "rawComplete": true}}
```

### disabled-worker (exit 1)
```text
Error: Trace observer readiness disabled
```
