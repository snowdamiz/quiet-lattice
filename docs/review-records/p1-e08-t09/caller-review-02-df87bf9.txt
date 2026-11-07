VERDICT: REVISE — SOURCE ONLY
TASK: P1.E08.T09 — fresh independent R2 review of the disabled six-unit fauna caller
HEAD: df87bf9d81a7eff4aeddbff20a8231a0718a1a88
TREE: 7cae8627f691eb56ffba6e717a1523eaec1b847b
REVIEWED R1 BASE: 82b6ac3fa9681e50346e090249de75328fe99d6c
PRODUCT BASE: d688579adf31c2a8ee9836495ba6b32708b99ccd
RECOVERY: 6245e5ffb68f4bd4b1baf66a2cf4f4e3806e4482
WORKTREE: /Users/andreyyurlov/.t3/worktrees/space/t3-06487465
BRANCH: task/P1-E08-T09-current-base
ARTIFACTS: /private/tmp/p1-e08-t09-r2-independent-7sdgcw6t

Three reproduced P2 findings block the caller gate. The exact R1 Node and broad-inspector failures are corrected. The exact R1 returned-command observations are now preserved, but exception-carried audit/allocation facts still disappear. The new receipt guards also swallow the helper's real cleanup deadline. A separately reproduced publication failure leaves a success receipt that admits the next unit despite this caller returning failure.

## Findings

### R2-A — P2: a receipt guard consumes the cleanup deadline and then continues release work without a timer

Locations: `packages/tools/src/capture/fauna_packet/caller.py:383` (receipt catch), `:98–100` and `:145–148` (observation-write catches), `:422–445` (cleanup phase). The immutable deadline is `assets/blend/stations/_authoring/round4_job_boundary.py:26–47`.

The unchanged helper deliberately raises `DeadlineExpired`, a `BaseException`, from its one-shot SIGALRM. The new receipt guards catch every `BaseException`, append a persistence failure, and return normally. When the alarm fires inside `receipt('returned-drain.json', ...)`, its only timer is spent. The caller subsequently runs kernel/member probes, archive, TMP release and terminal audit. There is no remaining outer timer for blocking filesystem/copy work. The run still ends `accepted:false`; this finding is lost deadline enforcement, not a claim of overall success.

Repro: `adversarial.py`, `cleanup-deadline`. It calls actual `caller.main()` / `run_unit()`, exact AST-extracted `StationJob.archive()` and `terminal_audit()`, and the exact unchanged deadline class/context manager. Native lifecycle/command boundaries are inert. Only the cleanup duration is shortened from 60 s to 20 ms. The receipt's injected blocking write lets the real alarm fire. The returned record classifies it under `persistenceFailures` as `DeadlineExpired`, has no cleanup failure, and later has `raw.terminalAudit:true`. Kernel probes within that same phase observe `getitimer(...)[0] == 0.0`; archive and TMP release remove their scratch-only allocations after expiration.

Independent comparison against byte-identical 82b6 source: `deadline-prior.py` uses the same timer/injection. The prior caller records `DeadlineExpired` under cleanup failures, makes no archive/terminal command call, and retains its scratch/private directories. This is a regression in the fix delta. The stock combined controls replace `core.deadline` with `nullcontext`, so they cannot detect it.

Required correction: preserve the deadline/cancellation signal and unwind the phase after recording it. Do not turn deadline expiration into a recoverable receipt I/O failure. Exercise actual timed guards at both ordinary receipt and observed-release persistence boundaries; retain the original capture failure and prove no subsequent release/decoder dispatch after expiration.

### R2-B — P2: a failed final write can leave an accepted receipt that satisfies the next-unit gate

Locations: `packages/tools/src/capture/fauna_packet/caller.py:475–482`, underlying `:67–69`, and consumer `:261–262`.

