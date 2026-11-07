VERDICT: REVISE — bounded source unit only.

Head: 20023a3845f351c18df9cf8cd95190bfa28a00e6
Tree: 6a68e31908c4501cafde3d9d38b083d6c8a93ef1
Base: e1ed4752805ee92be561db81910ee1bc1a87b1d9
Branch: codex/task/P1-E05-T02-thalune-reel-candidate
Checkout: /Users/andreyyurlov/.t3/worktrees/space/t3-11167406
A: /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate
Independent reviewer; first review round. No checkout edits, commits, nested agents, GPU/browser/native encoder/decoder/Blender launches, hydration, grant consumption, or orchestration-document changes. Original checkout clean before and after review. Only scratch files and this report were written.

Two blocking source findings remain. These concern the proposed runtime's evidence paths even after browser/tsx bindings, hydration and capacity preparation; they are not objections to currently disabled runtime or incomplete whole-library art acceptance.

1. [P2] Final receipt persistence failure replaces the primary job failure.
   Location: A/caller.py:219 (also 147–151, 196–197, 106 and 124–127).
   StationAdapter.run catches the original job exception and stores it only in its local receipt. Its unconditional final persist() rethrows on a write error before the receipt can return. run_sequence then records this new write exception as primaryFailure; the attempt handle holds no receipt fallback. Thus cleanup/persistence obscures the original error and complete attempted-job evidence is lost.
   Fresh reproduction uses the real StationAdapter.run and run_sequence, with inert StationJob/OS dependencies: start raises RuntimeError('ORIGINAL_START_FAILURE'); only the final receipt write raises OSError('FINAL_RECEIPT_WRITE_FAILURE'). All other proof writes remain available. Result: HOLD, nativeJobs=1, exactly one start, no later dispatch, but primaryFailure is the OSError and ORIGINAL_START_FAILURE appears nowhere in the retained proof JSON. The old receipt still contains primaryFailure=null. See adverse-results.json mode final-receipt-write-after-start-error and adverse-1-proof/.
   Required correction: retain the in-memory attempted receipt on the registered handle or carry it on a structured failure before fallible writes; preserve the first job error and record receipt-write failures separately through another available proof/summary path. Add an actual-adapter-plus-dispatcher regression that asserts both errors survive and later jobs do not start.

2. [P2] Refused terminal audits discard the raw release observations.
   Location: A/caller.py:229–234; callers 213–218; A/release_accounting.py:58–60.
   audit() builds an item containing kernel, members, birth observations, registration exit and absence facts, then asserts before returning or persisting it. If any predicate fails, the cleanup receipt receives only an exception and terminal remains null; the terminal summary repeats the audit and again retains only an exception. In particular the assertions have no message, so the result does not identify the failed release fact. launchctl stdout/stderr are also discarded.
   Fresh real-adapter/dispatcher reproduction supplies a successful drain/archive/cache release and registrationExit=0, with a distinguishable unknownKernel raw field. Result: HOLD, one attempted job, later dispatch stopped, terminal audit count zero; both the kernel observation and registration result are absent from all proof JSON. Only blank AssertionError records and the aggregate accounting failure survive. See adverse-results.json mode raw-audit-refusal and adverse-2-proof/.
   Required correction: attach or durably persist each raw/partial audit observation before validation; preserve it on refusal alongside the explicit predicate/error. Acceptance may remain false, but evidence must survive. Test refusal branches for registration, kernel/member, birth, and scratch/private namespace checks with unknown fields retained.

Prior corrections rechecked:
- Attempt registration before mkdir/private allocation/constructor/start: present at caller.py:101–105. Five failure-position controls plus actual adapter allocation/partial-constructor/start/drain/archive/cache controls pass.
- Raw release observations: drain/profile/cache payloads are retained on their successful reads, but rejected terminal observations are lost (finding 2).
- Original failure versus cleanup: ordinary cleanup errors remain separate, but final receipt-write failure replaces the original job error (finding 1).
- Archive/copies accounting: proposed arithmetic matches 19,493,289,984 bytes. Four retained packet copies, historical upfront fixture, nine archive slots (four prior + five new), Git/staging reserves and 4 GiB safety are included. The 1 GiB archive cap is checked after release, not a hard growth quota or present storage admission.

Provenance and scope checks:
- All 21 recovery rows independently read with git show <exact commit>:<source>; all source SHA256 values match. All 11 exact-mode destinations match bytes, including four ca7d91e378e9d2f3f0ce8f0651475dcb843875d9 helpers, page-api.mjs, playback.mjs, manifest/source-bind, and two LFS pointers. Ten adapted rows were compared against retained sources (adaptations.diff).
- All 22 candidate-index entries and all 27 source-audit file entries match actual byte counts and SHA256. caller --preflight validates 26 source/data bindings and four software bindings.
- Retained animation commit: 49ae87cbdb8671f7988b1bed4358d49d4cdc6b58. Reviewed primary commit 906721560c059fc12962e7b44cbe067303136a47 is available; observe_executables and identity helpers remain AST-identical. persist_terminal_summary differs in the intended attempted-path assertion; it still drops raw audit failure data as described above.
- Historical 132-frame proof 84d98bfdf09c0c25dcdec54bc74441324a91866f was read from Git; its result records 132 frames and two native jobs. No historical result counts as new capture or new qualification. Exporter commit d1f5c569 resolves to d1f5c569bfbdc27b319fd8aae49bac2ba7420de1.
- Historical storage-accounting SHA256 independently matches 2c5665c31c3189d1822560534c0220f2ab7a33010854068ce08964ad5b85519b. Proposed unit packet is 540,606,464 bytes; per-copy total including retained upfront fixture is 1,111,031,808 bytes. No current free-space admission was inferred.
- Base-to-head diff contains exactly 32 added files: 28 candidate files plus four animation data files. Accepted body sources/exports, old failures/grants, and orchestration docs are not changed by this commit.

