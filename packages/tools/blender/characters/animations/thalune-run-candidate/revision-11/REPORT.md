TASK: P1.E05.T02 — C2-F1 ACK evidence correction, Appendix C.2

STATUS: DONE for this bounded source/CPU correction. Fresh independent review is
parent-owned and remains pending. Native189 remains unqualified and below the
reported capacity admission requirement; no runtime permission or grant is created.

SUMMARY: Separated complete encoder write/flush operations from complete local ACK
emissions. The encoder now advances framesAcknowledged only after both the JSON
body and newline are fully written and ACK flush returns successfully. Incomplete
or failed delivery remains explicitly unconfirmed, with the precise phase and any
returned write counts preserved. The existing seen-ID guard and legacy receipt
frames count retain their encoder-write meaning. Original exceptions, terminal
return/signal evidence and persistence/release behavior remain unchanged. The
actual-pixel reviewer reproduction changes from reported=1/observed=0 to 0/0.

Base: `3503cd7d5187b78140bc22fbb5e418ee9f2c6798`, tree
`be67aeb7817b1af3b89a7a2a2c2093e6244c8b73`; branch
`codex/task/P1-E05-T02-thalune-reel-candidate`. Reviewed encoder SHA256:
`cb2e4045407d2115b174a567a207047de99d21fe0c113c49edeea1f192b4ded5`.
Corrected encoder SHA256:
`b829e7fc8ddff9d12b367040b6b0df9603279d027588db075530800946bc7d96`.
Final commit/tree and report/manifest digests are provided in the delivery record.

Authoritative review:
`/private/tmp/t02-native189-c2-independent-2NeVsiha/REPORT.md`, SHA256
`17dfaa2c670a5d4326fe803826ba602919ab97f44affaa8adea8f2e1b0d84240`.
Its sealed 266-file manifest, delivery and exact reproducer are preserved; the
review's REVISE verdict is historical evidence, not rewritten to PASS.

FILES CHANGED:

- rgb-primary.py: separate framesWrittenToEncoder and framesAcknowledged in the
  terminal record and each poll/wait observation. Preserve seen for duplicate
  work-ID refusal and legacy frames. Record the current ACK work ID, ordinal,
  serialize/body-write/newline-write/flush phase, returned lengths and completion
  status. Explicit write-length checks reject short, None and boolean returns.
  JSON body, newline order and flush remain the same wire protocol as before.
- readiness.json and candidate-index.json: update only the encoder binding and
  derived readiness hash/phase. Native-only flag stays true and browser runtime
  flag stays false; plan, paths, toolchain, work inventory and budgets are unchanged.
- source-audit.json: fresh bounded source/CPU counts and evidence hashes.
- revision-11/: focused controls, exact RED/GREEN copies, commands/raw logs,
  preservation/provenance, updated schema/example/handoff and hash manifest.
  No other existing source, helper, asset, library, playback or report changed.

VERIFY:

- Exact clean base was pinned before edits. Byte-identical copies of the sealed
  review's common.py, guard.py, ack-count-regression.py and neighbors.py ran in
  fresh exclusive scratch `/private/tmp/t02-ack-accounting-x5a_8ibx`. The guard
  refuses native child launches and writes outside scratch; read-only Git is the
  only permitted subprocess in guarded fixtures. Controls ran sequentially on
  the bound Python, using no more than two small controller/test workers.
- **RED actual-pixel reproduction: expected child exit 1.** Actual default
  1920×1080 localized DiagnosticStream, PNG parsing, opacity checks and RGB/RGBA
  hashes execute; only encoder process/rlimit ports are inert. One 6,220,800-byte
  RGB write and flush complete. The producer remains at ordinal 0, but the old
  failure-poll observation reports framesAcknowledged=1. The original
  BrokenPipeError and encoder return −25 remain retained. The exact failure tail:

```text
  File "/private/tmp/t02-ack-accounting-x5a_8ibx/ack-count-regression.py", line 31, in <module>
    assert reported==stream.ordinal,'Terminal evidence overstates ACKs: reported 1, actual 0'
           ^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Terminal evidence overstates ACKs: reported 1, actual 0
```

- The original neighboring script also reproduces first-write and newline
  defects, separately from its five passing neighbors. Those two outcomes stay
  DEFECT_REPRODUCED in the retained RED packet; its command exits 0 because it
  asserts the known defects. No old failed report was edited.
- **GREEN exact actual-pixel reproduction: child exit 0**, same reproducer bytes,
  reported=0/producer=0, encoder writes=1, original BrokenPipeError, known −25 and
  accepted=false. **Seven adapted neighboring cases PASS**, exit 0. Only the two
  expected defect counts/statuses and printed summary change in that script.
- **33 new actual-boundary controls PASS**, exit 0. First-write, newline and flush
  failures run with actual full-size PNG/pixel conversion. Remaining combinations
  use actual encode and DiagnosticStream with small-image/pixel ports: file/all
  persistence failures, ordinals 1 and 188, short/None/boolean write returns,
  encoder stdin flush failure, successful 189-frame inert transport, empty
  KeyboardInterrupt, real retained-helper one-shot SIGALRM, and body/newline
  exceptions after bytes have already reached the producer. Four cases pass the
  retained ACK exception through actual NativeAdapter/StationAdapter/dispatcher
  paths, including packet fallback and all-file/all-stream failures. All stop at
  one attempted job, retain raw/unknown facts, and leave no active timer. No
  later frame/wait/validator is dispatched after the failed ACK.
