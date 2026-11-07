TASK: P1.E05.T02 — fresh independent C.2/C.4 SOURCE/CPU review of revision-12, native189 prerequisite.

STATUS: DONE. VERDICT: REVISE. Two P2 findings: C2-R12-F1 terminal durability qualification and C2-R12-F2 sealed RED evidence correctness. This is an independent source/CPU verdict only. It is not native189, full189, actual OS ownership/release, visual, whole-animation, capacity, launch or merge acceptance.

SUMMARY: The new sampler correctly replaces unconditional live-cohort equality with at most three stable-cut attempts under one deadline, admits every observed member through the task-local executable observer, retains interrupted samples and refuses observed excess before retry. The retained-workload-error cleanup branch reaches archive only after the added fresh birth/member/kernel proof. All 142 supplied CPU controls pass independently. A separate actual adapter/dispatcher control shows that successful receipt persistence followed by failure of both terminal-summary sinks can still return terminalReleaseProved=true with completeObservationsPersisted=false. The final sealed RED also reports two constructor TypeErrors as if they were the original RSS failures. Earlier RED evidence and an independent test-only compatible replay reproduce the actual four premise failures.

PINS (identical before and after):
- Worktree: /Users/andreyyurlov/.t3/worktrees/space/t3-11167406
- Branch: codex/task/P1-E05-T02-thalune-reel-candidate
- HEAD: ff497e5525f8e93c71df67827446d7e426bbc20d
- Tree: 5eccd017f148fbedc6b1fc751fb16ea7fcc1c660
- Base: ddce6731b1fd465a1160d2f1e49813ff6f8c626c
- Base tree: 48da9aed7d28ed5901676496d7cc2ee0db6d7809
- Author delivery: /private/tmp/t02-rss-startup-ftkhnhew/delivery.json
- Author report SHA256: a1b8a6d6ef43685e1ecab6de86778a02e7b090b97a139b7b56b1e189bb9c3e3a
- Combined manifest SHA256: a7520126b436d4d9bf73027ec11d942d25703be8e24a68a62e0cf1d437545b47
- Readiness SHA256: 53d312273f618f040ddc4829fa6e1820895bcbab3a38b1b192dc350f8f3ac001
- Candidate index SHA256: be393382a2461152ae76058baa313e56e1a9713d246ff3c948b551d9776c6c1e
- Plan SHA256: 3586236af42894a4a36c88361db4049abb0990f86ce2327ead482552ebf8ad70
- Resource sampler SHA256: c7aaef015715712dc92149b35a55f0bdd4b58f9f8d9f3f241df2b509614ddd31
- Caller SHA256: 88bc0597e720200bf616832e6c8aa6340a05bc32210a3adfc6b9aa2fcb37ef6b
- Native adapter SHA256: 85c2d26eb82004405f4a572803110a2a5d712b1a68e0e3344e1ee5b709b9047c
- Release accounting SHA256: bf84569764d31354e6a6955b450f68a03ed6d3753ba41f36e4dfafcd10032ae8

FILES CHANGED: No reviewed source, dependency, helper, asset, original namespace, historical evidence, orchestration document, Git index/branch or software identity was changed. All review artifacts are exclusively in /private/tmp/t02-independent-c2-r12-hsKJ8v8Q. The guard rejects writes outside that directory and permits only read-only Git, ps RSS and the exact finite harmless Python pipe child for exercised code. Tests ran serially, with at most one harmless child at a time. Review-created files total well below 256 MiB; exact bytes are in delivery.json. No nested agent was used.

REVIEW INSTRUCTIONS: Read IMPLEMENTATION_PLAN.md sections 0.3, 0.9.5 and Appendix C.1–C.4, the E05.T02 task and E05.T04 boundary, the entire revision-12/REPORT.md, exact author delivery, the diff, relevant retained review dispositions and the actual native failure receipt/parent audit. No AGENTS.md was found in the inspected checkout/ancestor paths. The explicit SOURCE/CPU brief controls over general whole-game/browser verification requirements. This review does not purport to complete the animation art task.

