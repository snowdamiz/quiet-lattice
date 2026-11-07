# Finding 3 provenance — sealed

Read-only Git blob audit. No patch correctness review, no Blender, export, runtime, image grade, PR, push, or merge.

Repo: `/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab` (common dir `/Users/andreyyurlov/Documents/dev/space/.git`).

Map: `/private/tmp/lark-6445-finding3-provenance-map.json`
SHA-256: `27d2861656631cd6dad1b8c4fcec3c9b819abf98e871d302a9000aa6058b18a4`

## Pins

| Role | Commit | Tree | In candidate history |
| --- | --- | --- | --- |
| Candidate | `6445c7ec07aa2a08b722aeca22d56132154ea32c` | `a09d51b1b594a799a9489504d44d64447bb15450` | tip (`t3/7d211d96`) |
| Checkpoint | `9648690f6e3149684cbd7fe7787d6ae8cfc1c5f1` | `44f3ce1bfe2fe415d9c1cce54048f6f321bfe181` | no (`t3/144aa640`) |
| Content twin of checkpoint | `421491157cc50ffc344de07eb09ad17a178449a2` | `44f3ce1bfe2fe415d9c1cce54048f6f321bfe181` | yes |
| Prior author pin | `8b6c3604bb842019c899956a1b57d6a01385d6f3` | `765b8b28265d0da6af0a16a568c33a365178d748` | no (`task/P1-E12-T02-lark-r3`) |
| Merge-base prior/candidate | `0c4396a9194a5f7c99352f630ea7e66514b61115` | `10215dd755776ec57580375eb864924b7b990fcf` | yes |
| Parent of checkpoint and of the twin | `ce6a2896bc1e750e8a8f18aced780b4ac4fa14db` | `6042db41b8d7df467d5a9b29a9bd8d7fe298da1c` | yes |

Author base for the scoped hull claim is the checkpoint tree `44f3ce1bfe2fe415d9c1cce54048f6f321bfe181`. The named checkpoint commit and `421491157` are siblings: same parent `ce6a2896`, same tree, same stable patch-id `8cf059a48358e57e62b043afb458acc1e3da65fc`, same author date `2026-11-07T12:01:00-05:00`. Committer dates differ (`12:01:00` vs `12:02:09`). Candidate history contains the twin, not the named checkpoint SHA. Content diffs against either commit are the same.

Author base for prior vs candidate is merge-base `0c4396a`, not the prior pin. The prior pin is 7 first-parent Lark commits after that merge-base (`94d0ee14` through `8b6c360`). None of those 7 commits are in the candidate. Between the merge-base and `ce6a2896` there are 73 first-parent orchestrator commits. Between the twin and the candidate there are 18 first-parent Lark commits.

## Shared tools

`git diff 8b6c360 6445c7ec` does include shared validation and capture tooling. `git diff 9648690 6445c7ec` does not. An assertion that the whole prior-to-candidate tree diff excludes those tools is false. An assertion that the Lark revisions authored those blobs is also false.

Five `packages/tools` paths differ between prior and candidate outside `hulls/lark*`. For each, prior blob equals merge-base blob, and checkpoint blob equals twin blob equals `ce6a2896` blob equals candidate blob. No commit in `0c4396a..8b6c360` or `421491157..6445c7ec` touches them. `git diff --raw` records modify/add, not rename. The rest of `artlib/` and `packages/tools/src/capture/` is byte-identical at prior, checkpoint, and candidate (see map, `unchanged-shared-sibling`).

