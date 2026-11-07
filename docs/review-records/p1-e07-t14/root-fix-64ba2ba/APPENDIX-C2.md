TASK: P1.E07.T14 — C2-WRITERS-1 admitted live-anchor identity correction.
STATUS: DONE — narrow source correction committed, enabled readiness rebound, fresh independent review pending.
VERDICT: Author SOURCE/CPU GREEN. No independent PASS receipt, operational grant, native capture, visual or whole-task acceptance.

SUMMARY
The first successful root acquisition now supplies a stable anchor route for the complete live measurement, including retries. Each transient child interruption revalidates that route before retrying; subsequent acquisition compares against it before scanning, and the existing descriptor exit reconciliation checks it before acceptance. Same-UID replacement, ancestor replacement or root death cannot become an empty successful sample. Normal ephemeral-child publication/deletion remains allowed. NativePorts/caller/helpers/shared T15/evidence/budgets/ownership code is unchanged.

EXACT PINS
Worktree: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects
Branch: task/P1-E07-T14-effects
Reviewed base HEAD: ec5221197dafd5acb2cb90b356d878e2360cd386
Reviewed base tree: 39428cfbdcd94e0739aa9ba368610a726959e0de
Final HEAD: 64ba2ba38051ca545ea8d808098e28a7a3220ef8
Final tree: 823f852bf1d201656ec81a5f1eb4a151f41b20d0
Final checkout clean, including untracked files.
Readiness SHA256: 40f9930dbfe824cc433c7a34de1c17ffcc52b72cc3a865251c743a3861f69903
Source patch SHA256: 2d81ea302ab30eaacd6846b622b8e505a5c6fb27f1322634a8b59b7d450aa319
HANDOFF-DATA SHA256: b0a075fba52c700e713a7b93621cde831b02f6e7a5a957246778b00f60e932da
Protection manifest SHA256: b1425f411949bbfb6958905389012253177d1733117c370e25b5aeeb0b834226
The12 failed packet files remain tracked by unchanged evidence commit18bbf9e2fcb62445603cdb881580000d34826070; no new artifact-retention commit or cleanliness exemption was needed.

REVIEW AND SCOPE
Read the full independent report, receipt, COMMANDS.md (all repeated environment blocks accounted for), exact root-replacement scripts, raw facts and focused controls. The report is `/private/tmp/p1-e07-t14-writers-independent-tvcw5utk/APPENDIX-C2.md`, SHA256f63be429ca17cb20d973c42572638de931b027360ec5d1d97cfe9cb52a54e6c1; REVISE receipt SHA256310e1f624b9f8e100056b407218836bf6997857e9deb747763c356554065a652. Its C2-WRITERS-1 is P2, not a native acceptance failure newly reclassified as success. It remains immutable historical REVISE at ec522. The fix-root-causes skill was applied: reproduce the actual adapter/wait error before production edits, then correct where retry discards the admitted identity. No nested reviewer or other-lane edit.

BASELINE REAL-WRITER RED
The unchanged independent root-replacement-wait.py and root-replacement-enoent.py ran from their original retained bytes with only the imported recorder's E redirected into this exclusive directory. Original script SHA values and exact output routes are in replay stdout. Both assertions fail with OS exit1 on clean exact ec522 before the edit. One bounded owned Python child renames the admitted root, removes its volatile child, and creates an empty same-UID replacement; original descriptor-relative os.stat returns genuine ENOENT. No stat return or production method is faked. All child receipts/exits and raw routes remain in red-wait and red-direct.

Observed actual helper wait RED: root inode490225371→490225377; waitResult=completed; error=null; complete=true; privateTMP sampled bytes0. The helper's exact extracted wait body uses inert status/members/save only and no constructor/native launch. This demonstrates the observation defect, not a successful full native cleanup or parent-acceptance bypass.

GREEN AND ORACLE CLARIFICATION
Direct exact independent reproduction now exits0 with Cache ancestor identity changed, complete=false, one attempt, original ENOENT plus anchor-verification error retained. Its writer is reaped with actual exit0. The original wait reproduction's final assertion expected an escaped exception and still exits1 after the fix, because frozen StationJob.wait catches Exception and returns observer_failed. That retained failure is root-replacement-wait-green, not a pass or ignored regression.

The corrected return/state oracle changes only that final assertion, using the actual frozen helper contract. replay-wait-oracle.py records the original script hash and modification. With exact ec522 live_cache bytes loaded from git show in memory, that same oracle fails OS exit1 (completed/complete=true). With current code it passes OS exit0: inode490234723→490234731; waitResult=observer_failed; incomplete sample; errors retained; no capture exit added by the inert completion port. Original review/report/reproduction bytes were never edited.

