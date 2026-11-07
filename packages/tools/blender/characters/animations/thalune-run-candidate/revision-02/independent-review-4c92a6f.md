VERDICT: REVISE — bounded source/CPU unit only.

Head: 4c92a6f6fe11dc687b80b45ada324f23f61c0f8a
Tree: c7c5b236c5d5d926bdda71f43d6dc77e40bc7787
Baseline candidate: 20023a3845f351c18df9cf8cd95190bfa28a00e6
Original base: e1ed4752805ee92be561db81910ee1bc1a87b1d9
Branch: codex/task/P1-E05-T02-thalune-reel-candidate
Checkout: /Users/andreyyurlov/.t3/worktrees/space/t3-11167406
A: packages/tools/blender/characters/animations/thalune-run-candidate
Review evidence: /tmp/thalune-review2-4c92a6f-8cvwkvf7

Fresh independent round 2. Read the supplied task/evidence, prior reviewer report and exact repro, current source diff and reports, not the worker transcript. No source edits, commits, branch changes, nested agents, GPU/browser/Blender/native encoder/native decoder launches, hydration, DB, PR, merge, or grant consumption. The checkout stayed clean at the exact requested head/tree. Test/report writes were confined to scratch. Parent owns full smoke/GPU work.

Prior findings:

1. FIXED at the originally reported adapter boundary — original caller.py:219 final receipt persistence replacing the job failure. Current caller.py:151 attaches the live receipt to its attempt handle; :229–231 records and contains the final receipt write failure; :108–109 and :125–130 preserve job/cleanup/persistence precedence. I independently reran the unchanged prior adverse.py against byte-identical old and new snapshots. Old: primary FINAL_RECEIPT_WRITE_FAILURE and no retained ORIGINAL_START_FAILURE. New: primary ORIGINAL_START_FAILURE, separate final write failure, HOLD, exactly one attempted/started job, and no later dispatch. The broader combined-failure requirement remains open as R2-1 below.

2. FIXED at the originally reported audit boundary — original caller.py:229–234 losing refused raw observations. Current caller.py:236–264 registers a nonaccepted observation before reads, appends partial values, and names refusal predicates. release_accounting.py:59–64 retains refused terminal observations. The unchanged prior repro is RED on the old snapshot and GREEN here: unknownKernel and launch registration exit/stdout/stderr survive; refusal is explicitly “Launch registration is still present”; HOLD and one attempt/start remain. Fresh supplied controls cover registration, kernel/member, birth, scratch/private namespaces, partial reads/timeouts, unknown fields, and separate successive observations. R2-1 also affects delivery of these correctly retained observations if the fallback proof write fails.

Blocking finding R2-1 [P2]: failure of the terminal proof fallback again replaces the original error and prevents evidence from escaping the dispatcher.

Location: A/release_accounting.py:94–98 (ordinary branch :97; oversized branch :94), called without protection at A/caller.py:131–133. The new receiptFallbacks object is built at release_accounting.py:87, but save(proof/'result.json', result) and the subsequent packet write are still unguarded. run_sequence cannot return result if either operation raises; main only prints result after that return (caller.py:295–297).

Concrete reproduction uses the real StationAdapter.run/audit and run_sequence, with inert StationJob/OS facts:

- Job.start raises RuntimeError('ORIGINAL_START_FAILURE').
- Final job receipt write fails with FINAL_RECEIPT_WRITE_FAILURE.
- The dispatcher’s returned-receipts write fails with RETURNED_RECEIPTS_WRITE_FAILURE.
- Terminal proof/result.json fails with TERMINAL_PROOF_WRITE_FAILURE. The packet writer is untouched and available.

Observed: exactly one start and no later dispatch, but run_sequence raises only a bare OSError('TERMINAL_PROOF_WRITE_FAILURE') with empty details. It returns no result/receipt. The durable proof contains no ORIGINAL_START_FAILURE, no final-receipt failure and no raw terminal audit data; packet/integration-result.json is never attempted. The full original data exists on the internal attempt handle, confirmed by reviewer instrumentation, but the public boundary does not return it or attach it to the raised error. Python’s final uncaught traceback does not serialize those local dictionaries.

