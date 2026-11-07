# P1.E05.T02 bounded source/library validation — Appendix C.2

TASK: P1.E05.T02 (art) Animation set; bounded source/library validation only.

STATUS: DONE for this CPU unit. Whole-task visual acceptance and fresh independent code review remain open.

SUMMARY: Restored the ten retained authoring/export/library-test/data files from `49ae87cbdb8671f7988b1bed4358d49d4cdc6b58` onto the current parent client. The exporter matches accepted `d1f5c569bfbdc27b319fd8aae49bac2ba7420de1` except for the `--report-dir` option and receipt destination routing. All 42 saved actions and 126 clip/people pairs passed fresh CPU checks with the unchanged current adapter. No runtime integration was restored.

The parent animation `README.md` is restored byte-for-byte as historical workflow documentation. Its sibling `cpu-proof.json`, `source-validation.json`, `component-validation.json`, freeze reports, and visual evidence are not this run's receipts. Historical evidence was not overwritten, relabelled, or imported. Only the files in this new directory describe this run.

## Provenance

- Base commit: `ae8447ce13925befe63899452bee9beb162c07ea`.
- Base tree: `15c0a10a8af46a5b064698ee378961592b9f25c0`.
- Branch: `t3/P1-E05-T02-source-library-87bfd7e9`.
- Worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-87bfd7e9`.
- Final head/tree: reported in the accompanying Appendix C.2 handoff after committing this packet; resolve this commit with `git log -1 --format="%H %T"`.
- Retained source: `49ae87cbdb8671f7988b1bed4358d49d4cdc6b58`; accepted exporter: `d1f5c569bfbdc27b319fd8aae49bac2ba7420de1`.
- All four animation data Git blobs also match capture candidate `20023a3845f351c18df9cf8cd95190bfa28a00e6`. That checkout and branch were not accessed or changed; the comparison used read-only Git objects.
- The six accepted body sources/exports were already hydrated before this work. All six matched their parent LFS OID, size, and existing local LFS object. Only the two animation binaries were hydrated, from size/hash-verified existing local LFS objects. No LFS fetch or network asset retrieval ran.
- `restored-provenance.json` records each retained Git blob and content SHA-256; `validated-source-hashes.json` records the tested sources and the unchanged adapter, existing loader, and shared-rig test.

FILES CHANGED:

- `packages/tools/blender/characters/animations/README.md` — exact retained bytes.
- `packages/tools/blender/characters/animations/author.py` — exact retained bytes.
- `packages/tools/blender/characters/animations/export_saved.py` — only receipt output routing differs from retained.
- `packages/tools/blender/characters/animations/capture_bind.mjs` — exact retained bytes.
- `packages/client/src/characters/animationLibrary.test.js` — exact retained bytes.
- `packages/client/src/characters/fixtures/animation-clips.json` — exact retained bytes.
- `assets/blend/characters/animations/shared_motion.blend` — exact retained bytes.
- `packages/client/public/models/characters/animations/shared_motion.glb` — exact retained bytes.
- `packages/client/public/models/characters/animations/manifest.json` — exact retained bytes.
- `packages/client/public/models/characters/animations/source-bind.json` — exact retained bytes.
- `packages/tools/blender/characters/animations/library-current-validation/20261107T034509Z-ae8447ce/` — this fresh report, command receipts/logs, proof JSON, and hash audits.

No dependency source outside the requested restoration paths was needed. The existing `packages/client/test/characters/loadActualRig.js`, `sharedRig.js`, and `sharedRig.test.js` were reused unchanged. T16/T10, gameplay, Review, capture/screens, accepted body files, fifth-grade packets, orchestration documents, and the separate capture candidate are outside the diff.

VERIFY:

All validation commands below ran from the worktree root and exited 0. Exact argv, UTC timestamps, and log names are retained in `commands.json`. After adding the raw logs, a staged whitespace check caught Vitest's trailing blank line (exit 2); an explicit `END_OF_CAPTURE exit=0` wrapper marker preserves all output and closes that log. The first explicit receipt formatting check also found the command logger reserializing its own JSON without formatting (exit 1). The logger now formats with the explicit ignore override. Final receipt formatting and staged checks pass. No asset-validation, test, typecheck, lint, or syntax failure occurred.

- `install`: exit `0`; log `install.log`.

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts
```

- `blender-validation`: exit `0`; log `blender-validation.log`.

