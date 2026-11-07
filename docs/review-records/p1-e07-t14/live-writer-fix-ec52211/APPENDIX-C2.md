TASK: P1.E07.T14 — C2-LIVE-WRITERS: failed pilot2 mutable-writer correction.
STATUS: DONE — narrow correction committed and rebound; fresh independent review and parent launch remain pending.
VERDICT: Author SOURCE/CPU GREEN. Both native attempts remain FAILED/SPENT. No new grant, launch, independent receipt, native PASS or visual grade.

SUMMARY
The premise was that live profile/private-TMP/helper entries remain stable between enumeration and metadata reads, while only generated caches need a publication model. Actual profile shutdown invalidates that premise. Real owned CPU writers reproduced the same ENOENT through the actual effects adapter for profiles, private TMP and helper paths before production edits. The correction shares the bounded live metadata sampler across those writers and keeps strict settled verification separate. Every interrupted attempt remains evidence; unknown state cannot accept or prove release. Ownership, output/storage budgets, immutable cache acquisition/copy/hash checks, caller error precedence, evidence publication and shared T15 are unchanged.

EXACT PINS
Worktree: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects
Branch: task/P1-E07-T14-effects
Native pilot2/base HEAD: 4795d01fa0098d0b29310124fdeee06fd5fa4e24
Base tree: 7f96a3f6bfdfa8d81b3a9dce110df1b1863b409d
Separate unchanged failed-packet retention HEAD: 18bbf9e2fcb62445603cdb881580000d34826070
Retention tree: 5d7c2d14f8cf52c89718260d36ed69637ca06011
Correction/final HEAD: ec5221197dafd5acb2cb90b356d878e2360cd386
Final tree: 39428cfbdcd94e0739aa9ba368610a726959e0de
Final checkout clean, including untracked files.
Readiness SHA256: 6c8308cdc601652b22b4256a9e94c703d58c05dfd4782d0c662aec2d04e908a0
Source-only patch18bb→ec SHA256: 7dfd92b48c4bc213deb516427f56f30c2bb80aa6011d4d55143d9059ee03eae1
Retention patch4795→18bb SHA256: 0c2de154c947a7924cd3812f5f45b1e129713df993338f69922ef2d6cc380d4e
Overall patch4795→ec SHA256: 15fc3c612062392ba27010b3777aecec68aef230711faaa70a2d9ab6544218af
HANDOFF-DATA.json SHA256: 0cdadeffb70ae20d34d1bb7d829c6abaffe2caad88a96502c38fe8c46d8ddd6f
protection.json SHA256: 1b401c1ce33a711773f0ce6cbc4e1b4967ad8c58c72e562f0bc5f0251a4e9e2b
The final report and its derived documents live only in this new exclusive evidence directory. No parent/orchestration document was edited.

RETAINED NATIVE FAILURE AND ERROR PRECEDENCE
Original raw packet: /private/tmp/egp-164a9dca1cd5400c8f734587e449adeb
Original parent evidence: /private/tmp/space-effects-parent-pilot-r2-1of62im8
Actual parent caller OS exit1 in47.950s. The complete11PNG+perf packet is12files48,028,456B. The entry reports checksPassed=true/errors=[], but caller error0 is FileNotFoundError at operation writers / phase capture-observer for `/private/tmp/sbr-_lymht1r/playwright_chromiumdev_profile-NQNsQB/Default/Shared Dictionary`. HelperWorkFailure at cleanup-work-status is secondary. The original outcome remains failure, not an accepted image run.

Observed chronology, UTC2026-11-07:
- Last sheet mtime11:23:10.022711; Playwright graceful close starts.023.
- Browser process exit0 at.084; profile cleanup starts.084 and finishes.088; graceful close ends.088.
- Caller executionPartial observation at.088529 follows the observer failure. Before cleanup its recorded exits are empty, drained=false, clean=false.
- Entry receipt mtime.091747 is later than that failure observation. Result mtime.302791; caller OS exit.310660.
- Cleanup records capture/caffeinate-15, drained=true, clean=false, kernel coalition absent/live0, remaining[]. These induced producer exits do not replace the filesystem primary error.