This is not a request for infallible storage: the required in-memory result can survive a write failure and the independent packet path can be attempted. A common loss of writes to the proof namespace can cause all three persistence failures. The same loss reproduced with an additional cleanup failure and with small/oversized refused raw audits. For the oversized case, the complete audit payload also disappears from caller-visible evidence when the proof reference target cannot be written. A separate packet-write-failure control confirms the dispatcher still throws, though in that variant the successful proof/result.json DOES retain the original evidence; that variant alone is not claimed as durable evidence loss.

Required correction: make terminal evidence delivery preserve a complete HOLD result or a structured failure carrying that result, including original, cleanup and every persistence error, even when summary persistence fails. Keep fallback proof and packet persistence separately guarded; do not claim a valid reference to an unwritten proof. Ensure the outer caller can emit the complete in-memory evidence. Later jobs must remain stopped. Add actual-adapter/dispatcher controls for terminal proof and packet failures after earlier receipt failures, including oversized refused audits. No change was made by this reviewer.

Reproduce R2-1:

    /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /tmp/thalune-review2-4c92a6f-8cvwkvf7/combined-adverse.py

The script creates a new combined-run-* directory per invocation. Latest verified run: /tmp/thalune-review2-4c92a6f-8cvwkvf7/combined-run-hargkkgb. Read combined-results.json and combined-proofs/. The *-instrumentation.json files are REVIEWER evidence outside the candidate’s proof/packet directories, not artifacts retained by the implementation. Eight scenarios executed: four proof-fallback losses, one packet-write throw with durable proof surviving, successful summary fallback, refused first audit followed by a successful final audit, and happy five-job order. Native calls and native-helper imports: zero. Test-runner exit 0 means the reported behavior reproduced, not that the source contract passed.

Additional acceptance check: refused-first-audit-recovers remains HOLD with terminalReleaseProved=false despite the final individual audit returning releaseProved=true. The first failed observation survives. Evidence retention does not promote failed cleanup into acceptance. Happy inert dispatch orders both reels, stills, and then both validators; all other combined cases stop after the first job.

Fresh verification:

- 18 Node + 108 Python existing controls PASS; 20 new supplied evidence controls PASS. Their reported native child calls are zero; Python assertions verify no station-helper imports. Four actual CLI refusal controls also PASS_EXPECTED_REFUSAL, for 150 supplied controls independently rerun. The supplied suites do not exercise terminal-summary write failure, and their pass does not contradict R2-1.
- caller --preflight returns PASS_SOURCE_ONLY_RUNTIME_DISABLED, 378 motion frames, eight stills, five planned jobs, zero runtime jobs.
- caller --execute, optimized Python caller --execute, Node entry, and worker validate-primary all refuse before runtime/output allocation. future-attempt and consumed-attempt.json remain absent. Exact argv/stdout/stderr: disabled-results.json.
- Original exact reviewer script is byte-identical (SHA256 d4d898b8b0f8ec21936e299d2a574a23a0c0708ac492f7c5e25d25cc97fad059). Both cases independently ran RED on 20023a3 and GREEN on 4c92a6f. Raw proof copies: exact-repro-proofs/red-1, red-2, green-1, green-2; outputs: isolated/{red,green}/adverse-results.json.
- All 21 recovery rows were freshly read with git show at their exact commits; SHA256 matches; all 11 exact-mode destinations match. All 23 candidate-index entries and 65 source-audit entries match bytes/hashes. All 27 source/data and four software bindings match. provenance-results.json records the checks. No freeze operation or binding rewrite was performed.
- Revision scope: only A changes, with 6 existing files changed and 38 additions. Entry, playback, page API, sink/worker/inspectors/budgets, animation data, exact station helpers and original recovery mapping are unchanged from 20023a3. Original-base diff remains additions only in A and the four retained animation data paths.
- Original root reports/control reports remain byte-identical to 20023a3. The prior independent report matches revision-01/independent-review-20023a3.md at SHA256 3e26d8159710e35ef9bd06f595c1ab31c0d1c71efc05c4f9a3262325aeb34a95. Root REPORT.md remains 80dea3ed5d347d95d73f4e2f41503ae1b808e07b2d91f45087099f98cb6fe7a7 and root red-controls.json remains 3928b1e490366265ec497d03532d38e0d313b5d6b234c55458b2cd8af27da33d. original-round1-evidence-hashes.json records all prior scratch report/proof hashes. No old failed report was overwritten or reclassified.
- Storage arithmetic independently matches 19,493,289,984 bytes: four copies of unit-plus-retained-fixture, nine archive slots, Git reserve, staging reserve and 4 GiB safety. Historical accounting SHA256 matches 2c5665c31c3189d1822560534c0220f2ab7a33010854068ce08964ad5b85519b at 84d98bfdf09c0c25dcdec54bc74441324a91866f. This proves ledger arithmetic/provenance, not current disk/RSS/cache admission.
- git diff --check e1ed4752805ee92be561db81910ee1bc1a87b1d9..4c92a6f6fe11dc687b80b45ada324f23f61c0f8a: PASS. Clean status and pinned head/tree rechecked after tests.

