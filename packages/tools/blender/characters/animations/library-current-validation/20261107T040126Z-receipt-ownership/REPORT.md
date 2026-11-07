# P1.E05.T02 receipt ownership revision — Appendix C.2

TASK: P1.E05.T02 bounded source/library validation; resolve the single P2 from independent review of `07768bf14fce30c1e78db6750f44d8fbd561f4b5`.

STATUS: DONE for this correction. Actual-boundary red/green checks PASS after the fix. Fresh independent round-two review and whole-task visual acceptance remain open.

SUMMARY: Validation receipts now require an explicit `--report-dir` whose final directory does not exist. The exporter reserves that directory with exclusive `mkdir` immediately after argument parsing, before source hashing/loading, validation, selftests or export. Existing directories, even empty ones, fail with CLI exit 2. Each receipt is also opened in exclusive `x` mode, never truncation mode. The validation/export/negative-control functions are unchanged. A focused regression drives the real Blender CLI sequentially; it uses no mocked validation or export boundary.

Provenance:

- Revision base: `07768bf14fce30c1e78db6750f44d8fbd561f4b5`.
- Base tree: `8a7c8ffb2e4a0d8cb029eb4c828f159ed48189ea`.
- Original restoration parent: `ae8447ce13925befe63899452bee9beb162c07ea`.
- Branch: `t3/P1-E05-T02-source-library-87bfd7e9`.
- Final head/tree are in the accompanying handoff after committing this report; `git log -1 --format="%H %T"` resolves them at this revision.
- Review read: `/tmp/P1-E05-T02-review-07768bf-4eG46I/REPORT.md`; its hash and finding are in `prior-review.json`.
- Retained source remains `49ae87cbdb8671f7988b1bed4358d49d4cdc6b58`, accepted exporter `d1f5c569bfbdc27b319fd8aae49bac2ba7420de1`. This revision only changes receipt-path ownership/creation and adds its regression/evidence.

FILES CHANGED:

- `packages/tools/blender/characters/animations/export_saved.py`: require explicit new receipt directory, reserve it before work, and exclusively create receipts; usage documentation updated.
- `packages/tools/blender/characters/animations/test_receipt_directory.py`: actual Blender CLI regression with sequential runs, two-thread limits, timeout, directory/file metadata and content snapshots, and distinct red/green output directories.
- This fresh `library-current-validation/20261107T040126Z-receipt-ownership/` packet. No previous packet or review record was edited.

VERIFY:

1. RED before changing the exporter (harness exit 1):

```sh
python3 packages/tools/blender/characters/animations/test_receipt_directory.py --output packages/tools/blender/characters/animations/library-current-validation/20261107T040126Z-receipt-ownership/red --negative-only
```

All three existing-directory cases incorrectly exited 0, loaded the source and wrote receipts. The empty directory acquired `source-validation.json`; the unrelated nonempty directory acquired a receipt; the prior-receipts case replaced both JSON files under `--validate-only --selftest`. The same focused test source was used for red and green. These deliberately disposable red inputs and failed results are preserved under `red/`.

The failure lines:

```text
existing-empty FAIL: exporter exit 0; directory changed; source loaded; validation succeeded
existing-nonempty FAIL: exporter exit 0; directory changed; source loaded; validation succeeded
existing-prior-receipts FAIL: exporter exit 0; both prior receipts replaced; source loaded; validation succeeded
```

2. GREEN after the receipt-only correction (harness exit 0):

```sh
python3 packages/tools/blender/characters/animations/test_receipt_directory.py --output packages/tools/blender/characters/animations/library-current-validation/20261107T040126Z-receipt-ownership/green
```

| Actual CLI case | Exporter exit | Result |
| --- | ---: | --- |
| Existing empty directory | 2 | Rejected before source load; directory metadata/content unchanged |
| Existing nonempty directory | 2 | Rejected before source load; unrelated file and directory unchanged |
| Existing source/component receipts with selftest | 2 | Rejected before source load; both prior files and directory unchanged |
| Fresh path, validate-only + selftest | 0 | Exactly two receipts; 42 actions and all 10 existing export-boundary controls PASS |
| Reuse the successful fresh path with selftest | 2 | Rejected before source load; successful receipts and directory unchanged |

