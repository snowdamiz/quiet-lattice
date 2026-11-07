TASK: P1.E05.T02 — native189 independent R3 correction, Appendix C.2

STATUS: DONE for this bounded SOURCE/CPU revision. Runtime and native
qualification remain disabled. Fresh independent review is parent-owned.

SUMMARY: Fixed both P2 findings at the task boundaries. Packet, byte-count,
artifact-index and archive inventories now propagate enumeration errors and
retain partial facts, so incomplete trees cannot authorize budget, success or
archive acceptance. The complete observer callback now records its first raw
failure before immutable helper normalization or persistence. Executable path
errors and stage command outcomes retain their original fields; later receipt
errors remain secondary. Exact helpers and reviewed algorithms are unchanged.
No actual native job was launched.

Base: `609f454dfe65c8e3a7fbc7e69b4c36a584f6af98`, tree
`127f83f32453c32f67bf1c2ada1cdd69e86484d4`; branch
`codex/task/P1-E05-T02-thalune-reel-candidate`. The delivery commit contains this
report; its final SHA/tree are supplied in the handoff. unit-provenance.json
records the combined library head/tree, original base, both donor commits,
retained animation branch and current source SHA256 values. No new source
recovery or hydration was performed; the original 21 rows and two earlier
additional recoveries remain unchanged.

FILES CHANGED:

- inventory_boundary.py: task-local complete enumeration with explicit os.walk
  error propagation, partial directory/entry facts and original exception
  attachment. Narrow adapters provide these enumeration ports to the immutable
  archive helpers and restore the exact original ports in finally.
- packet_budget.py: a complete inventory is required for inspection and every
  budgeted write. Known files and bytes remain recorded on refusal; unknown
  subtrees are not silently dropped or represented as zero.
- release_accounting.py: executable events are attached before fallible reads;
  refused path-read errors are exposed before persistence or assertion. Terminal
  byte accounting uses the same complete packet inventory. Incomplete accounting
  retains its partial inventory and omits an unproved outputBytes value.
- caller.py: one first-error guard covers resource, executable and stage observers.
  Stage callback, command and persistence ports retain raw outcomes before frozen
  helper handling. Actual command returncode, stdout, stderr and unknown fields
  are retained even if later assertions or writes fail. Archive helpers and final
  archive byte accounting use complete enumeration.
- inspector.py and bind-local.py: artifact indexes, validation inventories and
  source binding inventories use the same error-propagating enumeration. Error
  receipts also retain built-in exception arguments and filename/errno fields.
  The binding generator's main routine was not run or used to retarget software.
- revision07-controls.py: new actual-boundary CPU controls. readiness.json,
  candidate-index.json and source-audit.json contain current disabled identities;
  revision-07/ contains fresh evidence. Prior reports, assets, library, playback,
  producer, native plan, work inventories and exact helpers are unchanged.

VERIFY:

- The three authoritative scripts ran unchanged on the clean exact base before
  source edits: independent.py exit 0 (eight cases), observer-native.py exit 0
  (two cases), close-failures.py exit 0 (one case). These are **11 RED/control
  cases with three reproduced defect manifestations**, not eleven product
  passes. Original scripts match the review copies byte for byte. red/ contains
  their original results and stdout/stderr; red-commands.json records argv,
  working directory, exits and script hashes.
- The incomplete-packet RED reached actual native.run_sequence and
  NativeAdapter.inspect_native with inert jobs and positive release receipts.
  A real chmod-000 subtree containing a sparse over-budget file was omitted, and
  provisional success was published. GREEN returns HOLD, records PermissionError
  and a partial incomplete inventory, publishes the proof result and attempts
  the packet fallback. The fallback also refuses its incomplete inventory.
  outputBytes is absent rather than falsely complete. Readable-extra and normal
  controls retain their refusal and provisional-success behavior respectively.
