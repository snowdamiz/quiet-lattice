TASK: P1.E05.T02 — native189 source-review correction, Appendix C.2

STATUS: DONE for this bounded SOURCE/CPU revision. Fresh independent R2 review
and parent native qualification remain next. Both runtime flags are false.

SUMMARY: Fixed the two P2 findings from the independent review of c44d7a8 and
its post-RSS duplicate advisory. The first resource failure becomes primary at
the observation boundary, before any post-wait receipt write or worker read.
Cache admission now enumerates and stats all roots within the joint limits
before content reads, then hashes and copies through bounded, nonblocking,
no-follow descriptors with identity/size reconciliation. Raw facts, secondary
failures, failed copies and spent leases remain available. No runtime launched.

Base: `c44d7a8597644e942b38345f37e269c13af063e6`, tree
`f8d102c85e00e3f2b00ae33bdf4dc2b927aad00a`; branch
`codex/task/P1-E05-T02-thalune-reel-candidate`. The delivery commit/tree are in
the final handoff because this report belongs to that commit. Original base,
combined library head/tree, donors and exact source hashes are in
unit-provenance.json. No source recovery or hydration was added. All 21 original
and two earlier additional recovery records remain unchanged. The retained
animation branch is still `49ae87cbdb8671f7988b1bed4358d49d4cdc6b58`.

FILES CHANGED:

- caller.py: records the resource error immediately; subsequent read, write or
  wait assertion failures become secondary. The primary is the same receipt
  object returned by the resource observation, retained through the dispatcher.
- native189.py: retains a later worker failure without overwriting that primary.
- resource_admission.py: incremental, bounded stat inventory; regular descriptor
  type/owner/dev/inode/size checks before reads; capped streaming with one surplus
  byte; post-read descriptor/path and complete metadata reconciliation. Copying
  uses the admitted rows and the same bounded source reader. The post-RSS sample
  now also requires unique membership with the original multiplicity.
- revision05-controls.py: actual dispatcher/adapter/CLI adverse crossings and
  real filesystem/retained timed-guard controls with inert native ports.
- readiness.json, candidate-index.json and source-audit.json: fresh source hashes.
  The readiness values differ from the base only in source bindings.
- revision-05/: exclusive new RED/GREEN reports, raw observations, command logs,
  provenance, preservation checks, hashes and next-launch references. Prior
  reports, helpers, assets, library, entry/page/playback, producer, native plan,
  all work inventories and orchestration files are unchanged.

VERIFY:

- Exact unmodified review adverse-v2.py ran on the clean reviewed pin before
  edits: exit 0, 17 cases, seven reproduced defects (four resource ordering,
  oversized cache read, regular-to-FIFO race and duplicate post-membership).
  The sparse 384 MiB + 1 file read 402,653,185 bytes before the old refusal;
  the real FIFO swap reached the unchanged deadline. The review's input files
  and all original results are retained without changing their verdicts.
- Expanded ordering matrix against an exported exact c44d7a8 source: exit 0,
  40 cases including 36 expected primary-loss reproductions and four normal
  controls. Source export path is recorded in ordering-base-red.json. No
  production dispatch or native process was used.
- Corrected review adverse suite: **17 PASS**, exit 0. All four RSS cases retain
  the original primary, full TimeoutExpired non-UTF8 stdout/stderr and unknown
  fields. Oversized input reads zero content; FIFO replacement refuses before
  any read without waiting for the deadline. Duplicate post-membership refuses.
- New focused controls: **74 PASS**, exit 0: 44 actual ordering crossings,
  17 file/inventory boundaries, five aggregate/enumeration controls and eight
  copy boundaries. Ordering covers real SIGALRM, TimeoutExpired, missing PID and
  excess RSS through post-wait writes, state reads, worker reads/failures,
  available packet fallback, all file sinks failing, and both terminal streams
  failing. It checks primary object identity, exactly one attempted job, normal
  drain/terminal return, complete raw observations and honest persistence
  qualification. No later capture or validator starts.
- Real filesystem controls exercise 4,096 acceptance / first 4,097 refusal
  without full rglob materialization; 384 MiB acceptance / +1 refusal before
  reads; joint limits across two roots; symlink/FIFO/regular replacements;
  growth (eight admitted bytes plus one sentinel), truncation and after-read
  replacement; unknown errors, cancellation and real timers during enumeration,
  reads and copies. All observed descriptors close. Combined read/close failure
  retains the original read error and the secondary close failure. Pre-copy
  reconciliation refuses changed metadata before allocating its destination;
  later failures retain original caches, spent leases and partial failed copies.
  Copy controls use eight-byte files, not giant repeated archive copies.
- All **302 supplied controls PASS** on the combined corrected source: 180
  existing candidate, 15 timed/publication, 29 prior independent replays, 69
  native-source, seven metadata and two legacy admission RED/GREEN controls.
  Total current CPU controls: **393 = 302 + 74 + 17**. Expected old-source RED
  cases and the native zero-launch checks are reported separately, not added
  to that total. Replayed controls are not a fresh independent review.
