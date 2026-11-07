TASK: P1.E05.T03 — SOURCE/CPU R2 revision

STATUS: BLOCKED — the new R2 P2 is corrected and CPU checks pass. Fresh parent
SOURCE R3, GPU review, blind grading and merged verification remain required.

SUMMARY: Added requested-people validation of the actual saved GLB before the
wrapper's final export report and byte-bound receipt can PASS. Both validate-only
and post-export paths run the same check. The real nine-pair validator/inventory
matrix and production consumer agree: three matching pairs pass; six cross-pairs
fail in each mode. No asset, runtime Multitool, shared core or gameplay code changed.

Revision base: `326b3532de05474afe632275bb178bc6c5fbd3c9`.
Base tree: `fcb526c3dffdaa3f9db249572e9d56c5303eaeb8`.
Original task/T01 base: `45c172a102f1944ff00be0b6e5006eef13fd793b`.
Branch: `task/P1-E05-T03`. The resulting commit/tree are supplied in the handoff;
this committed report cannot include its own resulting commit identity.

FILES CHANGED:

- `packages/tools/blender/characters/viewmodels/export_checks.py`: reads the actual
  saved GLB and binds the generic report's asset/variant/class/LOD, active scene
  people/root/axes metadata, mesh variants, used material identities and required
  PBR slots, embedded 2k KTX2 mip chains, 35-joint skins, hand/digit hierarchy and
  right-hand Muzzle/Grip markers to the requested people.
- `export.py`: runs that contract check in the common final validation path,
  records a report failure or successful contract check, then uses the unchanged
  receipt publication and failure quarantine logic.
- `test_export_contract.py`: actual matching/cross-pair files plus isolated root,
  variant, material, slot, skin and detached/missing marker/joint controls. Metadata
  controls retain the original binary chunk.
- `test_saved_pairs.py`: actual Blender wrapper → receipt → inventory cases over
  all nine pairs in both modes. The post-export test injects only delivery of
  existing GLB bytes at `export_one`; no meshes/textures/exports are regenerated.
- `test_pipeline.py`: extends its existing dependency stubs for the newly imported
  export checker; its failure-boundary tests remain unchanged in behavior. The
  new checker itself runs in the real matrix and its direct actual-file tests.
- `Multitool.materials.test.js` and `test/characters/viewmodelConsumer.mjs`: nine
  production consumer oracle cases, using complete actual GLBs and real Engine /
  GLTFLoader / Meshopt / KTX2 / Basis decoding in one CPU Worker per process.
- Own README/report, current validation reports/receipts/inventory, new unique
  history directories, and `assets/renders/characters/viewmodels/revision-r2/`.

VERIFY:

R2 new P2 — FIXED. In fresh scratch, byte-identical pinned wrapper/receipt/inventory
code accepted the real Thalune source plus real Ixari export: wrapper exit 0,
fresh receipt PASS and inventory PASS. The negative harness intentionally exited 1
because this violated the expected rejection. The pinned code hashes, code archive,
red result, reports and command are retained separately from green evidence.

After the fix, the real Blender matrix completed 18 cases: all nine source/export
pairs through each of validate-only and post-export. Each mode has three wrapper
exit-0 / receipt-PASS / inventory-PASS cases and six wrapper exit-1 / receipt-FAIL /
inventory-REJECTED cases. Cross-pair reports record the expected asset identity
failure before the wrapper publishes success. No current inventory or failed
destination survives. Prior reports, receipts and inventory are byte-preserved;
post-export cases also retain both the old correct export and the different failed
export without overwriting either. Peer files and all production inputs are intact.

The nine real production consumer cases independently accept the same diagonal and
reject all six other combinations with `Viewmodel has an unexpected material`.
All material maps decode before the incompatibility is reported; rejected scenes
have exactly-once disposal, no attachment and one warning toast. Shared loader
ownership is preserved. `pair-conformance.json` verifies that both validator modes
agree with these runtime outcomes and used the same actual export SHA256 values.