```sh
env OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --factory-startup --disable-autoexec --python-exit-code 1 -P packages/tools/blender/characters/animations/export_saved.py -- --validate-only --selftest --report-dir packages/tools/blender/characters/animations/library-current-validation/20261107T034509Z-ae8447ce
```

- `actual-library-tests`: exit `0`; log `actual-library-tests.log`.

```sh
env ANIMATION_PROOF_PATH=packages/tools/blender/characters/animations/library-current-validation/20261107T034509Z-ae8447ce/animation-proof.json SHARED_RIG_PROOF_PATH=packages/tools/blender/characters/animations/library-current-validation/20261107T034509Z-ae8447ce/shared-rig-proof.json OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 pnpm exec vitest run packages/client/src/characters/animationLibrary.test.js packages/client/src/characters/sharedRig.test.js --maxWorkers=1 --no-file-parallelism
```

- `typecheck`: exit `0`; log `typecheck.log`.

```sh
pnpm typecheck
```

- `scoped-eslint`: exit `0`; log `scoped-eslint.log`.

```sh
pnpm exec eslint packages/client/src/characters/animationLibrary.test.js packages/tools/blender/characters/animations/capture_bind.mjs
```

- `scoped-prettier`: exit `0`; log `scoped-prettier.log`.

```sh
pnpm exec prettier --check --ignore-path /dev/null packages/client/src/characters/animationLibrary.test.js packages/client/src/characters/fixtures/animation-clips.json packages/tools/blender/characters/animations/capture_bind.mjs
```

- `python-syntax`: exit `0`; log `python-syntax.log`.

```sh
python3 -c 'import ast; from pathlib import Path; paths = [Path("packages/tools/blender/characters/animations") / name for name in ("author.py", "export_saved.py")]; [ast.parse(path.read_text(), filename=str(path)) for path in paths]; print("PASS: both Python sources parse without importing or executing authoring")'
```

- `git diff --cached --check`: exit 0; checked before commit (receipt in `commands.json`).
- `final-scope-and-assets`: exit 0; only the ten restored paths and fresh report directory are added, with no existing tracked file modified.
- `receipt-format-final` / `receipt-format-check-final`: exit 0; Prettier formatting/check of fresh JSON receipts only, with `--ignore-path /dev/null`. The first format/check calls inherited the repository's `blender` exclusion, so they did not cover these receipts and were superseded. Retained data files are excluded from formatting.
- Asset audit: all six accepted bodies plus the four animation data files have identical before/after size and SHA-256; `assets-before.json` and `assets-after.json` retain the evidence.

Blender 5.2.3 LTS (`e13b728c6880`), factory background mode, autoexec disabled, `-t 2`, fixed scene thread count 2, and OMP/OpenBLAS thread limits 2. The exporter was inspected before execution: validation/selftest never enters its successful export branch, never imports `author.py`, and has no source-save call. Each negative control invokes the real export boundary with a private temporary destination and asserts rejection before output; the temporary directories are removed. The only persistent Blender outputs are this directory's validation JSON and log.

Failed packaging-check output (subsequently resolved):