Commands and fresh results:
The supplied controls write their JSON outputs next to themselves, so they ran against a byte-identical scratch copy of A, not the read-only checkout. Before execution every copied source was the pinned source; only control reports were subsequently regenerated. Scratch: /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/thalune-independent-20023a3-q3swsrd0

  node /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/thalune-independent-20023a3-q3swsrd0/candidate/controls.mjs
  /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/thalune-independent-20023a3-q3swsrd0/candidate/controls.py

PASS: 18 Node + 108 Python pure controls; both report nativeCalls=0. The Python suite also asserts zero native-helper imports. Tests exercise actual entry persistence and inspector functions with synthetic 378-motion/8-still artifacts, ACK blocking, error stops, unknown observation fields, exact inventory, count/order/PTS/hash refusal, opaque-alpha refusal, budgets, release-before-validation, and attempted-job accounting. Synthetic media is explicitly not capture evidence. Complete per-control lists are included with this report.

  python3 -B A/caller.py --preflight

PASS_SOURCE_ONLY_RUNTIME_DISABLED: 378 motion frames, eight stills, five planned jobs, zero runtime jobs.

Four fresh CLI refusal controls (full argv/stdout/stderr in disabled-rerun.json): caller --execute; Python -O caller --execute; Node entry with readiness; rgb-primary.py validate-primary with a nonexistent config. All exit 1 at their disabled/optimization gates before output allocation, grant access or helper-dependent runtime work. future-attempt and consumed-attempt.json remain absent.

  /Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/thalune-independent-20023a3-q3swsrd0/adverse.py

Two additional adverse scenarios reproduce the two source defects above. Native APIs are replaced with inert facts, not launched. This test executes the real adapter and real dispatcher, not a helper-only stand-in. Reproduction script and raw proof directories are retained.

  git diff --check e1ed4752805ee92be561db81910ee1bc1a87b1d9..20023a3845f351c18df9cf8cd95190bfa28a00e6
  git status --porcelain=v1
  git rev-parse HEAD HEAD^{tree}

PASS: no whitespace errors; clean checkout; exact pinned head/tree.

Bounds inspected:
- Exactly two Thalune run_forward reels at LOD0/LOD2, 189 frames each: 15 lead-in + three 48-frame loops + 30 final-pose frames; 60 Hz timestamps. Eight stills at 0.4 s, three lights plus wireframe per LOD.
- Two validator jobs follow release of all three capture cohorts. The first dispatch or release failure stops later work. Each attempted allocation is included in the ledger; findings concern loss of diagnostic contents, not omitted attempt count.
- Existing page/playback helpers are exact copies; entry awaits each ACK before requesting another frame. Source validates one render and matching seek/render/capture poses. No actual GPU render was performed or claimed.
- 39,354,368 bytes per reel; 12,582,912 per still; 262,144 per complete observation; 361,234,432 aggregate metadata; 512 files with media/failure/terminal slots reserved; 131,072 bytes per reserved record. Metadata replacement checks include old plus temporary bytes. 190 decoded/probed frames may be examined solely to refuse surplus; acceptance is exactly 189 with ordered 60 Hz PTS and RGB/RGBA hashes.
- Media, inspections and raw native logs have separate paths. Per-stage capture/cleanup limits are 600/60 seconds. Validator probe is 30 seconds, each decode 120 seconds. Native stream/report limits and archive acceptance do not establish whole-process RSS or current disk admission.

Read and applied docs/IMPLEMENTATION_PLAN.md 0.3, 0.9.5, E05.T01/T02/T04, relevant 0.4/0.10 art rules, DESIGN 5/19 and art-bible shared-rig constraints. No authority, demo-replacement or spec-interpretation finding was identified in this bounded source addition. Tests exist; their passing result does not cover the two combined failure cases. Whole-library acceptance was not graded.

Remaining prerequisites after source fixes and another exact-head source review: parent runtime browser/tsx/executable bindings and manifest refresh; required-only asset hydration and binding refresh; CPU asset validation, 42-clip list and actual-three-body bind-relative compatibility on the integrated checkout; fresh current storage/RSS/cache admission; release of the parent's GPU holder and exact one-use grant; native 189-frame encode/decode qualification; new capture and terminal-release evidence; independent visual grading and remaining library coverage. E05.T04 gameplay loading/state-machine integration remains separate. Runtime remains disabled. No merge or launch authorization is implied.
