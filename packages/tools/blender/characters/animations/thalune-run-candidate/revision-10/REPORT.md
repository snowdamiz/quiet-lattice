TASK: P1.E05.T02 — spent native189 diagnosis and bounded correction, Appendix C.2

STATUS: DONE for this correction, two permitted short probes and CPU controls.
The original native189 remains **FAILED / SPENT / HOLD**. The new candidate needs
fresh independent review and a fresh parent one-use grant; no full189 rerun,
validator, browser capture or operational grant occurred in this unit.

SUMMARY: The original full-frame-changing lossless diagnostic reached the exact
39,354,368-byte file limit after 87 acknowledged input frames. Its worker discarded
the encoder poll result before asserting, so the historical exact child return
code/signal is unavailable. A short negative probe reproduced SIGXFSZ at a reduced
diagnostic file cap with the same empty log. The worker now retains poll/wait
results before assertions or persistence, including exit status, signal and raw
observer failures. A new positive transport fixture retains the detailed static
background and moves a patterned region. The original entropy generator remains
unchanged as an adverse fixture. No production media, frame or resource limit was
increased. Fresh r10 identities are configured without allocation.

Base: `654658363a0347b1f50a40f868c32140b90881db`, tree
`de2bacc2cec04a2dbb6dc9ef06a2499f82aac5f6`; branch
`codex/task/P1-E05-T02-thalune-reel-candidate`. Final commit/tree and report/hash
manifest digests are in the delivery record. Original combined library/donor pins,
21 recovery rows and two earlier additional recoveries remain in unit-provenance.json.
No source recovery, asset replacement or hydration was added.

FILES CHANGED:

- rgb-primary.py: record every nonblocking poll and final wait before assertions;
  keep known exit code, signal number/name and all observations. A single
  nonblocking failure poll can observe an exit racing a broken pipe. A failed
  observer is not retried. Its raw exception facts remain secondary to the
  original source/write/timeout/cancellation error. No added kill, wait, launch,
  retry or timeout renewal occurs on this failure path. Success and failed media
  receipts include the terminal record; all-sink failure retains it in memory.
- native189_producer.py: retain diagnostic() and its full-frame entropy pattern
  unchanged. Add localized_diagnostic(): background is diagnostic frame zero;
  a 384×576 region uses frame i at `(640+4*(i%61), 220+i%31)`. Its active area is
  10.67% of 1920×1080. Opaque RGBA PNGs remain transient in memory; the encoder
  receives RGB, with one ACK in flight and exact RGB/RGBA/source hashes.
- native189-plan.json: bind that explicit positive pattern and new r10 run,
  grant, consumption, cancellation, cache lease and copy paths. Counts, jobs,
  packet inventory, retained inputs, budgets and cleanup bounds are unchanged.
- readiness.json/candidate-index.json/source-audit.json: current source hashes and
  revision status. nativeFixtureAuthorization stays true; runtimeAuthorization
  stays false. Toolchain, process allowlist, capture inventory and source helpers
  are unchanged. Native permission still requires the separate one-use grant.
- revision-10/: focused CPU controls, exact RED/GREEN and short-probe evidence,
  proposed launch/schema, preservation/provenance and hash manifest.

VERIFY:

- Original parent evidence is at
  `/private/tmp/space-t02-parent-native189-mzza0wfn`; spent run is
  `/private/tmp/t02-native189-r04-20261107-t3-11167406`. Parent actual OS exit was
  1 after 18.890572 seconds, with 26,793,009,152 bytes observed free versus
  22,066,626,560 reserved. That old free-space observation is **not future
  admission**. One native189 job ran; its validator did not dispatch. The partial
  media is exactly 39,354,368 bytes and encoder.raw.log is empty. Parent release
  evidence records coalition absent/live zero, absent known PIDs and launchctl
  exit 113. All **50 retained run/parent/grant/consumption entries** still match
  their original metadata and hashes; no partial file or spent grant was changed.
- Historical terminal diagnosis is qualified: RLIMIT_FSIZE was set to the exact
  media ceiling, and output reached it. This establishes exhaustion of the
  declared output allowance. The generic early-exit assertion discarded poll's
  integer; the original child signal cannot be recovered from these receipts.
  SIGXFSZ is reproduced by the new diagnostic, not invented as an observed
  historical exit. 87 ACKs count accepted input writes, not independently decoded
  frames; no historical decoder was run.
