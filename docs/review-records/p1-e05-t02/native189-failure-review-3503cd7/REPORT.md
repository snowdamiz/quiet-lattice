TASK: P1.E05.T02 — independent SOURCE/CPU review of revision-10 actual-native failure correction, Appendix C.2/C.4.

STATUS: DONE. **VERDICT: REVISE**, one P2 evidence-correctness finding (C2-F1). This is a bounded source/CPU verdict, not animation visual acceptance, actual Thalune reel feasibility, native189 qualification or whole-task acceptance. No new grant or authorization is created.

SUMMARY: The lost encoder-return correction preserves the actual poll/wait integer, signal and raw observer failures before assertions/persistence, and the localized positive fixture retains the reviewed 189-frame transport and validator requirements without raising budgets. Exact-base negative replay reproduces the missing old terminal record. Current supplied controls pass. A fresh independent actual-pixel control finds that the new terminal observation calls a frame acknowledged before its ACK has been delivered; the retained count is false on an ACK write failure. This matters in a correction whose purpose is faithful failure diagnosis. The original spent failure and old source fixes remain intact. A separate live reserve check correctly refused current free space; CPU reserve arithmetic passing is not capacity admission.

PINS (before and after):

- Worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-11167406`.
- Branch: `codex/task/P1-E05-T02-thalune-reel-candidate`.
- HEAD: `3503cd7d5187b78140bc22fbb5e418ee9f2c6798`.
- Tree: `be67aeb7817b1af3b89a7a2a2c2093e6244c8b73`.
- Base: `654658363a0347b1f50a40f868c32140b90881db`; tree `de2bacc2cec04a2dbb6dc9ef06a2499f82aac5f6`.
- Readiness SHA256: `5064e8a496ca46fca55934cad60c77f4050d46a33af55093679d1e370ea4460c`.
- Candidate index SHA256: `cec695e4c0c35fc0399b4dab399ff12d530e7373bb4cfa4805aba6bd75ffca01`.
- Plan SHA256: `ad5445e31e82ff4072026b39d77a713ede6a3ba56c80223ace65b5f06c92be3a`.
- Encoder SHA256: `cb2e4045407d2115b174a567a207047de99d21fe0c113c49edeea1f192b4ded5`.
- Diagnostic producer SHA256: `85cf0106b3f5274a65f5222626c2f6ab59b5283139abcb910b126b24d4a8364d`.
- Worker report SHA256: `060dbc47bb3d15a3412165944626354496b8c423227ec0d14338b940e6399d11`.

FILES CHANGED: No reviewed checkout, asset, helper, dependency, historical report or spent output was changed. All new review files are below `/private/tmp/t02-native189-c2-independent-2NeVsiha`. CPU controls ran sequentially with small Python drivers and inert codec/StationJob ports, within the two-small-control limit. Audit guards reject native launches and writes outside this review directory; only read-only Git processes are admitted by the guarded tests. No encoder/FFmpeg/ffprobe, native189 cohort, Blender, browser, GPU, service, installer, pnpm, full suite, LFS hydration, screenshot cleanup, nested agent, push, PR or merge occurred. The three actual CLI commands were refusals, not native runs. Inert files named primary.mp4 contain five-byte test markers and are explicitly not media evidence.

FINDING C2-F1 [P2] — Do not count a frame as acknowledged before ACK delivery succeeds.

Location: `A/rgb-primary.py:84`, using `len(seen)`; the increment-before-delivery is at `A/rgb-primary.py:109` (A is `/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate`). Reachability: `native189_producer.encode` -> shared `rgb-primary.encode` -> frame write/flush -> `seen.add` -> ACK `print`. The same encode body is used by the eventual production `rgb-sink.mjs:23` subprocess route. Browser capture remains disabled.

`seen` is updated after encoder stdin accepts the RGB bytes but before `print(..., file=ack, flush=True)`. If the ACK destination raises on its first write or on the terminating newline, the producer has received no complete ACK. The new failure-poll observation nevertheless records `framesAcknowledged=1`. It is persisted in encoder-result.json and attached to the original error. Written-to-encoder and acknowledged-to-producer are distinct boundaries; the current label promotes the former to the latter on an error path.

Reproduction: `ack-count-regression.py` uses the actual current encode function, actual default 1920x1080 localized DiagnosticStream, actual PNG parsing/alpha/RGB/RGBA hash checks, actual file/error persistence, and only inert Popen plus setrlimit ports. Its ACK destination raises the original BrokenPipeError before the first ACK write. Exactly one 6,220,800-byte RGB write and flush complete. The diagnostic producer remains at ordinal zero, with frame zero pending. The failure poll observes -25 and correctly retains it, but records one acknowledged frame. No further frame, wait, kill, validator or codec process runs. The assertion of the intended contract exits **1**:

```text
{"actualAcknowledged": 0, "reportedAcknowledged": 1, "accepted": false, "knownEncoderReturncode": -25}
AssertionError: Terminal evidence overstates ACKs: reported 1, actual 0
```

`neighbors.py` separately reproduces first-write and newline failures with actual DiagnosticStream/encode and small pixel ports. Those two cases are `DEFECT_REPRODUCED`, not PASS. Five independent neighboring controls pass: ACK flush failure, encoder stdin flush failure, stdin close failure after 189 ACKs, Popen construction failure, and actual full-size frame-188 pixel hashes/nonopaque rejection.

Impact/rule: violates the task's requested accurate producer/count/termination evidence. It does not bypass refusal or claim accepted media: accepted remains false and no later dispatch occurs. The new field is nevertheless a false diagnostic fact precisely on the failed transport paths this change is intended to preserve. This is a correctness finding, not style or an unproved native/ownership allegation; no unrelated 0.9.5 mandatory category is invented.

Remedy: keep distinct counters for complete encoder writes and successfully completed ACK emission. Advance the ACK count only after the ACK operation succeeds; retain partial/failed delivery as unconfirmed rather than inferring consumer acknowledgment. Keep the seen-work-ID guard if needed, but do not use it as an ACK count. Add first-write, newline and flush failure controls through actual encode; preserve original error identity, raw observer information, known terminal integer, no later dispatch and all-sink fallback. A rename to an accurately defined completed-write count can also avoid the unsupported claim, provided any ACK count remains independently grounded. No budget increase or lifecycle rewrite is needed.

PRIOR FINDING DISPOSITIONS:

- Actual-spent failure / discarded poll return: **FIXED for the observed-return source contract**, separate from C2-F1. Current rgb-primary.py:83-98/107/111/118-124 records observations before assertions. Twelve exact-base cases return -25, -9, 17 or 0 through normal/file-failure/all-sink variants and reproduce the old missing terminal field. All 31 current terminal cases pass. Old encoder SHA256 is `def00276dba5351c9f5fb4adfa4c0ce20a10fb3613a9e7babc7b1e3c37695ff0`. This is exact-base module replay with unchanged dependencies, not a whole old-checkout or actual codec rerun.
- Original high-entropy fixture exhausting the ceiling: **PRESERVED adverse case; bounded positive fixture correction applicable, full189 pending**. native189_producer.py:15-29 is AST-identical to base. Its original full-frame-changing algorithm and reduced-cap SIGXFSZ probe remain intact. New lines 32-48 change only the declared positive workload. This is not a claim that the original entropy workload or actual Thalune reels fit.
- R4-F1 [P2], checked per-entry inventory classification: **FIXED/PRESERVED** at inventory_boundary.py:10-53. Entry facts precede fallible `stat(follow_symlinks=False)`; a type/iteration/open error retains incomplete facts and propagates. Source bytes equal base and R5 sealed proof remains valid. No recurrence of suppressed `DirEntry.is_dir` errors; no new runtime claim. Retained R5 seven-case replay and 28 supplied inventory controls are reused, not rerun.
- R3-1 [P2], incomplete final enumeration: **FIXED/PRESERVED**, inventory_boundary.py:55-84, native189.py:218-220, release_accounting.py:120-136. Unreadable/incomplete inventory refuses and does not manufacture outputBytes or provisional success. R5 chmod/EIO/iterator/deadline evidence and source hashes are reused. No further remedy required in this delta.
- R3-2 [P2], executable-observer primary precedence: **FIXED/PRESERVED**, caller.py:289-346/354-357 and release_accounting.py:51-93. Original observer exception is retained before immutable-helper normalization/persistence. R5 original permission/hash-read and unbound-executable cases remain sealed; current four actual adapter/dispatcher media-error cases preserve primary terminal facts and stop at one attempt. No recurrence demonstrated.
- R2-1 [P2], source/destination ancestor aliases: **FIXED/PRESERVED**, resource_admission.py:45-132/145-173/191-222. Held NOFOLLOW/NONBLOCK directory descriptors and identity reconciliation remain byte-identical; 47 retained cases reused. No arbitrary concurrent-writer exclusion or live cache-ownership claim is added.
- R2-2 [P2], bootstrap outcome before persistence: **FIXED/PRESERVED**, caller.py:start_observed (line 150 onward), inherited run at 280-285. Exact command-result/unknown/partial-byte observation precedes helper save; uncertain registration stays uncertain. Retained exit17/exit0, timeout, cancellation and alarm cases reused. Helpers are unchanged. No bootstrap retry or native launch here.
- R2-3 [P2], final FIFO/hash admission/deadline: **FIXED/PRESERVED**, native189.py:197-220 and resource_admission.py:145-173. Both artifacts retain independent size/type/owner checks, held parents, bounded reads and a 30-second final deadline. R5 real final-consumer tests and prior FIFO/race/hash controls are reused. No unbounded replacement path introduced.
- Historical resource RSS/deadline primary ordering: **FIXED/PRESERVED**, caller.py:289-346 and native189.py:182-189; raw/unknown facts remain primary before post-wait receipt failures. Current alarm and adapter/fallback controls pass; prior74/adverse evidence is reused. Sampled RSS remains a stop, not an OS quota.
- Historical joint pre-hash cache/leaf limits and duplicate membership advisory: **FIXED/PRESERVED**, resource_admission.py:93-132/145-173 and CohortRSS. Joint 384 MiB/4,096-entry admission still precedes content reads; no broadening. Exact source and retained controls reused.
- Original final receipt masking: **FIXED/PRESERVED**, caller.py:255-266/354-357 and release_accounting.py:96-119. Live handle receipts survive failed writes; source unchanged and current four dispatcher variants cover normal proof, packet fallback, all files, and both streams failing. No further remedy required.
- Original uncertain release/partial kernel facts: **FIXED/PRESERVED**, caller.py:audit and release_accounting.py:96-136. Facts precede failures, and unproved release remains HOLD. Prior concrete partial-constructor allegation remains **REFUTED only for its tested case**, not generalized to all runtime ownership.
- Original combined final/returned/proof/packet/stream failure: **FIXED/PRESERVED**, release_accounting.py:137-170 and caller.py:448-465. Independent bounded sink attempts retain complete memory and explicitly qualify incomplete persistence. The current all-sink controls do not claim durable evidence when every sink fails.
- Original RGB producer-primary loss: **FIXED/PRESERVED**, rgb-primary.py:58-69/115-124 and native189_producer.py:129-134. Unknown fields and raw TimeoutExpired bytes survive while observer and persistence failures remain secondary. No false success after final success-receipt persistence failure.
- Same-snapshot JSON/grant semantics: **FIXED/PRESERVED**, admission_json.py:11-33 and native189.py:87-105/132-146. Capped snapshots bind semantics and digest. Current 22 admission controls and three raw CLI refusals pass. No operational grant exists.
- Library fresh-receipt/rest-pose/three-export proof: **PRESERVED PRIOR EVIDENCE**. Forty-two authored clips and 126 clip/people pairs remain prior library evidence; no Blender, compatibility or visual grading rerun. E05.T04 retains gameplay integration.
- Cross-lane cache unreadability allegation: prior concrete allegation remains **REFUTED**; the separately reproduced final-inventory classification manifestation is fixed as above. No finding is adopted from analogy alone.

VERIFY:

- Fresh current CPU passes: **80 = 31 terminal + 22 focused + 22 admission + 5 independent neighbors**. The 12 exact-base RED reproductions, two new defect reproductions, and failing actual-pixel ACK assertion are separate and are not counted as passes.
- Current terminal controls cover early negative/positive/zero returns, broken pipes, source timeouts and cancellation, failed poll with raw partial bytes/unknown fields, failed wait, nonzero final wait, unknown signal -999, successful inert 189 writes, success-receipt failure and combined sink failure. All dispatch/lifecycle ports are inert; only real source/pixel/file/alarm logic executes.
- Focused controls include real inherited NativeAdapter/StationAdapter/dispatcher and exact retained helper deadline bodies, one-attempt HOLD/no-validator on media errors, all-sink memory, real one-shot SIGALRM with no active timer afterward, 189/190 hash refusal, reserve boundaries and small-image ACK/order/PTS checks. Twenty full-size fixture frames (0-15, 60, 120, 180, 188) verify pixels/hashes/opacity; the first 16 match the retained probe inputs. No 189-frame actual codec run is inferred.
- Three raw CLI refusals: native missing r10 grant -> FileNotFoundError, full caller -> SOURCE_ONLY_RUNTIME_DISABLED, optimized native -> T02_ASSERTIONS_REQUIRED. Each exit **1**, stdout empty. Eleven paths absent before/after. Missing grant refuses before adapter construction; the admission driver separately instrumented launch ports and observed none.
- 2354 source/data bindings, 12 software pins, 42 candidate rows, 1260 combined-manifest rows, 1187 audit rows and 1184 prior-manifest protection rows match current hashes/sizes. All 22 other root Python files exactly equal base. Only six existing source/metadata files change, plus 70 revision-10 additions; 76 total. Git diff whitespace check exits 0.
- All 49 revision-10 evidence originals/copies and two retained external media hashes match. R5's 998-file seal, activation's 83-file seal, 195 revision-08 evidence originals and eight external historical sources verify. Retained worker **183** control results and **525** earlier controls remain bound evidence, not this review's fresh count. The 108 pure contract controls were hash-reused rather than rerun; their historical fixture/report paths were not written. The 26-case preliminary terminal run is not counted twice.
- Exact source reuse is qualified: the final encoder and diagnostic fixture changed, so historical full-producer proof is not promoted to a current full-pipeline success. The unchanged validators and lifecycle/resource/inventory logic retain their previous proof; changed encode behavior is exercised fresh through its actual function and Popen stand-ins.
- Proposal: exact new paths, 14 final packet outputs (13 before terminal summary), two ordered jobs and current bindings match. The grant example is intentionally inert (zero HEAD/expiry), and its schema is documentation. nativeFixtureAuthorization=true; runtimeAuthorization=false; plan.captureAuthorization=false. Source activation alone is not a grant. REVISE must be resolved before this review can support the proposed next attempt.
- Limits unchanged: 189 opaque 1920x1080 frames at 60 Hz; one ACK in flight; exact source/RGB/RGBA hashes; ordered PTS and timebase; positive RGB/RGBA decoder/ffprobe checks plus separate bounded 190-frame rejection. Software libx264rgb medium/CRF0, no hardware decode, one codec/filter thread. Full capture remains 378 motion frames plus eight stills and stays disabled.
- Budget: per-reel **39,354,368 bytes**; native metadata 64 MiB; sampled owned RSS **8,589,934,592 bytes**; 600-second cohort, 60-second cleanup, 30-second final inspection; cache 384 MiB/4,096 entries; 1 GiB/job archives. Four copies and eleven archive slots plus Git/staging/safety reserve still total **22,066,626,560 bytes**.
- Live capacity is **REFUSED**, not admitted. verify-v2 reached the actual reserve and exited 1 with `Current combined reserve refused`. A subsequent sample at 2026-11-07T10:44:20.559025+00:00 saw **19,745,017,856 bytes**, **2,321,608,704 bytes below reserve**. verify-v3 explicitly substitutes only the free-space port at the exact boundary to verify arithmetic. Its passing result cannot clear the live refusal. No cleanup was attempted, and capacity must be measured again by the parent.

ORIGINAL FAILURE / SHORT-PROBE QUALIFICATION:

The preserved r04 parent exit.json records actual OS exit 1, 18.890572 seconds. The spent terminal summary is HOLD, nativeJobs=1, terminalReleaseProved=true; the validator was not dispatched. Partial media is exactly 39,354,368 bytes, encoder.raw.log empty, producer frame count 87. Its old `poll()` result was discarded: **the exact old encoder exit/signal remains UNPROVED**. The acknowledged-input count is not a decoded-frame count. No historical decoder was run here.

The retained entropy probe is separately bounded: return -25/SIGXFSZ at 1,048,576 bytes, four completed writes and fifth BrokenPipeError; the driver exits 1 due to its terminal identity assertion. The failing fifth observer classification is not retroactively invented. The localized probe has 16 completed writes, exit0, 1,269,603 bytes. Both recorded released groups and stopped writers; their media bytes/hash and failure logs remain unchanged. These are historical short probes, not this review's executions, full189 evidence, real animation feasibility or current ownership proof. Original entropy remains an adverse fixture.

PRESERVATION:

Before/after snapshots match exactly across **31,268 entries**, including no-follow dependency inventories, tracked checkout files, software identities, prior sealed reports, author diagnostics and spent outputs. All **29,648 R5 snapshot rows outside the six authorized source/metadata files** still match. All **50 retained run/parent/grant/consumption entries** match original metadata/hashes. HEAD/tree/branch/status/index flags match exactly; checkout remains clean. All **11** prospective operational paths remain absent, including dangling-symlink checks.

The historical full snapshot remains **FAILED/MISMATCH with three pnpm task-state deviations**: directory mtime, the absent old finished marker, and changed latest.json. Current state matches the preserved R5 snapshot. No marker restoration/removal, dependency rewrite, writer attribution or failed-to-PASS relabeling occurred.

COMMANDS / EXITS:

`commands.json` and individual `*-command.json` files contain exact absolute argv, cwd, frozen PATH/PYTHONDONTWRITEBYTECODE, wall time, exit and stdout/stderr paths. The outer run.py records child exit codes and itself returns normally; the child exit is the authoritative result below.

- `ack-count-regression`: child exit 1; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/guard.py /private/tmp/t02-native189-c2-independent-2NeVsiha/ack-count-regression.py`.
- `admission`: child exit 0; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/guard.py /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/revision-10/admission-controls.py --report /private/tmp/t02-native189-c2-independent-2NeVsiha/admission.json`.
- `capture-disabled`: child exit 1; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/caller.py --execute --grant /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/grant.json`.
- `focused`: child exit 0; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/guard.py /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/revision-10/focused-controls.py /private/tmp/t02-native189-c2-independent-2NeVsiha/focused`.
- `native-absent-grant`: child exit 1; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/native189.py --execute --grant /private/tmp/t02-native189-r10-20261107-t3-11167406-grant.json`.
- `neighbors`: child exit 0; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/guard.py /private/tmp/t02-native189-c2-independent-2NeVsiha/neighbors.py`.
- `optimized-refused`: child exit 1; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B -O /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/native189.py --execute --grant /private/tmp/t02-native189-r10-20261107-t3-11167406-grant.json`.
- `snapshot-after`: child exit 0; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/snapshot.py after`.
- `snapshot-before`: child exit 0; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/snapshot.py before`.
- `terminal-green`: child exit 0; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/guard.py /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/revision-10/terminal-controls.py --report /private/tmp/t02-native189-c2-independent-2NeVsiha/terminal-green.json`.
- `terminal-red`: child exit 0; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/guard.py /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/revision-10/terminal-controls.py --base --report /private/tmp/t02-native189-c2-independent-2NeVsiha/terminal-red.json`.
- `verify`: child exit 1; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/verify.py`.
- `verify-v2`: child exit 1; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/verify-v2.py`.
- `verify-v3`: child exit 0; `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/tmp/t02-native189-c2-independent-2NeVsiha/verify-v3.py`.

