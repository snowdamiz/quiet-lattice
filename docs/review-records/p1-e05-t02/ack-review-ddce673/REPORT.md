TASK: P1.E05.T02 — fresh independent SOURCE/CPU C2 review of revision-11 ACK accounting, Appendix C.2/C.4.

STATUS: DONE. **VERDICT: PASS — scoped source/CPU correction only.** C2-F1 is fixed. No blocking source finding remains in this delta. This does not authorize a launch or qualify native189, actual Thalune reels, visual acceptance, the whole animation task, merge, or deployment.

SUMMARY: The corrected encoder separates completed encoder write/flush operations from completed local ACK emissions. The exact prior actual-pixel reproducer fails against the pinned base with reported ACKs 1 / producer receipts 0, and passes against the candidate with 0 / 0. Thirty-three additional independent controls exercise the actual producer.encode → DiagnosticStream → shared encoder protocol, including partial writes, flush failure, interruption, successful transport, and actual caller adapters/dispatcher with inert native lifecycle ports. Original errors remain primary and failed jobs never dispatch the validator. Source, dependencies, ignored inventory, retained evidence and Git state match before/after.

PINS:

- Checkout: `/Users/andreyyurlov/.t3/worktrees/space/t3-11167406`.
- Branch: `codex/task/P1-E05-T02-thalune-reel-candidate`.
- HEAD: `ddce6731b1fd465a1160d2f1e49813ff6f8c626c`.
- Tree: `48da9aed7d28ed5901676496d7cc2ee0db6d7809`.
- Base: `3503cd7d5187b78140bc22fbb5e418ee9f2c6798`; tree `be67aeb7817b1af3b89a7a2a2c2093e6244c8b73`.
- Readiness SHA256: `b751c99b5342108441cb3fad8ebc463d21bbfd1def4756674b5ff9f4c0abfdfb`.
- Current encoder SHA256: `b829e7fc8ddff9d12b367040b6b0df9603279d027588db075530800946bc7d96`.
- Base encoder SHA256: `cb2e4045407d2115b174a567a207047de99d21fe0c113c49edeea1f192b4ded5`.
- Producer SHA256: `85cf0106b3f5274a65f5222626c2f6ab59b5283139abcb910b126b24d4a8364d`.
- Native plan SHA256: `ad5445e31e82ff4072026b39d77a713ede6a3ba56c80223ace65b5f06c92be3a`.
- Author report SHA256: `eb69c698e8e346df1f8e078f08c605d2ee84367961d204e3cc1ccb165ba1687d`.
- Prior independent REVISE report SHA256: `17dfaa2c670a5d4326fe803826ba602919ab97f44affaa8adea8f2e1b0d84240`.
- Additional input, implementation-plan, delivery and reproducer digests: `input-pins.json`, `reproducer-pins.json`, `red-replay-binding.json`.

FILES CHANGED: No checkout/source/helper/asset/dependency/cache/protected-evidence file was changed. All new review artifacts are below `/private/tmp/t02-ack-c2-independent-dg3xfe2f`. The candidate delta is 119 files: four existing files (encoder and three metadata files), plus revision-11 evidence. Twenty-three other root Python modules, native189-plan.json and rgb-sink.mjs match base bytes. All encoder functions other than encode are AST-identical. Readiness changes only the encoder binding. No asset, toolchain, historical evidence or budget change is hidden in this correction.

C2-F1 DISPOSITION: **FIXED**, rgb-primary.py:82–122. `seen` remains the duplicate work-ID guard and the legacy encoder-work count. After encoder stdin write and flush return, framesWrittenToEncoder advances. A separate ACK attempt starts unconfirmed, retaining work ID, ordinal and current phase. Body and newline writes must return exact integer lengths (None, booleans and short returns are rejected); only a returned flush advances framesAcknowledged. Poll/wait observations copy these independent counters. No exception path retries ACKs or dispatches another frame.

COUNT SEMANTICS:

`framesAcknowledged` proves **completed local ACK emission: full JSON body write, full newline write, and returned flush**. It does not prove producer receipt, parsing, acceptance, or subsequent work. The terminal record states this in acknowledgmentBasis. `ackDelivery.status=unconfirmed` means the failed attempt may or may not have reached the peer; it is not proof of nondelivery. `framesWrittenToEncoder` records the completed blocking stdin write/flush boundary, not decoded frames or durable media.

This distinction was tested in both directions. On flush failure and after-newline exception, DiagnosticStream has received the ACK and advances to the next ordinal while framesAcknowledged remains at the preceding completed emission count. Conversely, the emitted-unseen control accepts a complete local ACK into an inert local sink without forwarding it: emission count is 1, producer receipt count is 0, and the actual producer refuses the next read while its frame is pending. Thus neither unconfirmed delivery nor completed local emission is promoted to receipt evidence. Successful actual native189 DiagnosticStream additionally knows its own receipt count; that is a separate observation.

VERIFY:

- **Exact RED**, child exit 1: byte-identical prior ack-count-regression.py, actual 1920×1080 localized DiagnosticStream and actual PNG/alpha/RGB/RGBA conversion, exact base encoder module with unchanged current dependencies, inert Popen/rlimit. One 6,220,800-byte encoder write/flush completes. First ACK write throws the original BrokenPipeError. Producer remains at ordinal 0; old failure-poll reports 1. Encoder -25 remains retained and accepted=false. This is an intentional regression assertion, not a fresh pass.
- **Exact GREEN**, child exit 0: same reproducer bytes and protocol, current encoder. Reported ACKs 0 / producer receipts 0, completed encoder writes 1, same original error identity and observed -25. No next frame, final wait or validator.
- **Independent boundary suite: 33 PASS**, child exit 0. Three first/newline/flush failures use real full-size pixels through producer.encode. Six more exercise those failures at ordinals 1 and 188. Other cases cover prefix side effects before an exception; body/newline exceptions after delivery; short/None/boolean returns; encoder partial-side-effect then write exception; encoder flush failure; KeyboardInterrupt; InterruptedError; actual one-shot SIGALRM through the retained deadline body; original ACK error plus failed poll and result/stderr sinks; and local emission without peer receipt. No active alarm remains after any case.
- Two success cases use the actual full 189-frame producer protocol with small-image pixel ports, including a source limited to three bytes per read. They preserve work IDs, order, exactly 189 ACKs, single pending frame, all frame-map rows, PTS 0..188000 in increments of 1000, timebase 1/60000 and the opaque-alpha contract. These are CPU transport controls, not 189 full-size images or codec evidence.
- One further actual full-size frame-188 control checks producer RGB/RGBA/source-PNG hashes through current pixels(), then rejects alpha 254. Successful ACK payload/schema and framing remain unchanged in the source diff. RGB/RGBA decoder hash, decoded-order/PTS/count and ffprobe checks are unchanged AST; no decoder/probe was run.
- Four caller cases use the actual NativeAdapter/StationAdapter/run_sequence and retained helper deadline bodies with inert StationJob/process/allocation ports. They carry the actual captured ACK error, including raw bytes, unknown fields, unconfirmed count and failed observer, through normal persistence, packet fallback, all files failing and both streams failing. Each records one attempted job, HOLD, original BrokenPipeError as primary, and no validator. These tests do not assert actual OS ownership, process exit or native release.
- Fresh passing total is **34 = 1 exact GREEN + 33 independent boundary controls**. The one exact RED is separate. The author's 94 controls and three expected CLI refusals are hash-verified retained results, not rerun or added to 34. Earlier 183/525 corpora and prior reviewer 80/12 results are retained evidence, not fresh successes or additive independent counts. No broad suite was repeated.
- Source/provenance audit exits 0: 2,354 source/data bindings, 12 software identities, 42 candidate rows, 1,375 manifest rows, 1,302 audit rows and 1,256 protected prior-manifest rows match. All 97 revision-11 and 49 revision-10 original/retained evidence pairs match, including raw/hex representations; two external media hashes match. Revision-08's 195 originals and eight external sources match. Current source admission verification, plan validation and 386-item structure verification pass without grant consumption or allocation. Git whitespace check passes.
- Prior independent seals verify exactly: C2 266 files, activation 83 files, R5 998 files. Original REVISE report remains unchanged. Unchanged source and exact artifact hashes support reuse; older full-producer claims are not promoted to current full-native success.
- Before/after snapshots match across **33,079 entries**, including the complete no-follow checkout/dependency/ignored inventory, Git index, software identities, prior reports, author scratch, original spent outputs and retained external evidence. The 31,264 protected prior snapshot entries outside the four candidate changes match; all 50 original run/parent/grant/consumption entries match metadata/hashes. HEAD/tree/branch/status/index flags and ignored inventory match exactly. Checkout remains clean. All 11 prospective paths remain absent, including dangling-symlink checks.

