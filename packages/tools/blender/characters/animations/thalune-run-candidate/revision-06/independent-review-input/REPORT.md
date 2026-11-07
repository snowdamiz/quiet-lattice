TASK: P1.E05.T02 native189 prerequisite correction — fresh independent SOURCE/CPU R2 review.
STATUS: DONE — VERDICT: **REVISE**, three P2 findings. Native, visual and whole-task acceptance remain separate.

The original resource-error ordering finding is fixed. The cache correction fixes joint byte/entry admission and raced leaf types, but its no-link boundary remains incomplete for raced ancestors. Two specifically requested cross-lane hypotheses also reproduce in this unit: bootstrap output loss and an unguarded final artifact hash. All 393 supplied current controls pass; that count does not cover these independent failures.

Reviewed worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-11167406`
Branch: `codex/task/P1-E05-T02-thalune-reel-candidate`
HEAD: `258926df00eaf6a306920b9905ff925358a73c1d`
Tree: `2c18fbb1a1de1697aeede0675a65ce5ddbd0263e`
Base: `c44d7a8597644e942b38345f37e269c13af063e6`
Base tree: `f8d102c85e00e3f2b00ae33bdf4dc2b927aad00a`
A: `packages/tools/blender/characters/animations/thalune-run-candidate`
Evidence: `/private/tmp/t02-native189-r2-independent-h_626txv` (also accessible under `/tmp`).

FILES CHANGED: None in the reviewed checkout. New probes, fixtures and reports exist only in fresh scratch namespaces. No child review agents were used.

FINDING R2-1 [P2] — Anchor cache source and archive traversal through admitted directory descriptors.

Location: A/resource_admission.py:38-43, :63, :84, :106, :116, :162-168. Caller reachability: caller.py:168-184, :243, and :265; CacheLease.check/copy at resource_admission.py:282-298 and :316-332.

`O_NOFOLLOW` in `descriptor` protects the final pathname component. It does not protect the ancestor components of the full absolute pathname passed to `os.open`. The earlier `resolve()` check, the post-read leaf lstat, and the later inventory all admit a transient ancestor replacement if the same file/directory identities remain available and the ancestor is restored before the next check.

Independent real-filesystem schedules:

- Negative control: a preexisting ancestor link is refused with `Cache path alias refused`.
- Actual CacheLease.check: immediately before each real content open, rename a parent above the cache root to a sibling and put a real directory symlink at its old name. The original file is still the same inode/size/UID/timestamps. The actual open follows that link; real reads occur while the link exists. Restore the ancestor on descriptor close. Both trees and post-read metadata compare equal and check returns accepted.
- Actual CacheLease.copy: the same source-ancestor swap succeeds and copies all eight expected bytes. A separate archive-ancestor schedule also succeeds: the full-path open of the destination parent follows a transient ancestor link, then the leaf creation uses the returned directory FD. The copied bytes and later validation remain correct.
- Actual caller.run_sequence -> StationAdapter.run -> unmodified StationAdapter.prepare -> CacheLease.acquire: the same source schedule passes cache admission and the before-copy, retains the spent lease, and reaches `create_private_tmp`. The probe deliberately raises `REVIEW_STOP_BEFORE_PRIVATE_ALLOCATION` there. No allocation or native job follows. Only fixture plan/path inputs and the OS-owner enumeration port are substituted; the plan is read with its actual snapshot/hash reader and cache traversal/copy/prepare/dispatch bodies execute.

Evidence: `independent.py`, `independent-results.json` cases ancestor-static/check/copy-source/copy-destination, and `adapter-cache-v2.py` / `adapter-cache-results.json`. Open observations retain requested versus resolved paths, the real ancestor-link state, and descriptor identities. Scripts exit 0 because these assertions reproduce the defect.

Impact: this crosses the unit's explicit no-alias/no-link admission contract at the actual read/copy boundary. It is not a claim of a changed content hash, an accepted oversized cache, or general exclusion of arbitrary writers. Matching leaf identity does not prove that resolving that pathname avoided links. This is **PARTIAL** disposition of prior R4-2: its bounded-input and leaf-race parts are fixed, but ancestor traversal is not.

Correction: use no-follow directory-component traversal and hold the admitted directory descriptors across enumeration, content reads and copying. Resolve descendants relative to those descriptors, including destination parents, rather than reopening full pathnames after an earlier canonicality check. Retain identity reconciliation and the current budgets/error evidence. Add these deterministic ancestor schedules at check/copy and the actual prepare boundary. No general framework or frozen-helper rewrite is required.

FINDING R2-2 [P2] — Preserve the bootstrap command outcome before its receipt write can fail.

Location: A/caller.py:257. Retained helper context: A/retained-station/round4_job_boundary.py:216-221. Applies to inherited StationAdapter.run in both the native189 and later capture dispatchers.

The adapter calls `job.start()` without observing its subprocess result. The retained start body receives `boot`, writes bootstrap.json, and only then tests the return code and updates `registered`. If that write fails, the CompletedProcess returncode/stdout/stderr remain local and are lost to task evidence.

The independent probe executes the exact retained StationJob constructor, save and start bodies through actual native.run_sequence -> NativeAdapter/inherited StationAdapter.run. Files and constructor allocation are real scratch operations. Only the launchctl command port is inert. It returns exit 17 with `BOOTSTRAP_STDOUT_UNKNOWN\0`, `BOOTSTRAP_STDERR_UNKNOWN` and an unknown nested field; the next bootstrap receipt write raises an OSError without a filename. The complete returned result, in-memory receipt and every persisted JSON omit both output sentinels and the producer outcome. They retain the later write error and conservative cleanup/audit refusals. A second case returns exit 0 before the same receipt failure and loses that outcome too; `registered` is retained as False even though a successful bootstrap response was observed at the port.

A control with exit 17 and a successful receipt write retains bootstrap.json and refuses. No real launchctl call, worker handshake, owned process or cleanup operation executes. Each failing-bootstrap run attempts only the first job and remains HOLD.

Evidence: `independent.py`, `independent-results.json` cases lifecycle-bootstrap-control, lifecycle-bootstrap-17 and lifecycle-bootstrap-0. `observedPortResults` is the independent oracle; it is intentionally separate from the candidate result/receipt being checked.

Impact: failure evidence discards the original producer facts, including registration uncertainty after a successful command. This is the concrete effects-lane bootstrap issue reproduced here, **inherited**, not a regression caused by the resource-primary assignment. It does not demonstrate false release or successful capture.

Correction: observe the actual start-boundary command result in the task-local adapter before the immutable helper can fail on persistence. Keep exit/stdout/stderr and unknown facts alongside separate receipt errors, preserve uncertainty, and never retry the bootstrap. Exercise both exit-17 and exit-0 plus receipt failure, and timer/cancellation unwind while restoring the observation ports. Preserve retained helper bytes.

FINDING R2-3 [P2] — Bound and type-check final native artifact reads before pathname open.

Location: A/native189.py:201-203 and :223, using A/inspector.py:25-29.

After both positive release receipts, run_sequence calls inspect_native outside the adapter's capture/cleanup phase deadlines. JSON validation records use the bounded snapshot reader, but primary.mp4 and frame-map.json are hashed by ordinary blocking `Path.open('rb')`, before `packet_budget.inspect` checks file kinds and sizes. That artifact boundary does not inherit the metadata reader's protection.

The normal independent control constructs only small synthetic packet bytes and valid fixture receipts, executes the actual two-job dispatcher with inert run/audit ports, and calls the unmodified NativeAdapter.inspect_native. It reaches `NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT` as a provisional fixture result.

In the adverse control, immediately before the real primary.mp4 hash open, preserve the regular file and replace its pathname with a real FIFO. At that exact boundary `getitimer(ITIMER_REAL)` is `(0, 0)`. The real open blocks; a reviewer-only 100 ms SIGALRM is the sole cutoff. The recorded stack is native.run_sequence -> NativeAdapter.inspect_native -> inspector.sha -> Path.open. The returned primary is `HarnessCutoff`; its eventual HOLD is caused by the reviewer interruption, not prompt candidate refusal. Both fixture jobs have already returned positive releases. No actual media, producer, codec or browser process runs.

Evidence: `independent.py`, `independent-results.json` cases artifact-normal and artifact-fifo, including timer state, stack and complete dispatcher result. This is the specifically requested fauna artifact-read lesson reproduced in the native189 final-inspection path. It is **inherited**, distinct from the now-fixed cache leaf FIFO case and bounded JSON admission.

Correction: admit artifact type/identity/size before reading, use a nonblocking no-follow bounded descriptor reader with identity reconciliation, and place final inspection under an explicit finite phase deadline. Apply the same contract to primary.mp4 and frame-map.json at this task-local consumer. Keep exact hash comparison and the provisional-success/actual-parent-exit distinction. An earlier pathname check or merely moving packet inventory before the hash would leave a race.

PRIOR FINDINGS — dispositions

1. R4-1 resource RSS/deadline failure masked by a later post-wait receipt/read error: **FIXED**. caller.py:266-271 establishes the exact primary receipt at observation; :282-285 and native189.py:184-187 keep later failures secondary. Fresh 44 ordering controls cover TimeoutExpired partial non-UTF8 output/unknown fields, missing/excess RSS, real SIGALRM, post-wait receipt and exits reads, worker-record reads/failures, packet fallback, all file sinks and both terminal streams failing. Primary object identity, normal drain and one-job HOLD/no-validator are checked. The retained eight resource-order adverse controls also pass.
2. R4-2 cache limits after hashing and raced leaf FIFO: **PARTIAL**, only because of R2-1 above. Joint 384 MiB/4096 inventory now refuses before content reads, stops on the first surplus entry, and checks regular descriptor identity before bounded reads. Real leaf FIFO/symlink/regular replacements refuse; growth reads at most the admitted eight bytes plus one sentinel; truncation/refusal/close facts survive. New ancestor probes expose the remaining gap.
3. Duplicate post-RSS membership advisory: **FIXED** at resource_admission.py:220-221. Multiplicity and uniqueness now match before/after membership. The injected duplicate case refuses. This remains a defensive source case, not a claim that the real kernel helper emitted duplicate PIDs.
4. Old final-receipt write masking an original job failure: **FIXED/PRESERVED**. Fresh evidence20, terminal30, prior29 and native69 retain the original failure and complete live handle receipt across final-write failures. R2-2 is the separately proven start-producer observation gap, not recurrence of that final-write defect.
5. Old failed-release assertions discarding kernel/registration/partial facts: **FIXED/PRESERVED**. Fresh old/timed suites retain release observations and refuse uncertain release. No later clean audit erases a prior cleanup error.
6. Old combined final/returned/terminal proof failure losing fallback: **FIXED/PRESERVED**. Independent proof/packet attempts and complete in-memory results survive. Packet overflow remains explicitly partial; current controls do not promote it to durable-complete evidence.
7. Library fresh-receipt overwrite correction integrated at c61699d: **PRESERVED**. No changes outside A since the combined c61699d commit. All protected current-manifest rows and assets match. The retained 28 library tests, 42 actions and 126 actual clip/people pairs remain prior evidence, not newly rerun Blender/library qualification.
8. Earlier RGB producer-primary masking and grant parse/re-hash split: **PRESERVED**. Current native69 and actual historical/current admission RED/GREEN controls pass. Grant digest/semantics remain bound to the same capped snapshot; old expected RED outcomes are control successes, not product acceptance.
9. Cross-lane partial constructor ownership: **REFUTED for the concrete T02 case**. The exact retained constructor fails on request.json writing after scratch allocation. Actual dispatcher results retain the private allocation and exact scratch/out/target/registered fields via caller.py:287-288; scratch and private directories remain. Missing coalition ownership refuses cleanup/release. This does not claim every conceivable allocation operation is qualified.
10. Cross-lane artifact/cache reads: cache pre-limit and leaf-FIFO defects are fixed as above; final native artifact hashing is R2-3. No generalized audit of unrelated immutable dependency/source hashing is requested.

VERIFY — fresh runs and limits

All CPU suites ran sequentially on this macOS host with direct pinned executables and at most two CPU workers. No pnpm, npm, installer or shared-node_modules launcher was used. Supplied source was inspected before execution. Node controls deny native child launches; Python suites use inert native ports or exact helper bodies with native import ports removed. Temporary Git fixtures used by supplied controls are unrelated scratch repositories.

Supplied controls, all passing on the pinned source:

- 18 Node + 108 Python + 20 evidence + 30 terminal + 4 expected disabled CLI refusals = 180.
- 12 timed + 3 publication = 15.
- Prior independent terminal/dispatcher replay = 29.
- native189 controls = 69; bounded metadata = 7; historical/current admission = 2.
- Original supplied total: 302.
- Correction boundary suite: 74; retained/adapted adverse suite: 17.
- Total: **393 = 302 + 74 + 17**. Source/native preflights and native disabled refusal are additional checks, not added to 393.

Independent additions: 15 cases in independent.py plus the actual caller cache case = **16**. Nine expected-safe controls pass; seven successful defect reproductions support the three findings. They are not reported as 16 product passes. The copy cases include actual short writes, injected destination write/close reporting failures, combined source-read/destination-close failure, and a real 25 ms retained deadline during copying. Real descriptors are used and observed closed; primary error and secondary close evidence remain separate, original caches/before-copy/spent leases/partial copies are retained. A close-reporting exception does not itself prove native release.

All 20 candidate Python files AST-parse; all 85 changed JSON artifacts parse. Byte verification passes for 2,350 readiness bindings, 12 software pins, 38 candidate entries, 417 source-audit entries, 490 combined-manifest files, 330 protected prior rows and 157 retained inputs. The 160-file delta stays wholly within A. `git diff --check base HEAD` exits 0. No JS/TS product delta exists; root typecheck/lint/format evidence in the worker report is retained rather than rerun through pnpm. No broad game runtime checks are claimed under this review's explicit runtime hold.

The previous full producer evidence was reused only after comparing 14 producer/validator/dependency/helper/plan files against both exact base Git blobs and the prior independent before.json hashes, and rechecking unchanged software bindings. The retained full-producer.json is byte-identical to the prior independent report. Its 189 frames, 1,175,731,200 compared RGB bytes and all 189 RGBA hashes, positive validator and negative190 code-body evidence remain **prior CPU evidence**. No giant RGB generation was repeated and no native codec inference is made.

Commands and observed exits:

Bound Python: `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12`
Bound Node: `/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node` (fresh `--version`: v26.12.1).
Working directory for the main runs: reviewed checkout above. Scripts use `-B`/no bytecode. Exact argv, cwd, PATH, exits and retained stdout/stderr are in `commands.json`, `control-commands.json`, `new-bound-commands.json`, `supplemental-commands.json` and `prior29-retained/command.json`.

- Python -B `<evidence>/run-all.py`: 0. Its child drivers run-controls.py and run-new-bound.py both exit 0; revision05-controls.py exits 0; adverse-green.py exits 0. Four expected disabled old CLIs and native189 `--execute` each exit 1. Caller and native preflights exit 0.
- Python -B `<evidence>/independent.py`: 0; 15 cases including six defect manifestations.
- Python -B `<evidence>/adapter-cache.py`: 1, review-harness contract mismatch before dispatch: it shortened the later capture fixture's required 600/60 constants. Original script/stderr remain.
- Python -B `<evidence>/adapter-cache-v2.py`: 0. Only those fixture constants are restored to 600/60. Reproduction is bounded by the explicit pre-allocation sentinel; source is unchanged.
- Python -B `<evidence>/verify-artifacts.py`: 1, review-harness provenance expectation was too broad: c8f2103 predates the separately accepted library integration, so its entire outside-A tree cannot be expected equal. This did not identify a candidate regression.
- Python -B `<evidence>/verify-artifacts-v2.py`: 0. Scope equality is correctly checked from combined c61699d and exact review base; c8f2103 remains the retained old caller-fix pin, with its historical library integration listed separately.
- Python -B `<evidence>/prior29-retained/prior29.py`: 0, 29 cases. Rerun only to retain a separately named aggregate after the new independent report reused the original aggregate basename. Original first-run per-case observed-result files and stdout remain; the second 29 is not double-counted.
- Python -B `<evidence>/clean-state.py`: 0. Full before/after proof below.

DECISIONS / scope

The five mandatory plan 0.9.5 conditions show no newly introduced client authority, untested new system, retained replaced demo, proven perf-tagged runtime regression or unlogged product interpretation in this narrow delta. REVISE is required by the concrete task-local bounded-read/no-link and failure-evidence contracts above, not style. No advisory blocker is added. Plan 0.3/0.9.5, T02 and Appendix C, the R5 report/commands/provenance/preservation/delivery, the full prior independent report/adverse code, and both requested cross-lane reports were reviewed.

PRESERVATION / remaining acceptance

`before.json` and `after.json` prove identical HEAD/tree/branch, clean staged/unstaged/untracked status, and unchanged SHA256 and size for **all 13,203 tracked working files**. All 11 prospective run/grant/consumption/cancel/cache-lease/copy paths remain absent, including dangling-link checks. Both runtime flags remain false. Frozen Node26.12.1 was not retargeted. Entry/page/playback/assets/helpers and all prior evidence remain unchanged.

The native protocol remains two jobs: encoder189, positive owned release, then validator189 plus negative190. The later game capture remains 378 motion frames + 8 stills + 2 validators (five jobs). Combined admission remains exactly 22,066,626,560 bytes, four copy slots and eleven 1 GiB archive allowances; the 8 GiB cohort RSS threshold remains a sampled stop, not an OS quota. This review makes no fresh capacity reservation/admission claim.

No actual native producer/codec/browser/StationJob process, launchctl job, GPU, ffmpeg, Blender, service/DB, Vite, hydration, screenshot, cleanup of existing artifacts, source/docs edit, commit, push, PR or merge occurred. Real filesystem fixture changes and source-only deadline signals are explicitly authorized CPU work. Synthetic job counters in fixture results count inert attempts, not launched native jobs.

Resolve R2-1/R2-2/R2-3 and obtain a fresh exact-head source review. Native process inheritance/encoding/decoding/resource behavior, actual parent OS completion, capture/visual grading, whole T02 acceptance and E05.T04 integration remain unqualified and separate. No additional human approval stage is requested by this review.
