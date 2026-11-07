# Appendix C.2 — VM live-observer reachability correction

## TASK

P1.E05.T03 task-local SOURCE/CPU assessment and correction of live profile/private-TMP sampling. Base `032fe44cd6ebdbeb61c21a89014704f66b194950`, tree `c9f595de7b311de57d656053c8e5df93ac617583`, branch `task/P1-E05-T03`. Exclusive evidence: `/private/tmp/vm-live-sampling-qsu7czb1`. Final commit/tree and clean-worktree verification are recorded after commit in `POST-COMMIT.json` there, and appended to its `APPENDIX-C2.md`; no report claims its own commit hash.

## STATUS

REPRODUCED / FIXED in CPU source controls; independent source review and native acceptance remain open. Enabled source status is `ENABLED_AWAITING_PARENT_GRANT`, not a disabled pass. Both flags remain true. Fresh readiness SHA256 `3aa380e3d0d655cf79ba8d565cbb683b873d7b27d694638124274654cbddc1b9`; all 52 prospective paths absent. No real grant, consumption or output was created. Fresh path identity is `viewmodel-packet-live-qsu7czb1`.

The original VM unit remains FAILED/SPENT: exit 1, 14.188 s, zero images at `84d7098432de296b1db916849804c912d1558cd3`. The supplied effects pilot also remains FAILED/SPENT despite eleven PNGs/entry PASS. Parent physical release is not successful capture. No retry, native launch, image production or original-evidence cleanup occurred here.

## SUMMARY

The real VM callback used `size()` over an active profile/private-TMP tree. A harmless bounded writer deleted/renamed enumerated files: exact-base CPU replay reached `StationJob.wait`, became `observer_failed`, and drained. A separate subtree deletion exposed `os.walk` silently omitting coverage. Both occur through VM's actual `native.capture` and retained observer, with only native process/kernel ports inert.

Live sampling now anchors traversal to nonblocking, no-follow directory descriptors and pinned owned roots. It retains descendant ENOENT and changed directory identities as partial facts, including original exceptions, paths, errno and timing. It counts observed bytes and known FIFO/socket metadata without reading their contents. Wrong owners, symlinks, root replacement, permission/unknown I/O errors, exceeded bounds and actual SIGALRM remain failures and take mandatory drain. Every opened directory descriptor closes on success/error/deadline in the controls.

`coverage:enumerated` means enumeration finished, never atomic completeness: every sample says `atomic:false, settled:false`. Repeated partial evidence remains in `usageSampling.incomplete`; interrupted facts are retained before unwinding. Limits: two seconds per sample, 100,000 entries, depth 64, 32 losses/sample, two seconds of repeatedly partial coverage, 128 partial samples and 256 KiB partial evidence. A failing sample remains retained. Existing 64 MiB helper, 16 MiB job, 512 MiB private and 1 GiB profile working ceilings remain. These are observed reserve ceilings, not OS quotas; mutation between observations is not proven bounded by sampling.

The actual caller cache-phase control physically renamed `deps_temp_a4ff6522` to `deps` during live observation. Cache inventory occurred only `before-capture` and `released`; strict `size` ran only after release. No reaching live generated-cache reader was found. Cache content hashing/copy/reconciliation stays unchanged. The entire final cleanup/release/archive segment is byte-identical (SHA256 `6d63779a641297573f8beb583656196b7aca99b31db6e653d42a71be58eeab23`); original `size` AST is identical. Actual helper copy followed by source mutation still refuses `Private TMP copy differs` and preserves source/archive evidence.

## FILES

- `native.py`: task-local live metadata sampler and callback wiring only; final strict settlement unchanged.
- `test_live_usage.py`: seven focused methods crossing actual observer/cleanup with bounded real delete/rename writers and adverse limits/ownership/I/O/deadline controls.
- `caller.py`: fresh prospective identity literals only; admission/run/publication behavior unchanged.
- `readiness.json`, `README.md`, this report, new `evidence/live-sampling-correction/`: current bindings, proof limits, complete CPU evidence archive and readback manifest.

