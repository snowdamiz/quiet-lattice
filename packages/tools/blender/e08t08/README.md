# P1.E08.T08 CPU source unit

Start with [C2-report.txt](C2-report.txt). The seven saved `.blend` files are the
editable deliverable. Stock export reads those files; it never runs `author.py`.
No runtime, exporter, validator, library, or orchestration file was changed.

The CPU checks cover 38 selectable variants and 152 saved/exported LODs. The
consumer test loads the compressed files with the actual Three GLTFLoader and
Meshopt decoder, then exercises stock Review selection and mask look. KTX image
metadata is proxied in that test to avoid WebGL; stock validation separately
transcodes the real textures. No native visual or performance result is implied.

The open acceptance discrepancy is documented in
[reports/export-mask-limit.json](reports/export-mask-limit.json): pinned Blender
exports four-channel colors as normalized uint16 even from float source masks.
The test measures this rounding bound; it does not treat it as exact float
preservation. F1 remains assigned to the shared-exporter owner; the exact-float
format is still required and no normalized-color exception is adopted.

## Evidence

- [Asset hashes and resources](reports/asset-hash-inventory.json)
- [Saved-source contract](reports/source-contract.json)
- [Decoded consumer contract](reports/consumer-contract.json)
- [Remaining native inventory](reports/native-pending.json)
- `reports/validate-final/`: fourteen current stock source/export results
- `reports/export-final/`: stock export results
- `reports/*.log` and stage JSONs: commands, failures, process samples, exit/reap evidence
- `reports/history/`: prior sources, exports, and the preserved incidental bytecode archive

## Authorship and reproduction

`author.py` records the anatomical sections, joint rings, mask regions, packed
paint atlas, and machine panels used in the saved meshes. Parts remain editable
vertex groups. This script replaces a source and is not a routine verification
command. Its last argument is a single stem, for example `-- quad_heavy`.

`save_lods.py` creates the saved lower LODs with stock `artlib.lods.generate`, then
removes duplicate collapsed faces while proving point data unchanged.
`snap_lod_attributes.py` subsequently restores only sub-1e-5 floating-point drift
in discrete limb IDs and pose joints; all geometry and LOD0 stay unchanged.
Those are authoring operations and must run before a fresh source audit/export.
The one-time library-link and portable-path repair scripts remain as history;
the current authoring script already writes persistent relative library links.

Run commands through `stage.py <unique-stage-name> <command...>` only after CPU
admission. The R1/F2 supervisor acquires a durable `reports/runs/<stage>/admitted.json`
before dispatch. The file lock and a hash-bound settlement record both govern
admission. Missing, corrupt, or unsealed records keep subsequent admission closed,
including after supervisor death; PID disappearance does not retire that debt.
There is no automatic stale-owner reset. Preserve the evidence and return an
unresolved run to the task owner for recovery.

This supervisor targets the pinned macOS host. It retains the actual direct child
with `waitid(WNOWAIT)` through cleanup and watches known detached descendants with
kqueue process-exit handles. SIGTERM, SIGINT, exceptions, and leader exit converge
on bounded TERM/KILL drain and finally publication. Known processes are signaled
independently even if another signal/observation fails. Observation uncertainty
prevents settlement. This is sampled descendant discovery, not OS-wide containment
of arbitrary unobserved daemons. No ownership is inferred from a command name or
from a reused PID on restart.

After cleanup is verified, receipt publication masks SIGTERM/SIGINT for its short
local persistence transaction. Cancellation observed before the commit decision
wins; cancellation during an entirely successful sealed publication is late and
completion wins. A write/fsync failure or hard kill during publication leaves the
admission closed. A terminal JSON alone is never sufficient: `settled.json` must
bind both its bytes and its admission, with no pending publication or failure
record. Pending names survive link or directory-sync failure. Their final removal
is the last publication operation; a crash that restores a pending name closes
admission conservatively. A failed/cancelled run with verified cleanup
can free the execution lane, but it still blocks finalization; a later successful
run does not silently erase it.

`finalize.py` takes the same lane lock and checks every new admission before reading
the retained art proof. The 63 pre-F2 receipts are explicitly hash-pinned in
`legacy-stages.json` as historical evidence, not fresh lifecycle proof. Orphan logs
and unknown stage records block finalization. Reports are written into a new
exclusive `reports/finalized/<generation>/`; only its final, durable `PUBLISHED.json`
marks complete assembly. Partial generations remain as evidence. No full-task PASS
follows from report assembly.

`bin/blender` now forces `-t 2 --factory-startup --python-exit-code 1` for future
checks. This revision does not invoke Blender. `bin/ktx` remains unchanged. The
tool paths and dependency symlinks are recorded in the original hash inventory;
no installation is performed.

The exact successful stock commands and all failure tails are in C.2. The focused
consumer command is:

```sh
python3 packages/tools/blender/e08t08/stage.py consumer-new \
  node node_modules/vitest/vitest.mjs run \
  --config packages/tools/blender/e08t08/vitest.config.mjs
```

`preview.py` is a compact CPU-only look check. Its preserved revisions are not a
native grader packet. Do not run capture, turntable, or live performance from this
unit; the exact parent-owned inventory is listed separately.

## R1 evidence correction and F2 regression

The old 23 malformed decoded controls reject mutations through custom
`checkRig`, `checkMarkers`, and `checkInventory` assertions. They are not production
GLTFLoader/Review rejection routes. In particular, Review falls back to an available
LOD rather than rejecting a missing LOD. The historical receipts and C.2 report
remain unchanged; future generated descriptions make that boundary explicit.

`stage_lifecycle_test.py` exercises actual processes and the actual finalizer caller
in exclusive fixture directories. It uses at most two finite sleeping workload
processes at a time; tests run serially. `lifecycle_driver.py` injects observation
and persistence failures and controls publication barriers only in those copies.
Persistence controls obstruct real atomic links and fail a real `fsync` syscall
after the seal link becomes visible; they do not substitute terminal receipts.
Neither helper is part of the production supervisor path. Run the test only under
an admitted small-CPU budget and choose a new evidence directory. Existing runs,
including failed implementations and their partial publications, are preserved.
