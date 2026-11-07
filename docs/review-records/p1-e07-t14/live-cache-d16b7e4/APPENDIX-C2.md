TASK: P1.E07.T14 — live-writer publication premise check and task-local correction.
STATUS: DONE — implementation and bounded CPU proof complete; fresh independent correction review required.
VERDICT: Confirmed baseline defect; author SOURCE/CPU GREEN. No native acceptance or independent review receipt is claimed.

SUMMARY
A real controlled scratch directory publisher reproduces the fauna rename premise through effects' unchanged actual StationJob.wait body and NativePorts.budgets at b151c82427a541754cec0d5143c7942271eed2b8. Path.rglob materializes deps_temp_a4ff6522, the publisher renames it to deps, then lstat raises FileNotFoundError. The helper catches that ordinary exception and returns observer_failed. Its errors and the incomplete resource observation are retained. The new sampler completes the same wait after a bounded retry, measures the published 137 bytes, and retains the first failed traversal. This is a filesystem/observer correction, not a browser or gameplay retry.

EXACT PINS
- Worktree: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects
- Branch: task/P1-E07-T14-effects
- Base HEAD: b151c82427a541754cec0d5143c7942271eed2b8
- Base tree: 442f1b7a8990bf06a719f10488c230f32aabcb50
- Final HEAD: d16b7e41b1c662cc4005a9322f60a8d3522dd219
- Final tree: bf40490eea5ea19a61e885420642f480e41e9e79
- Final source is clean, including untracked files.
- Readiness SHA256: 8cc52e23293773f38253414e74ba136719d017154cee7d7742c66a1f7851782d
- Binary/full-index source.patch SHA256: e33499a32bd2f6bca4d22ba818406107a0214c8d26b97ca9c3bf8cc32a427e6e
- protection.json SHA256: a632ecb5c638f191c4ea731d1d766e2a1cec72b6553f9fffafe5704bc19e41f7
- HANDOFF-DATA.json SHA256: 38a4693826b817421b03385e34b4b027bdcfb8dc896f2cb0c04fda67b0982de9

Historical b151 activation PASS is retained at /private/tmp/p1-e07-t14-c2-fresh-DydebqJb/APPENDIX-C2.md; its unchanged INDEPENDENT-RECEIPT.json SHA256 is 47949700e7b5c09a5c9ae0d720c77f1f3b897123898ed7f0b5d2662d6a33f67c. It does not review this new logic. The earlier 6b4073305af21efe5c6cf5ecc09f78406b637a42 correction PASS remains historical. No independent receipt or actual grant was authored for this pin.

FILES CHANGED
Only five paths under packages/tools/src/capture/effects_packet:
- live_cache.py: finite active-cache metadata traversal, failure retention and bounded publication retries.
- native_ports.py: eleven-line adapter change selecting it only for cacheBytes while for_archive is false; interrupted samples persist in raw.writerPublicationObservations.
- live_cache_controls.py: eleven CPU control methods using actual adapters/helper wait and scratch publishers.
- README.md: current correction/provenance prepended; old text retained verbatim.
- readiness.json: final bindings, fresh identity and paths, phase/prerequisites and CPU self-probe PID.

Both runtime flags remain true and byte-identical to base. RuntimeEnabled remains true. Caller, entry, evidence publication, source/grant/receipt admissions, owner guards, cache_io strict acquisition/copy, freeze/check_ready logic and all prior control files are byte-identical. All 64 asset files, four helpers and two T15 files match the retained 70-file protection manifest. No new Apple binding, process allowance, shared capture change or other-lane edit.

ROOT CAUSE AND MEASUREMENT MODEL
The old cache observer treated a directory path enumerated during active publication as stable until lstat. This is not an immutable tree. An observer error reaches the real wait path and stops capture; it is not merely a diagnostic warning. Before edits, publication-repro.py ran directly against the exact clean base and its original tree_bytes implementation. The same script ran after correction. A worker thread performs the real filesystem rename behind an event barrier; only the stat timing is intercepted. There is no fabricated successful scan, browser, StationJob constructor, launchctl job or native child. The actual helper wait body uses inert status/member/save ports and sets an inert capture exit to terminate its loop.