IMPLEMENTATION
Only5task-local files changed:
- live_cache.py:18added/4removed lines pin stable route and verify it across retries; no new sampler or native adapter.
- anchor_controls.py:8focused methods with actual owned CPU publication, exact helper wait and actual caller/evidence paths.
- live_cache_controls.py:root-death expectation now requires immediate one-attempt refusal and retained anchor-verification failure rather than a second sample.
- README.md:current correction/provenance prepended; historical descriptions retained.
- readiness.json:fresh enabled bindings/prospective identity and phase; current REVISE report/receipt/seal bound as historical evidence.

Stable anchorRoute contains only component,st_dev,st_ino,st_mode,st_uid,st_gid. It is copied from the first admitted descriptor route, never reset by ENOENT. Mutable size/mtime/ctime are not anchor identity. The existing acquire ancestor comparison now applies to the entire pinned route including the root. A known transient child failure records its original details and then records anchorVerification before another sample. Missing/replaced/denied anchor, root-route substitution, close failure or deadline aborts with unknown bytes and no success. An incomplete initial root acquisition has no anchor and cannot retry into a new admission. Optional initial cache-leaf absence retains absentParentRoute and verifies that same admitted parent before returning0; missing/replaced parent refuses.

Cumulative metadataEvents still has cap8192 across all attempts; anchor revalidation consumes an event. Attempt cap16, shared monotonic window2s and10ms clamped retry yield remain unchanged. Each acceptance still exits the descriptor context through full route reconciliation. No new comparison of live directory size/timestamps, renewed deadline, capacity increase, broad IOException bypass or silently skipped observation. Positive profile shutdown/cache publication continue to pass. Settled/archive uses one attempt and existing positive owned-cohort drain prerequisite; immutable cache payload/copy/hash acquisition is unchanged. Measurement still cannot prove resource release.

CONTROL COVERAGE —60 FRESH UNIQUE METHODS
8new anchor methods pass. Cases include replacement of each existing tmp/scratch/out/cache root; real ancestor replacement that preserves the root inode; root death; replacement during retry yield; legitimate child deletion with changing metadata but stable inode; optional-cache absence with replaced parent; permission uncertainty and real SIGALRM during anchor revalidation; actual caller + actual helper wait preserving anchor error before unknown cleanup and all terminal/fallback/stderr failures. All-sink result stays accepted=false/durable=false/release=null with no inspection/relaunch. Original ENOENT, route history, subsequent anchor error and secondary failures survive in anchor-control-observations-final.json.

10independent boundary methods freshly pass using original source with the previously documented assertion/context-manager ordering correction for SIGALRM only. They cover cumulative default event8193 refusal, final-route root death, ENOENT then permission error with raw unknown attributes, fixed shared deadline, partial173-byte facts and10000-character I/O exception, excess that cannot retry away, optional leaf/parent absence, metadata-only links/FIFOs, settled one-attempt mutation and real alarm during yield. Full raw facts are in independent-raw.json.

22prior writer/cache methods freshly pass:11writer methods and all11live-cache methods. They include real publishers in every category, whole-profile shutdown through actual helper wait, paced20-directory/200-file shutdown, repeated instability, unreadability, symlink/FIFO handling, strict settled growth/mutation, unknown cleanup and actual caller all-sink failures. The previous logical1GiB growth fixture was deliberately excluded to respect the256MiB limit; its historical proof/source is retained. The new independent97-byte excess fixture lowers only its injected effective limit; production capacities remain unchanged.

20prior lifecycle/admission methods freshly pass:constructor/partial ownership, bootstrap subprocess observations before fallible receipt writes, real deadlines, actual helper observer/save precedence, immutable cache source/destination/ancestor/type/size/read bounds, missing/reused/mismatched grants, source bindings, same-snapshot receipt caps and failed-write budget charging. Prior full suites, default-entry/T15/MTL and PNG/native qualification evidence remain historical, not fresh reruns. No real cache owner or native membership probe was run.

RETAINED ADVERSE OBSERVATIONS
All original nonzero results remain in exact logs and commands.json. Besides intended baseline RED and missing-grant refusals:
1. root-replacement-wait-green exits1 due the review script's escaped-exception oracle; actual wait is already observer_failed. The corrected oracle has explicit baseRED/currentGREEN as above.
2. First anchor-controls run had7passing methods and one method with two subcase faults. Its open-count injection matched the platform /private/tmp component rather than only the fixture's tmp leaf; permission fired before the child mutation and left volatile for the next subcase. Corrected only the test injection using the actual parent descriptor inode. Final8pass; initial logs/raw facts retained.
3. First prior22 run had21passes and one old assertion expecting2attempts on root death. The new contract terminates before a second attempt. The source assertion now checks one attempt plus original anchor-verification failure; final22pass. No production workaround was added for these harness/oracle issues.

