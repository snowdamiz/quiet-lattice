TASK: P1.E05.T03 — SOURCE R1 revision

STATUS: BLOCKED — all four R1 source findings are corrected and CPU checks pass.
The parent must run fresh R2 review, allocate GPU review, obtain the blind visual
grade and complete merged verification. This report does not mark T03 accepted.

SUMMARY: Reject incomplete material loads before publishing a viewmodel; retain
CPU lane ownership through bounded signal/deadline cleanup; invalidate only the
attempted failed export while preserving prior evidence; and require a successful
validation receipt for the exact source/export/report bytes. No production mesh,
source, export, accepted body, preview or accepted review packet was regenerated.

Revision base: `2e4feb5d437b9535637f5338ab6162069f0b75f1`.
Base tree: `bd880cc68379610c20d191a6cf72701a41d03fd1`.
Original task/T01 comparison base: `45c172a102f1944ff00be0b6e5006eef13fd793b`.
Branch: `task/P1-E05-T03`. The final commit and tree are in the worker handoff;
this committed report cannot contain its own resulting commit/tree identities.

FILES CHANGED:

- `packages/client/src/entities/Multitool.js`: validate required Skin/Bio/tool
  material names, PBR slots, decoded 2k dimensions and complete mip chains before
  attachment. An incomplete result follows the existing error/toast path and its
  owned resources are disposed; the shared KTX loader is retained.
- `Multitool.viewmodels.test.js`, `Multitool.materials.test.js` and
  `packages/client/test/characters/viewmodelConsumer.mjs`: actual production
  GLTFLoader/Meshopt/KTX2/Basis consumer tests, partial failures, successful decoding,
  obsolete completions and exactly-once resource disposal. Geometry-only stripped
  fixtures are explicitly insufficient for publication.
- `packages/tools/blender/characters/viewmodels/{run_cpu,export,evidence,inventory}.py`:
  owned-group cleanup before unlock; precise failed-destination cleanup; immutable
  attempt history; source/export/report receipts; inventory rejection on mismatch.
- The same tooling directory's `test_pipeline.py`, `test_inventory.py`,
  `test_saved_failures.py`, `README.md` and this report.
- `assets/renders/characters/viewmodels/validation/`: new current reports/receipts
  plus separately retained prior reports/inventory. `inventory.json` now references
  receipt hashes. `revision-r1/` retains original R1 and new red/green evidence.

VERIFY:

All commands used this task checkout. Tests used at most two workers and disabled
file parallelism. The three real Blender invocations ran sequentially with two
threads, explicit finite deadlines and owned-group cleanup. No renderer, browser,
server, database, GPU bake/render or native capture ran in this revision.

R1 finding dispositions:

1. P2 material readiness — FIXED. The original real-consumer repro at the pinned
   base yielded `attached=true`, no error/toast and all maps missing after two
   Basis 503 responses. After the fix, the same fixture yields `attached=false`,
   the existing model-load error, one warning toast and no attached materials.
   Its original assertion that the bug still exists now exits 1 as expected;
   the new regression tests assert the correct result and pass. Six partial-map
   cases also exercise successful sibling decoding and a subsequent valid load
   on the same engine-owned loader. Obsolete incomplete loads cannot publish an
   error or dispose the active model.
2. P2 interruption cleanup — FIXED. The pinned harmless stand-in reproduced exit
   -2, a live child and an acquirable lock. Current real-process tests cover SIGINT,
   SIGTERM, deadline, TERM resistance, natural exit and leftover descendants.
   A child-held TERM barrier proves both direct lock acquisition and a replacement
   runner fail while the old child lives; an unrelated witness stays alive. TERM
   and KILL have two-second grace periods, the direct child is reaped, and failed
   confirmation leaves an unclean marker that prevents another launch.
3. P2 failed export cleanup — FIXED. Both pinned injected failures left the old
   GLB serving. Current scratch wrapper cases remove only the attempted people's
   exact destination after opening the source. A real saved scratch source with
   Muzzle deleted, and a real export reaching an injected codec exception, both
   return wrapper exit 1 with FAIL receipts, no destination and the prior export
   SHA retained in history. An unreadable source retains its old destination but
   retires current PASS evidence. A separate regression proves a failed new output
   cannot overwrite the archived prior export. Peer files remain unchanged.
4. P2 unbound inventory evidence — FIXED. The pinned inventory accepted nine bytes
   `not a GLB` alongside stale PASS reports. Current inventory accepts the exact
   real assets and rejects that truncation, another real source, a changed PASS
   report, a mismatched source/export hash pair and a missing receipt. A failed
   inventory attempt archives the prior inventory; it cannot leave it current.

Executed checks and results:

```sh
pnpm exec vitest run packages/client/src/entities packages/client/src/exosuit.test.js packages/client/src/Game.test.js --maxWorkers=2 --no-file-parallelism
# exit 0: 8 files / 101 tests (the original 91 plus 10 real-texture cases)
pnpm typecheck
# exit 0: shared, client, tools, server
pnpm exec eslint packages/client/src/entities/Multitool.js packages/client/src/entities/Multitool.viewmodels.test.js packages/client/src/entities/Multitool.materials.test.js packages/client/test/characters/viewmodelConsumer.mjs
# exit 0
pnpm exec prettier --ignore-path /dev/null --check packages/client/src/entities/Multitool.viewmodels.test.js packages/client/src/entities/Multitool.materials.test.js packages/client/test/characters/viewmodelConsumer.mjs packages/tools/blender/characters/viewmodels/README.md packages/tools/blender/characters/viewmodels/REVISION-R1.md
# exit 0; Multitool.js retains the repository's existing demo-JS formatting exemption
python3 packages/tools/blender/characters/viewmodels/test_pipeline.py
# exit 0: 14 tests, including expected injected exceptions
python3 packages/tools/blender/characters/viewmodels/test_inventory.py
# exit 0: 6 tests over the actual inventory entry point and real inputs
python3 -m compileall -q packages/tools/blender/characters/viewmodels
# exit 0
python3 packages/tools/blender/characters/viewmodels/inventory.py
# exit 0: current receipt pairs and protected body hashes verified
python3 assets/renders/characters/viewmodels/revision-r1/protected_audit.py
# exit 0: 6 accepted bodies, 6 viewmodel files, 6 previews, 745 existing review
# packet files and all 36 original reviewer evidence files unchanged
git diff --check
# exit 0
```

Final real Blender commands (each runner exit 0):

```sh
KTX=/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx ART_KTX_JOBS=1 python3 packages/tools/blender/characters/viewmodels/run_cpu.py /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r1-fix.i35x9qqn/real-saved-failures-final.log 180 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 -P packages/tools/blender/characters/viewmodels/test_saved_failures.py -- /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r1-fix.i35x9qqn/real-saved-failures-final
KTX=/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx ART_KTX_JOBS=1 python3 packages/tools/blender/characters/viewmodels/run_cpu.py /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r1-fix.i35x9qqn/validate-current.log 240 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 -P packages/tools/blender/characters/viewmodels/export.py -- --validate-only
```

The saved failure fixture returns 0 after asserting each expected wrapper exit 1.
The current validation-only command passes the five standard art gates on all
three saved sources and all three actual GLBs, plus the custom rig/axes/weights/
packed-map/clearance checks. It writes fresh receipts without changing any of the
six source/export bytes. The scratch failure command was run again after the failure-message and
archive-collision refinements; both the earlier and final run are retained. The
final 14 Python tests also cover preserving different prior and failed outputs.

Original reviewer scripts were copied into fresh scratch with only evidence-output
paths changed. The pinned material and pipeline negative scripts both exited 0
before fixes (that exit means they asserted the defects). Original scripts, reports,
logs and their hashes remain intact in `review-evidence.tar.gz`. New red summaries
are in `revision-r1/red/`. After fixes these copied positive/negative scripts ran:

```sh
node --import tsx /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r1-fix.i35x9qqn/green-reviewer/material_failure.mjs
# exit 1 (expected: old buggy-behavior assertion fails)
node --import tsx /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r1-fix.i35x9qqn/green-reviewer/full_consumer.mjs
# exit 0
node --import tsx /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r1-fix.i35x9qqn/green-reviewer/actual_stale.mjs
# exit 0
```

The full consumer again decodes all maps for all three people, disposes retired
resources exactly once, and exercises `Multitool.update()` with actual rigs at
16:9/21:9 and world FOV 64/70/80. Maximum projected muzzle error is
`1.3877787807814457e-16` NDC. The real delayed A→B→A case retains the current model
without sharing or disposing its resources. These checks each use one CPU Worker.

Failure tails: `revision-r1/failure-tails.txt` retains the last twenty lines of the
expected post-fix original material assertion, actual scratch Blender failures,
Python negative cases and an initial protection-audit harness error. The audit
first assumed every review file was an LFS pointer (StopIteration, exit 1); it was
corrected to compare ordinary Git blobs too and rerun successfully. Full logs and
original failure evidence are retained separately; no product failure is relabeled
as a pass.

DECISIONS:

- Texture success callback → enforce the concrete authored material contract →
  individual KTX failures can otherwise become bare-material success.
- Shared loader ownership → dispose only resources in the owned returned scene →
  partial failures and stale loads cannot disable subsequent consumers.