All four R1 findings remain FIXED. The original R2 report, independent source/timing
controls and R1 dispositions are archived byte-for-byte. The 14 pipeline tests,
six inventory tests and existing material/stale-load tests pass again. The runner,
receipt/history implementation, inventory implementation, source validator and
runtime Multitool are byte-identical to the reviewed R2 base; this revision does
not claim to have independently repeated every extra control in the R2 review.

Executed commands (cwd is this task checkout):

```sh
pnpm exec vitest run packages/client/src/entities packages/client/src/exosuit.test.js packages/client/src/Game.test.js --maxWorkers=2 --no-file-parallelism
# exit 0: 8 files / 110 tests, including the previous 101 and 9 new real-consumer pairs
python3 packages/tools/blender/characters/viewmodels/test_pipeline.py
# exit 0: 14 tests; expected injected failure traces retained
python3 packages/tools/blender/characters/viewmodels/test_inventory.py
# exit 0: 6 tests
python3 packages/tools/blender/characters/viewmodels/test_export_contract.py
# exit 0: 9 tests with actual-file and fault-injection subcases
pnpm typecheck
# exit 0: shared, client, server, tools
pnpm exec eslint packages/client/src/entities/Multitool.js packages/client/src/entities/Multitool.materials.test.js packages/client/src/entities/Multitool.viewmodels.test.js packages/client/test/characters/viewmodelConsumer.mjs
# exit 0
pnpm exec prettier --ignore-path /dev/null --check packages/client/src/entities/Multitool.materials.test.js packages/client/src/entities/Multitool.viewmodels.test.js packages/client/test/characters/viewmodelConsumer.mjs packages/tools/blender/characters/viewmodels/README.md packages/tools/blender/characters/viewmodels/REVISION-R2.md
# exit 0
python3 -m compileall -q packages/tools/blender/characters/viewmodels
# exit 0
python3 packages/tools/blender/characters/viewmodels/inventory.py
# exit 0, using the fresh current receipts
python3 assets/renders/characters/viewmodels/revision-r2/protected_audit.py
# exit 0: 6 accepted bodies, 6 viewmodel files, 6 previews, 745 accepted review
# packet files, 59 retained R1/runtime/control files and 246 original R2 evidence files unchanged
git diff --check
# exit 0
```

Three sequential factory/background CPU Blender invocations, each through the
unchanged bounded runner, with `-t 2`, one codec job and finite owned cleanup:

```sh
KTX=/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx ART_KTX_JOBS=1 python3 packages/tools/blender/characters/viewmodels/run_cpu.py /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r2-fix.1_bs43i5/red-pair.txt 180 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 -P packages/tools/blender/characters/viewmodels/test_saved_pairs.py -- /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r2-fix.1_bs43i5/red-pair --code-dir /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r2-fix.1_bs43i5/pinned/packages/tools/blender/characters/viewmodels --pair thalune ixari --mode validate-only
# exit 1 expected: the pinned defect violates the negative assertion
KTX=/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx ART_KTX_JOBS=1 python3 packages/tools/blender/characters/viewmodels/run_cpu.py /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r2-fix.1_bs43i5/green-pairs.txt 600 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 -P packages/tools/blender/characters/viewmodels/test_saved_pairs.py -- /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r2-fix.1_bs43i5/green-pairs
# exit 0: all 18 real validation/inventory cases pass
KTX=/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx ART_KTX_JOBS=1 python3 packages/tools/blender/characters/viewmodels/run_cpu.py /var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/p1-e05-t03-r2-fix.1_bs43i5/current-validation.txt 240 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 -P packages/tools/blender/characters/viewmodels/export.py -- --validate-only
# exit 0: all three unchanged production pairs pass fresh validation
```

The third command runs validation-only, not export generation. The five standard
art gates still pass for each source and export, along with the unchanged source
rig/weights/axes/packed-map/clearance checks and the new saved-export contract.
All three fresh current receipts bind the exact unchanged files and final reports.

