TASK: P1.E14.T04 (art) Flora rebuild: trees — R2 F-E source/CPU correction
STATUS: DONE (implementation/CPU correction); fresh independent review and native visual gates remain parent-owned and pending.

SUMMARY: The exact reviewed exporter reproduced F-E before edits: after the failed supervisor returned 130, a released producer renamed a GLB into the canonical public name; retry 75 left it there. Production export_saved.py now writes only inside its attempt's producer directory, using the stock --out-dir option and a private TMPDIR. The supervisor alone publishes a detached copy after actual child/group termination, source binding checks, and exact prepared-file/report/hash checks. Failed or uncertain producers can finish only in their private directory. Final publication tests pass 23/23 and original runner controls pass 28/28. Assets, shared code, and all prior reports remain unchanged. No Blender, codec, GPU, browser, native, server, DB, install, hydration, push, PR, merge, or screenshot cleanup ran.

Pins:
- Workspace: `/Users/andreyyurlov/.t3/worktrees/space/t3-9dcc2975`
- Branch: `task/P1-E14-T04-trees`
- Original parent: `55a8d58c27db35782b89142fc8a4f8d25f52f379`
- R2 correction base: `36861a31e752164469e847a916e0ea21a2e54686`
- Base tree: `edf62091d81857d5bf3171523b23028b64490573`
- Corrected implementation/evidence HEAD: `edb088de40b4b680d81780e324c4c4917c46f087`
- Corrected implementation/evidence tree: `c955a043c23883f4e85d567264964db888f2e49c`
- The following report-seal commit adds only this report. Its final HEAD/tree are recorded in the external handoff/final reply to avoid a self-referential hash.
- Shared pin `515ba1f00810a50b499970b5468ef7bf0af84c32`, prior adoption `60aa8bfb5a771e14944b6a130c96cd9a2cb83228`: exact three-file bytes preserved. Stock artlib/export.py also matches the R2 base exactly.

FILES CHANGED:

- `packages/tools/blender/flora_trees/export_saved.py`: stock outputs/reports and temporary files are attempt-private; no canonical path or final rename remains. It binds the saved source, final validated bytes, stock intermediate, validation report and precision report into an exclusive private ready.json. Raw/intermediate bytes are retained for history.
- `packages/tools/blender/flora_trees/run.py`: sets private TMPDIR; verifies the completed producer's manifest and files; copies validated bytes into supervisor storage; creates the canonical name exclusively; rechecks canonical/source bytes and signals before sealing. Failure rollback, immutable receipts, cleanup uncertainty and lane guards remain. Terminal producer artifacts get hash inventories; unresolved producers remain explicitly unsealed.
- `packages/tools/blender/flora_trees/test_runner.py`: the five success fixtures now prepare private outputs for the supervisor. Existing negative fixtures still test rejection/retirement of unauthorized canonical writes. Prior reviewer functions remain unchanged.
- `packages/tools/blender/flora_trees/test_publication.py`: exact production exporter and runner with harmless CPU dependencies, file barriers and syscall failure controls. Fixtures are marked as such; they are not valid art assets or stock validation results.
- `assets/blend/flora/trees/revision2_20261107/**`: exclusive baseline/selected/historical evidence, protected rows, full paired inventory, commands and this report. No prior evidence/report was edited.

VERIFY:

Selected commands, from the workspace above:

```sh
python3 -B /tmp/t04-r2-fix-red-20261107/exporter_boundary.py
```
Exit 1. Expected RED: exact reviewed exporter publishes canonical GLB after failed supervisor returns; barrier and unchanged receipt prove F-E.

```sh
python3 -B packages/tools/blender/flora_trees/test_publication.py --evidence /tmp/t04-r2-fix-final-20261107/publication
```
Exit 0.

```sh
python3 -B packages/tools/blender/flora_trees/test_runner.py --reviewer assets/blend/flora/trees/revision1_20261107/reviewer/lifecycle.py --evidence /tmp/t04-r2-fix-final-20261107/regression --expect green
```
Exit 0.

```sh
python3 -B assets/blend/flora/trees/revision2_20261107/verify_preserved.py --out assets/blend/flora/trees/revision2_20261107/verification.json
```
Exit 0. 2632 exact protections, 3 authorized tooling changes; all art/shared/prior evidence exact; 12 Python files compile.

```sh
git diff --check
```
Exit 0.