```text
packages/tools/blender/characters/animations/library-current-validation/20261107T034509Z-ae8447ce/actual-library-tests.log:9: new blank line at EOF.

Checking formatting...
[warn] packages/tools/blender/characters/animations/library-current-validation/20261107T034509Z-ae8447ce/commands.json
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

Measured CPU results:

- 42 saved actions, 69 authored bones, 70 canonical profile bones, 60 Hz keyed timeline; complete supported finite curve coverage.
- 10 export-boundary negative controls: object channel, unknown source identity, invalid/missing/duplicate location and quaternion components. Negative FCurve indices clamp to zero in Blender and are rejected as duplicates; the observations are retained.
- Vitest: 2 files, 28 tests passed. The independent fixture checks all 42 names, families, durations, loop policies, source-profile metadata, track types, and sampled-key counts.
- 126 unique clip/people pairs; five animated phases per pair, four deterministic vertices per loaded primitive, across all four LODs. 510,720 animated vertex samples were finite. Each pair's maximum sampled displacement was nonzero (0.257526–1.099951 m); this is sampled compatibility evidence, not exhaustive geometry or visual grading.
- Maximum bind-relative quaternion playback error: 1.397853e-7 rad. Neutral TRS preserves rest vertices over all nine source/target pairs (maximum sampled shift 1.770656e-8 m). Nonneutral/interpolated source-bind-relative translation, rotation, scale, immutable inputs, round trips, and unsupported channel/interpolation rejection pass in the unchanged shared-rig suite.
- The absolute-translation negative control reproduces the old mismatch on actual Ixari/Ulgani geometry (0.062111/0.064403 m maximum sampled shift). The adapter eliminates that neutral mismatch.
- 16 loop endpoint checks, 21 locomotion contact checks. Maximum sampled stance-height residual after adaptation: 0.006603 m. Species-specific foot IK and visual contact acceptance remain outside this unit.

Actual body inputs:

| People | glTF mesh nodes / LODs | Loaded Three SkinnedMesh primitives | Rest-vertex samples in shared-rig suite |
| --- | --- | --- | --- |
| Thalune | 96 / 4 | 216 | 14,041 |
| Ixari | 96 / 4 | 216 | 14,675 |
| Ulgani | 96 / 4 | 176 | 10,854 |

The existing loader omits texture/material loading in RAM only. It asserts unchanged geometry/skin/morph/node/compression JSON and BIN bytes. The accepted compressed GLBs are parsed with the existing CPU Meshopt geometry decoder; no image/video codec, renderer, GPU job, browser, Vite/game/server, capture, bake, or database was launched.

Protected asset SHA-256 (all unchanged):

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/blend/characters/thalune.blend` | 69378059 | `d1fc6986ad5fc164279e12a299aa6bc62b499084a6e8afee1b87315832c8d74b` |
| `packages/client/public/models/characters/thalune.glb` | 41128548 | `dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27` |
| `assets/blend/characters/ixari.blend` | 170752716 | `9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c` |
| `packages/client/public/models/characters/ixari.glb` | 43870856 | `1236d2bafed2d8a2c58eeb4ba6cf73501c669fbc7d7eda5d1fb3c260d34d243b` |
| `assets/blend/characters/ulgani.blend` | 73478111 | `06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b` |
| `packages/client/public/models/characters/ulgani.glb` | 47796920 | `9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682` |
| `assets/blend/characters/animations/shared_motion.blend` | 4588876 | `36cd27d53ef6e10bc141bae1de2759519c625881c7c79d4f0b7607d78fb7b846` |
| `packages/client/public/models/characters/animations/shared_motion.glb` | 2636416 | `e7a88b2ad39104344e4c3612f2cd9015597389084bb67540777bf6301e926117` |
| `packages/client/public/models/characters/animations/manifest.json` | 15976 | `077548e21921e41143e3d8d321e6ff72d72e48867048e01d847a3067eb7f3d63` |
| `packages/client/public/models/characters/animations/source-bind.json` | 29601 | `23f5567bd769ce1555ad60b1b650595619d421dd659395b697045973c989dbf8` |

DECISIONS:

- Fresh receipts → added an optional `--report-dir` argument and passed this unique directory → preserves the historical reports without altering export/validation semantics.
- Existing dependencies → reused the current loader and adapter → no stale runtime/client recovery or extra source dependency was necessary.
- The requested uppercase branch spelling already existed; chose the unique task-labelled branch above. The successful rename changed this branch only.
- No new design/spec interpretation. Loading, state machines, movement, Recall VFX/lifecycle, and gameplay integration remain T04/E07.T14/E06.T03 ownership.

OUT OF SCOPE FOUND:

- Whole P1.E05.T02 rendered motion/appearance acceptance and visual grading remain open. This packet contains no fresh art-quality, frame-rate, or performance claim.
- Fresh independent diff review and combination with the separately reviewed disabled capture candidate belong to the parent.
- Full smoke, GPU, browser, server, database, authoring, successful export, bind recapture, media encoding/decoding, and visual capture were not run under the bounded authorization.
- No push, PR, merge, nested implementation, or orchestration-document edits.

ARTIFACTS:

- `source-validation.json`, `component-validation.json`: fresh actual Blender receipts.
- `animation-proof.json`, `shared-rig-proof.json`, `summary.json`: fresh actual-three-export CPU evidence.
- `accepted-bodies-before.json`, `assets-before.json`, `assets-after.json`: asset invariants.
- `restored-provenance.json`, `validated-source-hashes.json`: retained inputs and tested source identity.
- `commands.json` and named logs: exact verification commands, exit codes, and output.
- No rendered artifacts were generated; the parent owns the pending visual unit.
