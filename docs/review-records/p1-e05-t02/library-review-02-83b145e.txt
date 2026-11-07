# P1.E05.T02 round-two receipt-ownership review

VERDICT: PASS

R1P2: FIXED. Severity was P2. No new blocking finding. This is not whole-task animation acceptance, native qualification, or a merge claim.

## Identity

- Worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-87bfd7e9`
- Branch: `t3/P1-E05-T02-source-library-87bfd7e9`
- Base: `07768bf14fce30c1e78db6750f44d8fbd561f4b5` (tree `8a7c8ffb2e4a0d8cb029eb4c828f159ed48189ea`)
- Head: `83b145e9d6dc845aa6c7706ada69019fc813b202`
- Tree: `b0138bcc7243b04062b414571e0ad543a1c24bfe`
- Head and tree were the same before and after every command. `git status --porcelain` was empty before and after.
- Diff vs base: `export_saved.py`, `test_receipt_directory.py`, and the new `library-current-validation/20261107T040126Z-receipt-ownership/` packet. 27 files.

## R1 finding

Round-one report `/tmp/P1-E05-T02-review-07768bf-4eG46I/REPORT.md` found that `export_saved.py` at base lines 231–232 and 266–269 accepted an existing report directory (`mkdir(exist_ok=True)` plus `write_text`), so `--validate-only` exited 0 and replaced old receipts with PASS.

The fix is at current `packages/tools/blender/characters/animations/export_saved.py`:

- `:231-237` requires `--report-dir` and reserves it with `mkdir(parents=True, exist_ok=False)` immediately after argument parsing. `FileExistsError` calls `parser.error` and exits before `sha(SOURCE)` at `:238` and `open_mainfile` at `:241`.
- `:270-274` creates `source-validation.json` and, for `--selftest`, `component-validation.json` with `open('x')`.

AST dumps of `sha`, `curves`, `validate`, `export`, and `selftest` match the base. Only `main` differs. Exporter SHA-256 is `da384ecd0c2080c29cc940ff831c3f4b7635c25b636f6498a6e16962910c9525`, equal to the committed green packet. Base exporter SHA-256 is `7093f24a97088e399d8145239e941b92e2ad63bbd413ad51a3b03167111bd98c`, equal to the committed red packet. Harness SHA-256 is `6d631426ca0ad7efe94d65e596bc9f522f9bd74579bd27b0ca6f0b92cadd5512`.

## Retained original failure

Inspected, not re-executed. `red/existing-prior-receipts.log` reads `shared_motion.blend`, prints `ANIMATION_SOURCE_VALIDATION_PASS`, and ends `exit=0`. `red/existing-empty/source-validation.json` is the overwritten PASS receipt, SHA-256 `8e76d7cdc02b716973846662167980c7dea12f9091e5a2a7407843a9faa3f6a5` (871 bytes), the same digest as the round-one overwrite. `green/existing-prior-receipts/source-validation.json` is still `{"status":"PRIOR_SOURCE_EVIDENCE"}`. The packet's 47 recorded protected hashes matched the worktree before this review, and the whole `library-current-validation` tree hash matched again after it.

## Independent checks

Runner: `python3 /tmp/P1-E05-T02-review-83b145e9-r2-run.py`

Each Blender invocation was one process, factory background, autoexec disabled, `-t 2`, `--python-exit-code 1`, with `OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS`, `NUMEXPR_NUM_THREADS`, and `VECLIB_MAXIMUM_THREADS` set to 2 and `PYTHONDONTWRITEBYTECODE=1`. Per-process timeout 300 seconds. Blender 5.2.3 LTS. Reject and reuse cases compared directory inode, mode, mtime, symlink target, and file SHA-256, not exit code alone. The animation source mtime and SHA-256 stayed `36cd27d53ef6e10bc141bae1de2759519c625881c7c79d4f0b7607d78fb7b846`. All 47 protected paths and the validation packet were unchanged. `packages/client/public/models/characters/animations` was unchanged, including `shared_motion.glb` and `manifest.json`.

| Case | Exit | Result |
| --- | ---: | --- |
| Python `open('x')` on an existing file and on a symlink; `mkdir` on a directory symlink, a dangling symlink, and a file | n/a | `FileExistsError`. Targets and the planted file bytes stayed put. |
| `--help` | 0 | Usage shows required `--report-dir`, optional `--validate-only` and `--selftest`, and "must not already exist" wrapped across two lines. No blend read and no PASS marker. |
| `--report-dir` omitted | 2 | `the following arguments are required: --report-dir`. No blend read. |
| Existing empty directory | 2 | Rejected before source load. Directory metadata unchanged. |
| Existing directory with `unrelated.txt` | 2 | Same. Unrelated file unchanged. |
| Existing source and component receipts, with `--selftest` | 2 | Both files unchanged. No blend read. |
| `--report-dir` is a symlink to an existing directory | 2 | Link and target file unchanged. |
| `--report-dir` is a dangling symlink | 2 | Link remains; target was not created. |
| `--report-dir` is an existing file | 2 | File bytes unchanged. |
| Existing directory whose `source-validation.json` is a symlink to an external sentinel | 2 | Sentinel bytes and both directory entries unchanged. No blend read. |
| Fresh directory, then a symlink planted at `source-validation.json` before the receipt write | 1 | `FileExistsError` at `export_saved.py:270` `open('x')` after the blend read. Symlink and sentinel unchanged. No PASS marker. |
| Same race with a regular planted receipt | 1 | Same `open('x')` error at `:270`. Planted bytes unchanged. |
| Fresh `--validate-only` under a parent that already held `keep.txt` | 0 | One receipt, `status=PASS`, `savedActions=42`, zero negative controls, source hash matches the blend, `rendered=false`, `baked=false`. Sibling file and library outputs unchanged. No `EXPORTED_SAVED_ACTION`. |
| Reuse that fresh directory | 2 | Receipt directory unchanged. No blend read. |
| Fresh `--validate-only --selftest` | 0 | Exactly `source-validation.json` and `component-validation.json`. Parsed JSON is equal to the committed green fresh receipt, including 42 actions and these 10 controls: object channel, unknown source identity, location index 3, location index -1, missing location, duplicate location, rotation_quaternion index 9, rotation_quaternion index -1, missing rotation_quaternion, duplicate rotation_quaternion. |
| Reuse that selftest directory | 2 | Both receipts unchanged. No blend read. |

`results.json` records `allPassed: false` only because the runner required the help sentence on one line. The help log contains the wrapped sentence and otherwise matches the contract. Every ownership check in that file passed.

## Rules

Checked against `docs/IMPLEMENTATION_PLAN.md` 0.3, 0.9.5, and the E05.T02 / E05.T04 boundary. None of the five mandatory REVISE conditions in 0.9.5 apply: no client authority change, the receipt guard has a focused executable regression, no demo path was left in place, no perf budget is in scope, and the fresh-directory rule is recorded in the worker report. T04 loading and gameplay were not touched. `export()` remains gated by `not validate_only and not selftest` at `:250-260` and still writes the library GLB only on that path. Validate-only did not take it.

## ADVISORY

- `packages/tools/blender/characters/animations/README.md:81-82` still shows the historical commands without `--report-dir`. Round one required that README to stay byte-for-byte, and the worker report records that choice. The current contract is the module docstring at `export_saved.py:3`. Omitting the flag now exits 2 before the blend is opened.
- `test_receipt_directory.py` resolves the destination path before launch, so the harness itself does not pass a symlink. Direct CLI cases covered symlink, file, dangling, and post-reservation exclusive-create paths.

## Unexecuted limits

- No successful export. That path would write `shared_motion.glb` and `manifest.json` under the accepted library directory. The call and `export()` body were compared, not run.
- The old exporter was not run again. The retained red packet was checked against the base file hash and the round-one overwrite digest.
- `test_receipt_directory.py` was not launched. Its five scenarios were run directly against `export_saved.py`, with the extra symlink and race cases above.
- No vitest replay of the 28 library tests or 126 clip/people pairs, and no visual, GPU, render, bake, browser, Vite, server, database, or LFS fetch.
- A kill during `receipt.write` after `open('x')` had already created a new file was not simulated. A failed new directory remaining reserved, and a pre-existing name refusing truncation, were both observed.
- No source, doc, or commit edits. Evidence is only under `/tmp/P1-E05-T02-review-83b145e9-r2/`.
