TASK: P1.E05.T02 — C2-R12-F1/F2 correction, Appendix C.2

STATUS: DONE for this bounded SOURCE/light-CPU correction. Both findings have
targeted RED/GREEN evidence. Fresh independent review remains parent-owned. No
native189, capture, capacity, visual, whole-animation or gameplay acceptance.

SUMMARY: Final terminal release qualification now requires both the existing
positive release audit and at least one verified complete terminal-summary sink.
The original workload failure, raw resource/receipt facts and both delivery errors
remain available when neither sink qualifies. Either complete verified sink still
suffices. A new test-only old-base replay verifies exact source bytes, intended
failure reasons and actual child/RSS/cleanup milestones. Historical incorrect RED
claims and failed harness results remain unchanged.

PINS:

- Base: `ff497e5525f8e93c71df67827446d7e426bbc20d`; tree
  `5eccd017f148fbedc6b1fc751fb16ea7fcc1c660`.
- Branch: `codex/task/P1-E05-T02-thalune-reel-candidate`; worktree
  `/Users/andreyyurlov/.t3/worktrees/space/t3-11167406`.
- Immutable review: `/private/tmp/t02-independent-c2-r12-hsKJ8v8Q/REPORT.md`, SHA256
  `4967706982a94910ed7acf3fca554c2ad3963ae9cf1bad2ba9be70a45c512df1`.
  Its delivery and all 579 sealed evidence files verify. Exact report, delivery,
  manifest and reproducer sources are copied under review/ with original bytes.
- Reviewed release_accounting.py SHA256:
  `bf84569764d31354e6a6955b450f68a03ed6d3753ba41f36e4dfafcd10032ae8`.
  Reviewed source bytes are retained as reviewed-release-accounting.py.txt.
- Corrected hashes are in unit-provenance.json and the combined hash manifest.
  Final clean HEAD/tree and post-commit verification are in the delivery record.

FILES CHANGED:

- release_accounting.py: five-line diff. Preserve the prior audit result as
  terminalReleaseAuditProved; initialize terminalReleaseProved=false. A complete
  verified proof snapshot can qualify it before the packet snapshot; the final
  returned flag is the audit result AND completeObservationsPersisted. No extra
  write, retry, sink, cleanup mechanism, budget or helper change.
- readiness.json and candidate-index.json: only the accounting source binding,
  derived readiness hash and review phase change. Native-only flag stays true;
  browser runtime flag stays false. Plan, paths, toolchain and allowlist stay exact.
- source-audit.json and revision-13/: corrected evidence/report/provenance,
  task-local CPU controls, absent-path and schema/command handoff. Historical
  reports, code under revision-12, original delivery and failed packets are immutable.

VERIFY — C2-R12-F1:

- Before the product edit, exact immutable sink-boundary.py runs at the pinned
  base through actual NativeAdapter.run, StationAdapter.run, exact retained helper
  wait, historical-error cleanup, archive/private release and run_sequence.
  Earlier per-job receipts succeed. Both terminal sinks fail. The result is HOLD,
  one attempted inert job, original TimeoutExpired primary, false complete
  persistence but **terminalReleaseProved=true**. The required assertion exits 1.
  Proof-only and packet-only failures each exit 0 with one verified complete sink.
- After the edit, the identical three reviewer scripts each exit 0. Both-failure
  now returns terminalReleaseAuditProved=true, terminalReleaseProved=false,
  completeObservationsPersisted=false. Original partial non-UTF8 stdout/stderr,
  unknown attributes, cleanup facts and both delivery errors survive. No validator
  dispatches. HOLD already blocked dispatch before the fix; this corrects release
  qualification, not a claimed dispatch escape.
- **41 additional actual-boundary controls pass**, exit 0: all 36 combinations
  of successful write, pre-write exception, exception after writing bytes,
  corrupted readback, empty cancellation and real retained SIGALRM, plus three
  readback-error cases and two compact-envelope branch cases. Receipt persistence
  succeeds independently in every case. The original primary object is retained,
  both sinks are attempted exactly once and all returned errors retain raw fields.