`result['accepted']` becomes true before `persist('result.json', result)` completes. If the write leaves a complete JSON file but reports an error on close, the catch changes only the in-memory result and attempts `failed-result.json`. The first file remains parseable with `accepted:true`. `grant_gate()` accepts that first file's boolean without considering the failed result/publication state. Consequently a later unit can pass its predecessor gate even though the original main returned 1 and the complete fallback says false.

Repro: `adversarial.py`, `final-close-error`. All capture/cleanup/inspection outcomes are clean CPU fixtures; real archive and terminal helper bodies execute with inert native probes. Actual `persist()` writes and closes `result.json`; an injected close-reporting error then raises `FINAL_CLOSE_ERROR_AFTER_BYTES`. The real main returns 1, its returned adapter result is false, and `failed-result.json` is false. The original `result.json` is true. A fresh synthetic second-unit grant passed to the real `grant_gate()` is admitted (`nextGrantAdmitted:true`). No real grant is created or consumed, and no next unit is launched.

This is not reproduced by an injection that raises before writing bytes. Do not treat a parseable file as proof that publication completed. Keep failed/spent evidence immutable, but make an indeterminate/failed final publication incapable of authorizing the next unit; verify this at the actual predecessor gate as well as the writer. The all-sinks publication status is honest; the stale success file is the separate defect.

### R2-C — P2: exception normalization discards partial audit output and retained-allocation recovery facts

Locations: `packages/tools/src/capture/fauna_packet/caller.py:72–73`, `:105–106`, `:136–137`, `:417–418`, and `:446–447`. Allocation producer: `assets/blend/stations/_authoring/run_round4_browser_proof.py:46–85`.

The adapter preserves returned command objects and their unknown fields, but error paths reduce the exception to type/message. A `subprocess.TimeoutExpired` carries partial stdout/stderr in its attributes. Those bytes and any additional observation fields are lost by `failure(error)`, before either disk fallback or the returned result can preserve them.

Repros: `archive-timeout`, `terminal-timeout`, and `archive-timeout-all-sinks` in `adversarial.py`. The exact archive or terminal helper invokes the instrumented command boundary, which raises a real `TimeoutExpired` object containing distinctive partial stdout/stderr and an unknown field. The original capture failure survives, refusal remains false, and no decoder follows. Nevertheless, the complete returned result has none of the partial bytes or unknown field. In the all-sinks case, both result paths and stderr are attempted, `UNABLE_TO_PERSIST_COMPLETE_RESULT` is correctly returned with `completeReceipt:null`, but the raw facts have already disappeared. `exceptionAttributes` in the independent evidence records what the boundary actually supplied.

The same lossy normalization affects a concrete existing helper contract. `allocation-proof-error` executes the exact `create_private_tmp()` and `tmp_admission()` bodies in scratch. Admission receipt failure plus a nonempty allocation prevents rollback; the helper attaches `private_tmp_allocation` with path, inode/UID, `released:false` and the cleanup failure to the original exception. Because the call never returns, the caller's local `private` is still None. The caller drops the attached recovery record and returns an empty cleanup-failure list, while that exact scratch allocation remains. No job starts in this case.

Required correction: retain structured exception-carried observations and allocation/recovery facts, including byte-valued partial output and unknown fields, through all sinks failing. Preserve the primary exception separately from cleanup/publication failures. Keep this in the packet adapter unless the immutable helper contract is explicitly re-reviewed.

## Independent disposition of every R1 finding