Commands for supplied controls and exact repros (Python suite consumes the Node synthetic fixture):

    node /tmp/thalune-review2-4c92a6f-8cvwkvf7/isolated/green/candidate/controls.mjs
    /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /tmp/thalune-review2-4c92a6f-8cvwkvf7/isolated/green/candidate/controls.py
    /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /tmp/thalune-review2-4c92a6f-8cvwkvf7/isolated/green/candidate/evidence-controls.py --report /tmp/thalune-review2-4c92a6f-8cvwkvf7/isolated/green/evidence-controls.json
    /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /tmp/thalune-review2-4c92a6f-8cvwkvf7/isolated/red/adverse.py
    /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /tmp/thalune-review2-4c92a6f-8cvwkvf7/isolated/green/adverse.py
    python3 -B /tmp/thalune-review2-4c92a6f-8cvwkvf7/provenance-check.py
    python3 -B /tmp/thalune-review2-4c92a6f-8cvwkvf7/disabled-check.py

Controls that write beside source ran only on snapshots whose bytes were checked against git/show and the checkout before execution; source-copy.json records those initial identities. Only synthetic control reports change in those snapshots. Reviewer harness setup notes: an initially shallow scratch path hit contract.HERE.parents[5] before Python controls could import; moving the unmodified snapshot one directory deeper resolved it. The initial optimized-CLI harness expected a traceback; corrected to the actual T02_ASSERTIONS_REQUIRED message. These were harness corrections, not source failures or hidden reruns of native work.

Scope and limits:

Read IMPLEMENTATION_PLAN 0.3, 0.9.5, E05.T01/T02/T04 and relevant art/visual rules, DESIGN 5/19, and art-bible shared-rig conventions. No additional authority/demo/spec finding was substantiated in this bounded revision.

Unchanged source and fresh controls still enforce two 189-frame LOD0/LOD2 reels (15 lead-in + 3x48 loop frames + 30 final-pose frames), eight stills at 0.4 s, one render and matching poses, awaiting each ACK before the next frame, and unknown observation retention. Media, inspector outputs and raw native logs have distinct paths. Per-reel ceiling remains 39,354,368 bytes; still ceiling 12,582,912; observation ceiling 262,144; aggregate metadata 361,234,432; 512 files; 131,072-byte reserved records; atomic old-plus-temporary metadata peaks counted. Acceptance remains exactly 189 ordered 60 Hz frames with PTS/RGB/RGBA/hash/opaque-alpha checks. A 190th probed/decoded frame is solely a surplus-refusal bound. The archive cap is post-release acceptance, not a hard quota.

All execution here used CPU/synthetic artifacts or inert dependencies. No fresh render, capture, native encode/decode, actual-three-body playback, Blender/asset validation, runtime release, total-RSS qualification or visual acceptance is claimed. Browser/tsx/executable bindings, required hydration, fresh capacity admission, the parent's GPU holder/grant, native 189-frame qualification and visual grading remain parent runtime prerequisites, not automatic source findings. E05.T04 remains separate. The 42-clip/actual-three-body lane at 07768bf was neither changed nor graded here. Parent smoke remains pending in this review. No runtime or merge authorization is implied by any source/control result.