FINDING C2-R12-F1 [P2] — Qualify terminalReleaseProved after final delivery, not before it.
Location: A/release_accounting.py:133 and :147–168, reached through the newly admitted historical-error cleanup at A/caller.py:378–405; A denotes /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate.

Reachability: actual NativeAdapter.run -> StationAdapter.run -> exact retained StationJob.wait normalization -> historical-error drain branch -> archive/private release -> NativeAdapter.run_sequence -> persist_terminal_summary. Keep per-job receipt writes successful; inject write failures only into accounting.save (proof result) and accounting.budget.write_json (packet terminal result). This represents a final I/O failure after the earlier receipt was written, with no fabricated native execution.

Reproduction: sink-boundary.py reuses the actual supplied old-observer-error fixture without altering product code or its fixture body. The original TimeoutExpired has output b'partial\xff', stderr b'error\xfe' and unknown={'retained':17}. The exact helper wait catches/normalizes it, while caller keeps the original primary. Fresh inert member/kernel/birth/registration checks pass, and the test's own archive/private namespace release finishes. Both final sinks then fail with INDEPENDENT_TERMINAL_SINK_FAILURE. The actual returned result is:
  status=HOLD
  nativeJobs=1
  terminalReleaseProved=true
  terminalDelivery.proof.status=failed
  terminalDelivery.packet.status=failed
  terminalDelivery.completeObservationsPersisted=false
  original TimeoutExpired remains primary; no validator is dispatched.
terminal-both-fail exits 1 on the intended assertion that unpersisted terminal proof cannot be ReleaseProved. Full raw receipt/result/events are in sink-both.json and the command stdout/stderr.

Cause: line 133 sets the release flag from resource/receipt audit before final delivery. delivery_failure changes status to HOLD and retains the error, but never revokes that flag. The supplied all-files tests fail receipt persistence as well, causing earlier errors to make the flag false and masking this distinct ordering. The new cleanup branch makes this concrete retained-workload-error case reach the final delivery step.

Impact: the final result overstates release qualification when the complete terminal evidence exists only in memory. HOLD still prevents native success, so this is not a claim that the validator dispatches or native admission succeeds. It violates the brief's explicit durability-before-terminalReleaseProved requirement and the report's claim about unqualified persistence.

Remedy: retain physical resource audit and terminal delivery qualification separately; final returned terminalReleaseProved must require positive resource/namespace/archive checks and a verified complete durable evidence destination. If both destinations fail, explicitly keep it false while retaining the original primary, all cleanup facts and delivery errors in memory. Add this actual adapter/dispatcher schedule with successful receipt writes, plus each one-sink fallback neighbor. The independently run proof-only-failure and packet-only-failure neighbors each retained one complete verified sink; both exit 0 with completeObservationsPersisted=true. This remedy need not change runtime budgets, helpers or historical attempts.

FINDING C2-R12-F2 [P2] — Make the sealed old-base RED call compatible and assert failure reasons.
Location: A/revision-12/rss-controls.py:60, reached by A/revision-12/red-source.py:6–13; the incorrect claim is A/revision-12/REPORT.md:77–79.

red-source.py loads the exact three old modules, then executes the current controls. real_membership unconditionally passes admit= to CohortRSS, whose old constructor has no such parameter. The retained RED-sealed.json and my fresh unmodified replay both report:
  real-birth: TypeError: CohortRSS.__init__() got an unexpected keyword argument 'admit'
  real-departure: the same TypeError
The birth case never starts its child or observes RSS. The departure case starts and reaps one harmless child, but reaches neither its intended RSS read nor the departure induced by that read. The replay and cleanup cases still fail for their intended old behavior; the new-drain-error negative still refuses. A total of four FAIL rows and exit 1 therefore do not establish four reproduced premise failures.

The earlier RED-exact.json does contain the intended birth/departure failures. I also verified the exact base bytes against Git, retained copies and baseline hashes, then ran compatible-red.py: only the test AST omits the new optional admit keyword at line 60; all three old product modules execute byte-identically. It reproduces four intended failures plus the passing refusal negative, with actual private child identity/ps reads for birth/departure and actual adapter/dispatcher/helper-wait cleanup. The expected RED exit is 1. This proves the product premise while explicitly preserving the defective supplied sealed replay.