The separate consumer oracle ran the following command for each of the nine
requested/exported pairs, each exit 0, one CPU Worker, a 30-second process deadline
and owned cleanup. `consumer-matrix.json` retains each exact argv, result and export
hash; `consumer-<requested>-<exported>.txt` retains stdout/stderr:

```sh
node --import tsx packages/client/test/characters/viewmodelConsumer.mjs pair:<requested>:<exported>
```

`failure-tails.txt` retains the last twenty lines of the pinned negative failure,
the matrix log with expected inner failures, and the existing injected-failure
suite. Full logs are alongside it. The red harness exits 1 while the buggy inner
validator/inventory exits 0; green matrix exit 0 means all expected rejection and
acceptance assertions passed. No unexpected test failure was suppressed.

DECISIONS:

- Valid character-family asset → require the requested viewmodel's identity too →
  hashes prove which bytes were checked, but cannot supply a missing semantic check.
- Shared validation endpoint → check actual GLB data before final PASS in both
  modes → preserve the existing exporter, receipt, cleanup and ownership boundaries.
- Root/variant/material/rig markers → check reachable active-scene nodes and used
  primitive materials → unused nodes or materials cannot satisfy the contract.
- Post-export negative control → deliver existing saved GLB bytes at the exporter
  boundary → exercise real final validation/quarantine without regenerating assets.
- Production consumer → unchanged runtime as the independent compatibility oracle →
  no loader workaround can conceal an incorrectly validated cross-pair.

OUT OF SCOPE FOUND:

Parent-owned fresh SOURCE R3, GPU/native review, blind grading, full smoke and merged
checks remain pending. No browser, GPU work, native capture, service, DB, grant,
asset regeneration, push, PR or merge occurred. T04 clip playback/state-machine
integration, T16 live eligibility and T10 fixtures remain unchanged. No shared
export core, Engine, gameplay, review-screen or orchestration document was edited.

ARTIFACTS:

- `assets/renders/characters/viewmodels/revision-r2/review-evidence.tar.gz` and
  `review-evidence-sha256.json`: 246 original R2 report/repro/control/evidence files,
  preserved from `/tmp/p1-e05-t03-r2.f3fApA`; original files remain unchanged there.
- `pinned-tooling.tar.gz`, `pinned-code-sha256.json`, `red-pair-results.json`,
  `red-command.json`, `red-pair.txt`: byte-identical-base red evidence.
- `pair-conformance.json`, `consumer-matrix.json`, `green-command.json`,
  `green-pairs.txt`: all 18 real validator/inventory cases and nine runtime oracles.
- `scratch-validation-history.tar.gz`, `scratch-export-hashes.json`: scratch
  reports/receipts/history and exact current/quarantined export identities. The
  actual scratch files remain in the exclusive directory named in the commands.
- `prior-validation.tar.gz`, new `validation/history/` entries: prior current
  evidence retained separately. Existing R1 history and archives were not edited.
- `current-command.json`, `current-validation.txt`, current `validation/*` receipts
  and `inventory.json`: fresh current proof for unchanged production bytes.
- `protected-hashes.json`, `protected-audit.txt`, `evidence-sha256.json`: protected
  file identities and evidence integrity, including runtime/control preservation.
- `failure-tails.txt`, `r2-*.txt`, `consumer-*.txt`: exact check output and failures.
- Existing `assets/renders/characters/viewmodels/cpu/{thalune,ixari,ulgani}-{camera,detail}.png`:
  six unchanged CPU stills / 3,148,150 bytes. No new images were produced.
- Next GPU inventory remains README.md: three targets under noon-lush/night-exotic/
  open-space lighting; actual first-person 16:9/21:9 views, turntable/material sheets,
  rig/wireframe overlays, articulation/motion/heat/underwater transitions, delayed
  people switches and paired performance. Parent slot required. CPU proof is not
  visual acceptance.

Exact source/export identities (unchanged from R2 base):

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