- Both observer REDs reached actual NativeAdapter / StationAdapter.run and exact
  retained constructor, start, status, wait and drain bodies. After an initial
  successful observation, a real hash read raised PermissionError. RED selected
  an empty AssertionError or SECONDARY_WAIT_RECEIPT_WRITE as primary. Both GREEN
  cases preserve the original PermissionError and its arguments, errno and file
  path as the same primary receipt object; helper-save failure is secondary.
  One attempted job is audited, no validator is dispatched, timers and ports
  are restored, and uncertain release remains uncertain.
- **All 11 adapted independent cases PASS**, three driver exits 0. The green
  adaptations change the defect assertions and scratch/output transport, not
  the exercised production boundary. close-failures.py remains byte-identical:
  it keeps the original partial-byte TimeoutExpired and all 18 observed close
  failures in this run, and verifies every real descriptor was closed.
- **39 new controls PASS**, exit 0: 25 full observer cases plus 14 inventory and
  archive cases. Executable hash/path and actual stage command paths cover
  partial non-UTF8 timeout bytes, unknown attributes, empty cancellation errors,
  real SIGALRM deadlines, command exit 17, helper-save failure, stage-save
  failure, and all file/terminal sinks failing. The same first failure object
  remains primary; later failures are separate. When all sinks fail, actual CLI
  delivery raises TerminalDeliveryError containing the complete structured
  memory result, with completeObservationsPersisted=false. No durability is
  claimed for that memory evidence.
- Inventory controls use real unreadable scratch directories at packet inventory,
  budget-write, inspection, artifact-index, archive-byte and source-binding
  boundaries. Further controls exercise final terminal publication with and
  without proof-write failure; exact retained profile/private-TMP archive bodies;
  unknown scandir errors, cancellation and the real timed guard; and actual
  StationAdapter.run followed by native.run_sequence archive acceptance with an
  unreadable subtree holding a sparse 1 GiB + 1 byte file. Incomplete archive
  enumeration stops acceptance and later dispatch. Native, copy and removal
  ports are inert; original namespaces and partial facts remain retained.
- **All 440 prior controls PASS** on final source, exits 0: 393 earlier controls
  plus the 47 R2 boundary controls. Current distinct total is
  **490 = 440 prior + 39 new + 11 adapted independent**. Existing primary-error,
  release, fallback, deadline, FIFO, ancestor, admitted-read, RSS, aggregate-size,
  count, cancellation and fresh-temp-Git controls remain green. The prior29
  outputBytes fault injection was moved in a fresh test copy from Path.rglob to
  the actual new budget.inventory port; all behavioral assertions remain.
- Exact commands and environments are in commands.json, final-commands.json,
  prior/commands.json and final-checks/additional-commands.json. Main CPU runs:
  bound Python3.12 `-B prior/run-all.py` (393, exit 0),
  `-B revision06-controls.py --report <fresh>/prior47.json` (47, exit 0),
  `-B revision07-controls.py --report <fresh>/new-final.json` (39, exit 0).
  `pnpm typecheck`, scoped ESLint, scoped Prettier and all 23 root Python AST
  parses exit 0. Native source preflight exits 0 with plannedJobs=2/nativeJobs=0;
  disabled native `--execute` exits 1 as expected before grant/output allocation.
  Prior driver preflights also prove zero capture jobs launched, with the
  unchanged planned 378 motion frames and eight stills.
- Source freeze exits 0: 37 source files, 2,353 source/data bindings, 12 software
  bindings and 41 candidate-index rows. All **750 protected prior-manifest
  entries match**. Readiness differs from the exact base only in source binding
  rows. Both runtime flags are false and all 11 prospective paths are absent,
  including dangling-link checks. Node remains 26.12.1; no software was retargeted.
- The first new test harness exited 1 before any case because helper injection
  supplied **name** twice. Its original stderr remains new-first.stderr; no
  aggregate was produced or relabeled. The corrected 25-case and then 39-case
  development runs pass and remain retained; only the final 39 is counted.
  The complete failing traceback is:

```text
Traceback (most recent call last):
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/revision07-controls.py", line 17, in <module>
    browser=helper('run_round4_browser_proof.py',dict(core))
            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/revision07-controls.py", line 16, in helper
    space=dict(__name__='inert_exact',__file__=str(f),**injections);exec(compile(t,str(f),'exec'),space);return space
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: dict() got multiple values for keyword argument '__name__'
```