Image writes completed before shutdown, but caller/Node capture completion was not proved before the observer failure. Browser exit0 is not the caller's successful exit. The ENOENT itself has no timestamp; retained facts are consistent with profile cleanup between.084 and.088 and show failure by.088529. Parent later observed13PIDs absent, launchctl113, profile/scratch absent and GPU release11:23:47.204225Z. Physical release=true/captureClean=false are both preserved. No historical PID was signalled or new ownership inferred.

native-audit.json retains the complete relevant observations. Original result outer SHA256291b242d830b1de6e883b51d57abe4de3b4ae442d0b4973ce57620a835c02f6e; entry SHA25607c32204170b553c26f06fccd1b8971d3071dea64ac82a87e28d5012ccbfcad7. Grant/consumption and every original segmented part remain unchanged.

READ-ONLY PACKET CHARACTERIZATION
After the parent's positive cohort release evidence, the existing pure Python full PNG decoder/inventory/perf/material/texture/LOD inspection ran under its45-second phase. OS exit0 in7.525s; inspection valid=true. No codec/browser/GPU or image writer ran. This checks file structure and loader contracts, not visual quality or successful native lifecycle. It does not supersede the original FAIL/SPENT. packet-cpu-inspection.json retains per-file facts. RequestedLOD2 still selects sole authoredLOD0; no invented LODs, motion/atlas stepping or new playback.

ATTACK-THE-PREMISE RED BEFORE EDITS
PREMISE.md was recorded before production edits. mutation-repro.py drives the real NativePorts.budgets boundary with one owned Python child performing real rename/delete operations after enumeration, synchronized by explicit requests/receipts. At exact base4795, profile rename/delete, privateTMP rename/delete, helper rename/delete and whole-profile deletion fail with ENOENT (7cases); generated-cache rename/delete already pass (2cases). premise-red returns expected OS exit1; base-red.json retains all9results and child exit/receipt facts. The same script with corrected production code returns0 for all9; green.json retains the same boundary observations. No browser, actual StationJob constructor or native process is used.

A first uniform-sampler correction was still wrong: three immediate retries could expire while a real child removed20directories/200files over roughly40ms. The paced-shutdown command unexpectedly returned1. Its unchanged raw failure is retained in paced-shutdown.json and paced-shutdown-initial-red.json; no pass is claimed for that command. This finding drove a bounded retry delay and cumulative accounting. paced-shutdown-green.py differs only in its result filename and passes the same real shutdown. The maintained source control also covers paced shutdown.

CORRECTION AND FINITE BOUNDS
Exactly7task-local paths changed: live_cache.py, native_ports.py, live_cache_controls.py, revision_controls.py, new writer_controls.py, readiness.json and README.md. No runtime flag changed; both remain enabled. Source diff is473insertions/87deletions including278lines of new controls and55lines of provenance.

The existing sampler now serves profile/private-TMP/helper/cache metadata. All roots share a2-second monotonic acceptance window; each root has at most16attempts and8192cumulative metadata events, including directory records, enumerated names and entry reads across all retries. Retries yield10ms, clamped to remaining time; scopes close descriptors before retry. SIGALRM/outer phase deadlines still unwind. This is bounded best-effort live accounting, not an atomic snapshot or OS quota.

Private TMP is the anchored root; ephemeral profile directories are its children, classified under the existing playwright_chromiumdev_profile prefix. Profile bytes retain the same1GiB source threshold; nonprofile TMP retains512MiB. Helper scratch+logs retain64MiB combined; generated-cache total retains initial+256MiB. The sampler retains partial entries, directory names/stamps, interrupted totals and original exceptions. Only ENOENT caused by an in-traversal publication or explicitly changed directory names may retry. Permission/unknown I/O, identity/UID/type/link-route/close/size/deadline failures refuse immediately. An initial optional cache leaf can count0 only with admitted parent route and verified absence; a disappeared required namespace/helper root cannot become an empty success.

Profiles/helpers/TMP preserve their earlier leaf-special-file semantics: symlinks are metadata counted by link size and never followed; sockets/FIFOs contribute0payload and are never payload-opened. All ancestor components remain descriptor-based/nofollow; cache links/special files still refuse. A retained real helper scratch path uses the platform /tmp alias. The adapter now records and admits only `/tmp` when root-owned and pointing exactly to `private/tmp`, mapping that prefix to `/private/tmp` before strict descendant acquisition. Arbitrary aliases or linked descendants are not accepted. Its dedicated control covers the actual OS alias and rejects an untrusted root link.