COMMANDS AND EXITS
Exact argv/cwd/clear environments, actual OS exits, durations and stdout/stderr hashes are in COMMANDS.md and commands.json. All execution was serial light CPU, at most one extra owned writer. Existing recorder timeout90s; owned publisher phase5s plus2s wait/kill/reap. No real StationJob constructor, service, browser, GPU, codec, DB or Blender.

| Command | OS exit | Expected | Seconds |
|---|---:|---:|---:|
| root-replacement-wait-red | 1 | 1 | 0.123 |
| root-replacement-direct-red | 1 | 1 | 0.094 |
| root-replacement-wait-green | 1 | 0 | 0.086 |
| root-replacement-direct-green | 0 | 0 | 0.077 |
| wait-contract-oracle-red | 1 | 1 | 0.142 |
| wait-contract-oracle-green | 0 | 0 | 0.09 |
| anchor-controls | 1 | 0 | 0.445 |
| anchor-controls-corrected | 0 | 0 | 0.411 |
| independent-ten | 0 | 0 | 0.239 |
| prior-writer-cache-small | 1 | 0 | 2.56 |
| prior-writer-cache-corrected | 0 | 0 | 2.584 |
| prior-lifecycle-admission | 0 | 0 | 0.62 |
| freeze-enabled | 0 | 0 | 2.711 |
| source-protection | 0 | 0 | 0.208 |
| stage-owned | 0 | 0 | 0.017 |
| staged-whitespace | 0 | 0 | 0.011 |
| commit-owned | 0 | 0 | 0.163 |
| final-bindings | 0 | 0 | 1.343 |
| python-cli-missing-grant | 1 | 1 | 0.041 |
| node-cli-missing-auth-and-hash | 1 | 1 | 0.035 |
| node-cli-missing-grant | 1 | 1 | 0.034 |
| node-cli-bad-readiness-binding | 1 | 1 | 0.035 |
| final-source-protection | 0 | 0 | 0.13 |

PROTECTION / SCOPE CHECKS
All70protected files remain hash-identical:64source/export asset files,4recovered helpers and2shared T15 files. All12original failed outputs remain48,028,456B and exact old LFS pointer/hash matches; failed-packet-hashes.json lists them. All171original pilot2 entries retain mode/UID/GID/mtime/flags/size/regular hashes. Both spent grants/consumptions, raw segment parts/entry/error records and prior reports remain unchanged.184enumerated historical references are rehashed, including all prior author and current independent top-level files. This is the explicitly enumerated protection set, not a claim about every host file; atime from reads excluded.

24other task-local source files retain exact hashes, including native_ports.py,caller.py,entry.mjs,evidence.py,cache_io.py,bindings.py,freeze.py,MTL/encoder logic,shared tests and previous lifecycle controls. Process/Apple maps, six dependency trees, asset/resolver contracts, immutable cache policies, budgets/deadlines and launcher/kernel bindings match old readiness. All task-local Python files compile from in-memory AST; working/staged whitespace checks pass. No TS/JS logic changed, no Python linter configured, no build/broad lint/full corpus/native decode performed. No source-clean exception, ignore rule or artifact regeneration.

SCRATCH AND WRITER BOUNDS
Only this exclusive report directory and owned synthetic fixtures were written. New real writer payloads are20bytes or existing small137-byte cases; independent event-cap fixtures are zero-byte files. The previous1GiB sparse growth method was not run. Prior selected admission tests use at most64MiB+1logical sparse-file fixtures, with only one test active and owned teardown; immutable-copy bounded controls and tiny output fixtures stay below the256MiB concurrent scratch allowance. Final retained evidence inventory/bytes are recorded in seal.json. No arbitrary native/profile/cache capacity growth. Owned writer processes are waited/reaped; timeout path kills only the exact Popen child. No historical cleanup or screenshot removal occurred.

ENABLED READINESS / ZERO-EFFECT CLI
Final phase: ENABLED_ANCHOR_IDENTITY_CORRECTION_PENDING_INDEPENDENT_REVIEW_AND_PARENT_ONE_USE_GRANT
Both caller/entry flags and runtimeEnabled=true remain unchanged. Existing make_ready CPU primitives freeze438file bindings and6dependency trees, including actual Python launcher/kernel, Node22, installed dependency bytes, assets/helpers/T15 and exact signed Apple bindings. Current CPU self-process probe is informative only; no compiler/encoder service was executed. The REVISE receipt is only a historical binding, never a PASS for current pin. check_ready.py remains disabled-only and is not used to claim PASS_SOURCE_ONLY_DISABLED.