Failure tails (last 20 lines; complete raw logs retained):

ack-count-regression (exit 1):

```text
Traceback (most recent call last):
  File "/private/tmp/t02-native189-c2-independent-2NeVsiha/guard.py", line 24, in <module>
    try:runpy.run_path(str(target),run_name='__main__')
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen runpy>", line 287, in run_path
  File "<frozen runpy>", line 98, in _run_module_code
  File "<frozen runpy>", line 88, in _run_code
  File "/private/tmp/t02-native189-c2-independent-2NeVsiha/ack-count-regression.py", line 31, in <module>
    assert reported==stream.ordinal,'Terminal evidence overstates ACKs: reported 1, actual 0'
           ^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Terminal evidence overstates ACKs: reported 1, actual 0
```

capture-disabled (exit 1):

```text
Traceback (most recent call last):
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/caller.py", line 478, in <module>
    raise SystemExit(main())
                     ^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/caller.py", line 469, in main
    record = consume(ready, args.grant)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/caller.py", line 84, in consume
    admitted=verify_runtime(ready)  # Disabled candidates fail before reading a grant or allocating output.
             ^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/caller.py", line 51, in verify_runtime
    assert ready['runtimeAuthorization'] is True, 'SOURCE_ONLY_RUNTIME_DISABLED'
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: SOURCE_ONLY_RUNTIME_DISABLED
```