- The three oversized failed-run reports remain at their exact original scratch
  paths, with original SHA256 and sizes 26,936,262 / 207,110,041 / 367,810,077 bytes
  verified. They were not copied or removed. evidence-provenance.json records
  these external dependencies and the original independent/cross-lane reports.
  Fresh raw text with trailing whitespace is retained losslessly as JSON text
  with its original hash. Existing reports and failed scratch are unchanged. The
  first staged whitespace check reported `prior/supplied78.stdout:6: new blank
line at EOF`; this new copied stdout was also losslessly JSON encoded. The
  original scratch output and hash remain unchanged.
- No library/Blender/three-export suite or full 1.17 GB producer comparison was
  repeated. Their unchanged proofs remain prior evidence: 28 library tests,
  126 clip/people pairs, 42 actions and the full CPU producer RGB/RGBA comparison.
  No native, codec, browser, GPU, Blender, Vite, service, DB or grant launch,
  hydration or cleanup of existing/runtime artifacts occurred in this revision.

DECISIONS:

- What establishes a complete inventory → full traversal with errors propagated;
  retain partial facts on failure because an omitted subtree cannot authorize
  budget, archive acceptance or provisional success.
- Where the observer primary belongs → before the immutable helper catches,
  normalizes or persists it; retaining only a formatted helper message loses
  first-failure precedence and raw producer facts.
- How to cover immutable helper routes → temporary task-local observation and
  enumeration ports, restored in finally; their bodies and algorithms remain
  byte-identical. This is not a second native runtime framework.
- What all-sink failure proves → structured evidence remains available in memory;
  it is not durable proof. Each bounded fallback remains attempted once.
- How cross-lane findings apply → inspect F4/F6 as hypotheses and test this unit's
  real boundaries. No other lane's source or acceptance was changed.

OUT OF SCOPE FOUND: Native process inheritance, real encoding/decoding, live
cache ownership, RSS peaks and actual parent-observed OS completion still require
native qualification. Whole-animation capture/visual grading remain pending;
gameplay integration remains E05.T04. The current GPU assignment to T15 was not
used. No orchestration documentation, main, push, PR or merge change occurred.

ARTIFACTS: revision-07/REPORT.md, commands.json, unit-provenance.json,
evidence-provenance.json, final-checks/preservation.json, red/, green-repros/,
new-final.json, prior47.json, prior/ and combined-hash-manifest.json. These contain
exact commands, results, source hashes and protected-byte checks. No visual
artifact exists. next-launch.json records the current disabled readiness/index
and unchanged executable identities, plan, prospective paths and protocol.

The next command remains disabled and was not launched:

```sh
/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B packages/tools/blender/characters/animations/thalune-run-candidate/native189.py --execute --grant /private/tmp/t02-native189-r04-20261107-t3-11167406-grant.json
```

Next is fresh independent review of the exact correction, then parent-scheduled
native qualification under the existing authorization. No additional human
permission stage is requested. Activation still requires fresh resource and
ownership evidence, a clean bound activation HEAD, the one-use diagnostic grant,
positive encoder-cohort release before the validator cohort, and actual
parent-observed OS exit zero. Diagnostic authorization cannot enable capture.
The exact outputs, jobs, logs and paths remain in revision-04/NEXT_LAUNCH.md and
native189-plan.json; next-launch.json supplies the current disabled source hashes.
Historical free-space observations are not current admission.

Unchanged limits: 189 frames, 1920×1080 opaque 60 Hz, one ACK in flight,
39,354,368 bytes per reel, 64 MiB fixture metadata, sampled aggregate 8 GiB owned
RSS, joint 384 MiB / 4,096-entry cache admission, 1 GiB per-job archive acceptance,
22,066,626,560 bytes combined reserve, four copy slots, eleven archive allowances
and the 30-second final inspection deadline. No OS quota or arbitrary-writer
exclusion is claimed. Source proof is not native, visual, whole-T02 or T04
acceptance.
