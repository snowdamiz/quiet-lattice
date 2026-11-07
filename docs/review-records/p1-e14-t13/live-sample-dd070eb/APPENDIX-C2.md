# Appendix C.2 — T13 live resource sampling and exact Metal compiler prerequisite

SOURCE implementation and focused CPU evidence only, for fresh parent-owned independent review. Whole T13 timing remains inconclusive. No new native attempt, grant or readiness enablement occurred.

## Pins and scope

- Worktree /Users/andreyyurlov/.t3/worktrees/space/t3-e8c6f9e8; branch codex/task/P1-E14-T13-trace-observer.
- Exact base 7c134b6aa29f2abedba347d91aed28323fd93006, tree6a739c3d3c546a27dc87bf3af22f943c5164a8e9. Independent source PASS for that pin: /private/tmp/p1-e14-t13-source-review.EtBSg1Hy/APPENDIX-C2.md. Its native attempt is separately FAILED/SPENT.
- Live-sampling correction commit ef43d163b3a045c492bd8271e2a241a4689987ce, treefed6ae9db09acc5b753d0fe256587498a0d4fecb.
- Late parent-authorized exact Metal compiler binding commit/final clean HEAD dd070eb0233e242eed6ec4e62d5d7f8857d6dc21, tree55425ed6c5d0fed5d0b04cbec30dca2c3bd0692c.
- Five owned files: metadata.py, launch.py, controller_controls.py, new live_controls.py and local-binding.json. Total396 insertions/12 deletions. No recovery required. source-hashes.json gives exact base/current SHA256; correction.patch preserves the first commit's patch and metal-prerequisite/binding.patch the second.
- No protected helper, T15/capture/openReview, protocol/report algorithm, renderer/Engine/Atmosphere, Review, asset, authoring or orchestration-doc edit. Final Git scope is exhaustive for tracked changes. protected-source-hashes.json and protected-metadata-algorithms.json under combined-final verify hashes/AST. Every preexisting metadata function/class is unchanged except ledger's initial dispatch to the new sampler; its remaining strict body is identical. launch.py outside observe_body is identical AST, including primary/raw failure retention, drain, copy, archive, final inventories and candidate acceptance.

## Actual second failed shot retained

Parent /private/tmp/space-t13-parent-native-r2-zn33_z7o recorded exit1 after12.828292290971149 seconds, finished2026-11-07T10:08:20.566792Z, before browser launch or timing samples. Original result /private/tmp/t13-observer-native-5ba6b515/result.json SHA256610872bcc941ee24e2de5ec700dff46302d115aaf41aeb9ed649323b64264350, 18507564 bytes. Full failed metadata was read through the anchored reader with an explicit offline32MiB cap and authenticated to the parent hash. Production16MiB metadata admission was not changed.

Actual stored state: accepted:false, candidate:false, captureExit:-15, lifecycle.clean:false/drained:true, capture and caffeinate exits-15, kernel_terminal coalition_absent:true/live0; physicalSettlement:UNPROVED; terminalPublication durable:false/provisional:true. Primary Refused: Incomplete ledger: Enumerated entry changed. Its raw partial inventory contains86 records/32452 bytes, including77 zero-sized file observations during cache creation. The secondary empty-message AssertionError is retained exactly, not treated as no failure.

This attempt successfully preserved private TMP and removed its own namespace during the original drain/archive: tmpRelease.all_bytes_preserved:true and namespace_removed:true, archive /private/tmp/t13-observer-native-5ba6b515/preserved-private-tmp. Parent's separate10:09:48.004951Z observation records seven known PIDs absent, registration113, /private/tmp/sbr-_00jowa6 absent, GPU released, browserLaunchObserved:false and timingSamples:0. The unchanged retained terminal_audit also requires clean:true, so this failed work remains stored UNPROVED. No receipt was rewritten to adopt the parent's release observation as success.

