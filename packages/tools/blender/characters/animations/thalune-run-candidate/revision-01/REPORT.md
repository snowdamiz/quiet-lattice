TASK: P1.E05.T02 — revision 01 of Thalune run capture source candidate
STATUS: DONE (two P2 source fixes; fresh independent source review remains with parent)
SUMMARY: Reproduced both independent review findings on20023a3845f351c18df9cf8cd95190bfa28a00e6/tree6a68e31908c4501cafde3d9d38b083d6c8a93ef1 using the reviewer's exact repro script and a byte-identical source copy. The corrected real adapter/dispatcher retains the original job error when final receipt persistence fails, preserves cleanup and write errors separately, and retains every raw or partial terminal audit observation before refusing release. Runtime remains disabled.

FILES CHANGED: caller.py and release_accounting.py; controls.py's inert launchctl result now includes stdout/stderr; new evidence-controls.py; refreshed readiness.json, candidate-index.json, source-audit.json; this new revision-01 evidence/report directory. Entry, page API, playback, worker, sink, budgets, assets, four readonly station helpers, original21-row recovery provenance and prior reports are unchanged. No orchestration docs, CPU library validation, native/GPU/browser/Blender work, hydration, push, PR, main or merge work.

VERIFY:
- RED: exact reviewer repro script against pinned20023a3 source copy reproduces both losses. First case retains FINAL_RECEIPT_WRITE_FAILURE as primary and loses ORIGINAL_START_FAILURE everywhere in proof. Second case loses unknownKernel and both registration streams. Preserved here as RED-results.json, RED-1-proof/, RED-2-proof/; no historical report was edited.
- GREEN: same unchanged reviewer repro script against corrected source copy: original start failure stays primary; final write failure is retained separately; refused audits preserve unknown kernel fields, registration exit/stdout/stderr, and explicit refusal reasons. Both cases HOLD, count one injected attempt, and start no later job. GREEN-review-repro-results.json, GREEN-1-proof/, GREEN-2-proof/ retain actual proof output. These are inert source fixtures, not native captures; the schema's nativeJobs field counts injected attempts.
- Existing suite:18 Node +108 Python controls PASS on a fresh source-identical scratch copy. All native child calls remain zero, and the Python suite proves no native-helper imports. Original successful reports in the candidate root remain unchanged; fresh reports are under this revision directory.
- Existing four disabled CLI controls PASS_EXPECTED_REFUSAL: caller --execute; optimized caller --preflight; Node entry; worker validate-primary. No output allocation or consumed-attempt file exists. Fresh argv/stdout/stderr are in disabled-entry-controls.json.
- New evidence-controls.py:20 PASS controls against the real StationAdapter.run, audit and run_sequence with inert OS/StationJob facts. Covers happy five-job dispatch, start/final-write combinations, simultaneous cleanup and persistence failures, both receipt proof writes failing, initial write failure, registration/kernel/member/birth/scratch/private refusal, partial kernel/member/birth/registration read errors, pre-archive kernel/member refusal, unknown-field retention, separate successive observations and oversized-summary fallback with exact proof hash.
- Total:150 controls (130 existing +20 new), plus the two exact reviewer repros rerun RED/GREEN. Zero native/runtime jobs.
- freeze.py: PASS,20 frozen Python/JS/helper sources,27 source/data bindings, four software bindings; all current frozen bytes match.
- caller.py --preflight: PASS_SOURCE_ONLY_RUNTIME_DISABLED;378 motion frames,8 stills,5 planned jobs,0 runtime jobs.
- All21 recovery rows reverified against their exact source commits;11 exact-mode destinations match original bytes. Entry/playback/page API, recovered assets/helpers and old reports are additionally checked unchanged against20023a3. preservation.json records this boundary.
- git diff --check and staged scope/hash checks: PASS before commit. Whole-library CPU validation belongs to the separate worker and was neither duplicated nor awaited.

DECISIONS:
- P2 final receipt write → register the live receipt on its attempt handle before any fallible work; final persist records its own failure and returns the complete receipt; dispatcher preserves original/cleanup/persistence cause precedence plus separate dispatch failures. Terminal accounting includes full fallback receipts when disk evidence is stale, missing or refused. Failure still stops later dispatch.
- P2 terminal audit → append an unaccepted audit record before reads, attach each result as it arrives, preserve partial birth and registration observations, then check named release predicates. Failed audit records remain releaseProved=false and survive both stage cleanup and final attempted-job accounting. Pre-archive kernel/member observations are also retained before checking.
- Retention → the first and final audit reads remain distinct. Large complete summaries stay in proof/result.json and use the existing bounded packet reference path; no new compression, deletion or media budgeting change. CPU evidence does not establish runtime release, capture quality or visual acceptance.