The final publication run passed 23/23 in 25.64s; the final original-runner run passed 28/28 in 25.24s. They were serial, with at most two harmless producer workers (the exporter and its mask-promotion subprocess); no Blender/codec dependency was loaded. Individual supervisors had finite deadlines and the harness imposed bounded waits. The wrapper capped each suite at 90s. Initial host observation: load1 7.344, free disk 33,194,225,664 bytes. No heavy art work was admitted.

`git diff --cached --check` exited 0 before the implementation commit. The report-seal check first exited2 for trailing spaces on three generated result lines; only this new report was trimmed, and the repeated check exited0. Diagnostics retained:

```text
assets/blend/flora/trees/revision2_20261107/REPORT.md:37: trailing whitespace.
assets/blend/flora/trees/revision2_20261107/REPORT.md:42: trailing whitespace.
assets/blend/flora/trees/revision2_20261107/REPORT.md:52: trailing whitespace.
```
 Twelve task Python files compile() without pyc. No TypeScript/consumer changes or new typecheck; no lint/stock/native PASS inferred from compilation.

Original findings and exact dispositions:

| Finding | Disposition in this revision |
|---|---|
| F-A unreadable/directory source | Both fresh controls pass: no producer launch, both removable current names retired, nonzero receipt and real source read error; no invented digest |
| F-B mutable symlink history | Fresh symlink/hardlink/relative/chained controls pass: detached regular archive, unchanged bytes after backing mutation |
| F-C source mutation after child exit0 | Fresh original reproduction passes: child_exit 0 retained, final exit1, no current GLB, failed bytes retained; production exporter/source mutation controls also reject changes |
| F-D SIGINT/killpg EPERM | Fresh control passes: receipt130, actual uncertainty retained, child_exit null when unknown, persistent guard; no claim that a failed signal reaped the child |
| F-E late production publication | Exact base barrier RED, exact corrected exporter barrier GREEN at both stock generation and final validation; canonical remains absent after supervisor failure, producer release/termination, and retry75 |

F-E ordering is controlled by files, not sleeps: the validation/stock fixture announces the barrier; SIGINT reaches the supervisor; EPERM is injected only at os.killpg; the supervisor returns 130 and writes its failure receipt; only then does the harness release the producer. The corrected producer finishes its private ready/output files, its group is observed absent, the immutable failure receipt hash is unchanged, and the canonical path stays absent. Retry75 preserves that state. The earlier failure receipt's child_exit remains null; later group disappearance is a separate observation, not a retrospectively invented exit code.

Success requires observed child_exit0 and terminal group facts. The supervisor reads only expected private filenames, rejects aliases/hardlinks and mismatched source/attempt/kind/report/payload bindings, verifies the stock report says PASS, then publishes an independent copy exclusively. The success fixture's canonical SHA equals the pre-validation/prepared SHA and has an independent inode. Changing private bytes after the copy leaves canonical validated bytes unchanged. The final receipt rechecks source and canonical hashes. No child-side flag/check can publish.

Other publication negatives: stock exit7, stock validation failure, candidate mutation during validation, source mutation during validation/after readiness/during canonical publication, output/report mutation after readiness, wrong source/attempt/kind, missing ready.json, symlink/hardlinked private output, publication denial, SIGINT during publication, canonical corruption, receipt post-link unlink failure, and publication-copy fsync failure. They retain the original primary failure, source snapshot, private bytes/reports and any failed publication bytes; no current GLB or candidate PASS remains. Partial supervisor copies receive a binding/error record. Original lock-loser, reused-attempt, process descendant, deadline, receipt-write/fsync and lane-guard controls remain green.

The R2 review's ten additional adverse controls remain historical independent observations, not a newly executed ten-case suite here. Fresh 51 controls include the relevant source, signal, publication, cleanup, alias and post-link cases. An arbitrary negative fixture that deliberately writes the public path is not the production producer protocol; F-E's acceptance evidence uses the exact production exporter.

Expected baseline behavioral failure tail:

```text
Expected baseline RED, exit 1; no later test failures.
{
  "defect_reproduced": true,
  "exporter_exact": true,
  "before": {
    "current_absent": true,
    "receipt_sha256": "122a68284d011ca3f011c3b548540a28da19dac9f27029c18830a0d6dbd2e03d",
    "blocked": true
  },
  "after": {
    "current_exists": true,
    "bytes": "LATE-EXACT-EXPORTER-GLB",
    "receipt_sha256": "122a68284d011ca3f011c3b548540a28da19dac9f27029c18830a0d6dbd2e03d",
    "blocked": true,
    "active_group": [],
    "producer_log": "child-ready\nT04_FINAL /private/tmp/t04-r2-fix-red-20261107/exporter-boundary/scratch/exact-exporter-late-publication/packages/client/public/models/flora/tree_round_t04.glb 401155db001948a67992d447d27ef6f2c207f48824dfa3a5db4a81559678d776\n"
  }
}
```

All later CPU checks exited0. `commands.json` distinguishes selected final checks from earlier 21/23-case intermediate passes. Those intermediate packages remain historical; none replaces the selected final results.

Preservation/reuse:

- Before editing, all 2,635 R2 protected entries matched. Afterward 2,632 entries retain exact bytes/hash, mode and mtime or their unchanged explicit read-error facts. Only run.py, export_saved.py and test_runner.py are authorized original-file deltas. New test/evidence paths are additional. All full protected rows and before/after tooling hashes are in protected-before.json and verification.json; no permission rewriting was used for unreadable history.
- Eight blends, eight GLBs, 46 PNGs / 54,805,448 bytes, current candidate, consumer files, prior receipts/reports, shared515, stock exporter and protected dependency/codec bytes are unchanged.
- Reuse only: the independent R2 review proved 76 source clouds, 16 stock PASS results and 29/29 actual-consumer tests against these exact bytes. They were not rerun here; the task forbids Blender/codec work and no art/consumer byte changed. No new full-stock/source/native visual PASS is claimed.
- Final owned-process observation: 129 recorded scratch groups, zero active members. Earlier uncertainty receipts are immutable; terminal-check.json is the later harness cleanup fact. No peer process was signalled.

Exact unchanged source/export SHA-256 pairs:

| Kind | Source | Export |
|---|---|---|
| round | `0289add6071aac144763fd8a3c67efaa3cfe03192b4ba4f44405043129aeb087` | `8257c5423566e6f9a62bc1cadf3ec1bd940ef20184a54d73f886afd903dabb45` |
| conifer | `6abb31b8763acc0a6bc44c7d1f63892b3929f9420f283058e409d4aee7ee5c82` | `ea9c889438779fd3af192d2476967fd7fb67cd655d1111bb5901ec3fdd48fbd2` |
| palm | `0de3633cd22ca4208d64eda410a8eb87a83ad44d3798aeebaa10b4473b68f898` | `b7fbcdc72b7f1581c0db7d1ae1d53632fb3e5992ff1b81c5542a2ce07d164b28` |
| mushroom | `ae59e3ea97159464fabb08cf467ae1751f1767248c23e2290312ae1799e22f85` | `becd7124703a6ded9349635d2be8ada54f0ae937b3e996508d79081c5c84be21` |
| spiral | `79049b427c1166ff53aab3b7a7389cf730d0403f4c7785f833b1986c8b52a3b0` | `24662149bd3330bd004145f8d86550c129c9841045d6145c191decf2a48796af` |
| coral | `12ad278e604c6c17cad26b2f6b8f5f10c957847a9fa4e7c1db4d36425c885a8a` | `2a0b52856aa05e2e293ad452bb5ea50ed0ea7832cce80055ee8f77d04ec51c3b` |
| blob | `2f7697de399e4ae1d1689d2be7e5817bc35fd985154682f2e2a85971a1e877b2` | `5c490c1931e440ac58d78420c95b7198babf650fe88f93f16bf017b935401b93` |
| cactus | `79a6283447a23c35062865a5779a8469665dbb15183cf1e2107c69c9e63aa062` | `3b55320d464a6494efcfcd62966624a62b2e7aa66279acf2201edc35e01917f6` |

Source path: `assets/blend/flora/tree_<kind>_t04.blend`. Export path: `packages/client/public/models/flora/tree_<kind>_t04.glb`. Full paths, sizes, selected stock reports and bounds are in verification.json.

Exact unchanged 19 × 4 LOD inventory (triangles):

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

LOD0 uses the consumer name; LOD1–3 append `_lod1`, `_lod2`, `_lod3`. Cactus remains `cactus_`/flora; the other kinds remain flora_tree. The actual floraModels/modelLibrary contract remains floating COLOR_0 R primary / G secondary / B accent / A AO, with unquantized position/masks, transformed geometry and real color behavior already proved by the unchanged consumer tests. No runtime/Flora/Engine/Review/capture file changed.