native-absent-grant (exit 1):

```text
Traceback (most recent call last):
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/native189.py", line 262, in <module>
    if __name__=='__main__':raise SystemExit(main())
                                             ^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/native189.py", line 256, in main
    record=consume(ready,plan,args.grant)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/native189.py", line 92, in consume
    grant_snapshot=snapshot(grant_path);grant=grant_snapshot['value']
                   ^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/admission_json.py", line 14, in snapshot
    before=path.lstat();facts['before']=dict(mode=before.st_mode,bytes=before.st_size,dev=before.st_dev,ino=before.st_ino)
           ^^^^^^^^^^^^
  File "/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/lib/python3.12/pathlib.py", line 847, in lstat
    return self.stat(follow_symlinks=False)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/lib/python3.12/pathlib.py", line 840, in stat
    return os.stat(self, follow_symlinks=follow_symlinks)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
FileNotFoundError: [Errno 2] No such file or directory: '/private/tmp/t02-native189-r10-20261107-t3-11167406-grant.json'
```

optimized-refused (exit 1):

```text
T02_ASSERTIONS_REQUIRED: optimized/assertion-disabled Python is refused
```

verify (exit 1):

```text
Traceback (most recent call last):
  File "/private/tmp/t02-native189-c2-independent-2NeVsiha/verify.py", line 47, in <module>
    content=read(retained);assert isinstance(content,str) and content.encode()==data
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError
```

