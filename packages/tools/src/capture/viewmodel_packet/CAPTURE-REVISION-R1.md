TASK: P1.E05.T03 — capture packet SOURCE/CPU revision R1 (Appendix C.2).

STATUS: Owned revision complete for fresh independent R2. Both gates remain false; native/visual acceptance and whole T03 completion remain pending. Parent has assigned shared cleanup correction to P1.E14.T15 from `7af58d4d3`; adoption of its independently reviewed commit and fresh bindings are explicitly pending. This checkpoint does not qualify or repair that shared lifecycle.

SUMMARY: Addressed all seven local review findings while preserving shared capture/helpers/runtime/assets. All supplied reproductions were read before edits and replayed against a byte-identical scratch copy of base `826337c81d17081bc6856506956df4a7d57c8f86`, tree `f8a4074cde50ae56ba633cb1f91ae774505f8bae`, on branch `task/P1-E05-T03`. The 26 copied files were reverified against Git after testing. Final head/tree are supplied in the post-commit handoff, avoiding self-referential committed hashes.

FILES CHANGED: `native.py`, `entry.mjs`, `boundary.py`, `caller.py`, `inspect_packet.py`, `test_inspect.py`, new `test_revision.py` and `production.test.mjs`, refreshed disabled `readiness.json`, this report and new exclusive `evidence/capture-revision-r1/`. All 39 other existing packet/history files are unchanged. No Multitool, Engine, gameplay, shared capture/fixture/harness, source validation, accepted body/viewmodel, helper or orchestration file changed.

VERIFY:

| Finding | RED on original | Correction and GREEN boundary |
| --- | --- | --- |
| R1 helper schema | Actual StageReceipts.observe fails with missing `resolver`. | Adapter supplies retained `resolver.selectedExecutable.path` and exact executable hashes. Real observe and require_browser qualify all four expected roles through inert kernel/command ports. Native release intentionally stays unproved in that control. |
| R2 original callback evidence | Real helper wait loses observer/resource fields; failed boundary save masks their cause. | Callback saves the first raw structured exception before normalization. Original object/bytes/unknown fields stay primary; helper wait/save and cleanup failures stay secondary. Actual callback SIGALRM stops later capture/receipt dispatch and preserves mandatory inert draining. |
| R3 common finally masking | Real productionCapture → unchanged captureReview reports close instead of goto. | Existing task-local observations now include actual page/newPage operations before common finally. Twelve cases cover newPage, on, addInitScript, goto, waitForFunction and evaluate, each with and without simultaneous close failure. Shared launch/listen/cleanup ownership remains T15 work; method interposition was not expanded after that coordination update. |
| R4 cache growth | Generic tree binding reads 67,108,865 B before later copy rejection. | One admitted metadata inventory and remaining-byte caps govern each hash/copy/source reconciliation/copy reconciliation. Final growth validation uses the same boundary. All four growth schedules refuse before oversized content reads; aggregate edge, actual FIFO replacement and descriptor closure pass. |
| R5 settled raise | Actual CLI accepts zero raise for settled, neutral and fire. | All named settled/neutral/sway/fire/overheat frames require full raise; reset/gap/underwater retain zero semantics. |
| R6 timing | Actual CLI accepts a 0.4-second raise claim without elapsed progress. | Require at least 24 updates, sufficient elapsed progress, elapsed supported by the frame count and last dt=1/60. Additional cooling and zero-dt resets remain valid. A supplemental real CLI RED accepted 0.401 seconds; GREEN rejects nonintegral 1/60 progress, with tolerance for floating-point accumulation. |
| R7 PNG | Actual CLI accepts missing Adler, duplicate IHDR, unknown critical chunk and trailing compressed bytes. | Strict critical chunk order/uniqueness, exact expected-dimension scanline budget, complete zlib EOF and no trailing stream. Inflate is bounded to 64 KiB per call plus one size sentinel; Pillow then decodes the same authenticated bytes. RGB/RGBA 8/16-bit, Adam7 and consecutive split IDAT controls pass. |

Final tests: **46 Python** (13 admission/process + 4 recovered-helper + 5 revision + 24 decoder), **18 Node** (all original 17 plus the 12-case actual production adapter test), **110 existing runtime tests / 8 files**. All exit 0. The inspector retains all 19 original tests; 77 CLI cases are durably recorded by the delegated component, followed by the parent’s supplemental timing RED/GREEN and final 24-test pass with both aspects. All seven packet units pass real CPU decoding. The actual seven caller subprocesses produce the exact 101-file synthetic chain at unchanged temporary Git HEAD; publication-after-write, publication-after-return, release-unproved, all-sinks, interruption, receipt substitution, unrelated/staged/tampered/symlink predecessor and FIFO cases remain exercised. Synthetic files and inert ports are source-boundary evidence, not native images or cohort release proof.