The new live-cache sampler:
- Uses the existing descriptor acquisition helper for every ancestor and directory, with no-follow/nonblocking opens and route/owner checks. It reads no file payload or hashes during active measurement. Regular files and directories are the only admitted cache entries; links/FIFOs and replacement links refuse.
- Tracks complete=false, bytes=null, directory routes/names, partial entry metadata/byte totals and original failures before a scan can fail. Names lists are attached before enumeration, so partial lists survive enumeration failure. A later successful sample does not erase interrupted attempts.
- Restarts the whole cache sample only for observed ENOENT or an explicitly observed before/after directory-name change. At most three attempts, 8192 bounded metadata entries per attempt, and a two-second monotonic acceptance window shared by those attempts. There is no sleep, new process or background worker in runtime code. The outer actual phase SIGALRM remains the interrupting deadline; the two-second checks are not a kernel filesystem-operation timeout.
- Other I/O/permission errors, changed directory identity, special types, size/count limits, descriptor close failures and BaseException/SIGALRM unwind. Repeated publication exhausts the attempts and refuses with incomplete/null bytes; no unknown snapshot is accepted or converted to zero.
- Initially absent cache leaves count as zero only after the admitted parent route and absence are reverified with a live descriptor. A root that disappears after being observed cannot become an empty retry.
- Compares directory names before/after to detect publication additions as well as disappearance. A completed traversal is explicitly atomicSnapshot=false: a live byte estimate, not an immutable snapshot or OS quota. File sizes can change between observations, as before; exact copy/hash verification occurs under the separate immutable contracts.

Scope is deliberately the substantiated generated-cache publication issue. Freeze tree_bytes, pre-copy cache_io inventory/read/copy/hash, and post-drain archive checks keep their original behavior, without retries. Strict archive rename still fails in the new controls. Live profile/privateTMP/helper tree_bytes is unchanged. The T13 zero-byte current-file premise is separately checked: actual effects budgets accepts a current zero-byte TMP file as sampled zero and then samples seven bytes after the writer appends; it does not compare live file metadata as though immutable. This does not qualify T13's implementation or prove effects' unexecuted native archive.

READ-ONLY CROSS-LANE INPUTS
Fauna actual result and returned-capture-outcome remain untouched at /private/tmp/fhp-e194193234574f3ba4fdc997c9c4edd5. Their original observed_thresholds failure names deps_temp_a4ff6522. T13 actual /private/tmp/t13-observer-native-5ba6b515/result.json (18507564 bytes, SHA256 610872bcc941ee24e2de5ec700dff46302d115aaf41aeb9ed649323b64264350) reports Incomplete ledger: Enumerated entry changed. Paths/lengths/hashes are recorded in crosslane-inputs.json. No historical PID was inspected/signalled, no evidence was rewritten, no other lane's implementation was touched, and no new native diagnosis ran.

VERIFY — REAL RED/GREEN AND FOCUSED CONTROLS
Exact argv, cwd, environment, actual OS exits, durations and log hashes are in COMMANDS.md/commands.json. All work is serial; the publisher uses one worker thread plus its caller, within the two-worker limit.
- base-publication-red: OS exit1 as expected. Actual wait=observer_failed; complete=false; original FileNotFoundError. base-red.json is 4566 bytes. The source was clean b151 at that execution.
- final-publication-green: OS exit0. Same exact publication-repro.py, actual wait=completed, no helper errors, complete current estimate=137 bytes, failed first scan retained, timer restored. final-green.json is 22423 bytes. Neither result is native capture success.
- Eleven new control methods PASS, including real threaded rename, persistent churn, added file, root disappearance, link replacement before open, unknown permission/EIO, real SIGALRM, file/FIFO/ancestor admission, exact size/count/time bounds, verified initial absence, immutable/archive refusal, zero-byte TMP, and actual caller with all terminal/fallback/stderr sinks failed. Raw interrupted attempts and the original observer failure remain available in memory; no durable claim survives failed sinks.
- Twenty focused prior control methods PASS, including actual helper constructor/bootstrap partials, ownership, deadline/restore, primary observer versus helper-save error precedence, all-sink behavior, strict descriptor/copy/hash adversaries, receipt FIFO/size/snapshot boundaries, grant/source refusal, actual phase unwinding and exact budget edges. No complete old suite, Node suite, native module probe, full lint/build/art regeneration or independent review is claimed.
- All task-local Python files compile from in-memory AST without bytecode writes. git diff --check and cached diff check PASS. No Python linter is configured by this package; no TS/JS logic changed, so no broad JS lint/typecheck was run.
- Current bindings.verify PASS at exact clean final head/tree: 424 file bindings and six dependency trees. Four independent in-memory byte-binding corruptions (native_ports.py/live_cache.py/caller.py/entry.mjs) all refuse. Actual pinned Python launcher and kernel bindings, Node22, installed dependencies, asset/source/helper and shared T15 closures remain checked. No new allowlist binding.
- Actual enabled Python CLI without grant exits1 at missing grant, before native_ports/helper/inspector/owner imports. Actual Node CLI with missing hash, correct hash but missing grant, and wrong hash each exits1 before capture/tsx/Playwright/esbuild/codec/Vite/child-process imports. Deny-write/network/fork sandbox, empty stdout and interpreter traces support zero-effect refusal. No authorization supplied, actual grant consumed, cohort allocated or native operation attempted.
- All twelve base/intermediate/final grant-consumption-evidence-output paths are freshly absent. Four final paths also pass existing canonical/owner/fresh checks. Final source remains clean.