The RED replay's byte-identical prior script hashes the physical current encoder path in its `sourceSha256` field. That field is not the loaded RED module identity: red/replay.py explicitly compiles red/base-encoder.py from the exact base Git blob. `red-replay-binding.json` records this distinction and the actual loaded digest. The old code was not written into the checkout. GREEN's physical and loaded encoder identities coincide. No test failure was discarded or expectation changed after execution; all fresh positive commands passed on their first run.

PRIOR DISPOSITIONS:

- Prior encoder exit retention: **FIXED/PRESERVED at source level**. Existing observation recording remains intact; fresh ACK failures retain -25 when observed, and retain an unknown return code plus the raw observer exception when poll itself fails. No native exit is newly proven.
- Localized diagnostic fixture: **PRESERVED, full189 PENDING**. Producer bytes equal base. The old entropy fixture and separate short-probe evidence remain unchanged; this fixture is not a feasibility estimate for Thalune art.
- R4-F1 checked entry classification and R3-1 final inventory enumeration: **FIXED/PRESERVED by identical source and sealed prior controls**. No broad repetition or invented current ownership claim.
- R3-2 observer primary precedence, historical RSS/deadline ordering, original media/final receipt masking and combined sink failures: **FIXED/PRESERVED**. Caller/release source hashes match base; fresh caller controls retain the ACK primary and stop dispatch under sink/observer failures.
- R2-1 ancestor alias checks, R2-2 bootstrap outcome-before-persistence, R2-3 bounded final FIFO/hash admission, joint cache/leaf budgets and duplicate membership advisory: **FIXED/PRESERVED by exact source and prior sealed evidence**. No new live cache or process-ownership qualification.
- Original uncertain release/partial kernel facts: **PRESERVED**; uncertainty remains HOLD. Prior concrete partial-constructor and cross-lane-cache allegations remain **REFUTED only for their previously tested cases**, not generalized.
- Same-snapshot JSON/grant semantics and native-only activation: **PRESERVED**. Plan unchanged; example remains expired with zero HEAD; prospective grant/consumption paths absent. Source enablement is not a grant.
- Library receipts/shared-rig/three-export proof: **PRESERVED PRIOR EVIDENCE**, no new art or gameplay acceptance. E05.T04 retains gameplay integration ownership.
- Appendix C/0.9.5: no client authority, missing new-system tests, leftover replacement demo, budget regression, or unlogged spec interpretation is introduced by this delta. No style-only blocker or unrelated mandatory category is invented. Broader game/runtime/visual gates are outside this authorized source review.

HISTORICAL FAILURES AND LIMITS:

The original first native attempt remains **FAILED/SPENT/HOLD**: parent OS exit 1, 18.890572 seconds, one attempted native job, 87 producer frames and exactly **39,354,368 bytes** of partial media. Its original encoder terminating signal is **UNPROVED** because that source discarded poll's result. The recorded producer count is not a decoded-frame count. The separate short negative probe observed -25/SIGXFSZ at 1,048,576 bytes; it is not retroactive evidence for the original signal. Its failing driver remains failed. The separate 16-frame positive probe is retained history, not fresh full189 qualification.

The historical full snapshot remains **FAILED/MISMATCH with three pnpm task-state deviations**: directory mtime, missing old finished marker and changed latest.json. Matching this review's before/after snapshot does not turn that historical failure into PASS. No marker was restored or removed, and no writer attribution was invented.