Successful later live samples do not erase interrupted attempts: raw.writerPublicationObservations persists them, and raw.writerProfilesObserved preserves encountered profile names. Measurement explicitly sets resourceReleaseProved=false/profileAbsenceIsNotRelease=true. A deleted profile is never treated as released by measurement. Caller acceptance still requires its actual producer observations and positive owned-cohort cleanup.

for_archive requires drained=true, kernel live0 and remaining[] before any settled sample. Settled traversal gets one attempt, verifies names plus before/after file/directory stamps and refuses any detected mutation. Freeze measurement is also settled. Immutable cache read/copy/hash/route verification is untouched. No copy/remove success is inferred from a mutable sample. No second browser stack, ownership bypass, method monkeypatch workaround or shared helper/T15 change.

FOCUSED VERIFICATION
43unique methods freshly PASS:12 writer_controls,11 live_cache_controls,20 focused prior controls. Tests are serial, with at most one additional owned CPU publisher process. Actual helper wait and caller bodies are exercised with inert lifecycle/identity/status/I/O ports; no real StationJob constructor or service is called. New controls cover all mutable writer categories, whole-profile deletion during actual wait, paced shutdown, repeated instability/null bytes, real unreadability, symlinks/FIFOs without payload reads, sparse growth/exact byte caps, strict settled mutation/growth, unknown namespace/cohort, real SIGALRM, the exact OS alias, and actual caller primary error with unknown cleanup plus every terminal/fallback/stderr sink failing. No successful inspection/durable claim/relaunch appears in that combined failure.

Prior controls preserve constructor/bootstrap ownership and producer observations, deadlines, error precedence when observer persistence fails, strict cache type/size/ancestor/identity/read/copy checks, and source/grant/receipt budget admission. Earlier full79+29 and independent reviews remain historical, not rerun. Unchanged code is hash-proved; no new independent review is asserted. All task-local Python files compile via in-memory AST; committed git diff --check passes. No Python linter configured; no TS/JS logic changed or broad lint/build/full suite performed.

Actual command summary; exact argv/cwd/env/log hashes are in COMMANDS.md and commands.json:

| Command | OS exit | Expected | Seconds |
|---|---:|---:|---:|
| native-audit | 0 | 0 | 0.048 |
| premise-red | 1 | 1 | 0.271 |
| retained-packet-cpu | 0 | 0 | 7.525 |
| mutation-green | 0 | 0 | 0.268 |
| live-cache-regressions | 0 | 0 | 0.124 |
| focused-prior | 0 | 0 | 0.55 |
| writer-controls | 0 | 0 | 0.729 |
| paced-shutdown | 1 | 0 | 0.163 |
| paced-shutdown-green | 0 | 0 | 0.166 |
| writer-controls-paced | 0 | 0 | 2.058 |
| live-cache-paced | 0 | 0 | 0.827 |
| writer-controls-final | 0 | 0 | 2.09 |
| focused-prior-final | 0 | 0 | 0.585 |
| freeze-enabled | 0 | 0 | 2.606 |
| source-protection | 0 | 0 | 0.245 |
| final-bindings | 0 | 0 | 1.245 |
| python-cli-missing-grant | 1 | 1 | 0.039 |
| node-cli-missing-auth-and-hash | 1 | 1 | 0.033 |
| node-cli-missing-grant | 1 | 1 | 0.032 |
| node-cli-bad-readiness-binding | 1 | 1 | 0.032 |
| final-source-protection | 0 | 0 | 0.22 |
| final-commit-scope | 0 | 0 | 0.027 |
| retention-commit-scope | 0 | 0 | 0.02 |
| committed-whitespace | 0 | 0 | 0.023 |

PRESERVATION AND CLEAN CHECKPOINT
All70protected files (64asset files,4helpers,2shared T15 files) retain exact hashes. All enumerated historical reference/evidence hashes retain exact bytes. pilot2-before.json and protection.json verify171original pilot2 entries including paths, mode/UID/GID/mtime/flags/size and regular-file hashes. Atime from reads is excluded. This is the explicit enumerated protection set, not a claim about every host file.

