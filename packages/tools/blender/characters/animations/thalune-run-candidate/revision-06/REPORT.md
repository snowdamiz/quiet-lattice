TASK: P1.E05.T02 — native189 independent R2 correction, Appendix C.2

STATUS: DONE for this SOURCE/CPU revision. Runtime and native qualification stay
disabled; fresh independent review is parent-owned.

SUMMARY: Fixed all three P2 findings with task-local changes. Cache admission,
reads, copies and archive creation now traverse every directory component using
held, no-follow directory descriptors. The adapter captures the exact bootstrap
command outcome before the immutable helper can fail while persisting it. Final
native artifact hashing admits types, identities and sizes, uses bounded
nonblocking descriptor reads, and runs under a finite inspection deadline after
both releases. Original failures, unknown facts and later persistence failures
remain separate. No native job was launched.

Base: `258926df00eaf6a306920b9905ff925358a73c1d`, tree
`2c18fbb1a1de1697aeede0675a65ce5ddbd0263e`; branch
`codex/task/P1-E05-T02-thalune-reel-candidate`. This report belongs to the delivery
commit; its exact head/tree are supplied in the final handoff. Earlier combined
library head/tree, both donors, retained branch and source SHA256 values are in
unit-provenance.json. No source recovery or hydration was added. The original
21 recovery rows and two earlier additional recoveries are unchanged.

FILES CHANGED:

- resource_admission.py: component-relative stat/open traversal from `/`, holding
  all admitted ancestors and cache directories through inventory, content reads
  and copies. Source reads and destination directory/file creation use relative
  names and admitted parent FDs. Existing stat reconciliation, shared byte/entry
  budgets, bounded streaming, close-error preservation and retained spent leases
  remain. Repeated descriptor failure records reference attached observations
  instead of recursively copying them into every ancestor's event.
- caller.py: task-local observation around the immutable helper's start command
  port. It retains argv, returncode, stdout/stderr, unknown result fields,
  command exceptions and registration uncertainty before bootstrap persistence.
  It does not retry bootstrap or infer registration/release from a return code.
  The exact original port is restored in finally, including cancellation and
  real deadline expiry. Helpers and StageReceipts are untouched.
- native189.py: final primary.mp4 and frame-map.json inspection uses the admitted
  directory FDs and bounded regular-file reader under a 30-second retained-helper
  deadline. Inspection facts are attached to the dispatcher result before the
  inspection starts. Successful disk status remains provisional; the parent must
  still observe actual OS exit zero.
- revision05-controls.py: only its file-open instrumentation changed to reconstruct
  logical paths from dir_fd-relative opens; all original behavioral assertions
  remain. revision06-controls.py adds the new actual-boundary controls.
- readiness.json, candidate-index.json and source-audit.json: current disabled
  source identities. revision-06/: fresh commands, reports, provenance and hashes.
  Prior reports, assets, library, entry/page/playback, producer, exact helpers,
  native plan, work inventories and orchestration documents are unchanged.

VERIFY:

- Both authoritative reproduction scripts ran unmodified on the clean exact
  base before edits: independent.py exit 0 (15 cases, six defect manifestations)
  and adapter-cache-v2.py exit 0 (one actual-prepare defect manifestation).
  These are **16 RED/control cases, seven reproduced defects**, not product
  passes. Exact original scripts, hashes, stdout/stderr and results are retained.
- **47 new controls PASS**, exit 0: eight ancestor schedules; five actual copy
  failure controls; seven exact-helper lifecycle cases; 25 final-artifact cases;
  and two actual caller/prepare cases. Native command ports are inert.
- Ancestor schedules replace real directories with real symlinks before component
  admission, at source and archive ancestors and nested descendants. They refuse
  before content reads. Separate schedules replace an ancestor after its FD is
  already held: reads use the original admitted FD and a single relative leaf
  name, never resolve through the transient alias. These safe anchored reads
  retain the original bytes and reconcile identities. This does not claim
  exclusion or detection of every arbitrary writer or every transient namespace
  change. Actual run_sequence → StationAdapter.run → unchanged prepare refuses
  source and destination ancestor races before private/native allocation.
- Copy controls cover short writes, unknown destination write errors, destination
  close errors, combined source-read/destination-close failure and real timed
  interruption. Original caches, before copies, spent leases and failed partial
  copies remain. All observed descriptors close. A close-reporting error remains
  separate from the original error. Failure observations for these eight-byte
  fixtures are bounded below 256 KiB, preventing recursive evidence expansion.
- Bootstrap cases execute exact retained constructor/save/start bodies with only
  the command port inert. Exit 17 and exit 0 both retain output sentinels and
  unknown nested fields when bootstrap.json writing fails. The write error remains
  an error and the observed command result remains evidence; registered=False is
  not represented as proof of absence. TimeoutExpired partial bytes, cancellation
  and real SIGALRM remain primary. Each case attempts one bootstrap at most,
  stops later dispatch, and proves restoration of the original port and timer.
- Final dispatcher cases run both inert jobs with positive release receipts,
  then the actual inspect_native. Both artifact paths cover static/raced FIFO and
  links, identity replacement, size refusal before reads, growth, truncation,
  unknown read errors, cancellation and real SIGALRM. The requested inspection
  deadline is asserted to be 30 seconds; the exact helper is exercised at a short
  test duration for timed cases. Positive fixtures keep the provisional-success
  status. The combined-budget case accepts 39,354,368 media bytes plus 32 MiB
  metadata, proving the existing independent allowances were preserved.