Exact argv/cwd/exit/elapsed/log hashes are retained in `evidence/capture-revision-r1/commands.jsonl`; environment overrides are in `command-environments.json`. The compressed archive contains the complete logs, localized replay scripts, original review reports/reproducers, original pin, real helper callback records and all decoder case bodies/stdout/stderr/exits. Important final command records are:

- `python-controls-final`: pinned Python 3.14.8 runs the 22 caller/helper/revision controls, exit 0.
- `inspector-quantum-final`: pinned Python 3.10.22 with local Pillow 12.0.0 runs `unittest discover -s packages/tools/src/capture/viewmodel_packet -p test_inspect.py -v`, 24 tests, exit 0.
- `node-controls-final`: pinned Node 26.12.1, `--test --test-concurrency=1` over entry/fixture/production tests, exit 0.
- `focused-units-green`: direct pinned Vitest 5.0.5 CLI, scratch config, native config loader, maxWorkers=2/no file parallelism, both result/module caches disabled, scratch module-cache path, task-owned TMP and a scratch filesystem write guard, 110 tests, exit 0. No package manager was executed.
- `typecheck`: direct TypeScript 6.0.3 `tsc -p` for shared/client/server/tools, sequentially, exit 0.
- `lint-final` / `format-final`: direct pinned ESLint 10.13.0 / Prettier 3.9.10 over packet MJS/inventory, exit 0. All 11 Python modules parse without bytecode writes (`python-syntax-final.json`). Diff check passes.
- `protected-audit`: unchanged 6 bodies, 6 viewmodel assets, 6 previews, 745 accepted review files, 59 retained source/runtime revision files and all four exact recovered helpers, exit 0.
- `readiness-prepare-final` / `readiness-check-final`: exact launcher and self-observed kernel, dependencies, cache-owner probes and 31 absent prospective paths (29 distinct per-unit paths plus two containers), exit 0; result is `CPU_BINDINGS_ONLY`, never acceptance.

Failures remain preserved. Original RED reproducer exit 0 means its defect assertions succeeded; the new decoder regressions against the original exit 1 with 52 subcase failures. All eight supplied invalid CLI cases change from exit 0 to exit 1. The first local ESLint run exited 1 for a missing URL import in the new test; fixed with an explicit node:url import. The first guarded Vitest attempt exited 1 before any tests because its default system TMP path was refused; routing TMP into this evidence root produced the 110-test pass. Full logs and exact final 20-line tails are retained in `failure-tails.json`. No failed run is counted as a pass.

Reviewer disclosure is retained verbatim: its initial run created one ignored 8,213-byte Vitest module-cache file, SHA256 `26c323b7233677c8c7db372481e045ef135c064c31093462b9f6e1ecc9859237`, then moved exactly that file to its own evidence. Our initial original readiness check passed before edits, and fresh whole dependency/ignored-tree comparison passes after our tests. We made no foreign restoration. Dependency tree SHA256 remains `c9ca9b99ea32b544e006174013458c83feb842f339634b4746d694f236e681dc`; ignored inventory remains `2fde53955b2b8855c9cae24565e0ba0c300667c203f4001e2ae2d56b0d58f552`.

DECISIONS: Keep the immutable shared helper and capture bodies, adapting only task-local contracts and observation boundaries. Preserve the original failure before fallible persistence, including unknown facts; actual deadline exceptions unwind. Cache source bodies are never restored or deleted. All cache content passes use admitted sizes and aggregate remaining caps through the existing nonblocking/no-follow descriptor boundary. Reconciliation receives an explicit 30-second bound; this adds a validation deadline without changing disk reserves or output inventory. Readiness was refreshed after the supplemental timing fix; earlier readiness/freeze snapshots remain in the archive. No animation/pose, rendered material or output behavior was changed.

The disabled inventory and byte ledger are unchanged: 101 files = 94 PNGs + seven readouts, three output copies, 16 MiB per PNG, 32 KiB full-view readouts and 16 KiB other readouts. Admission is `3 * outputCap + 4,848,615,424`; reserves are metadata 64 MiB, cache snapshot 64 MiB, paired profile 2 GiB, paired private TMP 1 GiB, paired helper log 128 MiB, cache growth 256 MiB, filesystem 16 MiB and safety 1 GiB. These are observed ceilings, not OS quotas. Existing capture/cleanup/decode/cache-copy limits remain 600/60/45/30 seconds. Failed partials and consumed synthetic test grants remain in evidence; no real grant exists.