Remedy: provide a base-compatible call/retained test version, and assert the expected old failure messages and observation/child milestones instead of counting arbitrary FAIL rows. Retain the TypeError run as a failed harness attempt and correct the report/delivery provenance. The historical new-member RSS replay stays explicitly synthetic, and does not supply executable evidence for PID 51704.

VERIFY:
- preservation-before and preservation-after: exit 0; the JSON results match exactly. Verified 1,433 combined-manifest rows; all 1,368 protected prior rows; all 50 original attempt-two baseline entries including device, inode, owner, mode, size, mtime and file hashes where recorded; 2,354 source/data bindings; 12 software identities; 42 candidate-index rows; exact base/current Git pins; clean branch; seven author delivery hashes; and all 11 prospective paths absent using lexists.
- green54: exit 0, 54/54 PASS. Actual ps/libproc harmless birth/departure/executable checks, sampled limits/excess/churn/identity/kernel/refusal/deadline controls, real NativeAdapter resource observer/run/dispatcher with inert lifecycle ports, cleanup/new-error/refusal/durability controls, and raw rss_read command-result preservation.
- retained66: exit 0, 66/66 PASS: 10 retained RSS, 12 actual adapter/dispatcher, 44 helper wait/receipt/worker/fallback/error-ordering crossings. These are the bounded focused selection only.
- admission22: exit 0, 22/22 PASS. Actual source/plan admission plus in-memory grant/allocation/free-space ports and instrumented actual missing-grant main. No operational grant, consumption or native output allocated. Exact reserve arithmetic 22,066,626,560 bytes and one-byte-short refusal are CPU fixtures, not current capacity admission.
- Independent supplied passing total: 142 = 54 + 66 + 22. Earlier 525/ACK/library results are not rerun or added to this count.
- exact-red-supplied: exit 1, nominal 4 FAIL / 1 PASS, but only two intended manifestations; birth/departure are constructor mismatches, as C2-R12-F2 explains.
- exact-red-compatible: expected exit 1, four independently checked old behavior failures and one passing refusal negative. Test-only AST compatibility change is explicit; no old source is installed or written into the checkout.
- terminal-both-fail: exit 1, C2-R12-F1 reproduced at the actual adapter/dispatcher boundary.
- terminal-proof-fail and terminal-packet-fail: exit 0 each; a complete fallback sink remains verified. Not additional members of the author's 142.
- additional-verification-v2: exit 0. Prior ACK seal: all 203 files match; prior R5 seal: all 998 files match. Current ACK encoder and diagnostic producer match those accepted source hashes. All seven distinct harmless review children have recorded exit 0, were reaped and have fresh absent identities. Review tests created no OS coalition/launch registration; fixture ownership ledgers and lifecycle ports are explicitly inert.
- git diff --check BASE HEAD: exit 0. HEAD/tree/status remain exact and clean.
- The author's three final CLI refusals remain hash-verified retained evidence, expected exit 1 each; they were not rerun separately. The 22-control suite independently exercises the actual missing-grant main with a zero-launch instrument.
- First additional-verification command: exit 1 because my reviewer script used manifest['files'] instead of the actual manifest['evidence'] schema. Original script and traceback remain. additional-verify-v2.py corrects only that schema lookup; no product/test contract changed.
- One exploratory filename search was overbroad and its tool output was truncated; it provided no correctness evidence. Focused named-file reads and explicit manifests supplied all review conclusions.

Exact absolute argv, cwd, pinned PATH, exit codes, durations and subprocess events are in commands.json and *.command.json. Complete stdout/stderr are retained per command. Selected source inspections are in inspection-command-log.json; initial read-only tool inspections also remain in the thread transcript.