verify-v2 (exit 1):

```text
Traceback (most recent call last):
  File "/private/tmp/t02-native189-c2-independent-2NeVsiha/verify-v2.py", line 52, in <module>
    inv=native189.retained_inventory(plan);res=resource_admission.reserve(plan,inv)
                                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/resource_admission.py", line 395, in reserve
    assert free>=total, 'Current combined reserve refused'
           ^^^^^^^^^^^
AssertionError: Current combined reserve refused
```

Reviewer-harness qualification: verify.py initially assumed encoded historical raw text was a bare JSON string; its retained wrapper actually stores `text`. That assertion failure is preserved. verify-v2 corrects that schema reading and then encounters the legitimate live reserve refusal. verify-v3 retains that refusal, checks reserve arithmetic through an explicitly inert free-space port, and fixes the structured 108-control count read (`controls` array rather than a nonexistent count key) before execution. No source/test expectations were weakened to erase C2-F1. One exploratory rg command named a nonexistent producer.mjs and exited 2; the actual production consumer rgb-sink.mjs and entry.mjs were then read. This was a search miss, not a product failure.

DECISIONS:

- Lower-motion fixture applicability -> accept only as a declared native transport workload -> it preserves dimensional/timing/hash/alpha/backpressure/validation requirements while measuring no actual Thalune entropy. Full189 and eventual two-reel feasibility remain separate gates.
- Retain all encoder observations -> correction passes the old missing-exit reproductions -> C2-F1 must still make the new ACK count truthful on failure.
- Broaden tests/native work after source finding -> no -> the bounded CPU evidence demonstrates the defect and all prohibited runtimes remain off.
- Historical failure -> preserve exact bytes and uncertainty -> no inferred SIGXFSZ for the original spent run and no PASS for the failed first probe driver.
- Native authorization -> no grant -> the source flag, review, historical probe and capacity arithmetic cannot authorize an execution. Creature's art/codec slot is untouched.

OUT OF SCOPE FOUND: Actual OS ownership, coalition inheritance, cleanup/release, software codec behavior, peak RSS, full native189 encoder/validator qualification, real Thalune 378-motion/eight-still capture, visual grading and whole-library/task acceptance remain PENDING/NOT RUN in this review. E05.T04 gameplay integration remains separate. No CI, deployment, production or merge readiness is claimed. This finding can be fixed locally without changing assets/helpers/budgets or spent evidence; a fresh exact-head independent review is then required.

ARTIFACTS: REPORT.md, review-result.json, commands.json, per-command argv/environment/exit records and raw logs, before.json/after.json and preservation summaries, exact diffs and change lists, verification.json, live-capacity.json, guarded current/base controls, independent neighbors and actual-pixel ACK reproduction, artifact-hashes.json and delivery.json. Failed assertions and provisional/test-only receipts are explicitly distinguished from accepted runtime evidence. The exclusive directory is sealed read-only after hashing; the delivery record binds report/result/manifest hashes.