| Path | Base blob (`0c4396a` = prior) | Candidate blob (= checkpoint = `ce6a2896`) | Introducing commit |
| --- | --- | --- | --- |
| `packages/tools/blender/artlib/checks.py` | `ea5d8f8d90932af29d79611114075ffe1d519ecc` | `65b73b19d19cd94eb852f3b260e24199c669b1b8` | `3a1aedb1075398ee5ca9ad8476baf6d020b31bbb` |
| `packages/tools/blender/artlib/materials.py` | `b540f97701d165ca2af4670062725236e43a5c96` | `e45aca6a8fd5108d68a40c98ec25b42e06e2f5e4` | `3a1aedb1075398ee5ca9ad8476baf6d020b31bbb` |
| `packages/tools/blender/material_mask_selftest.py` | absent | `2451ff2ed3f8fba373680f3d24f8c54f834b4c1e` | `3a1aedb1075398ee5ca9ad8476baf6d020b31bbb` |
| `packages/tools/src/capture/capture.ts` | `72d6c7ce4ba615ef67d902b1824fc792b5a3cf1c` | `555c71d140a36004200ac04ff66609eeb4458136` | `21eab1f74110c8f7120013ebc4e119f4cc45a824` |
| `packages/tools/src/capture/capture.lifecycle.test.ts` | absent | `2e33cab7a3a3cdb8f929b51e45a7f894a09c6133` | `21eab1f74110c8f7120013ebc4e119f4cc45a824` |

`3a1aedb` ("P1.E14.T14: validate imported colour-mask material routes") is a single-parent orchestrator commit. Its parent `35086896540e90891dded030206ad68f86f93626` still has the prior blobs, and the file is absent for `material_mask_selftest.py`. The commit touches only those three paths. It is an ancestor of `ce6a2896` and of the candidate, and not of the prior pin.

`21eab1f` ("P1.E14.T15: Preserve capture resource ownership and failures") is a single-parent orchestrator commit. Its parent `78bda9de1d2ca9ecdd28acdea931e65835437a91` still has `capture.ts` blob `72d6c7ce` and lacks the lifecycle test. The commit touches only those two paths. Same ancestry as above. Other historical touches of `capture.ts` (`3481d45`, `4b6cdfdb`, `deb5c561`) are older than this blob.

Of 349 `packages/tools` paths whose bytes differ prior vs candidate, 344 are under Lark hull paths. The other five are the table above.

Checkpoint to candidate is 244 paths: `assets/blend/hulls/lark.blend`, `packages/client/public/models/hulls/lark.glb`, and 242 paths under `packages/tools/blender/hulls/lark-round5/`. Zero paths outside that hull set. Shared exporter/artlib files are unchanged across that range.

## Not the shared tools

`prepare_capture.py` (`25b37e530a7bb00f052d9f7adb240537515d1409`) and `run_capture_prep.py` (`b65c3e10ced2f62043d2f29efd443f5a9669aad2`) under `packages/tools/blender/hulls/lark-round5/` are absent at the merge-base, the prior pin, `ce6a2896`, and the checkpoint. They are added by Lark commit `85e4fe9bfbd695321a4ca18d00f58f2de545fc5c` ("Prepare CPU-only Lark review scenes and bounded static measurements"), which is after the twin and before the candidate. Hull-local, not the shared capture package.

`docs/review-records/p1-e08-t08/lifecycle-review-ccdcb1b/static_checks.py` blob `b2550084009fce82138bafaeae9c31cc1636b6d5` and `docs/review-records/p1-e12-t02/lark-r3-source-review-8b6c360/materials.py` blob `e3c7e7619cf416aac1992d51a9b073c3396e5b8f` are different blobs from `artlib/checks.py` and `artlib/materials.py`. Last touches are orchestrator retention commits `ab6718db76fc05cb477776276a05927eb448a2ef` and `eb1362ec2cb81c843bf18b1c30f40eab40f8120f`. Name collision only.

## Scope of the prior tree diff

`git diff 8b6c360 6445c7ec --name-only` lists 3091 paths. Rename detection was skipped (limit warning at 2178), so that count can pair as separate deletes and adds. It is not a commit range. Against merge-base `0c4396a`, blob classification of those paths is 2191 changed only on the candidate side, 898 changed only on the prior side, and 2 changed on both sides: `assets/blend/hulls/lark.blend` and `packages/client/public/models/hulls/lark.glb`. The five shared tools are in the candidate-only set. The 898 prior-only paths are Lark-r3 bytes that the candidate tree does not have.

## Ambiguities

Checkpoint commit identity is dual, as above. Content attribution is not.

The 3091 path count is a two-dot name list without exhaustive rename detection. Shared-tool attribution uses raw blobs and does not depend on that count.

Inherited patch behavior was not reviewed.