- Two and only two software FFmpeg probes ran in exclusive scratch
  `/private/tmp/t02-native189-diagnosis-ok6396d2`. Both use the reviewed FFmpeg
  9.0.2 executable, SHA256
  `1ede5c7fd4e97d832ec69c97c78231875de7d69c55423158f5f4a4d923227dd5`,
  libx264rgb medium/CRF0, one codec/filter thread, 1920×1080 RGB, 60 Hz, at most
  16 frames, a finite 60-second bound and sampled aggregate 2 GiB RSS stop.
  FFmpeg has its own owned process group and finite TERM/KILL cleanup. Raw frames
  and PNGs were not spooled; media and every diagnostic failure remain retained.
- Probe 1 (entropy cap negative): encoder PID/group 32810 returned **−25 /
  SIGXFSZ**, media exactly 1,048,576 bytes, log zero bytes, 0.962620 seconds.
  Four writes completed; a fifth hit BrokenPipeError. Peak sampled aggregate RSS
  was 206,700,544 bytes. The driver itself exited **1** because its terminal
  identity assertion raced the already terminating/reaped child. Its first four
  RSS samples, traceback, broken-pipe evidence, exact wait return and positive
  group release remain retained. The failing fifth ps classification row was not
  retained by that first driver; no complete observer-history claim is made.
  This driver failure is not relabeled PASS and was not retried.
- Probe 2 (localized positive): encoder PID/group 33711 returned **0**, all 16
  writes completed, media 1,269,603 bytes, log zero bytes, 3.248575 seconds.
  Peak sampled aggregate RSS was 257,687,552 bytes. The second driver records its
  raw observation before fallible identity classification and checks terminal
  state first. Its exit was 0. Only this second, previously unstarted probe ran;
  no third probe or codec/decoder execution occurred.
- Both children were reaped, writer threads ended and owned groups were absent.
  A fresh ps check of both PIDs returned 1 with empty stdout. The codec CPU slot
  was reported released before continuing source work. Probe output inventory
  at phase completion was 2,374,433 bytes, below the 32 MiB combined allowance.
  The media files remain external at their original paths; the repository retains
  their path/size/hash and small proof files, not copied video payloads.
- **12 exact-base RED reproductions**, exit 0: early returns −25, −9, 17 and 0
  crossed normal, file-failure and all-sink-failure paths. Every case showed the
  original missing terminal evidence. The exact source was read from the base
  commit and its hash retained. **31 final terminal controls PASS**, exit 0,
  cover those cases, broken pipes, raw TimeoutExpired partial bytes/unknown
  attributes, cancellation, failed secondary observer, nonzero final wait,
  unknown signal number, successful 189-frame inert transport, final success
  receipt failure, and all-sink failures. A preliminary 26-case passing run is
  retained but not counted twice.
- **22 focused CPU controls PASS**, exit 0: actual adapter/dispatcher stops after
  one attempted job for the retained encoder failure, including proof fallback
  and all-sink/CLI structured-memory paths; real retained one-shot SIGALRM unwinds
  without later frame writes and leaves no active timer. Prior pixel, ACK,
  persistence, 189/190 surplus and reserve-boundary controls pass. Twenty selected
  full-size PNG frames (0–15, 60, 120, 180, 188) satisfy exact pattern/opacity/hash
  checks; the first 16 RGB hashes equal the actual positive probe inputs. A
  189-frame small-image stream checks exact order/PTS/ACK/hash refusal. The old
  positive pattern is rejected by the new positive stream; its generator remains
  byte-for-byte equivalent in the AST and remains the negative fixture.
- **108 existing pure Python contract controls PASS**, exit 0, with all native
  child ports refused. The sole test-driver transformation redirects its report
  to fresh scratch; no historical report is overwritten. Count/order/PTS/hash,
  packet limits, release and attempted-job controls remain passing.
- **22 admission controls PASS**, exit 0. Actual new source/plan bindings verify;
  inert positive consumption accepts the exact reserve boundary and unknown
  fields, while one byte short, stale hashes/head, wrong flags/purpose/order,
  expired/spent/cancelled cases refuse. The wrong-path case specifically refuses
  the old spent r04 grant before reading or consuming it. No operational grant,
  consumption or output is allocated. Actual main with an absent r10 grant reaches
  no adapter or child launch port. Three real CLI commands return expected exit 1:
  absent native grant / disabled capture / optimized-assertions refusal.