FAILURE TAILS:
terminal-both-fail, exit 1:
```text
Traceback (most recent call last):
  File "/private/tmp/t02-independent-c2-r12-hsKJ8v8Q/guard.py", line 33, in <module>
    try:runpy.run_path(str(target),run_name='__main__')
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen runpy>", line 287, in run_path
  File "<frozen runpy>", line 98, in _run_module_code
  File "<frozen runpy>", line 88, in _run_code
  File "/private/tmp/t02-independent-c2-r12-hsKJ8v8Q/sink-boundary.py", line 20, in <module>
    assert not result['terminalReleaseProved'],'Unpersisted terminal proof is incorrectly ReleaseProved'
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Unpersisted terminal proof is incorrectly ReleaseProved
```

additional-verification, exit 1:
```text
Traceback (most recent call last):
  File "/private/tmp/t02-independent-c2-r12-hsKJ8v8Q/guard.py", line 33, in <module>
    try:runpy.run_path(str(target),run_name='__main__')
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen runpy>", line 287, in run_path
  File "<frozen runpy>", line 98, in _run_module_code
  File "<frozen runpy>", line 88, in _run_code
  File "/private/tmp/t02-independent-c2-r12-hsKJ8v8Q/additional-verify.py", line 13, in <module>
    data=load(manifest);rows=data if isinstance(data,list) else data['files']
                                                                ~~~~^^^^^^^^^
KeyError: 'files'
```

exact-red-supplied, exit 1:
```text
(stderr empty; structured failures and expected RED classification are retained in stdout/results.)
```

exact-red-compatible, exit 1:
```text
(stderr empty; structured failures and expected RED classification are retained in stdout/results.)
```

PRIOR FINDING DISPOSITIONS:
- Startup equality premise: FIXED at SOURCE/CPU level. Three attempts, one three-second bound or earlier enclosing alarm, original 0.2-second cadence, 8 GiB sampled aggregate bound. Birth/departure/transient counters can converge; indefinite churn, excess, missing/unknown data, duplicate/reuse/UID drift, cancellation and observer errors refuse. Interrupted intervals remain unaccepted, with raw partial facts retained. No continuous peak/OS quota claim is made.
- Sample-member executable admission: FIXED at SOURCE/CPU level. Both native and station adapters use the same task-local observer for pre/post sample members, including departures; raw path errors survive helper normalization. No historical admission for 51704 is invented.
- Historical versus new drain errors: FIXED in the physical cleanup gate, PARTIAL for final durable release qualification due to C2-R12-F1. errorsBeforeDrain retains exact old errors; new/changed errors or missing fresh member/kernel/birth proof block archive. Actual helper wait normalization is exercised. Positive final physical audit alone is insufficient when final persistence fails.
- R3-2 / historical observer primary precedence, original receipt/media masking and producer-primary loss: FIXED/PRESERVED for tested schedules. Fresh 66-control selection and the sink-only repro retain the original primary and stop after one failed attempted job. Terminal release-bit durability remains the separate open finding.
- R4-F1 / R3-1 checked entry classification and complete inventory: FIXED/PRESERVED. Explicit entry.stat(follow_symlinks=False), pending-entry facts, original exceptions, incomplete flags and checked helper ports remain source-identical; exact R5 seal verified. No suppressing rglob/is_dir path was reintroduced.
- R2-1 ancestor alias checks, R2-2 bootstrap outcome-before-persistence, R2-3 final FIFO/hash deadline, joint cache budgets and bounded packet fallback: FIXED/PRESERVED. Changed sampler definitions leave cache/FD/inventory algorithms unchanged; frozen helpers, bounded reads, admission snapshots and 30-second final inspection remain intact. Retained broad proof is hash-reused, not a fresh broad pass.
- ACK C2-F1: FIXED/PRESERVED. rgb-primary.py SHA256 b829e7fc8ddff9d12b367040b6b0df9603279d027588db075530800946bc7d96; completed local body/newline writes and returned flush, not peer receipt. Prior independent ACK report hash f400d818368d1b7176963f1e2e1290d5a626face5826253e1b1fe55407c6f0f3 and its entire 203-file seal match.
- Encoder exits/localized producer: PRESERVED, no new runtime qualification. Diagnostic producer hash 85cf0106b3f5274a65f5222626c2f6ab59b5283139abcb910b126b24d4a8364d remains exact. Exit observations and 39,354,368-byte media ceiling are unchanged.
- Same-snapshot metadata/grants, native-only source flag and reserve: PRESERVED. runtimeAuthorization=false; nativeFixtureAuthorization=true; no current grant/admission.
- Library/shared-rig/three-export/accepted body proof: PRESERVED PRIOR EVIDENCE by protected hashes, no new visual/gameplay acceptance. E05.T04 remains separate.
- Previous concrete constructor-ownership/cross-lane allegations remain previously REFUTED only within their earlier tested cases; no runtime ownership conclusion is generalized.