- **F1 — FIXED for the reported Node defect.** Replayed the exact R1 catch-write and final-write cases on both byte-identical versions. 82b6 loses the primary; df87 retains `PRIMARY_CAPTURE_SENTINEL` in the thrown error's `entryResult`, always attempts `entry-result.json`, and retains separate reporting failures. Current stock actual-main controls additionally pass combined write/unregister, all reporters failing, post-admission setup failure and unregister failure. No native launch or subsequent capture dispatch occurs.
- **F2 — PARTIAL overall.** Both exact original assertion cases are corrected at the adapter: bootout/print returns and terminal registration stdout/stderr survive. The unchanged raw helper alone still makes zero receipt writes before its assertion, as expected; the adapter is what supplies preservation. The independent R2 actual-main/real-helper cases preserve returned unknown fields even through receipt failures. R2-C shows the remaining exception-carried partial/unknown facts and retained-allocation gap. R2-A is an additional regression introduced by the protective receipt catches.
- **F3 — FIXED for all four reported classes.** Replayed the original red full-inspector cases on 82b6, then applied the same four mutations to the new positive broad fixture and reran actual full `inspect()`: future feed stamps, missing intermediate journals, contradictory incoming event, and null game time are all refused. The new positive fixture correctly uses actor 1; the wrong-incoming mutation targets that event rather than the old fixture's intentionally arbitrary actor 999. The other mutation payloads are unchanged. The positive full packets decode 219 broad / 81 correction images. Additional stock cases reject NaN HUD time, missing queue channel, rewritten history, altered dimensions/CRC/truncation and incomplete inventories. These synthetic pixels have no visual qualification value.

## Combined publication and other verified contract

The independent adapter harness uses the exact archive AND terminal bodies in separate namespaces and restores the scoped observation wrappers after each case. Native subprocesses/ownership observations are replaced at their boundaries. `caller.main()` dispatches one `run_unit()`; its returned structured value is retained by a wrapper for assertions. Its exit code is separately checked.

- Simultaneous `returned-tmp-release.json`, `terminal-audit.json`, and `result.json` errors still attempt `failed-result.json`. The successful fallback contains the original capture failure, all three reporting errors, full command returns, unknown kernel/state/TMP-release fields and terminal facts.
- With every post-capture packet write and stderr failing, the fallback file is still attempted; main returns 1 and the adapter result says `UNABLE_TO_PERSIST_COMPLETE_RESULT`, `completeReceipt:null`. It does not claim persisted proof. Returned observations survive; exception-carried observations do not (R2-C).
- Archive and terminal assertion refusals retain raw command returns. An unproved archive retains its scratch log/private directory. A dirty drain followed by clean kernel probes is not upgraded: terminal refuses and decoder is not dispatched.
- Both actual disabled entry routes refuse all six units before runtime/helper imports or allocations under guards. No proposed current or previous R1 output/evidence/grant/consumption identity was created.
- Inventory remains four units × 82 files / 81 images plus two × 220 files / 219 images: **768 files / 762 images**. The order remains day16:9, day21:9, night16:9, night21:9 corrections, fauna-combat, fauna-combat-night.
- Correction admission is **8,925,528,064 bytes per unit**; broad admission is **15,871,295,488 bytes per unit**. Output caps are 1,358,970,880 / 3,674,226,688. No all-six-fit claim. Exact 16 MiB image and 16 KiB readout writes pass; +1 byte is refused before file creation. Python's ordinary exact-remaining 32 MiB metadata admission and next-write rejection pass. Node/Python metadata allocations remain 32 MiB each.
- Cache growth, EOF, aggregate, shrink and mutation controls pass. Independent short-write, copy-deadline and final-verification-deadline controls retain the actual partial copy and publish no successful cache receipt. The cache timer is still enforced; the cleanup timer is not reliably enforced (R2-A). Configured capture/cleanup/decoder limits remain 600/60/45 seconds and cache 30 seconds. Native usage thresholds remain observed stop thresholds, not OS quotas.
- Launcher and self-observed kernel Python hashes still match both frozen maps and current bytes; four independent removals are refused. No new native identity probe was launched. Clean-head/grant/expiry/source/path admission and exclusive consumption remain present; R2-B is the predecessor-proof exception to the stop-after-failure contract.

## Provenance, scope and verification boundary

Read plan 0.3, 0.9.5 and T09, the complete caller README, all packet implementation files and relevant immutable helper bodies, both supplied reports, frozen provenance, and actual R1 repros. Reviewed the full current packet plus the seven-file 82b6..df87 delta. Inspected the unchanged capture frame/fight schedule and CombatFeed to check inspector timing/payload assumptions.

