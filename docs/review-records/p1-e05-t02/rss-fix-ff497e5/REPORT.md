TASK: P1.E05.T02 — bounded startup RSS and failure-release correction, Appendix C.2

STATUS: DONE for this source/CPU unit. Fresh independent review and fresh parent
native admission remain pending. No native qualification, capture or cleanup of
either historical attempt is claimed.

SUMMARY: Replaced mandatory equality across every live-cohort RSS observation with
at most three attempts to obtain a complete stable sample under one three-second
deadline, or an earlier enclosing alarm. Interrupted samples remain unaccepted and
retain their raw facts. Executable admission now covers every member observed by
the sampler, including identities that can depart before the later observer.
Observed excess, unreadable/missing RSS, duplicate/reused identities, unknown
executable paths, malformed kernel accounting, cancellation and exhausted sampling
still stop dispatch. Cleanup can archive a physically drained job whose immutable
helper marks `clean=false` solely because of an already-retained workload error.
New cleanup errors or incomplete process/namespace proof still refuse release.

Base: `ddce6731b1fd465a1160d2f1e49813ff6f8c626c`, tree
`48da9aed7d28ed5901676496d7cc2ee0db6d7809`, branch
`codex/task/P1-E05-T02-thalune-reel-candidate`. Final commit/tree, readiness and
manifest hashes are provided in the delivery record. Exact old and new source
hashes are in baseline.json and unit-provenance.json; exact pre-edit source bytes
are retained in evidence/*.base.txt. No source/assets were recovered in this unit.
The earlier 21 recovery rows, two later recoveries, combined library provenance
and accepted six body assets remain unchanged.

ACTUAL FAILURE AND PREMISE:

- Parent attempt2 at the base commit exited 1 after 2.125189 seconds, with zero
  media and no validator dispatch. The original primary is `RSS cohort
birth/departure/duplicate during sample`. Parent evidence is
  `/private/tmp/space-t02-parent-native189-r2-q0jlxamt`; original packet is
  `/private/tmp/t02-native189-r10-20261107-t3-11167406`.
- The failed sample starts with PIDs 51693/51694/51695 and kernel counters
  started=10, exited=7, live=3. All three before/after birth identities match. Its
  per-PID RSS bytes are 23,429,120 / 38,354,944 / 2,670,592, totaling 64,454,656.
  The later membership includes PID 51704; kernel counters are started=12,
  exited=8, live=4. Equality is not an invariant of a live cohort. The old check
  refused normal membership change without proving a resource excess.
- Ownership of 51704 was observed through the retained coalition membership
  record, with birth [1794050759,100732], UID501, parent51694 and coalition43179.
  Its executable was **unobserved**. The encoder command is intent, not evidence
  of that PID's executable. The old record cannot be retrospectively admitted.
  The retained replay's new-member RSS is explicitly synthetic; it tests control
  flow, not the historical aggregate or executable identity.
- The helper later reported drained=true, kernel absent/live0, no remaining
  members, and clean=false because its errors list still contained the original
  observer failure. The caller stopped before archive/private-TMP release. The
  parent's later seven-PID check and registration exit113 prove physical process
  release only. The historical `terminalReleaseProved=false` is correct and is
  preserved along with the original failure, spent grant and all namespaces.

FILES CHANGED:

- resource_admission.py: bounded stable sampling, counter/identity checks,
  executable-admission callback, excess-before-retry ordering, interrupted sample
  retention, partial identity-read retention, and respect for an earlier active
  SIGALRM without replacing or rearming it. No cache/inventory algorithm changed.
- caller.py: connect sampled identities to the existing executable observer,
  preserve its original error before normalization, distinguish preexisting
  workload errors from new drain errors, and record fresh empty membership,
  absent kernel and known-birth checks before archive. The final audit is unchanged.
- native189.py: supply that same task-local executable-admission callback.
- native189-plan.json: r10 is spent; replace only prospective operational path
  names with unused r12 names. Counts, pattern, protocol and all budgets stay exact.
- readiness.json, candidate-index.json and source-audit.json: updated bindings
  and bounded evidence. `nativeFixtureAuthorization=true`,
  `runtimeAuthorization=false`. No allowlist or toolchain changes.
- revision-12/: source controls, exclusive evidence, report, absent path/schema
  handoff, retained namespace inventory/mapping, provenance and hash manifest.

VERIFY:

- **Exact-base RED: four reproduced failures, one passing negative control.**
  Before source edits, real harmless private child birth and completed departure,
  retained membership replay, and actual adapter/dispatcher cleanup reproduce the
  premise failure. The new-drain-error negative still refuses. A second sealed
  run loads the three byte-identical old source modules and exits **1**, with the
  same four failures. No codec/native process is launched.
- **54 new controls PASS, exit 0.** Actual ps RSS and exact retained libproc
  identity/executable-path functions observe private harmless Python children.
  Two executable-admission variants verify live identities against the bound
  Python. The fixture kernel ledger is explicitly private test data; no OS
  coalition or service is created. Every child waits on a pipe and is reaped.
  Across all retained iterations, all **29 distinct harmless child PIDs** have
  recorded terminal exit0 and a fresh absent identity. At most one harmless
  child exists concurrently; controller/test work remains within two workers.
- The actual NativeAdapter resource-observer/run/dispatcher boundary converges
  after a birth and dispatches two inert fixture jobs. Churn and an unknown
  executable path stop at one attempted job. These are inert native boundaries,
  not native execution. Full raw path-error attributes survive normalization as
  primary, with the subsequent assertion secondary.
- Sampling controls exercise exact 8GiB, excess including during a birth,
  legitimate departure, counter-only transient change, perpetual churn,
  duplicate/reuse/UID drift, incomplete identity/RSS, malformed/regressing kernel
  counters, TimeoutExpired partial non-UTF8 bytes and unknown fields, empty
  KeyboardInterrupt, cancellation, real three-second SIGALRM and a real shorter
  enclosing alarm. Every interrupted attempt remains visible and unaccepted.
  Partial identity-read observations survive a later read exception. Four actual
  rss_read command-result cases preserve malformed/missing/duplicate/unavailable
  stdout, stderr and unknown fields on the original refusal exception.
- Actual dispatcher cleanup tests retain the original TimeoutExpired through
  the exact helper wait normalization. Already-recorded workload errors permit
  archive only after positive fresh process-drain proof. Changed/new drain
  errors, remaining members, present/live kernel, live known birth, unreadable
  later birth, archive/private-release failures and a remaining registration all
  refuse terminal release. Packet fallback and all-file failure keep the full
  original primary in memory. Even when fresh resource audit passes,
  terminalReleaseProved remains false if persistence is unqualified. No durability
  is invented and no later validator dispatches after the primary failure.
- **66 retained focused controls PASS, exit 0:** 10 RSS cases, 12 actual
  adapter/dispatcher cases, and 44 actual wait/receipt/worker-read/fallback/CLI
  crossings for timeout, missing PID, excess and real deadline. Original primary
  precedence, partial bytes, unknown fields, bounded fallback, all-sink memory
  return, cancellation and timer unwind remain intact. Unchanged broad 525 proof,
  ACK proof, producer pixels, library and visual tests were not rerun.
- **22 admission controls PASS, exit 0.** Actual source/plan verification,
  positive exact reserve through in-memory ports, one-byte-short refusal,
  purpose/flags/head/hashes/order/expiry/cancellation/reuse, and actual absent-grant
  main with instrumented zero launch. No operational grant, claim or output is
  allocated. The positive case is not a fresh capacity admission.
- **Three final actual CLI refusals, expected exit 1 each:** missing r12 native
  grant, disabled browser capture, and optimized-Python refusal. Final unique
  passing CPU count is **142 = 54 + 66 + 22**; RED and CLI refusals are separate.
- All **2,354 source/data bindings, 12 software identities and 42 index rows**
  verify. Frozen Node26.12.1 and Python3.12.14 remain pinned. Python AST parsing,
  direct pinned Node/local Prettier and git diff whitespace checks pass. No
  TS/JS product source changed; no package-manager, installer or typecheck build
  ran. Exact commands/exits and intermediate results are retained in this packet.
- All **1,368 protected prior-manifest rows** match. All **50 current-attempt2
  baseline rows**, including both leftover namespaces, retain device/inode,
  ownership/mode, size, modification time and file hash. The three pnpm task-state
  deviations and the older full snapshot **FAILED** status remain unchanged;
  this narrower preservation pass does not turn that historical snapshot green.
- Intermediate failures are preserved: the first test draft used a nonexistent
  readiness `python` key; later drafts incorrectly expected durable release when
  persistence failed and simulated a live process disappearing from membership.
  Real shorter-deadline testing found nested alarm replacement/rearming could
  interrupt evidence retention; the final sampler keeps that already-active
  earlier alarm. A proof collector initially treated list-valued test details as
  a dictionary; its failed source/trace is retained, and the corrected collector
  verifies existing identical bytes before resuming. None of these records was
  relabeled or silently removed.

DECISIONS:

- Membership equality premise → require a bounded fresh stable cut, not equality
  for every attempted read → live children legitimately start and exit. This is
  sampled observation, not an OS quota or a continuous peak guarantee. Interrupted
  intervals and gaps between observations remain explicitly unqualified.
- Unknown/unreadable data → immediate refusal → do not zero missing PIDs or retry
  away an observed excess. Three unresolved attempts refuse; the deadline never
  renews. The regular 0.2-second sampling cadence remains unchanged.
- Departing sampled identities → use the existing birth/UID/executable admission
  contract → an unadmitted departure cannot borrow admission from another PID.
  Short-lived processes can still conservatively refuse when identity or RSS
  cannot be proved; that is an uncertainty stop, not a startup equality rule.
- Workload error versus release → preserve both independently → a past observer
  error must not by itself prevent cleanup after positive owned-process proof.
  New drain errors and strict final namespace/registration/birth audit remain gates.
- Historical leftovers → inventory and map only → no original file is archived,
  removed or rewritten. leftover-namespace-mapping.json gives 14 exact rows and
  an absent exclusive recovery destination for any separately scheduled recovery.
- Capacity → unchanged **22,066,626,560 bytes** required → attempt2's
  36,564,295,680-byte admission is historical, not future free capacity. No reserve
  lowering, disk cleanup or capacity workaround occurred.

LIMITS / NEXT UNIT:

Fresh r12 run/grant/consumption/cancel/cache-lease/copy paths plus the three disabled
browser paths are **all 11 absent**. LAUNCH.md and command.json contain the exact
future native-only command, schema/example and paths. No grant exists. The parent
owns fresh independent review, fresh capacity/ownership admission and any later
one-use native run. No new human approval stage was introduced.

Native diagnostic bounds remain 189 opaque 1920×1080 frames at60Hz, one ACK in
flight, 39,354,368 bytes per reel, 8GiB sampled aggregate RSS, 600-second job,
60-second cleanup, 30-second final inspection, 190-frame bounded surplus refusal,
384MiB/4096-entry cache admission and 1GiB archive/stage. Encode coalition release
must be proved before RGB/RGBA count/PTS/hash validation. The reserve still accounts
for four packet copies and eleven archive slots. Actual parent OS exit0 remains
required; a provisional result is insufficient. ACKPASS still means completed
local emission, not peer confirmation.

OUT OF SCOPE / REMAINING GATES: Full native189 qualification, actual native process
closure, later browser-specific exact owned Apple closure/cache admission,
378-motion/eight-still capture, both validators, visual grading and whole-animation
acceptance remain open. Gameplay integration remains E05.T04. This unit launched
no encoder/decoder/ffmpeg, probe, Blender, browser/GPU, service, grant or installer;
it performed no hydration, original-namespace cleanup, screenshot cleanup,
orchestration-doc edit, push, PR, main change or merge.
