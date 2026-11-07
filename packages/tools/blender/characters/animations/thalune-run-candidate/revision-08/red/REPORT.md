TASK: P1.E05.T02 — native189 prerequisites, fresh independent SOURCE/CPU R4 review (Appendix C.2).

STATUS: DONE — **VERDICT: REVISE**, one P2 finding in the complete-enumeration contract. The original three R3 manifestations are corrected; the broader R3-1 inventory contract remains partial because per-entry classification errors are still swallowed. R3-2 is fixed. All R2 findings remain fixed.

SUMMARY: The correction rejects the original real unreadable subtree and preserves the first executable observer exception across both immutable-helper outcomes. All 490 supplied/adapted controls pass. A narrow new control reaches the actual native final inspection and demonstrates that Python's os.walk suppresses a DirEntry.is_dir OSError without invoking onerror. The new inventory then reports complete, omits an over-budget subtree and publishes provisional success. Six other added controls pass, including unbound-executable primary/fallback ordering. No native qualification was performed.

Reviewed worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-11167406`
Branch: `codex/task/P1-E05-T02-thalune-reel-candidate`
HEAD: `c52db738abe4e7ea9486031a83694bf23f060ce2`
Tree: `394ef7e27ffae7be8e5d65151d16b15aceafad3e`
Base: `609f454dfe65c8e3a7fbc7e69b4c36a584f6af98`
Base tree: `127f83f32453c32f67bf1c2ada1cdd69e86484d4`
A: `packages/tools/blender/characters/animations/thalune-run-candidate`
Fresh evidence: `/private/tmp/t02-native189-r4-independent-ti5i2s4u`
Worker report SHA256: `9370fd69f44af25ce900c071a4f4a7c1988e33f45533b6d9389cd1bd9fc2b904`
Worker delivery: `/private/tmp/t02-r7-correction-mue78vhy/delivery.json`, verified against this pin.

FILES CHANGED: None in the reviewed checkout. Only new review scripts, scratch fixtures, results and this report were written. No source/asset/helper/orchestration edit, branch switch, commit, push, PR, queue action, merge, nested agent or screenshot cleanup occurred.

FINDING R4-F1 [P2] — Propagate per-entry type errors before declaring the inventory complete.

Locations: A/inventory_boundary.py:17–20 and :33–37; consumer A/packet_budget.py:16–19 and :28. Actual reachability is native189.run_sequence → NativeAdapter.inspect_native → packet_budget.inspect → inventory → inventory_boundary.paths/walk. The final consumer is native189.py:218–220 and provisional publication at :239–241. Terminal output accounting and reserved packet publication reuse this inventory.

The new walk supplies a raising onerror callback to os.walk, but this callback does not cover every enumeration error. The actual bound Python 3.12.14 implementation catches OSError from entry.is_dir(), classifies the entry as a non-directory and never calls onerror. The wrapper receives that directory in `files`. Its own later lstat succeeds; packet_budget identifies a directory and skips it, while os.walk never recurses into it. Both complete flags become true. No concurrent writer, alias swap, mocked final result or changed production allowance is needed.

The fresh `packet-entry-type` control uses real packet directories and a real sparse 67,108,865-byte extra file. A transparent wrapper around the real os.scandir iterator substitutes only the target DirEntry.is_dir call, making that one kernel-query boundary raise OSError(EIO). All other entries, iteration, lstat, files, final hashes, deadline, dispatch, inventory, terminal accounting and writes execute their actual pinned bodies. Two job and release ports are inert, as in the original R3 reproducer. This is deterministic source-level error injection, **not a naturally observed EIO on this Mac and not a native run**. No OS/codec process is launched or signalled.

Observed result:

- Three calls to the target directory-type query report the injected errno 5 at inspection, terminal accounting and packet-write inventory.
- The recorded root enumeration lists `extra-directory` under `files`; its descendant is absent from all returned paths.
- Both `outputInventory.complete` and its enumeration complete flag are true.
- outputBytes is 312 before terminal publication, omitting the 67,108,865-byte file.
- primaryFailure is null; fixture terminalReleaseProved is true; status is `NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT`.
- Both proof/result.json and packet/integration-result.json are written with that provisional status; completeObservationsPersisted is true.
- The identical readable-extra-tree control refuses with HOLD. An OSError at the real subtree scandir-open port also refuses with HOLD. The original real chmod-000 subtree now refuses correctly.

Evidence: additional.py; additional-results.json (`packet-readable`, `packet-scan-open`, `packet-entry-type`); additional-packet-entry-type/proof/result.json; additional-packet-entry-type/packet/integration-result.json; bound-os-walk-source.txt. The injected error oracle is outside the product result and is recorded explicitly. Driver exit 0 asserts the defective product behavior and must not be counted as product acceptance.

Rule/impact: violates this unit's requested complete enumeration and fail-closed packet/metadata admission. It is the remaining R3-1 error-lifecycle gap at the same actual consumer, not a generic filesystem-security or unrelated runtime finding. The common primitive also serves indexes, bindings and archive accounting, but this report claims the reproduced final packet result; it does not infer an unexecuted archive deletion or native leak.

Correction: make the task-local enumeration propagate per-entry classification errors, or derive recursion from checked lstat/type results, rather than relying solely on os.walk's onerror callback. No entry may be discarded as a directory unless its subtree was traversed or explicitly refused. Preserve the current API, no-link rules, existing ceilings, partial facts, first-failure precedence, terminal fallback and finite inspection deadline. A narrow traversal correction and this three-case control suffice; no immutable helper or full runtime rewrite is requested.

PRIOR FINDING DISPOSITIONS

- R3-1 original inaccessible-directory manifestation: **FIXED**. Real chmod-000/scandir PermissionError now causes HOLD; proof publication succeeds, packet fallback is attempted and refused, and unproved outputBytes is omitted. Normal and readable-extra controls retain their correct behavior. The broader complete-enumeration requirement is **PARTIAL** only due to R4-F1 above.
- R3-2 executable observer first-primary loss: **FIXED**. Both original real hash-read PermissionError cases execute actual NativeAdapter/inherited StationAdapter.run and exact retained constructor/start/status/wait/drain bodies. The same primary receipt object survives; the helper-save OSError is secondary. Original errno/filename/args survive. One job is attempted, no validator dispatches, timers and ports restore, release remains unproved and scratch/private allocations remain retained. The original helper message was never completely lost; this correction fixes primary precedence/type as requested.
- R2-1 raced source/destination ancestor cache routes: **FIXED/PRESERVED**. Held no-follow component directory FDs remain in resource_admission.py, unchanged by R7. Fresh 47-case controls cover pre-admission refusal, safe use of already-held originals after admission, copies and actual caller.prepare refusal before private/native allocation. No arbitrary-writer exclusion guarantee is inferred.
- R2-2 bootstrap outcome before helper persistence: **FIXED/PRESERVED**. Exact helper cases preserve exit17/exit0 results, stdout/stderr and unknown fields before receipt failure, plus timeout partial bytes, cancellation and real SIGALRM. Registration remains uncertain; no retry or false absence proof. Ports restore in finally.
- R2-3 final media/frame-map FIFO and hash admission: **FIXED/PRESERVED**. Both files retain independent ceilings, held parents, NONBLOCK/NOFOLLOW regular-file admission, bounded reads, identity reconciliation and a 30-second final-inspection deadline. Fresh static/raced FIFO/link/replacement, growth/truncation, unknown error, cancellation and timed controls pass. R4-F1 concerns separate recursive enumeration, not the hash boundary.
- Historical R4-1 resource RSS/deadline primary ordering: **FIXED/PRESERVED**. Fresh prior74 includes the 44-case ordering matrix; retained adverse cases also pass. First resource identity/raw facts survive post-wait persistence, exits/worker-read errors, all file sinks and both streams failing. One-job refusal/no-validator remains.
- Historical R4-2 joint pre-hash cache limits and leaf races: **FIXED/PRESERVED**, including the R2 ancestor completion. Joint 384 MiB/4,096-entry admission remains before reads; descriptor identity/size binds content, growth spends at most an admitted bound plus one sentinel. Charged-versus-hashed F2 controls pass for cache hash/copy and final artifacts. Duplicate post-RSS member multiplicity advisory remains fixed.
- Original final-receipt primary masking: **FIXED/PRESERVED** by evidence20, terminal30, prior29, native69 and the fresh observer controls. Live handles retain the complete receipt even when its file cannot be written.
- Original uncertain-release/partial kernel and registration facts: **FIXED/PRESERVED**. Audits register observations before fallible reads; unknown/partial facts remain; later clean audits do not erase earlier cleanup failure. Partial constructor ownership remains **REFUTED for the tested concrete case**: allocated scratch/private facts survive and missing coalition ownership refuses release.
- Original combined final/returned/proof/packet/stream failure: **FIXED/PRESERVED**. Independent bounded attempts and the complete in-memory result remain; oversized packet evidence is explicitly incomplete, and failed sinks are not represented as durable completion.
- Earlier producer-primary masking: **FIXED/PRESERVED** by historical/current encode-error controls using actual code and inert Popen. TimeoutExpired partial bytes/unknown fields and original identity remain.
- Same-snapshot metadata/grant semantics: **FIXED/PRESERVED** by metadata7 and historical/current admission2. Digest and semantics derive from the same capped read; FIFO/link/oversize/growth and false-as-exit-zero refusals remain. Fixture grants are only inert scratch test inputs, not new operational grants.
- Library fresh-receipt overwrite/rest-pose/actual-three-export proof: **PRESERVED prior evidence**. All bytes outside A still match combined library commit c61699d. The 28 tests, 42 actions and 126 clip/people pairs were not rerun or requalified.
- Cross-lane F4 cache unreadability: **REFUTED in the cache inventory**; original final unreadability corrected; the remaining final classification-error case is R4-F1. No cross-lane finding is adopted solely from analogy.
- Exact historical RED scripts/results, R1/R2/R3 reports, failed/intermediate reports and the three oversized failed-run files remain unchanged. Prior environmental/harness failures retain their original status and are not counted as product passes. R2's adapter-cache fixture deadline correction, R7's initial duplicate-__name__ harness failure and losslessly encoded whitespace stdout remain historical evidence, unchanged.

VERIFY

Fresh supplied/adapted controls: **490 = 440 prior + 39 new + 11 independent replays**, all pass their expected assertions. The 11 include eight original independent cases, both observer manifestations and the original all-descriptor-close-failure case. They run from fresh copies whose hashes match the reviewed R7 green scripts; their differences from original R3 are only the documented corrected expectations. close-failures.py remains byte-identical to R3 and records 18 actual descriptor closes followed by reporting errors in this run; all real FDs close, the original TimeoutExpired/partial bytes remain primary and every close failure is separate.

New independent work: **seven cases: six safe/refusal controls plus one reproduced defect**, all in additional.py, exit 0. Readable-extra and scandir-open-error controls refuse; early consumer closure leaves enumeration incomplete. Three actual observer cases return an unbound synthetic executable path after initial admission, then combine ordinary delivery, immutable-helper receipt failure and all file/terminal sinks failing. Each holds after one attempt and preserves the unbound-path assertion as the same primary. In the first two, proof and packet summaries are written; the all-sinks case exposes the structured memory result through TerminalDeliveryError and does not claim persistence. No parent-pilot caller or native artifact was copied or diagnosed.

Main commands, all with direct bound Python and -B:

- `<evidence>/replay/independent.py`: exit 0, 8 controls.
- `<evidence>/replay/observer-native.py`: exit 0, 2 controls.
- `<evidence>/replay/close-failures.py`: exit 0, 1 control.
- `<evidence>/supplied/run-all.py`: exit 0, 393 prior controls. Its native preflight exits 0 and disabled native --execute exits 1 as expected before grant/output allocation.
- `A/revision06-controls.py --report <evidence>/prior47.json`: exit 0, 47 controls.
- `A/revision07-controls.py --report <evidence>/new39.json`: exit 0, 39 controls.
- `<evidence>/additional.py`: exit 0, six safe controls and one asserted defect as distinguished above.
- `<evidence>/verify-artifacts.py`: exit 0.
- `<evidence>/snapshot.py before` and `after`: both exit 0, exact equality.
- `git diff --check 609f454dfe65c8e3a7fbc7e69b4c36a584f6af98 c52db738abe4e7ea9486031a83694bf23f060ce2`: exit 0.

commands.md/json, execution-commands.json and supplied nested ledgers retain full argv, cwd, actual exits, PATH and fixture environment. Raw stdout/stderr are retained. Four other disabled CLIs exit 1 as expected. No unexpected test driver failure occurred. Exploratory read-only lookup errors and expected diff exit 1 are disclosed in commands.md; they are not product executions. Expected-disabled stderr, including its final traceback, remains in supplied/.

Artifact verification: 2,353 source/data bindings; 12 software bindings; 41 candidate-index rows; 876 source-audit rows; 949 combined-manifest rows; all 750 protected prior-manifest rows; and 157 retained inputs match exact bytes/sizes. All 23 root Python files AST-parse and all 95 changed JSON files parse. The 199-file delta is entirely within A. Readiness differs from the review base only in bindings; capture jobs/stages/limits/storage, plan, grant semantics and immutable helpers are unchanged. No JS/TS product delta exists. Worker type/lint/format evidence remains retained; prohibited package-manager tooling was not rerun, and no broad game runtime/CI claim is made.

Frozen executables were verified directly: Node **v26.12.1** and actual bound **Python 3.12.14** at `/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12`. Python executable SHA256 is `a7ac9cb7034de94a80ba88d5584d05ef8f4fc37acdaa1ba21f125ea9147bb1e2`. The inspected bound os.py SHA256 is `54c43a1fc69c979c70d8f7d097174cee163bfe59937723ee353043dd4a0211e1`; the actual runtime behavior is independently exercised, not assumed from that text. Readiness SHA256 is `1df822cb9635c2aaf40e12295d96933b43cd565b35cc0612eef93a15d653d06f`.

The full historical producer proof was not regenerated. Its retained result is byte-identical, and 11 producer/validator/core/helper/plan files match both original independent before hashes and exact base blobs. Three dependencies — packet_budget.py, inspector.py and release_accounting.py — changed, so this report does **not** claim the entire old integration dependency set is unchanged. The old 189-frame / 1,175,731,200 RGB-byte / 189 RGBA-hash proof is reused only for the unchanged algorithms; changed enumeration/error/receipt behavior is covered by fresh small controls and the finding above. This is prior CPU/mocked-codec evidence, not new current full-pipeline or native qualification.

PRESERVATION

before.json and after.json match exactly across **29,502 filesystem entries and 26,927 unique regular contents hashed**. They include HEAD/tree/branch, clean staged/unstaged/untracked status, index flags, all tracked working files, complete no-follow checkout/package node_modules inventories, bound software/source files, helpers/assets, original independent report/probe/result files, R6/R7 external provenance dependencies and deliveries, and all three oversized historical failed files. Fingerprints include mode, size, device/inode, mtime, symlink target and regular-file SHA256. No old proof was recopied over or altered.

Both runtimeAuthorization and nativeFixtureAuthorization remain **false**. All **11 prospective operational run/grant/consumption/cancel/lease/copy paths remain absent**, including dangling-link checks. No new operational path or grant was introduced. The oversized failed evidence stays at its original paths and sizes 26,936,262 / 207,110,041 / 367,810,077 bytes with its recorded hashes verified; no large failed file was copied.

Final disk observation: 32,573,216 KiB available; the new review directory was 120,476 KiB at that observation. This is a capacity observation only, not a new native admission or reservation. No screenshot, existing cache, historical fixture or historical evidence cleanup occurred. Boundary files are sparse; no large RGB output was generated.

DECISIONS

- Scope of the verdict → exact pinned SOURCE/CPU prerequisites only → this brief does not authorize native execution or whole-task acceptance.
- Is onerror sufficient for complete traversal → no → actual bound runtime suppresses per-entry type errors and the actual consumer accepts an incomplete packet under a deterministic query-error schedule.
- Is the parent native failure reproduced here → no native conclusion → three unbound-executable source controls preserve primary/fallback behavior; they neither explain nor qualify the separately reported VTEncoderXPCService/missing-receipt pilot.
- Must the full producer proof rerun → no → retain its exact-hash unchanged algorithm evidence, disclose changed dependencies and exercise their small actual-boundary controls.

Plan 0.3, 0.9.5, T02 and Appendix C.2/C.4; R7 report/delivery/provenance and source; R6 report and original R2/R3 reviews; historical R1/R4 reports/dispositions and exact helpers were reviewed. None of the five mandatory 0.9.5 categories creates a separate authority/demo/style/performance/spec finding in this narrow change. REVISE is based on the concrete requested complete-inventory contract. There is no style blocker or speculative framework request.

OUT OF SCOPE FOUND: Actual native process inheritance, encoder/decoder execution, live ownership, peak RSS, and parent-observed OS completion remain outside this review. The parent's pilot failure is a separate reported result; no diagnostics, caller copy or pin change was made. Whole-animation capture and visual grading remain pending; gameplay integration belongs to E05.T04. No T15 adoption or browser work is implied.

The unchanged diagnostic purpose remains THALUNE_NATIVE189_DIAGNOSTIC_ONLY: encoder189, positive owned release, validator189 with negative190, captureGo=false. Existing limits remain 39,354,368 bytes per reel, 64 MiB metadata, joint 384 MiB/4,096-entry cache admission, sampled 8 GiB aggregate RSS, 1 GiB/job archive acceptance, 22,066,626,560 bytes combined reserve, four copy slots, eleven archive allowances and a 30-second final inspection deadline. Sampled RSS is not an OS quota. No 378-frame/eight-still capture, visual pass, whole-T02 acceptance, T04 acceptance or merge authorization is claimed.

ARTIFACTS: REPORT.md; review-result.json; commands.md/json; execution-commands.json; source.diff; before.json/after.json/preservation-result.json; artifact-verification.json; probe-provenance.json; replay/; supplied/; prior47.json; new39.json; additional.py/results/stdout/stderr; additional-observer-results.json; additional-packet-*; bound-os-walk-source.txt; artifact-hashes.json. The report and top-level evidence files are sealed read-only with SHA256 hashes; no visual artifact exists.

The source gate needs the one narrow R4-F1 correction and fresh exact-pin review. This report adds no human permission stage and authorizes no launch, output, merge or cleanup operation.