RETAINED DEVELOPMENT FAILURES
Two harness mistakes were corrected with failed logs retained, not counted as passing controls: the first new all-sinks fixture failed consumption publication too early to reach its publisher; it was narrowed to terminal/result/fallback sinks. The first source-check script compared the changing self-probe PID under an incorrect observation key; source-checks-first.py and its failure are retained, and the correction compares stable probe fields separately. Neither required a runtime workaround. An initial read-only wc over directories exited1; no state changed. An intermediate unused freeze is retained as readiness-intermediate-uncommitted.json; it was never granted or launched and was superseded after final CPU controls. No existing historical report was overwritten.

READINESS / PINS / PROTECTION
Final phase: ENABLED_LIVE_CACHE_CORRECTION_PENDING_INDEPENDENT_REVIEW_AND_PARENT_ONE_USE_GRANT.
Changed readiness fields are recorded exactly in readiness-field-diff.json: file bindings (new sampler/tests, changed adapter/README and three historical activation review files), freeze predecessor head/tree, phase, attempt/authorization/four routes, self-probe PID and prerequisite text. Runtime flags, runtimeEnabled, pilot scope/inventory, budget/deadlines, process bindings and dependency trees are unchanged. check_ready.py is disabled-only and was not misused to label this enabled checkpoint PASS_SOURCE_ONLY_DISABLED. The existing make_ready CPU primitives were used, then runtimeEnabled/phase/prerequisites were explicitly set.

New prospective identity: effects-a2002dbc58854694880dd505416ac34d.
- Grant (absent): /private/tmp/egg-a2002dbc58854694880dd505416ac34d.json
- Consumption (absent): /private/tmp/egc-a2002dbc58854694880dd505416ac34d.json
- Evidence (absent): /private/tmp/egp-a2002dbc58854694880dd505416ac34d
- Output (absent): /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/assets/renders/effects-pilot-a2002dbc58854694880dd505416ac34d

HANDOFF-DATA.json contains actual schema and nested example DATA, not an issued grant or review receipt. Its exact source object is the final clean head/tree above. Parent must obtain a fresh independent PASS with scope INDEPENDENT_EFFECTS_PILOT_CALLER_REVIEW and this exact source, then use that actual receipt path/hash in its separately issued one-use grant. The historical b151 receipt cannot satisfy the new source equality.

BUDGET LEDGER — UNCHANGED
| Writer/reserve | Bytes | Actual semantics |
| --- | ---: | --- |
| capture_outputs | 184565760 | 11 controlled PNG writes plus perf.json; failed partials stay in the fresh output root |
| future_lfs_copy | 184565760 | Reserved for later Git LFS adoption; this pilot performs no git add or LFS write |
| future_main_hydration | 184565760 | Reserved for later parent hydration; this pilot makes no main-worktree copy |
| controlled_metadata | 67108864 | 32 MiB each for Node and Python, all attempted writes/copies charged; Python terminal JSON parts stay inside its allowance with 64 KiB reserved for failure stderr |
| cache_snapshot | 67108864 | One bounded pre-run cache copy, including a failed partial; 30 seconds; originals retained |
| profile_work_and_archive | 2147483648 | StationJob.archive copytree before removal: 1 GiB observed source threshold plus 1 GiB archive |
| private_tmp_work_and_archive | 1073741824 | preserve_private_tmp copies before removal: 512 MiB source plus 512 MiB archive, excluding profiles |
| helper_logs_work_and_archive | 134217728 | StationJob scratch and archived log/receipt copies, 64 MiB observed source threshold; includes constructor/failed job |
| generated_cache_growth | 268435456 | Observed additional Vite cache growth; original cache bytes already reduce free space |
| filesystem_metadata | 16777216 | Directory and filesystem overhead reserve |
| safety | 1073741824 | Fresh disk safety reserve, checked at admission and while observing |

