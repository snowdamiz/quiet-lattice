# C2/C4 SOURCE/CPU independent review — P1.E05.T03 observation-budget

## VERDICT: PASS

PASS confirms the SOURCE/CPU correction claims under pinned HEAD `98a68686cb9ff26804a45909d6ca018abdb3f1e6` / tree `4660e44f417ac484ece3943c6a90cc4f288f9ece` / base `a78c7e5f58e399fcecab0197b65ffe42500cb16a` / readiness `3b43d2db214cc0b99f273bbda0543dc1d990b7dbc87c26a73190c3294ae0acfa`.

**PASS ≠ native acceptance, visual acceptance, parent grant, dispatch, or merge.**

Statuses: readiness `ENABLED_AWAITING_PARENT_GRANT`; post-commit correction status `ENABLED_SOURCE_CPU_CORRECTION_AWAITING_INDEPENDENT_REVIEW`.

## Pin / identity

| Check | Result |
| --- | --- |
| HEAD/tree/base/baseTree | exact match; worktree clean |
| readiness SHA256 | exact match |
| claimed source file hashes | all match |
| assets/public path diffs base..HEAD | none; blob ids identical |
| prospective paths | 52/52 absent |
| unit1-launch | DATA_ONLY; grantIssued=false |

## CPU reproduction (independent)

| Case | Exit | Key facts |
| --- | ---: | --- |
| Exact-base RED (detached a78c7e5 worktree, then removed) | child 1 / wrapper 0 | helper ceiling + node ceiling×2 + STDERR; reconstructed=false; observedBytes/events host-variant vs author |
| HEAD GREEN | 0 | journal valid; **191937** events; storedBytes 237464 ≤ 8 MiB; publication [] |
| Successor authenticate | 0 | admit without dispatch; budgetChecks all true |
| focused-continue | 0 | **31/31** OK |
| caller --check (frozen PATH) | 0 | stdoutSha `d9f4e349…` matches POST-COMMIT |

## Budget

Existing 64 MiB metadata reserve split verified in code: journal 8 (`observations.DISK_CAP`) / caller 32+14-sink / helper HW 16 / Node entry 8. Measured GREEN well inside. Incomplete journals refuse validation; no silent drop of required observations.

## Callers

Real `native.py` / `caller.py` / `boundary.py` / `observations.py` wiring — not helper-only. Publication no longer re-graphs per-helper events into the result raw graph; `helperEvidence` + journal validate cover admitted facts.

## Preservation

Author preservation log: protected **822**, tracked **12921**, historical **26237**. Native attempt2 parent `/private/tmp/space-vm-parent-unit1-r2-q6kzldbb` remains `FAILED_SPENT` (exit1, 18.485s, helper ceiling, node ceiling×2). Screenshot cleanup remains STOPPED. Author artifacts under `/private/tmp/vm-observation-budget-7o2wl_r3` not overwritten.

## Finding dispositions

See `VERDICT.json` findingDispositions F1–F11 (CONFIRMED / NOTE only; no REVISE blockers).

## Explicit note

This PASS is SOURCE/CPU independent review only. It does **not** authorize native/GPU/browser relaunch, grant issuance, visual acceptance, or merge.