- Current total: **183 passing CPU controls = 31 + 22 + 108 + 22**, plus three
  expected CLI refusals and 12 RED reproductions. The prior complete 525-control
  corpus remains immutable prior evidence; it was not wholesale rerun or counted
  as current qualification. No native189 validator, Blender/library/asset suite,
  browser, GPU, service, DB, package-manager, install or hydration was run.
- All 2,354 source/data bindings, 12 software pins and 42 index rows verify. Node
  remains 26.12.1 and Python 3.12.14. Python AST/static checks and direct pinned
  Node/local Prettier checks pass; no TS/JS product source changed. No pnpm task
  state was changed. All **1,184 protected prior-manifest rows** match. All
  **29,648 R5 snapshot entries outside the six authorized source/metadata files**
  match, including assets, helpers and the current pnpm task state. The historical
  full snapshot remains **FAILED/MISMATCH with three pnpm deviations**; no marker
  was restored, deleted or hidden.

Exact argv/exits are in commands.json and evidence/admission-cli-commands.json;
probe command/result JSONs retain codec flags, caps, PIDs, samples and hashes.
The actual failed first probe-driver traceback ends:

```text
Traceback (most recent call last):
  File "/private/tmp/t02-native189-diagnosis-ok6396d2/probes.py", line 84, in <module>
    assert result['releaseProved'] and failure is None
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError
```

Its retained observer traceback ends:

```text
  File "/private/tmp/t02-native189-diagnosis-ok6396d2/probes.py", line 61, in <module>
    assert subject[0]['birth']==birth and subject[0]['ppid']==os.getpid() and subject[0]['command']==FF
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError
```

The initial staged-manifest check exited 1 because Git ignore rules omitted the
two zero-byte encoder.raw.log evidence files. Both exact files were explicitly
added to the index; no source or log bytes changed. The failure and correction
are retained in evidence/staging-first-failure.json. Its final error was:

```text
AssertionError: /Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/revision-10/evidence/entropy-cap-negative/encoder.raw.log
```

DECISIONS:

- Is 39,354,368 bytes a universal lossless bound → no → the full-frame-changing
  fixture exhausted it. Preserve the production ceiling and negative evidence.
- Does localized motion prove rendered-reel feasibility → no → it tests the
  native transport, opaque channel hashes, frame timing/order and release path
  under a declared localized-motion workload. No actual Thalune pixel entropy was
  measured. A static background and moving region model temporal locality only;
  the 16-frame result is neither a 189-frame guarantee nor an animation visual
  acceptance. The future full189 validator and real scene captures remain gates.
- Can the spent run be reused → no → keep its grant, consumed record, partial media
  and every receipt intact; use distinct r10 identities only after fresh review.
- Raise budgets or broaden Apple executables → no → no media/resource bound changes
  and no allowlist expansion. CPU libx264rgb/software decode do not need a browser
  VideoToolbox route. Separate browser activation still needs exact owned Apple
  closure and fresh cache/resource admission.

OUT OF SCOPE FOUND: Full189 feasibility, real encoder/validator cohort qualification,
rendered 378-motion/eight-still capture and visual grading remain pending. Shared
animation library proof is retained; gameplay integration remains E05.T04. Current
free-space observations are not future grants. No orchestration docs, main, push,
PR, merge, screenshots or old failed scratch were changed or cleaned.

ARTIFACTS: revision-10/LAUNCH.md, next-launch.json, command.json,
grant.schema.json, intentionally invalid grant.example.json, commands.json,
evidence/, baseline.json, protected.json, unit-provenance.json and
combined-hash-manifest.json. The two short diagnostic media remain under the
exclusive scratch paths in evidence-provenance.json. They are transport probe
artifacts, not animation capture or visual-grading evidence.

Unchanged next-run bounds: 189 opaque 1920×1080 frames at 60 Hz; one ACK in flight;
39,354,368 bytes/reel; 64 MiB native metadata; sampled 8 GiB aggregate owned RSS;
600-second cohort, 60-second cleanup, 30-second final inspection; 384 MiB/4,096
cache entries; 1 GiB/job archive allowance; four copy slots and eleven prospective
archive allowances; **22,066,626,560 bytes incremental reserve**. The preserved
spent run is already on disk and is not recopied into a new slot by this unit;
future admission must measure current free space including that existing use.
No OS quota or unrelated XPC ownership is claimed.