Independent Git identity checks confirm `packages/client`, `packages/server`, `packages/shared`, smoke, `capture.ts`, and `screens.ts` are unchanged from d688579ad. All four helpers match recovery6245e5f and the frozen SHA256 values. The worker's seven-file patch equals independent `git diff --binary` output. All 12 packet/helper scratch copies remain byte-identical to pinned source. All 440 retained legacy LFS pointers match manifest SHA256 and size without hydration. All 28 R1 evidence files in the worker's original hash record remain unchanged.

Readiness remains false, SHA256 `b2f6c7dc868853a1f409ca015a6c9b1f68b685ecf0cab5ff2f3970d53c226cff`. Current 24 proposed identities and previous R1 24 proposed identities remain absent. Final Git status is empty at the exact requested head/tree.

Fresh read-only `caller.py --check` passed: CPU bindings only, no conflicting task-local Vite/cache owner, observed free space 107,670,589,440 bytes. This is a time-local observation, not admission or a runtime grant.

Node stock controls: **7/7 PASS**. Python stock controls: **21/21 selected PASS**; the remaining archive-fixture test creates Git commits, so it was deliberately not run under the no-commits brief. Actual retained Git/LFS archive identity was independently verified read-only instead. No claim of a fresh 22/22 run. `git diff --check 82b6ac3..HEAD` passes. Full lint/build/smoke, runtime capture, native ownership qualification, real images, animation/visual grading, merged verification and merge were not run; they remain parent-owned.

No source edits, commits, branch changes, services, browser/GPU/capture, LFS hydration, real grants, job launch/unload operations, or delegated workers. At most two CPU control processes ran concurrently. Read-only readiness checking uses its existing identity/hash/cache probes, not service launch. All injected release/file mutations were inside this report's fresh scratch directory. Synthetic failure allocations and fixtures are intentionally retained for review; no live process/job or timer remains from the controls.

## Reproduction commands and evidence

All scripts below operate only on scratch copies/fixtures, except `final-verify.py` and the separately recorded `--check`, which inspect the pinned checkout read-only. A zero exit from `adversarial.py` means its specified positive and defect-reproduction assertions held; `REPRODUCED_DEFECT` is not a candidate PASS.

```sh
export TMPDIR=/private/tmp/p1-e08-t09-r2-independent-7sdgcw6t/tmp
cd /private/tmp/p1-e08-t09-r2-independent-7sdgcw6t
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node --test scratch/packages/tools/src/capture/fauna_packet/controls.mjs
/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -I -B run-stock.py
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node red/node-failure-control.mjs catch-write
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node red/node-failure-control.mjs final-write
/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -I -B red/python-focused.py
/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -I -B red/archive-failure-control.py
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node-green.mjs catch-write
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node node-green.mjs final-write
/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -I -B python-green.py
/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -I -B adversarial.py
/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10 -I -B deadline-prior.py
/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 -I -B cache-boundaries.py
/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node image-cap-control.mjs
python3 -I -B final-verify.py
```

`check-command.json` records the exact check argv/cwd/PATH; `check.json` / `check.stderr` retain its output. Main evidence: `adversarial-results.json`, `deadline-prior-results.json`, `python-focused-results.json`, `red/python-focused-results.json`, `node-*-result.json`, `provenance.json`, `verified-fix.patch`, `final-readonly-check.json` and corresponding logs.

The initial independent harness's timeout-absence assertion matched sentinel text in its own source-line diagnostic. It was corrected by putting `raise error` on a separate line, without changing candidate source or injected error facts; the initial log remains `adversarial-harness-first.log`. The first stock subset omitted the cache class; `python-stock-all.log` contains the final complete non-commit selection. No failed harness setup is counted as a product failure or silently discarded.

Keep runtime disabled. This source verdict supplies no grant, runtime/visual qualification, full T09 acceptance, or merge authorization.