Total admission: 5402312704 bytes. Capture cap: 184565760 bytes = 11 × 16 MiB PNG plus 16 KiB perf. No archive/staging image copies are performed; the two future copies remain reserves. The sampler creates no on-disk tree copy, payload read or new evidence sink. Its interrupted observations use the existing Python segmented writer and are charged on every attempted envelope/part/fallback write within 32 MiB (64 KiB failure-summary reserve); Node has its separate 32 MiB. A very large or repeatedly unstable observation history may exhaust that allowance and fail; no cap increase, fact truncation, synthetic success or OS quota is promised. The small exact RED/GREEN fixtures are not a measurement of worst-case native metadata.

Existing deadlines: capture600s, cleanup60s with drain45s, decoder45s only after positive error-free capture-cohort release, cache copy64 MiB/30s. Fresh live disk/owner gates remain parent launch requirements. Per-cache live retry acceptance is three attempts/two-second monotonic gate as described above; there is no retry of the capture or consumption identity.

EXACT FUTURE CALL PATH — NOT EXECUTED HERE
Existing caller, no new parent launcher code:
- cwd /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects
- argv ["/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14", "-B", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/caller.py"]
- complete cleared/replaced environment in HANDOFF-DATA.json; PATH binds Node22, PYTHONDONTWRITEBYTECODE=1, PYTHONOPTIMIZE=0 and EFFECTS_AUTHORIZATION=effects-a2002dbc58854694880dd505416ac34d only after real parent grant.
- Python launcher /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14; actual kernel executable remains separately bound in readiness.pythonRuntime.
- Actual Node child argv ["/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/entry.mjs", "/Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/packages/tools/src/capture/effects_packet/readiness.json"]; child environment includes exact readiness SHA, authorization, Metal and future owned TMP, supplied by the existing StationJob adapter.

Only captureReview('effects/gravitic', {asset:'gravitic_pull', outDir}),1920×1080, eleven PNGs+perf. Requested LOD2 maps to authored LOD0, never invented LODs. Expected 576 triangles, LIB_FX_Gravitic and gravitic_filament compressed textures remain unchanged. Output relative filenames:
- `gravitic_pull/noon-lush_lod0.png`
- `gravitic_pull/noon-lush_lod2.png`
- `gravitic_pull/wireframe_lod0.png`
- `gravitic_pull/wireframe_lod2.png`
- `gravitic_pull/overlay.png`
- `gravitic_pull/far_lod2.png`
- `gravitic_pull/night-exotic_lod0.png`
- `gravitic_pull/night-exotic_lod2.png`
- `gravitic_pull/open-space_lod0.png`
- `gravitic_pull/open-space_lod2.png`
- `gravitic_pull/perf.json`
- `gravitic_pull/sheet.png`

Parent must observe the actual caller OS exit0, exact outer result.json and consumption hashes, positive release and valid inspection, then use existing caller.parent_acceptance/evidence.capture_snapshot to verify every segment from capped same-byte snapshots. A file alone, stored accepted flag, incomplete evidence, exit1, or unknown sample never accepts. result.json/terminal.json/entry.json, segmented part envelopes, helper/scratch/cache/archive receipts and expected consumption routes are enumerated in HANDOFF-DATA.json and the unchanged caller/helper contracts. There is no newly created runtime output.

NEXT PROPOSAL / OUTSTANDING INVENTORY
Ready for fresh independent source/CPU correction review at d16b7e41b1c662cc4005a9322f60a8d3522dd219. Parent owns the next one-use grant after review, a serialized GPU slot and fresh 5402312704-byte admission/owner checks; no further human permission question is needed. The existing conditional SetStore executable observation remains unbound and future effects ownership is not inferred. No new Apple allowance was requested or added.

Original effects-b61233fdf3564205bd01d9566f306430 remains FAILED and SPENT. Its grant/consumption hashes and historical review bytes are rechecked in protection.json. No original scratch/TMP/evidence cleanup was done. Screenshot cleanup remains STOPPED. Actual one-root native capture/release and blind visual grade remain pending; remaining58 roots, proposed32 motion records and Recall/T04 playback are excluded. No images, browser/GPU/codec/service/DB/Blender run, real grant, consumption, native retry, push, PR, merge, orchestration-doc or other-lane change.

ARTIFACTS
Exclusive directory /private/tmp/p1-e07-t14-live-cache-51t64qhu. APPENDIX-C2.md, HANDOFF-DATA.json, pins-final.json, source.patch, protection.json, readiness-field-diff.json, final-bindings.json, activation-checks.json, crosslane-inputs.json, exact baseline/final GREEN JSON, all command stdout/stderr and scripts, COMMANDS.md/commands.json, evidence-manifest.json and seal.json. The manifest/seal cover these new artifacts. No nested reviewer was used.