- Process interruption → retain the lock through bounded group cleanup/reaping →
  another CPU job cannot enter an occupied lane. Unknown prior cleanup stays held
  by a marker for inspection; no PID from an old marker is signalled.
- Known invalid destination → remove only that people's current export after
  source load → preserve historical bytes/reports while preventing stale service.
- Validation proof → exact source/export pair and report digests at successful
  validation → inventory cannot reuse a PASS for replacement bytes.
- Unchanged meshes → validate-only, no production regeneration → preserve accepted
  anatomy, current exports, six retained CPU stills and previous visual evidence.

OUT OF SCOPE FOUND:

Fresh source R2, GPU review/captures, blind grading, full smoke and merged checks
remain parent gates. T04 clip playback, profile selection and the shared gameplay
animation state machine are unchanged. T16 live eligibility and T10 fixtures are
unchanged. No global Engine, shared exporter, shared animation library, Game, HUD,
Fauna, Review screen or orchestration document was changed. No push, PR or merge.

ARTIFACTS:

- `assets/renders/characters/viewmodels/revision-r1/review-evidence.tar.gz` and
  `review-evidence-sha256.json`: original R1 report/repros/logs, byte-for-byte.
- `revision-r1/prior-validation.tar.gz` and `validation/history/`: prior candidate
  reports/inventory kept separately from current receipts.
- `revision-r1/scratch-failure-reports{,-final}.tar.gz`: actual saved-source/codec failure
  receipts, reports and original-export hashes from the isolated Blender fixture.
- `revision-r1/red/`, `revision-r1/green/`, `revision-r1/failure-tails.txt`:
  reproducible failure and correction evidence, command results and positive checks.
- `revision-r1/protected-hashes.json`: exact SHA256/size for all protected files,
  distinguishing hydrated files from unchanged LFS pointers and ordinary Git blobs.
- `validation/{thalune,ixari,ulgani}-receipt.json` and `inventory.json`: current
  byte-bound validation provenance. Current receipts have operation validate-existing.
- `revision-r1/evidence-sha256.json`: hashes of the revision evidence package.
- Existing CPU previews, unchanged: `cpu/{thalune,ixari,ulgani}-{camera,detail}.png`;
  six files / 3,148,150 bytes. No new images or render sequences were produced.
- Next GPU inventory remains README.md's three review targets under noon-lush,
  night-exotic and open-space lighting, actual first-person 16:9/21:9 view passes,
  wireframe/rig overlays, eight-angle/material sheets, articulation and extreme
  motion/heat/underwater transitions, delayed people switches and paired performance.
  Parent slot required; source/CPU proof is not visual acceptance.

Exact protected source/export identities (all match the pinned revision base):

| File                                                                 | SHA256                                                             |     Bytes |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ | --------: |
| `assets/blend/characters/viewmodels/fp_thalune.blend`                | `46d483c8cc0b10f555dc35f60008d64f7b883d392daa4bf4e87abb91da97b1db` |  24733334 |
| `packages/client/public/models/characters/viewmodels/fp_thalune.glb` | `b4859735bd2f203bd30ca41705a156858cc362dd6de1000d308bd1e12b53e76f` |   3891516 |
| `assets/blend/characters/viewmodels/fp_ixari.blend`                  | `44c408a64b59353810119640471b2faf9506da57250bdb47e7ce067445f2c4b5` |  18934076 |
| `packages/client/public/models/characters/viewmodels/fp_ixari.glb`   | `78f90acfc0087b63e97c3ae50cb7c1f5e045e447e12975b6ec21a0dd5f038abc` |   3248228 |
| `assets/blend/characters/viewmodels/fp_ulgani.blend`                 | `aabb32cb139c544d7a57f2fe22c34931fe720d2215e02936876f2dd02dd1aa3b` |  10586540 |
| `packages/client/public/models/characters/viewmodels/fp_ulgani.glb`  | `8319097e97e3ccf2f9fdcbbe114742ea45f1f24eb8ba98420f12678d3511e954` |   1593132 |
| `assets/blend/characters/thalune.blend`                              | `d1fc6986ad5fc164279e12a299aa6bc62b499084a6e8afee1b87315832c8d74b` |  69378059 |
| `packages/client/public/models/characters/thalune.glb`               | `dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27` |  41128548 |
| `assets/blend/characters/ixari.blend`                                | `9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c` | 170752716 |
| `packages/client/public/models/characters/ixari.glb`                 | `1236d2bafed2d8a2c58eeb4ba6cf73501c669fbc7d7eda5d1fb3c260d34d243b` |  43870856 |
| `assets/blend/characters/ulgani.blend`                               | `06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b` |  73478111 |
| `packages/client/public/models/characters/ulgani.glb`                | `9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682` |  47796920 |