HISTORICAL EVIDENCE / PROTECTION:
The actual second native attempt remains FAILED/SPENT/HOLD. Parent OS exit 1 after 2.1251891670399345 seconds, zero media, no validator. The three original identities remain stable across their before/after reads: 23,429,120 + 38,354,944 + 2,670,592 = 64,454,656 bytes. Kernel counters move from started=10/exited=7/live=3 to 12/8/4 and later membership includes PID 51704. Its ownership record exists, its executable admission does not. Neither command intent nor the synthetic replay repairs that gap.

The exact helper drain record is drained=true, clean=false, errors containing the original RSS assertion, kernel absent/live0 and remaining=[]. The parent later observed seven PIDs absent and registration exit113, but original scratch/private TMP proof remains incomplete; terminalReleaseProved=false is preserved. All 50 original entries and both leftover namespaces retain their original locations and facts. No archive/removal/recovery action was performed.

The first native attempt remains FAILED/SPENT/HOLD: its 87 producer-frame count/partial 39,354,368-byte file and unproved original terminating signal are not promoted to decoded frames or a proven signal. Separate short probes remain historical only. All 1,368 protected prior-manifest rows remain exact. The historical full snapshot stays FAILED/MISMATCH with three pnpm task-state deviations (directory mtime, missing prior finished marker, changed latest.json); no marker was repaired or attribution invented. A matching current narrow preservation check does not make that historical full snapshot green.

DECISIONS:
- Stable live-cohort observations -> accept only a bounded complete stable cut -> real children legitimately start and exit; preserve and refuse uncertainty.
- Existing workload error plus fresh physical drain -> preserve primary while allowing archive -> source/CPU logic is justified, subject to fixing terminal durability qualification.
- RED failure count -> inspect reasons and real boundary observations -> TypeError is not the intended premise failure.
- Broad test/native expansion -> none -> 142 focused controls, exact hashes and two targeted schedules establish this verdict.
- No capacity workaround -> unchanged 22,066,626,560-byte reserve -> no operational grant or capacity admission.

OUT OF SCOPE FOUND:
No native/codec/ffmpeg/ffprobe, Blender, browser/GPU, service, DB, installer, pnpm, hydration, original cleanup, runtime grant, push, PR or merge ran. All11 fresh paths remain absent. Limits remain 189 opaque 1920x1080 frames at60Hz, one ACK in flight, 39,354,368 bytes per reel, 8,589,934,592-byte sampled aggregate RSS, 600-second job, 60-second cleanup, 30-second final inspection, negative190 surplus bound, 384MiB/4096-entry cache, 1GiB/archive stage, four packet copies and eleven archive slots. Actual native parent exit0, actual owned process closure, full189 validation, browser-specific ownership/cache admission, 378-motion/eight-still capture, both validators, visual grading and whole-animation acceptance remain pending. No live free-space sample is claimed as admission.

ARTIFACTS:
REPORT.md, review-result.json, delivery.json, commands.json, per-command records/stdout/stderr, before.json/after.json, additional-verification.json, guarded exact-head 54/66/22 results, supplied and explicitly compatible old-base replays, sink-boundary.py with both-failure and fallback results, inspection-command-log.json, review harness sources, artifact-hashes.json. The exclusive directory is sealed read-only after hashing. All failed commands and test-only/synthetic boundaries remain explicit.