- All **393 prior controls PASS** on final source. Total current CPU controls:
  **440 = 393 + 47**. This includes the original 302, 74 R5 controls and 17 adapted
  adverse cases. The old adverse script's file-open injection was adapted to the
  new relative-FD port; its behavioral assertions and the retained historical
  script are unchanged. Replayed independent controls are not a new review.
- `pnpm typecheck`, scoped ESLint, scoped Prettier and Python AST parsing: exit 0.
  Exact argv/cwd/PATH/exits and raw outputs are in commands.json and final-checks/.
  The expected disabled CLIs exit 1; caller and native preflights exit 0. Source
  preflight reports 378 motion frames, eight stills, five capture jobs and zero
  runtime jobs. Actual native `--execute` refuses before grant/output allocation.
- Freeze and identity verification pass: 35 source entries, 2,351 source/data
  bindings, 12 unchanged software pins and 39 candidate-index entries. All 483
  protected prior-manifest entries match. Frozen Node remains 26.12.1; no tool
  was retargeted. Both flags are false and all 11 prospective paths are absent.
- Intermediate verification is retained honestly. The first descriptor-lifetime
  implementation recursively copied attached error observations during unwind.
  Two owned CPU test processes were stopped with exit 143 after rising memory;
  they were not native jobs and are not passing runs. Their partial reports,
  stdout and existing scratch observations remain unchanged. Three large raw
  failed-run files (26,936,262; 207,110,041; 367,810,077 bytes) remain at their exact
  original scratch paths, with SHA256 references in evidence-provenance.json;
  redundant copies are omitted from this source commit. They are external proof
  dependencies, not claimed to be contained in the Git tree. The fix retains raw
  facts once and uses explicit references during descriptor unwind. Subsequent
  45-case, 46-case and final 47-case runs pass; only the final 47 is counted.
- A final source check caught an unnecessary combined 64 MiB media/metadata
  assertion in the intermediate implementation. It was removed before delivery,
  and the final combined-budget control proves the original separate limits.
  The final 393 and scoped checks were rerun after that correction. Earlier
  successful reports remain unchanged and are not counted twice.
- No library/Blender/three-export suite or giant 189-frame comparison was rerun.
  Their prior evidence remains prior evidence (28 library tests, 126 clip/people
  pairs, 42 actions; full producer RGB/RGBA checks). No codec/native behavior is
  inferred from these source fixtures. No native/GPU/browser/codec/service/DB,
  Vite, grant launch, hydration or cleanup of existing/runtime artifacts occurred.

DECISIONS:

- Which pathname is authoritative during use → a single component relative to
  its held admitted directory FD; an earlier resolve/lstat check is insufficient.
- What to retain after bootstrap persistence failure → the producer result and
  registration uncertainty alongside the receipt error; never retry bootstrap
  or promote a successful command response to owned-process release proof.
- How to bound post-release hashing → regular-file type/identity/size admission,
  NONBLOCK/NOFOLLOW descriptors, at most admitted bytes plus one sentinel,
  post-read reconciliation and a finite retained-helper phase timer.
- How to retain repeated failure facts → preserve full attached observations in
  the owning exception/receipt and reference them from descriptor events. Keep
  oversized intermediate failed reports intact externally with exact hashes.

OUT OF SCOPE FOUND: Native process inheritance, actual encoding/decoding, RSS
peaks, live cache ownership and actual parent OS completion still require native
qualification. Whole-animation capture and visual grading remain pending;
gameplay integration remains E05.T04. No merge, push, PR or main change occurred.

ARTIFACTS: unit-provenance.json, preservation.json, evidence-provenance.json,
commands.json, final-checks/ and combined-hash-manifest.json contain the evidence
and exact identities. No new visual artifact exists. next-launch.json binds the
current disabled readiness/index to the unchanged plan and executable identities.
The protocol remains revision-04/NEXT_LAUNCH.md, with these current hashes and the
new finite final-inspection bound. Historical free-space observations are not
fresh admission. The next command remains disabled:

```sh
/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B packages/tools/blender/characters/animations/thalune-run-candidate/native189.py --execute --grant /private/tmp/t02-native189-r04-20261107-t3-11167406-grant.json
```

Next is a fresh independent exact-head review, then parent-scheduled native
qualification under the existing authorization policy. No new human permission
stage is requested. Activation must retain capture=false, bind a clean activation
HEAD and exact bounded grant/receipt snapshots, obtain fresh resource/ownership
facts, and preserve encoder-release-before-validator order. The native disk result
remains provisional until the parent observes actual OS exit zero.

Limits remain 189 frames, 1920×1080 opaque 60 Hz, one ACK in flight, 39,354,368 bytes
per reel, 64 MiB fixture metadata, 8 GiB sampled aggregate owned RSS, joint
384 MiB / 4,096-entry cache admission, 1 GiB per-job archive acceptance and
22,066,626,560 bytes combined reserve. Four copy slots, eleven archive allowances,
retained input inventory and all runtime paths are unchanged. These sampled
observations are not OS quotas or arbitrary-writer exclusion guarantees.