| Source               | SHA256                                                             |
| -------------------- | ------------------------------------------------------------------ |
| `native.py`          | `d54f9208808484d71444ac32636988b8ae3eb800d3a4af9c9a7a339badbdead9` |
| `test_live_usage.py` | `73c31d1d49ebcc7744537ba163a93f5303191f5482e5c09114ada79f87f81e60` |
| `caller.py`          | `fd69f37b97b9bbecdd469d6fe44c73bbe83d56c2f9d9e0a902da150b7a07996c` |
| `readiness.json`     | `3aa380e3d0d655cf79ba8d565cbb683b873d7b27d694638124274654cbddc1b9` |
| `boundary.py`        | `7c85deeb746ea3bd2c1c8ddb3122d8b7344af69abfcc0b9caa34bb0974a070bd` |
| `bindings.py`        | `51beb6911086f5550bd428b6e6a90bef8ef2746a84db29c645b9c4ab38b427ae` |
| `entry.mjs`          | `0011e04cc44fcbe64d5ba65eddcd4f1d6c434ac85ce2431af44290fccf117f3c` |
| `fixture.mjs`        | `856dd81a1238f19f9c1dcc103ce7a2ae5ccddfd9327f1e9ba5eef182d6f6e5a6` |
| `inspect_packet.py`  | `862a50a99f822a95bdf6dfd67da272ad3a544dbbf78884e752cddc38ff278461` |
| `inventory.json`     | `5c08f26d1fdd8c2ed074293b2efcd5bed18d410cbe1f2bd3ea14100db996c67e` |

## VERIFY

- Exact-base RED `callback-red`: exit 1, six delete/rename/subtree subcases reproduce actual `observer_failed`. Original native SHA256 `40faffc819e9cb401233c7281e5c5f7494ac0c538d492bc018dfff20f27c8850`; scratch copy compared to the base Git blob. The test loader also ran five existing controls; those are not claimed as new failures.
- Exact-base RED `silent-red-final`: exit 1, actual subtree disappearance completes the old walk without any retained partial coverage. The failing assertion is `None is not true` for `usageSampling.incomplete`.
- GREEN `final-observer-controls`: exit 0, **25 methods** (7 live sampling + 5 retained observer/cache + 4 native cleanup + 4 cyclic/error + 5 real protocol). Includes actual seven child-process receipt writes, OS exits, authenticated parent reads and successor gates for the unchanged **101-file** synthetic packet. Interrupted/publication/failed drain/hash changes stop later work.
- `cache-phase`: exit 0, actual caller/native observer with physical scratch cache rename. No live cache inventory; final strict size only after release.
- `partial-publication`: exit 0, actual profile deletion during live callback, real result/consumption writes, OS exit 0, bounded authenticated read and real successor admission without dispatch. The 107,337-byte result retains partial ENOENT, shared sample identity and cyclic unknown observations. Result SHA256 `9d43902fde5906357044c2959784788de1470b3002c9788f4059d541c28f5eaf`; consumption `ae163a3c6a568e53212d489f6089f6959702ca79f8963d832b2ee0c589ed7e5b`. These are inert CPU fixtures, not native grants/results.
- `static`: exit 0, 17 Python sources compiled in memory; unchanged entry/fixture/inspector/protocol/receipt/binding code, inventory, T15 patch parity and protected reports checked. No bytecode writes. Shared lifecycle100/client110/type/PNG/timeline results are historical unchanged-source evidence, not freshly rerun counts. No extra broad suite.
- `auth-check`: wrapper exit 0. Real caller missing grant exits 1 (`Missing parent grant`); real Node entry missing consumed authority exits 1 (`Missing consumed parent grant`); actual `--check` exits 0 with enabled/awaiting-grant and nativeQualified false. All 52 fresh paths remain absent.
- `preservation`: exit 0; all **822 protected entries**, **12,921 tracked files outside packet**, **21,507 historical evidence files**, dependency trees and ignored inventory match the pre-work baseline. A post-commit repeat is recorded externally.

Every exact argv, exit, log digest, duration and environment is in `commands.jsonl` / `COMMANDS.md`; nonzero tails in `failure-tails.json`. Direct Python is `/opt/homebrew/opt/python@3.14/bin/python3.14 -B` (3.14.8); Node remains frozen26.12.1 at `/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node`. `run.py` supplies timeout240, bytecode/compile-cache off, OMP/BLAS one thread and exclusive scratch. At most the main Python thread plus one bounded harmless writer; no browser, native StationJob process, codec, Blender, server, DB, installs or dependency writes.

All failures remain: the first GREEN lacked the post-descent route identity check (two subtree rename assertions failed), then corrected; one executable path typo failed before launch (`callback-green-v2`); initial `silent-red` had a driver SyntaxError, preserved as `silent-red-v1.py`, and corrected RED ran on unchanged base. Neither harness error is product evidence. No previous log/report was overwritten.

## DECISIONS

Live enumeration cannot use immutable-tree assumptions. Only descendant absence/identity loss is tolerated as partial coverage, under finite limits. No blanket OSError suppression, no retry loop and no conversion of unknown coverage into completeness. No live cache change without VM reachability. Strict final source/copy/hash/ownership proof remains the release/admission gate.