- Flush or after-newline failure can leave the diagnostic producer one ordinal
  ahead of framesAcknowledged. This is deliberately **unconfirmed delivery**,
  not an assertion that the consumer received nothing. The counter denotes
  completed local emission only, qualified by acknowledgmentBasis; there is no
  peer-confirmation protocol or inferred rollback. The completed encoder-write
  count remains independent. A preliminary 29-case pass is retained but not added
  twice to the final count.
- **31 retained terminal controls PASS**, exit 0, through the changed encode body:
  original return/signal handling, raw partial-byte timeout/observer errors,
  cancellation, failed final wait, unknown signal, successful inert transport,
  success-receipt failure and all-sink memory preservation remain green.
- **22 admission controls PASS**, exit 0: actual current source/plan verification,
  exact reserve arithmetic through inert capacity/allocation ports, invalid
  purpose/flags/head/hashes/order/expiry/cancellation/reuse, old spent-grant path
  refusal and instrumented absent-grant actual main with zero launch. Positive
  fixtures do not create operational grant, consumption or output paths and do
  not constitute live capacity admission.
- **Three actual CLI refusals**, each expected exit 1: native missing r10 grant
  gives FileNotFoundError; ordinary capture gives SOURCE_ONLY_RUNTIME_DISABLED;
  optimized Python gives T02_ASSERTIONS_REQUIRED. Raw stdout/stderr and argv are
  retained. No native helper is reached by the absent-grant admission fixture.
- Current passing total is **94 = 1 exact reproduction + 7 neighbors + 33 new
  boundary controls + 31 terminal controls + 22 admission controls**. Three RED
  manifestations and three expected CLI refusals are separate. The review's
  earlier 80 passing cases/12 old-base reproductions and full historical 525
  controls remain retained proof; broad suites, unchanged producer generation,
  library/Blender and visual qualification were not rerun.
- All 2,354 source/data bindings, 12 software identities and 42 index rows verify.
  Node remains 26.12.1, Python remains 3.12.14; no software retarget occurred.
  Python AST and direct pinned Node/local Prettier checks pass. No TS/JS product
  source changed and no package-manager command ran. Exact commands, exits,
  finite bounds and raw logs are in commands.json and evidence/.
- All **1,256 protected prior-manifest rows** match. All **31,264 review snapshot
  entries outside the four authorized encoder/metadata files** match, and all
  **266 sealed review files** retain exact hashes/sizes. That reference includes
  the original failed/spent run, grant/consumption, prior probes and historical
  receipts. The old full snapshot remains **FAILED/MISMATCH with three pnpm
  task-state deviations**. No marker was restored, removed or hidden. No existing
  failed/oversized scratch was copied or cleaned; only small new CPU evidence is
  retained in the repository.
- There were no unexpected failed test commands in this unit. The intentional
  actual-pixel RED exits 1 and the three CLI refusal exits 1 remain identified as
  such. No native189, codec probe, decoder, Blender, browser/GPU, service, DB,
  installer, LFS fetch/hydration, screenshot cleanup, push, PR, main or merge
  operation occurred. Existing helpers, assets, accepted playback, diagnostic
  generator, validator, release/accounting and inventory algorithms are unchanged.

DECISIONS:

- What does ACK completion mean → complete local body/newline writes and a returned
  flush → this is the sender's observable boundary, not proof of peer processing.
- How to record partial/failed delivery → preserve an unconfirmed attempt, phase
  and returned lengths → bytes may already be visible to the consumer, so neither
  success nor non-delivery may be inferred from a thrown flush/write.
- Change legacy frames/seen → no → preserve the encoder-write receipt contract
  and duplicate-ID guard; add independent, accurately named counters.
- Add new runtime infrastructure or change lifecycle → no → the current media
  failure receipt, terminal observation and dispatcher fallback mechanisms suffice.
- Clear the capacity hold after CPU tests → no → the retained observation is
  19,745,017,856 bytes free versus 22,066,626,560 required, a 2,321,608,704-byte
  shortfall. No fresh admission is claimed, no reserve is lowered, and no cleanup
  or capacity workaround is attempted. Parent must measure again before runtime.

OUT OF SCOPE FOUND: Full189 native encoder/validator qualification, actual owned
runtime release/RSS, Thalune two-reel feasibility, 378-motion/eight-still captures,
whole-animation visual acceptance and E05.T04 gameplay integration remain pending.
The original r04 remains FAILED/SPENT/HOLD. Native-only source activation remains
gated by an absent one-use grant, fresh independent review and resource admission;
browser capture remains disabled. No new human approval stage is introduced.

ARTIFACTS: revision-11/REPORT.md, LAUNCH.md, command.json, next-launch.json,
grant.schema.json and intentionally expired/HEAD-invalid grant.example.json,
commands.json, baseline.json, review/, evidence/, protected.json,
unit-provenance.json and combined-hash-manifest.json. No runtime media was created.
All eleven prospective paths remain unchanged and absent; the unused r10 names
need no replacement merely for this source correction.

Limits remain: 189 opaque 1920×1080 frames at 60 Hz, one ACK in flight,
39,354,368 bytes per reel, 64 MiB native metadata, sampled 8,589,934,592-byte
aggregate owned RSS, 600-second cohort / 60-second cleanup / 30-second final
inspection, 384 MiB / 4,096-entry joint cache admission, 1 GiB/job archives, four
copy slots, eleven archive allowances and **22,066,626,560 bytes reserve**.
These sampled/accounting mechanisms are not OS quotas or ownership of unrelated
Apple processes. The exact native-only command/protocol is in LAUNCH.md; it was
not executed with a grant in this unit.
