TASK: P1.E14.T04 (art) Flora rebuild: trees — R1 source/CPU revision
STATUS: DONE (implementation revision); independent source review and native visual gates remain parent-owned and unpassed.

SUMMARY: Corrected the four reproduced runner findings without changing any artwork, current export, preview, old report, shared validator, or consumer. Current output names are quarantined before source content reads; readable history is copied into detached regular files; source and process outcomes are checked before committing an exclusive receipt; PermissionError during cleanup is recorded without inventing a process exit. An unresolved group blocks the lane. Exact baseline RED is retained, final actual-runner GREEN is 28/28, and the unchanged GLBs pass 29/29 real-consumer tests. No Blender, codec, capture, GPU, service, database, package installation, pnpm, push, PR, or merge was run for this revision.

Pins:
- Worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-9dcc2975`
- Branch: `task/P1-E14-T04-trees`
- Original parent: `55a8d58c27db35782b89142fc8a4f8d25f52f379`
- R1 reviewed revision base: `570e7f2f9cb700075697438f8cc0757b8ffa7400`
- R1 base tree: `327bd0238461b76069369023a57a0b9cfc4712c6`
- Corrected implementation/evidence HEAD: `f6cbea796fc2d60ec6887c25eb8915b46cda0494`
- Corrected implementation/evidence tree: `c333488af4727493a803425b30ce44f8a99c3c62`
- This report is the only file added by the following report-seal commit. Its final HEAD/tree are in the external handoff and final response, avoiding a self-referential commit hash.
- Reviewed shared pin: `515ba1f00810a50b499970b5468ef7bf0af84c32`, adopted as `60aa8bfb5a771e14944b6a130c96cd9a2cb83228`; all three files still match exactly.
- T05 patterns inspected read-only at `a46e7c4d444befd6efe6e06b9134b3a41abcb639`: quarantine sweep before reads, detached copies, truthful final receipt ordering. No foreign file changed, no shared fork or material change.
- Original `assets/blend/flora/trees/REPORT.md` remains SHA-256 `5851c713428219d06d5fcc88f6c887a2883e34b4382e6079ca714efbcaaa660e`.

FILES CHANGED:

- `packages/tools/blender/flora_trees/run.py`: the four failure boundaries, finite terminal-state inspection, persistent lane guard, and exclusive atomic receipt publication/failure fallback.
- `packages/tools/blender/flora_trees/test_runner.py`: actual runner in fresh scratch roots, real harmless Python producers, actual filesystem/signal/deadline/descendant controls. Only the signal syscall is fault-injected for deterministic EPERM; neither the runner nor its cleanup helpers are replaced. A receipt fsync control injects failure at the I/O boundary after JSON bytes were written.
- `assets/blend/flora/trees/revision1_20261107/**`: exclusive evidence, immutable reviewer scripts/report and baseline runner, command ledger, protected hashes, paired inventory, failure tails, and this C.2 report. No change to previous trees evidence or candidate selection.

VERIFY:

Selected exact commands (working directory is the worktree above):

```sh
python3 -B packages/tools/blender/flora_trees/test_runner.py --runner assets/blend/flora/trees/revision1_20261107/baseline-run.py --reviewer assets/blend/flora/trees/revision1_20261107/reviewer/lifecycle.py --evidence /tmp/t04-r1-red2-20261107 --expect red
```
Exit 0. Selected baseline RED: five cases reproduce F-A twice and F-B/C/D.

```sh
python3 -B packages/tools/blender/flora_trees/test_runner.py --reviewer assets/blend/flora/trees/revision1_20261107/reviewer/lifecycle.py --evidence /tmp/t04-r1-green5-20261107 --expect green
```
Exit 0. Selected final GREEN 28/28 PASS.

```sh
/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node node_modules/vitest/vitest.mjs run packages/client/src/gameplay/floraTreesT04.test.js packages/client/src/gameplay/modelLibrary.test.js --config /tmp/t04-r1-focused-20261107/vitest.config.mjs --configLoader native --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=/tmp/t04-r1-focused-20261107/tests.json
```
Exit 0. 29 real-consumer tests PASS, private Vite/module/Node caches

```sh
python3 -B assets/blend/flora/trees/revision1_20261107/verify_unchanged.py --out assets/blend/flora/trees/revision1_20261107/verification.json
```
Exit 0. Final corrected recursive preview census; initial nonrecursive glob exited1 (AssertionError), no output written.

```sh
git diff --check
```
Exit 0. Working diff whitespace check

`git diff --cached --check` exited 0 before the implementation commit. Eleven task Python files compiled with `compile()` without writing pyc. No TypeScript changed; prior typecheck evidence is retained, not presented as a new typecheck. Ruff was unavailable and was not installed; no Ruff PASS is claimed.

Baseline RED versus final GREEN:

| Finding | Exact baseline observation | Final actual-runner result |
|---|---|---|
| F-A unreadable/directory source | No receipt; current GLB remained, unreadable case also retained candidate PASS | Both current names retired before source reads; nonzero receipt, source error retained with no fabricated digest; producer not launched |
| F-B export symlink | Archived symlink changed when its external backing changed | Regular archive, nlink 1, detached inode/bytes; backing mutation leaves archive hash unchanged |
| F-C successful producer mutates source | Child exits 0; runner exits 1; receipt says 0; GLB stays current | Child exit 0 retained separately; final receipt exit 1, source_mutation true; published bytes in failed history, current GLB absent |
| F-D SIGINT plus killpg EPERM | PermissionError escapes stop and finally; no receipt | Exit 130/reason interrupted preserved; denied signals and actual child state recorded; surviving child has child_exit null and child_reaped false; persistent lane guard blocks reuse |

The five selected baseline cases cover F-A twice and F-B/C/D once. The reviewer script's F-C boolean expected receipt exit1, contrary to its own report's exit0 observation. The original script is untouched; the adapter records its original predicate and checks the report's actual condition. The first harness run exposed that predicate mismatch; the corrected baseline RED precedes the implementation edit.

Final 28 controls include ordinary success/exit7, missing publication, unreadable source before/after production, unreadable current candidate/GLB, directories, FIFO, dangling/relative/chained symlinks and hardlinks, real SIGINT/SIGTERM/deadline, an exited leader with a live descendant, denied signals followed by an independently observed exit0, primary exit7 preserved despite cleanup failure, receipt path/write/fsync failures, lock loser, reused attempt, and blocked lane. The signal-permission receipt intentionally records uncertainty; the later harness cleanup does not rewrite it. A final `ps -axo pid=,pgid=,stat=,command=` observation checked 91 recorded scratch groups: zero active members. `child_reaped` means only the direct Popen child actually collected by poll/wait; zombie observations are retained separately and never called live or reaped by this runner.

Selected evidence: `red2-results.json`, `green5-results.json`, their `.tar.gz` packages, and `focused-evidence.tar.gz`. Historical red/green1–4 attempts are retained and not selected. Packages are fresh regular files; they include readable scratch files plus `archive-entry-facts.json` recording special/unreadable entries without invented digests. They do not retain live symlinks as evidence payloads. Original scratch remains under the `/tmp/t04-r1-*` paths in commands.json. Total compressed evidence: 968,995 bytes; no additional images.

Failures and corrections (full raw runner tails/receipts are in the packages; harness failure tails below):

```text
Actual baseline RED failures (full traces/receipts in red2-evidence.tar.gz):
F-A unreadable: PermissionError: [Errno 13] Permission denied: scratch/unreadable-source/assets/blend/flora/tree_round_t04.blend; no receipt, GLB/candidate remain.
F-A directory: IsADirectoryError: [Errno 21] Is a directory: scratch/directory-source/assets/blend/flora/tree_round_t04.blend; no receipt, GLB remains.
F-B: archived path remains a symlink; changing backing bytes changes its hash (recorded before/after in red2-results.json).
F-C: process exit1; receipt exit0/source_mutation=true; PUBLISHED-GLB remains current.
F-D: PermissionError: [Errno 1] controlled killpg denial, stop called from monitor and finally; no receipt. Harness later kills only its recorded child group.

Historical harness failures, not hidden or treated as product PASS:
red, exit1: {"status":"FAIL","cases":[["unreadable-source",true],["directory-source",true],["symlink-archive",true],["source-mutation-published",false],["signal-permission",true]]}
The immutable reviewer script incorrectly predicates F-C on receipt exit1; its report specifies exit0. The adapter corrects only that predicate and records the original predicate result.

green1, exit1:
  cases.extend(harness.controls())
  record('denied-but-exited', ..., **terminal)
TypeError: Harness.controls.<locals>.record() got multiple values for argument 'name'

green2, exit1:
  result=self.run(root,['export','round','--deadline','2'])
  r=json.loads(p.read_text())
IsADirectoryError: [Errno 21] Is a directory: '/tmp/t04-r1-green2-20261107/scratch/receipt-write-failure/assets/blend/flora/trees/evidence/20261107T031157_export_round_8cd71dcf/receipt.json'

green3, exit1:
  second=self.run(root,['export','round','--deadline','2'],env={'FIXED_ATTEMPT':'1'})
  with log.open('xb') as stream:
FileExistsError: [Errno 17] File exists: '/tmp/t04-r1-green3-20261107/reused-attempt.log'

Initial verify_unchanged.py, exit1:
  assert len(images) == 46
AssertionError
The initial glob saw only root-level images; corrected to rglob. No verification.json existed from this failed check.

Optional formatter availability probe, exit1:
/opt/homebrew/opt/python@3.14/bin/python3.14: No module named ruff
No installation attempted. No Ruff PASS claimed.
```

Protected and reused evidence:

- All 642 original review rows match before the edit. Afterward, 641 are byte-identical; the one authorized difference is run.py. All four additional explicit protections (old report and three shared files) match. `protected-before.json` and `protected-after.json` retain every full hash; `verification.json` rechecks them against disk.
- Eight editable blends, eight compressed GLBs, all 46 PNGs (54,805,448 bytes), old candidate/report/history, current consumer files, package state listed in the review, and the external codec binary remain unchanged. No mutable old evidence was rewritten.
- The reviewer's 76 source-cloud and 16 stock PASS results remain valid for the unchanged payload hashes. Stock validation was not rerun. No local override, threshold relaxation, or new full-stock PASS claim. Outer non-white baseColorFactor remains unsupported; existing authored factors remain 1.
- Real-consumer tests were freshly rerun with Node v22.23.3 and Vitest 5.0.5, direct entry, one worker, no file parallelism, native config loader, private Vite/module/Node caches. 29 passed, 0 failed. No shared dependency installation/write was requested or performed.

Exact unchanged source/export pairs (SHA-256; source and export are a complete pair):

| Kind | Source SHA-256 | Export SHA-256 |
|---|---|---|
| round | `0289add6071aac144763fd8a3c67efaa3cfe03192b4ba4f44405043129aeb087` | `8257c5423566e6f9a62bc1cadf3ec1bd940ef20184a54d73f886afd903dabb45` |
| conifer | `6abb31b8763acc0a6bc44c7d1f63892b3929f9420f283058e409d4aee7ee5c82` | `ea9c889438779fd3af192d2476967fd7fb67cd655d1111bb5901ec3fdd48fbd2` |
| palm | `0de3633cd22ca4208d64eda410a8eb87a83ad44d3798aeebaa10b4473b68f898` | `b7fbcdc72b7f1581c0db7d1ae1d53632fb3e5992ff1b81c5542a2ce07d164b28` |
| mushroom | `ae59e3ea97159464fabb08cf467ae1751f1767248c23e2290312ae1799e22f85` | `becd7124703a6ded9349635d2be8ada54f0ae937b3e996508d79081c5c84be21` |
| spiral | `79049b427c1166ff53aab3b7a7389cf730d0403f4c7785f833b1986c8b52a3b0` | `24662149bd3330bd004145f8d86550c129c9841045d6145c191decf2a48796af` |
| coral | `12ad278e604c6c17cad26b2f6b8f5f10c957847a9fa4e7c1db4d36425c885a8a` | `2a0b52856aa05e2e293ad452bb5ea50ed0ea7832cce80055ee8f77d04ec51c3b` |
| blob | `2f7697de399e4ae1d1689d2be7e5817bc35fd985154682f2e2a85971a1e877b2` | `5c490c1931e440ac58d78420c95b7198babf650fe88f93f16bf017b935401b93` |
| cactus | `79a6283447a23c35062865a5779a8469665dbb15183cf1e2107c69c9e63aa062` | `3b55320d464a6494efcfcd62966624a62b2e7aa66279acf2201edc35e01917f6` |

Source path is `assets/blend/flora/tree_<kind>_t04.blend`; export path is `packages/client/public/models/flora/tree_<kind>_t04.glb`. Exact paths, byte sizes, and the selected source/export validation reports are in `verification.json`.

Exact current 19 × 4 LOD inventory (triangles; LOD0 node is the consumer name, subsequent nodes append `_lod1`, `_lod2`, `_lod3`):

| Consumer | LOD0 | LOD1 | LOD2 | LOD3 |
|---|---:|---:|---:|---:|
| tree_round_0 | 14000 | 6719 | 2379 | 326 |
| tree_round_1 | 12174 | 5842 | 2069 | 286 |
| tree_round_2 | 13999 | 6718 | 2378 | 356 |
| tree_conifer_0 | 14000 | 6720 | 2380 | 330 |
| tree_conifer_1 | 14000 | 6720 | 2380 | 252 |
| tree_conifer_2 | 13999 | 6719 | 2379 | 304 |
| tree_palm_0 | 14000 | 6719 | 2380 | 532 |
| tree_palm_1 | 10480 | 5030 | 1781 | 397 |
| tree_mushroom_0 | 7992 | 3836 | 1358 | 302 |
| tree_mushroom_1 | 7992 | 3835 | 1358 | 303 |
| tree_mushroom_2 | 14000 | 6719 | 2379 | 532 |
| tree_spiral_0 | 6888 | 3305 | 1170 | 261 |
| tree_spiral_1 | 10724 | 5147 | 1823 | 406 |
| tree_coral_0 | 13356 | 6410 | 2269 | 506 |
| tree_coral_1 | 13999 | 6719 | 2378 | 530 |
| tree_blob_0 | 5252 | 2520 | 891 | 198 |
| tree_blob_1 | 8772 | 4210 | 1490 | 333 |
| cactus_0 | 5599 | 2686 | 951 | 211 |
| cactus_1 | 3004 | 1441 | 510 | 114 |

Consumer contract: `packages/client/src/gameplay/floraModels.js` and its builders consume these exact 19 names. The cactus prefix remains `cactus_`, class flora; the seven other kinds remain flora_tree. Floating COLOR_0 is R primary / G secondary / B accent / A AO; POSITION and masks remain unquantized, transformed geometry and color behavior are exercised by the unchanged real consumer test, including malformed mask/name controls. All four LODs, source UVs/normals and PBR payloads remain as reviewed. This revision makes no claim of runtime adoption or native visual PASS.

Selected versus historical compact previews: `assets/blend/flora/trees/evidence/20261107T013236_packet_round_787bc5a6/preview-manifest.json`, SHA-256 `9eafff6415520a2def0da7261d60110922097faab747849c9b14fa06c99b0d1e`. It selects 19 sheets; 26 historical sheets and one overview are retained. No preview was regenerated or cleaned. The current total remains 46/48 compact images and 54,805,448/536,870,912 bytes.

DECISIONS:

- Failed source before producer launch → retire candidate and this kind's current GLB before reading content → F-A cannot retain an accepted stale current output. Author/seal/export retire at start; read-only actions retain their inputs for inspection and retire current names on a failed outcome.
- Unreadable historical entry → move it first, record the real read error, retain its raw quarantine entry without a digest, continue processing the other owned name → one bad file cannot prevent the other removable current output from being retired.
- Symlink/hardlink history → resolve metadata before the sweep, copy bytes to exclusive regular files after all moves, and remove the moved alias → history does not follow later referent changes. No permission rewriting of quarantined unreadable files.
- Cleanup fails → preserve the original signal/exit reason, report every known cleanup error, poll/wait for real direct-child termination, and keep uncertain group facts → failed signals never imply an exit. TERM/KILL waits are finite (two seconds each, one-second final child wait, two-second ps timeouts); unresolved ownership creates a persistent `.lane.blocked.json`. Future attempts refuse it; no automatic guard removal.
- Receipt commit fails → fsync an exclusive pending file before atomically linking the current receipt, archive any unsealed current receipt/output and write a failure fallback → a write/fsync failure cannot commit a new current PASS. Existing attempts and lane losers remain untouched.
- Broader art rerun → reuse hash-proved source/export and stock evidence, refresh only real-consumer and runner checks → no new source/material/consumer concern justified Blender or native work.
- Scope and review → no nested review/visual grading; no foreign edits or orchestration changes → parent owns review, docs, native, main, and merge.

OUT OF SCOPE FOUND:

The existing modelLibrary recolor path replaces UVs, and floraModels uses its current far-LOD policy. Those runtime adoption matters remain T07-owned. The old mixed flora bundle stays present. This revision does not change that behavior or claim authored PBR/LOD2/3 live adoption. Crystal/non-tree content remains T05-owned. No new art finding was introduced by these runner controls.

ARTIFACTS:

- This report and `provenance.json`: exact base/implementation/shared pins and runner hashes.
- `commands.json`, `failure-tails.txt`: command vectors, exits, retained failures.
- `red2-results.json`, `green5-results.json`, `*-evidence.tar.gz`, `evidence-packages.json`: selected and historical actual-runner results; every package has full SHA-256 and size.
- `protected-before.json`, `protected-after.json`, `additional-protected.json`, `verification.json`, `verify_unchanged.py`: exact protected hashes, repeatable no-Blender verification, full paired inventory, and parent capture selectors.
- `terminal-process-check.json`: later terminal observation for every recorded scratch group; does not erase earlier uncertainty.
- Original candidate, 139 receipts/ledger rows, stock reports, historical-byte manifest, and preview manifest remain unchanged and are referenced from the original report.

Remaining parent native inventory and cost limits, unchanged and NOT RUN:

For each of the exact 19 inventory rows above: noon-lush_lod0/2, night-exotic_lod0/2, open-space_lod0/2, wireframe_lod0/2, overlay, far_lod2 (100m), sheet PNG, and perf.json. Use the exact asset/variant command vectors in `verification.json.native_capture_inventory` (copied from the protected candidate); selectors are `<prefix>_form_<index>` under `flora/tree_<kind>_t04`.

190 raw stills + 19 contact sheets = 209 native PNGs and 19 perf JSONs. Three lights × 120 paired samples × 19 variants = 6,840 pairs / at least 13,680 measurement frames plus settle/capture overhead. Standard art sheets still require 19 eight-angle turntable + 19 material close-up + 8 sibling sheets = 46 additional PNGs, 255 total new parent-gate PNGs. Standard turntable.py forces Metal here and was not used.

Suggested parent limits remain one admitted GPU lane, one selected variant at a time, native 1920×1080, turntable 800×600 cells/material 480×360 cells, initially 300 seconds per variant with stop/owned cleanup on failure, at least 12 GiB free disk and a fresh 1 GiB parent packet ceiling, no videos/raw-frame directories/4096 sprawl. These require parent admission and do not authorize use of the GPU assigned to T15. Native capture, blind visual grading, fresh independent source review, and live integration remain pending. CPU tests/source evidence are not native visual acceptance.