The12pre-existing output files were untracked and prevented the unchanged strict clean-source gate. They were retained in separate evidence commit18bb, with Git LFS pointer OIDs/sizes verified against original payload bytes; the correction commit follows separately. No payload bytes/path/mtime were changed, no ignore/cleanliness exception was introduced, and no old screenshot was removed. Tracking failure evidence does not grant native or visual acceptance. A preference question was sent but no reply was observed; the reversible retention commit was chosen to satisfy requested clean provenance without deleting or hiding existing outputs. No claim of explicit user selection is made.

The local LFS payload copy is bounded above by48,028,456B; actual newly allocated physical bytes were not measured and identical payloads can deduplicate. It uses the old packet's reserved future-LFS-copy category. No main hydration or network push/fetch occurred. Existing retained bytes count against actual available disk for any future fresh admission. All old reports/grants/parts and the failed partials remain in place; no cleanup or removal was performed.

Retained packet hashes:

| File | Bytes | SHA256 |
|---|---:|---|
| far_lod2.png | 4,147,617 | `6a45eca4d66a3ed7a79a733f6347c11433b53a4e59b439a66d4024f537a58d28` |
| night-exotic_lod0.png | 3,352,466 | `8eb04630bb5fad8b99f3025930aa8bdce93f2bae80645314307da68fced666a1` |
| night-exotic_lod2.png | 3,352,400 | `52bf2f4a056f759578277fcfda355e1edee05c613498a4624cd8543d1bdecbf3` |
| noon-lush_lod0.png | 4,792,486 | `17c54bd87e2da4f590df88b938eb34f07db72e7dd506dfeb76706ad2336734da` |
| noon-lush_lod2.png | 4,792,385 | `d10054244376786fb95bee823dbf3894650b7493128c324122570ebcac21e6d2` |
| open-space_lod0.png | 2,895,620 | `2c5afbd27a065b55738b8e3e6957e81f49a93e1254f3993cb781d96bb82be32e` |
| open-space_lod2.png | 2,895,620 | `2c5afbd27a065b55738b8e3e6957e81f49a93e1254f3993cb781d96bb82be32e` |
| overlay.png | 4,784,457 | `18c3da35a2a9d120a21a39584ec0f90e05781832f33273f6acd0f92cae03a607` |
| perf.json | 8,334 | `d8f506c5c04a94e1b93df154e58d2d1481234d1a479b26d9c95a118667b3a796` |
| sheet.png | 7,401,201 | `f761039becf788e5b31e42669a9c2288485de4afb9a9132e75b7e9636b32ed53` |
| wireframe_lod0.png | 4,803,091 | `6617b6244581c08438d122548869b94e57c759a6c13438fddc0eacb55a19dd2e` |
| wireframe_lod2.png | 4,802,779 | `702a606ca9c3ad6a5f191281a14365881dee2905513ec1f0a3f5883936b317ef` |

READINESS AND ZERO-EFFECT REFUSAL
Current phase: ENABLED_LIVE_WRITER_CORRECTION_PENDING_INDEPENDENT_REVIEW_AND_PARENT_ONE_USE_GRANT
Readiness enabled=true; caller/entry enabled literals unchanged. Existing make_ready CPU primitives supplied the freeze;434file bindings and6dependency trees verify at the exact clean final pin. Actual Python launcher/kernel, Node22, installed tsx/esbuild/Playwright/decoder dependency bytes, source/helper/assets/shared T15 and exact Apple bindings are retained. initialCacheBytes=8099054. Four in-memory binding corruptions (live_cache.py,native_ports.py,caller.py,entry.mjs) all refuse. Budget/deadlines/process map/Apple bindings/6dependency trees/resolver/immutable cache policies are unchanged; exact changed fields are in readiness-field-diff.json. freezePredecessor18bb is informative only, never used instead of actual final source admission.

The freeze wrapper's stdout retains an old MTL summary label; authoritative readiness.phase is the current live-writer correction phase above. The compatibility file named readiness-disabled.json is a byte copy of the old enabled4795 readiness, not a disabled/current checkpoint. check_ready.py is disabled-only and was not used to claim PASS_SOURCE_ONLY_DISABLED.

Actual Python CLI missing grant and Node CLI missing hash/correct hash with missing grant/wrong hash each exit1 with empty stdout and early refusal. Interpreter traces show zero native helper/capture/tsx/Playwright/esbuild/codec/Vite/child-process imports. A deny-write/network/fork sandbox and absent-path checks support zero runtime allocation/launch. No actual auth value or grant was supplied. activation-checks.json names only the current unused paths; its free-text old/new wording is generic. The old spent164 paths are present and preserved, not asserted absent. final-bindings.json separately verifies20still-unused paths across known prospective identities and retains the spent paths.