All limits remain unchanged: 189 opaque 1920×1080 frames at 60 Hz; one frame in flight; 39,354,368 bytes per reel; 64 MiB native metadata; sampled RSS **8,589,934,592 bytes**; 600-second cohort, 60-second cleanup, 30-second final inspection; 384 MiB/4,096-entry joint cache admission; 1 GiB/job archives; four copy slots and eleven archive allowances; combined reserve **22,066,626,560 bytes**. These accounting/sample bounds are not OS quotas. Retained recent capacity is 19,745,017,856 bytes, below reserve by 2,321,608,704 bytes. No fresh capacity admission, lowered reserve, cleanup or workaround occurred.

Native-only source flag remains true; browser runtime flag and plan.captureAuthorization remain false. No codec/native189 cohort/probe, Blender/GPU/browser, service/DB, operational grant, installation, pnpm, cache mutation, screenshot cleanup, main work, push, PR, merge or nested review ran. Test Popen and StationJob ports were inert; the marker files called primary.mp4 are small explicit CPU markers, not media. Tests ran serially with direct pinned Python/Git executables and no heavy worker. Creature's heavy CPU lane and standard Metal QA's GPU lane were untouched.

COMMANDS / EXITS:

`commands.json` and each `*-command.json` preserve exact absolute argv, cwd, frozen PATH, PYTHONDONTWRITEBYTECODE, timestamps, child exit and stdout/stderr paths. run.py itself returns normally; the recorded child exit is authoritative. Fresh child results: snapshot-before 0; exact-red 1 (expected); exact-green 0; boundary 0; verify 0; snapshot-after 0. Initial source inspections were read-only tool commands; no project setup or package-manager command was used. Full intentional RED traceback is in exact-red.stderr; its final assertion is:

```text
AssertionError: Terminal evidence overstates ACKs: reported 1, actual 0
```

Intentional RED final 20 stderr lines:

```text
Traceback (most recent call last):
  File "/private/tmp/t02-ack-c2-independent-dg3xfe2f/red/guard.py", line 24, in <module>
    try:runpy.run_path(str(target),run_name='__main__')
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen runpy>", line 287, in run_path
  File "<frozen runpy>", line 98, in _run_module_code
  File "<frozen runpy>", line 88, in _run_code
  File "/private/tmp/t02-ack-c2-independent-dg3xfe2f/red/replay.py", line 8, in <module>
    runpy.run_path(str(O/'ack-count-regression.py'),run_name='__main__')
  File "<frozen runpy>", line 287, in run_path
  File "<frozen runpy>", line 98, in _run_module_code
  File "<frozen runpy>", line 88, in _run_code
  File "/private/tmp/t02-ack-c2-independent-dg3xfe2f/red/ack-count-regression.py", line 31, in <module>
    assert reported==stream.ordinal,'Terminal evidence overstates ACKs: reported 1, actual 0'
           ^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Terminal evidence overstates ACKs: reported 1, actual 0
```

DECISIONS:

- ACK count meaning → complete local emission with explicit peer-unobserved qualifier → the real protocol has no sender-visible confirmation of peer processing.
- Failed write/flush with possible side effects → unconfirmed attempt, no inferred receipt or rollback → producer observations can differ from emission completion.
- Unchanged historical gates → verify exact source/artifact hashes and reuse → avoid broad repetitions and double-counted success.
- Passing source review → return PASS only for this correction → native/full189/art/capacity gates and original failed evidence remain separate.

OUT OF SCOPE FOUND: Actual codec behavior and decoded output, native189 qualification, OS lifecycle/ownership/release, peak RSS, actual Thalune two-reel feasibility, 378 motion frames/eight stills, visual grading, whole-animation acceptance and E05.T04 gameplay integration remain pending/not run. This report grants no launch authorization.

ARTIFACTS: REPORT.md; review-result.json; delivery.json; commands.json; input-pins.json; reproducer-pins.json; red-replay-binding.json; exact RED/GREEN source and evidence; independent boundary.py and per-case records; four dispatcher records; verification.json; existing-files.diff; changed-files.json; before.json/after.json and preservation summaries; guard records; raw command logs; artifact-hashes.json. The exclusive directory is made read-only after hashing and independently checked against its seal.