The negative checks compare the complete directory entries, file SHA-256 values, inode, mode and modification timestamps before/after. They require nonzero process exit, no blend load, and no validation/export success marker. Every positive check passes. Fresh successful receipt JSON values exactly equal the previous successful packet's source/component receipt values.

The successful underlying exporter invocation is recorded verbatim in `green/results.json`; it is equivalent to:

```sh
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 NUMEXPR_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2 PYTHONDONTWRITEBYTECODE=1 /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --factory-startup --disable-autoexec --python-exit-code 1 -P packages/tools/blender/characters/animations/export_saved.py -- --validate-only --selftest --report-dir <new-leaf-directory>
```

For a repeat of the regression, choose a new `--output` path. The harness reserves its own evidence directory exclusively, and supplies distinct fresh leaf paths to the exporter. Do not precreate the exporter leaf or reuse any old packet directory.

3. Python AST/syntax and scope audit: exit 0. Both Python files parse. AST comparisons to the pinned base show `sha`, `curves`, `validate`, `export` and `selftest` unchanged. Only receipt arguments/reservation/writes and CLI usage changed in the exporter.

4. Protected-file hash audit: exit 0. All 47 protected files match their before snapshots: ten body/animation data files, all 29 files in the previous evidence packet, and eight unchanged authoring/adapter/test/fixture/helper/documentation files. The red exporter SHA matches the base Git source; green matches the tested amended source. Red failed artifacts still match their recorded after-run hashes. See `protected-before.json`, `protected-after.json`, and `summary.json`.

5. `git diff --check` and final staged diff check: exit 0. No existing tracked file other than `export_saved.py` is modified by this revision.

DECISIONS:

- An explicit report path is required: omitting it can no longer fall back to sibling historical receipts. This intentionally changes receipt CLI ownership only.
- Reserve a nonexistent final directory atomically before work; `mkdir(exist_ok=False)` arbitrates concurrent normal invocations without a check-then-create race. Existing empty/failed reservations cannot be reused. A failed validation leaves its reserved directory in place; a later run must select a new path.
- Use exclusive file creation as well, so a pre-existing receipt cannot be truncated even after directory reservation.
- Kept the retained historical README unchanged. Its old commands describe that historical workflow; current invocations must include the new explicit fresh path shown here.

OUT OF SCOPE FOUND / LIMITS:

- One Blender process at a time, CPU only, factory background, autoexec disabled, `-t 2` and fixed scene threads 2. Five thread-pool environment limits are set to 2. Each subprocess has a 180-second timeout and process-group cleanup; none timed out.
- No successful export, authoring, asset regeneration, bind recapture, LFS fetch, GPU/render/bake/browser, Vite/game/server, DB, capture, or media codec job ran. Accepted source/export payloads are unchanged.
- No TypeScript/runtime/adapter change. The previously independently passed 28 library/shared-rig tests and 126 actual-body pairs were not gratuitously rerun; those earlier results are prior evidence, not new execution claims. This revision freshly validates 42 source actions, the unchanged ten export-boundary controls, and receipt ownership.
- Capture candidate `20023a3845f351c18df9cf8cd95190bfa28a00e6` and its checkout were not accessed. T16/T10, gameplay, orchestration documents, historical packets and accepted assets remain unchanged.
- No new art-quality, performance or integrated-playback claim. No nested work, push, PR, main change or merge.

ARTIFACTS:

- `red/results.json` and three logs: exact commands/environment, expected failing-before checks, exporter exit codes, before/after snapshots and exporter hash.
- `green/results.json` and five logs: exact passing-after cases, exit codes, snapshots and exporter hash.
- `green/fresh-receipts/source-validation.json` and `component-validation.json`: fresh successful actual Blender receipts.
- `protected-before.json`, `protected-after.json`, `summary.json`, `prior-review.json`: preservation, scope, red/green identity and review provenance.
