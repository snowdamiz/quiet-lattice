TASK: P1.E05.T02 — bounded disabled native189/resource prerequisites

STATUS: DONE for this SOURCE/CPU unit. Native qualification, actual capture,
visual grading and whole T02 acceptance remain pending.

SUMMARY: Implemented the exact 189-frame diagnostic PNG stream and native-only,
one-use grant/worker runner using two existing StationJob cohorts. Added a finite
8 GiB aggregate RSS stop and exclusive Vite-cache admission/retention for later
capture. The encoder cohort must positively release before independent RGB/RGBA
validation and a bounded 190-frame surplus refusal. The actual capture flag stays
false. Added bounded single-snapshot metadata admission after the fauna R4 report,
and corrected inherited media-error persistence that could mask the primary
failure. All native boundaries in the controls are inert.

Base: `c61699dcde61ff9dee699be7e0b7d42ae06ff326`, tree
`1b67a7289191a8dde2f28e68808e704dc51ee0b4`. Branch:
`codex/task/P1-E05-T02-thalune-reel-candidate`. The final commit and tree are
reported in the delivery message; this report is part of that commit. Earlier
combined library head `afb3921ae59616ab5b555b771cd9dc1a914d78f2`, tree
`ac859db599e124c7d91d462e329deae5b9d91e37`, and both reviewed donor commits are
recorded in unit-provenance.json. No source recovery, hydration or asset change
was needed in this unit.

FILES CHANGED:

- New task source: native189.py, native189_producer.py, resource_admission.py,
  admission_json.py, native189-plan.json; focused native189-controls.py and
  metadata-controls.py.
- caller.py: small task hooks around the existing StationAdapter lifecycle;
  capture cache/RSS admission; authenticated bounded metadata consumption.
  StationJob, StageReceipts and all retained helper bodies remain byte-identical.
- rgb-primary.py: preserve primary and secondary persistence failures when the
  error receipt itself fails; preserve TimeoutExpired bytes and unknown fields.
  The accepted encoder/decoder commands and 189 limits remain unchanged.
- release_accounting.py: terminal receipt references use the same capped bytes
  that were parsed. Existing bounded packet fallback/structured return remains.
- bind-local.py, freeze.py, runtime-bindings.json, readiness.json,
  candidate-index.json and source-audit.json: honest current bindings/indexes.
  Git is explicitly bound because the worker checks the consumed clean HEAD;
  lsof is bound for controller-side cache observation.
- revision-04 contains fresh controls, logs, commands, provenance, resource
  observations, next-launch protocol and combined hash manifest. No prior report,
  packet, library/body data, playback, work inventory or orchestration document
  was edited. The retained animation branch remains 49ae87cbdb8671f7988b1bed4358d49d4cdc6b58.

VERIFY:

- **302 CPU controls**, exit 0: 180 existing candidate controls; 15 real timed and
  publication controls; 29 replayed prior-independent controls; 69 new controls;
  seven metadata-reader controls; two actual legacy/current grant race controls.
  Counts include expected refusals and deliberate historical RED reproductions;
  they are not 302 native tests. Full argv, cwd, exits and reports: commands.json
  and final-controls/control-commands.json. Prior-independent cases are replayed
  evidence, not a fresh independent review.
- New controls use actual dispatcher/adapter/CLI and actual retained deadline
  and wait bodies with inert native ports. They exercise births, reuse, membership
  drift, missing/excess/unreadable RSS, real SIGALRM expiry, cancellation, empty
  errors, cache ownership/races, retained leases across three stages, release
  before validator, combined persistence failures and structured return after
  both file and stream sinks fail. Raw unknown fields survive. The surplus test
  executes the actual surplus-validator body against inert process output.
- Fresh temporary Git repositories reproduce dirty in-repo output refusal,
  preserve one consumed HEAD through external output and consumer admission,
  refuse unrelated files and changed HEAD, and verify one-use grant refusal.
  Nothing is hidden with ignore rules or by committing generated output.