Selected preview manifest: `assets/blend/flora/trees/evidence/20261107T013236_packet_round_787bc5a6/preview-manifest.json`, SHA-256 `9eafff6415520a2def0da7261d60110922097faab747849c9b14fa06c99b0d1e`. It selects 19 sheets, retains 26 historical sheets plus one overview. All 46/48 compact-image slots and 54,805,448/536,870,912 bytes are unchanged; no new image, video, render, frame directory or cleanup.

DECISIONS:

- Surviving producer after EPERM → remove canonical ownership from production producer entirely → a late continuation can write only attempt-private outputs. The lane guard still protects reuse but is not relied upon to fence child publication.
- Shared exporter writes intermediate GLB → use its existing --out-dir and private TMPDIR → no shared fork, monkeypatch or validator change; same source, family, compression defaults, filename/classification and stock checks.
- Readiness versus success → ready.json binds completed producer work but is never a current PASS → only a terminal, successful producer plus unchanged source and matching validated bytes may reach supervisor publication.
- Mutable private storage → supervisor copies rather than linking it to the public name → late/private modifications cannot alter canonical bytes. Canonical creation is exclusive and rollback retains rejected bytes.
- Unresolved child → failure receipt records unsealed private history and actual unknown process state → later files do not rewrite that receipt or acquire authoritative status. Terminal children have complete private file hash inventories.
- Manifest/caller change → none needed → manifest.py already requires successful export receipt and matching current source/export hashes; the new supervisor produces those fields only after promotion. Existing selected payload/evidence is preserved.
- Verification scope → exact exporter with explicit CPU dependencies for process/publication boundaries; unchanged real art evidence reused by hash → no claim that fake payloads passed stock art validation, and no prohibited Blender/codec/native work.

OUT OF SCOPE FOUND:

No new art or runtime finding. T07 still owns mixed-bundle replacement, fallback retirement, runtime UV/material/LOD adoption and live performance. Crystal/non-tree content remains T05-owned. Parent owns orchestration docs, independent source review, native captures, blind grading, main and merge. No nested review or permission question was required or issued.

ARTIFACTS:

- This C.2 report; provenance.json; commands.json; failure-tail.txt.
- red-results.json and t04-r2-fix-red-20261107.tar.gz: exact reviewed base exporter/runner barrier RED.
- publication-results.json, regression-results.json and t04-r2-fix-final-20261107.tar.gz: selected final 23+28 checks, command logs, actual receipts and fixture bytes.
- packages.json: six regular detached packages, full SHA-256/size, selected-versus-historical labels; total 1,755,342 compressed bytes. archive-entry-facts.json records special/unreadable entries without fabricated digests; no live symlinks are preserved as payload archives.
- protected-before.json, verification.json, verify_preserved.py: repeatable no-Blender preservation check, exact current 8 pairs/19×4 inventory, source/export hashes, preview identity and native selectors.
- terminal-check.json: final observation of 129 recorded groups with zero active members.
- reviewer/REPORT.txt, adverse.py, exporter_boundary.py: exact immutable review copies. Original /tmp review and prior R1 reports remain unchanged.

Remaining parent native inventory/cost envelope (unchanged; NOT RUN):

For each of the 19 exact inventory rows: noon-lush_lod0/2, night-exotic_lod0/2, open-space_lod0/2, wireframe_lod0/2, overlay, far_lod2 at100m, sheet.png and perf.json. Exact command vectors/asset/variant selectors remain in verification.json.native_capture_inventory, copied from the protected candidate.

190 raw stills +19 contact sheets =209 native PNGs and19 perf JSONs. Three lights ×120 paired samples ×19 variants =6,840 pairs / at least13,680 measurement frames plus settle/capture overhead. Standard art sheets add19 eight-angle turntables +19 material close-ups +8 sibling sheets =46 more PNGs, total255 new parent gate PNGs. Standard turntable.py forces Metal here and was not used.

Suggested parent limits remain one admitted GPU lane/one variant at a time, native1920×1080, turntable800×600 cells/material480×360 cells, initially300s per variant with stop/owned cleanup on failure, at least12GiB free disk and a fresh1GiB parent packet ceiling, no videos/raw-frame directories/4096 sprawl. These require parent admission and do not authorize the GPU assigned to T15. CPU tests and reused source evidence are not native visual acceptance.