- `pnpm typecheck`, scoped ESLint, scoped Prettier and 20 Python AST parses:
  exit 0. Exact argv/cwd/PATH/exits are in commands.json and final-controls/.
  The four existing disabled CLI checks exit 1 as expected. Additional actual
  native189 preflight exits 0; disabled `--execute` exits 1 with NATIVE189_DISABLED
  before grant/output allocation. Caller preflight exits 0: 378 motion frames,
  eight stills, five planned capture jobs, zero runtime jobs.
- Freeze exits 0: 34 source entries, 2,350 source/data bindings, 12 software pins,
  38 candidate-index entries. All verify. All 330 protected prior-manifest files
  verify byte-for-byte, including immutable helpers and historical evidence.
  Node remains the reviewed 26.12.1 executable; no binding retarget occurred.
  All 11 prospective paths remain absent. See preservation.json and software-pins.json.
- Initial focused test harness FAIL is preserved (53 completed cases, exit 1):
  a fixture flag prevented its intended growth mutation, so the expected refusal
  did not occur. Fixing that fixture produced 69 PASS; expanded enumeration and
  worker-failure cases then produced the final 74 PASS. Neither failed report nor
  its stderr was rewritten. The last 20 failure lines are in focused-first.stderr;
  the error ends `AssertionError: Expected boundary refusal`.
- The unchanged full 189-frame producer's prior independent 1,175,731,200-byte
  RGB comparison, all RGBA hashes and positive/surplus code-body PASS are retained
  as prior evidence in independent-review-input/full-producer.json, not rerun.
  Library/Blender/three-export tests also remain prior evidence (28 tests,
  126 clip/people pairs, 42 actions), not new claims. No native/codec/GPU/browser/
  Vite/Blender, real job/grant, cleanup, capture, DB, fetch or hydration ran.

DECISIONS:

- Which error owns the terminal result → assign the first resource error while
  observing it, before the retained wait can catch it and return; retain later
  persistence/read/worker errors separately.
- How to enforce cache budgets before expensive reads → stat all roots jointly
  with an incremental 4,097th-entry stop, then reuse exact bounded descriptors
  for hashing and copying. One excess byte detects growth without an EOF scan.
- What a failed copy can remove → nothing; original cache bytes, lease and
  partial copies remain available for inspection. No arbitrary-writer exclusion
  or OS quota is claimed. Directory/path races fail conservatively where observed.
- How to preserve terminal output exactly → raw logs are unchanged; logs with
  terminal trailing whitespace are stored as JSON text with their raw-byte SHA256,
  listed in evidence-provenance.json. Old attributes and evidence stay unchanged.

OUT OF SCOPE FOUND: Actual native encoding/decoding, inherited process behavior,
RSS peaks, live cache ownership, capture and visual grading remain unqualified.
The post-membership duplicate case is a defensive source advisory; the retained
helper normally returns distinct members and no native failure is claimed.
Whole T02 and gameplay integration E05.T04 are not accepted by these controls.
No push, PR, main change or merge was performed.

ARTIFACTS: commands.json, preservation.json, evidence-provenance.json,
unit-provenance.json and combined-hash-manifest.json contain the exact retained
identities and dispositions. The full failed and passing raw observations are
retained under raw-observations/ and mapped from their original scratch paths.
No new visual artifact exists. The task-specific next launch is recorded in
next-launch.json with current disabled readiness/index hashes and the unchanged
plan hash, exact executable identities, output/log/validator paths and budgets.
The protocol remains revision-04/NEXT_LAUNCH.md; its old source hashes and capacity
observation are historical, never fresh admission. Current files here supersede
only those source hashes. The command remains:

```sh
/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B packages/tools/blender/characters/animations/thalune-run-candidate/native189.py --execute --grant /private/tmp/t02-native189-r04-20261107-t3-11167406-grant.json
```

It is still disabled. After fresh independent R2 review, the parent schedules
native qualification under the existing authorization policy. The native-only
activation/one-use grant binds the exact clean activation HEAD and fresh file
snapshots; actual capture stays false. Encoder cohort release precedes validation;
the parent must observe actual OS exit zero, not infer it from a provisional
success receipt. No extra human permission stage is requested.

Limits are unchanged: 189 frames, 1920×1080 opaque 60 Hz, one ACK in flight,
39,354,368 bytes per reel, 8 GiB aggregate owned RSS, joint 384 MiB / 4,096-entry
cache snapshot admission, 1 GiB per-job archive acceptance and 22,066,626,560 bytes
combined reserve. The real-time RSS limit is a finite sampled stop, not an OS
quota. The same four copy slots, eleven archive allowances and exact retained
input inventory remain bound. Fresh resource/owner/source/clean-HEAD evidence is
still required at execution; this correction makes no current capacity admission.