New unused identity: effects-4d530292934548719f6e8c90ed31cca1
Grant absent: /private/tmp/egg-4d530292934548719f6e8c90ed31cca1.json
Consumption absent: /private/tmp/egc-4d530292934548719f6e8c90ed31cca1.json
Evidence absent: /private/tmp/egp-4d530292934548719f6e8c90ed31cca1
Output absent: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/assets/renders/effects-pilot-4d530292934548719f6e8c90ed31cca1
All24known still-unused prospective paths pass fresh canonical/parent-owner/absence checks. Both spent attempt paths are present and preserved. Four in-memory source-binding corruptions refuse. Actual Python CLI missing grant; Node missing hash/auth, correct readiness hash/missing grant, wrong hash each exit1 with empty stdout and no native helper/capture dependency imports in traces. Deny-write/network/fork sandbox plus absent paths proves the bounded early-refusal path. No operational auth/grant/consumption supplied. Tiny control-* fixtures are synthetic ports only, not operational grants.

UNCHANGED LEDGER

| Writer/copy | Bytes | Semantics |
|---|---:|---|
| capture_outputs | 184,565,760 | 11 controlled PNG writes plus perf.json; failed partials stay in the fresh output root |
| future_lfs_copy | 184,565,760 | Reserved for later Git LFS adoption; this pilot performs no git add or LFS write |
| future_main_hydration | 184,565,760 | Reserved for later parent hydration; this pilot makes no main-worktree copy |
| controlled_metadata | 67,108,864 | 32 MiB each for Node and Python, all attempted writes/copies charged; Python terminal JSON parts stay inside its allowance with 64 KiB reserved for failure stderr |
| cache_snapshot | 67,108,864 | One bounded pre-run cache copy, including a failed partial; 30 seconds; originals retained |
| profile_work_and_archive | 2,147,483,648 | StationJob.archive copytree before removal: 1 GiB observed source threshold plus 1 GiB archive |
| private_tmp_work_and_archive | 1,073,741,824 | preserve_private_tmp copies before removal: 512 MiB source plus 512 MiB archive, excluding profiles |
| helper_logs_work_and_archive | 134,217,728 | StationJob scratch and archived log/receipt copies, 64 MiB observed source threshold; includes constructor/failed job |
| generated_cache_growth | 268,435,456 | Observed additional Vite cache growth; original cache bytes already reduce free space |
| filesystem_metadata | 16,777,216 | Directory and filesystem overhead reserve |
| safety | 1,073,741,824 | Fresh disk safety reserve, checked at admission and while observing |

Total5402312704B; output11×16MiBPNG+16KiBperf=184565760B. No new writer/copy category. Anchor metadata uses existing segmented Python32MiB allowance; all attempted/fallback writes remain charged and64KiB failure-summary reserve unchanged. Extra identity metadata can consume existing headroom; it cannot increase capacity, truncate facts into success or create a durable claim when all sinks fail. Native thresholds remain observations, not OS quotas. Capture600s; cleanup60s including bounded45s drain; CPU decode45s only after positive release; cache copy64MiB/30s. Any future parent run requires fresh admission/free-space/cache-owner checks, not this point-in-time source proof.

PARENT HANDOFF / NEXT PROPOSAL
HANDOFF-DATA.json provides actual schema and example DATA only, exact current source/readiness/pilot identity, Python caller argv/env, actual Node child argv/env,12output names, conditional evidence/segment/archive routes and complete ledger. It is neither a grant nor an independently issued receipt. Legacy purpose literal EFFECTS_GRAVITIC_PULL_SINGLE_DISABLED_PILOT remains the actual contract while flags are enabled. Parent needs no replacement launcher code.

Fresh independent review must match 64ba2ba38051ca545ea8d808098e28a7a3220ef8/823f852bf1d201656ec81a5f1eb4a151f41b20d0. Parent then owns current serialized GPU assignment and5402312704-byte admission, actual one-use grant and invocation. Fauna's GPU lane is not touched. Native success still requires the parent's actual observed OS exit0 plus exact result/consumption hashes through caller.parent_acceptance, complete segmented same-snapshot evidence, checksPassed=true/errors=[], positive release and valid packet inspection. Disk accepted staysfalse until that external observation; no file alone accepts. Exact future result: /private/tmp/egp-4d530292934548719f6e8c90ed31cca1/result.json; consumption: /private/tmp/egc-4d530292934548719f6e8c90ed31cca1.json.

Both b61233fdf3564205bd01d9566f306430 and164a9dca1cd5400c8f734587e449adeb remain FAILED/SPENT forever. No reuse/retry, operational grant, native launch, screenshots cleanup, install, push, PR or merge. Exact SetStore remains unbound/conditional; external XPC ownership unqualified. Native acceptance/visual grade, remaining58roots, motion/T04/Recall playback and whole-task completion remain out of this unit.