preservation-before.json and combined-final/preservation-final.json prove unchanged bytes/hashes/stamps/inventories for the spent output119 records/37007970 bytes, parent packet9/16175268, fallback0, consumed grant1/751, enabled readiness/grant and old7c frozen bundle15781 records/299126889 bytes. The prior66ce failed packet, spent grant/readiness/consumption/fallback, retained /private/tmp/sbr-_notzfdy and its frozen bundle (including prior Vite caches) are also rechecked unchanged against retained baselines. The absent second namespace was not recreated. No original or historical artifact was deleted, overwritten or retried.

## Premise and exact-base RED

premise.txt was written before implementation: “one-pass live resource observation can require unchanged full stat stamps and enumerated paths while ordinary owned writers create, append and atomically rename cache entries.” Deterministic writer-thread barriers at actual os.stat/os.open boundaries disproved that premise before product edits:

- Append to the initially zero-sized regular file: Enumerated entry changed.
- Create a file in a sampled directory: Enumerated directory replaced, solely from mutable stat fields.
- Rename deps_temp after enumeration but before stat or open: ENOENT becomes fatal Incomplete ledger.

red-live-ledger/results.json and stdout/stderr retain all four actual filesystem failures; desired assertion exit1. No sleeps or synthetic successful receipts substitute for the real operations. The rename shape covers the disappearing deps_temp class cited from fauna; fauna's source/runtime was not changed or qualified here.

A second whole-controller RED loads exact7c metadata.py and launch.py Git blobs, with unchanged retained StationJob/StageReceipts bodies and inert native/kernel/process ports. An ordinary writer changes a private-TMP file at the actual ledger boundary. Actual controller returns the original Enumerated entry changed primary plus partial records; desired positive assertion exits1. All RED fixtures/results/failure tails are preserved, including exact loaded base bytes.

## Structural policy correction

Non-hashing live ledger calls now dispatch to task-local sample_inventory. Strict inventory, source/dependency admission, file hashing, copy_tree and settled terminal ledgers retain their exact algorithms. Hashing with live=True continues through the old strict path; no content hash consumes a mutable sampled stamp.

The live result has distinct kind T13_LIVE_RESOURCE_SAMPLE_V1, sampleComplete:true only when the bounded walk finishes, complete:false always, liveObservationOnly:true, contentBytesRead:0 and quotaGuaranteed:false. It is an interval of per-entry metadata observations, not a point-in-time inventory or accepted settlement proof. A sampled zero size means zero at that observation; later growth can occur. The next sample enforces newly observed sizes, and final settled inventory/hash/copy remains mandatory. No OS quota or future size guarantee is asserted.

- All enumerated names, including disappeared entries, consume the count ceiling. Observed sizes consume the byte ceiling; observed symlink target bytes also charge any growth beyond the earlier lstat size. New entries after enumeration may be absent from this interval sample; the result explicitly does not claim completeness.
- Held no-follow directory descriptors anchor the root and every ancestor. Files/FIFOs/sockets/symlinks are metadata-only: no payload open/read, no symlink following. Unknown types/owner mismatches are refused.
- Only ENOENT at an already enumerated child stat/open/readlink is recorded as a vanished transition. Root/ancestor failures, enumeration failures, permission/I/O errors and symlink substitution at a directory open still fail closed. Replaced directory identities before open are recorded with both stamps and are not traversed. A directory renamed while held remains observed through its original descriptor, with no stable-path claim.
- Directory identity comparisons use device/inode/type-mode/UID, not changing size/mtime/ctime. Root/ancestor substitution remains fatal. Descriptors close on success, failure and actual deadline interruption; primary/unknown data and secondary close errors survive.
- The existing capture-phase deadline bounds live traversal. There is no retry loop, generic scheduler, new native controller or changed capture/drain/terminal envelope.

observe_body applies this live policy to all four active-writer roots: frozen runtime (Vite can create cache), controller scratch, output and private TMP. It retains latest per-root summaries and transition records, explicitly omitting stable entry detail/history. Failed samples still preserve complete bounded partial/error facts through the unchanged first-observer failure path. Latest summaries cannot satisfy terminal acceptance; independently completed settled ledgers and existing physical/clean/exit requirements still decide candidate status.