| Unit | Files / PNGs | Readout cap B | Output cap B | Admission B |
| --- | ---: | ---: | ---: | ---: |
| review-thalune | 12 / 11 | 16,384 | 184,565,760 | 5,402,312,704 |
| review-ixari | 12 / 11 | 16,384 | 184,565,760 | 5,402,312,704 |
| review-ulgani | 12 / 11 | 16,384 | 184,565,760 | 5,402,312,704 |
| view-thalune | 19 / 18 | 32,768 | 302,022,656 | 5,754,683,392 |
| view-ixari | 21 / 20 | 32,768 | 335,577,088 | 5,855,346,688 |
| view-ulgani | 21 / 20 | 32,768 | 335,577,088 | 5,855,346,688 |
| return-thalune | 4 / 3 | 16,384 | 50,348,032 | 4,999,659,520 |

OUT OF SCOPE: Parent’s shared T15 launch-before-cleanup, partial startVite.listen ownership, and browser.close masking/skipping stop require its independently reviewed commit and new source bindings before later adoption. Current capture.ts stays byte-identical; current observations must survive that adoption. Fresh independent R2 is required for this owned checkpoint. No real browser/GPU/native StationJob launch, codec executable, Blender, application server/DB, screenshot, visual acceptance, push, PR or merge occurred. Original GPU slot/grant coordination still governs later execution; T15 creates no additional permission request. T04 clip integration remains outside this lane.

ARTIFACTS: New exclusive scratch `/private/tmp/vmrev-hrgu6g4e` is retained, including sparse files, FIFO identities and temporary Git chains. Committed evidence archive `cpu-evidence.tar.gz` is 5,182,658 bytes, SHA256 `e02ba4b313cacbe339aa68a6f1b9cd148552a655e8782dbec7ffaa3d1efa2ba2`. All archived regular file bytes were read back and hash-verified; nonregular entries are metadata only and remain in original scratch. The manifest is stored as `archive-manifest.json.gz` to keep the source diff readable; its decoded SHA256 is `46f0c292fcc54fd93dc9de44bb10a88c53b52fe90bd81d5f0071c7941774263e`. No native screenshots/previews were created; the only PNGs are labeled CPU fixtures. The next native inventory remains the seven disabled units above.

Current readiness SHA256: `8d93491254841d1733c8e49e2a59a0c86820d70e1303cbe1c137e11d26aaf85e`. Inventory SHA256: `98958acf95dfdd56eba3b9f86172498f4f60b8d38993046dd4d17d863f1263ae`. Protected manifest SHA256: `09d67b371caa811a47c621d0131870d9541dd2e288315e59a7c4d8416fb19b4e`. Protected non-packet source digest remains `95303b16dc1256f91b8df979fdf4915a6d5bfae780a0f95bbdab952ea5ee7d8b`. `final-freeze.json` records exact source/test/readiness hashes and prior history; all accepted-body/review/helper hashes are in `protected-audit.txt`.

| Unchanged viewmodel source/export | SHA256 |
| --- | --- |
| `assets/blend/characters/viewmodels/fp_thalune.blend` | `46d483c8cc0b10f555dc35f60008d64f7b883d392daa4bf4e87abb91da97b1db` |
| `packages/client/public/models/characters/viewmodels/fp_thalune.glb` | `b4859735bd2f203bd30ca41705a156858cc362dd6de1000d308bd1e12b53e76f` |
| `assets/blend/characters/viewmodels/fp_ixari.blend` | `44c408a64b59353810119640471b2faf9506da57250bdb47e7ce067445f2c4b5` |
| `packages/client/public/models/characters/viewmodels/fp_ixari.glb` | `78f90acfc0087b63e97c3ae50cb7c1f5e045e447e12975b6ec21a0dd5f038abc` |
| `assets/blend/characters/viewmodels/fp_ulgani.blend` | `aabb32cb139c544d7a57f2fe22c34931fe720d2215e02936876f2dd02dd1aa3b` |
| `packages/client/public/models/characters/viewmodels/fp_ulgani.glb` | `8319097e97e3ccf2f9fdcbbe114742ea45f1f24eb8ba98420f12678d3511e954` |