Current fresh prospective identity: effects-f06f6009cba44ce7a4ff9c027e8bc68e
Grant absent: /private/tmp/egg-f06f6009cba44ce7a4ff9c027e8bc68e.json
Consumption absent: /private/tmp/egc-f06f6009cba44ce7a4ff9c027e8bc68e.json
Evidence absent: /private/tmp/egp-f06f6009cba44ce7a4ff9c027e8bc68e
Output absent: /Users/andreyyurlov/.t3/worktrees/space/P1-E07-T14-effects/assets/renders/effects-pilot-f06f6009cba44ce7a4ff9c027e8bc68e

UNCHANGED WRITER/COPY LEDGER

| Writer / copy | Bytes | Actual semantics |
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

Total5402312704B;11×16MiBPNG+16KiBperf=184565760B. No new runtime writer or copy was added. New retained metadata uses the existing32MiB Python evidence allowance, including all attempted primary/fallback/segment writes and reserved64KiB failure summary. Metadata-event/attempt/deadline caps bound each sampling call, not the cumulative run's success: if complete evidence cannot fit, it must fail with all-sinks/in-memory evidence rather than truncate unknown facts into success. Native observed thresholds can overshoot and are not OS quotas. Future live cache/profile/TMP bytes can change after this CPU check; parent/caller must perform fresh admission, never reuse a stale free-space claim.

Capture600s; cleanup60s (existing bounded drain45s); post-release CPU inspection45s; cache copy64MiB/30s. Settled checks follow positive drain. Output has no staging/image archive copy; all failed output/metadata/consumption remains retained.

PARENT HANDOFF / NEXT PROPOSAL
HANDOFF-DATA.json contains the exact existing grant schema and example DATA only, actual pinned Python caller and Node child argv/env, all12output names, current source/readiness/path bindings, ledger and terminal acceptance paths. The legacy purpose string EFFECTS_GRAVITIC_PULL_SINGLE_DISABLED_PILOT is unchanged and must match the actual contract; it is not a claim that runtime flags are false. Do not materialize the example as a grant or independent receipt.

Fresh independent SOURCE/CPU review must match ec5221197dafd5acb2cb90b356d878e2360cd386/39428cfbdcd94e0739aa9ba368610a726959e0de. Historical independent MTL PASS at4795 and live-cache PASS atd16 cannot authorize this new pin. Parent then owns the serialized slot, fresh current admission/cache-owner checks and a distinct one-use grant. The caller uses the already pinned launcher /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 with -B and adjacent readiness; actual kernel path/hash is in HANDOFF-DATA/pythonRuntime. Actual Node22 child runs only through existing StationJob; parent need not write a replacement launcher.

Success still requires parent-observed actual OS exit0 plus exact result/consumption hashes via caller.parent_acceptance, complete segmented snapshots, errors=[], checksPassed=true, publication=AWAITING_PARENT_OS_EXIT_AND_HASHES, positive release and valid packet inspection. Disk accepted remainsfalse until that external observation. Result path /private/tmp/egp-f06f6009cba44ce7a4ff9c027e8bc68e/result.json; consumption path /private/tmp/egc-f06f6009cba44ce7a4ff9c027e8bc68e.json. Future entry/terminal/parts/failure-summary outputs follow unchanged evidence logic. Never accept a file alone or relaunch a consumed identity.

No new browser/GPU/codec/service/DB/Blender/native attempt, grant, screenshot cleanup, install, push, PR or merge was performed. Original b612 and pilot2 164 remain FAILED/SPENT forever. The exact SetStore executable remains unbound; no Apple binding changed in this unit. External XPC ownership stays unqualified. Native lifecycle acceptance and blind visual grading remain pending; remaining58roots/motion/T04/Recall playback are excluded.

EXACT CONDITIONAL EVIDENCE OUTPUTS
HANDOFF-DATA.runtimeEvidenceOutputs lists the fixed receipts, conditional failed-entry/result files, sequential bounded segment naming, cache-before root, helper/scratch/profile/private-TMP archive routes and existing stderr summary. Conditional outputs are not all expected on success. All writers/copies remain charged to the unchanged ledger. The future caller command and Node child command are DATA only and were not executed with authorization.