## Focused CPU proof

All58 focused cases pass:11 live tests,7 prior filesystem boundary tests,16 admission tests and24 controller cases. Their internal subcases additionally exercise ordinary append/create/rename/replacement, zero-size sampled growth versus next-sample refusal, strict hash/copy rejection of changed admitted bytes, symlink/FIFO metadata safety, no payload reads, count/byte/link-growth limits, unknown EIO facts, root/ancestor rename+symlink, child directory-to-symlink refusal, held-directory rename, actual deadline interruption and close-after-error descriptor cleanup.

Three new whole-controller cases mutate private TMP, active output and frozen runtime through actual writer boundaries. Each now reaches the unchanged settled archive/audit with inert candidate:true; final frozen/output ledgers are complete while every live sample remains complete:false. Existing namespace-mode, uncertain bootstrap, observer raw/error, pre-drain deadline/owned harmless CPU child, ledger and sink-failure controls pass. These are source/CPU proofs, not native outcomes. At most two small CPU execution contexts were active; heavy work was not resumed.

Python AST syntax, scoped JSON formatting and working/committed diff checks exit0. No Python linter/formatter is configured; no ignored ESLint invocation is counted as coverage. TypeScript and broad632/64/T15 suites remain unchanged prior evidence and were not rerun. No heavy/full/Blender/art/codec/browser/server/DB/install run occurred.

## Late concrete Metal compiler prerequisite

Before sealing, parent supplied actual VM evidence at /private/tmp/p1-e05-t03-viewmodel-packet-r5-rdtnxbus/review-thalune/job and /private/tmp/space-vm-parent-unit1-r5-kghan_6a. Read boundary.json, observed_execution.json and capture_stdout.txt; their original stamps/hashes are retained in metal-prerequisite/vm-originals.json and rechecked in combined-final/vm-originals-verified.json.

VM browser54622 was headless-shell1248, with ANGLE/Metal requested. T13 pins full Chromium1248 and uses the unchanged capture.glArgs Metal arguments through launchServer. These browser executables differ; they are not claimed byte-equivalent. Both reach the same OS Metal compiler service path. VM actually recorded PID55005, PPID1, UID501, birth[1794046928,112755], coalition[42831,42832], role owned-launch-helper, admitted:false. Its own failed work/drain/cleanfalse/missing-result defect remains separate; no cross-lane runtime PASS is claimed.

The T13 binding lacked this exact path:
`/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/MTLCompilerService.xpc/Contents/MacOS/MTLCompilerService`

Current canonical regular file: UID0/mode0755,389760 bytes, SHA25665af927ce641351e604bf36da7a664e5350d583483c7e5f3fe799e0d0db7a78b, no group/other write and not writable by callerUID501. Descriptor-admitted identity/hash is stable before/after read-only signature inspection. codesign exact strict verification exits0 for `identifier "com.apple.MTLCompilerService" and anchor apple`; platform26, CDHash0564f4ea2063dbc3a9de0ac47ded14661384d230. Wrong identifier exits3. Commands have5s limits, total20s observation deadline and checked64KiB output bound. The service itself was not started.

Actual-member replay imports VM's recorded kernel member/cohort into T13's real observer/controller through inert ports. Actual process creation and signals are explicitly trapped; the recorded PID is never acted upon. Missing binding yields the exact Unbound owned executable primary (RED exit1). Seven modes then pass: exact binding, missing row refusal, wrong UID, changed birth, wrong coalition, another executable path, and outside-cohort absence. Runtime preflight also refuses a false expected Metal SHA. This substantiates a conditional prerequisite gap without asserting that T13 has already observed this service.

The final config commit retains all547 previous binary rows in order and adds exactly this548th path/hash plus signed provenance. No helper/renderer change, wildcard Apple allowance, changed ownership policy or broad discovery change. Current UID/birth/cohort/executable membership still applies at runtime; external XPC ownership and all-ever-lived process coverage remain unqualified. No extra grant or native work was performed.