- Each one-sink case checks the actual retained destination bytes, length and
  SHA256. Both failures never qualify release, including after-byte failures where
  apparently complete but unverified files remain. A written incomplete packet
  envelope alone is insufficient. A bounded envelope referring to a verified
  complete proof snapshot preserves that fallback. The two envelope controls use
  an explicitly inert 2048-byte branch threshold; production limits are unchanged.
- Proof files are pre-verification snapshots, so their release flag starts false.
  Final returned qualification is computed after readback; packet snapshots can
  include a release flag backed by the already-verified proof. Later delivery
  errors remain in the returned result under the existing snapshot semantics.
  This does not claim fsync/power-loss durability or invent persistence when both
  verified destinations are unavailable.

VERIFY — C2-R12-F2:

- The unmodified supplied red-source.py reproduces nominal four FAIL rows and
  exits 1, but birth/departure are **TypeError: unsupported admit keyword**. The
  birth case reaches no RSS or child launch; the departure child is reaped before
  an RSS read. Only replay and cleanup are intended manifestations in that run.
  The revision-12 report and delivery incorrectly counted all four as genuine
  old behavior. They remain byte-identical historical evidence, not amended PASS.
- The exact independent compatible-red.py also runs before the product edit and
  exits the expected 1, reproducing four intended old failures plus a passing
  refusal negative. Only its test AST omits the optional admit keyword.
- New compatible-red-controls.py passes **five explicit assertions**, exit 0:
  four intended old failures and the refusal negative. It checks four old product
  modules byte-for-byte against Git at
  `ddce6731b1fd465a1160d2f1e49813ff6f8c626c`, including the unchanged historical
  accounting module. No old source is written into the checkout. The sole test
  adaptation removes admit at the retained test constructor line60.
- Birth must reach a real ps RSS read, show the child absent before/present after,
  and fail the old membership assertion. Departure must include the child in RSS,
  observe its absence afterward and fail the old reuse/departure assertion.
  Child exit0 and absent identity are required. Arbitrary exceptions or FAIL counts
  cannot satisfy these controls. Cleanup must reach exactly start/drain, preserve
  the original TimeoutExpired and fail before archive/private release. Synthetic
  replay remains labeled synthetic and supplies no historical executable proof
  for PID51704.

REGRESSION / ADMISSION / PROTECTION:

- **142 supplied controls pass**, exit 0 for each runner: 54 revision-12 boundary
  controls, 66 retained RSS/dispatcher/error-precedence controls, 22 admission
  controls. The 41-case sink matrix and three exact reviewer GREEN replays bring
  current-source passing executions to **186**. Five old-base milestone assertions
  are separate. Repeated executions and earlier 525/ACK/library proof are not
  added again or described as fresh broad acceptance.
- Three actual CLI refusals each exit 1 for the intended reason and record zero
  launches: absent r12 grant, SOURCE_ONLY_RUNTIME_DISABLED, and optimized Python's
  T02_ASSERTIONS_REQUIRED. cli-verified.json identifies the final qualified runs.
- One initial guarded CLI fixture lacked the target script's import directory and
  failed with ModuleNotFoundError. The test-only wrapper now mirrors normal script
  import lookup. The immutable review guard also consumes a string SystemExit
  without printing its message, so its optimized refusal could not satisfy the
  diagnostic assertion. A separate instrumented optimized CLI preserves the real
  SystemExit text and records zero process/network launches. All failed harness
  files remain; none is counted as a passing product refusal.
- Tests run serially with at most one harmless pipe child at a time and at most
  two CPU workers. All **nine** distinct harmless child PIDs have recorded exit0,
  are reaped and have fresh absent identities. OS ownership/coalition/launch ports
  in adapter fixtures remain inert; no service or native fixture was created.