OUT OF SCOPE FOUND: No new library or art acceptance. Parent owns the next fresh review with prior findings, current resource evidence and eventual scheduling. Runtime routes/admission, native189-frame qualification, actual capture and visual grading remain pending; E05.T04 gameplay integration remains separate. These changes create no new approval stage.

ARTIFACTS: This revision report; independent-review-20023a3.md and exact review-repro.py; RED/GREEN results and full two-case proof directories; evidence-controls.json (20 cases with proof paths/hashes); fresh Node/Python/disabled/preflight reports; provenance.json; preservation.json. The root source-audit.json covers current source and these artifacts; original root REPORT.md remains the historical20023a3 report.

EXACT COMMANDS:
- /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node /private/var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/thalune-revision-baseline-bvy8a5w0/candidate/controls.mjs → exit 0
- /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /private/var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/thalune-revision-baseline-bvy8a5w0/candidate/controls.py → exit 0
- /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/caller.py --preflight → exit 0
- /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/caller.py --execute → exit 1 (expected refusal)
- /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B -O /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/caller.py --preflight → exit 1 (expected refusal)
- /Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/entry.mjs /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/readiness.json motion-thalune-run-lod0 /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/future-attempt/packet/captures/motion-thalune-run-lod0 → exit 1 (expected refusal)
- /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/rgb-primary.py validate-primary /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/no-config.json → exit 1 (expected refusal)
- /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/evidence-controls.py --report /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/revision-01/evidence-controls.json →20 PASS; zero native calls
- /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/freeze.py → source freeze PASS

EXACT SOURCE/PROVENANCE:
- Original base:e1ed4752805ee92be561db81910ee1bc1a87b1d9. Revision parent:20023a3845f351c18df9cf8cd95190bfa28a00e6; tree6a68e31908c4501cafde3d9d38b083d6c8a93ef1.
- Same isolated branch:codex/task/P1-E05-T02-thalune-reel-candidate. Exact correction commit/tree returned in final handoff.
- Retained animation:49ae87cbdb8671f7988b1bed4358d49d4cdc6b58; reviewed integration:906721560c059fc12962e7b44cbe067303136a47; historical132-frame proof:84d98bfdf09c0c25dcdec54bc74441324a91866f; readonly station helpers:ca7d91e378e9d2f3f0ce8f0651475dcb843875d9. No retained branch changed.
- caller.py: SHA256 286213e87852e97e99fe8217eb91f1604a4d9e04b799ffb649056ff863fd1cb3
- release_accounting.py: SHA256 93fc7a7a7b6503ab5593fc0384e354848cfc4ec5753c4e43d7503997dae3ba60
- controls.py: SHA256 59e847fedebca4078cc3a61230f26d62448ed6aa534aa861e2172d796b25a314
- evidence-controls.py: SHA256 e9f9ca838647ffd474f9b0f9dc377816e67c6b1112c86af26d7632b0eea731c1
- readiness.json: SHA256 a6ad6ef8425a2997ebbfbe3a53eff5e831735a1a9f01c3f842c90dc935586574
- candidate-index.json: SHA256 c19ebbabec9f6b733eb42460d6191c97a5aac4f71df82729e2e29d920fa62863
- recovery-provenance.json: SHA256 6bd3f2a88cb28062e342a0b4a7345dc73d318dda864cb66f0714e1e9c5d87c38
- revision-01/independent-review-20023a3.md: SHA256 3e26d8159710e35ef9bd06f595c1ab31c0d1c71efc05c4f9a3262325aeb34a95
- revision-01/review-repro.py: SHA256 d4d898b8b0f8ec21936e299d2a574a23a0c0708ac492f7c5e25d25cc97fad059
- revision-01/RED-results.json: SHA256 7d0b741396afc3927d18f1c5851cb3ccdfa3a730fbb4cb381558dd9a6bc75dba
- revision-01/GREEN-review-repro-results.json: SHA256 80d42bdfa0dfc0d36eecc60561cde4f0dc3b49aa439f4bed403fbef09bdc249d
- revision-01/evidence-controls.json: SHA256 2373b47e50fbf51d6e8432f642c416543c56b661d3d5ecad1393b4147d7ccbca
- revision-01/provenance.json: SHA256 855815598f3f24755dafd5c5d4ced5e06c67eb468f4e023c122221e065935a85