## Final disabled freeze and precise next launch

The ef43 correction was committed/frozen before the late user evidence; that disabled checkpoint and proofs remain preserved. One additional combined freeze was necessary after the authorized config-only prerequisite addition. Use only the final combined proposal below; neither checkpoint has run native or received a real grant.

- Final readiness /private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/frozen-dd070eb02/readiness.json
- SHA256 ef0311ecabde0d5ec187fdb2f938933bcb80b44ad199abe055d73516c48bd359, 7898054 bytes (<16MiB).
- Binding SHA256 3172f65d4b58dc4e67a525156f76a7af3212d4435152ded107601d9cfdf48fcb.
-514 source records/47588774 bytes;13222 dependency records/243636268 regular bytes;548 binary rows. Full exact source/dependency/hash records are in readiness.
- Actual freezer and verify_freeze exit0. False expected Metal hash is rejected. Actual frozen Python disabled CLI exits2; Node22.23.3 --owned disabled CLI exits1 before native imports/allocations. NEXT_LAUNCH.sh received shell syntax checking only, exit0.
- combined-final/closure-comparison.json proves dependency records/stamps, asset, purpose, plan, bounds and limits unchanged from7c. Binding differs only by five fresh identity fields and the one exact Metal addition. Source differences are exactly the five scoped files.
- Capacity observation 20475592704 available bytes; minimum8589934592. Capacity must be read again at admission. Existing count/byte ceilings are not an OS quota.

Final command proposal, NOT EXECUTED:

```sh
/private/tmp/p1-e14-t13-live-sample-rktfx3l5/combined-final/NEXT_LAUNCH.sh <parent-enabled-readiness-sha256> <fresh-grant-sha256>
```

NEXT_LAUNCH.json under combined-final supplies every path, binary/dependency pin, bound and grant field. New paths are absent: enabled readiness /private/tmp/t13-observer-enabled-readiness-161689e0.json; grant /private/tmp/t13-observer-grant-161689e0.json; consumption /private/tmp/t13-observer-consumed-161689e0; output /private/tmp/t13-observer-native-161689e0; fallback /private/tmp/t13-observer-fallback-161689e0. Prefix bwt-161689e0a22541e0bb0dbc296f6576e8. All source/binding/readiness runtime flags remainfalse.

After fresh independent review, parent owns separate enablement, one-use purpose/exact-head/tree/readiness/plan/output/consumption grant with future expiry<=3600s, fresh capacity and explicit GPU reservation/quiesced heavy-CPU contract. Load ceilings[7.5,10,15], external contenders unknown-not-excluded. Metal/Apple M5 Pro remains an expectation; actual backend/device and complete pre/post host/load must be observed. Native physical child/birth/UID/cohort, drain/profile/TMP/archive/terminal proof and parent-observed actual OS exit0 plus bounded hashes remain required. No accepted/candidate/provisional disk flag admits a successor. Original7b836b7a and5ba6b515 attempts stay spent and are not reused.

Protocol remains five alternating unchanged reference trace-on/off pairs plus one fence-only control per arm;1920x1080 Thalune suit2/noon-lush with natural history/framework/render work.12 preparations<=7200 warmups,10 measured frames,48 dependent passes,36 preflight fences,24 control fences,6 on segments,64MiB/250000 events/1024 reads,0 PNG/timer queries. Capture/drain/terminal1009100/306100/1315200ms unchanged. Off tracing stayszero, on covers preparation/control. Decision thresholds/mixed-sign/zero policy unchanged. No performance/16.67ms qualification exists; cloud03 remains FAILED/accepted:false.

Exact argv/exits/times are in commands.jsonl, commands.md and combined-final/disabled-commands.json; named stdout/stderr and RED tails remain. Fresh independent review is parent-owned. No push/PR/merge, orchestration-doc write, screenshot cleanup, hydration, original namespace cleanup, install, heavy-work release, browser/GPU/native retry or real grant occurred.