- The immutable review guard limits writes to exclusive scratch and permits only
  exact harmless Python children, read-only Git and ps RSS. cpu-port.py supplies
  an explicitly inert disk_usage result and forbids live statvfs. Thus no test
  freeBytesAfter field is a live capacity observation or new admission.
- Exclusive scratch: `/private/tmp/t02-r13-terminal-kyrij2wd`. Raw per-job/sink
  files, including corrupt and after-byte failure files, remain there, with a
  scratch hash manifest. Selected complete results, commands, stdout/stderr and
  capacity-port declarations are copied into evidence/. New scratch plus repository
  evidence remains below **256MiB**; final byte accounting is in the delivery.
- All **1,429** prior manifest rows outside the four authorized mutable files
  match. Of the **1,368** earlier protected source rows, **1,367** match and the
  sole exception is the explicitly authorized release_accounting.py correction;
  its old row/bytes are retained and both hashes are recorded. All **50**
  attempt2 baseline entries retain exact device/inode/owner/mode/size/mtime and
  recorded file hashes. Both leftover namespaces remain untouched. All **579**
  immutable review seal entries match. Helpers, six body assets, four animation
  blobs, library, ACK encoder, localized producer, playback and work inventory
  retain their hashes. No new source recovery or asset hydration occurred.
- All 2,354 source/data bindings, 12 software pins and 42 candidate-index rows
  verify. Node26.12.1 and Python3.12.14 are unchanged. Python AST and scoped direct
  Node/local Prettier checks pass; git diff whitespace verification passes. No
  TS/JS product source changed, package manager ran, or build/typecheck was needed.
- The old attempts stay FAILED/SPENT/HOLD. The original r10 terminalReleaseProved
  remains false; this source change does not rewrite it. Historical pnpm full
  snapshot stays FAILED/MISMATCH with the same three task-state deviations.

DECISIONS:

- Release audit versus complete delivery → retain both and qualify only after
  verified delivery → positive physical cleanup is not complete durable evidence.
- One verified destination → preserve fallback → failure of the other sink does
  not erase complete verified evidence. Both errors remain recorded when neither
  qualifies; no extra retry or unbounded persistence mechanism is introduced.
- Historical RED claim → correct through new evidence only → exact error reasons,
  real RSS reads and child/cleanup milestones establish the premise, not exit1 alone.
- Runtime paths → retain the unused r12 identities → all eleven remain absent;
  no grant, consumption, output or recovery archive is allocated.

LIMITS / HANDOFF:

Native-only source flag remains true and browser runtime remains false. command.json,
grant.schema.json, inert grant.example.json, next-launch.json and LAUNCH.md contain
current bindings. Parent owns fresh independent review, all launches and any fresh
resource admission. No human permission stage was added.

Production bounds remain: reserve22,066,626,560 bytes; sampled RSS8,589,934,592 bytes;
189 opaque 1920×1080 frames at60Hz; one ACK in flight; 39,354,368 bytes per reel;
600-second job; 60-second cleanup; 30-second final inspection; bounded190 surplus;
384MiB/4096 cache entries; 1GiB archive/stage; four packet copies; eleven archive
slots. Native encode release must qualify before validation, with actual parent
OS exit0 still required. ACKPASS remains completed local emission only.

OUT OF SCOPE / REMAINING: Fresh independent review, native189 qualification, actual
owned native closure, browser-specific Apple closure/cache admission, 378-motion/
eight-still capture, both validators, visual grading and whole-animation acceptance
remain open; gameplay integration remains E05.T04. No encoder/ffmpeg/ffprobe,
Blender, browser/GPU, native189, service, grant, capacity probe, installer, hydration,
old-namespace cleanup, screenshot cleanup, orchestration edit, push, PR, main change
or merge occurred. Screenshot cleanup remains STOPPED.