- Actual c61699d media worker RED: a primary TimeoutExpired was replaced by the
  result-write OSError. Current GREEN retains the same primary object, partial
  byte payloads, unknown fields and the persistence error. Actual c61699d caller
  RED: real grant replacement after JSON parsing made consumption bind different,
  failed grant bytes. Current GREEN binds the digest and semantics of the one
  admitted snapshot. See controls-final-bound.json and admission-redgreen.json.
- Metadata controls replace real files after the read and retain/refuse the
  originally authenticated failed receipt. An 8 MiB input is refused with zero
  content reads; growth is detected by one 2,097,153-byte read. FIFO/symlink inputs
  refuse before reads; an exit value of false is not accepted as integer zero.
  Hash, parse and semantic checks use the same bytes. Unknown fields remain.
- One initial new-test harness failure is preserved in controls-first.json:
  after correctly refusing a cache symlink, the reporting code tried to inventory
  that same refused link again (`AssertionError: Unowned cache path`). The harness
  now records the expected refusal. That old FAIL report was not rewritten.
- `pnpm typecheck`, focused ESLint and focused Prettier: exit 0. Exact scoped argv
  are in commands.json; logs retained. Python AST parsing passes for all 19 root
  Python sources. No JS/TS product logic changed.
- Fresh `caller.py --preflight`: exit 0, exact 378 motion / eight still inventory,
  five planned capture jobs, zero runtime jobs. Both native entrypoints refuse
  before grant/output allocation, including optimized Python. 33 source entries,
  2,349 source/data bindings, 12 software bindings and eight distinct allowed
  process executables are frozen. Helpers/entry/page/playback/contract and the
  protected prior manifest entries match the base. Original 21 recovery rows and
  the two earlier additional recoveries remain intact.
- Library/Blender/three-export tests were not rerun in this source-only unit.
  Their preceding independent PASS (28 tests, 126 clip/people pairs, 42 actions)
  remains background, not newly claimed evidence. No native media, GPU, browser,
  Vite, Blender, DB, capture, grant launch, fetch or hydration occurred.

DECISIONS:

- How to avoid a second native ownership framework → reuse StationAdapter's
  allocation, drain, archive, audit, exclusive receipt and terminal fallback;
  only task-specific argv, producer, observation and two-job dispatch are new.
- How to avoid cross-purpose admission → nativeFixtureAuthorization and the
  exact native-only purpose/grant are separate from runtimeAuthorization;
  worker claims require the real owned parent birth/UID/coalition and exact argv.
- How to preserve clean Git sequencing → prospective output/consumption/grant
  paths are outside the repository; the consumer verifies the same clean HEAD.
- How to retain cache ownership safely → a checkout-wide lease remains spent,
  pre-existing/generated cache bytes remain in place, and before/after verified
  copies are charged to the per-job allowance. No unowned cache or replacement
  lease is deleted. Unknown owners and races HOLD. This is sampled observation
  and cooperative exclusivity, not an OS lockout against arbitrary writers.
- How to qualify success publication → native disk status remains
  NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT. The parent must observe actual OS
  exit zero; a successful snapshot cannot substitute for that observation or
  grant capture permission.

OUT OF SCOPE FOUND: Native inherited process behavior, real encoding/decoding,
RSS peaks, actual cache ownership and visual evidence need future qualification.
The current resource observation has unresolved checkout cwd owners; it is not
admission. Whole T02 still needs actual 2×189 + eight still capture and visual
review; gameplay integration remains E05.T04. No merge, push, PR or main change.

ARTIFACTS: next-launch.json and NEXT_LAUNCH.md provide the exact next command,
grants/outputs/logs/validators, executable hashes, source bindings and budgets.
The reserve is 22,066,626,560 bytes, with four explicit copy slots and eleven
archive allowance slots; 157 current retained input files total 874,877 bytes and
are individually hashed. Fresh read-only observation found 61,654,462,464 bytes
free, margin 39,587,835,904; it is timestamped and never used as future admission.
All eleven prospective output/grant/consumption/cancellation/lease/copy paths
remain absent. See current-resources.json, unit-provenance.json,
combined-hash-manifest.json, metadata-final.json, admission-redgreen.json,
controls-final-bound.json and final-controls/. No new visual artifacts exist.

Next gates are fresh independent review and the parent's one-unit native
qualification authorization. Both runtime flags remain false in this commit.