The supplied effects result was read through its actual segmented `evidence.capture_snapshot` from the readonly effects checkout. Envelope SHA256 `291b242d830b1de6e883b51d57abe4de3b4ae442d0b4973ce57620a835c02f6e`; all four segment hashes and reader source pins are retained in `effects-read.json`. Its original `writers` FileNotFound and cleanup error are preserved in `effects-decoded-result.json`. No effects implementation or evidence was copied into VM runtime behavior.

Source/asset/helper/dependency freeze is refreshed once after the final implementation; Node26.12.1 and current self-observed Python kernel identities, exact Apple executable bindings and immutable ownership rules remain. MTL/VTEncoder/unknown/Storemember behavior is unchanged. Parent must independently review this source, then recheck capacity/schedule and issue a new one-use first-unit grant. The failed grants remain spent. No autonomous runtime retry.

## OUT OF SCOPE

No product/asset/helper/T15/shared-capture change; no gameplay/T04 animation change, no new rendering/pose/schema, no output inventory or admission arithmetic change. No native/GPU/browser or codec work, no screenshots or cleanup, no push/PR/merge. Full T03/native/visual acceptance remains open.

The inventory remains seven units /101 files /94 PNGs /7 readouts, three copies plus fixed 4,848,615,424-byte reserves. Review output/admission184,565,760/5,402,312,704 B each; Thalune302,022,656/5,754,683,392; Ixari/Ulgani335,577,088/5,855,346,688; return50,348,032/4,999,659,520. Capture600s/cleanup60s/decode45s/cache64MiB30s unchanged. Live metadata limits fit within existing reserves.

## ARTIFACTS

- Exclusive evidence root `/private/tmp/vm-live-sampling-qsu7czb1`; complete regular CPU evidence bytes sealed in `evidence/live-sampling-correction/cpu-evidence.tar.gz`, read back against its bounded archive manifest. Special FIFO/socket/symlink facts are listed without opening/following them. Original scratch remains preserved.
- Final `APPENDIX-C2.md`, `POST-COMMIT.json`, `unit1-launch.json`, `seal.json` under the exclusive root supply exact final HEAD/tree/readiness/patch and data-only first-unit prerequisites, never a grant.
- Protected manifest SHA256 `09d67b371caa811a47c621d0131870d9541dd2e288315e59a7c4d8416fb19b4e`; retained in `evidence/capture-revision-r1/protected-audit.txt`. All reports, accepted review packets and spent native files remain unchanged.
- Outside-packet source digest `cfd22c5cf2d6736cce266f26f39b1c0bd76e04f1eb292915aed12791fa40d0d4`; ignored digest `2fde53955b2b8855c9cae24565e0ba0c300667c203f4001e2ae2d56b0d58f552`. Node modules `c9ca9b99ea32b544e006174013458c83feb842f339634b4746d694f236e681dc`; browser tree `5fb8dcd8d2606ed66b09d4e545ba7f264b0bb2bb129022db4369de534b2a9645`; Pillow `6addcbac6ae4bd93ca6cfe79295d32b2d30662040f466ca4f554057df33a8b1c`.

| Protected asset                                                      | SHA256                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `assets/blend/characters/thalune.blend`                              | `d1fc6986ad5fc164279e12a299aa6bc62b499084a6e8afee1b87315832c8d74b` |
| `packages/client/public/models/characters/thalune.glb`               | `dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27` |
| `assets/blend/characters/ixari.blend`                                | `9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c` |
| `packages/client/public/models/characters/ixari.glb`                 | `1236d2bafed2d8a2c58eeb4ba6cf73501c669fbc7d7eda5d1fb3c260d34d243b` |
| `assets/blend/characters/ulgani.blend`                               | `06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b` |
| `packages/client/public/models/characters/ulgani.glb`                | `9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682` |
| `assets/blend/characters/viewmodels/fp_thalune.blend`                | `46d483c8cc0b10f555dc35f60008d64f7b883d392daa4bf4e87abb91da97b1db` |
| `packages/client/public/models/characters/viewmodels/fp_thalune.glb` | `b4859735bd2f203bd30ca41705a156858cc362dd6de1000d308bd1e12b53e76f` |
| `assets/blend/characters/viewmodels/fp_ixari.blend`                  | `44c408a64b59353810119640471b2faf9506da57250bdb47e7ce067445f2c4b5` |
| `packages/client/public/models/characters/viewmodels/fp_ixari.glb`   | `78f90acfc0087b63e97c3ae50cb7c1f5e045e447e12975b6ec21a0dd5f038abc` |
| `assets/blend/characters/viewmodels/fp_ulgani.blend`                 | `aabb32cb139c544d7a57f2fe22c34931fe720d2215e02936876f2dd02dd1aa3b` |
| `packages/client/public/models/characters/viewmodels/fp_ulgani.glb`  | `8319097e97e3ccf2f9fdcbbe114742ea45f1f24eb8ba98420f12678d3511e954` |
